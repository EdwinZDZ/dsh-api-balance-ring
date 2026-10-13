/**
 * API Balance Ring · API 余额圆环 — Host half.
 *
 * A bundle Host half is an ordinary Node module loaded by the Cordis Loader —
 * not a sandboxed function body — so it runs with the platform's global `fetch`
 * and no shell at all. That is what makes it portable by construction: Node's
 * fetch is identical on macOS and Windows.
 *
 * The browser half cannot reach `harness.handle` / `host.call` — those belong
 * to a *dynamic* package's halves, and a bundle Client module's `require`
 * resolves only the platform seed words (`react`, `@deepseek-ai/cordis`,
 * `@deepseek-ai/dsh-client-ui-slots`, …). So the halves talk over the Harness
 * web server instead, the same channel the shipped HMR client uses.
 *
 * BALANCE — the DSH client supports two ways of paying, and this serves both:
 *
 *   1. Account sign-in (设置 → 账号与余额). The official `deepseekAccount`
 *      service already holds the signed-in wallet, so the balance is read
 *      through `deepseekAccount.getBalance()` with no external call of our own.
 *      This is the whole point: the ring saves the trip into Settings.
 *      `balance.value` is the 充值余额 shown there; `bonusWallets` is the
 *      granted balance and is deliberately not summed into the ring.
 *   2. API key: the `DEEPSEEK_API_KEY` credential against the official
 *      `/user/balance` endpoint, exactly as the original plugin did.
 *
 * Account sign-in is preferred because it needs no credential and no network
 * call of ours; the API-key path is the fallback.
 *
 * SPEND — today's MiMo spend is computed from the session logs with the
 * official CNY rate card and kept in the panel. It answers a different question
 * from the balance ("what have I burned today" vs "what is left"), so both are
 * worth showing.
 *
 * PRICING IS DENOMINATED IN CNY: 元 / 1M tokens
 * (https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go), so there is no USD→CNY
 * conversion and no exchange-rate drift.
 */

// ── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  // ── Balance, account sign-in mode ──
  // Reported to the platform with the request; matches the harness' own client.
  accountClientVersion: '0.2.0-rc.2',

  // ── Balance, API-key mode ──
  credentialRef: 'DEEPSEEK_API_KEY',
  balanceEndpoint: 'https://api.deepseek.com/user/balance',
  requestTimeoutMs: 12000,

  // ── Spend (the ring's subject when the active provider's balance cannot be
  //    read) ──
  // Daily budget the spend ring measures today's spend against, in ¥.
  dailyBudgetCny: 50,
  // Where the account balance can be read by a human.
  balanceConsoleUrl: 'https://platform.xiaomimimo.com/console/balance',

  // ── Routes the browser half fetches. `exact` match, so they cannot shadow
  //    the SPA routes. The paths must match ../client.js.
  balancePath: '/__dsh-api-balance-ring/balance',
  statsPath: '/__dsh-api-balance-ring/stats',
}

/**
 * Official Xiaomi MiMo domestic pricing, CNY per 1M tokens.
 * Source: https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go (实时推理行).
 *
 * Cache writes are free for now ("缓存写入：限时免费") and are therefore not
 * priced. Batch inference is half price but session logs carry no batch marker,
 * so every request is priced at the real-time rate.
 */
const PRICING = {
  'mimo-v2.6-flash': { cacheHit: 0.02, input: 1.0, output: 2.0 },
  'mimo-v2.5': { cacheHit: 0.02, input: 1.0, output: 2.0 },
  'mimo-v2.6-pro': { cacheHit: 0.025, input: 3.0, output: 6.0 },
  'mimo-v2.5-pro': { cacheHit: 0.025, input: 3.0, output: 6.0 },
  'mimo-v2.6-pro-ultraspeed': { cacheHit: 0.25, input: 30.0, output: 60.0 },
}

/**
 * The providers whose requests the table above is authoritative for.
 *
 * This binding is deliberate and explicit: `PRICING` is Xiaomi MiMo's rate
 * card and nobody else's. A request from a different provider is still counted,
 * but it is never priced with these numbers — billing a DeepSeek account call
 * at MiMo's rates would silently misstate the cost, and an `unpriced` flag is
 * a better answer than a wrong number.
 */
const MIMO_PROVIDERS = ['xiaomi']

/**
 * The rate for one request, or null when this provider's rates are not known.
 * @param {string} provider - provider id from the request header.
 * @param {string} model - model id from the request header.
 * @returns {{cacheHit:number,input:number,output:number}|null}
 */
function pricingFor(provider, model) {
  if (!MIMO_PROVIDERS.includes(provider)) return null
  return PRICING[model] ?? null
}

/**
 * The provider the composer is pointed at — the same reading the payment-mode
 * detection uses, so the spend meter and the balance follow one another.
 * @param {{get(name:string):any}} services - the injected Cordis services.
 * @returns {string} the provider id, or '' when it cannot be read.
 */
function activeProvider(services) {
  try {
    const agentDefaultModel = services.get('agentDefaultModel')
    if (agentDefaultModel !== undefined && agentDefaultModel !== null) {
      const selection = agentDefaultModel.currentSelection()
      if (selection !== null && selection !== undefined && typeof selection.provider === 'string') {
        return selection.provider
      }
    }
  } catch {
    // Report an empty provider; the caller decides what that means.
  }
  return ''
}

// ── Balance ──────────────────────────────────────────────────────────────────

/**
 * Build the client metadata the account service expects — the same shape the
 * shipped settings page sends.
 * @returns {{version:string,locale:string,timezoneOffsetSeconds:number}}
 */
function accountClientMetadata() {
  return {
    version: CONFIG.accountClientVersion,
    locale: 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

/**
 * Read the balance of a signed-in DeepSeek account.
 * @param {object|undefined} deepseekAccount - the `deepseekAccount` Cordis service.
 * @returns {Promise<{balance:number,currency:string}|null>} the topped-up wallet,
 *   or null when the account is not signed in or the platform did not answer.
 */
async function readAccountBalance(deepseekAccount) {
  if (deepseekAccount === undefined || deepseekAccount === null) return null
  let details
  try {
    details = await deepseekAccount.getBalance(accountClientMetadata())
  } catch {
    return null
  }
  if (details === null || details === undefined || details.status !== 'ready') return null
  const wallets = Array.isArray(details.value) ? details.value : []
  if (wallets.length === 0) return null
  // 充值余额 is `value`; `bonusWallets` is the granted balance, shown as its
  // own row in Settings, so it is not summed into the ring.
  const wallet = wallets.find((w) => w.currency === 'CNY') ?? wallets[0]
  const balance = Number(wallet.balance)
  if (!Number.isFinite(balance)) return null
  return { balance, currency: wallet.currency }
}

/**
 * Read the balance of an API key from the official endpoint.
 * @param {object} credentials - the `credentials` Cordis service.
 * @returns {Promise<{balance:number,currency:string}|null>} the balance, or
 *   null when no `DEEPSEEK_API_KEY` credential is stored.
 */
async function readApiKeyBalance(credentials) {
  const cred = await credentials.resolve(CONFIG.credentialRef)
  const key = cred !== undefined && cred !== null && typeof cred.value === 'string' ? cred.value : ''
  if (key === '') return null
  const response = await fetch(CONFIG.balanceEndpoint, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(CONFIG.requestTimeoutMs),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`balance endpoint returned HTTP ${response.status}: ${text.slice(0, 160)}`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`balance endpoint returned unexpected content: ${text.slice(0, 160)}`)
  }
  const info = Array.isArray(parsed.balance_infos) ? parsed.balance_infos[0] : undefined
  if (info === undefined || typeof info.total_balance !== 'string') {
    throw new Error(`balance endpoint returned unexpected payload: ${text.slice(0, 160)}`)
  }
  return {
    balance: Number(info.total_balance),
    currency: typeof info.currency === 'string' ? info.currency : 'CNY',
  }
}

/**
 * Classify a model provider id into the payment mode behind it.
 *
 * This is the crux: whether a DeepSeek account happens to be signed in says
 * nothing about who is paying. The composer may be pointed at a third-party
 * provider with its own API key — Xiaomi MiMo, for instance — while a DSH
 * account sits signed-in and unused. What decides the mode is the provider the
 * harness is actually calling.
 *
 * @param {string} provider - provider id from the current model selection.
 * @returns {'account'|'api-key'|'third-party'}
 */
function modeForProvider(provider) {
  if (/^deepseek-account/.test(provider)) return 'account'
  if (/^deepseek/.test(provider)) return 'api-key'
  return 'third-party'
}

/**
 * Which payment mode the harness is actually set up for.
 *
 * Detection follows the provider the composer is pointed at, so switching the
 * model switches the ring with it:
 *
 *   account      provider `deepseek-account` → the 充值余额 via
 *                `deepseekAccount.getBalance()`.
 *   api-key      provider `deepseek*` → the official `/user/balance` endpoint.
 *   third-party  anything else (MiMo, …) → that provider's balance is not
 *                readable, so the caller falls back to the metered-spend ring.
 *
 * @param {{get(name:string):any}} services - the injected Cordis services.
 * @returns {Promise<{mode:string,provider:string,balance?:number,currency?:string}>}
 */
async function readBalance(services) {
  // The provider the composer is pointed at — the same reading the spend meter
  // uses, so both follow the model the user is on.
  const provider = activeProvider(services)
  const mode = provider === '' ? '' : modeForProvider(provider)

  // 1. DSH account sign-in.
  if (mode === 'account' || mode === '') {
    const account = await readAccountBalance(services.get('deepseekAccount'))
    if (account !== null) return { mode: 'account', provider, ...account }
  }

  // 2. DeepSeek API key.
  if (mode === 'api-key' || mode === '') {
    const apiKey = await readApiKeyBalance(services.get('credentials'))
    if (apiKey !== null) return { mode: 'api-key', provider, ...apiKey }
  }

  // 3. A third-party provider whose balance cannot be read. The caller falls
  //    back to the metered-spend ring, which needs no payment source.
  return { mode: 'third-party', provider }
}

// ── Today's spend ────────────────────────────────────────────────────────────

/**
 * Aggregate today's real usage from every session log.
 *
 * Only the active provider's requests are counted — the meter follows the model
 * the composer is pointed at, the same way the balance does — and each request
 * is priced with the rate recorded in its own request/header event, so
 * switching between mimo-v2.6-flash and mimo-v2.6-pro mid-session stays
 * correct.
 *
 * Pricing is applied only where a rate card actually exists: see
 * `pricingFor`, which returns null for any provider other than Xiaomi MiMo.
 *
 * @param {object} sessionQuery - the `sessionQuery` Cordis service.
 * @param {string} activeProviderId - provider to count; '' counts every provider.
 * @returns {Promise<{requests:number,tokens:number,costCny:number,unpriced:boolean}>}
 */
async function readTodaySpend(sessionQuery, activeProviderId) {
  const sessions = await sessionQuery.listSessions()
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  let requests = 0
  let input = 0
  let output = 0
  let cache = 0
  let cny = 0
  let unpriced = false

  await Promise.all(sessions.map(async (rec) => {
    try {
      const snap = await sessionQuery.readSession(rec.header.id)
      let provider = ''
      let model = ''
      for (const ev of snap.events) {
        if (ev.type === 'request/header') {
          const cfg = ev.data && ev.data.header && ev.data.header.config
          if (cfg !== undefined && cfg !== null) {
            provider = typeof cfg.provider === 'string' ? cfg.provider : ''
            model = typeof cfg.model === 'string' ? cfg.model : ''
          }
          continue
        }
        if (ev.type !== 'assistant/message') continue
        if (ev.time < dayStart) continue
        if (activeProviderId !== '' && provider !== activeProviderId) continue
        const usage = ev.data && ev.data.usage
        if (usage === undefined) continue
        requests += 1
        input += usage.inputTokens || 0
        output += usage.outputTokens || 0
        cache += usage.cacheReadTokens || 0
        // Only a provider with a known rate card is priced; anything else is
        // counted and flagged rather than costed at somebody else's rates.
        const p = pricingFor(provider, model)
        if (p === null) {
          unpriced = true
        } else {
          cny += ((usage.cacheReadTokens || 0) / 1e6) * p.cacheHit
            + ((usage.inputTokens || 0) / 1e6) * p.input
            + ((usage.outputTokens || 0) / 1e6) * p.output
        }
      }
    } catch {
      // One unreadable session must not fail the whole aggregate.
    }
  }))

  return {
    requests,
    tokens: input + output + cache,
    costCny: Math.round(cny * 100) / 100,
    unpriced,
  }
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────

/**
 * Answer one route with JSON. Failures are also sent as `200 { ok: false }` so
 * the browser half reports the message instead of an opaque network error.
 * @param {import('node:http').ServerResponse} res - route response.
 * @param {object} payload - JSON body.
 */
function sendJson(res, payload) {
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

// ── Plugin ───────────────────────────────────────────────────────────────────

// Declared up front so the plugin parks instead of throwing in a profile that
// lacks one of these services.
export const inject = ['agentDefaultModel', 'credentials', 'deepseekAccount', 'sessionQuery', 'webServer']

/**
 * Register the read-only routes the browser half fetches.
 * @param {object} ctx - Cordis context.
 */
export function apply(ctx) {
  const services = { get: (name) => ctx.get(name) }
  const webServer = ctx.get('webServer')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: CONFIG.balancePath,
    handler: (req, res) => {
      void (async () => {
        try {
          const balance = await readBalance(services)
          sendJson(res, {
            ok: true,
            ...balance,
            updatedAtText: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          })
        } catch (err) {
          sendJson(res, { ok: false, error: String(err && err.message ? err.message : err) })
        }
      })()
    },
  }), 'api-balance-ring: balance route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: CONFIG.statsPath,
    handler: (req, res) => {
      void (async () => {
        try {
          const provider = activeProvider(services)
          sendJson(res, {
            ok: true,
            ...(await readTodaySpend(ctx.get('sessionQuery'), provider)),
            provider,
            budgetCny: CONFIG.dailyBudgetCny,
            balanceConsoleUrl: CONFIG.balanceConsoleUrl,
            updatedAtText: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          })
        } catch (err) {
          sendJson(res, { ok: false, error: String(err && err.message ? err.message : err) })
        }
      })()
    },
  }), 'api-balance-ring: stats route')
}

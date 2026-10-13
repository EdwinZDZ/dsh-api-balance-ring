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

  // ── Spend (the ring's subject when neither payment mode is configured) ──
  // Only requests routed through these providers spend a metered balance.
  providers: ['xiaomi'],
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
 * Which payment mode the harness is actually set up for.
 *
 * The DSH client pays in one of two ways — a signed-in account (设置 → 账号与
 * 余额) or a `DEEPSEEK_API_KEY` — and the ring has to follow whichever the user
 * is on rather than assume one. Sign-in is checked first because it is the
 * native DSH mode and needs no credential of ours; an API key is used when no
 * account is signed in. When neither is present the caller falls back to the
 * metered-spend ring, which needs no payment source at all.
 *
 * @param {{get(name:string):any}} services - the injected Cordis services.
 * @returns {Promise<{mode:'account'|'api-key'|'none',balance?:number,currency?:string}>}
 */
async function readBalance(services) {
  // 1. Account sign-in: `getState()` is a local read of the stored credential,
  //    so detection costs nothing before the balance itself is fetched.
  const deepseekAccount = services.get('deepseekAccount')
  if (deepseekAccount !== undefined && deepseekAccount !== null) {
    try {
      const state = await deepseekAccount.getState()
      if (state !== null && state.status === 'credential-stored') {
        const account = await readAccountBalance(deepseekAccount)
        if (account !== null) return { mode: 'account', ...account }
      }
    } catch {
      // Fall through to the API-key mode.
    }
  }

  // 2. API key.
  const apiKey = await readApiKeyBalance(services.get('credentials'))
  if (apiKey !== null) return { mode: 'api-key', ...apiKey }

  // 3. Neither: the caller falls back to the metered-spend ring.
  return { mode: 'none' }
}

// ── Today's spend ────────────────────────────────────────────────────────────

/**
 * Aggregate today's real usage from every session log. Each request is priced
 * with the rate recorded in the most recent request/header event, so switching
 * between mimo-v2.6-flash and mimo-v2.6-pro mid-session stays correct.
 * @param {object} sessionQuery - the `sessionQuery` Cordis service.
 * @returns {Promise<{requests:number,tokens:number,costCny:number,unpriced:boolean}>}
 */
async function readTodaySpend(sessionQuery) {
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
        if (!CONFIG.providers.includes(provider)) continue
        const usage = ev.data && ev.data.usage
        if (usage === undefined) continue
        requests += 1
        input += usage.inputTokens || 0
        output += usage.outputTokens || 0
        cache += usage.cacheReadTokens || 0
        const p = PRICING[model]
        if (p === undefined) {
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
export const inject = ['credentials', 'deepseekAccount', 'sessionQuery', 'webServer']

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
          sendJson(res, {
            ok: true,
            ...(await readTodaySpend(ctx.get('sessionQuery'))),
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

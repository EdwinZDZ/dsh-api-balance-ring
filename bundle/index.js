/**
 * API Balance Ring · API 余额圆环 — Host half.
 *
 * A bundle Host half is an ordinary Node module loaded by the Cordis Loader —
 * not a sandboxed function body — so this file uses the platform's global
 * `fetch` and plain imports of nothing at all. That is what makes it portable
 * by construction: Node's fetch is identical on macOS and Windows, so there is
 * no shell to pick, no `curl` vs `curl.exe`, and no PowerShell/bsh dialect to
 * branch on.
 *
 * The browser half cannot reach `harness.handle` / `host.call` — those belong
 * to a *dynamic* package's halves, and a bundle Client module's `require`
 * resolves only the platform seed words (`react`, `@deepseek-ai/cordis`,
 * `@deepseek-ai/dsh-client-ui-slots`, …). So the two halves talk over the
 * Harness web server instead, the same channel the shipped HMR client uses:
 * this file registers two exact routes and the Client fetches them.
 *
 *   GET <balance-path>  → the real DeepSeek account balance from the official
 *                         /user/balance endpoint, authenticated with the stored
 *                         DEEPSEEK_API_KEY credential.
 *   GET <usage-path>    → today's real usage aggregated from every session log:
 *                         request count, total tokens, and estimated cost priced
 *                         per model and per request time (peak/off-peak aware).
 */

// ── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  // Credential (POSIX-style environment-variable name) holding the API key.
  credentialRef: 'DEEPSEEK_API_KEY',
  // Official balance endpoint.
  balanceEndpoint: 'https://api.deepseek.com/user/balance',
  // USD→CNY rate used to convert the USD-denominated cost into ¥.
  usdCnyRate: 6.76,
  // Only requests routed through this provider consume the DeepSeek balance;
  // usage from other providers (e.g. an Aliyun pi-ai model) is excluded.
  provider: 'deepseek-official',
  // Namespaced route paths the browser half fetches. `exact` match, so they
  // cannot shadow the SPA routes.
  balancePath: '/__dsh-api-balance-ring/balance',
  usagePath: '/__dsh-api-balance-ring/usage',
  requestTimeoutMs: 12000,
}

// Official DeepSeek pricing, USD per 1M tokens (https://api-docs.deepseek.com/quick_start/pricing).
// `flat` applies until the peak/off-peak schedule starts; afterwards a request
// is priced by its own UTC hour (peak 01–04 and 06–10, off-peak at half).
const PRICING_EFFECTIVE = Date.UTC(2026, 7, 16, 16)
const PRICING = {
  'deepseek-v4-flash': {
    flat: { cacheHit: 0.0028, input: 0.14, output: 0.28 },
    offPeak: { cacheHit: 0.007, input: 0.22, output: 0.66 },
    peak: { cacheHit: 0.014, input: 0.44, output: 1.32 },
  },
  'deepseek-v4-pro': {
    flat: { cacheHit: 0.003625, input: 0.435, output: 0.87 },
    offPeak: { cacheHit: 0.022, input: 0.66, output: 1.98 },
    peak: { cacheHit: 0.044, input: 1.32, output: 3.96 },
  },
}

/**
 * Select the rate for one request by model and request time.
 * @param {string} model - model id recorded on the request header.
 * @param {number} timeMs - request timestamp.
 * @returns {{cacheHit:number,input:number,output:number}|null} the rate, or null when the model is unpriced.
 */
const priceFor = (model, timeMs) => {
  const p = PRICING[model]
  if (p === undefined) return null
  if (timeMs < PRICING_EFFECTIVE) return p.flat
  const h = new Date(timeMs).getUTCHours()
  const peak = (h >= 1 && h < 4) || (h >= 6 && h < 10)
  return peak ? p.peak : p.offPeak
}

// ── Balance ──────────────────────────────────────────────────────────────────

/**
 * Read the DeepSeek API key from the Harness credential store.
 * @param {object} credentials - the `credentials` Cordis service.
 * @returns {Promise<string>} the API key; never empty on success.
 */
async function readApiKey(credentials) {
  const cred = await credentials.resolve(CONFIG.credentialRef)
  const key = cred !== undefined && cred !== null && typeof cred.value === 'string' ? cred.value : ''
  if (key === '') {
    throw new Error(`DeepSeek API key is missing (store "${CONFIG.credentialRef}" in the Models page)`)
  }
  return key
}

/**
 * Fetch the live DeepSeek balance for the configured API key.
 * @param {object} credentials - the `credentials` Cordis service.
 * @returns {Promise<{balance:number,currency:string,isAvailable:boolean}>}
 */
async function readBalance(credentials) {
  const key = await readApiKey(credentials)
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
    isAvailable: parsed.is_available === true,
  }
}

// ── Today's usage ────────────────────────────────────────────────────────────

/**
 * Aggregate today's real usage from every session log. Each request is priced
 * by the model recorded in the most recent request/header event, so switching
 * between deepseek-v4-flash and deepseek-v4-pro — or between providers —
 * mid-session stays correct.
 * @param {object} sessionQuery - the `sessionQuery` Cordis service.
 * @returns {Promise<{requests:number,tokens:number,costCny:number,unpriced:boolean}>}
 */
async function readTodayUsage(sessionQuery) {
  const sessions = await sessionQuery.listSessions()
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  let requests = 0
  let input = 0
  let output = 0
  let cache = 0
  let usd = 0
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
        if (provider !== CONFIG.provider) continue
        const usage = ev.data && ev.data.usage
        if (usage === undefined) continue
        requests += 1
        input += usage.inputTokens || 0
        output += usage.outputTokens || 0
        cache += usage.cacheReadTokens || 0
        const p = priceFor(model, ev.time)
        if (p === null) {
          unpriced = true
        } else {
          usd += ((usage.cacheReadTokens || 0) / 1e6) * p.cacheHit
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
    costCny: Math.round(usd * CONFIG.usdCnyRate * 100) / 100,
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
  const text = JSON.stringify(payload)
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(text)
}

/**
 * Wrap one handler so a throw becomes `{ ok: false, error }`.
 * @param {() => Promise<object>} run - the payload producer.
 * @returns {Promise<object>} the response payload.
 */
async function guard(run) {
  try {
    return { ok: true, ...(await run()) }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) }
  }
}

// ── Plugin ───────────────────────────────────────────────────────────────────

// Declared up front so the plugin parks instead of throwing in a profile that
// lacks one of these services.
export const inject = ['credentials', 'sessionQuery', 'webServer']

/**
 * Register the two read-only routes the browser half fetches.
 * @param {object} ctx - Cordis context.
 */
export function apply(ctx) {
  const credentials = ctx.get('credentials')
  const sessionQuery = ctx.get('sessionQuery')
  const webServer = ctx.get('webServer')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: CONFIG.balancePath,
    handler: (req, res) => {
      void guard(async () => {
        const balance = await readBalance(credentials)
        return { ...balance, updatedAtText: new Date().toLocaleTimeString('zh-CN', { hour12: false }) }
      }).then((payload) => sendJson(res, payload))
    },
  }), 'api-balance-ring: balance route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: CONFIG.usagePath,
    handler: (req, res) => {
      void guard(() => readTodayUsage(sessionQuery)).then((payload) => sendJson(res, payload))
    },
  }), 'api-balance-ring: usage route')
}

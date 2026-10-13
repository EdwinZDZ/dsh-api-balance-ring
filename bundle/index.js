/**
 * API Balance Ring · API 余额圆环 — Host half (Xiaomi MiMo).
 *
 * A bundle Host half is an ordinary Node module loaded by the Cordis Loader —
 * not a sandboxed function body — so this file uses the platform's global
 * `fetch` and no shell at all. That is what makes it portable by construction:
 * Node's fetch is identical on macOS and Windows.
 *
 * The browser half cannot reach `harness.handle` / `host.call` — those belong
 * to a *dynamic* package's halves, and a bundle Client module's `require`
 * resolves only the platform seed words (`react`, `@deepseek-ai/cordis`,
 * `@deepseek-ai/dsh-client-ui-slots`, …). So the two halves talk over the
 * Harness web server instead, the same channel the shipped HMR client uses.
 *
 * WHAT THE RING SHOWS, AND WHY IT IS NOT A BALANCE
 * ------------------------------------------------
 * Xiaomi MiMo bills an ordinary API key against the account's prepaid balance,
 * but the platform publishes NO balance-query API. Verified two ways:
 *
 *   * the docs (https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go) describe
 *     token billing and link a *web console* balance page;
 *   * GET /v1/models answers 200 with the key, while /v1/balance,
 *     /v1/account/balance, /v1/dashboard/billing/subscription,
 *     /v1/credit/grants and /v1/user/balance all answer 404.
 *
 * So a live balance figure cannot be fetched. The ring instead shows today's
 * spend against a daily budget — `◯8%` means 8% of today's budget is burned —
 * which is computable from the session logs alone and needs no external call.
 *
 * PRICING IS DENOMINATED IN CNY. The official domestic rate card is
 * 元 / 1M tokens (https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go), so no
 * USD→CNY conversion is applied and there is no exchange-rate drift.
 */

// ── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  // Only requests routed through these providers spend the MiMo balance.
  providers: ['xiaomi'],
  // Daily budget the ring measures today's spend against, in ¥.
  dailyBudgetCny: 50,
  // Where the account balance can be read by a human (no API exists).
  balanceConsoleUrl: 'https://platform.xiaomimimo.com/console/balance',
  // Namespaced route path the browser half fetches. `exact` match, so it
  // cannot shadow the SPA routes.
  statsPath: '/__dsh-api-balance-ring/stats',
}

/**
 * Official Xiaomi MiMo domestic pricing, CNY per 1M tokens.
 * Source: https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go (实时推理行).
 *
 *   `cacheHit` — prompt-cache hit input
 *   `input`    — non-cached input
 *   `output`   — output
 *
 * Cache writes are free for now ("缓存写入：限时免费") and are therefore not
 * priced. Batch inference is half price but session logs carry no batch marker,
 * so every request is priced at the real-time rate — an over-count only for
 * batch traffic, which this harness does not produce.
 */
const PRICING = {
  'mimo-v2.6-flash': { cacheHit: 0.02, input: 1.0, output: 2.0 },
  'mimo-v2.5': { cacheHit: 0.02, input: 1.0, output: 2.0 },
  'mimo-v2.6-pro': { cacheHit: 0.025, input: 3.0, output: 6.0 },
  'mimo-v2.5-pro': { cacheHit: 0.025, input: 3.0, output: 6.0 },
  'mimo-v2.6-pro-ultraspeed': { cacheHit: 0.25, input: 30.0, output: 60.0 },
}

/**
 * Select the rate for one request by model.
 * @param {string} model - model id recorded on the request header.
 * @returns {{cacheHit:number,input:number,output:number}|null} the rate, or null when the model is unpriced.
 */
const priceFor = (model) => PRICING[model] ?? null

// ── Today's usage ────────────────────────────────────────────────────────────

/**
 * Aggregate today's real usage from every session log. Each request is priced
 * with the rate recorded in the most recent request/header event, so switching
 * between mimo-v2.6-flash and mimo-v2.6-pro mid-session stays correct.
 * @param {object} sessionQuery - the `sessionQuery` Cordis service.
 * @returns {Promise<{requests:number,tokens:number,costCny:number,unpriced:boolean,models:Record<string,number>}>}
 */
async function readTodayUsage(sessionQuery) {
  const sessions = await sessionQuery.listSessions()
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  let requests = 0
  let input = 0
  let output = 0
  let cache = 0
  let cny = 0
  let unpriced = false
  const models = {}

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
        models[model] = (models[model] || 0) + 1
        const p = priceFor(model)
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
    models,
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
// lacks one of these services. No credential is needed: nothing is fetched from
// an external API, because MiMo publishes no balance endpoint.
export const inject = ['sessionQuery', 'webServer']

/**
 * Register the one read-only route the browser half fetches.
 * @param {object} ctx - Cordis context.
 */
export function apply(ctx) {
  const sessionQuery = ctx.get('sessionQuery')
  const webServer = ctx.get('webServer')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: CONFIG.statsPath,
    handler: (req, res) => {
      void (async () => {
        try {
          const usage = await readTodayUsage(sessionQuery)
          sendJson(res, {
            ok: true,
            ...usage,
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

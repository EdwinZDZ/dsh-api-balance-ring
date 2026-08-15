/* ============================================================================
 * API Balance Ring · API 余额圆环 — Host half
 *
 * Runs inside the DeepSeek Harness host process. Exposes two package-private
 * JSON-RPC methods the browser ring calls:
 *
 *   api-balance      → the real DeepSeek account balance (via the official
 *                      /user/balance endpoint, authenticated with your stored
 *                      DEEPSEEK_API_KEY credential).
 *   api-usage-today  → today's real usage aggregated from every session log:
 *                      request count, total tokens and the estimated cost,
 *                      priced per model with the official deepseek-v4-flash /
 *                      deepseek-v4-pro rates (peak/off-peak aware).
 *
 * Paste this whole file into the "Host code" field of the plugin editor in
 * the DeepSeek Harness web UI (Developer → Dynamic Plugin → New).
 * ========================================================================== */

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

const priceFor = (model, timeMs) => {
  const p = PRICING[model]
  if (p === undefined) return null
  if (timeMs < PRICING_EFFECTIVE) return p.flat
  const h = new Date(timeMs).getUTCHours()
  const peak = (h >= 1 && h < 4) || (h >= 6 && h < 10)
  return peak ? p.peak : p.offPeak
}

// ── Plugin ───────────────────────────────────────────────────────────────────

return {
  apply(ctx) {
    // The current DeepSeek account balance from the official endpoint.
    harness.handle('api-balance', async () => {
      const credentials = ctx.get('credentials')
      const shell = ctx.get('shell')
      if (credentials === undefined || shell === undefined) {
        return { ok: false, error: 'runtime lacks credentials/shell services' }
      }
      try {
        const cred = await credentials.resolve(CONFIG.credentialRef)
        if (cred === undefined || cred.value === '') {
          return { ok: false, error: `credential ${CONFIG.credentialRef} is not configured` }
        }
        const spec = shell.resolve({
          command: `curl -sS --max-time 10 ${CONFIG.balanceEndpoint} -H "Authorization: Bearer $${CONFIG.credentialRef}"`,
          env: { [CONFIG.credentialRef]: cred.value },
          timeoutMs: 15000,
          stdoutMaxBytes: 8192,
        })
        const result = await shell.run(spec)
        if (result.exitCode !== 0) {
          return { ok: false, error: `curl failed (exit ${String(result.exitCode)}): ${result.stderr.text.slice(0, 160)}` }
        }
        const data = JSON.parse(result.stdout.text)
        const info = Array.isArray(data.balance_infos) ? data.balance_infos[0] : undefined
        if (info === undefined || typeof info.total_balance !== 'string') {
          return { ok: false, error: 'balance endpoint returned an unexpected payload' }
        }
        return {
          ok: true,
          balance: Number(info.total_balance),
          currency: typeof info.currency === 'string' ? info.currency : 'CNY',
          isAvailable: data.is_available === true,
          updatedAtText: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        }
      } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) }
      }
    })

    // Today's real usage aggregated from every session log. Each request is
    // priced by the model recorded in the most recent request/header event, so
    // switching between deepseek-v4-flash and deepseek-v4-pro — or between
    // providers — mid-session stays correct.
    harness.handle('api-usage-today', async () => {
      const sessionQuery = ctx.get('sessionQuery')
      if (sessionQuery === undefined) {
        return { ok: false, error: 'runtime lacks sessionQuery service' }
      }
      try {
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
          ok: true,
          requests,
          tokens: input + output + cache,
          costCny: Math.round(usd * CONFIG.usdCnyRate * 100) / 100,
          unpriced,
        }
      } catch (err) {
        return { ok: false, error: String(err && err.message ? err.message : err) }
      }
    })
  },
}

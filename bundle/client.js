/* ============================================================================
 * API Balance Ring · API 余额圆环 — Client half.
 *
 * A bundle Client half is a lazy browser module: `window.__ModuleLoader__.load`
 * registers a factory whose id equals the package name, and `require` resolves
 * the platform seed words (`react`, `@deepseek-ai/cordis`,
 * `@deepseek-ai/dsh-client-ui-slots`, …). `host` is NOT among them — that
 * binding belongs to a *dynamic* package's Client half — so the data is read
 * over the Harness web server routes the Host half registered, the same channel
 * the shipped HMR client uses.
 *
 * The ring renders in the composer's ambient row, immediately to the RIGHT of
 * the built-in context-occupancy ring, so the two read as `◯6% ◯8%`.
 *
 * GEOMETRY AND TOKENS are copied verbatim from the shipped `ContextMeter`
 * (`dsh-client-ui-conversation/src/client/skeleton/ContextMeter.module.css`):
 * 14px viewBox, 2px stroke, r=5.5, and only `--dsw-alias-*` / `--dsw-specific-*`
 * theme tokens. Renamed under the `dsb-` prefix so nothing collides, and no
 * Harness Client package is imported (a throwing component would blank the slot).
 *
 * PLACEMENT — why `order: 1` on the root:
 *   `conversation.composer.dock` and the built-in `ContextMeter` are siblings in
 *   one flex row (`InputBar`'s `.dock`: `display:flex; gap:12px`). The dock's
 *   entries always render BEFORE the meter and there is no seat after it, so the
 *   root sets `order: 1` to move past the meter's implicit `order: 0`. That is a
 *   style on our own element; no host DOM is touched.
 * ========================================================================== */

window.__ModuleLoader__.load({
  id: '@local/dsh-api-balance-ring',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // ── Configuration ────────────────────────────────────────────────────────

    const CONFIG = {
      referenceBalance: 50, // ¥50 = a full ring and a full bar
      refreshMs: 60000,     // background refresh interval
      warnBelow: 5,         // balance below this turns the ring amber
      dangerBelow: 1,       // balance below this turns the ring red
      tooltipDelayMs: 200,  // hover delay before the tooltip appears
      // Must match CONFIG.balancePath / CONFIG.usagePath in ../index.js.
      balancePath: '/__dsh-api-balance-ring/balance',
      usagePath: '/__dsh-api-balance-ring/usage',
    }

    // Ring geometry mirrors the shipped context-occupancy meter (14px viewBox,
    // 2px stroke, r=5.5).
    const RADIUS = 5.5
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS

    const CSS = `
.dsb-root { position: relative; flex: none; display: inline-flex; order: 1; }
.dsb-trigger { border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-tertiary); font-family: inherit; font-size: var(--dsh-content-font-size-secondary, 13px); font-variant-numeric: tabular-nums; line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px)); white-space: nowrap; cursor: pointer; background: 0 0; border: none; flex: none; align-items: center; gap: 6px; padding: 1px 8px; display: inline-flex; }
.dsb-trigger:hover, .dsb-trigger[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.dsb-trigger:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
.dsb-track { fill: none; stroke: var(--dsw-alias-border-l3); stroke-width: 2px; }
.dsb-fill { fill: none; stroke-width: 2px; stroke-linecap: round; }
.dsb-tip { position: absolute; bottom: calc(100% + 8px); right: 0; z-index: 1100; width: max-content; max-width: 50vw; padding: 3px 8px; border-radius: var(--dsw-radius-md); background: var(--dsw-specific-menu); box-shadow: var(--dsw-elevation-panel); border: .5px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; white-space: nowrap; pointer-events: none; }
.dsb-panel { position: absolute; bottom: calc(100% + 8px); right: 0; z-index: 1100; box-sizing: border-box; width: min(264px, 100vw - 24px); padding: 12px; border: 0; border-radius: var(--dsw-radius-lg); background: var(--dsw-specific-menu); backdrop-filter: var(--dsw-menu-backdrop-filter); box-shadow: var(--dsw-elevation-prominent); font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary); cursor: default; }
.dsb-header { display: flex; align-items: center; gap: 6px; }
.dsb-title { color: var(--dsw-alias-label-tertiary); }
.dsb-amount { font-weight: 500; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dsb-figures { margin-left: auto; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
.dsb-bar { display: flex; gap: 1px; margin: 10px 0 12px; height: 4px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); overflow: hidden; }
.dsb-segment { flex: none; min-width: 2px; height: 100%; border-radius: 1px; }
.dsb-rows { margin: 0; }
.dsb-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 2px 0; }
.dsb-row dt { color: var(--dsw-alias-label-secondary); }
.dsb-row dd { margin: 0; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-primary); }
.dsb-swatch { display: inline-block; margin-right: 6px; width: 8px; height: 8px; border-radius: 2px; vertical-align: baseline; }
.dsb-swatch-money { background: var(--dsw-alias-state-success-primary); }
.dsb-swatch-reqs { background: var(--dsw-alias-state-business-primary); }
.dsb-swatch-toks { background: var(--dsw-static-blue-450); }
.dsb-error { color: var(--dsw-alias-state-error-primary); }
.dsb-error dd { color: var(--dsw-alias-state-error-primary); }
`

    /**
     * Read one Host route. A non-OK reply becomes `{ ok: false }` so the panel
     * reports a message instead of throwing.
     * @param {string} path - namespaced route path.
     * @returns {Promise<object>} the decoded payload.
     */
    async function callHost(path) {
      const response = await fetch(path, { cache: 'no-store' })
      if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
      return await response.json()
    }

    function BalanceRing() {
      const [balance, setBalance] = React.useState(null)
      const [usage, setUsage] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [tip, setTip] = React.useState(false)
      const rootRef = React.useRef(null)
      const tipTimer = React.useRef(null)

      const refresh = React.useCallback(() => {
        callHost(CONFIG.balancePath).then(setBalance).catch(() => {
          setBalance({ ok: false, error: '余额查询失败' })
        })
        callHost(CONFIG.usagePath).then(setUsage).catch(() => {
          setUsage({ ok: false, error: '用量查询失败' })
        })
      }, [])

      // Fetch on mount, then keep the numbers fresh on a timer. The browser's
      // own timers are used and cleared here: a bundle Client module has no
      // `timer` service to inject.
      React.useEffect(() => {
        void refresh()
        const id = setInterval(() => { void refresh() }, CONFIG.refreshMs)
        return () => clearInterval(id)
      }, [refresh])

      // Dispose a pending tooltip delay with the component.
      React.useEffect(() => () => {
        if (tipTimer.current !== null) { clearTimeout(tipTimer.current); tipTimer.current = null }
      }, [])

      // Outside click / Escape close.
      React.useEffect(() => {
        if (!open) return
        const onPointerDown = (e) => {
          if (e.target instanceof Node && rootRef.current !== null && rootRef.current.contains(e.target)) return
          setOpen(false)
        }
        const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false) }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown)
          document.removeEventListener('keydown', onKeyDown)
        }
      }, [open])

      // Render nothing until the first balance arrives (same posture as the
      // built-in context meter, so the ring pops in rather than flashing).
      if (balance === null) return null

      const ok = balance.ok === true
      const bal = ok ? Number(balance.balance) : 0
      const currency = ok && typeof balance.currency === 'string' ? balance.currency : 'CNY'
      const symbol = currency === 'CNY' ? '￥' : (currency === 'USD' ? '$' : currency + ' ')
      const money = (v) => symbol + v.toFixed(2)
      const percent = Math.max(0, Math.min(100, (bal / CONFIG.referenceBalance) * 100))
      const health = !ok || bal >= CONFIG.warnBelow ? 'ok'
        : bal >= CONFIG.dangerBelow ? 'warn' : 'error'
      const healthColor = health === 'ok' ? 'var(--dsw-alias-state-success-primary)'
        : health === 'warn' ? 'var(--dsw-alias-state-warn-primary)'
        : 'var(--dsw-alias-state-error-primary)'
      // The inline reading mirrors the context meter's `NN%`, so the two rings
      // sit side by side as `◯6% ◯8%`.
      const reading = ok ? `${Math.round(percent)}%` : '--'
      const label = ok ? `API余额${money(bal)}` : 'API余额获取失败'

      const showTip = () => {
        if (open) return
        if (tipTimer.current !== null) { clearTimeout(tipTimer.current); tipTimer.current = null }
        tipTimer.current = setTimeout(() => { tipTimer.current = null; setTip(true) }, CONFIG.tooltipDelayMs)
      }
      const hideTip = () => {
        if (tipTimer.current !== null) { clearTimeout(tipTimer.current); tipTimer.current = null }
        setTip(false)
      }
      const toggle = () => {
        setOpen(!open)
        setTip(false)
        if (!open) void refresh()
      }

      const ring = h('svg', { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true },
        h('circle', { className: 'dsb-track', cx: 7, cy: 7, r: RADIUS }),
        h('circle', {
          className: 'dsb-fill', cx: 7, cy: 7, r: RADIUS,
          strokeDasharray: `${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`,
          transform: 'rotate(-90 7 7)',
          style: { stroke: healthColor },
        }),
      )

      const button = h('button', {
        type: 'button',
        className: 'dsb-trigger',
        'aria-label': label,
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        onClick: toggle,
        onMouseEnter: showTip,
        onMouseLeave: hideTip,
      }, ring, h('span', null, reading))

      const usageOk = usage !== null && usage.ok === true
      const swatch = (cls) => h('span', { className: `dsb-swatch ${cls}`, 'aria-hidden': true })
      const todayRows = [
        h('div', { key: 'cost', className: 'dsb-row' },
          h('dt', null, swatch('dsb-swatch-money'), '今日消费金额'),
          h('dd', null, usageOk ? (usage.unpriced === true ? '~' : '') + money(Number(usage.costCny)) : '--'),
        ),
        h('div', { key: 'reqs', className: 'dsb-row' },
          h('dt', null, swatch('dsb-swatch-reqs'), '今日API请求次数'),
          h('dd', null, usageOk ? String(usage.requests) : '--'),
        ),
        h('div', { key: 'toks', className: 'dsb-row' },
          h('dt', null, swatch('dsb-swatch-toks'), '今日消耗Tokens'),
          h('dd', null, usageOk ? Number(usage.tokens).toLocaleString('zh-CN') : '--'),
        ),
      ]

      let panel = null
      if (open) {
        const rows = ok
          ? todayRows
          : [
            h('div', { key: 'err', className: 'dsb-row dsb-error' },
              h('dt', null, '查询失败'),
              h('dd', null, typeof balance.error === 'string' ? balance.error : '未知错误'),
            ),
            ...todayRows,
          ]
        panel = h('div', { className: 'dsb-panel', role: 'dialog', 'aria-label': 'API余额' },
          h('div', { className: 'dsb-header' },
            h('span', { className: 'dsb-title' }, 'API余额'),
            h('span', { className: 'dsb-amount' }, ok ? money(bal) : '--'),
            h('span', { className: 'dsb-figures' }, ok && typeof balance.updatedAtText === 'string' ? `更新 ${balance.updatedAtText}` : ''),
          ),
          h('div', { className: 'dsb-bar' },
            h('div', { className: 'dsb-segment', style: { width: `${percent}%`, background: healthColor } }),
          ),
          h('dl', { className: 'dsb-rows' }, rows),
        )
      }

      const tooltip = tip && !open ? h('div', { className: 'dsb-tip', role: 'tooltip' }, label) : null

      return h('span', {
        ref: rootRef,
        className: 'dsb-root',
        onBlur: (e) => { if (e.relatedTarget === null || !e.currentTarget.contains(e.relatedTarget)) setOpen(false) },
        onKeyDown: (e) => { if (e.key === 'Escape') setOpen(false) },
      },
        // Component-local stylesheet: it unmounts with the entry, so nothing is
        // left behind when the plugin unloads.
        h('style', null, CSS),
        button, tooltip, panel,
      )
    }

    return {
      // `slots` must be declared here or `ctx.slots` is not granted.
      inject: ['slots'],
      apply(ctx) {
        // `order` places this entry last among the dock's own entries; the
        // root's `order: 1` then carries it past the built-in ContextMeter.
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'api-balance-ring',
          order: 100,
          label: 'API余额',
        }, BalanceRing))
      },
    }
  },
})

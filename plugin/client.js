/* ============================================================================
 * API Balance Ring · API 余额圆环 — Client half
 *
 * Runs in the browser page of the DeepSeek Harness web UI. Renders a small
 * progress ring in the composer tool row, right of the model select and left
 * of the send button — the same seat and geometry as the built-in
 * context-occupancy meter (contextPressure ring).
 *
 *   Hover  → tooltip with the live balance ("API余额￥6.45").
 *   Click  → panel with the balance, a ¥50-fill progress bar, and today's
 *            spend / request count / token count, refreshed every minute.
 *
 * Paste this whole file into the "Client code" field of the plugin editor in
 * the DeepSeek Harness web UI (Developer → Dynamic Plugin → New).
 * ========================================================================== */

// ── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  referenceBalance: 50, // ¥50 = a full ring and a full bar
  refreshMs: 60000,     // background refresh interval
  warnBelow: 5,         // balance below this turns the ring amber
  dangerBelow: 1,       // balance below this turns the ring red
  tooltipDelayMs: 200,  // hover delay before the tooltip appears
}

// Ring geometry mirrors the shipped context-occupancy meter (14px viewBox,
// 2px stroke, 28px circular hit target).
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

// ── Plugin ───────────────────────────────────────────────────────────────────

return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    styles.insert(`
.dsb-root { position: relative; display: inline-flex; }
.dsb-trigger { display: grid; place-items: center; flex: none; width: 28px; height: 28px; padding: 0; border: none; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsb-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsb-track { fill: none; stroke: var(--dsw-alias-border-l3); stroke-width: 2; }
.dsb-fill { fill: none; stroke-width: 2; stroke-linecap: round; }
.dsb-tooltip { position: absolute; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%); z-index: 100; width: max-content; max-width: 50vw; padding: 3px 7px; border-radius: 8px; background: var(--dsw-alias-tooltip-bg); color: var(--dsw-static-neutral-bluish-00); font-size: 13px; line-height: 20px; white-space: nowrap; pointer-events: none; animation: dsb-tip-in 150ms var(--ds-ease-in-out); }
@keyframes dsb-tip-in { from { opacity: 0; } }
.dsb-panel { position: absolute; bottom: calc(100% + 8px); right: 0; z-index: 100; box-sizing: border-box; width: 264px; padding: 12px; border: 1px solid var(--dsw-alias-border-inverted); border-radius: 12px; background: var(--dsw-specific-menu); box-shadow: var(--dsw-shadow-lv3); font-size: 12px; line-height: 20px; color: var(--dsw-alias-label-secondary); cursor: default; }
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
.dsb-swatch-reqs { background: rgb(167, 139, 250); }
.dsb-swatch-toks { background: var(--dsw-static-blue-450); }
.dsb-error { color: var(--dsw-alias-state-error-primary); }
.dsb-error dd { color: var(--dsw-alias-state-error-primary); }
`)

    function BalanceRing() {
      const [balance, setBalance] = React.useState(null)
      const [usage, setUsage] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [tip, setTip] = React.useState(false)
      const tipTimer = React.useRef(null)

      const refresh = React.useCallback(() => {
        host.call('api-balance').then((result) => {
          setBalance(result)
        }).catch(() => {
          setBalance({ ok: false, error: '余额查询失败' })
        })
        host.call('api-usage-today').then((result) => {
          setUsage(result)
        }).catch(() => {
          setUsage({ ok: false, error: '用量查询失败' })
        })
      }, [])

      // Fetch on mount, then keep the numbers fresh on a timer.
      React.useEffect(() => {
        void refresh()
        return ctx.interval(() => { void refresh() }, CONFIG.refreshMs)
      }, [refresh])

      // Dispose a pending tooltip delay with the component.
      React.useEffect(() => () => {
        if (tipTimer.current !== null) { tipTimer.current(); tipTimer.current = null }
      }, [])

      // Outside click / Escape close. `document` may not exist in every
      // evaluator, so blur-based close stays as the fallback.
      React.useEffect(() => {
        if (!open) return
        const doc = typeof document !== 'undefined' ? document : null
        if (doc === null) return
        const onPointerDown = (e) => {
          if (e.target instanceof Node && rootRef.current !== null && rootRef.current.contains(e.target)) return
          setOpen(false)
        }
        const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false) }
        doc.addEventListener('pointerdown', onPointerDown)
        doc.addEventListener('keydown', onKeyDown)
        return () => {
          doc.removeEventListener('pointerdown', onPointerDown)
          doc.removeEventListener('keydown', onKeyDown)
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
      const label = ok ? `API余额${money(bal)}` : 'API余额获取失败'

      const showTip = () => {
        if (open) return
        if (tipTimer.current !== null) { tipTimer.current(); tipTimer.current = null }
        tipTimer.current = ctx.timeout(() => { tipTimer.current = null; setTip(true) }, CONFIG.tooltipDelayMs)
      }
      const hideTip = () => {
        if (tipTimer.current !== null) { tipTimer.current(); tipTimer.current = null }
        setTip(false)
      }
      const toggle = () => {
        setOpen(!open)
        setTip(false)
        if (!open) void refresh()
      }

      const ring = React.createElement('svg', { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true },
        React.createElement('circle', { className: 'dsb-track', cx: 7, cy: 7, r: RADIUS }),
        React.createElement('circle', {
          className: 'dsb-fill', cx: 7, cy: 7, r: RADIUS,
          strokeDasharray: `${(CIRCUMFERENCE * percent) / 100} ${CIRCUMFERENCE}`,
          transform: 'rotate(-90 7 7)',
          style: { stroke: healthColor },
        }),
      )

      const button = React.createElement('button', {
        type: 'button',
        className: 'dsb-trigger',
        'aria-label': label,
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        onClick: toggle,
        onMouseEnter: showTip,
        onMouseLeave: hideTip,
      }, ring)

      const usageOk = usage !== null && usage.ok === true
      const swatch = (cls) => React.createElement('span', { className: `dsb-swatch ${cls}`, 'aria-hidden': true })
      const todayRows = [
        React.createElement('div', { key: 'cost', className: 'dsb-row' },
          React.createElement('dt', null, swatch('dsb-swatch-money'), '今日消费金额'),
          React.createElement('dd', null, usageOk ? (usage.unpriced === true ? '~' : '') + money(Number(usage.costCny)) : '--'),
        ),
        React.createElement('div', { key: 'reqs', className: 'dsb-row' },
          React.createElement('dt', null, swatch('dsb-swatch-reqs'), '今日API请求次数'),
          React.createElement('dd', null, usageOk ? String(usage.requests) : '--'),
        ),
        React.createElement('div', { key: 'toks', className: 'dsb-row' },
          React.createElement('dt', null, swatch('dsb-swatch-toks'), '今日消耗Tokens'),
          React.createElement('dd', null, usageOk ? Number(usage.tokens).toLocaleString('zh-CN') : '--'),
        ),
      ]

      let panel = null
      if (open) {
        const rows = ok
          ? todayRows
          : [
            React.createElement('div', { key: 'err', className: 'dsb-row dsb-error' },
              React.createElement('dt', null, '查询失败'),
              React.createElement('dd', null, typeof balance.error === 'string' ? balance.error : '未知错误'),
            ),
            ...todayRows,
          ]
        panel = React.createElement('div', { className: 'dsb-panel', role: 'dialog', 'aria-label': 'API余额' },
          React.createElement('div', { className: 'dsb-header' },
            React.createElement('span', { className: 'dsb-title' }, 'API余额'),
            React.createElement('span', { className: 'dsb-amount' }, ok ? money(bal) : '--'),
            React.createElement('span', { className: 'dsb-figures' }, ok && typeof balance.updatedAtText === 'string' ? `更新 ${balance.updatedAtText}` : ''),
          ),
          React.createElement('div', { className: 'dsb-bar' },
            React.createElement('div', { className: 'dsb-segment', style: { width: `${percent}%`, background: healthColor } }),
          ),
          React.createElement('dl', { className: 'dsb-rows' }, rows),
        )
      }

      const tooltip = tip && !open
        ? React.createElement('div', { className: 'dsb-tooltip', role: 'tooltip' }, label)
        : null

      return React.createElement('span', {
        className: 'dsb-root',
        onBlur: (e) => { if (e.relatedTarget === null || !e.currentTarget.contains(e.relatedTarget)) setOpen(false) },
        onKeyDown: (e) => { if (e.key === 'Escape') setOpen(false) },
      }, button, tooltip, panel)
    }

    slots.inject('conversation.input.right', () => slots.register(
      { name: 'conversation.input.right', id: 'api-balance-ring' },
      () => React.createElement(BalanceRing, null),
    ))
  },
}

# API Balance Ring · API 余额圆环

**A tiny, real-time DeepSeek API balance meter that lives inside the DeepSeek Harness composer.** Hover the ring for your live balance, click it for today's spend, request count and token consumption — priced per model, straight from your real session logs.

> 🇨🇳 [中文版 README](README.zh-CN.md)

![Demo](assets/demo.gif)

---

## ✨ Highlights

- **🔴 Live balance at a glance** — a progress ring sitting immediately to the **right of the built-in context-occupancy ring**, in the same ambient row below the composer, so the two read side by side as `◯6% ◯8%`. Same geometry and theme tokens as that meter. The arc shows your balance against a **¥50 full ring** and shifts green → amber → red as it drains.
- **🖱 Hover** — see `API余额￥6.45` the moment your cursor touches the ring.
- **📊 Click** — a breakdown panel with **today's spend, API request count and tokens consumed**, plus an updated-at timestamp. Refreshes every 60 seconds (and on every click).
- **🧮 Priced per model, not per day** — every request is priced with the official `deepseek-v4-flash` **or** `deepseek-v4-pro` rate recorded in your session log, so switching models mid-session stays accurate.
- **⏱ Peak / off-peak aware** — the official peak/off-peak pricing schedule (effective 2026-08-16) is built in and switches automatically by request time.
- **🔒 Provider-filtered** — only requests routed through `deepseek-official` count. Usage from other providers (e.g. an Aliyun pi-ai model) never pollutes your DeepSeek bill.
- **🎨 Native look & feel** — same slot, same geometry, same theme tokens as the shipped context-occupancy ring. Zero dependencies, pure JavaScript, no build step.

## 🖼 Screenshots

The three states — idle, hover, and the click-open panel:

![Idle · Hover · Panel](assets/hero-strip.png)

The breakdown panel up close:

![Panel](assets/panel.png)

## 🧩 How it works

```
┌───────────────────────────── Browser (bundle Client half) ──────────────────────┐
│  conversation.composer.dock slot (ambient row, right of the context ring)       │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  BalanceRing component                                                     │  │
│  │   ┌──────────────────────────────────────────┐   fetch('/__dsh-api-…/     │  │
│  │   │ ◯8% + tooltip + panel  ◀────────────────┼─────────────balance')     │  │
│  └───┴──────────────────────────────────────────┘                      │      │  │
└─────────────────────────────────────────────────────────────────────────┼──────┘
                                                                          │ HTTP
┌─────────────────────────────── Host process ────────────────────────────┼──────┐
│  webServer route /__dsh-api-balance-ring/balance  ◀──────────────────────┘      │
│    → GET https://api.deepseek.com/user/balance                                  │
│      (Authorization: Bearer <DEEPSEEK_API_KEY>, global fetch — no shell)        │
│                                                                                │
│  webServer route /__dsh-api-balance-ring/usage                                  │
│    → scan every session log (sessionQuery)                                      │
│      · count assistant/message events today                                     │
│      · sum input + output + cache tokens                                        │
│      · price each request by its model (request/header event) and UTC hour      │
└────────────────────────────────────────────────────────────────────────────────┘
```

## 📦 Installation

### Prerequisites

- **DeepSeek Harness** (the Web GUI) running locally.
- A **DeepSeek API key** stored as the `DEEPSEEK_API_KEY` credential — the harness's normal credential store (written from the Models page).

### Steps

The plugin is an installable **bundle**, so it is a real profile plugin rather than a session-local scratch plugin:

1. Clone this repository (or copy the [`bundle/`](bundle/) directory anywhere the harness can read).
2. Ask your agent to install it:
   > install the bundle at `<absolute path to>/bundle` with the plugin manager
3. The agent runs `plugin_manager` `install_bundle` with that absolute package directory as the target. That one call performs the package installation and the bundle selection — do not hand-edit the profile's `package.json` or `cordis.patch.yml`.

The ring appears in the ambient row below the composer, immediately to the right of the built-in context-occupancy ring (`◯6% ◯8%`), within a second.

### It shows up under 全局插件, enabled by default

`bundle/cordis.patch.yml` inserts exactly one plugin row at the **root** scope and never sets `disabled`, so after installation the plugin appears in **设置 → 内置插件 → 全局插件** and is **enabled on every launch by default** — no re-pasting, no re-enabling, and it survives a harness restart.

| | |
| --- | --- |
| Settings page | 设置 → 内置插件 → 全局插件 |
| Row id | `api-balance-ring` |
| Default state | enabled (nothing sets `disabled`) |
| Survives restart | yes |

## 🎯 Usage

| Action | Result |
| --- | --- |
| Hover the ring | Tooltip with the live balance, e.g. `API余额￥6.45` |
| Click the ring | Panel: balance + ¥50 progress bar + today's cost / requests / tokens |
| Click elsewhere / `Esc` | Panel closes |
| Automatic | Values refresh every 60 s; clicking the ring also refreshes immediately |

The ring arc = `balance ÷ ¥50` (full ring at ¥50). Color thresholds: **≥ ¥5 green**, **≥ ¥1 amber**, **< ¥1 red**.

## 🧮 Data & accuracy

| Stat | Source |
| --- | --- |
| Balance | Official `https://api.deepseek.com/user/balance` endpoint, authenticated with your stored `DEEPSEEK_API_KEY` |
| Requests / Tokens | Your own **session logs** — every `assistant/message` event carries the real API usage (`inputTokens`, `outputTokens`, `cacheReadTokens`) |
| Cost | Official per-model pricing × request time (flat now, peak/off-peak from 2026-08-16), converted at a fixed USD→CNY rate |

### Pricing table (USD per 1M tokens)

| Model | Cache-hit input | Cache-miss input | Output |
| --- | ---: | ---: | ---: |
| `deepseek-v4-flash` | $0.0028 | $0.14 | $0.28 |
| `deepseek-v4-pro` | $0.003625 | $0.435 | $0.87 |

From **2026-08-16 16:00 UTC**, peak hours (01–04 & 06–10 UTC) charge double the off-peak rates; the plugin selects the rate per request automatically.

### What counts

- ✅ Only requests with `provider === 'deepseek-official'` — those are the ones that spend your DeepSeek balance.
- ✅ Requests whose model is `deepseek-v4-flash` **or** `deepseek-v4-pro` are priced individually, so a mid-session model switch is billed correctly on both sides of the switch.
- ✅ "Today" is your local calendar day (00:00 → now).
- ⚠️ If a request used a model outside the pricing table, the cost shows a `~` prefix — the number is an under-count, never a silent wrong one.
- ⚠️ The USD→CNY rate is a fixed constant (`6.76`) — official pricing is USD-denominated, so the ¥ figure can drift by ~1% from the platform's own conversion.

## ⚙️ Configuration

Everything lives in the `CONFIG` block at the top of each file.

| Constant | File | Default | Meaning |
| --- | --- | --- | --- |
| `referenceBalance` | `bundle/client.js` | `50` | ¥ amount that fills the ring and the bar |
| `refreshMs` | `bundle/client.js` | `60000` | background refresh interval |
| `warnBelow` / `dangerBelow` | `bundle/client.js` | `5` / `1` | ring color thresholds (¥) |
| `tooltipDelayMs` | `bundle/client.js` | `200` | hover delay before the tooltip |
| `usdCnyRate` | `bundle/index.js` | `6.76` | USD→CNY conversion for the cost readout |
| `PRICING` | `bundle/index.js` | — | per-model rate table (add new models here) |
| `PRICING_EFFECTIVE` | `bundle/index.js` | `2026-08-16T16:00Z` | when peak/off-peak pricing starts |
| `balancePath` / `usagePath` | both | `/__dsh-api-balance-ring/…` | the two Host routes; the paths must match across the halves |

## ❓ FAQ

**Why does the panel show `~` before the cost?** A request ran with a model not in the pricing table (e.g. a brand-new release). Requests and tokens still count; the cost is marked approximate.

**Why is my "today" lower than the platform dashboard?** The plugin reads *your harness's* session logs. Usage from other tools or direct API calls is not in those logs, and small differences in the day boundary can shift the count by a couple of requests.

**Is my API key exposed?** No. The key is resolved from the harness credential store at runtime and exists only in the `Authorization` header of the outgoing request to DeepSeek. It is never written to disk, never placed in a command line, and never sent to the browser — the browser talks only to the local Host routes, which return balance figures, not credentials.

**Does it work with `deepseek-v4-pro`?** Yes — that's exactly why pricing is per request. Switch your default model in Settings and the cost readout follows immediately.

## 🖥 Compatibility — macOS & Windows

One pair of files runs on both platforms. Nothing here depends on which shell the harness resolved.

| Concern | How it is handled |
| --- | --- |
| HTTP request | the Host half is an ordinary Node module, so it uses the platform's global `fetch` — identical on macOS and Windows |
| Shelling out | never. There is no `curl`, no `curl.exe`, no `sh -c` vs `powershell -Command` branch to get wrong |
| Client → Host | two namespaced `webServer` routes fetched from the page, the same channel the shipped HMR client uses |
| Session-log aggregation | pure JavaScript over `sessionQuery` — identical on both platforms |
| Plugin installation | `plugin_manager` `install_bundle` — one call, profile-wide, restart-safe |

The earlier *dynamic-plugin* form shelled out to `curl` and had to branch on the platform. Converting the plugin to a **bundle** removed that whole layer: a bundle Host half runs as a normal Node module, so portability is structural rather than a table of special cases.

## 🚧 Known limitations

- The USD→CNY rate is a constant, not live-quoted.
- Usage is aggregated from session logs — it reflects the harness, not your whole API account.

## 🤝 Contributing

PRs are welcome! Ideas we'd love:

- Live USD→CNY rate via a lightweight quote fetch.
- A config UI (reference balance, thresholds) instead of code constants.

Please keep both halves dependency-free — `bundle/index.js` must import nothing, and `bundle/client.js` must stay a plain script that only uses the `require` seed words.

## 📄 License

[MIT](LICENSE) © EdwinZDZ

*Visual language (ring geometry, panel surface, tooltip plate) is adapted from the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) built-in context-occupancy meter, MIT licensed.*

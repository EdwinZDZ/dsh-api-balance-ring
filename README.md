# API Balance Ring · API 余额圆环

**A tiny, real-time DeepSeek API balance meter that lives inside the DeepSeek Harness composer.** Hover the ring for your live balance, click it for today's spend, request count and token consumption — priced per model, straight from your real session logs.

> 🇨🇳 [中文版 README](README.zh-CN.md)

![Demo](assets/demo.gif)

---

## ✨ Highlights

- **🔴 Live balance at a glance** — a progress ring right next to the send button, exactly like the built-in context meter. The arc shows your balance against a **¥50 full ring** and shifts green → amber → red as it drains.
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
┌───────────────────────────── Browser (Client half) ─────────────────────────────┐
│  conversation.input.right slot (composer, left of the send button)              │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  BalanceRing component                                                     │  │
│  │   ┌──────────────────────────────────────────┐    host.call('api-balance') │  │
│  │   │ ring + tooltip + panel  ◀───────────────┼──────────────────────┐      │  │
│  └───┴──────────────────────────────────────────┘                      │      │  │
└─────────────────────────────────────────────────────────────────────────┼──────┘
                                                                          │ JSON-RPC
┌─────────────────────────────── Host process ────────────────────────────┼──────┐
│                                                                          ▼      │
│  harness.handle('api-balance')      → GET https://api.deepseek.com/user/balance│
│                                        (Authorization: Bearer $DEEPSEEK_API_KEY)│
│                                                                                │
│  harness.handle('api-usage-today')  → scan every session log (sessionQuery)    │
│                                        · count assistant/message events today  │
│                                        · sum input + output + cache tokens     │
│                                        · price each request by its model       │
│                                          (request/header event) and UTC hour   │
└────────────────────────────────────────────────────────────────────────────────┘
```

## 📦 Installation

### Prerequisites

- **DeepSeek Harness** (the web GUI) running locally.
- A **DeepSeek API key** stored as the `DEEPSEEK_API_KEY` credential — the harness's normal credential store (`~/.dsh/.credentials.yaml` or environment).

### Steps

1. In the harness web UI, open **Developer → Dynamic Plugin → New**.
2. **Name**: `API Balance Ring` (anything you like).
3. **Host code**: paste the entire contents of [`plugin/host.js`](plugin/host.js).
4. **Client code**: paste the entire contents of [`plugin/client.js`](plugin/client.js).
5. Create the plugin, then **Run** it and approve the activation request in the UI.
6. The ring appears in the composer, left of the send button, within a second.

> The plugin is a *dynamic* plugin: it is process-local and disappears on restart. Re-create it after a restart, or copy the two files into your own agent preset if you want it always on.

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
| `referenceBalance` | `client.js` | `50` | ¥ amount that fills the ring and the bar |
| `refreshMs` | `client.js` | `60000` | background refresh interval |
| `warnBelow` / `dangerBelow` | `client.js` | `5` / `1` | ring color thresholds (¥) |
| `tooltipDelayMs` | `client.js` | `200` | hover delay before the tooltip |
| `usdCnyRate` | `host.js` | `6.76` | USD→CNY conversion for the cost readout |
| `PRICING` | `host.js` | — | per-model rate table (add new models here) |
| `PRICING_EFFECTIVE` | `host.js` | `2026-08-16T16:00Z` | when peak/off-peak pricing starts |

## ❓ FAQ

**Why does the panel show `~` before the cost?** A request ran with a model not in the pricing table (e.g. a brand-new release). Requests and tokens still count; the cost is marked approximate.

**Why is my "today" lower than the platform dashboard?** The plugin reads *your harness's* session logs. Usage from other tools or direct API calls is not in those logs, and small differences in the day boundary can shift the count by a couple of requests.

**Is my API key exposed?** No. The key is resolved from the harness credential store at runtime and only ever appears in the `Authorization` header of the balance request. Nothing is stored in this repo.

**Does it work with `deepseek-v4-pro`?** Yes — that's exactly why pricing is per request. Switch your default model in Settings and the cost readout follows immediately.

## 🚧 Known limitations

- Dynamic plugins are process-local; the ring needs to be re-created after a harness restart (see Installation).
- The USD→CNY rate is a constant, not live-quoted.
- Usage is aggregated from session logs — it reflects the harness, not your whole API account.

## 🤝 Contributing

PRs are welcome! Ideas we'd love:

- Live USD→CNY rate via a lightweight quote fetch.
- A config UI (reference balance, thresholds) instead of code constants.
- An installable *static* plugin bundle so the ring survives restarts without re-pasting.

Please keep the plugin halves dependency-free so they stay paste-able.

## 📄 License

[MIT](LICENSE) © EdwinZDZ

*Visual language (ring geometry, panel surface, tooltip plate) is adapted from the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) built-in context-occupancy meter, MIT licensed.*

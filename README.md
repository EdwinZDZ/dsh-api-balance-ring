# API Balance Ring · API 余额圆环

**A tiny, real-time meter that lives in the DeepSeek Harness composer, immediately to the right of the built-in context ring.** It reads whichever payment source you are actually on — a signed-in DSH account, a DeepSeek API key, or a third-party provider — and shows that balance as `◯6% ◯8%`. Hover for the number, click for the breakdown.

> 🇨🇳 [中文版 README](README.zh-CN.md)

![Demo](assets/demo.gif)

---

## ✨ Highlights

- **🎯 Right of the context ring** — rendered in the composer's ambient row, next to the built-in context-occupancy ring, so the two read side by side as `◯6% ◯8%`. Identical geometry (14px viewBox, r=5.5, 2px stroke) and the same theme tokens as that meter.
- **🔍 Follows the provider you are on** — the ring detects which payment source is actually in use and adapts. Switching model switches the ring with it.
- **🖱 Hover** — `API余额￥1.90` or `今日已消费￥5.02 / 预算￥50`, depending on the mode.
- **📊 Click** — a breakdown panel: the detected **付款方式**, the balance or spend, request count, token consumption, and a timestamp. Refreshes every 60 s (and on every click).
- **🧮 Priced per model at the official rates** — `mimo-v2.6-flash` / `mimo-v2.6-pro` / `mimo-v2.6-pro-ultraspeed`, CNY per 1M tokens, taken from each request's own `request/header` event so a mid-session model switch bills correctly on both sides.
- **💴 CNY native** — the official domestic rate card is 元 / 1M tokens, so costs are computed in ¥ directly. No USD→CNY conversion, no exchange-rate drift.
- **⚡ Cache-aware** — prompt-cache hits are billed at their own (much lower) rate, so long agentic sessions price correctly instead of being over-charged at the input rate.
- **🎨 Native look & feel** — same slot, same geometry, same theme tokens as the shipped context-occupancy ring. Zero dependencies, pure JavaScript, no build step.

## 🖼 Preview

> These are rendered illustrations of the three modes, **not screen captures**.
> A real capture is being recorded and will replace them.

The three payment modes the ring detects and adapts to — **账号登录** (balance), **API Key** (balance), and **第三方** (today's spend against a budget):

![Account · API key · third-party](assets/hero-strip.png)

The breakdown panels up close — note the **付款方式** row, which names the provider the ring is following:

![Balance panel · Spend panel](assets/panel.png)

## 🧩 How it works

```
┌───────────────────────────── Browser (bundle Client half) ──────────────────────┐
│  conversation.composer.dock slot (ambient row, right of the context ring)       │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  BalanceRing component                                                     │  │
│  │   ┌──────────────────────────────────┐      fetch('/__dsh-api-…/balance') │  │
│  │   │ ◯10% + tooltip + panel  ◀───────┼──────────────────────┐             │  │
│  └───┴──────────────────────────────────┘                      │             │  │
└─────────────────────────────────────────────────────────────────┼─────────────┘
                                                                  │ HTTP
┌─────────────────────────────── Host process ────────────────────┼─────────────┐
│                                                                 ▼             │
│  GET /__dsh-api-balance-ring/balance   → detect the payment mode:             │
│     · agentDefaultModel.currentSelection().provider decides which             │
│     · deepseek-account* → deepseekAccount.getBalance()   (充值余额)            │
│     · deepseek*         → GET https://api.deepseek.com/user/balance           │
│     · anything else     → third-party, balance not readable                   │
│                                                                                │
│  GET /__dsh-api-balance-ring/stats     → today's usage from session logs:      │
│     · count assistant/message events for the active provider                  │
│     · sum input + output + cache tokens                                       │
│     · price each request at its own model's official CNY rate                 │
└────────────────────────────────────────────────────────────────────────────────┘
```

## 📦 Installation

### Prerequisites

- **DeepSeek Harness** (the Web GUI) running locally.
- Whichever payment source you use, already set up in the harness. The plugin reads only what the harness already holds — it adds no credential of its own.

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
| Hover the ring | Tooltip with the balance, or today's spend against the budget |
| Click the ring | Panel: 付款方式, the figure, requests, tokens, and a timestamp |
| Click elsewhere / `Esc` | Panel closes |
| Automatic | Values refresh every 60 s; clicking the ring also refreshes immediately |

The colour thresholds are per mode. Balance modes: **≥ ¥5 green**, **≥ ¥1 amber**, **< ¥1 red**. Spend mode: **< 60% of budget green**, **< 90% amber**, **≥ 90% red**.

## 🧮 Data & accuracy

| Stat | Source |
| --- | --- |
| Balance, account mode | `deepseekAccount.getBalance()` — the harness's own signed-in wallet, no external call |
| Balance, API-key mode | Official `https://api.deepseek.com/user/balance`, authenticated with the stored `DEEPSEEK_API_KEY` |
| Requests / Tokens | Your own **session logs** — every `assistant/message` event carries the real API usage (`inputTokens`, `outputTokens`, `cacheReadTokens`) |
| Cost | Official per-model CNY rates, applied per request and per token kind |

### How the ring picks its subject — follows the provider, not the sign-in state

The composer is pointed at a provider, and **that** decides who is paying. Asking "is a DSH account signed in?" answers a different question and gets this wrong: you can be signed in to a DSH account while the composer calls Xiaomi MiMo on its own API key, and the ring would report somebody else's wallet.

So detection reads the provider the composer is pointed at and classifies it:

| Provider in use | Detected mode | The ring shows | Panel label |
| --- | --- | --- | --- |
| `deepseek-account*` | **账号登录** | the **充值余额** from `deepseekAccount.getBalance()` | 账户余额 |
| `deepseek*` | **API Key** | the official `/user/balance` figure | API余额 |
| anything else (e.g. `xiaomi`) | **第三方** | **today's spend ÷ daily budget** | 今日用量 |

The detected mode is shown as **付款方式** in the panel — naming the actual provider (`xiaomi API Key`) — so it is visible which source the ring is following.

The account reading is the **充值余额** (the topped-up wallet, `balance.value`). The **赠送余额** (`bonusWallets`) is a separate row in Settings and is deliberately not summed into the ring.

> A third-party provider with no balance API — Xiaomi MiMo, for example — publishes no way to read its balance ([定价](https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go) links only a web console; `GET /v1/models` answers `200` while `/v1/balance` and four other candidates answer `404`). For that kind of provider the ring falls to the third row and measures today's spend against the daily budget instead.

### Pricing table (CNY per 1M tokens — official domestic rates)

| Model | Cache-hit input | Cache-miss input | Output |
| --- | ---: | ---: | ---: |
| `mimo-v2.6-flash` · `mimo-v2.5` | ¥0.02 | ¥1.00 | ¥2.00 |
| `mimo-v2.6-pro` · `mimo-v2.5-pro` | ¥0.025 | ¥3.00 | ¥6.00 |
| `mimo-v2.6-pro-ultraspeed` | ¥0.25 | ¥30.00 | ¥60.00 |

Source: [MiMo API 定价](https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go). Cache **writes** are free for now (`缓存写入：限时免费`) and are therefore not priced. Batch inference is half price, but session logs carry no batch marker, so every request is priced at the real-time rate.

**The rate card is bound to its provider.** `pricingFor(provider, model)` returns a rate only when the provider is one of `MIMO_PROVIDERS`; a request from any other provider is counted and its tokens still summed, but never costed at MiMo's rates — it is flagged `unpriced` instead. Billing a DeepSeek account call at MiMo's prices would silently misstate the cost, and an honest gap beats a wrong number.

### What counts

- ✅ Requests are counted for the **active provider** — the one the composer is pointed at.
- ✅ Each request is priced with the rate recorded on its own `request/header` event, so a mid-session model switch bills correctly on both sides of the switch.
- ✅ "Today" is your local calendar day (00:00 → now).
- ⚠️ A request whose model is outside the rate card shows a `~` prefix — the number is an under-count, never a silent wrong one.
- ⚠️ Batch inference is half price, but session logs carry no batch marker, so batch traffic would be over-counted at the real-time rate.

## ⚙️ Configuration

Everything lives in the `CONFIG` block at the top of each file.

| Constant | File | Default | Meaning |
| --- | --- | --- | --- |
| `referenceBalance` | `bundle/client.js` | `50` | ¥ that fills the ring in balance modes |
| `warnBelow` / `dangerBelow` | `bundle/client.js` | `5` / `1` | ring colour thresholds in balance modes (¥) |
| `dailyBudgetCny` | `bundle/index.js` | `50` | ¥ budget that fills the ring in spend mode |
| `warnRatio` / `dangerRatio` | `bundle/client.js` | `0.6` / `0.9` | ring colour thresholds in spend mode |
| `refreshMs` | `bundle/client.js` | `60000` | background refresh interval |
| `tooltipDelayMs` | `bundle/client.js` | `200` | hover delay before the tooltip |
| `MIMO_PROVIDERS` | `bundle/index.js` | `['xiaomi']` | providers whose requests the rate card is authoritative for |
| `PRICING` | `bundle/index.js` | — | per-model rate table in **CNY/1M tokens** (add new models here) |
| `accountClientVersion` | `bundle/index.js` | harness version | reported to the platform with the balance request |
| `balancePath` / `statsPath` | both | `/__dsh-api-balance-ring/…` | the two Host routes; the paths must match across the halves |

## ❓ FAQ

**Why does the panel show `~` before the cost?** A request ran with a model not in the rate card (e.g. a brand-new release), or a provider whose rates are unknown. Requests and tokens still count; the cost is marked approximate.

**Why is my "today" lower than the platform dashboard?** The plugin reads *your harness's* session logs. Usage from other tools or direct API calls is not in those logs, and small differences in the day boundary can shift the count by a couple of requests.

**Why does the ring show spend instead of a balance?** Because the provider you are on publishes no balance API — see the note above. Switch to a `deepseek*` provider and the ring switches to the balance.

**Are my credentials touched?** The account path calls the harness's own `deepseekAccount` service and never sees a token. The API-key path uses the stored `DEEPSEEK_API_KEY` only in the `Authorization` header of the balance request. The spend path makes **no external request at all**.

**Does it work with `mimo-v2.6-pro`?** Yes — that is exactly why pricing is per request and bound to the provider. Switch your model in the composer and the ring follows.

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

- A third-party provider with no balance API (MiMo today) can only offer the spend meter, not a balance.
- Updating an already-installed copy needs a harness restart: replacing an installed package is what loads a fresh JavaScript module generation, so an in-place edit keeps the old module in memory.
- Usage is aggregated from session logs — it reflects the harness, not your whole API account (direct API calls and other tools are not counted).

## 🤝 Contributing

PRs are welcome! Ideas we'd love:

- A config UI (daily budget, thresholds, reference balance) instead of code constants.
- Rate cards for more providers, so the `~` flag disappears for them too.

Please keep both halves dependency-free — `bundle/index.js` must import nothing, and `bundle/client.js` must stay a plain script that only uses the `require` seed words.

## 📄 License

[MIT](LICENSE) © EdwinZDZ

*Visual language (ring geometry, panel surface, tooltip plate) is adapted from the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) built-in context-occupancy meter, MIT licensed.*

# API Balance Ring · API 余额圆环

**一个住在 DeepSeek Harness 输入框里的实时小仪表，紧挨内置上下文圆环的右侧。** 它会识别你当前实际在用的付费方式 —— DSH 账号登录、DeepSeek API Key，或第三方 provider —— 并据此显示余额，呈现为 `◯6% ◯8%`。悬停看数字，点击看明细。

> 🇬🇧 [English README](README.md)

![Demo](assets/demo.gif)

---

## ✨ 亮点

- **🎯 就在上下文圆环右侧** —— 渲染在输入框下方的统计行里，与内置的上下文占用圆环并排，读作 `◯6% ◯8%`。几何完全一致（14px viewBox、r=5.5、2px 描边），主题 token 同款。
- **🔍 跟随你正在用的 provider** —— 自动识别当前生效的付费来源并适配。切换模型，圆环跟着切。
- **🖱 悬停即见** —— 按模式显示 `API余额￥1.90` 或 `今日已消费￥5.02 / 预算￥50`。
- **📊 点击展开** —— 明细面板：识别到的**付款方式**、余额或消费、请求次数、Token 消耗与更新时间。每 60 秒自动刷新，点击时立即刷新。
- **🧮 按模型用官方价计价** —— `mimo-v2.6-flash` / `mimo-v2.6-pro` / `mimo-v2.6-pro-ultraspeed`，元 / 百万 tokens，取自每条请求自己的 `request/header` 事件，会话中途切换模型前后都算得准。
- **💴 原生人民币** —— 官方国内价卡就是「元 / 百万 tokens」，直接按 ¥ 计算，没有 USD→CNY 换算，不存在汇率漂移。
- **⚡ 缓存命中分开算** —— 命中缓存的输入按其更低的费率计价，长 agent 会话因此不会被按输入价高估。
- **🎨 原生观感** —— 与产品内置圆环同槽位、同几何、同主题 token。零依赖、纯 JavaScript、无需构建。

## 🖼 预览

> 下图是三种模式的**渲染示意图，不是屏幕截图**。真实录屏正在采集，届时替换。

圆环会识别并适配的三种付费方式 —— **账号登录**（余额）、**API Key**（余额）、**第三方**（今日消费与预算）：

![账号登录 · API Key · 第三方](assets/hero-strip.png)

明细面板特写 —— 注意首行 **付款方式**，它标出圆环正在跟随哪个 provider：

![余额面板 · 消费面板](assets/panel.png)

## 🧩 工作原理

```
┌───────────────────────────── 浏览器（bundle Client 半区）────────────────────────┐
│  conversation.composer.dock 槽（统计行，上下文圆环右侧）                          │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │  BalanceRing 组件                                                          │  │
│  │   ┌──────────────────────────────────┐      fetch('/__dsh-api-…/balance') │  │
│  │   │ ◯10% + 提示 + 面板   ◀──────────┼──────────────────────┐             │  │
│  └───┴──────────────────────────────────┘                      │             │  │
└─────────────────────────────────────────────────────────────────┼─────────────┘
                                                                  │ HTTP
┌─────────────────────────────── 宿主进程 ────────────────────────┼─────────────┐
│                                                                 ▼             │
│  GET /__dsh-api-balance-ring/balance   → 识别付费方式：                        │
│     · 由 agentDefaultModel.currentSelection().provider 判定                   │
│     · deepseek-account* → deepseekAccount.getBalance()   （充值余额）          │
│     · deepseek*         → GET https://api.deepseek.com/user/balance           │
│     · 其他              → 第三方，余额取不到                                   │
│                                                                                │
│  GET /__dsh-api-balance-ring/stats     → 今日用量，来自会话日志：               │
│     · 统计当前 provider 的 assistant/message 事件                              │
│     · 累加 input + output + cache tokens                                      │
│     · 按各请求自身模型的官方人民币价计价                                       │
└────────────────────────────────────────────────────────────────────────────────┘
```

## 📦 安装

### 前置条件

- 本地运行的 **DeepSeek Harness**（Web GUI）。
- 你要用的付费方式已在 harness 中配好。插件只读取 harness 已有的东西，不自带任何凭据。

### 步骤

本插件是可安装的 **bundle**，因而是真正的 profile 插件，而非会话级临时插件：

1. 克隆本仓库（或把 [`bundle/`](bundle/) 目录复制到 harness 可读的任意位置）。
2. 让你的 agent 安装：
   > 用插件管理器安装 `<绝对路径>/bundle` 这个 bundle
3. agent 会以该绝对包目录为 target 执行 `plugin_manager` `install_bundle`。这一次调用就完成了包安装与 bundle 选择 —— 不要手工改 profile 的 `package.json` 或 `cordis.patch.yml`。

圆环会在一秒内出现在输入框下方的统计行里，紧挨内置上下文圆环右侧（`◯6% ◯8%`）。

### 它会出现在「全局插件」里，默认启用

`bundle/cordis.patch.yml` 只在**根作用域**插入一行插件，且从不写 `disabled`，所以安装后它会出现在 **设置 → 内置插件 → 全局插件**，并且**每次启动默认启用** —— 不用重贴、不用重新勾选，重启后依然在。

| | |
| --- | --- |
| 设置页 | 设置 → 内置插件 → 全局插件 |
| 行 id | `api-balance-ring` |
| 默认状态 | 启用（没有任何地方设置 `disabled`） |
| 重启后保留 | 是 |

## 🎯 使用

| 操作 | 结果 |
| --- | --- |
| 悬停圆环 | 提示余额，或今日消费与预算 |
| 点击圆环 | 面板：付款方式、金额、请求数、Tokens、更新时间 |
| 点击别处 / `Esc` | 关闭面板 |
| 自动 | 每 60 秒刷新；点击圆环也会立即刷新 |

颜色阈值按模式区分。余额模式：**≥ ¥5 绿**、**≥ ¥1 黄**、**< ¥1 红**。消费模式：**< 60% 预算绿**、**< 90% 黄**、**≥ 90% 红**。

## 🧮 数据与准确性

| 数据 | 来源 |
| --- | --- |
| 余额（账号模式） | `deepseekAccount.getBalance()` —— harness 自己持有的登录钱包，不发外部请求 |
| 余额（API Key 模式） | 官方 `https://api.deepseek.com/user/balance`，用已存的 `DEEPSEEK_API_KEY` 鉴权 |
| 请求 / Tokens | 你自己的**会话日志** —— 每条 `assistant/message` 事件都带真实用量（`inputTokens`、`outputTokens`、`cacheReadTokens`） |
| 金额 | 官方按模型人民币价，逐请求、逐 token 类型计算 |

### 圆环如何选择主题 —— 跟随 provider，而非登录状态

输入框指向某个 provider，**那才决定谁在付钱**。「DSH 账号是否登录」是另一个问题，用它判定会出错：你完全可能已登录 DSH 账号，而输入框用的是小米 MiMo 自己的 API Key —— 这时圆环会去报别人的钱包。

所以识别读取的是输入框当前指向的 provider 并据此分类：

| 正在使用的 provider | 识别为 | 圆环显示 | 面板标注 |
| --- | --- | --- | --- |
| `deepseek-account*` | **账号登录** | `deepseekAccount.getBalance()` 的**充值余额** | 账户余额 |
| `deepseek*` | **API Key** | 官方 `/user/balance` 数值 | API余额 |
| 其他（如 `xiaomi`） | **第三方** | **今日消费 ÷ 日预算** | 今日用量 |

识别结果显示为面板里的**付款方式**一栏，并具体标出 provider（`xiaomi API Key`），所以你能看出圆环在跟随什么。

账号读取的是**充值余额**（`balance.value`）。**赠送余额**（`bonusWallets`）在设置里是独立一行，刻意不并入圆环。

> 第三方 provider 若没有余额接口 —— 小米 MiMo 就是如此 —— 就无法读取余额（[定价](https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go)只给了网页控制台；`GET /v1/models` 返回 `200`，而 `/v1/balance` 等五个候选端点全部 `404`）。遇到这类 provider，圆环落到上表第三行，改为衡量今日消费与日预算。

### 费率表（元 / 百万 tokens —— 官方国内价）

| 模型 | 输入（命中缓存） | 输入（未命中） | 输出 |
| --- | ---: | ---: | ---: |
| `mimo-v2.6-flash` · `mimo-v2.5` | ¥0.02 | ¥1.00 | ¥2.00 |
| `mimo-v2.6-pro` · `mimo-v2.5-pro` | ¥0.025 | ¥3.00 | ¥6.00 |
| `mimo-v2.6-pro-ultraspeed` | ¥0.25 | ¥30.00 | ¥60.00 |

来源：[MiMo API 定价](https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go)。缓存**写入**目前免费（`缓存写入：限时免费`），因此不计价。批量推理半价，但会话日志没有批量标记，故一律按实时价计。

**费率表与 provider 绑定。** `pricingFor(provider, model)` 只在 provider 属于 `MIMO_PROVIDERS` 时才返回费率；其他 provider 的请求照常计数、tokens 照常累加，但绝不用 MiMo 的价格去算 —— 而是标为 `unpriced`。把 DeepSeek 账号的调用按 MiMo 价格计费会悄悄给出错误金额，宁可留个诚实的缺口，也不要一个错数。

### 统计口径

- ✅ 按**当前 provider** 统计 —— 也就是输入框指向的那个。
- ✅ 每条请求用它自己 `request/header` 事件里的费率，会话中途切换模型前后都算得准。
- ✅「今日」指你本地自然日（00:00 → 此刻）。
- ⚠️ 模型不在费率表内的请求，金额前会加 `~` 前缀 —— 该数字是低估，绝不会静默给错。
- ⚠️ 批量推理半价，但日志无批量标记，批量流量会被按实时价高估。

## ⚙️ 配置

所有配置都在各文件顶部的 `CONFIG` 块里。

| 常量 | 文件 | 默认 | 含义 |
| --- | --- | --- | --- |
| `referenceBalance` | `bundle/client.js` | `50` | 余额模式下填满圆环的 ¥ 数 |
| `warnBelow` / `dangerBelow` | `bundle/client.js` | `5` / `1` | 余额模式的颜色阈值（¥） |
| `dailyBudgetCny` | `bundle/index.js` | `50` | 消费模式下填满圆环的日预算 ¥ |
| `warnRatio` / `dangerRatio` | `bundle/client.js` | `0.6` / `0.9` | 消费模式的颜色阈值 |
| `refreshMs` | `bundle/client.js` | `60000` | 后台刷新间隔 |
| `tooltipDelayMs` | `bundle/client.js` | `200` | 悬停提示延迟 |
| `MIMO_PROVIDERS` | `bundle/index.js` | `['xiaomi']` | 费率表对其权威的 provider |
| `PRICING` | `bundle/index.js` | — | 按模型费率表，**元/百万 tokens**（新模型加在这里） |
| `accountClientVersion` | `bundle/index.js` | harness 版本 | 余额请求附带的客户端版本 |
| `balancePath` / `statsPath` | 两者 | `/__dsh-api-balance-ring/…` | 两条宿主路由，两半必须一致 |

## ❓ 常见问题

**为什么金额前有 `~`？** 该请求用的模型不在费率表内（比如刚发布的新模型），或其 provider 没有价目。请求数和 tokens 仍会计入，金额标为近似。

**为什么「今日」比平台看板少？** 插件读的是*你的 harness* 的会话日志。其他工具或直接调 API 的用量不在其中，日界线的细微差别也会让计数差几条请求。

**为什么圆环显示的是消费而不是余额？** 因为你当前所在的 provider 没有余额接口 —— 见上文说明。切到 `deepseek*` provider，圆环就会显示余额。

**会动到我的凭据吗？** 账号路径调用 harness 自己的 `deepseekAccount` 服务，接触不到 token。API Key 路径只把已存的 `DEEPSEEK_API_KEY` 放进余额请求的 `Authorization` 头。消费路径**完全不发外部请求**。

**支持 `mimo-v2.6-pro` 吗？** 支持 —— 这正是按请求计价且与 provider 绑定的原因。在输入框切换模型，圆环随之变化。

## 🖥 兼容性 —— macOS 与 Windows

同一份文件在两个平台通用，不依赖 harness 解析出了哪个 shell。

| 关注点 | 处理方式 |
| --- | --- |
| HTTP 请求 | 宿主半区是普通 Node 模块，直接用平台全局 `fetch` —— macOS 与 Windows 完全一致 |
| 调 shell | 从不。没有 `curl`、没有 `curl.exe`，也没有 `sh -c` vs `powershell -Command` 的分支要选对 |
| Client → Host | 两条命名空间隔离的 `webServer` 路由，页面内 fetch，与内置 HMR 客户端同通道 |
| 会话日志聚合 | 纯 JavaScript 走 `sessionQuery` —— 两平台一致 |
| 插件安装 | `plugin_manager` `install_bundle` —— 一次调用，profile 级，重启保留 |

早期的*动态插件*形态要 shelling out 到 `curl`，还必须按平台分支。转成 **bundle** 之后这一整层就没了：bundle 的宿主半区是普通 Node 模块，可移植性是结构性的，而非一张特例表。

## 🚧 已知限制

- 没有余额接口的第三方 provider（目前是 MiMo）只能提供消费计量，无法提供余额。
- 更新已安装的副本需要重启 harness：替换已安装的包才会加载新一代 JavaScript 模块，原地改动会把旧模块留在内存里。
- 用量来自会话日志 —— 反映的是 harness，不是你整个 API 账户（直接调 API 与其他工具不计）。

## 🤝 贡献

欢迎 PR！我们想要的：

- 配置界面（日预算、阈值、参考余额），替代代码常量。
- 更多 provider 的费率表，让 `~` 标记对它们也消失。

请保持两半零依赖 —— `bundle/index.js` 不得 import 任何东西，`bundle/client.js` 必须是只用 `require` 种子词的普通脚本。

## 📄 许可证

[MIT](LICENSE) © EdwinZDZ

*视觉语言（圆环几何、面板表面、提示气泡）借鉴自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 内置的上下文占用圆环，MIT 许可。*

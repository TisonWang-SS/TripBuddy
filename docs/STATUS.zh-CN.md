# TripBuddy 当前状态

> **锚点:`6f06fa3`(2026-08-12)。** 本文下面所有数字都属于这个 commit。

本文是**唯一描述「现在」的文档**:当前能力、验收状态、下一阶段。

其余文档各自只拥有一个时态,不再兼任 roadmap:

| 文档 | 时态 | 拥有 |
|---|---|---|
| [`PRD.md`](./PRD.md) | 应然 | 产品该是什么、各功能的规则 |
| [`decisions/`](./decisions/) | 为何 | 决策与理由,只追加不改写 |
| [`SYSTEM_DESIGN_AND_AI_AGENT_INTERVIEW_GUIDE.zh-CN.md`](./SYSTEM_DESIGN_AND_AI_AGENT_INTERVIEW_GUIDE.zh-CN.md) | 如何 | 系统现在怎么工作 |
| [`CODE_REVIEW.zh-CN.md`](./CODE_REVIEW.zh-CN.md) | 曾经 | 查出过什么缺陷、怎么修的 |
| **本文** | **现在** | 能力、验收、下一阶段 |

**两条维护规矩**,它们是这份文档存在的原因:

1. **数字必须锚定 commit。** 不写「315 项通过」,写「`6f06fa3` 上 315 项通过」并给出复现命令。没有锚点的数字会静默腐烂;有锚点的数字一眼就能看出过期。
2. **不搬运未经复验的数字。** 上一轮验证过、本轮没重跑的,标注「上次验证于 X,本轮未复验」,不得抄成当前事实。

---

## 1. 当前能力

**订单与证据**

- 手动建立、编辑订单与价格观察;结构化 observation 带证据分级、blocker 与 warning。
- 从用户正常 Chrome 的 Hyatt 账户导入已订行程(需 Browser Companion)。
- 订单驱动的 Hyatt 现金 / 积分查价,经持久化 browser task 完成,含税总价与税费分项为硬性要求。
- 可选的 LLM 证据 replay:在日志页对脱敏快照独立回放,模型提议须通过 schema、逐数字页面落点、币种一致性与算术校验才能落库。

**决策**

- 确定性成本计算与推荐(keep / rebook_direct / consider_ota / needs_review / urgent),含取消政策降级的显式 warning 路径。
- 前台到期队列:打开 Dashboard 时按 cadence 与取消窗口推导,每项仍需用户点击才会开 Chrome(ADR 0001)。

**发现**

- 官网城市搜索(Hyatt),返回起价 / 每晚 / 不含税的候选列表。
- **逐酒店按需的含税总价**:`Get tax-inclusive total` 会开一次 Hyatt 任务,拿到 stay total、税前 subtotal 与 taxes & fees 分项后才写入。

**入口**

- 命令栏自然语言提问:LLM 路由 + 无 key 时的确定性关键词兜底;开浏览器标签页的能力必须显式确认;结果由服务端确定性组装成 surface 后渲染。
- Browser task 进度以事件流推送(非轮询)。
- Settings 的观察币种汇率入口;主题切换。

**边界(不做,且是产品资产而非缺失)**

- 从不订、改、付、确认、取消任何预订。
- 无 headless、无 CDP、无复制 profile、无后台无人值守查价。
- 不接触任何凭据。

---

## 2. 验收状态

**本轮已验证**(均在 `6f06fa3`):

| 项 | 结果 | 复现 |
|---|---|---|
| 单元 / 集成测试 | 54 文件 315 项通过 | `npm test` |
| 类型检查 | 无错误 | `npm run typecheck` |
| Lint | 无告警 | `npm run lint` |
| Production build | 成功;`/` 为 dynamic(`ƒ`) | `npm run build` |
| 命令栏确认链路 | 本地浏览器实测:确认后焦点落在按钮、标签页被指向真实 Hyatt launch URL、面板渲染 TaskLaunch | 见 CODE_REVIEW §3.20–§3.22 |

**上次验证于 `a800687`(2026-08-11),本轮未复验** —— 这些需要真实 API 或真实 Hyatt 页面,不能从本轮改动推断:

| 项 | 上次结果 |
|---|---|
| DeepSeek V4 Flash 抽取评测 | 13 fixtures、63/63 断言通过 |
| migration 与 Prisma schema 一致性 | 零差异,全新库干净应用 |
| 跨时区套件稳定性 | 外部 `TZ` 设为 -7 / 0 / +14 分别全过 |
| 真实 Hyatt 端到端 | §3.19 那轮由用户经 `http://192.168.3.1:3000` 跑通一次真实价格核查 |

⚠️ **一处需要点名的局限**:本轮命令栏验证中,`window.open` 是被替换成桩对象后断言 `location.href` 的 —— 内置浏览器拦截弹窗。**真实 Hyatt 抓取在本轮没有跑过**。按 `PRD.md` 的验证规则,涉及 Hyatt 抽取行为的改动需要一次真实验证;本轮改动不触碰抽取逻辑,但发现路径的下一次改动需要补上。

---

## 3. 下一阶段

排序依据产品定位:**面向酒店集团常旅客,官网直采可核验的价格,结合会籍给推荐,并监测已有预订是否有更优价。** 对照这条线,证据链部分超额完成,会籍部分最薄且曾主动收缩 —— 所以会籍这条是补定位欠账,不是加功能。

### 3.0 阻塞项:先清

**#0 · 修 `PRD.md:171` 失效引用。** 改成稳定的**章节名称引用**而非行号(该行号已经漂过一次),同步更新 `surface.ts` 的两处注释、`SurfaceContractError` 的消息文案,以及 `surface.test.ts:66` 的断言 —— **它断言了这个字符串,不是纯注释改动**。约十分钟,两条泳道都在等它(都会碰 `surface.ts`),先落地后面 rebase 无痛。

### 3.1 两条泳道,可并行

逐文件核过,两条泳道**不碰同一个文件**。A 不碰 `surface.ts`:权益丢失 warning 走已有的 `EvidenceIssues`,`explain_recommendation` 本来就在组装它。

```
#0 PRD 引用修复
  │
  ├─→ 泳道 1(成本模型)  A ──→ B ──→ C
  │
  └─→ 泳道 2(发现路径)  第 3 项 ──→ 第 2 项
```

| | 泳道 1 · 成本模型 | 泳道 2 · 发现路径 |
|---|---|---|
| 主要文件 | `decision.ts`、`recommendations.ts`、`recommendationCodecs.ts`、`schema.prisma` + migration、`profile/page.tsx`、`actions.ts`、`seed.ts`、`bookings/[id]/page.tsx`、`agent/capabilities/setup.ts` | `agent/router.ts`、`agent/capabilities/search.ts`、`agent/surface.ts`、`SurfaceRenderer.tsx`、`HotelSearchClient.tsx` |
| 交付给用户 | 会籍推荐 | 中文提问查酒店 + 预算筛选 |

泳道内部必须串行:A、B、C 都改 `CostBreakdown` 与 schema;第 2 项依赖第 3 项的 session surface。

### 泳道 1:[ADR 0003](./decisions/0003-loyalty-valuation.md) 拆三个交付

**A 必须第一,且是唯一破坏性的一个** —— 它会翻转已有推荐。B、C 纯粹增量。A 同时是减法且承重:成本模型改对之后,B、C 以及任何碰 `CostBreakdown` 的东西都建在正确地基上。

**0003-A · 停止计入无法证实的东西**(破坏性,以下五件必须**同批上线**)

1. 删 `UserProfile` 的 `breakfastValue` / `loungeValue` / `lateCheckoutValue` / `upgradeValue` / `eliteNightValue`,连同表单、`actions.ts` 解析、seed、`get_settings` 暴露。
2. `CostBreakdown` 去掉 `benefitValue` / `eliteProgressValue` 两个 `effectiveCost` 项;`Recommendation` 的两个 difference 列迁移保留、不重算历史行。
3. **权益丢失 warning**:基线有、候选没有的权益变成该候选的 warning,走 `DecisionCandidate.warnings` + `EvidenceIssues`。
4. **未确认促销 warning**:`requiresRegistration` 目前**存了但从未被任何代码读过**(`decision.ts:239` 的过滤只看 hotelGroup、日期窗口、`loyaltyEligible`,连 `DecisionPromotion` 类型里都没有这个字段)。这是 CODE_REVIEW §1.6 漏网的同类缺陷。fail-closed 计入,但**不要静默** —— 没有任何字段记录"用户已注册",静默排除会让真的注册了的用户被系统性低估且不知原因。出一条「此促销需要注册,未确认前不计入节省」。
5. **「我不在乎这项权益」开关**:几个 boolean + 构造 warning 时过滤。

第 3–5 项不能拆到后面:第 3 项不跟着删除一起上,产品会变成降级推荐机;第 5 项不跟着第 3 项一起上,不吃早餐的用户会在**每一次比较**上收到纯噪音。

> 会有人问:删了 5 个主观估值又加了 4 个 boolean,不是白折腾?**不是。「这项权益我要不要」是能回答的,「这项权益值多少钱」不能。** 这个区别就是整份 ADR 的论点。

⚠️ **不要顺手"修" `appliesToExistingBookings`。** `recommendations.ts:50` 只给 baseline 过滤它、`:79` 给候选传全量,看着像 bug 其实是对的:baseline 是既有订单,候选是新订单,不适用于既有订单的促销恰恰对新订单有效。这个不对称是有意的。

**0003-B · 有出处的估值**(增量)

- points / free night / suite 券的估值存储,带 `sourceName`、`asOf`、`lastReviewedAt`;过期不静默使用也不静默消失,降低依赖它的推荐的置信度并点名哪个数字过期。
- **realization rate 属于这一批** —— 它是"证书值多少"的一部分(市价 × 相对市场的调整,默认 1),C 只是消费它。
- 同次证据捕获内的现金 vs 积分兑换比较(cpp)。两个输入不来自同一次捕获则**不比较**,不估算。

**0003-C · 进度与发放**(增量,依赖 B 的证书估值)

- qualification progress、程序门槛与里程碑发放。
- 促销获得夜数/间夜阈值与 grant,与里程碑走同一条计算路径。
- allocation mode(默认 *at threshold*,可选 *amortized*);**amortized 只允许摊到已订好的房晚上**。
- 跨级价值 = Σ(所发券 × 有出处的市价 × 兑现率),无需任何主观输入 —— 所以它依赖 B。

`SOUL.md` 那半(自由文本、只给 agent 读语气)不在 A/B/C 内,随泳道 2 的对话骨架走。

### 泳道 2:发现路径

**第 3 项 · 中文城市名归一化 + `get_hotel_search_session` 补 surface。** 模型返回拉丁字母的 `city`(Hyatt 路径能认的形式)+ `cityAsAsked` 保留用户原话,回显用后者;接地由 Hyatt 结果页自己给(`locationLabel` 对不上或零结果就是可见证据)。`get_hotel_search_session` 至今没有 surface,读一个已完成 session 是空面板 —— 和 CODE_REVIEW §3.21 同一个洞,而搜索结果需要新的 surface 节点类型(节点目录是封闭 switch,必须显式加)。

**第 2 项 · 城市列表的比较基准。** 含税总价流程**已经存在**(`HotelSearchClient` 的 `Get tax-inclusive total`,逐酒店按需),但城市列表的比较与筛选仍跑在不含税起价上,预算筛选会系统性低估。缺的是基准标注与升级路径,不是证据链。预算参数持久化到 session,让页面和 agent 共用同一份确定性筛选。

### 之后

| 事项 | 说明 |
|---|---|
| 对话骨架(多轮 + 指代解析)与 locale,含 `SOUL.md` | 表现层。等两条泳道各自出成果再排更划算;locale 覆盖范围依赖对话面定型。需要 ADR 0003 之外的独立决策(模型可写什么) |
| 房型等价性判定交给模型(CODE_REVIEW §4.2 第 2 项) | `inferRoomMatch` 仍是 token 匹配,`unknown` 直接变 blocker —— 剩下的主要人工介入点,而 grounding 与 provenance 框架已就位 |


### 两条待决,各自需要独立 ADR

**跨集团 / OTA 比较。** provider registry、`SourceType.ota`、`consider_ota` verdict 都已就位,加 provider 是填充而非架构变更。但跨集团比较会打断会籍逻辑 —— 同集团内是「哪个更划算」,跨集团是「值不值得放弃进度」,是两个模型。ADR 0003 只锁死一条:被放弃的进度必须作为独立数字展示,不得 netted 进 `estimatedSavings`。

**ADR 0001 的修订。** 那份决策把「无人值守」和「headless / CDP / 复制 profile」绑成了一件事,结果「监测」实际上是「用户记得时点一下」。真正的卡点不是反爬而是**登录态**:即使反爬完全解决,后台服务仍看不到会员价。可行方向是分层 —— 服务端可 7×24 调用的 OTA 合作方 API 作探针(`low` 证据,只有权请求看一眼,无权改 baseline 或出 verdict),本地真实已登录 Chrome 做确认(`high` 证据)。这套分层天然套进现有 `EvidenceQuality`,与「model proposes, never authorizes」同形。

---

## 4. 已知张力,尚未决定

- **`PRD.md:22` 把城市搜索写成 "An auxiliary official hotel city search"**,与「帮常旅客找到最划算方案」的定位冲突。改 PRD 是产品决策,不在文档整理范围内,留待第 2 项一起处理。
- **`PRD.md` 的 v0.2 边界表述滞后**:命令栏、agent 路由、surface 组装、browser task 事件流都已落地但未写入边界章节。
- ~~`PRD.md:171` 行号失效~~ —— 已排进 §3.0 作为阻塞项。

# TripBuddy 当前状态

> **锚点:`073d241`(2026-08-12)。** 本文下面所有当前数字都属于这个 commit。

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
- `effectiveCost` 不再计入早餐、lounge、延迟退房、升房或固定 elite night 的主观估值。基线有而候选没有的权益变成 warning;四个结构化偏好可以逐项关闭 warning,但不能改变成本或 verdict。
- 需要注册但注册状态无法确认的促销 fail-closed:不计入节省,并在推荐 warning 中点名。新推荐由 deterministic decider v3 生成;旧推荐保留原成本快照,不重算历史。
- 前台到期队列:打开 Dashboard 时按 cadence 与取消窗口推导,每项仍需用户点击才会开 Chrome(ADR 0001)。

**发现**

- 中文自然语言搜索会同时保存用户原话(`cityAsAsked`)与 Hyatt 路径使用的拉丁字母城市名;Hyatt location label 不匹配或零结果会作为可见 grounding 证据。
- 官网城市搜索(Hyatt)保存用户原始预算金额、`per_night | stay_total` basis、basis 是否为默认解释,以及 `maximum | approximate`。模型不得计算整段金额;确定性代码负责晚数乘法,未给 basis 时按每晚并在 surface 点名,「左右」使用产品固定的 10% 容差。
- 起价 / 每晚 / 不含税只作发现提示,不参与预算判断;页面与 agent surface 共用同一份 session 与确定性比较。
- **逐酒店按需的含税总价**:`Get tax-inclusive total` 会开一次 Hyatt 任务;只有同币种 stay total 与明确的 taxes & fees included 证据才能判定预算内外。未升级的酒店保持可见,已证实超预算的酒店隐藏。

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

**本轮已验证**(均在 `073d241`):

| 项 | 结果 | 复现 |
|---|---|---|
| 单元 / 集成测试 | 57 文件 323 项通过 | `npm test` |
| 类型检查 | 无错误 | `npm run typecheck` |
| Lint | 无告警 | `npm run lint` |
| Production build | 成功;`/` 为 dynamic(`ƒ`) | `npm run build` |
| migration 与 Prisma schema | 8 个 migration 在全新隔离库干净应用;与 schema 零差异;旧推荐行、savings 与旧 JSON 成本组成保持不变 | `npx prisma migrate deploy`;`npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <isolated SQLite URL> --exit-code`;`npm test -- --run src/lib/loyaltyValuationMigration.integration.test.ts` |
| Profile 权益偏好 | 本地浏览器实测:四个开关可见,旧五个估值输入不存在;关闭 Breakfast 后保存并刷新仍为关闭;控制台无 error / warning,1280px 无横向溢出 | `/profile` |

**上次验证,本轮未复验** —— 不能从本轮改动推断:

| 项 | 上次验证于 | 上次结果 |
|---|---|---|
| 命令栏确认链路 | `6f06fa3`(2026-08-12) | 确认后焦点落在按钮、标签页被指向真实 Hyatt launch URL、面板渲染 TaskLaunch;其中 `window.open` 由桩对象断言 |
| DeepSeek V4 Flash 抽取评测 | `a800687`(2026-08-11) | 13 fixtures、63/63 断言通过 |
| 跨时区套件稳定性 | `a800687`(2026-08-11) | 外部 `TZ` 设为 -7 / 0 / +14 分别全过 |
| 真实 Hyatt 端到端 | `a800687`(2026-08-11) | §3.19 那轮由用户经 `http://192.168.3.1:3000` 跑通一次真实价格核查 |

⚠️ **一处需要点名的局限**:`073d241` 没有跑真实 Hyatt 抓取。本轮不触碰 Hyatt 抽取逻辑,所以不需要用旧结果替它背书;发现路径的下一次改动仍须按 `PRD.md` 的验证规则补真实验证。

**泳道 2 初次交付验证**(均在独立代码锚点 `a7ccb28`,2026-08-12):这组结果补上了上文所记的发现路径真实验证缺口;它只覆盖当时的泳道 2 shape,不改写上面的全局基线表。

| 项 | 结果 | 复现 |
|---|---|---|
| 单元 / 集成测试 | 56 文件 330 项通过 | `npm test` |
| 类型检查 / Lint | 无错误 / 无告警 | `npm run typecheck`;`npm run lint` |
| Production build | 成功;`/` 与 `/hotel-search` 均为 dynamic(`ƒ`) | `npm run build` |
| 中文路由 | 真实模型把「东京…整段预算 1000 美元」解析为 `city=Tokyo`、`cityAsAsked=东京`、`maxStayTotal=1000`、`currency=USD`;模型只选择 capability 与参数 | `routeIntent`,使用真实配置 |
| 已保存搜索的 agent surface | `get_hotel_search_session` 经真实 `/api/agent` SSE 返回 `HotelSearchResults`,并复用 session 预算比较 | `/api/agent` |
| 真实 Hyatt 城市搜索 | 在 profile 名为 `TripBuddy` 的正常 Chrome 中从 `/hotel-search` 启动,Tokyo 返回 10 个真实 Hyatt 结果;10 个都明确标成等待含税总价,没有拿不含税起价冒充预算内 | `/hotel-search` → `/api/hotel-search` |
| 单酒店含税总价升级 | **本轮未通过**:所选 Hyatt 结果页未暴露可继续到 final summary 的可见控件,Browser Companion 安全超时;没有生成或推断含税结论 | `/hotel-search` 的 `Get tax-inclusive total` |

**§3.25 审查修复验证**(均在独立代码锚点 `372a28c`,2026-08-13):

| 项 | 结果 | 复现 |
|---|---|---|
| 单元 / 集成测试 | 56 文件 336 项通过 | `npm test` |
| 类型检查 / Lint | 无错误 / 无告警 | `npm run typecheck`;`npm run lint` |
| Production build | 成功;`/` 与 `/hotel-search` 均为 dynamic(`ƒ`) | 对全新隔离 SQLite 依次应用 migration 并 seed 后 `npm run build` |
| 真实模型预算 grounding | §3.25 的 1000/晚×4、500/晚×3、200/晚×7 三个请求分别只返回原文里的 1000、500、200 + `per_night`;whole-stay 800 返回 800 + `stay_total`,没有模型乘法 | `routeIntent`,使用真实配置 |
| 未给 basis +「左右」 | 「预算 1000 人民币左右」返回原文 1000 + `approximate`,不返回 basis;能力层确定性记为 `per_night`、`basisAssumed=true`,比较函数应用 10% 容差 | `routeIntent` → `parseCapabilityArgs` |
| 模型数字落点 | 模型若提议请求原文中不存在的 `budgetAmount=4000`,路由 fail-closed 并退回确定性 clarify | `router.test.ts` |
| 比较守卫 | `final_total`、同币种、tax included、fee included 各有只违反该一项的样本;删除任一守卫都会让对应测试失败 | `hotelSearchComparison.test.ts` |

这轮没有改 Hyatt 抽取器,因此没有把 `a7ccb28` 的真实 Hyatt 城市搜索抄成 `372a28c` 的新事实;单酒店 final-total 的超时边界也仍然未关闭。

---

## 3. 下一阶段

排序依据产品定位:**面向酒店集团常旅客,官网直采可核验的价格,结合会籍给推荐,并监测已有预订是否有更优价。** 对照这条线,证据链部分超额完成,会籍部分最薄且曾主动收缩 —— 所以会籍这条是补定位欠账,不是加功能。

### 3.0 阻塞项:已清

**#0 · ✅ 已完成:修 `PRD.md:171` 失效引用。** `surface.ts` 的注释与 `SurfaceContractError`、`surface.test.ts` 的断言现在都引用 `PRD.md` 的 **Presentation** 章节名称,不再依赖会漂移的行号。两条泳道的共同阻塞已经解除。

### 3.1 两条泳道,可并行

逐文件核过,两条泳道**不碰同一个文件**。A 不碰 `surface.ts`:权益丢失 warning 走已有的 `EvidenceIssues`,`explain_recommendation` 本来就在组装它。

```
#0 PRD 引用修复
  │
  ├─→ 泳道 1(成本模型)  A ✅ ──→ B ──→ C
  │
  └─→ 泳道 2(发现路径)  第 3 项 ✅ ──→ 第 2 项 ✅
```

| | 泳道 1 · 成本模型 | 泳道 2 · 发现路径 |
|---|---|---|
| 主要文件 | `decision.ts`、`recommendations.ts`、`recommendationCodecs.ts`、`schema.prisma` + migration、`profile/page.tsx`、`actions.ts`、`seed.ts`、`bookings/[id]/page.tsx`、`agent/capabilities/setup.ts` | `agent/router.ts`、`agent/capabilities/search.ts`、`agent/surface.ts`、`SurfaceRenderer.tsx`、`HotelSearchClient.tsx` |
| 交付给用户 | 会籍推荐 | 中文提问查酒店 + 预算筛选 |

泳道内部必须串行:A、B、C 都改 `CostBreakdown` 与 schema;第 2 项依赖第 3 项的 session surface。

### 泳道 1:[ADR 0003](./decisions/0003-loyalty-valuation.md) 拆三个交付

**A 已作为第一批交付,且是唯一破坏性的一个** —— 它会翻转已有推荐。B、C 纯粹增量。A 同时是减法且承重:成本模型改对之后,B、C 以及任何碰 `CostBreakdown` 的东西都建在正确地基上。

**0003-A · ✅ 已完成于 `073d241`:停止计入无法证实的东西。** 以下五件已同批上线:

1. 已删 `UserProfile` 的 `breakfastValue` / `loungeValue` / `lateCheckoutValue` / `upgradeValue` / `eliteNightValue`,连同表单、`actions.ts` 解析、seed、`get_profile` 暴露。
2. `CostBreakdown` 已去掉 `benefitValue` / `eliteProgressValue` 两项;`Recommendation` 的两个 difference 列已删除,迁移保留旧行与 JSON 快照且不重算历史。
3. **权益丢失 warning**:基线有、候选没有的权益已变成该候选的 warning,走 `DecisionCandidate.warnings` + `EvidenceIssues`。
4. **未确认促销 warning**:`requiresRegistration` 已进入 `DecisionPromotion`;促销 fail-closed 不计入,同时点名 registration 尚未确认。
5. **「我不在乎这项权益」开关**:四个 boolean 已落在 profile,构造 warning 时过滤。

第 3–5 项已经随删除同批交付,避免产品短暂成为降级推荐机或向不在乎某项权益的用户反复发噪音 warning。

> 会有人问:删了 5 个主观估值又加了 4 个 boolean,不是白折腾?**不是。「这项权益我要不要」是能回答的,「这项权益值多少钱」不能。** 这个区别就是整份 ADR 的论点。

⚠️ **不要顺手"修" `appliesToExistingBookings`。** `createRecommendationForBooking` 只给 baseline 过滤它、给候选传全量,看着像 bug 其实是对的:baseline 是既有订单,候选是新订单,不适用于既有订单的促销恰恰对新订单有效。这个不对称是有意的。

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

### 泳道 2:发现路径 · ✅ 初次交付于 `a7ccb28`,§3.25 修复于 `372a28c`

**第 3 项 · ✅ 中文城市名归一化 + `get_hotel_search_session` surface。** Router 要求模型同时返回 Hyatt 路径能识别的拉丁字母 `city` 与保留用户原话的 `cityAsAsked`;两个字段从 capability、browser task 到 session codec 均持久化,旧任务与旧 session 读取时会补兼容默认值。结果回显原话与实际搜索词,并把 Hyatt `locationLabel` 不匹配或零结果显示为 grounding 证据。封闭 surface 目录新增 `HotelSearchResults`,`get_hotel_search_session` 不再返回空面板,启动 surface 也把 `sessionId` 带回搜索页。

**第 2 项 · ✅ 城市列表的比较基准。** Router 只抄请求中实际出现的 `budgetAmount`,basis 与 flexibility 分字段保存;能力层对未给 basis 的请求默认 `per_night` 并保留 `basisAssumed`,整段目标与 10% approximate 容差由纯函数计算。页面与 agent surface 共用这一比较:不含税 `Avg/Night` 永远不满足预算,没有 final total 的结果保持可见并提供升级路径,只有 `final_total`、同币种、tax included、fee included 四项全真的 stay total 才能判定预算内或隐藏为超预算。真实 Hyatt 初次交付验证证明城市列表不会误判;单酒店 final-total 升级超时,所以抽取完成态没有冒充已复验。

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

- ~~`PRD.md:171` 行号失效~~ —— 已在 §3.0 清理,改为引用 **Presentation** 章节名称。

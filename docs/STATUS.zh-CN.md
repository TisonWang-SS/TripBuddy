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

排序依据产品定位:**面向酒店集团常旅客,官网直采可核验的价格,结合会籍给推荐,并监测已有预订是否有更优价。** 对照这条线,证据链部分超额完成,会籍部分最薄且曾主动收缩 —— 所以前两项是补定位欠账,不是加功能。

| 顺序 | 事项 | 理由 |
|---|---|---|
| 1 | 落地 [ADR 0003](./decisions/0003-loyalty-valuation.md) 的会籍估值模型 | 定位里「结合会籍」这条现在最薄,且是唯一无法被通用 AI 旅行助手复制的部分。**删除主观估值与新增「权益丢失」warning 必须同批上线**,否则产品会变成降级推荐机 |
| 2 | 城市列表的比较基准 | 含税总价流程**已经存在**,但只在逐酒店按需的第二步。城市列表的比较与筛选仍跑在不含税起价上,预算筛选会系统性低估。缺的是基准标注与升级路径,不是证据链 |
| 3 | 中文城市名归一化 + `get_hotel_search_session` 补 surface | 小、独立、是第 2 项的地基。城市名原样进 Hyatt URL,中文城市大概率搜不到;而读 session 至今是空面板 —— 和 §3.21 同一个洞 |
| 4 | 对话骨架(多轮 + 指代解析)与 locale | 表现层。等 1、2 有东西可包再做更划算;locale 覆盖范围依赖对话面定型 |
| 5 | 房型等价性判定交给模型(CODE_REVIEW §4.2 第 2 项) | `inferRoomMatch` 仍是 token 匹配,`unknown` 直接变 blocker —— 剩下的主要人工介入点,而 grounding 与 provenance 框架已就位 |

### 两条待决,各自需要独立 ADR

**跨集团 / OTA 比较。** provider registry、`SourceType.ota`、`consider_ota` verdict 都已就位,加 provider 是填充而非架构变更。但跨集团比较会打断会籍逻辑 —— 同集团内是「哪个更划算」,跨集团是「值不值得放弃进度」,是两个模型。ADR 0003 只锁死一条:被放弃的进度必须作为独立数字展示,不得 netted 进 `estimatedSavings`。

**ADR 0001 的修订。** 那份决策把「无人值守」和「headless / CDP / 复制 profile」绑成了一件事,结果「监测」实际上是「用户记得时点一下」。真正的卡点不是反爬而是**登录态**:即使反爬完全解决,后台服务仍看不到会员价。可行方向是分层 —— 服务端可 7×24 调用的 OTA 合作方 API 作探针(`low` 证据,只有权请求看一眼,无权改 baseline 或出 verdict),本地真实已登录 Chrome 做确认(`high` 证据)。这套分层天然套进现有 `EvidenceQuality`,与「model proposes, never authorizes」同形。

---

## 4. 已知张力,尚未决定

- **`PRD.md:22` 把城市搜索写成 "An auxiliary official hotel city search"**,与「帮常旅客找到最划算方案」的定位冲突。改 PRD 是产品决策,不在文档整理范围内,留待第 2 项一起处理。
- **`PRD.md` 的 v0.2 边界表述滞后**:命令栏、agent 路由、surface 组装、browser task 事件流都已落地但未写入边界章节。
- **`surface.ts` 与 `surface.test.ts` 引用的 `PRD.md:171` 行号已失效**,该规则现在在 `PRD.md:121`。注意 `surface.test.ts` **断言了这个字符串**,所以不是纯注释改动。

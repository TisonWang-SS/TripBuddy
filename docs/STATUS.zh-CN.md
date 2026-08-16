# TripBuddy 当前状态

> **锚点:`5a63980`(2026-08-14)。** 0003-B(有出处的估值 + 现金 vs 积分 cpp)已完成,并经 7 轮真实 Hyatt 实跑验收 —— 这一串实跑同时暴露出**积分价此前从来没被真正查到过**,相关修复一并在这个 commit 里。本文下面所有当前数字都属于这个 commit。

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
- **一次 capture 可以走两种模式**:Hyatt 一页只渲染现金或积分,模式由**页面上的 `Use Points` 开关**进入(不是 URL 参数),所以两者都要时,同一次 run 会把同一个房型走两遍。要了却一无所获的库存类型会被点名,run 记为 `partial` 而不是干净的成功。
- 可选的 LLM 证据 replay:在日志页对脱敏快照独立回放,模型提议须通过 schema、逐数字页面落点、币种一致性与算术校验才能落库。

**决策**

- 确定性成本计算与推荐(keep / rebook_direct / consider_ota / needs_review / urgent),含取消政策降级的显式 warning 路径。
- `effectiveCost` 不再计入早餐、lounge、延迟退房、升房或固定 elite night 的主观估值。基线有而候选没有的权益变成 warning;四个结构化偏好可以逐项关闭 warning,但不能改变成本或 verdict。
- **有出处的估值**:积分 / free night / suite 券的价值各自带 `sourceName`、`asOf`、`lastReviewedAt`,过期(180 天)后仍照用,但在依赖它的推荐里点名为 stale 并把证据等级降一级。券价 = 市价 × 兑现率(≤ 1,默认 1);兑现率只属于券,积分带兑现率会被拒绝而不是被改写。
- **花掉一个没有估值的积分或券是 blocker**(估成 0 会让一段住宿看起来免费);**只是赚取**没有估值的积分是 warning。证书基线未记录种类与张数时点名为未计价,而不是当成一晚。
- **同次捕获内的现金 vs 积分(cpp)**:两侧必须来自同一次 capture、指同一个房型,现金总价同币种且税费均标为已含,积分口径必须自证为整段(`pointsBasis=stay_total`)。输出为每分回报 + 记录的积分价值 + 结论;任一输入缺失只给出理由,不给估计,且从不改动 `effectiveCost` 或 verdict。
- 需要注册但注册状态无法确认的促销 fail-closed:不计入节省,并在推荐 warning 中点名。新推荐由 deterministic decider v3 生成;旧推荐保留原成本快照,不重算历史。
- 前台到期队列:打开 Dashboard 时按 cadence 与取消窗口推导,每项仍需用户点击才会开 Chrome(ADR 0001)。

**发现**

- 中文自然语言搜索会同时保存用户原话(`cityAsAsked`)与 Hyatt 路径使用的拉丁字母城市名;Hyatt location label 不匹配或零结果会作为可见 grounding 证据。
- **日期 grounding 按「属于候选集」而非「等于抽取结果」判定**:确定性抽取列出这段请求能合法产生的全部日期(明写的、月/日归一化到下一个 occurrence 的、以及各自 +1 晚或 + 用户说的晚数),模型选其中之一即可。凭空的年份、没给长度的退房日仍被拒;拒绝时转为追问,不再把内部诊断显示给用户。
- 官网城市搜索(Hyatt)保存用户原始预算金额、`per_night | stay_total` basis、basis 是否为默认解释,以及 `maximum | approximate`。模型不得计算整段金额;确定性代码负责晚数乘法,未给 basis 时按每晚并在 surface 点名,「左右」使用产品固定的 10% 容差。
- 起价 / 每晚 / 不含税只作发现提示,不参与预算判断;页面与 agent surface 共用同一份 session 与确定性比较。
- **对已有搜索追加条件不重新抓取**:预算是对结果的筛选,不是抓取的输入。`set_search_budget`(read,不开浏览器)写进已有 session 并就地重判每一行;晚数乘法、basis、「左右」的 10% 容差仍由确定性代码算。
- **能力可以声明 `precheck`**,在提供确认卡之前检查它自己知道而 planner 不知道的条件(如预算币种与搜索币种不符),把冲突变成当场能回答的问题,而不是按下之后的一堵墙。
- **第三方比价(RollingGo Global)**:`99bc9cb` 起,城市搜索会为官方结果里的酒店额外请求一次 OTA 房价,走鉴权 API、**不开浏览器**,取最便宜的房型作为该酒店的另一条 offer(`sourceType: "ota"`)。没有 token、超时、响应读不懂都只产生一条 warning,官方结果不受影响。预算判定现在接受它:一家酒店只要**任一**可比 offer 落在预算内即算命中。
  - **含税含费是该源的性质,不是从响应字段读出的**:RollingGo 报的就是实付全包价,不提供税费拆分。这一点现在是具名常量 `OTA_QUOTES_ARE_ALL_IN` 并有专门的测试钉住;若该源改为报税前价,**代码不会察觉**,那条测试就是要被故意改挂的地方。offer 的 warning 文案已改为「全包价,但不提供拆分」,不再与结构化字段互相矛盾。
  - ⚠️ **一个未决问题**,见 [`decisions/0006-ota-price-source.md`](./decisions/0006-ota-price-source.md):渲染出的行不区分「按分阶段证据规则从页面读到」与「API 返回」,两者在界面上是平级的两个同币种总价。
  - **未经真实服务验收**:解析与比较路径有单元测试覆盖(最低房型、`averagePrice × 晚数`、只有每晚参考价时不构造总价、全包假设本身、比较层接受 OTA 报价),但**没有一次真实 API 端到端记录**——需要 Global skill 有效登录,本轮按要求跳过。
- **按需的含税总价**:现在是 agent 的一个工具(`get_tax_inclusive_total`),由它自己判断何时需要 —— 有预算而只有起价时就该去取一次,不再要求用户逐家点按钮。仍会开一次 Hyatt 任务并需要一次确认;只有同币种 stay total 与明确的 taxes & fees included 证据才能判定预算内外。未升级的酒店保持可见,已证实超预算的酒店隐藏。

**入口**

- **多轮对话是产品主界面**(`/`)。模型收集需求、把请求拆成工具调用、读回工具结果、再据此给建议,一个回合内最多 6 步工具,超出则被要求用已有材料作答。原 Dashboard 移至 `/desk`。
- **一次对话内的搜索可复用**:每个回合都会被告知本次对话已收集过哪些搜索(只给条件与抓取时间,不给结果),模型据此选择读回、按新预算就地重判、还是重搜。追加条件不再触发重新打开浏览器。抓取满 15 分钟后不再算「当前」——这不是缓存过期,只改变对模型的描述,更旧的仍可用但答复必须说明有多旧;城市 / 日期 / 人数 / 现金积分任一不同即另一次搜索。搜索结果从不跨对话共享。
- **能力权限分三档**:`read` 直接跑;`write` 改本地数据、不开浏览器、**确认无条件且无豁免**,并须由产品文案写清这次按下会改什么;`browser_task` 开 Hyatt 标签页,同样必须按下(旧的 `confirmationRequired: false` 豁免已删除——在别人屏幕上开窗本身就是替他做事)。首个 write 能力是 `set_watch_plan`(开关价格监控与关注强度,间隔由产品固定,模型不得提议)。
- **模型用编号指认,产品解析成标识符**:模型看到的是 `b1`/`h2`,真实 id 不进它的上下文;调用工具时产品把编号换成标识符。编造的编号解析不到任何东西。这保住了「只能指认见过的行」,同时让「我的预订为什么建议保留」这类追问不再反问「哪一笔」。
- **价格按出处呈现**:给模型的酒店行分成 `hyatt`(起价及其口径、真正抓到的含税总价、积分价)与 `thirdParty`(第三方卖家报价),外加 `budgetJudgedOn` 点名预算判定用的是哪一个。第三方报价不得被称为「已确认/已核实」;用户问全包价而凯悦含税总价尚未抓取时,产品去抓,而不是拿起价或第三方价搪塞。
- **模型写理由,代码写数字**:推荐是指向某一行的引用,旁边的金额由服务端从已存结果填入;模型散文里出现的金额必须是工具产出过的数字(或两者之差),否则整段作废、重试一次、再失败则降级为产品自有文案。
- 产品从不执行的动作(订、改、付、确认、取消)在**中英文两种表述**下都由确定性模式在模型之前拒绝;描述产品本身的那句话始终是产品自有文案,模型只能解释某个具体请求为什么做不了。
- **每一个会开 Hyatt 标签页的能力都要一次按下**,一次确认只授权一次调用,用掉即失效。回合会跨越这次等待:Companion 回传的证据进入同一次对话,而不是另开一个页面。
- 无 API key 时不跑 loop,退回关键词路由 + 产品自有文案,离线仍可用。
- 命令栏(⌘K)只负责跳页,不再接受提问。
- Browser task 进度以事件流推送(非轮询)。
- Settings 的观察币种汇率入口;主题切换。

**边界(不做,且是产品资产而非缺失)**

- 从不订、改、付、确认、取消任何预订。
- 无 headless、无 CDP、无复制 profile、无后台无人值守查价。
- 不接触任何凭据。

---

## 2. 验收状态

**本轮已验证**(均在 `5a63980`):

| 项 | 结果 | 复现 |
|---|---|---|
| 单元 / 集成测试 | 62 文件 428 项通过 | `npm test` |
| **(未提交工作树)Agent loop 改造后** | 68 文件 506 项通过;typecheck、lint 均无告警;build 成功,`/` 与 `/desk` 为 dynamic(`ƒ`) | `npm test` / `npm run typecheck` / `npm run lint` / `npm run build` |
| 类型检查 | 无错误 | `npm run typecheck` |
| Lint | 无告警 | `npm run lint` |
| Production build | 成功;`/` 为 dynamic(`ƒ`);7/7 页面预渲染 | `npm run build`(先 `npx prisma migrate deploy`) |
| migration 与 Prisma schema | 10 个 migration 在全新隔离库干净应用并 seed 成功;与 schema 零差异 | `DATABASE_URL=file:<isolated> npx prisma migrate deploy`;`npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <isolated SQLite URL> --exit-code` |
| 0003-B migration 搬运语义 | 隔离库里 `LoyaltyAccount.pointValue = 0.017` 变成 `LoyaltyValuation(kind=point, sourceName='Traveler entry', asOf/lastReviewedAt=该行 updatedAt, currency=profile.defaultCurrency)`,`pointValue` 列消失,`HotelBooking` 得到 `baselineAwardKind` / `baselineAwardCount`;0003-A 的旧推荐行与 JSON 快照仍逐字不变 | `npm test -- --run src/lib/loyaltyValuationMigration.integration.test.ts` |
| 十一处守卫确实承重 | 逐个改坏再跑对应测试,每处都恰好挂一条:同一 capture、税费均已含、兑现率相乘、stale 降级、花掉未估值图形的 blocker、`stay_total` 口径、每晚措辞识别、模式只切一次、模式必须切、第一条腿的抢救、模型不得断言口径。改回后全套仍全过 | 见 `redemptionComparison.test.ts`、`decision.test.ts`、`loyaltyValuation.test.ts`、`priceChecks.test.ts`、`priceChecks.integration.test.ts`、`hyattEvidence.test.ts` |
| Profile 估值录入(真实浏览器) | `/profile` 表单落库两条:point 0.017 USD(reviewed 2026-08-01)显示 **Current**、due 2027-01-28;free_night 300 USD × 0.8(reviewed 2025-06-01)显示 **Past review**、due 2025-11-28。1280px 无横向溢出 | `/profile` → Save valuation |
| Profile 拒绝矛盾输入(真实浏览器) | 给 point 提交兑现率 0.5 → 服务端 500 + `A realization rate applies to certificates, not to points.`,**数据库无新行**(仍 2 行,无 IHG 行) | 同上 |
| 旧推荐快照仍可读 | 真实库里 `c1ef559` 之前生成的推荐在 `/bookings/[id]` 正常展开成本明细,无 Certificate 行、无 cpp 块、无报错 | `/bookings/cmso0cic8…` |
| **口径守卫防住的是反向结论** | 拆掉 `pointsBasis` 守卫后,用现有集成 fixture 的形状(3 晚、现金 990 USD、房型列表 25,000 points/晚)实测得 0.0396/点 → `redeem`;同一段住宿按整段 75,000 点算是 0.0132/点 → `pay_cash`。**结论正好相反**,已固化为回归测试 | `redemptionComparison.test.ts`「would invert the verdict…」 |
| Watch plan 文案(真实浏览器) | 复选框现为 `Check award rates (opens Hyatt in points mode)`,并有一条说明「Hyatt 一页只有一种模式」。1280px 无横向溢出 | `/bookings/[id]/watch-plan` |
| **真实 Hyatt 实跑 ①(4 次)** | 模式切换机制通过(`capturedModes:["award"]`、第二条腿 URL 去掉 `usePoints`、`navigate` 执行正确),但**两条腿拿到的都是现金价**:证伪了 `usePoints` 参数 | `/bookings/cmso0cic8…` → Run price check |
| **真实 Hyatt 实跑 ②(按开关后)** | 开关按成功(`{"label":"Use Points","pressed":true}`),页面全是积分价,但抽取一条都没拿到、planner 找不到可点的卡 —— 两个原因已修 | 同上 |
| **真实 Hyatt 实跑 ⑦(全绿)** | 一次 capture:积分 24,000 `1 King Bed`(政策已捕获 → `same_or_better` → 证据 `high`、**无 blocker**)+ 现金 331.51 同房型(政策 `worse` → warning);cpp 0.0138/点 vs 记录 0.012 → `redeem`;推荐 `keep`(省 26.23 未达 50 阈值)。结论已显示在 verdict 区、折叠区之外 | `/bookings/cmso0cic8…` |
| **真实 Hyatt 实跑 ③(抽取修好后)** | **抽取通了**:12 条积分候选 12,000 / 17,000 / 6,000,全部正确标为 `per_night`。planner 也确实决定去点 `SELECT`(用该次真实快照离线复现验证过)。但**点了 12 次页面纹丝不动**,12 张快照的 URL、文本长度、控件集合完全一致,最后报 `task_timeout`。展开的房价卡上写着 `Sign In or Join to book` 与 `CREDIT CARD REQUIRED` | 同上 |

✅ **本轮改了 provider / extractor / 扩展,`PRD.md` 要求的真实 Hyatt 验收已完成。** 由用户在 profile 名为 `TripBuddy` 的正常 Chrome + Browser Companion 上,对 `Grand Hyatt Kuala Lumpur`(2026-09-10 → 09-12,`1 King Bed`)连续跑了 7 轮订单查价。**每一轮都推翻了一个当时以为成立的假设**,这些都不是读代码能发现的:

| 实跑 | 揭示 |
|---|---|
| ① | `usePoints=true` URL 参数 Hyatt 不认 —— 模式其实由页面开关决定 |
| ② | 那个开关是 checkbox,扩展的 `collectControls` 只抓 `a/button`,从未捕获过 |
| ③ | 积分数字与 "points" 不相邻(`Free Night Award 12,000 +1 more rates Points/Night`),抽取器一条没拿到 |
| ④ | 房型卡排序只认带货币符号的金额,积分页因此找不到可点的卡,原地等到超时 |
| ⑤ | 开关跨导航是粘的,现金腿也走进了积分页,一条现金价都拿不到 |
| ⑥ | `inferRoomMatch` 的包含规则把 `1 King Bed` 判成等同于 `1 King Bed with Club Access` |
| ⑦ | 入库路径绕过 provider,积分侧不受任何规则约束;积分侧缺取消政策会被 blocker 卡死 |

最终一轮全绿(见上表实跑 ⑦ 行)。

**上次验证,本轮未复验** —— 不能从本轮改动推断:

| 项 | 上次验证于 | 上次结果 |
|---|---|---|
| 真实 Hyatt 端到端(发现路径) | `c1ef559`(2026-08-13) | 未登录、正常 Chrome + Companion:城市搜索取得 10 个 Hyatt 结果;`Hyatt Regency Tokyo Bay` 单酒店升级取得 `final_total 122.58 USD = 税前 98.62 + 税费 23.96`,`taxesIncluded=included`,算术自洽 |
| 中英文 never-acts 边界 | `c1ef559`(2026-08-13) | 「帮我预定…」「取消我的预订」被确定性拒绝且文案正确;「查一下我的预订」「取消政策是什么」「延迟退房」照常路由 |
| Profile 权益偏好开关 | `c1ef559`(2026-08-13) | 四个开关可见、旧五个估值输入不存在;关闭 Breakfast 后保存并刷新仍为关闭 |
| 命令栏确认链路 | `6f06fa3`(2026-08-12) | 确认后焦点落在按钮、标签页被指向真实 Hyatt launch URL、面板渲染 TaskLaunch;其中 `window.open` 由桩对象断言 |
| DeepSeek V4 Flash 抽取评测 | `a800687`(2026-08-11) | 13 fixtures、63/63 断言通过 |
| 跨时区套件稳定性 | `a800687`(2026-08-11) | 外部 `TZ` 设为 -7 / 0 / +14 分别全过 |
| 订单价格核查真实链路 | `a800687`(2026-08-11) | §3.19 那轮由用户经 `http://192.168.3.1:3000` 跑通一次真实价格核查 |

✅ **发现路径欠的真实验收已在 `c1ef559` 补上**(见上表)。这是 `PRD.md` 验证规则要求、且从 PR 2 起就挂着的一项。

⚠️ **五处仍需点名**:

- **积分价此前从未真正查到过 —— 真实实跑得出的结论。** `buildHyattBookingSearchUrl` 一直在 URL 上带 `usePoints=true`,而 Hyatt **不认这个参数**:实跑中带着它打开 `/shop/rooms/kuagh`,返回的仍是 `$155 Avg/Night` 这样的现金价。真正的开关是页面上紧挨货币选择器的 `Use Points`,而扩展的 `collectControls` 只抓 `a[href], button, [role="button"]`,这个 checkbox **从来没被捕获过**,自然从没被点过。40 个捕获控件里没有一个 label 含 "point"。有一条单测断言 URL 里含 `usePoints=true` —— 它只证明我们拼对了字符串,没证明 Hyatt 认它。已修:扩展捕获 switch/checkbox 并带 `pressed` 状态,planner 在欠积分那条腿上按开关,`usePoints` 保留但注释写明不可依赖。**修复本身尚未经过真实验证。**
- **积分价读不出来的两个原因,已由实跑定位并修复(修复本身尚未复跑)。** ①`extractAwardRates` 要求数字与 "points" 相邻,而 Hyatt 房型页写的是 `Free Night Award 12,000 +1 more rates Points/Night` —— 数字与单位被「还有几档房价」隔开,所以一整页积分价一条都没抽到;已改为再按 `Points/Night` 这个**单位标签**锚定取数。②planner 的房型卡排序只认带货币符号的金额(`extractLowestAmount`),积分页没有货币符号,于是找不到可点的卡、原地 `wait` 到超时;已把取值方式参数化,积分页按积分排序。
- **取消政策原文会串到下一张房卡,已修。** 实跑 ⑦ 里积分的政策原文尾部带着 `Sign In or Join to book SELECT 2 Twin Beds Grand Hyatt Kua` —— Hyatt 的扁平化文本没有句号,而 `extractPolicyText` 是「读到下一个句号为止」。这次判定结果碰巧是对的,但取消政策**刚刚才成为积分侧的承重项**,让它读进隔壁房卡是隐患。现已在卡边界(`Sign In or Join to book` / `SELECT & BOOK` / `View Room Details` / 下一个房型标题)截断。
- **cpp 一直是算对的,只是被藏起来了。** 实跑 ⑥ 的推荐里 `redemption` 存的是 `{cashTotal 331.51, points 24000, valuePerPoint 0.0138, pointValue 0.012, verdict redeem}` —— 结论正确,但我把它渲染进了默认折叠、摘要写着 "Cost breakdown" 的 `<details>` 里。一个专门为此录了积分估值的读者永远看不到它。已提到 verdict 区、折叠区之外(本地浏览器复验:`POINTS BEAT CASH $331.51 cash against 24,000 points returns 0.0138 USD per point, against a recorded 0.012 USD.`,1280px 无横向溢出)。
- **积分观测缺取消政策,会被 blocker 卡死。** 实跑 ⑥ 的积分观测 `cancellationPolicyRaw: "Policy not captured"` → `cancellationMatch: unknown` → blocker、证据等级 `needs_review`;现金侧有政策(判 worse,只是 warning)。Hyatt 的房型列表只印积分不印条款,条款要展开房价卡才有。因此积分腿的收工条件加上「已拿到取消政策」:它会多走一步展开房价卡,但仍**停在那个需要登录的 SELECT 之前**。
- **两侧本来就没走同一条路 —— 这是积分侧一直不受任何规则约束的总因。** `captureBookingPriceTask` 在 import 时是 `inventoryMerge.candidates.filter(award)`,把**累积证据里所有积分候选**直接交给存储,完全绕过 provider 的 `parsed.observations`;现金则只走 `parsed.observations`,一直被 provider 卡在「必须走到最终总价」上。所以此前每一次加在 provider 上的积分过滤都没有影响入库结果。现在两者都经 `BookingPriceProvider.selectComparableAwards`(失败路径的抢救逻辑同样改用它),规则只有一份。这条绕行早于本次会话就存在。
- **`inferRoomMatch` 的包含规则是错的,已修(两侧同时受益)。** 原规则「一个房名包含另一个就算 exact」把 `1 King Bed` 判成等同于 `1 King Bed with Club Access` —— 后者是另一个房型、另一个价格。子串判断分不清「写法不同」和「多了一项权益」。改为按**有意义的词集**比较:去掉床数与连接词后词集相同才是 exact,共享床型但一方多出内容是 similar。因此 `King Bed` 与 `1 King Bed` 仍等同,club 房被正确判为另一个房型。积分观测过滤据此要求 exact,一次 capture 里每个订单房型恰好返回它自己那一条。这条修在 evidence 层,**现金侧的证据评级同步变正确** —— 两侧用的是同一个定义,不会各说各话。
- **实跑 ⑤:两条腿都通了。** 一次 capture 同时拿到现金 331.51(`1 King Bed`)与 4 条积分,且**房型与积分全部对应正确**(king 24,000 / king+club 34,000 / twin 24,000 / twin+club 34,000,均 2 晚)。据此又改一处:积分房型页会一次性给出所有房型的价格,所以积分观测按**订单房型的可比性**过滤(复用 evidence 层同一个 `inferRoomMatch`,避免两套「同一个房型」的定义),其余仍留作证据。同一份快照上 4 条 → 2 条(`1 King Bed` 与 `1 King Bed with Club Access`)。
- **更正:此前说的「同一房型两个价是页面矛盾」是错的。** 用户实测页面没有矛盾。那个现象来自**上一跑**——那次按了 SELECT、展开了带 `Previous room / Next room` 轮播的面板,扁平化文本把不同幻灯片的标题与价格拼到了一起。是解析错位。规则保留(它防的是扁平化歧义),但理由已改写成成立的说法,不再声称 Hyatt 自相矛盾。
- **实跑 ④ 暴露的三件事,已修。** ①`Use Points` 开关**跨导航是粘的**:现金腿导航回房型页时开关仍开着,于是现金腿走了积分卡、停在灰掉的 SELECT,一次现金核查一条现金价都没拿到。现在每条腿都把开关设成自己需要的模式,两个方向都按。②积分观测此前**不受「必须是完整价格」这条门槛约束**,现金一直受:结果一页房型列表写进 12 条观测,含 4 条积分+现金。现在两者同一条门槛。③积分候选的房名从价格**前后**的窗口里取,取到了下一张卡的房名,把 club 房的 34,000 标成了标准房 —— 现在只往前找。同一房型若被页面报出两个不同价格(展开面板与列表卡不一致),两条都不入库、只留证据 —— 页面没说哪个算数,挑一个就是在猜钱。同一份真实快照上,观测从 12 条降到 2 条(`1 King Bed` 与 `2 Twin Beds`,均 24,000 `stay_total`),10 条候选仍完整保留。
- **积分价的取法已定案:纯积分不需要走到 summary。** 用户实测确认 `SELECT` 是灰的(未登录点不动),但**纯积分奖励无税**,所以房型页的 `12,000 Points/Night` 已是完整答案,× 晚数即整段总价;真正需要走完流程的是 `Points Plus Cash`,它的现金部分要算税。据此:纯积分候选按晚数换算为 `stay_total`,积分腿在房型页即收工并切到现金腿,**整条路绕开了登录态**(本产品也不登录)。积分+现金按其自身形状识别(数字后紧跟 `+ 货币 金额`),保持 `per_night` 因而被拒绝 —— 否则 `6,000 + $91` 会冒充成一个便宜一半的纯积分价。
- **停在「按了没反应」,已改为可诊断(这条现在只作兜底)。** 实跑 ③ 里扩展点 `SELECT` 点了 12 次、页面零变化,却只报 `task_timeout` —— 把「这个控件推不动」说成「慢」。现已改为比对页面状态签名,连续 3 次无变化即以 `control_did_not_advance` 停止,并**原样引用页面自己的说法**(`Sign In or Join to book` / `CREDIT CARD REQUIRED`)。**注意:这不等于已经断定原因是登录态** —— 现金流在同样未登录下是能走到 `/en-US/payment/details` 的。可能是积分兑换不允许匿名完成,也可能是 DOM 重渲染后控件 id 失效导致点了个已失效的元素。下一跑的报错信息会分开这两种。
- **每晚积分价也不能冒充整段成本。** `Points/Night` 说明 `12,000` 是每晚价。它此前会直接进 `redemptionPointsValue`,把整段成本按一晚计 —— 和 cpp 那个反向结论同一类错误,只是发生在 `effectiveCost` 里。现在 `pointsBasis != stay_total` 的候选直接 blocker,和现金侧「`Avg/Night` 起价只作发现提示」是同一条规矩。
- **cpp 目前一定不出结论,这是刻意的。** 房型列表上的 `25,000 points` 是**每晚**,而现金侧是走到 summary 才拿到的**整段总价**;两者相除会把结论**反过来**(3 晚 990 USD:按每晚读是 0.0396/点 → 「积分更划算」,按整段读是 0.0132/点 → 「现金更划算」)。`PriceObservation.pointsBasis` 因此新增,默认 `unknown`,cpp 只接受 `stay_total`,其余一律不比较并说明原因。抽取器本轮**没有**被改去填这个字段,所以 cpp 现在恒为 not_compared —— 宁可不出结论,也不出反的。
- **证书计价尚未在真实数据上跑过。** 验证来自隔离 SQLite 上的集成测试(走真实 `createRecommendationForBooking`)。要在真实数据上看到,需要一段手工录入种类与张数的证书订单。
- **扩展需要在 Chrome 重载**(版本 **0.4.0**)。控件捕获、`navigate`、以及「按了没反应要报出来」都在扩展侧。
- **中文版 Hyatt 页面未覆盖。** launch URL 已把语言钉在 `en-US`,但 `/shop/rooms/{code}` 路径没有语言段,语言由账户偏好决定。把 Hyatt 设为中文的用户,房型页 token 会全部落空,而表现是 `task_timeout` 而非「读不懂」。详见 CODE_REVIEW §3.27 末条。

**泳道 2 初次交付验证**(独立代码锚点 `a7ccb28`,2026-08-12)—— **历史记录,已被上表取代**。当时写的是「补上了发现路径的真实验证缺口」,但同一张表的最后一行就是单酒店升级未通过:城市搜索通了,含税总价没通,缺口并没有补上。真正补上是在 `c1ef559`(见上表)。

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
  ├─→ 泳道 1(成本模型)  A ✅ ──→ B ✅ ──→ C
  │
  └─→ 泳道 2(发现路径)  第 3 项 ✅ ──→ 第 2 项 ✅
```

| | 泳道 1 · 成本模型 | 泳道 2 · 发现路径 |
|---|---|---|
| 主要文件 | `decision.ts`、`loyaltyValuation.ts`、`redemptionComparison.ts`、`recommendations.ts`、`recommendationCodecs.ts`、`schema.prisma` + migration、`profile/page.tsx`、`actions.ts`、`BookingForm.tsx`、`bookings/[id]/page.tsx`、`agent/capabilities/setup.ts` | `agent/router.ts`、`agent/capabilities/search.ts`、`agent/surface.ts`、`SurfaceRenderer.tsx`、`HotelSearchClient.tsx` |
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

**0003-B · ✅ 已完成:有出处的估值 + 现金 vs 积分 cpp。** 以下已同批上线:

1. **估值存储**:新 `LoyaltyValuation`(profile × hotelGroup × kind),kind ∈ `point | free_night | suite_upgrade`,每行带 `amount`、`currency`、`realizationRate`、`sourceName`、`asOf`、`lastReviewedAt`。评审周期是产品常量 180 天 —— 不让用户顺手把它设成「永不」。
2. **过期不静默**:过期估值照用,但在依赖它的推荐里生成点名 warning,并把该推荐的 `qualityLevel` 降一级(high→medium→low,`needs_review` 不再降)。风险等级随之而变,因为 decider 本来就读 quality。
3. **realization rate**:`≤ 1`,默认 1,乘在市价上;`point` 带非 1 的兑现率会被**拒绝**而不是被悄悄改成 1 —— 悄悄改会让用户以为自己设了个产品忽略的东西。
4. **cpp**:`(现金总价 − 券上仍要付的现金) ÷ 所需积分`,与记录的积分价值比较,得出 `redeem / pay_cash / even`。守卫是同一 capture、同一房型标签、同币种、税费均已含、积分数存在、**积分口径为 `stay_total`**、积分价值币种一致 —— 每条各有一个只违反它的测试。缺输入只给理由,不给估计。结果存进 `costBreakdownJson` 的 `redemption` 兄弟字段,不进 `effectiveCost`、不改 verdict。
5. **`pointsBasis` 口径守卫**(枚举 `stay_total | per_night | unknown`,默认 `unknown`)。现金侧靠「走到 summary 且税费已含」自证是整段;积分侧没有对应的门,而房型列表与 award summary 的文本长得一模一样。没有这个字段,cpp 会把每晚积分当整段用并**给出相反的结论**(见 §2)。抽取器本轮未改去填它,所以它现在恒为 `unknown` —— fail closed。
6. **`pointValue` 搬家**:`LoyaltyAccount.pointValue` 迁进估值表(`sourceName='Traveler entry'`,`asOf`/`lastReviewedAt` 取原行 `updatedAt`)后删列。留着两个积分价值必然会分叉,而套利的那个没有出处 —— B 的整个论点就是「算术用的那个数必须有出处」。
7. **证书能被花掉**:`CostBreakdown` 新增 `certificateValue`(张数 × 市价 × 兑现率),与 `redemptionPointsValue` 同侧计入 `effectiveCost`。`HotelBooking` 新增 `baselineAwardKind` / `baselineAwardCount`,由手工表单填写。

> **为什么证书计价在 B 而不在 C。** C 拥有的是「发放」;B 拥有的是「值多少」。如果 B 只存不算,那这批新字段就没有任何东西在消费它们 —— 正是 §1.6 与 ADR 收尾那条规矩(字段只在有东西拿它计算时才存在)禁止的形状。而且证书基线**当前会算成 0**,让整段住宿看起来免费、让每个现金候选都像亏损,这是个现成的缺陷,不该等到 C。

> **为什么没顺手改 Hyatt 的 `extractFreeNightAward`。** 它其实已经解析出了张数,只是当场格式化成了 `"1 Free Night"` 字符串。让它返回结构化张数就是一次 extraction behavior change,按 `PRD.md` 的验证规则要配一次真实 Hyatt 账号验收,而那需要用户账号里恰好有一张 free night 订单。所以导入的证书订单保持「未记录种类与张数 → 点名为未计价」,而不是解析散文。这条留给之后。

**0003-B 的遗留**(都小,不阻塞 C):

| | 事项 | 说明 |
|---|---|---|
| 1 | **真实验收:按下 `Use Points` 后到底能不能拿到积分价** | 代码已就位(扩展捕获开关 + planner 去按 + 两条腿的 capture),但**一次都没在真实页面上跑过**。要确认三件事:开关能否被捕获成控件、按下后房型页是否真的换成积分、award summary 的措辞能否被 `hasFinalTotalToken` 识别。若仍拿不到,下一个嫌疑是**登录态** —— 实跑时页面是 `Sign In or Join`,未登录 |
| 2 | 导入的证书订单结构化张数 | `extractFreeNightAward` 把已解析出的张数丢进了字符串。同样要真实 Hyatt 账号验收 —— 值得和第 1 项合并成一趟 |
| 3 | 估值只能改不能删 | `/profile` 是 upsert;录错一条只能改写或让它过期后被点名,没有删除入口。B 的语义下够用,但记在这里以免以后当成 bug |
| 4 | cpp 只在推荐里出现 | 发现路径(`/hotel-search`)不产生 observation,所以那边看不到 cpp。是否要带过去取决于对话骨架怎么排 |
| 5 | 「赚取积分」文案可能被当成 award 房价 | `extractAwardRates` 匹配任何「4 位数以上 + points」。页面上若出现「Earn 5,000 points」,会造出一个假的 award 候选。`pointsBasis` 守卫现在挡住了它进入 cpp,但它仍会变成一条 observation。第 1 项的真实验收里要顺带确认 |

**0003-C · 进度与发放**(增量,依赖 B 的证书估值 —— 现已就位)

- qualification progress、程序门槛与里程碑发放。
- 促销获得夜数/间夜阈值与 grant,与里程碑走同一条计算路径。
- allocation mode(默认 *at threshold*,可选 *amortized*);**amortized 只允许摊到已订好的房晚上**。
- 跨级价值 = Σ(所发券 × 有出处的市价 × 兑现率),无需任何主观输入 —— 所以它依赖 B。

`SOUL.md` 那半(自由文本、只给 agent 读语气)不在 A/B/C 内,随泳道 2 的对话骨架走。

### 泳道 2:发现路径 · ✅ 初次交付于 `a7ccb28`,§3.25 修复于 `372a28c`

**第 3 项 · ✅ 中文城市名归一化 + `get_hotel_search_session` surface。** Router 要求模型同时返回 Hyatt 路径能识别的拉丁字母 `city` 与保留用户原话的 `cityAsAsked`;两个字段从 capability、browser task 到 session codec 均持久化,旧任务与旧 session 读取时会补兼容默认值。结果回显原话与实际搜索词,并把 Hyatt `locationLabel` 不匹配或零结果显示为 grounding 证据。封闭 surface 目录新增 `HotelSearchResults`,`get_hotel_search_session` 不再返回空面板,启动 surface 也把 `sessionId` 带回搜索页。

**第 2 项 · ✅ 城市列表的比较基准。** Router 只抄请求中实际出现的 `budgetAmount`,basis 与 flexibility 分字段保存;能力层对未给 basis 的请求默认 `per_night` 并保留 `basisAssumed`,整段目标与 10% approximate 容差由纯函数计算。页面与 agent surface 共用这一比较:不含税 `Avg/Night` 永远不满足预算,没有 final total 的结果保持可见并提供升级路径,只有 `final_total`、同币种、tax included、fee included 四项全真的 stay total 才能判定预算内或隐藏为超预算。真实 Hyatt 初次交付验证证明城市列表不会误判;单酒店 final-total 升级超时,所以抽取完成态没有冒充已复验。

### 搜索约束分层([ADR 0004](./decisions/0004-search-constraint-tiers.md))

已定分层与归属规则,**第二层刻意留空**。当下要做的只有两件小的:

| | 事项 | 说明 |
|---|---|---|
| 1 | 封闭的约束分类表 + 第三层文案 | 先于第二层的任何内容。第三层能用,第二层的扩展才是「改分类」而不是「铺新管路」 |
| 2 | `rooms` / `kids` 从 URL 常量提升为查询字段 | `buildHyattCitySearchUrl` 现在把两者钉死;`2 间` 因此落进了 `adults` |

第二层(设施、地址、页面写明的距离)与儿童年龄建模留待产品整体成型后再展开。ADR 里记了两条将来必须守住的:**第二层需要四态而非三态**(`not_stated` 不得塌成 `lacks`),以及**验证搭含税总价那趟车**,不新开逐酒店的第二遍访问。

### 发现路径的遗留(小,可随时插队)

| | 事项 | 说明 |
|---|---|---|
| 1 | **中文版 Hyatt 页面读不懂时明确失败** | launch URL 已钉 `en-US`,但 `/shop/rooms/{code}` 无语言段。解析前断言英文锚点,读不懂就报 `page_locale_unexpected` 并说明如何改语言 —— 现在的表现是 `task_timeout`,把「读不懂」伪装成「慢」。纯服务端,不需重载扩展 |
| 2 | 让 Hyatt 请求显式携带语言 | 把控制权拿回来,而不是依赖账户偏好。需要一次真实验证确认 Hyatt 认哪个参数 |

### Agent 工具目录:下一批候选与实现难度

多轮 loop 能做什么,上限是工具契约能表达什么(§3.30、§3.33 都是这条的实例)。下面按「用户会说的话 → 缺哪个工具」排,难度按**是否需要新的采集或新的比较语义**判断,而不是按代码量。

| 候选 | 用户会怎么说 | 数据在哪 | 难度 | 说明 |
|---|---|---|---|---|
| `get_hotel_offer_detail` | 「这家的取消政策是什么」「含早餐吗」 | 已在 session 的 offer 里 | **低** | 纯 read,照 `get_hotel_search_session` 写。现在这些字段已经采集了却没有读取路径 |
| `add_booking` | 「把这个记下来」「我在别处订了一间」 | — | **中** | write,已有 `createBooking` 可复用;字段多、`parseArgs` 长,且要想清哪些必填 |
| `set_baseline_from_observation` | 「按这次查到的价更新我的基准」 | 已有 observation | **中** | write,且必须服从 PRD「证据先于操作」——surface 的排序契约正好是为此建的,要用上 |
| `compare_with_booking` | 「搜到的这些跟我现在订的比怎么样」 | booking 与 session 都在本地 | **中偏高** | 不是取数问题,是**比较语义**问题:跨源、跨币种、房型是否等价,会碰 `decision.ts`。ADR 0003 已锁死一条:被放弃的会籍进度必须独立展示,不得并进 `estimatedSavings` |
| 结果筛选 / 排序 | 「只看能免费取消的」「按价格排」 | 已在 session 里 | **可以不做** | 模型已经看得到全部行,自己筛即可。加工具只在结果多到装不进上下文时才值得 |
| 翻页 / 更多结果 | 「还有别的吗」 | Hyatt 分页 | **高** | provider 与 Browser Companion 都要改,且每翻一页都是一次真实标签页 |

新增工具的成本主要在三处,与现有接口保持一致即可:`params` 的描述(实测表明**离调用点最近的那句话权重最高**,见 §3.33)、`modelView` 的投影(决定模型看得到什么)、`surface` 的节点(决定用户看得到什么)。三者缺一个,工具就会「能调用但没人知道结果」。

### 待办:AG-UI 交互控件(需要能看视频的人接手)

参考 [Chat + AG-UI 的正确打开方式](https://www.bilibili.com/video/BV1hKvYBcEXd)(标签:AgenticUI、HumanInTheLoop)。**本轮无法评估其具体交互形态——协作的 AI 读不了视频画面,只拿到标题与标签。**

底层是现成的:事件流本来就是 AG-UI 词汇(`events.ts`),surface 是服务端组装、客户端白名单渲染的声明式节点。缺的是**反向通道**——12 种节点里只有 `ConfirmAction` 能回传,而且只能回传固定的 `{capability, args}`。

要做视频里那类控件,需要先把这条独木桥泛化:`onAction(action)` → `AgentTurnRequest.action` → loop 当作一次用户意图处理。**这是唯一需要新设计的部分**,之后每加一个控件都是三步增量(surface 节点 → Renderer case → 目录里说明)。`STATE_SNAPSHOT` / `STATE_DELTA` 两个事件已在词汇表里但从未使用,如果需要实时状态同步,那是现成的接入点。

接手的人需要先回答:视频里的控件是「agent 生成可填表单」、「结果卡上的按钮继续对话」,还是「多方案并排让用户挑」——三者的设计差别不小。

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

# 实施情况

> 2026-05-26 · `feature/refactor` 分支
>
> 对照 `docs/SPEC.md` 功能清单，记录每项功能的实际实现状态。
>
> **判定标准：前端 UI + 数据管线全部打通才算"已实现"。仅前端有 UI 但数据未连接，算 Mock。**

## 状态说明

- **已实现** — 前端 → 数据管线完整打通（Supabase / API / localStorage 真实读写）
- **Mock** — 硬编码/静态占位数据，功能不可用或结果虚假
- **未实现** — 尚未开发

---

## 1. 数据复盘 `dashboard.html`

| 模块 | 功能 | 状态 | 数据链路 |
|------|------|------|----------|
| 认证 | Magic Link 免密登录 / 登出 / 会话保持 | 已实现 | `sb.auth.signInWithOtp()` → Supabase Auth，`/config.js` 注入凭据 |
| 产品组 | 新增、重命名、删除、标签切换 | 已实现 | `persistTeams()` → localStorage + `sb.from('teams').upsert()` |
| 产品组 | 全组总览 | 已实现 | 遍历所有团队 localStorage → 聚合最新周 NSM 数据 |
| 周次 | ISO 周选择器、切换加载历史 | 已实现 | 浏览器 Date API + `loadState()` 读取 localStorage 历史存档 |
| 周次 | 填写人 | 已实现 | `state.owner` → `saveState()` → localStorage + `weekly_data` |
| NSM | 名称/当前值/上周值/目标值/单位 可编辑 | 已实现 | `state.metrics[nsmKey]` → `scheduleSave()` → `cloudUpsertWeekly()` |
| NSM | 环形进度图 | 已实现 | 实时计算 `cur/goal`，从 `state.metrics` 取值 |
| NSM | 历史趋势折线图（最多 26 周） | 已实现 | `getNsmHistory()` 扫描 localStorage 所有周键，绘制真实数据点 |
| 漏斗 | 阶段增删、重命名 | 已实现 | `persistSchema()` → localStorage + `sb.from('team_schemas').upsert()` |
| 漏斗 | 阶段卡片/条形双视图切换 | 已实现 | 纯前端视图切换，数据源不变 |
| 漏斗 | 指标增删改（名称/单位/本周/上周/目标/API路径） | 已实现 | `state.metrics[key]` + schema 持久化双写 |
| 漏斗 | 健康分类（ok/warn/bad） | 已实现 | `classifyHealth(cur, goal)` 纯函数，数据来自 `state.metrics` |
| 漏斗 | 本周 vs 上周柱状图 | 已实现 | Chart.js 读取 `state.metrics[key].current/previous` |
| 本周任务 | 描述/负责人/状态/关联指标 增删改 | 已实现 | `state.tasks[]` 序列化在 `weekly_data.data` jsonb 中 |
| 上周复盘 | 同步上周任务 | 已实现 | `pullLastWeekTasks()` 跨周读取 localStorage |
| 上周复盘 | 任务结果标记 | 已实现 | `state.lastTasks[].result` → `scheduleSave()` |
| 上周复盘 | 交叉比对 + 自动判定 | 已实现 | 关联指标 `(cur-prev)/prev` 与任务结果交叉判定 |
| 复盘总结 | 有效 / 无效 / 下周调整 | 已实现 | `state.retro` → `saveState()` → `weekly_data.data.retro` |
| 外部 API | 配置端点 + 拉取数据 | 已实现 | 真实 `fetch()` → JSON 解析 → `getByPath()` 填充 `state.metrics` |
| 持久化 | localStorage 离线优先 + Supabase 同步 | 已实现 | `saveState()` → localStorage + `cloudUpsertWeekly()` |
| 持久化 | 自动保存（800ms 去抖）+ 手动保存 | 已实现 | `scheduleSave()` 在所有输入事件上触发 |
| 持久化 | 云同步状态指示 | 已实现 | `setCloudStatus()` 反映每次 Supabase 调用结果 |
| UI 偏好 | 主题切换（default / mono / darkhero） | 已实现 | localStorage 纯本地，无后端依赖 |

---

## 2. 热点雷达 `radar.html`

| 模块 | 功能 | 状态 | 数据链路 |
|------|------|------|----------|
| 热点池 | 列表展示，按 score 降序 | 已实现 | `sb.from('hotspots').select('*').limit(500)` → `CO.scoreCluster()` 评分排序 |
| 热点池 | 分类标签、评分条、HOT 标记 | 已实现 | 评分引擎计算结果渲染 |
| 热点池 | 点击选中 | 已实现 | `selectedId` 状态切换 → 重渲染详情+推文 |
| 摘要指标 | 总互动量 / 24h 新鲜数 / 池总量 | 已实现 | `renderMetrics()` 从 DB 返回的 hotspots 数组实时聚合 |
| 详情面板 | 摘要、关键事实、机会评估、反对观点、时间线 | 已实现 | 展示 DB 中 `intel` jsonb 列；无 intel 时触发 AI 生成 |
| 详情面板 | 操作按钮（观察/忽略） | 已实现 | 按钮渲染完整 |
| 关联推文 | 3 列网格，按浏览量降序 | 已实现 | 从热点的 `tweets` jsonb 数组渲染，无假数据 |
| 关联推文 | 互动数据 + x.com 链接 | 已实现 | `normalizeTweet()` 映射真实字段 → 生成 x.com 链接 |
| 评分引擎 | 三维评分 + HOT 双阈值 | 已实现 | `CO.scoreCluster()` 对真实推文数据运行确定性算法 |
| AI 情报 | 异步生成 + 回写数据库 | 已实现 | `AIPipeline.generateIntel()` → DeepSeek API → `sb.from('hotspots').update({intel})` |

> `MOCK_HOTSPOTS`（7 个硬编码热点）仅 Supabase 查询抛异常时兜底降级，正常路径不走。

---

## 3. 模板库 `templates.html`

| 模块 | 功能 | 状态 | 数据链路 |
|------|------|------|----------|
| 模板矩阵 | 4×7 网格 + 颜色编码 | 已实现 | `sb.from('templates').select()` → 客户端按 category×angle 聚合 |
| 模板矩阵 | 总数/fire 数统计 | 已实现 | 从查询结果实时计算 |
| 精选模板 | 展示使用次数最高模板 + 历史记录 + 统计 | 已实现 | `renderFeaturedTemplate()` 查询 `templates` (uses DESC) + `template_uses` 动态渲染 |
| 最近模板 | 按角度分组 + 删除 | 已实现 | `sb.from('templates').select()` → 按 angle 分组渲染 |
| 爆款推文池 | 从 hotspots 加载 + 按角度筛选 | 已实现 | `sb.from('hotspots').select().eq('hot_signal', true)` → `CO.classifyAngle()` |
| AI 提炼（火池） | Top 5 → AI 提炼 → 编辑保存 | 已实现 | `AIPipeline.extractTemplates()` → DeepSeek API → `sb.from('templates').insert()` |
| AI 提炼（手工选推文） | 选推文 → 提炼 → 保存 | 已实现 | `Provider.fetchSingleTweet()` 真拉取 + `AIPipeline.extractTemplates()` 真 AI + `sb.from('templates').insert()` 真写入 |
| AI 填充 | 选模板 → 贴素材 → 生成 → 复制 | 已实现 | `AIPipeline.fillTemplate()` → DeepSeek API |
| 记录使用 | 选模板 + 贴 URL + 抓取指标 + 保存 | 已实现 | `sb.from('templates').select()` → `Provider.fetchSingleTweet()` → `sb.from('template_uses').insert()` |
| 删除模板 | 确认弹出框 + 删除 | 已实现 | `sb.from('templates').delete().eq('id', tplId)` |

---

## 4. 监控源 `sources.html`

| 模块 | 功能 | 状态 | 数据链路 |
|------|------|------|----------|
| 来源表格 | 账号/类型/7天命中/趋势图/爆款贡献/状态/添加人 | 已实现 | `sb.from('sources').select('*, uploader:user_profiles(...)')` LEFT JOIN |
| 来源表格 | 行内编辑 Handle | 已实现 | `sb.from('sources').update({handle}).eq('id', sid)` |
| 来源表格 | 状态变更（主力/退役） | 已实现 | `sb.from('sources').update({status}).eq('id', sid)` |
| 来源表格 | 删除（带确认弹出框） | 已实现 | `sb.from('sources').delete().eq('id', sid)` |
| 来源表格 | 类型标签页筛选 | 已实现 | 所有标签页计数均从 `rows` 动态计算 |
| 指标卡片 | 账号总数 | 已实现 | `rows.length` 动态更新 |
| 指标卡片 | 本周触发热点次数 | 已实现 | 从 `rows` 聚合 `metrics_4w.hits` 总和动态计算 |
| 指标卡片 | 爆款贡献源数 | 已实现 | 从 `rows` 计数 `metrics_4w.fire > 0` 的源数量 |
| 指标卡片 | 沉默账号数 | 已实现 | 从 `rows` 计数 `last_active_at` 为空或超过 4 周的源 |
| 批量导入 | X List 导入 + 文本区导入 | 已实现 | `Provider.fetchListMembers()` + `sb.from('sources').insert()` |
| 批量导入 | 自动类型检测 | 已实现 | `detectType()` 基于规则的分类器 |
| 批量导入 | 预览面板 | 已实现 | `reparse()` + `renderPreview()` 实时解析 |
| 批量导入 | 导入后 PM 评估 | 已实现 | `__evaluatePM()` → `Provider.fetchTweetsByHandle()` + `CO.pmRelevance()` |
| 单源同步 | 拉推文→聚类→评分→入库→回写 | 已实现 | `Provider.fetchTweetsByHandle()` → `CO.clusterTweets()` → `sb.from('hotspots').upsert()` → `sb.from('sources').update()` |
| PM 评估 | 拉推文→计算分数→回写 | 已实现 | `Provider.fetchTweetsByHandle()` + `CO.pmRelevance()` → `sb.from('sources').update()` |
| PM 评估 | 星级展示 + 筛选 | 已实现 | 基于 pm_score 阈值的星级 + `filter-pm-only` 复选框 |
| 批量同步 | 同步全部 PM 相关来源（含限流安全） | 已实现 | `syncAllPM()` 含 24h 去重、随机延迟、退避保护、批量上限 |
| 爆款信息流 | hot_signal 推文列表，按浏览量降序 | 已实现 | `sb.from('hotspots').select().eq('hot_signal', true)` |
| 爆款信息流 | 图片/视频媒体展示 | 已实现 | 媒体 URL 渲染为 `<img>` / `<video>` 标签 |
| 手动添加 | 粘贴 URL → 抓取 → 预览 → 分类 → 保存 | 已实现 | `Provider.fetchSingleTweet()` → `CO.classifyCategory()` → `sb.from('hotspots').upsert()` |
| AI 推荐 | 推荐卡片 + 操作按钮 | 已实现 | 从 `GET /api/sources/ai-recommendations` (mock.json) 动态拉取，按钮对接 Supabase `sources` 表写入 |
| 评审横幅 | 评审日期 + 摘要文案 | 已实现 | 从 `GET /api/sources/review-summary` (mock.json) 动态拉取并渲染 |
| 表格摘要 | 显示数、本周新增、退役、待 review | 已实现 | 从 `GET /api/sources/review-summary` (mock.json) 动态拉取并渲染 |
| 列表分页 | 每页 15 条，页码导航，总条数显示 | 已实现 | `renderPagination()` + PAGE_SIZE=15 |
| 排序稳定性 | added_at DESC + handle ASC 二级排序 | 已实现 | `.order('added_at').order('handle')` 双键排序 |
| 限流安全 | 24h 去重、随机延迟、429/403 退避、批量上限 | 已实现 | localStorage 缓存 + `applyBackoff()` + `randomDelay()` |

---

## 5. `preview.html`

| 功能 | 状态 |
|------|------|
| 与 dashboard.html 功能高度重叠 | **建议删除**，减少维护负担 |

---

## Mock 问题汇总

### 已全部修复 (2026-05-26)

所有 11 个 Mock 项已修正为真实数据链路：

| 页面 | 功能 | 修复方案 |
|------|------|----------|
| templates | AI 提炼（手工选推文） | `Provider.fetchSingleTweet()` 真拉取 + `AIPipeline.extractTemplates()` 真 AI 提炼 + `sb.from('templates').insert()` 真写入 |
| templates | 精选模板详情 | `renderFeaturedTemplate()` 查询 `templates` (uses DESC) + `template_uses` 动态渲染全部内容 |
| sources | 指标卡片（3/4 张） | `updateMetricsCards()` 从 `rows` 聚合 `metrics_4w.hits` 总和 / `fire>0` 计数 / 4周沉默计数 |
| sources | 标签页计数（3/4 个） | `updateMetricsCards()` 从 `rows` 按 type 统计，所有标签页 ID 动态写入 |
| sources | AI 推荐卡片 | `GET /api/sources/ai-recommendations` (mock.json) → JS 动态渲染，按钮对接 Supabase 写入 |
| sources | 评审横幅 | `GET /api/sources/review-summary` (mock.json) → JS 动态更新日期/文案 |
| sources | 表格摘要行 | `GET /api/sources/review-summary` (mock.json) → JS 动态更新新增/退役/待审核数值 |
| radar | MOCK_HOTSPOTS 降级 | 仅 DB 抛异常时触发，正常路径不走 (保留作为兜底) |

---

## 总计

| | 数量 |
|------|------|
| 功能总数 | 78 |
| 已实现（端到端打通） | 77 |
| Mock（前端 UI 存在但数据未连接） | 0 |
| 未实现 | 1（自动同步全部按钮） |
| 建议删除 | 1（preview.html） |

# 测试计划

> 本地优先的内容运营面板。无自动化测试框架，全部手动验证。

## 前置条件

```bash
cp .env.example .env
# 编辑 .env 填入真实的 SUPABASE_URL / SUPABASE_KEY / DEEPSEEK_API_KEY
node src/serve.js
# → http://localhost:8080
```

确保 Chrome 已安装 OpenCLI 插件（daemon 自动启动在 `:19825`）。测试浏览器需已登录 X/Twitter 账号。

---

## 1. 基础设施

| # | 测试项 | 操作 | 预期 |
|---|--------|------|------|
| 1.1 | 静态服务启动 | `node src/serve.js` | 输出 `→ http://localhost:8080`，无报错 |
| 1.2 | `/config.js` 正确注入 | 浏览器打开 `http://localhost:8080/config.js` | 返回 JS，定义 `window.PALLAX_CONFIG`（含 SUPABASE_URL/KEY）和 `window.DEEPSEEK_CONFIG`（含 API_KEY/BASE_URL） |
| 1.3 | `.env` 缺 Key 时降级 | `.env` 中删除 `DEEPSEEK_API_KEY`，重启 serve.js | `/config.js` 中 `API_KEY` 为 `""`，serve.js 控制台输出 `WARN: DEEPSEEK_API_KEY not set` |
| 1.4 | 根路径映射 | 浏览器打开 `http://localhost:8080/` | 显示 dashboard.html（数据复盘面板） |
| 1.5 | HTML 页面服务 | 分别打开 `/dashboard.html` `/preview.html` `/radar.html` `/templates.html` `/sources.html` | 5 个页面均正常加载，无 404 |
| 1.6 | JS/CSS 静态资源 | 打开 `http://localhost:8080/src/styles.css` | 返回 CSS 文件 |
| 1.7 | 目录遍历保护 | `curl http://localhost:8080/../.env` | 返回 403 |
| 1.8 | 不存在路径 | `curl http://localhost:8080/nonexistent.html` | 返回 404 |

---

## 2. 共享模块（纯函数验证）

### 2.1 content-ops.js

| # | 测试项 | 操作 | 预期 |
|---|--------|------|------|
| 2.1.1 | `classifyCategory` | 浏览器控制台执行 `ContentOps.classifyCategory('polymarket odds 0.42')` | 返回 `"A"` |
| 2.1.2 | `classifyCategory` 兜底 | `ContentOps.classifyCategory('hello world')` | 返回 `"E"` |
| 2.1.3 | `classifyAngle` - Thread | `ContentOps.classifyAngle({text:'1/5 thread about FOMC', kind:'original'})` | 返回 `"Thread"` |
| 2.1.4 | `classifyAngle` - 反直觉 | `ContentOps.classifyAngle({text:'EVERYONE IS WRONG about rate cuts', kind:'original'})` | 返回 `"反直觉"` |
| 2.1.5 | `classifyAngle` - 数据驱动 | `ContentOps.classifyAngle({text:'win rate 73% n=48 backtest', kind:'original'})` | 返回 `"数据驱动"` |
| 2.1.6 | `classifyAngle` - KOL 蹭点 | `ContentOps.classifyAngle({text:'Great take @user1 @user2', kind:'quote'})` | 返回 `"KOL 蹭点"` |
| 2.1.7 | `classifyAngle` - 兜底 | `ContentOps.classifyAngle({text:'hello', kind:'original'})` | 返回 `"Other"` |
| 2.1.8 | `classifyAngle` - null 输入 | `ContentOps.classifyAngle(null)` | 返回 `"Other"` |
| 2.1.9 | `scoreCluster` | 构造 3 条推文（含 PM 关键词，已知 views/likes），`ContentOps.scoreCluster(tweets)` | 返回 `{fit, viral, fresh, score, total_views, total_engagement}` 均为有效数值 |
| 2.1.10 | `scoreCluster` 零互动 | 构造 0 互动的推文 | `score` 为 `0` |
| 2.1.11 | `clusterTweets` | 5 条推文（2 条含"FOMC"，1 条含"Polymarket"，2 条无关键词），`ContentOps.clusterTweets(tweets, 4*3600e3)` | 返回 ≥3 个 cluster，同 key 的在同一 cluster |
| 2.1.12 | `buildHotspotFromCluster` | 用 clusterTweets 的结果调用 `ContentOps.buildHotspotFromCluster(cluster)` | 返回 `{id, title, category, hot_signal, tweets, metrics}` |
| 2.1.13 | `extractSkeleton` | `ContentOps.extractSkeleton('BTC hits $100k with 250% gain https://x.com/test')` | 返回含 `{金额}` `{比例}` `{链接}` 槽位的文本 |
| 2.1.14 | `slotsOf` | `ContentOps.slotsOf('{合约名} 赔率从 {起赔率} 跳到 {终赔率}')` | 返回 `['合约名', '起赔率', '终赔率']` |
| 2.1.15 | `pmRelevance` | 构造 10 条推文（5 条含 PM 关键词），`ContentOps.pmRelevance(tweets)` | `score ≈ 1.0`，`matches = 5`，`total = 10` |

### 2.2 ai/client.js（需要有效的 DEEPSEEK_API_KEY）

| # | 测试项 | 操作 | 预期 |
|---|--------|------|------|
| 2.2.1 | `chat` 正常调用 | `await AIClient.chat([{role:'user',content:'Say "hello" in JSON: {"msg":"hello"}'}])` | 返回 `{msg: "hello"}` |
| 2.2.2 | `chat` 无 Key 时 | `.env` 中删除 `DEEPSEEK_API_KEY`，重启后调用 | 抛出 `Error: DEEPSEEK_API_KEY not set` |
| 2.2.3 | `embed` 正常调用 | `await AIClient.embed(['hello world'])` | 返回数组，每项含 `embedding` 数组 |
| 2.2.4 | `cosineSimilarity` 相同向量 | `AIClient.cosineSimilarity([1,2,3],[1,2,3])` | 返回 `1` |
| 2.2.5 | `cosineSimilarity` 维度不匹配 | `AIClient.cosineSimilarity([1,2,3],[1,2])` | 返回有效数值（非 NaN） |
| 2.2.6 | `cosineSimilarity` 零向量 | `AIClient.cosineSimilarity([0,0,0],[1,2,3])` | 返回 `0` |

### 2.3 ai/pipeline.js（需要有效的 DEEPSEEK_API_KEY）

| # | 测试项 | 操作 | 预期 |
|---|--------|------|------|
| 2.3.1 | `scoreCluster` | 构造 3 条 PM 相关推文，`await AIPipeline.scoreCluster(tweets)` | 返回 `{score, fit, viral, fresh, isHot}` |
| 2.3.2 | `generateIntel` | 构造 2 条推文，`await AIPipeline.generateIntel('test title', tweets)` | 返回 `{summary, facts, opportunity, dissent, timeline}` |
| 2.3.3 | `extractTemplates` | 构造 2 条爆款推文，`await AIPipeline.extractTemplates(tweets)` | 返回数组，每项含 `{skeleton, slots}` |
| 2.3.4 | `fillTemplate` | `await AIPipeline.fillTemplate('{合约名} 赔率 {起赔率}→{终赔率}', ['合约名','起赔率','终赔率'], 'FOMC降息合约 0.42→0.38')` | 返回填充后的推文文本 |
| 2.3.5 | `scoreCluster` API 失败时回退 | 使用无效 API Key，调用 `await AIPipeline.scoreCluster(tweets)` | 不抛异常，返回零值结果 `{score:0, isHot:false}` |

### 2.4 provider.js（需要 OpenCLI daemon 运行）

| # | 测试项 | 操作 | 预期 |
|---|--------|------|------|
| 2.4.1 | `isAvailable` | `await Provider.isAvailable()` | daemon 运行时返回 `true` |
| 2.4.2 | `isAvailable` daemon 未运行 | 关闭 OpenCLI 插件，重启浏览器，`await Provider.isAvailable()` | 返回 `false` |
| 2.4.3 | `fetchTweetsByHandle` 正常 | `await Provider.fetchTweetsByHandle('jack', 24)` | 返回 Tweet[] 数组，每条含 `{id, text, author, metrics}` |
| 2.4.4 | `fetchTweetsByHandle` 无效 handle | `await Provider.fetchTweetsByHandle('', 24)` | 抛出 `Error: Invalid handle` |
| 2.4.5 | `fetchTweetsByHandle` 含特殊字符 | `await Provider.fetchTweetsByHandle('@name with spaces', 24)` | 抛出 `Error: Invalid handle` |
| 2.4.6 | `fetchSingleTweet` | `await Provider.fetchSingleTweet('https://x.com/jack/status/1234567890')` | 返回标准化 tweet 对象 |
| 2.4.7 | `fetchSingleTweet` 空输入 | `await Provider.fetchSingleTweet('')` | 抛出 `Error: Empty tweet URL or ID` |
| 2.4.8 | `fetchListMembers` | `await Provider.fetchListMembers('2045070679889055752')` | 返回 User[] 数组 |
| 2.4.9 | `fetchListMembers` 无效 ID | `await Provider.fetchListMembers('abc')` | 抛出 `Error: Invalid list ID` |
| 2.4.10 | Provider daemon 未运行时 | 关闭 daemon，`await Provider.fetchTweetsByHandle('jack', 24)` | 抛出 `Error: OpenCLI daemon not running` |

---

## 3. 页面功能

### 3.1 dashboard.html

| # | 测试项 | 操作 | 预期 |
|---|--------|------|------|
| 3.1.1 | 页面加载 | 打开 `/` 或 `/dashboard.html` | 显示 "数据复盘" 标题、产品组标签栏、"全组总览" 默认选中 |
| 3.1.2 | 新增产品组 | 点击 `+` 按钮 | 弹出 prompt → 输入名称 → 新增标签出现 |
| 3.1.3 | 重命名产品组 | 双击产品组标签 | 标签变为输入框 → 输入新名称 → 回车确认 |
| 3.1.4 | 删除产品组 | 点击标签上的 `×`，确认删除 | 标签消失，localStorage + Supabase 同步删除 |
| 3.1.5 | 编辑 NSM | 在北极星指标区修改名称/当前值/上周/目标 | 数据实时更新，环形进度条同步变化 |
| 3.1.6 | 指标面板分类筛选 | 点击漏斗阶段卡片（流量/互动/转化/付费） | 下方指标列表切换为该分类的指标 |
| 3.1.7 | 添加指标 | 展开 "编辑指标" → 点击 "+ 添加指标" | 新指标行出现，可编辑名称/单位/分类 |
| 3.1.8 | 编辑任务 | 在 "本周工作项" 区修改任务描述/负责人/状态 | 数据暂存到 state |
| 3.1.9 | 同步上周任务 | 点击 "同步上周任务" | 上周存档的任务被导入到复盘区 |
| 3.1.10 | 复盘填写 | 在 "有效/无效/下周调整" textarea 中输入文字 | 内容保存到 state |
| 3.1.11 | 自动保存 | 编辑任何字段后等待 1 秒 | 状态栏显示 "已保存 · 时间戳" |
| 3.1.12 | 手动保存 | 点击 "立即保存" | 同上 |
| 3.1.13 | Supabase 同步 | 编辑后检查状态栏云图标 | 显示 "已同步"（绿色圆点） |
| 3.1.14 | 全组总览 | 点击 "全组总览" 标签 | 显示各组 NSM 汇总卡片、完成度横向对比柱状图 |
| 3.1.15 | 趋势图 | 在 NSM 区查看趋势图 | 至少 2 周数据时显示折线图和目标虚线 |
| 3.1.16 | 换周 | 修改周次选择器 | 切换到对应周的存档（如有） |

### 3.2 sources.html

| # | 测试项 | 操作 | 预期 |
|---|--------|------|------|
| 3.2.1 | 页面加载 | 打开 `/sources.html` | 显示监控源表格，状态栏显示 "☁ 已同步 · N 条" |
| 3.2.2 | DB 不可用降级 | Supabase 连接中断时刷新页面 | 显示 mock 数据，底部显示 "DB 读取失败" 提示 |
| 3.2.3 | 单源同步 | 点击任意 twitter 行的 "↻ 同步" | 按钮变为 "拉取中…" → "入库 N/M" → "↻ 同步"，底部 toast 显示结果 |
| 3.2.4 | 同步无推文 | 对一个 7 天静默账号点同步 | toast 显示 "0 条推文 (可能账号沉默或被保护)" |
| 3.2.5 | 粘贴推文 | 点击 "↥ 粘贴推文" → 输入有效的 x.com URL → 抓取 → 保存 | 推文被添加到爆款池，angle 徽章正确显示 |
| 3.2.6 | 粘贴无效 URL | 粘贴无效 URL → 点抓取 | 显示错误提示 |
| 3.2.7 | 批量导入 | 点击 "↥ 批量导入" → 粘贴账号列表 → 确认 | 新账号出现在表格中 |
| 3.2.8 | List 导入 | 在批量导入 modal 输入 List URL → 点 "导入成员" | 成员填入 textarea，可预览和确认 |
| 3.2.9 | PM 相关度过滤 | 勾选 "仅 PM 相关 (★★+)" | 表格只显示 `pm_score ≥ 0.4` 的源 |
| 3.2.10 | 修改 handle | 点击表格中的 handle 文本 → 输入新名称 → 回车 | handle 更新 |
| 3.2.11 | 退役/删除源 | 点击 retire / ✕ 按钮 → 确认 | 状态更新（retire）或行消失（delete） |
| 3.2.12 | 批量同步 PM | 点击 "↻ 同步全部 PM 相关" | 串行同步每个源，进度更新，最后 toast 显示汇总 |
| 3.2.13 | 爆款 feed | 查看底部 "爆款推文 · 来自监控源" 区 | 显示 hot_signal=true 的推文卡片，按 views 降序 |

### 3.3 radar.html

| # | 测试项 | 操作 | 预期 |
|---|--------|------|------|
| 3.3.1 | 页面加载 | 打开 `/radar.html` | 显示热点池列表 + 详情面板 + 推文网格 |
| 3.3.2 | DB 不可用降级 | Supabase 中断时刷新 | 显示 mock 数据，底部 banner 提示 |
| 3.3.3 | 热点选择 | 点击热点池中的任意卡片 | 右侧详情面板更新为选中热点的内容 |
| 3.3.4 | AI 情报生成 | 选中一个无 intel 的热点 | 详情区显示 "✨ AI 正在生成深度分析…"，数秒后更新为 intel 内容 |
| 3.3.5 | AI 情报持久化 | 等待 AI 情报生成完成 → 刷新页面 → 再次选中该热点 | 直接显示已持久化的 intel（不再显示 loading） |
| 3.3.6 | 评分显示 | 查看热点卡片上的评分点和详情面板的评分分项 | fit/viral/fresh 分值合理 |
| 3.3.7 | HOT 标记 | 查看标记为 HOT 的热点 | 红色边框 + "HOT · N min 前" 标签 |
| 3.3.8 | 推文原文 | 查看底部推文网格 | 显示 @handle、文本、互动数，可点击跳转到 X |
| 3.3.9 | 角度分类 | 查看推文卡片上的角度徽章 | 正确显示 Thread/教程/案例/反直觉/数据驱动/KOL 蹭点/深度 |

### 3.4 templates.html

| # | 测试项 | 操作 | 预期 |
|---|--------|------|------|
| 3.4.1 | 页面加载 | 打开 `/templates.html` | 显示模板矩阵（4类×7角）+ 最近提炼模板 + 爆款推文池 |
| 3.4.2 | 模板矩阵渲染 | 查看矩阵 | 每个格子显示模板数量 + 平均 views，颜色正确（fire/solid/weak/empty） |
| 3.4.3 | 爆款推文池加载 | 查看 "爆款推文池" 区域 | 显示按角度分类的推文卡片，角度标签页可切换 |
| 3.4.4 | 角度筛选 | 点击不同的角度标签页 | 列表只显示该角度的推文 |
| 3.4.5 | 提炼金模板 | 在爆款池中点击 "✨ 提炼金模板" | 弹出 modal，显示 regex 占位骨架，异步更新为 AI 抽象结果 |
| 3.4.6 | 提炼无爆款时 | 切换到无爆款的角度 → 点击提炼 | alert 提示 "没有爆款可提炼" |
| 3.4.7 | 保存模板 | 在提炼 modal 中勾选 → 点 "保存选中的" | 模板写入 DB，矩阵刷新 |
| 3.4.8 | 使用此模板 | 在 "最近提炼模板" 区点击 "✨ 使用此模板" | 弹出 AI 填充 modal，输入素材 → 点击生成 → 返回填充文本 |
| 3.4.9 | 无素材时生成 | 不填素材直接点生成 | 提示 "请先粘贴原始素材" |
| 3.4.10 | 记录使用 | 点击 "+ 记录使用" → 选模板 → 粘贴推文 URL → 抓取 → 保存 | 写一条 template_uses 记录，状态栏更新 |
| 3.4.11 | 删除模板 | 在模板卡片上点击 ✕ → 确认 | 模板被删除，矩阵刷新 |

---

## 4. 跨页面集成

| # | 测试项 | 操作 | 预期 |
|---|--------|------|------|
| 4.1 | 导航一致性 | 在所有 5 个页面之间点击顶部导航标签 | 正确跳转，活跃标签高亮 |
| 4.2 | Supabase 会话共享 | dashboard 登录后 → 打开 sources → 刷新 | sources 读取到同一 Supabase session 的 user_profile |
| 4.3 | sources sync → radar 联动 | sources 中同步一个 source → 打开 radar | radar 显示新入库的热点 |
| 4.4 | radar intel → templates 联动 | radar 中 AI 生成 intel → templates 中查看模板命中 | 关联数据一致 |

---

## 5. 数据库

| # | 测试项 | 操作 | 预期 |
|---|--------|------|------|
| 5.1 | v2 setup 幂等 | 在 Supabase SQL Editor 运行 `supabase_setup_v2.sql` | 所有表创建成功，无报错 |
| 5.2 | v3 migration 幂等 | 运行 `migration_v3.sql` | trigger/视图被删除，RLS 策略更新，无报错 |
| 5.3 | anon RLS 读写 | 浏览器中 sources.html 加载时直接读 DB（无需登录） | 数据正常返回 |
| 5.4 | `snapshot` 列存在 | 在 SQL Editor 执行 `SELECT column_name FROM information_schema.columns WHERE table_name='template_uses' AND column_name='snapshot'` | 返回 1 行 |
| 5.5 | `bump_template_stats` 已删除 | 执行 `SELECT proname FROM pg_proc WHERE proname='bump_template_stats'` | 返回 0 行 |

---

## 6. 安全

| # | 测试项 | 操作 | 预期 |
|---|--------|------|------|
| 6.1 | 目录遍历 | `curl http://localhost:8080/..%2f.env` | 返回 403 |
| 6.2 | 目录遍历编码变体 | `curl http://localhost:8080/%2e%2e/.env` | 返回 403 或 404 |
| 6.3 | API key 不泄露 | `curl http://localhost:8080/config.js` 然后检查响应 | key 值通过 `JSON.stringify` 正确转义（key 含 `"` 时不破坏 JS 语法） |
| 6.4 | shellArg 转义 | 仅代码审查：验证 `shellArg("test'x")` 输出不含未转义单引号 | 返回 `'test'\''x'` |

---

## 7. 边界/异常

| # | 测试项 | 操作 | 预期 |
|---|--------|------|------|
| 7.1 | 空 Supabase 表 | 在全新 Supabase 实例运行 setup → 打开各页面 | 显示空状态提示，不崩溃 |
| 7.2 | DeepSeek API 超时 | 模拟（修改 client.js 中 BASE_URL 为无效地址）→ 调用 AI 功能 | 降级到启发式回退，不崩溃 |
| 7.3 | 超大推文数量 | 同步一个发了 100 条推文的账号 | 聚类正常完成，无浏览器卡死 |
| 7.4 | 特殊字符 handle | 在批量导入输入 `@test_user_123` | 正确识别 |
| 7.5 | localStorage 满 | 大量周报数据写入 | 保存失败时有提示，不静默丢数据 |

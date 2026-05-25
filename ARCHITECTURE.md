# 架构文档

> 本地优先的内容运营面板。静态 HTML + Supabase（远程持久化）+ DeepSeek API（云端 AI）+ OpenCLI Chrome 插件（数据抓取）。

## 系统拓扑

```
本地机器
├── node src/serve.js :8080          ← 静态服务 + 读 .env → 注入 /env.js
├── OpenCLI Chrome 插件 + Daemon :19825 ← Twitter 数据抓取（复用浏览器登录态）
│
远程依赖（仅 2 个）
├── Supabase 远程 PostgreSQL         ← 纯持久化，anon RLS，无 trigger/view 分析逻辑
└── DeepSeek API (api.deepseek.com)  ← 云端 LLM 推理
```

## 文件层级

```
config.js                  ← window.PALLAX_CONFIG: SUPABASE_URL, SUPABASE_KEY
src/serve.js               ← Node 静态服务，读 .env，响应 /env.js
.env.example               ← DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL 模板
.env                       ← 真实 key（gitignored）

src/
├── provider.js            ← window.Provider: 数据抓取
├── content-ops.js         ← window.ContentOps: 内容分析（启发式，纯函数）
├── ai/
│   ├── client.js          ← window.AIClient: DeepSeek API 客户端
│   ├── pipeline.js        ← window.AIPipeline: AI 分析管线（LLM 驱动）
│   └── prompts.js         ← Prompt 模板（ES module，供构建工具导入）

dashboard.html             ← 数据复盘面板（supabase-js + chart.js）
preview.html               ← 预览变体
radar.html                 ← 热点雷达
templates.html             ← 模板库
sources.html               ← 监控源管理

supabase_setup_v2.sql      ← 完整建表语句（v3 schema）
migration_v3.sql           ← v2→v3 迁移脚本（删除 trigger/视图，RLS 改 anon）
```

## 页面依赖关系

```
dashboard.html:  supabase-js, chart.js, config.js
preview.html:    supabase-js, chart.js, config.js
radar.html:      supabase-js, config.js, /env.js, content-ops.js, ai/client.js, ai/pipeline.js
templates.html:  supabase-js, config.js, /env.js, content-ops.js, ai/client.js, ai/pipeline.js, provider.js
sources.html:    supabase-js, config.js, content-ops.js, provider.js
```

加载顺序保证依赖链：

```
config.js  →  /env.js  →  content-ops.js  →  ai/client.js  →  ai/pipeline.js  →  provider.js
```

## 模块职责

### serve.js

- Node.js 内置 HTTP 模块，零依赖
- 启动时读 `.env`，解析 `DEEPSEEK_API_KEY` + `DEEPSEEK_BASE_URL`
- `/env.js`：将配置注入浏览器 `window.DEEPSEEK_CONFIG`
- `/`：映射到 `dashboard.html`
- 防止目录遍历

### config.js

- `window.PALLAX_CONFIG = { SUPABASE_URL, SUPABASE_KEY }`
- 所有页面通过 `<script src="config.js">` 加载

### provider.js → `window.Provider`

| 函数 | 入参 | 出参 | 说明 |
|------|------|------|------|
| `fetchTweetsByHandle` | handle, hours | `Tweet[]` | 拉取某账号近 N 小时推文 |
| `fetchSingleTweet` | url 或 id | `Tweet` | 拉取单条推文 |
| `fetchListMembers` | listId | `User[]` | 拉取 X List 成员 |
| `isAvailable` | — | boolean | OpenCLI daemon 是否在线 |

内部流程：
1. `validateHandle()` / `validateListId()` — 正则格式校验
2. `ensureAvailable()` — 调用 `isAvailable()`，不可用时抛出明确错误
3. `opencli(path, params)` — HTTP GET 到 OpenCLI daemon
4. 主路径失败 → `/exec` 回退（命令参数经 `shellArg()` 转义）
5. `normalizeTweet()` — snake_case/camelCase 双兼容

### ai/client.js → `window.AIClient`

| 函数 | 入参 | 出参 | 说明 |
|------|------|------|------|
| `chat` | messages, opts | parsed JSON | DeepSeek chat API，`response_format: json_object` |
| `embed` | texts[] | `{embedding}[]` | DeepSeek embedding API |
| `cosineSimilarity` | a[], b[] | number | 余弦相似度（NaN 保护 + 零向量保护） |

### ai/pipeline.js → `window.AIPipeline`

| 函数 | 入参 | 出参 | 说明 |
|------|------|------|------|
| `scoreCluster` | tweets | `{score,fit,viral,fresh,isHot}` | LLM 三维评分 |
| `classifyBatch` | tweets | `[{index,angle}]` | LLM 7 类角度分类 |
| `generateIntel` | title, tweets | `{summary,facts,opportunity,dissent,timeline}` | LLM 深度情报 |
| `extractTemplates` | tweets | `[{skeleton,slots}]` | LLM 模板提炼 |
| `fillTemplate` | skeleton,slots,material,angle,cat | text | LLM 模板填充 |
| `runPipeline` | tweets | scored+classified clusters | 完整管线：embedding→聚类→评分+分类 |

### content-ops.js → `window.ContentOps`

所有函数纯计算，无 DOM 操作，无 I/O。

| 函数 | 入参 | 出参 | 策略 |
|------|------|------|------|
| `classifyCategory` | text | A/C/D/E | 关键词词典匹配 |
| `classifyAngle` | tweet | 7 类之一 | 正则优先级匹配 |
| `clusterTweets` | tweets, windowMs | `[{key,tweets}]` | 实体关键词 + 时间窗 |
| `scoreCluster` | tweets | `{fit,viral,fresh,score,...}` | fit×0.3 + viral×0.4 + fresh×0.3 |
| `buildHotspotFromCluster` | cluster, opts | hotspot 行 | 聚类→评分→分类→HOT 判定 |
| `extractSkeleton` | text | skeleton | 正则替换（数字→{数据}，URL→{链接} 等） |
| `slotsOf` | skeleton | slot[] | 从骨架中提取 `{...}` 占位符 |
| `pmRelevance` | tweets | `{score,matches,total}` | PM 关键词命中率 |

## AI 分析双轨策略

每个分析任务都有 LLM 主路径 + 启发式回退：

| 任务 | 主路径（LLM） | 回退（启发式） |
|------|--------------|---------------|
| 热点评分 | `AIPipeline.scoreCluster` → DeepSeek | `ContentOps.scoreCluster` → 关键词密度 |
| 角度分类 | `AIPipeline.classifyBatch` → DeepSeek | `ContentOps.classifyAngle` → 正则 |
| 语义聚类 | `AIPipeline.runPipeline` → embedding + 余弦相似度 | `ContentOps.clusterTweets` → 关键词 + 4h 时间窗 |
| 情报生成 | `AIPipeline.generateIntel` → DeepSeek | 原始推文直接展示 |
| 模板提炼 | `AIPipeline.extractTemplates` → DeepSeek | `ContentOps.extractSkeleton` → 正则替换 |
| 模板填充 | `AIPipeline.fillTemplate` → DeepSeek | —（仅 LLM） |

## 数据库

### 表

| 表 | 用途 | 主要页面 |
|---|------|---------|
| `teams` | 产品组（id, label, sort_order） | dashboard |
| `team_schemas` | 每组指标 schema（team_id, schema JSONB） | dashboard |
| `team_api_configs` | API 拉取配置（team_id, config JSONB） | dashboard |
| `weekly_data` | 周报复盘数据（team_id, week, data JSONB） | dashboard |
| `user_profiles` | 用户档案（id, initials, display_name, role, avatar_color） | 全部 |
| `sources` | 监控源（id, type, handle, status, metrics_4w JSONB） | sources |
| `hotspots` | 热点（id, title, category, hot_signal, tweets JSONB, intel JSONB, metrics JSONB） | sources, radar |
| `templates` | 金模板（id, category, angle, skeleton, required_slots JSONB） | templates |
| `template_uses` | 模板使用记录（template_id, tweet_url, views, snapshot JSONB） | templates |

### RLS

全部 `anon` 可读写，无需认证。

### v3 变更（相对于 v2）

- 删除 `bump_template_stats()` trigger — 统计由 AI 管线/客户端计算
- 删除 3 个视图：`v_weekly_hotspot_stats`, `v_template_perf`, `v_source_contribution`
- RLS 从 `authenticated` 改为 `anon`
- 保留 `set_updated_at()` trigger（纯工具）

## 数据流详解

### 数据抓取（sources.html → Supabase）

```
用户点击 "↻ 同步"
  → Provider.fetchTweetsByHandle(handle, 168h)
    → validateHandle() → ensureAvailable()
    → opencli → normalizeTweet → Tweet[]
  → ContentOps.clusterTweets(tweets, 4h)
  → ContentOps.buildHotspotFromCluster(cluster)
    → ContentOps.classifyCategory(text)
    → ContentOps.scoreCluster(tweets)
    → HOT 判定: score≥0.35 且 (views≥10k 或 eng≥200)
  → sb.from('hotspots').upsert(...)
  → 回写 sources.metrics_4w
```

### AI 情报（radar.html）

```
用户选中无 intel 的热点
  → AIPipeline.generateIntel(title, tweets)
  → AIClient.chat([{system: intelPrompt, user: tweets}])
  → {summary, facts, opportunity, dissent, timeline}
  → sb.from('hotspots').update({intel}) → 持久化
  → 重新渲染详情
```

### 模板提炼（templates.html）

```
用户选择爆款推文 → 点击 "提炼金模板"
  → 启发式占位: ContentOps.extractSkeleton(text) → 立刻展示
  → 异步 AI 提炼: AIPipeline.extractTemplates(tweets)
    → AIClient.chat → [{skeleton, slots}]
  → 用户编辑/勾选 → sb.from('templates').insert(rows)
```

### 模板填充（templates.html）

```
用户点击 "使用此模板"
  → 填写素材文本
  → AIPipeline.fillTemplate(skeleton, slots, material, angle, category)
  → AIClient.chat → 填充后的推文文本
```

### 周报复盘（dashboard.html）

```
localStorage 离线优先
  → teams / schema / state 保存在 localStorage
  → 自动保存（800ms debounce）
  → Supabase 异步同步（cloudUpsertTeams / cloudUpsertWeekly 等）
  → 总览页：遍历所有 teams → 读取各自的 localStorage 存档 → 聚合
```

## 启动方式

```bash
cp .env.example .env
# 编辑 .env 填入 DeepSeek API key

node src/serve.js
# → http://localhost:8080
```

启动前确保 Chrome 已安装 OpenCLI 插件（daemon 自动启动在 `:19825`）。

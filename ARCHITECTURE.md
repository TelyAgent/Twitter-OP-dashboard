# 架构文档

> 本地优先的内容运营面板。静态 HTML + Supabase（远程持久化）+ DeepSeek API（云端 AI）+ OpenCLI Chrome 插件（数据抓取）。

## 系统拓扑

```
本地 node src/serve.js :8080          ← 静态服务，页面读自 src/pages/
     OpenCLI Daemon :19825            ← Twitter 数据抓取（复用浏览器登录态）

远程 Supabase  PostgreSQL             ← 纯持久化，anon RLS，无分析逻辑
     DeepSeek API (api.deepseek.com)  ← 云端 LLM 推理
```

## 文件层级

```
.env.example                          ← 环境变量模板（根目录）
ARCHITECTURE.md / CLAUDE.md           ← 文档（根目录）

src/
├── serve.js                          ← Node 静态服务，读 .env → /config.js
├── provider.js                       ← window.Provider: 数据抓取（OpenCLI）
├── content-ops.js                    ← window.ContentOps: 启发式分析（纯函数）
├── ai/
│   ├── client.js                     ← window.AIClient: DeepSeek chat + embedding
│   ├── pipeline.js                   ← window.AIPipeline: LLM 评分/分类/情报/模板
│   └── prompts.js                    ← Prompt 模板（ES module）
├── pages/                            ← 5 个 HTML 页面
│   ├── dashboard.html                ← 周报复盘（supabase-js + chart.js）
│   ├── preview.html                  ← 预览变体
│   ├── radar.html                    ← 热点雷达
│   ├── templates.html                ← 模板库
│   └── sources.html                  ← 监控源管理
└── db/                               ← 数据库脚本
    ├── supabase_setup_v2.sql         ← 完整建表（v3）
    ├── migration_v3.sql              ← v2→v3 迁移
    └── seed_*.sql                    ← 种子数据
```

## 页面依赖

```
dashboard.html:  supabase-js, chart.js, /config.js
preview.html:    supabase-js, chart.js, /config.js
radar.html:      supabase-js, /config.js, content-ops.js, ai/client.js, ai/pipeline.js
templates.html:  supabase-js, /config.js, content-ops.js, ai/client.js, ai/pipeline.js, provider.js
sources.html:    supabase-js, /config.js, content-ops.js, provider.js
```

加载顺序：`/config.js → content-ops.js → ai/client.js → ai/pipeline.js → provider.js`

## 模块

### serve.js
Node 内置 HTTP 模块，读 `.env` → `/config.js`（注入 `window.PALLAX_CONFIG` + `window.DEEPSEEK_CONFIG`），`/` → `src/pages/dashboard.html`。

### provider.js → `window.Provider`

| 函数 | 说明 |
|------|------|
| `fetchTweetsByHandle(handle, hours)` → `Tweet[]` | 拉取账号推文 |
| `fetchSingleTweet(url/id)` → `Tweet` | 拉取单条推文 |
| `fetchListMembers(listId)` → `User[]` | 拉取 List 成员 |
| `isAvailable()` → boolean | OpenCLI daemon 是否在线 |

内部：validateHandle → ensureAvailable → opencli（主路径）→ /exec（回退，shellArg 转义）→ normalizeTweet（snake_case/camelCase 双兼容）

### ai/client.js → `window.AIClient`

| 函数 | 说明 |
|------|------|
| `chat(messages, opts)` → JSON | DeepSeek chat（`response_format: json_object`） |
| `embed(texts[])` → `{embedding}[]` | DeepSeek embedding |
| `cosineSimilarity(a, b)` → number | 余弦相似度（NaN + 零向量保护） |

### ai/pipeline.js → `window.AIPipeline`

| 函数 | 说明 |
|------|------|
| `scoreCluster(tweets)` → `{score,fit,viral,fresh,isHot}` | LLM 三维评分 |
| `classifyBatch(tweets)` → `[{index,angle}]` | LLM 7 类角度分类 |
| `generateIntel(title, tweets)` → `{summary,facts,opportunity,dissent,timeline}` | LLM 深度情报 |
| `extractTemplates(tweets)` → `[{skeleton,slots}]` | LLM 模板提炼 |
| `fillTemplate(skeleton,slots,material,angle,cat)` → text | LLM 模板填充 |
| `runPipeline(tweets)` → scored+classified clusters | 完整管线 |

### content-ops.js → `window.ContentOps`

纯函数，启发式回退。`classifyCategory` / `classifyAngle` / `clusterTweets` / `scoreCluster` / `buildHotspotFromCluster` / `extractSkeleton` / `slotsOf` / `pmRelevance`

## AI 双轨

| 任务 | 主路径（LLM） | 回退（启发式） |
|------|--------------|---------------|
| 热点评分 | `AIPipeline.scoreCluster` | `ContentOps.scoreCluster`（关键词密度） |
| 角度分类 | `AIPipeline.classifyBatch` | `ContentOps.classifyAngle`（正则） |
| 语义聚类 | `AIPipeline.runPipeline`（embedding） | `ContentOps.clusterTweets`（关键词+4h 窗） |
| 情报生成 | `AIPipeline.generateIntel` | 原始推文直接展示 |
| 模板提炼 | `AIPipeline.extractTemplates` | `ContentOps.extractSkeleton`（正则替换） |
| 模板填充 | `AIPipeline.fillTemplate` | —（仅 LLM） |

## 数据库

9 张表：`teams` / `team_schemas` / `team_api_configs` / `weekly_data` / `user_profiles` / `sources` / `hotspots` / `templates` / `template_uses`

全部 `anon` RLS，无需认证。

v3 vs v2：删除 `bump_template_stats()` trigger + 3 个分析视图，RLS `authenticated` → `anon`，保留 `set_updated_at()`。

## 核心数据流

**数据抓取**：Provider.fetchTweetsByHandle → ContentOps.clusterTweets → ContentOps.scoreCluster → buildHotspotFromCluster → sb.from('hotspots').upsert

**AI 情报**：AIPipeline.generateIntel(title, tweets) → AIClient.chat → sb.from('hotspots').update({intel})

**模板提炼**：ContentOps.extractSkeleton（立刻展示）→ AIPipeline.extractTemplates（异步替换）→ sb.from('templates').insert

**模板填充**：AIPipeline.fillTemplate(skeleton, slots, material, angle, cat) → AIClient.chat

**周报复盘**：localStorage 离线优先 → Supabase 异步同步

## 启动

```bash
cp .env.example .env   # 填入 DEEPSEEK_API_KEY
node src/serve.js      # → http://localhost:8080
```

确保 Chrome 已装 OpenCLI 插件。

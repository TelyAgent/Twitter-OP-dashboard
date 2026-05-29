# OP-dashboard 产品逻辑文档

## 概述

OP-dashboard 是一个 **Web3 内容运营工业化流水线**，覆盖从监控源管理、热点发现、模板提炼到内容生成和产品复盘的全链路。系统采用本地优先架构，5 个静态 HTML 页面 + Node.js 静态服务，Supabase 远程持久化，DeepSeek API 云端 AI 推理，OpenCLI Chrome 插件抓取 Twitter 数据。

---

## 系统架构

```
src/pages/*.html  ──supabase-js──→  Supabase（远程，仅持久化，anon RLS）
src/pages/*.html  ──fetch────────→  DeepSeek API（云端 LLM）
src/pages/*.html  ──fetch────────→  OpenCLI Daemon :19825（数据抓取）
```

### 共享模块加载链

```
config.js → content-ops.js → ai/client.js → ai/pipeline.js → provider.js
```

| 模块 | 全局命名空间 | 职责 |
|------|-------------|------|
| `src/config.js` | `window.CONFIG` | Supabase/DeepSeek 环境配置 |
| `src/content-ops.js` | `window.ContentOps` | 启发式分析：分类/聚类/评分/模板提取（纯函数，无 I/O） |
| `src/ai/client.js` | `window.AIClient` | DeepSeek API 封装（chat / embed / cosineSimilarity） |
| `src/ai/pipeline.js` | `window.AIPipeline` | AI 分析管线（scoreCluster / classifyBatch / generateIntel / extractTemplates / fillTemplate / runPipeline） |
| `src/ai/prompts.js` | — | 所有 DeepSeek prompt 模板，输出 JSON |
| `src/provider.js` | `window.Provider` | OpenCLI 数据抓取桥接（fetchTweetsByHandle / fetchSingleTweet / fetchListMembers） |

### 数据库（Supabase，9 张表，全部 anon RLS）

| 表 | 用途 | 关键字段 |
|----|------|---------|
| `sources` | 监控源 | type, handle, status, metrics_4w (JSONB) |
| `hotspots` | 热点/趋势 | category, score, hot_signal, intel (JSONB), tweets (JSONB) |
| `templates` | 内容模板 | category, angle, skeleton, required_slots, uses, avg_views |
| `template_uses` | 模板使用记录 | template_id, tweet_url, views, snapshot (JSONB) |
| `teams` | 产品团队 | label, sort_order |
| `team_schemas` | 指标 schema | team_id, schema (JSONB) |
| `team_api_configs` | API 配置 | team_id, config (JSONB) |
| `weekly_data` | 每周复盘 | team_id, week, data (JSONB) |
| `user_profiles` | 用户身份 | initials, display_name, role |

---

## 页面导航

```
数据复盘  |  热点雷达  |  模板库  |  监控源
```

四个页面按数据加工深度形成流水线关系。

---

## 第一环：监控源 (`sources.html`)

### 功能定位

整个内容运营管线的入口。用户维护一个 Twitter KOL、链上钱包、预测市场和 RSS 源的观察列表，作为后续热点发现和内容生产的原材料来源。

### 源类型

| 类型 | 识别规则 | 示例 |
|------|---------|------|
| `twitter` | 以 `@` 开头 | `@0xfoobar` |
| `onchain` | 以 `0x` 开头 | `0x1234...abcd` |
| `market` | 预测市场域名 | `polymarket.com` |
| `rss` | 媒体/新闻域名 | `theblock.co` |

### 源状态

| 状态 | 含义 |
|------|------|
| `live` | 主力监控，常规同步 |
| `observe` | 观察中/试用期 |
| `retired` | 已退役，不再同步 |

### 用户操作

#### 1. 批量导入

自由格式文本区粘贴，系统自动识别类型并生成预览表格（含去重）。支持 X List URL 导入：通过 `Provider.fetchListMembers()` 拉取 List 全部成员后填充。

确认后写入 `sources` 表，同时自动触发 PM 相关度评估。

#### 0. 列表分页

账号列表每页展示 15 条，底部提供页码导航。排序规则：`added_at DESC`（最新添加在前），相同时间按 `handle ASC` 字母序作为二级排序保证顺序稳定。切换筛选条件或数据重载后自动回到第 1 页。

#### 2. 单源同步（↻ 按钮）

```
Provider.fetchTweetsByHandle(handle, 168h, limit=100, topByEngagement=30)
  → ContentOps.clusterTweets()       关键词 + 4h 时间窗口聚类
    → ContentOps.buildHotspotFromCluster()  聚类 → 评分 → 热点行
      → 低分过滤 (score < 0.10 丢弃)
        → Upsert hotspots 表
        → 回写 sources.metrics_4w（hits、fire_count、7天 sparkline）
```

每次同步拉取近 7 天推文，经聚类、评分、过滤后写入 `hotspots` 表。**评分和过滤逻辑详见下方「同步评分与过滤管线」章节。**

#### 3. 批量同步 PM 相关源

筛选 `pm_score >= 0.4` 的源，串行同步。内置完整限流安全机制：

- **24h 去重**：同源 24h 内不同步第二次，避免重复消耗 API 配额
- **批量上限**：单次最多同步 20 个源，超出自动截断
- **随机延迟**：源间间隔 8~25 秒随机，模拟人类浏览节奏
- **退避保护**：触发 429/403 后全局 10 分钟冷却，未完成的源自动跳过
- **确认弹窗**：启动前展示排队数量、间隔策略和预计耗时

#### 4. AI 推荐源

基于"爆款源二度关系"的静态推荐列表，可一键加入/观察/忽略。

#### 5. 手动粘贴推文

粘贴推文 URL → `Provider.fetchSingleTweet()` → 角度分类 → 以 `manual: true` 写入 `hotspots`。

### 页面指标

- 总源数
- 本周触发热点数
- 爆款贡献源数
- 沉默 ≥4 周源数

---

## 同步评分与过滤管线

同步拉取的推文不会全部入库。每条推文先按话题聚类，每个聚类经过三维评分，低分聚类被直接丢弃，通过门槛的才写入 `hotspots` 表。整个评分由**纯启发式算法**完成（不调 AI），毫秒级响应，保证同步性能稳定。

### 管线四阶段

```
拉取 7 天推文
  → 聚类：关键词匹配 + 4h 时间窗口分组
    → 评分：三维启发式打分
      → 过滤：score < 0.10 丢弃
        → 判定：score ≥ 0.35 且达到绝对量门槛 → HOT，否则 → pool
          → 入库 hotspots 表
```

### 三维评分

评分由三个维度加权求和，满分 1.0：

| 维度 | 权重 | 衡量什么 | 怎么算 |
|------|------|---------|--------|
| **fit** 信息集中度 | 30% | 这批推文是否真正聚焦在预测市场/链上/宏观话题上 | 推文中匹配到的领域关键词种类数 / 推文数量 |
| **viral** 传播力 | 40% | 内容的真实传播效果，排除"高观看低互动"的标题党 | 平均互动量（点赞+转发+回复）/ 平均观看量，目标互动率约 2% |
| **fresh** 新鲜度 | 30% | 话题的时效性，越新越高 | 最新推文的发布时间，72 小时线性衰减到零 |

### 两道硬门槛

在加权求和之外，还有两个一票否决/惩罚规则：

- **互动绝对值过低（< 10）→ 分数直接归零**。哪怕关键词全中、刚发布 1 分钟，只要没人互动就当噪声处理。
- **传播力过低（互动率 < 5%）→ 分数打三折**。大量低互动推文组成的聚类会被大幅压制。

### 过滤与判定

| 关卡 | 阈值 | 作用 |
|------|------|------|
| 入库门槛 | score ≥ **0.10** | 过滤明显噪声（无关话题 + 无互动 + 过期），减少数据库膨胀 |
| HOT 分数线 | score ≥ **0.35** | 高价值热点候选 |
| HOT 绝对量 | 总观看 ≥ **10,000** 或 总互动 ≥ **200** | 防止小样本高分——2 条推文 243 观看 17 互动即使互动率奇高，实际没有传播意义 |

只有同时满足 HOT 分数线 + 绝对量门槛的聚类，才会被标记为 `hot_signal = true`（🔥 HOT），其余保留的聚类以 `pool` 状态入库。

### 为什么不用 AI 评分做过滤

同步管线使用纯启发式算法（`ContentOps.scoreCluster`），不调用 DeepSeek。原因：

1. **性能**：单次同步可能产生几十个聚类，启发式评分毫秒级完成，AI 调用需要网络往返
2. **稳定性**：DeepSeek 不可用时同步不能中断
3. **成本**：每天同步数十个源，全量 AI 调用费用不可控

AI 评分（`AIPipeline.scoreCluster`）仅在 `radar.html` 页面加载时，对已入库热点做可选的二次评分，用于展示排序优化。

---

## 第二环：热点雷达 (`radar.html`)

### 功能定位

从同步产生的热点池中，通过三维评分模型筛选出高价值趋势，并提供 AI 生成的深度情报分析。

### 页面布局

```
┌─────────────────────────────────────────────────────┐
│  指标行：总互动量  │  24h 新鲜热点  │  热点池/HOT 计数  │
├──────────────────────┬──────────────────────────────┤
│  热点池列表（左侧）    │  热点详情（右侧）              │
│  - 搜索过滤           │  - 推文列表                   │
│  - 分类标签 A/C/D/E   │  - AI 情报（摘要/事实/机会）    │
│  - 分数点阵           │  - 事件时间线                  │
│  - HOT 标记           │  - 分歧观点                   │
├──────────────────────┴──────────────────────────────┤
│  热门推文（按互动量排序）                               │
└─────────────────────────────────────────────────────┘
```

### 热点分类

| 标签 | 类别 | 关键词特征 |
|------|------|-----------|
| A | TG 生态 | Telegram、Mini App、TON、频道/群组 |
| C | Agent 产品 | AI Agent、Agent 框架/平台/市场、ElizaOS、OpenClaw 等 |
| D | Agent 技术 | LLM、RAG、Function Calling、Multi-Agent、推理 |
| E | AI 市场 | OpenAI/Anthropic/DeepSeek 等大厂动态、融资、基准 |

### 评分与 HOT 判定

热点的三维评分和 HOT 标记在同步阶段已经完成（详见「同步评分与过滤管线」章节）。雷达页面加载时，可以额外通过 AI 对已入库热点做二次评分用于排序优化。

### AI 情报生成

点击热点 → `AIPipeline.generateIntel(title, tweets)` 调用 DeepSeek → 产出结构化 JSON：

```json
{
  "summary": "一句话摘要",
  "facts": ["关键事实1", "关键事实2"],
  "opportunities": ["交易/内容机会"],
  "divergence": "市场分歧观点",
  "timeline": [{"time": "...", "event": "..."}]
}
```

结果持久化到 `hotspots.intel`，避免重复调用。

### 用户操作

- 浏览热点池，按分类/分数筛选
- 点击查看 AI 情报
- 标记 `watching`（关注）或 `ignored`（忽略）

---

## 第三环：模板库 (`templates.html`)

### 功能定位

从爆款推文中提炼可复用的内容骨架，按类别和视角组织成矩阵，支持 AI 辅助填充新素材生成推文。

### 模板矩阵：4 类 × 7 视角

| 视角 \ 类别 | A TG生态 | C Agent产品 | D Agent技术 | E AI市场 |
|------------|--------|--------|---------|--------|
| 反直觉 | | | | |
| 数据驱动 | | | | |
| 案例 | | | | |
| KOL 蹭点 | | | | |
| 深度 | | | | |
| 教程 | | | | |
| Thread | | | | |

每个单元格显示：模板数量、平均观看量、状态颜色。

### 七种视角说明

| 视角 | 适用场景 |
|------|---------|
| **反直觉** | 违背市场共识的发现，制造认知冲突 |
| **数据驱动** | 以链上/量化数据为核心卖点 |
| **案例** | 具体操作案例拆解，可复现 |
| **KOL 蹭点** | 借力大 V 观点，二次传播 |
| **深度** | 长文深度分析，建立专业壁垒 |
| **教程** | 操作指南 / How-to，新手友好 |
| **Thread** | 多推串联，信息密度高 |

### 模板提炼流程

```
爆款推文
  → ContentOps.extractSkeleton(text)
      正则替换具体值为 {slot}：URL、@handle、金额、百分比、数字
  → AIPipeline.extractTemplates(tweets)
      DeepSeek 增强提炼（异步替换启发式结果）
  → 保存到 templates 表
```

骨架示例：
```
"{token} 的 {metric} 在 {timeframe} 内增长了 {amount}，
这意味着 {insight}。目前 {protocol} 的 TVL 已达 {tvl}，
FDV 仅 {fdv}，相比同类项目 {competitor} 折价 {discount}%"
```

### 模板填充

```
用户选择模板 → 粘贴素材（推文/新闻/数据点）
  → AIPipeline.fillTemplate(skeleton, slots, material, angle, category)
    → DeepSeek 生成填充后的推文
      → 复制使用
```

### 使用追踪

记录使用 → `template_uses` 表（template_id、tweet_url、观看量、指标快照）→ 自动更新 `templates.uses`、`templates.avg_views`、`templates.fire_count`

### 页面组成

- **金模板矩阵**：4×7 网格，核心交互入口
- **精选模板**：使用次数最多的模板，含使用历史
- **最近提炼**：按视角分列，骨架 + slots + "使用此模板"
- **爆款推文池**：按视角分类，含提炼按钮
- **记录使用**：将已发布推文关联回模板，追踪效果

---

## 第四环：每周复盘 (`dashboard.html`)

### 功能定位

独立的产品指标管理工具，不与前三环直接数据连通。用于产品团队周报复盘，管理北极星指标、漏斗指标、任务和假设验证。

### 认证

需要 Supabase Magic Link 登录（与其他页面不同）。

### 页面布局

```
┌─────────────────────────────────────────────┐
│  团队标签页：全组总览 | Pythra | PredX | Telyai │
├─────────────────────────────────────────────┤
│  属性行：周次 / 填写人                         │
├─────────────────────────────────────────────┤
│  北极星指标卡片                                │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │ 本周数值  │  │ 趋势图    │  │ 达标进度环  │  │
│  └─────────┘  └──────────┘  └───────────┘  │
├─────────────────────────────────────────────┤
│  漏斗指标                                     │
│  流量 ──→ 互动 ──→ 转化 ──→ 付费              │
│   (可配置阶段 + 转化率)                        │
├─────────────────────────────────────────────┤
│  横向对比柱状图（本周 vs 上周）                  │
├─────────────────────────────────────────────┤
│  本周任务（描述/负责人/状态/关联指标）            │
│  上周复盘（任务对比 + 假设验证判定）              │
│  复盘文本（验证假设 / 证伪假设 / 下周调整）        │
├─────────────────────────────────────────────┤
│  API 配置（外部 API 自动填充指标）               │
└─────────────────────────────────────────────┘
```

### 全组总览

- 汇总卡片：产品团队数、达成目标数、平均完成度、环比上行
- 每团队行：NSM 值、环比变化、进度条、历史 Sparkline
- 横向对比柱状图
- 突出标记：环比领涨、需关注、达标

### 数据策略

`localStorage` 离线优先 → Supabase 异步同步。

- 存储键：团队列表、每个团队的 schema、API 配置、每周数据
- 写入：`cloudUpsertTeams()`、`cloudUpsertSchema()`、`cloudUpsertApi()`、`cloudUpsertWeekly()`
- 读取：`cloudBootstrap()` 启动时从 Supabase 拉取全部数据填充 localStorage

---

## 端到端数据流

```
                    外部数据（Twitter/X）
                           │
                           ▼
                    OpenCLI Daemon
                      (:19825)
                           │
                           ▼
              Provider.fetchTweetsByHandle()
                           │
                           ▼
                ContentOps.clusterTweets()
                    关键词 + 4h 窗口
                           │
                           ▼
              ContentOps.scoreCluster()
                  三维评分 (fit/viral/fresh)
                           │
                    ┌──────┴──────┐
                    ▼              ▼
              score ≥ 0.10    score < 0.10
              (保留入库)       (丢弃 · MIN_CLUSTER_SCORE)
                    │
                    ▼
              HOT 判定: score≥0.35 且 (views≥10k 或 eng≥200)
                    │
              ┌─────┴─────┐
              ▼            ▼
          hot_signal    hot_signal
          = true        = false
          status='hot'  status='pool'
              │            │
              └─────┬──────┘
                    ▼
            ┌──────────────┐
            │  hotspots 表  │
            └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ContentOps    AIPipeline    AIPipeline
       .scoreCluster  .scoreCluster .generateIntel
       （启发式评分）   （AI 评分）    （AI 情报）
              │            │            │
              └────────────┼────────────┘
                           ▼
                    radar.html 展示
                           │
                           ▼
              ContentOps.extractSkeleton()
                    ↓ (AI 增强)
              AIPipeline.extractTemplates()
                           │
                           ▼
                    ┌──────────────┐
                    │ templates 表  │
                    └──────┬───────┘
                           │
                           ▼
              AIPipeline.fillTemplate()
                           │
                           ▼
                    生成推文 → 发布
                           │
                           ▼
                    ┌──────────────────┐
                    │ template_uses 表  │（效果追踪）
                    └──────────────────┘


   ┌──────────────────────────────────────────────┐
   │  dashboard.html（独立环）                      │
   │                                              │
   │  localStorage ←→ Supabase                    │
   │  (teams / team_schemas / weekly_data)         │
   │                                              │
   │  产品指标管理 + 周报复盘，不与热点/模板直接连通    │
   └──────────────────────────────────────────────┘
```

---

## 核心设计原则

### 1. AI 双轨策略

每个分析任务都有两条路径：

| 优先级 | 路径 | 实现 |
|--------|------|------|
| 主路径 | LLM（DeepSeek） | `AIPipeline.*` |
| 回退 | 启发式算法 | `ContentOps.*`（纯函数，无 I/O） |

DeepSeek API 调用失败或未配置时，自动降级到基于关键词/正则的启发式方法，保证系统始终可用。

### 2. 离线优先

- Dashboard 使用 `localStorage` 做本地缓存，Supabase 仅做持久化和跨设备同步
- 其他页面直接读写 Supabase，网络不可用时降级为本地只读

### 3. 无后端架构

除静态文件服务和 OpenCLI 命令代理外，全部业务逻辑在浏览器 JavaScript 中完成。Supabase 仅做数据持久化（无 trigger/function/view 分析逻辑）。

### 4. 无认证壁垒

除 Dashboard 的 Magic Link 登录外，全部 Supabase 表使用 `anon` RLS 策略，无需认证即可读写。

# 定时同步调度器

> 服务端定时任务，每天自动同步已导入的 Twitter 账号推文数据。随 `serve.js` 启动，无需额外进程。

## 概述

调度器解决一个运维痛点：监控源页面（sources.html）的同步依赖手动点击，账号多了以后容易遗漏。调度器在服务端按固定时间表自动拉取所有活跃 Twitter 源的近 7 天推文，聚类评分后写入热点池，确保数据每天更新。

**定位**：自动化数据采集层，不影响浏览器端的 AI 分析管线（LLM 评分/情报生成/模板提炼仍通过手动同步触发）。

## 运行方式

调度器随 `serve.js` — 起启动：

```bash
node src/serve.js
# 输出: [scheduler ...] 调度器已启动 · 每日 2:00 运行
#       [scheduler ...] 首次同步将在 30s 后运行…
```

- **启动后 30 秒**执行首次同步（等待服务就绪）
- **每天固定时间**（默认凌晨 2:00）自动运行
- 所有日志带 `[scheduler HH:MM:SS]` 前缀

## 同步流程

```
加载源列表 (Supabase sources 表, type=twitter, status≠retired)
  │
  ├─ 截断至单次上限 (默认 20 个)
  │
  └─ 串行处理每个源 (间隔 8~25s 随机延迟)
       │
       ├─ 检查 24h 去重缓存 → 跳过
       ├─ 检查全局退避状态 → 跳过
       │
       ├─ opencli twitter tweets <handle> → Tweet[]
       │     │
       │     ├─ 成功 → clusterTweets → scoreCluster → buildHotspotFromCluster
       │     │         → upsert hotspots 表 → 更新 sources.metrics_4w
       │     │
       │     └─ 失败 → 重试 (最多 3 次, 指数退避 5s→10s→20s)
       │               → 429/403 → 全局 10 分钟退避, 剩余源跳过
       │
       └─ 随机延迟 (8~25s) → 下一个源
```

## 限流安全

三层保护，对标浏览器端手动同步的安全策略：

| 层级 | 机制 | 参数 |
|------|------|------|
| 源间延迟 | 每个源处理完后随机等待 | 8~25 秒 |
| 同源去重 | 24h 内同一 source 不重复同步 | 进程内存缓存 |
| 全局退避 | 触发 429/403 后停止所有请求 | 固定 10 分钟 |
| 重试退避 | 单源失败后指数等待 | 5s → 10s → 20s (最多 3 次) |
| 单次上限 | 每次运行最多处理 N 个源 | 默认 20 |

## 配置

所有参数通过 `.env` 文件配置，均为可选（有默认值）：

```bash
# .env
SYNC_HOUR=2              # 每天运行时间 (0-23), 默认 2 (凌晨 2:00)
SYNC_MAX_RETRIES=3       # 每个源最多重试次数, 默认 3
SYNC_FETCH_LIMIT=100     # 每源拉取推文数, 默认 100
SYNC_TOP_ENGAGEMENT=30   # 互动质量截断 (top N), 默认 30
SYNC_BATCH_MAX=20        # 单次运行最多处理源数, 默认 20
SYNC_DELAY_MIN=8000      # 源间最小延迟 (ms), 默认 8000
SYNC_DELAY_MAX=25000     # 源间最大延迟 (ms), 默认 25000
```

## 与手动同步的关系

| 维度 | 定时调度器 (scheduler.js) | 手动同步 (sources.html) |
|------|--------------------------|------------------------|
| 触发方式 | 服务端定时 | 用户点击按钮 |
| 聚类评分 | 启发式 (ContentOps 同款逻辑) | 同，可叠加 LLM 管线 |
| 热点写入 | ✓ upsert hotspots | ✓ upsert hotspots |
| AI 情报 | ✗ | ✓ (手动触发 LLM) |
| PM 相关度 | ✗ | ✓ (手动触发) |
| 回写 metrics_4w | ✓ | ✓ |

调度器保证数据不过期，手动同步负责深度分析。两者可并行，不会重复（24h 去重）。

## 代码位置

| 文件 | 职责 |
|------|------|
| `src/scheduler.js` | 调度器主体：定时、拉取、聚类、入库、限流 |
| `src/serve.js` | 入口：`import { startScheduler }` → 服务启动后调用 |
| `src/content-ops.js` | 原始启发式函数（浏览器端），scheduler.js 内联移植了核心逻辑 |

## 日志示例

```
[scheduler 02:00:00] === 开始每日同步 ===
[scheduler 02:00:00] 加载到 15 个 twitter 源
[scheduler 02:00:01] [1/15] RektAlpha
[scheduler 02:00:01]   opencli: opencli twitter tweets RektAlpha --limit 100 --format json --top-by-engagement 30
[scheduler 02:00:04]   DONE @RektAlpha: 78 推 → 12 簇 (入库 12, 失败 0)
[scheduler 02:00:04]   等待 18s…
[scheduler 02:00:22] [2/15] PolyTraderX
...
[scheduler 02:14:30] === 同步完成: 13 成功, 2 失败, 0 跳过 ===
[scheduler 02:14:30] 下次同步: 2026/6/10 02:00:00 (24h 后)
```

## 相关文档

- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — 系统拓扑、模块 API
- [`product-logic.md`](product-logic.md) — 评分管线、聚类逻辑详解
- [`SPEC.md`](SPEC.md) — sources 页面功能清单
- [`deployment.md`](deployment.md) — 部署时调度器的环境变量配置

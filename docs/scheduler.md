# 定时同步调度器

> 服务端定时任务。随 `serve.js` 启动。自动批量拉取 Twitter 源推文，聚类评分后写入热点池，确保数据每天更新。

## 架构

```
serve.js
  ├─ import { runSync, syncState, stopSync }
  ├─ POST /api/sync        → runSync()
  ├─ GET  /api/sync/status  → syncState (轮询)
  ├─ GET  /api/sync/env     → 环境检测
  ├─ POST /api/sync/stop    → stopSync()
  └─ 定时器 (每日 SYNC_HOUR + 启动后 30s)

sync-admin.html  ←→  /api/sync/status  (1.5s 轮询)
                       /api/sync/stop
```

## 同步流程

```
加载源列表 (Supabase sources 表, type=twitter, status≠retired)
  │
  ├─ 截断至单次上限 (默认 20)
  ├─ 加载断点 → 跳过已完成的源
  ├─ 加载冷却记录 → 跳过 24h 内已同步的源
  │
  └─ 串行处理每个源
       │
       ├─ 停止检查 (syncState.stopRequested)
       ├─ 限流检查 (全局退避)
       │
       ├─ opencli → Tweet[]
       │     ├─ 成功 → clusterTweets → scoreCluster → buildHotspotFromCluster
       │     │         → upsert hotspots → 更新 sources.metrics_4w
       │     │         → 写冷却 + 断点记录
       │     ├─ 失败 → 重试 (最多 3 次, 指数退避)
       │     └─ 429/403 → 全局 10 分钟退避
       │
       └─ 随机延迟 (8~25s, 可中断) → 下一个源
```

## 状态持久化

调度器维护两类磁盘文件，服务重启后自动恢复：

### `.sync_cooldown.json` — 24h 冷却记录

- **目的**：防止每日定时同步重复处理今天已完成的源
- **写入时机**：每个源同步成功（或返回 0 条推文）后立即写入
- **加载时机**：服务启动时自动加载，预填内存缓存
- **清理**：24h 以上的条目自动剪除
- **与手动同步的关系**：手动同步走 `/api/opencli/*`，不经过调度器，不受冷却限制

### `.sync_checkpoint.json` — 断点续传

- **目的**：同步中途服务崩溃/重启后，从断点继续而非从头开始
- **写入时机**：每个源处理完成后（无论成功/失败/跳过）
- **清理时机**：仅当**全部**源处理完毕（无 pending 且非停止/限流中断）时删除
- **恢复逻辑**：启动时加载，队列中已完成的源直接跳过

### syncState（内存，API 可轮询）

```js
syncState = {
  running: Boolean,         // 是否有同步进行中
  stopRequested: Boolean,   // 是否收到停止请求
  current: String | null,   // 当前正在处理的 handle
  total: Number,            // 队列总数
  entries: [{handle, status, tweets, hotspots, time, error}],
  startTime: Number,

  done:    getter → entries.filter(e.status === 'ok').length,
  failed:  getter → entries.filter(e.status === 'failed').length,
  skipped: getter → entries.filter(e.status === 'skipped').length,
}
```

`done/failed/skipped` 是计算属性，`entries` 是唯一数据源。无需手动维护计数器。

## 限流安全

| 层级 | 机制 | 参数 |
|------|------|------|
| 源间延迟 | 每源处理完随机等待，每秒检查停止请求 | 8~25 秒 |
| 同源去重 | 24h 冷却，磁盘持久化 | `.sync_cooldown.json` |
| 全局退避 | 429/403 后停止所有请求 | 固定 10 分钟 |
| 重试退避 | 单源失败指数等待，可中断 | 5s → 10s → 20s (最多 3 次) |
| 单次上限 | 每次运行最多处理 N 个源 | 默认 20 |

## 停止机制

停止请求（`POST /api/sync/stop`）的执行路径：

1. 设置 `syncState.stopRequested = true`
2. `kill(SIGTERM)` 正在运行的 OpenCLI 子进程（异步 `exec`，不阻塞事件循环）
3. 当前源返回 `{status: 'skipped', reason: 'stopped'}`
4. 主循环在下一个迭代检测到 `stopRequested`，所有 pending 源标记为 skipped，退出
5. 断点文件保留（下次启动从此继续）

## 配置

```bash
# .env (全部可选，有默认值)
SYNC_HOUR=2              # 每天运行时间 (0-23), 默认 2
SYNC_MAX_RETRIES=3       # 每源最大重试次数, 默认 3
SYNC_FETCH_LIMIT=100     # 每源拉取推文数, 默认 100
SYNC_TOP_ENGAGEMENT=30   # 互动截断 (top N), 默认 30
SYNC_BATCH_MAX=20        # 单次最多处理源数, 默认 20
SYNC_DELAY_MIN=8000      # 源间最小延迟 ms, 默认 8000
SYNC_DELAY_MAX=25000     # 源间最大延迟 ms, 默认 25000
```

## 与手动同步的关系

| 维度 | 定时调度器 (scheduler.js) | 手动同步 (sources.html) |
|------|--------------------------|------------------------|
| 触发 | 服务端定时 / API POST | 用户点击按钮 |
| 代码路径 | `syncOneSource()` | `Provider.fetchTweetsByHandle()` → `/api/opencli/*` |
| 冷却限制 | 24h 去重（磁盘持久化） | 无限制 |
| 聚类评分 | 启发式 (ContentOps 同款) | 同，可叠加 LLM 管线 |
| 热点写入 | ✓ | ✓ |
| AI 情报 | ✗ | ✓ (手动触发 LLM) |
| 可停止 | ✓ (SIGTERM) | ✗ (浏览器 fetch) |

## 代码组织

`scheduler.js` (~730 行) 按职责分 6 块：

| 块 | 内容 |
|----|------|
| 1. Infrastructure | imports, readEnv, logging, Supabase client |
| 2. Data Processing | opencliTweets, normalizeTweet, clustering/scoring (从 content-ops.js 移植) |
| 3. Runtime Control | backoff, delays, interruptibleSleep, stopActiveProcess |
| 4. State Persistence | cooldown cache, checkpoint, syncState |
| 5. Sync Logic | syncOneSource, runSync |
| 6. Exports | `{ runSync, syncState, stopSync }` |

| 文件 | 职责 |
|------|------|
| `src/scheduler.js` | 调度器全部逻辑 |
| `src/serve.js` | 入口：注册 API 路由 + 定时器 |
| `src/pages/sync-admin.html` | 管理页面：环境检测 + 同步控制 + 实时日志 |
| `src/content-ops.js` | 浏览器端原始实现，scheduler.js 内联移植了核心逻辑 |
| `.sync_cooldown.json` | 冷却记录（自动生成，gitignore） |
| `.sync_checkpoint.json` | 断点文件（自动生成，gitignore） |

## 相关文档

- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — 系统拓扑
- [`product-logic.md`](product-logic.md) — 评分管线详解
- [`deployment.md`](deployment.md) — 部署配置

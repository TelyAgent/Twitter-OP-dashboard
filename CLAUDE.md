# CLAUDE.md

本地产品面板：6 个静态 HTML + Node.js 静态服务，Supabase 持久化，DeepSeek AI 推理，OpenCLI 抓取 Twitter。

## 命令

```bash
cp .env.example .env                  # 填入 SUPABASE_* / DEEPSEEK_API_KEY
node src/serve.js                     # → http://localhost:8080
node scripts/test-sync-one.js <handle> # 单源同步测试
node scripts/run-sync.js              # 触发全量同步（或 curl POST /api/sync）
node scripts/db.js status             # Supabase 表行数统计
vercel --prod                         # 发布到 Vercel
```

同步依赖 OpenCLI CLI + Chrome 插件（Daemon :19825），Vercel 不可用。

## 模块

**浏览器端** (`<script>` 加载，`window.*`)：

| 文件 | 全局 | 职责 |
|------|------|------|
| `src/provider.js` | `Provider` | 数据抓取（OpenCLI） |
| `src/content-ops.js` | `ContentOps` | 启发式分析：分类/聚类/评分（纯函数） |
| `src/ai/client.js` | `AIClient` | DeepSeek API |
| `src/ai/pipeline.js` | `AIPipeline` | AI 分析管线，LLM 失败自动降级到 ContentOps |
| `src/ai/prompts.js` | — (ES module) | Prompt 模板：scoring / classify / intel / extract / fill |

加载顺序：`/config.js → content-ops.js → ai/client.js → ai/pipeline.js → provider.js`

**服务端** (Node.js)：

| 文件 | 职责 |
|------|------|
| `src/serve.js` | 静态服务 + OpenCLI 代理 + 启动每日定时同步 |
| `src/scheduler.js` | 定时同步：opencli 抓取 → 聚类评分 → Supabase hotspots 写入（限流/重试/24h 去重） |
| `api/index.js` | Vercel serverless handler（只提供静态文件 + config/js, 无 OpenCLI/同步） |

## 页面

| 文件 | 认证 | 功能 |
|------|------|------|
| `dashboard.html` | Magic Link Auth | 周报复盘，localStorage 离线优先 → Supabase |
| `radar.html` | anon RLS | 热点雷达，AI 评分/分类/情报 |
| `templates.html` | anon RLS | 模板库，AI 提炼/填充 |
| `sources.html` | anon RLS | 监控源管理，OpenCLI 抓取 |
| `sync-admin.html` | anon RLS | 同步管理面板：环境检测/启停/日志(Vercel 不可用) |
| `preview.html` | anon RLS | 预览页 |

## 数据

- sources/radar/templates/sync: 直接 Supabase 读写
- dashboard: localStorage 离线优先 → Supabase 异步同步
- 全部 `anon` RLS，无需认证
- 权威 schema：`src/db/schema.sql`

## API 端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/opencli/health` | GET | OpenCLI daemon 健康检查 |
| `/api/opencli/api/twitter/user-timeline` | GET | 抓取用户推文 (handle/limit/topByEngagement) |
| `/api/sync` | POST | 触发全量同步 |
| `/api/sync/status` | GET | 轮询同步状态 |
| `/api/sync/stop` | POST | 停止同步 |
| `/api/sync/env` | GET | 环境检测 |
| `/api/media-proxy` | GET | Twitter 媒体代理 |
| `/api/sources/review-summary` | GET | Mock 审核摘要 |
| `/api/sources/ai-recommendations` | GET | Mock AI 推荐 |

## OpenCLI 语法

```
opencli twitter tweets <handle> --limit N --format json --top-by-engagement N
```

不存在：`--hours`、`--handle`、`twitter tweet`、`twitter list-members`、`user-timeline`

## 工作约定

- 页面内小范围编辑，直接 DOM 操作，内联脚本
- 共享逻辑放 `src/`，页面特有逻辑保留内联
- 改字段名前查 `src/db/schema.sql`
- Prompt 变更仅限 `src/ai/prompts.js`
- 同步逻辑核心 (clustering/scoring) 维护两份：`src/content-ops.js` (浏览器端) 和 `src/scheduler.js` (服务端内联副本)，改一处需同步另一处

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **OP-dashboard** (359 symbols, 440 relationships, 6 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/OP-dashboard/context` | Codebase overview, check index freshness |
| `gitnexus://repo/OP-dashboard/clusters` | All functional areas |
| `gitnexus://repo/OP-dashboard/processes` | All execution flows |
| `gitnexus://repo/OP-dashboard/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

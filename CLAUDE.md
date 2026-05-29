# CLAUDE.md

本文件为 Claude Code 在此仓库中工作时提供指引。

## 项目形态

本地优先的产品面板。5 个静态 HTML 页面 + 极简 Node.js 静态服务，Supabase 远程持久化，DeepSeek API 云端 AI 推理，OpenCLI Chrome 插件抓取 Twitter 数据。

```
src/pages/*.html  ──supabase-js──→  Supabase（远程，仅持久化，anon RLS）
src/pages/*.html  ──fetch────────→  DeepSeek API（云端 LLM）
src/pages/*.html  ──fetch────────→  OpenCLI Daemon :19825（数据抓取）
```

## 常用命令

```bash
cp .env.example .env       # 填入 DEEPSEEK_API_KEY
node src/serve.js          # → http://localhost:8080
```

OpenCLI Daemon 随 Chrome 插件自动启动。DeepSeek API 由浏览器 JS 直接调用。

## 架构

### 前端结构

每个页面是几乎独立的 HTML 文档：大段内联 CSS、大段内联 JS、直接 DOM 操作、页面本地可变状态。逻辑分散在多个 IIFE 中。编辑 UI 行为前先通读整个页面。

### 共享模块（`src/`，通过 `<script>` 加载，暴露 `window.*`）

| 文件 | 全局 | 职责 |
|------|------|------|
| `src/provider.js` | `window.Provider` | OpenCLI 数据抓取（fetchTweetsByHandle / fetchSingleTweet / fetchListMembers） |
| `src/content-ops.js` | `window.ContentOps` | 启发式分析：分类/聚类/评分/模板提取（纯函数，无 I/O） |
| `src/ai/client.js` | `window.AIClient` | DeepSeek API 封装（chat / embed / cosineSimilarity） |
| `src/ai/pipeline.js` | `window.AIPipeline` | AI 分析管线（scoreCluster / classifyBatch / generateIntel / extractTemplates / fillTemplate / runPipeline） |

加载顺序：`/config.js → content-ops.js → ai/client.js → ai/pipeline.js → provider.js`

### 持久化：localStorage + Supabase

- dashboard：localStorage 离线优先 → Supabase 异步同步（teams / schemas / weekly_data）
- sources/radar/templates：直接 Supabase 读写（sources / hotspots / templates / template_uses）
- 全部 `anon` RLS，无需认证

### AI 双轨策略

每个分析任务 LLM 主路径 + 启发式回退。LLM 失败时自动降级到 `ContentOps.*`。

### 数据库

权威 schema：`src/db/supabase_setup_v2.sql`（v3，anon RLS，无 trigger/view 分析逻辑）

## 功能边界

| 页面 | 功能 |
|------|------|
| `src/pages/dashboard.html` | 周报复盘、产品组管理、NSM、漏斗指标、任务、复盘 |
| `src/pages/sources.html` | 监控源管理、批量导入、单源同步、PM 相关度、分页、限流安全 |
| `src/pages/radar.html` | 热点池、AI 情报、评分排序 |
| `src/pages/templates.html` | 模板矩阵、AI 提炼/填充、使用追踪 |

## OpenCLI 命令语法

- 正确命令：`opencli twitter tweets <handle>`（非 `user-timeline`）
- 可用 flag：`--limit`、`--top-by-engagement`、`--format`
- 不存在：`--hours`、`--handle`、`twitter tweet`、`twitter list-members`

## 限流安全

- 单次拉取上限 `FETCH_LIMIT=100`，互动截断 `TOP_BY_ENGAGEMENT=30`
- 24h 同源去重（localStorage 缓存上次同步时间）
- 429/403 → 全局 10 分钟退避（固定，不递进）
- 批量同步源间随机延迟 8-25s，单次上限 20 个

## 工作约定

- 优先在现有页面内做小范围编辑，直接 DOM 更新，内联脚本
- 修改字段名前先检查 `src/db/supabase_setup_v2.sql`
- 共享逻辑放 `src/`，页面特有逻辑保留内联
- AI 分析调用经 `src/ai/client.js` → DeepSeek API
- Prompt 变更仅在 `src/ai/prompts.js`
- Supabase 仅持久化 — 无 trigger/function/view 分析逻辑

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

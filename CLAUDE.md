# CLAUDE.md

本地产品面板：4 个静态 HTML + Node.js 静态服务，Supabase 持久化，DeepSeek AI 推理，OpenCLI 抓取 Twitter。

## 命令

```bash
cp .env.example .env            # 填入 SUPABASE_* / DEEPSEEK_API_KEY
node src/serve.js               # → http://localhost:8080
node scripts/test-sync-one.js <handle>   # 单源同步测试
curl -X POST http://localhost:8080/api/sync  # 手动触发全量同步（或 node scripts/run-sync.js）
vercel --prod                   # 发布到 Vercel
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

加载顺序：`/config.js → content-ops.js → ai/client.js → ai/pipeline.js → provider.js`

**服务端** (Node.js)：

| 文件 | 职责 |
|------|------|
| `src/serve.js` | 静态服务 + OpenCLI 代理 + 启动每日定时同步 |
| `src/scheduler.js` | 定时同步：opencli 抓取 → 聚类评分 → Supabase hotspots 写入（限流/重试/24h 去重） |

## 数据

- dashboard：localStorage 离线优先 → Supabase 异步同步
- sources/radar/templates：直接 Supabase 读写
- 全部 `anon` RLS，无需认证
- 权威 schema：`src/db/supabase_setup_v2.sql`

## OpenCLI 语法

```
opencli twitter tweets <handle> --limit N --format json --top-by-engagement N
```

不存在：`--hours`、`--handle`、`twitter tweet`、`twitter list-members`、`user-timeline`

## 工作约定

- 页面内小范围编辑，直接 DOM 操作，内联脚本
- 共享逻辑放 `src/`，页面特有逻辑保留内联
- 改字段名前查 `src/db/supabase_setup_v2.sql`
- Prompt 变更仅限 `src/ai/prompts.js`

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

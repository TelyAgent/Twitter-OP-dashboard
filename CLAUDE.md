# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指引。

## 项目形态（目标架构）

本仓库是一个本地优先的多页面产品：静态 HTML 页面由极简 Node.js 服务托管，Supabase 为唯一远程依赖，DeepSeek API 为云端 AI 后端。

- `dashboard.html` — 主周报复盘面板。
- `preview.html` — 预览变体。
- `radar.html` — 热点雷达。
- `templates.html` — 模板库。
- `sources.html` — 监控源管理。
- `config.js` — `SUPABASE_URL`、`SUPABASE_KEY` 的唯一来源。

### 数据流

```
静态页面 ──supabase-js──→ Supabase（远程，仅持久化）
静态页面 ──fetch────────→ DeepSeek API（云端 LLM，AI 分析）
静态页面 ──fetch────────→ OpenCLI Daemon（:19825，数据抓取）
```

### 外部依赖（仅 2 个）

| 依赖 | 用途 |
|---|---|
| Supabase | 远程 PostgreSQL，仅持久化 — 无 trigger/视图 做分析逻辑 |
| DeepSeek API | 云端 LLM 推理 — 评分、分类、情报、模板提炼/填充 |

### 本地依赖

| 组件 | 作用 |
|---|---|
| Node.js 静态服务 | 在 `localhost:8080` 提供 HTML 页面 |
| OpenCLI Chrome 插件 + Daemon | 浏览器 ↔ X/Twitter 数据抓取的桥梁，复用浏览器登录态，零 API Key |

### 已移除的组件

- `api/`（Vercel Functions）— 由 OpenCLI + DeepSeek API 替代
- `apps/api/`（旧版 Fastify）— 退役
- `vercel.json`、`deploy.sh`、`deploy-api.sh` — 不再需要
- `twitter-api-v2` npm 依赖 — 移除

## 常用命令

### 本地开发

```bash
# 一次性：安装 OpenCLI Chrome 插件
# https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk

# 复制并填入你的 key
cp .env.example .env

# 启动（serve 自动读取 .env）
node src/serve.js
# → http://localhost:8080
```

`.env`：
```
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

`.env.example`（可检入，不含真实 key）：
```
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

简单的静态服务即可。OpenCLI Daemon 随 Chrome 插件自动启动。DeepSeek API 由浏览器 JS 直接调用。

### 测试 / linting

- 无检入的 lint 或测试脚本。
- 无仓库定义的单一测试命令。

## 架构

### 前端结构

前端未组件化。每个页面是几乎独立的 HTML 文档，包含：
- 大段内联 CSS
- 大段内联 JS
- 直接 DOM 查询和事件监听
- 页面本地可变状态

`styles.css` 存在于根目录，但大量页面样式仍在各 HTML 文件内。

编辑 UI 行为时，先通读整个页面。逻辑通常分散在同一文件中的多个 IIFE 中。

### 状态与持久化模型

主面板使用离线优先模式：
- 本地可变 JS 对象持有活跃状态
- 状态持久化到 `localStorage`
- Supabase 将状态同步到云端（纯读写，无分析逻辑）

核心面板实体：`teams`、`team_schemas`、`team_api_configs`、`weekly_data`。

### 认证

无需认证。项目完全在本地运行，Supabase 表 RLS 策略改为允许 `anon` 公开访问。

### 数据抓取（OpenCLI 替代 Twitter API）

OpenCLI Chrome 插件复用浏览器已登录的 X/Twitter 会话抓取推文数据。无需 API Key，无需 serverless 代理。OpenCLI Daemon 运行在 `localhost:19825`。

sources.html 和 radar.html 的数据源流程：
1. 页面调用 OpenCLI Daemon 拉取某账号的推文
2. 页面将推文批量发送到 DeepSeek API 做分析（评分、分类）
3. 结果写入 Supabase `hotspots` 表做持久化

### AI 分析（DeepSeek API，自建管线）

所有分析逻辑位于浏览器端 JS，直接调用 DeepSeek API。Supabase trigger/视图中无分析逻辑。

AI 端点（DeepSeek `deepseek-chat` 模型，`response_format: json_object`）：

| 分析项 | 触发时机 | 输入 | 输出 |
|---|---|---|---|
| 热点评分 | 推文抓取后 | 推文批次 | 每个 cluster 的 `{fit, viral, fresh, score, isHot}` |
| 角度分类 | 推文抓取后 | 推文文本 + 元数据 | 7 类角度标签 |
| 语义聚类 | 推文抓取后 | 推文文本列表 | 基于 embedding 相似度的聚类分组 |
| 情报生成 | 仅 HOT 候选 | cluster 内 top 推文 | `{summary, facts[], opportunity, dissent, timeline[]}` |
| 模板提炼 | 用户点击"提炼" | 爆款推文批次 | 每个模板的 `{skeleton, slots[]}` |
| 模板填充 | 用户点击"使用此模板" | 骨架 + 素材 | 填充后的推文文本 |

Prompt 模板存放在 `src/ai/prompts.js`。所有 prompt 使用 few-shot 格式，带 JSON Schema 输出约束。

### 数据库（Supabase — 仅持久化）

`squpabase_setup_v2.sql` 是权威的 schema 参考。

表：
- 面板域：`teams`、`team_schemas`、`team_api_configs`、`weekly_data`
- 内容工厂域：`user_profiles`、`sources`、`hotspots`、`templates`、`template_uses`

相对于当前 schema 的变更：
- **删除** `bump_template_stats()` trigger — 统计由 AI 管线计算，直接写入
- **删除** 视图 `v_weekly_hotspot_stats`、`v_template_perf`、`v_source_contribution` — 由 AI 生成的汇总替代
- **保留** `set_updated_at()` trigger — 纯工具函数
- **修改** RLS 策略 — 从 `authenticated` 改为 `anon`（无需登录，本地运行）

## 数据模型

### Supabase 实例（当前）

| 项 | 值 |
|---|---|
| URL | `https://dkwqvenghjjjzceucjov.supabase.co` |
| Project ref | `dkwqvenghjjjzceucjov` |
| Publishable key | `sb_publishable_HJSlxk0cXk1w7e0v9WRbqg_DFAhVZDc` |

`config.js` 是唯一来源。所有页面通过 `<script src="config.js">` 加载（文件已在根目录）。

## 重构计划

### Phase 1：AI Prompts & Pipeline（新建文件）

创建 `src/ai/prompts.js` — DeepSeek API 调用的全部 prompt 模板：

```
src/ai/
├── prompts.js      # 全部 prompt 模板（评分、分类、聚类、情报、提炼、填充）
├── client.js       # DeepSeek API 客户端封装（chat + embedding）
└── pipeline.js     # 编排：批量评分 → 分类 → 聚类 → 情报
```

### Phase 2：前端数据层适配

在每个页面中将 Twitter API 调用替换：

| 页面 | 旧（Twitter API） | 新 |
|---|---|---|
| sources "↻ 同步" | `fetch(API_BASE + /api/twitter/handle/.../recent)` | `fetch(localhost:19825/...)` 通过 OpenCLI |
| sources "↥ 粘贴推文" | `fetch(API_BASE + /api/twitter/tweet)` | OpenCLI 单条推文抓取 |
| sources "导入成员" | `fetch(API_BASE + /api/twitter/list/.../members)` | OpenCLI list 成员 |
| templates "记录使用" | `fetch(API_BASE + /api/twitter/tweet)` | OpenCLI 单条推文抓取 |
| templates AI 提炼 | `fetch(API_BASE + /api/ai/extract-template)` | 直接调 DeepSeek API |
| templates AI 填充 | `fetch(API_BASE + /api/ai/fill-template)` | 直接调 DeepSeek API |
| radar 热点情报 | （仅 mock） | 直接调 DeepSeek API |

### Phase 3：AI 分析集成

将客户端启发式算法替换为 DeepSeek API 调用：

| 当前（启发式） | 替换为（LLM） |
|---|---|
| `computeScore()` — 正则关键词匹配 | DeepSeek 评分 prompt → 结构化 JSON |
| `classifyAngle()` — 正则模式 | DeepSeek 分类 prompt |
| `clusterTweets()` — 关键词 + 4h 时间窗口 | DeepSeek embedding + 余弦相似度聚类 |
| `extractSkeleton()` — 正则替换 | DeepSeek 模板提炼 prompt |
| AI 模板填充（stub，未实现） | DeepSeek 填充 prompt |

### Phase 4：Supabase 清理

在 Supabase SQL Editor 中执行：
```sql
drop trigger if exists trg_template_uses_bump on template_uses;
drop function if exists bump_template_stats();
drop view if exists v_weekly_hotspot_stats;
drop view if exists v_template_perf;
drop view if exists v_source_contribution;
```

### Phase 5：移除死代码

删除：
- `api/` 目录（4 个 Vercel Functions + 共享库）
- `apps/api/` 目录（旧版 Fastify）
- `vercel.json`
- `deploy.sh`、`deploy-api.sh`
- `package.json` 中的 `twitter-api-v2` 依赖
- `config.js` 中的 `API_BASE` 逻辑（仅保留 `SUPABASE_URL` + `SUPABASE_KEY`）

### Phase 6：Serve 脚本 + .env

`src/serve.js`（极简静态服务，读取 `.env`）：
```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const PORT = 8080;
const ROOT = process.cwd();
const MIME = { '.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json' };

createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  const file = path === '/' ? '/dashboard.html' : path;
  try {
    const body = await readFile(ROOT + file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(PORT, () => console.log(`→ http://localhost:${PORT}`));
```

`.env.example`：
```
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

`.env` 已加入 `.gitignore`。页面中的 AI 客户端通过 `serve.js` 启动时读取 `.env` 并注入的 `/env.js` 端点获取 `DEEPSEEK_BASE_URL` + key。

## 功能边界

- `dashboard.html`：周报复盘、产品组指标、schema、复盘
- `sources.html`：监控源管理、批量导入、源同步、PM 相关度评分
- `radar.html`：热点审查、AI 情报、评分、雷达优先级排序
- `templates.html`：模板库、角度分类、AI 模板提炼/填充、使用追踪

## 工作约定

- 优先在现有 HTML 页面内做小范围、精准的编辑。
- 保持当前页面本地风格：直接 DOM 更新、内联脚本。
- 修改字段名前先检查 `supabase_setup_v2.sql`。
- 所有 AI 分析调用经过 `src/ai/client.js` → DeepSeek API。
- Prompt 变更仅在 `src/ai/prompts.js` 中进行。
- Supabase 仅用于持久化 — trigger、function、视图中无分析逻辑。

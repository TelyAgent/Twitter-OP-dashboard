# 部署指南

## 本地开发

```bash
cp .env.example .env          # 编辑填入 SUPABASE_URL / SUPABASE_KEY / DEEPSEEK_API_KEY
npm start                     # → http://localhost:8080
```

## Vercel 部署

### 1. 设置环境变量

Vercel Dashboard → Settings → Environment Variables，添加：

| Key | 说明 |
|-----|------|
| `SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_KEY` | Supabase anon key |
| `DEEPSEEK_API_KEY` | DeepSeek API key |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址（默认 `https://api.deepseek.com`） |

### 2. 部署

项目已配置 `vercel.json` + `api/index.js`（catch-all serverless function），推送 main 分支自动部署。

也可以手动：

```bash
npx vercel --prod
```

### 限制

- **OpenCLI 代理不可用** — Vercel serverless 环境无法执行本地 CLI。Dashboard 中依赖 OpenCLI 的功能（抓取推文、同步列表成员）在线上会失败，本地 dev server 正常工作。
- **没有数据库** — 仅持久层 Supabase 是远程的，不需要本地数据库。

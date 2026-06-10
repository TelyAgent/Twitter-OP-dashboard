# 文档索引

> OP-dashboard 文档中心。每个文档有明确的定位和受众，彼此通过交叉引用关联。

## 文档地图

```
OP-dashboard/
├── CLAUDE.md                ← AI 代理工作指令（Claude Code 入口）
├── ARCHITECTURE.md          ← 技术架构参考
└── docs/
    ├── README.md            ← 文档索引（本文件）
    ├── SPEC.md              ← 产品功能清单
    ├── product-logic.md     ← 产品逻辑详解
    ├── scheduler.md         ← 定时同步调度器
    ├── TEST_PLAN.md         ← 手动测试计划
    └── deployment.md       ← 部署指南
```

## 文档说明

| 文档 | 定位 | 受众 | 维护频率 |
|------|------|------|----------|
| `CLAUDE.md` | AI 代理工作指令：项目形态、常用命令、编码约定、GitNexus 工作流 | AI 代理（Claude Code） | 约定变更时 |
| `ARCHITECTURE.md` | 技术架构参考：系统拓扑、认证、文件层级、模块 API、AI 双轨、数据库 | 开发者（人） | 架构变更时 |
| `docs/SPEC.md` | 产品功能清单：4 页面 × 功能矩阵，标注数据链路 | 产品 / 开发者 | 功能增删时 |
| `docs/product-logic.md` | 产品逻辑详解：流水线四环、评分管线、端到端数据流、设计原则 | 开发者 / 新成员 | 业务逻辑变更时 |
| `docs/scheduler.md` | 定时同步调度器：每日自动同步 Twitter 源推文，限流安全，配置参考 | 开发者 / 运维 | 调度策略变更时 |
| `docs/TEST_PLAN.md` | 手动测试计划：共享模块纯函数 + 页面功能 + 跨页面集成 | QA / 开发者 | 功能变更时 |
| `docs/deployment.md` | 部署指南：本地开发、Vercel 部署、环境变量、限制说明 | 开发者 | 部署流程变更时 |

## 文档关系

```
CLAUDE.md ─── 工作指令，引用 ──→ ARCHITECTURE.md（架构细节）
                              ├── docs/SPEC.md（功能边界）
                              └── docs/TEST_PLAN.md（验证方式）

ARCHITECTURE.md ─── 技术架构 ──→ docs/product-logic.md（业务逻辑详解）
                              ├── docs/SPEC.md（功能清单）
                              └── src/db/supabase_setup_v2.sql（权威 schema）

docs/SPEC.md ─── 功能清单 ──→ docs/product-logic.md（功能背后的逻辑）
                           ├── docs/TEST_PLAN.md（如何验证每项功能）

docs/product-logic.md ─── 业务逻辑 ──→ ARCHITECTURE.md（技术实现）
                                    ├── docs/SPEC.md（功能定义）

docs/scheduler.md ─── 定时调度 ──→ ARCHITECTURE.md（系统拓扑）
                                ├── docs/product-logic.md（聚类评分逻辑）

docs/TEST_PLAN.md ─── 测试计划 ──→ docs/SPEC.md（测试项来自功能清单）
                                ├── ARCHITECTURE.md（共享模块 API）
```

## 阅读路径

| 场景 | 推荐阅读顺序 |
|------|-------------|
| 新成员上手 | `CLAUDE.md` → `ARCHITECTURE.md` → `docs/product-logic.md` → `docs/SPEC.md` |
| 开发新功能 | `docs/SPEC.md`（定位功能） → `docs/product-logic.md`（理解管线） → `ARCHITECTURE.md`（找到代码位置） |
| 修 Bug | `docs/TEST_PLAN.md`（重现步骤） → `ARCHITECTURE.md`（定位模块） → `docs/product-logic.md`（理解预期行为） |
| AI 代理协作 | `CLAUDE.md`（工作指令） → 按需查阅其他文档 |

---

## 未来规划

以下文档计划在未来补充，按优先级排列：

| 优先级 | 文档 | 说明 | 触发条件 |
|--------|------|------|----------|
| P1 | `docs/database.md` | 数据库 schema 详解（表结构、字段说明、RLS 策略） | Supabase schema 定型后 |
| P1 | `docs/api-reference.md` | API 参考：DeepSeek 调用格式、OpenCLI 命令列表、Supabase 查询模式 | 外部接口稳定后 |
| P2 | `docs/changelog.md` | 变更日志：版本号、功能变更、破坏性改动 | 首次正式发布后 |
| P3 | `docs/contributing.md` | 贡献指南：代码风格、PR 流程、测试要求 | 有外部贡献者后 |

> **约定**：优先在当前文档中追加内容，等到某主题超过 50 行再拆分为独立文档。避免过早拆分导致文档碎片化。

# How to Write an Effective AGENTS.md / CLAUDE.md

> **综合来源**：OpenAI Harness Engineering（2026-02）、Anthropic 两篇长文（2025-11 / 2026-03）、
> Anthropic Claude Code 官方文档（memory + best-practices）、Martin Fowler / Birgitta Böckeler 分析、
> ignorance.ai Playbook、Hashimoto & Brockman 实践、以及 `harness-sources/` 目录中保存的全部一手文章。
>
> AGENTS.md（跨工具通用标准）和 CLAUDE.md（Claude Code 原生格式）在功能上等价。
> 本文所有原则同时适用于两者——差异仅在工具特定的加载机制和高级特性。

---

## 一、先理解范式转变：为什么这份文件如此重要

### 工程师角色已经变了

> "Humans steer. Agents execute."
> —— OpenAI Harness Engineering

Harness Engineering 是 2025-2026 年兴起的 AI 代理软件工程范式。工程师不再主要写代码，而是设计**环境、约束和反馈回路**让编码代理可靠工作。OpenAI 用 3-7 人、5 个月、0 行手写代码构建了百万行代码产品；Anthropic 通过多代理 harness 在复杂全栈应用上实现了质量跃升。

在这个范式下，AGENTS.md / CLAUDE.md 是 harness 中**杠杆最高的单一组件**——它是代理"入职第一天"读到的东西，决定了代理的心智模型、边界意识和导航能力。

### 但它不是全部

AGENTS.md 是 **Harness Engineering 三大支柱**（Birgitta Böckeler 框架）中"上下文工程"支柱的**入口**，而非整个 harness：

```
Harness Engineering
├── 1. Context Engineering ← AGENTS.md 是核心入口
│   ├── AGENTS.md / CLAUDE.md（地图）
│   ├── docs/ 知识库（深层真相）
│   ├── Skills / Subagents（按需知识）
│   └── 可观测性工具（动态上下文）
├── 2. Architectural Constraints
│   ├── 自定义 Linter + CI 强制
│   ├── 结构化测试（ArchUnit 类）
│   └── 分层架构边界
└── 3. Garbage Collection
    ├── 定期清理代理（doc-gardening）
    ├── 熵管理 + 质量评分
    └── 技术债 GC
```

**关键认知**：不要试图让 AGENTS.md 独自承担所有指导——它与 linter、CI、测试、docs/、Skills、Hooks 协同工作。能用机械手段强制的规则，永远不要放在 AGENTS.md 里"请求"。

---

## 二、三条核心原则

### 原则 1：地图，而非百科全书

> "Give Codex a map, not a 1,000-page instruction manual."
> —— OpenAI Harness Engineering

OpenAI 团队最初尝试"一个大 AGENTS.md"方法，失败原因：

| 失败模式 | 机制 |
|---------|------|
| **上下文拥挤** | 巨大指令文件挤占任务、代码和相关文档的空间 |
| **非指导悖论** | 当所有东西都"重要"时，没有东西是重要的 |
| **即刻腐烂** | 巨型文件变成陈旧规则墓地，人类停止维护 |
| **难以验证** | 单一文件难以做覆盖率、新鲜度、所有权的机械检查 |

正确做法：短 AGENTS.md（约 100 行）作为**目录**，带有指向更深真相源的指针。代理按需导航到更深上下文。

Anthropic 官方给出的上限更具体：

- **目标 < 200 行**（一些团队低至 60 行）
- **绝对上限约 300 行**（超过后 Claude "在噪音中丢失信号"）
- 每一行都消耗每次会话的 context window token
- **检验标准："如果删掉这行，代理会犯错吗？"** 如果不会，删掉它。

### 原则 2：仓库内知识为王

> "从代理角度看，任何它在运行时上下文中无法访问的东西实际上不存在。
> 那个团队在 Slack 对齐架构模式的讨论线程？如果不在仓库里，代理不知道。"
> —— OpenAI Harness Engineering

这意味着：
- 关键决策、约定、约束**必须**进入仓库（AGENTS.md 或 docs/）
- 如果一个规则很重要但只存在于 Slack/Notion/人脑中，它对代理**不存在**
- 但这**不等于**把一切塞进 AGENTS.md——而是放进仓库的**正确位置**（docs/、rules/、Skills）

### 原则 3：每次代理犯错都是 Harness 改进机会

> "Anytime you find an agent makes a mistake, you take the time to engineer a solution
> such that the agent never makes that mistake again."
> —— Mitchell Hashimoto

> "When the agent struggles, we treat it as a signal: identify what is missing — tools,
> guardrails, documentation — and feed it back into the repository."
> —— OpenAI Harness Engineering

这是 AGENTS.md 的**生命力来源**——它不是一次写好的静态文档，而是通过反馈回路持续进化的活文档。每次失败时的决策树：

```
代理犯了错误
├── 这个错误可以被 linter/CI 自动检测？
│   └── YES → 添加 linter 规则或 CI 检查（永久、机械强制）
├── 这个错误需要上下文才能避免？
│   ├── 每次都需要？ → 写入 AGENTS.md 根文件
│   ├── 只对特定子系统？ → 写入子目录 AGENTS.md 或路径限定 rule
│   └── 只是领域知识？ → 写入 docs/ 或 Skill
├── 这个错误需要工具支持？
│   └── YES → 添加 MCP server 或 Hook
└── 这个错误需要确定性保证？
    └── YES → 添加 Hook（而非 CLAUDE.md 指令）
```

---

## 三、内容决策矩阵：什么放哪里

这不是一个简单的"写什么/不写什么"问题——Claude Code 2026 版本的工具生态已经提供了丰富的层次化选项。

### 决策树

| 信息类型 | 放在哪里 | 为什么 |
|---------|---------|--------|
| 代理每次都需要、无法自动推断的信息 | **AGENTS.md / CLAUDE.md 根文件** | 始终加载 |
| 只对特定文件类型/目录有效的规则 | **.claude/rules/*.md**（含 paths frontmatter） | 按需加载，节省 token |
| 可重复的工作流或领域知识 | **Skills**（.claude/skills/） | 按需加载或手动触发 |
| 必须零例外执行的动作 | **Hooks**（.claude/settings.json） | 确定性触发，非建议性 |
| 需要隔离上下文的专门任务 | **Subagents**（.claude/agents/） | 独立 context window |
| 外部工具/API 访问 | **MCP Servers** | 扩展代理能力 |
| 详细的设计决策或背景知识 | **docs/ 目录** | @import 按需引用 |
| 可以被 linter/CI 自动检查的规则 | **Linter 配置 + CI** | 机械强制 > 文本指导 |
| 架构不变量 | **自定义 linter + 结构测试** | OpenAI 的实践：PR 级强制 |

### 根文件该写的 7 类内容

这些信息代理**每次都需要**，且无法从代码自动推断：

#### 1. 项目定位（2-3 句话）

给代理一个心智模型。不是营销文案，是**约束和优先级**。

```markdown
## Project Overview
B2B SaaS billing platform. Optimize for correctness over speed—
a wrong invoice is worse than a slow page load.
Primary users: finance teams at mid-market companies.
```

#### 2. 技术栈（列表形式）

精确到版本和包管理器。OpenAI 发现"无聊技术"（API 稳定、训练集表示充分）对代理更友好。

```markdown
## Tech Stack
- TypeScript 5.x, Node 20 LTS
- Next.js 14 (App Router, RSC-first)
- Drizzle ORM → PostgreSQL 16
- pnpm (NOT npm or yarn)
```

#### 3. 命令（放在文件靠前位置）

代理最常用的信息。必须精确可执行。Anthropic 官方特别强调：**"Claude 猜不到的 Bash 命令"是 CLAUDE.md 的首要内容**。

```markdown
## Commands
- Dev: `pnpm dev`
- Build: `pnpm build`
- Test all: `pnpm test`
- Test single: `pnpm test -- path/to/file.test.ts`
- Lint: `pnpm lint`
- Type check: `pnpm typecheck`
```

#### 4. 架构职责（NOT 完整文件树）

目录**做什么**，不是目录**有什么**。代理可以自己 `ls`。

```markdown
## Architecture
- `apps/web/` — Next.js frontend
- `apps/api/` — Express API server
- `packages/shared/` — shared types and utils
- API handlers: one file per resource in `src/api/handlers/`
- All DB queries through repository pattern in `src/repositories/`
```

#### 5. 具体可验证的编码规范

每条规则必须是代理可以**遵循并验证**的。Anthropic 官方的标准："Use ES modules" ✅ / "Format code properly" ❌

```markdown
## Coding Conventions
- Functional React components with hooks (no class components)
- Prefer server components; "use client" only for interactivity
- 2-space indentation, single quotes, trailing commas
- Error handling: Result<T, E> pattern, no try/catch in business logic
```

#### 6. 明确的禁止项

负面约束往往比正面指导更有效。

```markdown
## Boundaries
- NEVER modify files in `src/generated/`
- Do NOT add new dependencies without asking first
- Do NOT use `any` type in TypeScript
- Do NOT commit `.env` files
```

#### 7. 自验证方式

**这是大多数 AGENTS.md 的关键缺口。** Böckeler 批评 OpenAI 的文章缺乏功能验证；Anthropic 研究发现代理会在没有 E2E 测试的情况下将 feature 标记为完成。Anthropic 官方的最高杠杆建议：

> "Include tests, screenshots, or expected outputs so Claude can check itself.
> This is the single highest-leverage thing you can do."

```markdown
## Verification
- Run `pnpm test` before considering any task complete
- Run `pnpm lint && pnpm typecheck` to catch style/type issues
- For UI changes: take a screenshot and compare to expected result
- Do NOT mark a feature as "done" based on code inspection alone
```

### 不该写在根文件中的内容

| 不该写的 | 为什么 | 替代 |
|---------|--------|------|
| 完整目录树 | 代理可以 `ls`/`tree` | 只写目录**职责** |
| "写好代码" | LLM 已知，浪费 token | 写具体可验证的规则 |
| README 内容复制 | 重复膨胀 | `@README.md` 引用 |
| Linter 已覆盖的规则 | `.eslintrc` 已有 | 只写 linter 未覆盖的约定 |
| 标准语言约定 | Claude 已知 | 只写与默认不同的 |
| 频繁变化的信息 | 即刻腐烂 | 放入 docs/ 或生成脚本 |
| 过时的路径/命令 | 代理会信以为真 | 定期审查 + CI 检查 |
| 详细 API 文档 | 不相关任务时分散注意力 | 放入 docs/，按需加载 |
| 冗长解释或教程 | 消耗 token 无实际指导 | 放入 Skills 或 docs/ |
| 相互矛盾的规则 | 代理随机选一个 | 统一审查所有指令源 |

---

## 四、渐进式暴露：让 token 花在刀刃上

### 核心理念

每次会话中，根文件的每一行都消耗 context window。渐进式暴露的目标是：**只在需要时加载需要的信息**。

```
Layer 0（始终加载） → AGENTS.md / CLAUDE.md 根文件（< 200 行，理想 ~100 行）
Layer 1（始终加载） → .claude/rules/ 中无 paths 限定的规则
Layer 2（按需加载） → .claude/rules/ 中有 paths 限定的规则
Layer 3（按需加载） → 子目录的 CLAUDE.md / AGENTS.md
Layer 4（显式引用） → docs/ 中的设计文档、架构图
Layer 5（按需/手动） → Skills（领域知识 + 可重复工作流）
Layer 6（独立上下文） → Subagents（隔离的调查/审查任务）
```

### 实现方式

#### A. 子目录嵌套（Codex & Claude Code 均支持）

代理进入特定目录时，就近的 AGENTS.md/CLAUDE.md 自动加载。适合 monorepo。

```
project/
├── AGENTS.md              ← 全局规则（始终加载）
├── docs/
│   ├── architecture.md    ← 按需引用
│   └── api-guide.md
├── src/
│   ├── api/
│   │   └── AGENTS.md      ← API 专属规则
│   └── frontend/
│       └── AGENTS.md      ← 前端专属规则
```

#### B. Claude Rules 目录（Claude Code 专属）

```
project/.claude/
├── CLAUDE.md
└── rules/
    ├── code-style.md       ← 始终加载（无 paths）
    ├── testing.md           ← 始终加载（无 paths）
    └── api-design.md        ← 路径限定：
```

路径限定示例——只在代理操作匹配文件时加载：
```markdown
---
paths:
  - "src/api/**/*.ts"
---
# API Rules
- All endpoints must include input validation with zod
- Use the standard error response format from `src/api/errors.ts`
```

#### C. @import 引用

```markdown
See @docs/architecture.md for detailed design.
See @package.json for available scripts.
```

- 相对路径基于包含 import 的文件解析
- 最大递归深度 5 层
- 个人偏好可引用 home 目录：`@~/.claude/my-project-instructions.md`

#### D. 指针 + 触发条件

告诉代理**何时**去读，而非每次都读：

```markdown
## When to Read More
- Adding/modifying API endpoints → read `docs/api-guide.md`
- Database changes → read `docs/db-migrations.md`
- UI component work → read `docs/design-system.md`
```

#### E. AGENTS.md 兼容桥接（多工具团队）

如果仓库已有 AGENTS.md：
```markdown
# CLAUDE.md
@AGENTS.md

## Claude-specific
Use plan mode for changes under `src/billing/`.
```

---

## 五、与机械强制的分工

### 约束悖论

> "代理在无约束环境中挣扎。矛盾的是，更严格的约束产生更可靠的代理输出。"
> —— Birgitta Böckeler

> "你通常推迟到有上百名工程师时才做的架构决策，在使用编码代理时成为了早期前提。"
> —— Birgitta Böckeler

### 规则放在哪里？

**核心原则：能用 linter/CI/Hook 强制的，不要用 AGENTS.md 指导。**

| 如果规则... | 放在... | 原因 |
|------------|---------|------|
| 可以被 linter/CI 自动检查 | Linter 配置 + CI | 机械强制 > 文本指导 |
| 是架构不变量 | 自定义 linter + 结构测试 | PR 级强制，错误信息即修复指令 |
| 必须零例外执行 | Hook（.claude/settings.json） | 确定性保证，非建议性 |
| 无法自动化但很重要 | AGENTS.md | 代理靠文本指导的最后手段 |
| 只对特定子系统适用 | 子目录 AGENTS.md 或路径限定 rules | 避免污染全局上下文 |
| 是详细背景知识 | docs/ 或 Skills | 按需引用，不始终加载 |

OpenAI 的一个精妙实践：**自定义 linter 的错误信息同时是修复指令**。当代理违反架构约束时，错误信息不仅标记违规，还告诉代理如何修复。工具在运行时教会代理。

### 信号层级

Anthropic 官方文档明确了 Claude Code 中不同指令形式的可靠性层级：

```
确定性保证  ← Hooks（always execute, no exceptions）
            ← Managed settings（permissions.deny, sandbox）
强可靠性    ← Linter/CI（mechanical enforcement）
            ← --append-system-prompt（system prompt level）
中等可靠性  ← CLAUDE.md / rules/（user message, advisory）
            ← 可用 IMPORTANT / YOU MUST 增强
低可靠性    ← 对话中的口头指令（会在 compaction 中丢失）
```

---

## 六、加载层级详解

### Claude Code（CLAUDE.md）

| 作用域 | 位置 | 加载时机 | 可排除？ |
|--------|------|---------|---------|
| 托管策略（组织级） | `/Library/Application Support/ClaudeCode/CLAUDE.md` (macOS) <br> `/etc/claude-code/CLAUDE.md` (Linux) <br> `C:\Program Files\ClaudeCode\CLAUDE.md` (Windows) | 始终 | **否** |
| 用户级 | `~/.claude/CLAUDE.md` + `~/.claude/rules/*.md` | 始终 | — |
| 项目级 | `./CLAUDE.md` 或 `./.claude/CLAUDE.md` | 始终 | `claudeMdExcludes` |
| 子目录级 | `子目录/CLAUDE.md` | Claude 读取该目录文件时 | `claudeMdExcludes` |
| 路径限定规则 | `.claude/rules/*.md`（含 paths frontmatter） | Claude 操作匹配文件时 | `claudeMdExcludes` |

Monorepo 排除：
```json
{ "claudeMdExcludes": ["**/other-team/CLAUDE.md", "**/other-team/.claude/rules/**"] }
```

HTML 注释（`<!-- ... -->`）在注入 context 前被剥离。可用于人类维护者笔记而不消耗 token。

### Codex（AGENTS.md）

| 层级 | 位置 | 说明 |
|------|------|------|
| 全局 | `~/.codex/AGENTS.md` | 所有仓库继承 |
| 仓库级 | 仓库根 `AGENTS.md` | 项目规范 |
| 子目录覆盖 | `AGENTS.override.md` | 更细粒度的覆盖 |

### 跨工具策略

| 文件 | 归属 | 说明 |
|------|------|------|
| `AGENTS.md` | OpenAI Codex / 跨工具通用 | Cursor、Continue.dev、Aider、OpenHands 等均支持 |
| `CLAUDE.md` | Claude Code | 原生格式，支持 @import、rules/、Skills 等 |
| `.cursorrules` | Cursor | 支持 MDC/YAML frontmatter |
| `copilot-instructions.md` | GitHub Copilot | 位于 `.github/` 目录 |

**选择策略**：
- 单工具团队 → 用原生文件
- 多工具团队 → `AGENTS.md` 作为共享主源，`CLAUDE.md` 用 `@AGENTS.md` 桥接后补充 Claude 专属配置
- **避免在多个文件中重复相同规则**

---

## 七、验证体系：Harness 的质量保障

这是整个 Harness 最容易被忽视但最关键的部分。

### 问题

Anthropic 两篇文章都发现了同一个失败模式：**代理将 feature 标记为完成而没有真正验证**。更深层的问题：**代理自评时倾向于夸赞自己的工作**（Prithvi Rajasekaran 称之为"自评偏差"）。

### 解决方案层级

#### Level 1: 在 AGENTS.md 中声明验证命令
```markdown
## Verification
- Run `pnpm test` before considering any task complete
- Run `pnpm lint && pnpm typecheck`
```

#### Level 2: 要求 E2E 验证
Anthropic 发现单元测试和 CLI 验证不够——必须"作为人类用户"进行端到端测试。
```markdown
- For web features: use browser automation to verify actual rendering
- For API changes: send real HTTP requests and validate responses
```

#### Level 3: Gen/Eval 分离（多代理架构）
Anthropic 的突破性实践：**分离 Generator 和 Evaluator**。"调优独立评估者使其保持怀疑态度，比调优自评要容易得多。"

适用于大型项目的多代理 harness 设计：
- **Planner**：扩展 1-4 句 prompt 为完整产品规格
- **Generator**：一次一个 feature 实现
- **Evaluator**：用 Playwright 像真实用户一样与应用交互，按维度打分

#### Level 4: Sprint 合约
Generator 和 Evaluator 在实现前协商"完成"标准，弥合规格与可测试实现之间的鸿沟。

### 四维度评分（前端/UI 场景）

Anthropic 的 Evaluator 使用四个具体可评分的维度：

1. **设计质量**：颜色、排版、布局的连贯性
2. **原创性**：自定义决策 vs 模板默认值；惩罚 "AI 泥巴" 模式
3. **工艺**：排版层次、间距一致性、色彩和谐
4. **功能性**：用户理解度和任务完成度

---

## 八、生命周期："Build to Delete"

### 核心原则

> "Harness 中的每个组件都编码了关于模型无法独立完成什么的假设。
> 随着模型改进，开发者应定期压力测试这些假设，移除非承重组件。"
> —— Prithvi Rajasekaran, Anthropic

实证：当 Opus 4.6 发布后（更好的长上下文规划），Anthropic 完全移除了 sprint 构造——模型可以原生处理分解。这直接减少了 30%+ 的运行时间和成本。

### 维护节奏

| 检查项 | 频率 | 方法 |
|--------|------|------|
| 路径和命令是否仍然有效 | 每次重大重构后 | 人工审查或 CI 脚本 |
| 是否有规则已被 linter/Hook 覆盖 | 每月 | 对比 AGENTS.md 和配置 |
| 是否有规则模型已能自行遵循 | 每次模型升级后 | 移除规则 → 观察是否犯错 |
| 是否有相互矛盾的规则 | 每季度 | 审查所有指令源 |
| 文件是否超过 200 行 | 持续 | 行数检查 → 拆分 |

### 诊断信号（Anthropic 官方）

- **Claude 尽管有规则仍反复做你不想要的事** → 文件可能太长，规则被淹没了
- **Claude 反复问已有答案的问题** → 措辞可能模糊
- **Claude 忽略一半指令** → CLAUDE.md 过于臃肿，重要规则在噪音中丢失

### 关于自动生成

- Claude Code `/init` 可生成基于项目的起始文件——好的起点
- **但 Anthropic 建议避免完全自动生成**——应仔细手工打磨
- OpenAI 的不同做法：AGENTS.md 本身由代理编写和维护
- 推荐：**代理生成初稿 → 人类审查精炼 → 持续迭代**
- OpenAI 更激进：用 "doc-gardening" 代理自动扫描陈旧文档并开 PR

---

## 九、从空仓库到成熟 Harness：渐进路径

```
Phase 0: 起步
  └→ 写 ~50 行核心规则（项目概述 + 技术栈 + 命令 + 关键约定）
  └→ 或用 `/init` 生成初稿，然后删到只剩"删了会犯错"的内容
  └→ 开始用代理工作，观察行为

Phase 1: 响应式完善（前几周）
  └→ 代理每次犯错 → 走决策树（Section 二·原则 3）：
      ├→ 可机械强制？ → 加 linter/CI/Hook
      ├→ 需要上下文？ → 加 AGENTS.md 或 rules/
      └→ 需要工具？   → 加 MCP server 或 Skill
  └→ 每条新规则都对应一个具体的过去失败

Phase 2: 结构化（1-2 个月后）
  └→ 根文件超过 ~150 行 → 拆分到 rules/ 或子目录
  └→ 建立 docs/ 知识库，根文件只保留指针
  └→ 为不同子系统建立专属 AGENTS.md
  └→ 把可重复工作流抽取为 Skills
  └→ 把确定性需求转为 Hooks

Phase 3: 持续 GC（常态化）
  └→ 模型升级后移除不必要的规则
  └→ 定期清理：过时路径、重复指令、已被 linter 覆盖的规则
  └→ 考虑引入 "doc-gardening" 自动化清理
  └→ 追踪质量评分，量化 harness 有效性
```

---

## 十、控制指标

| 指标 | 目标值 | 来源 |
|------|-------|------|
| 根文件行数 | < 200 行（理想 ~100 行） | Anthropic 官方 + OpenAI 实践 |
| 单条规则 | 一句话、可验证 | Anthropic best practices |
| 矛盾规则数 | 0 | 全部来源 |
| 过时信息 | 0 | 全部来源 |
| 无法被 linter 覆盖的规则占比 | 应逐渐降低 | Fowler 三支柱模型 |
| 每条规则对应一个具体失败 | 100%（理想） | Hashimoto 原则 |

---

## 十一、参考模板

这不是"填空模板"——每个 section 是否需要取决于你的项目。原则是：**只保留删了会犯错的内容**。

```markdown
# AGENTS.md

## Project Overview
[2-3 句话：这是什么、给谁用、关键约束/优先级。]

## Tech Stack
[精确列表：语言、框架、运行时版本、包管理器。]

## Commands
[Build/Test/Lint/Dev 命令。精确可执行，含必要 flags。]

## Architecture
[目录职责。NOT 文件树。关键设计模式和边界。]

## Coding Conventions
[具体可验证的规则。每条可以回答"遵循了没有？"]

## Boundaries
[代理不能做什么。不能碰什么文件。不能引入什么依赖。]

## Verification
[代理如何自验结果。必须包含比单元测试更强的验证。]

## Additional Context
[指向 docs/、Skills 中详细文档的指针 + 触发条件。]
```

---

## 十二、参考资源

### 官方一手来源

| 来源 | 链接 | 核心贡献 |
|------|------|---------|
| OpenAI Harness Engineering | https://openai.com/index/harness-engineering/ | 地图 vs 百科全书、渐进式暴露、机械强制、docs/ 体系 |
| OpenAI Unlocking the Codex Harness | https://openai.com/index/unlocking-the-codex-harness/ | App Server 架构、Codex harness 内部机制 |
| Anthropic: Effective Harnesses (Nov 2025) | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | Initializer/Coding 两阶段、JSON feature list、E2E 测试、跨会话连续性 |
| Anthropic: Harness Design (Mar 2026) | https://www.anthropic.com/engineering/harness-design-long-running-apps | Gen/Eval 分离、四维度评分、Build to Delete、Sprint 合约 |
| Anthropic: Claude Code Memory 文档 | https://code.claude.com/docs/en/memory | CLAUDE.md 放置位置、@import、rules/、层级加载、Auto memory |
| Anthropic: Claude Code Best Practices | https://code.claude.com/docs/en/best-practices | 验证第一、CLAUDE.md 写作、Skills/Hooks/Subagents 分工 |
| Martin Fowler / Böckeler: Harness Engineering | https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html | 三支柱框架、约束悖论、验证缺口批评、未来预测 |
| Böckeler: Context Engineering | https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html | 上下文配置选项的爆炸式增长、Claude Code 创新领先 |

### 社区深度分析

| 来源 | 链接 |
|------|------|
| ignorance.ai: Harness Engineering Playbook | https://www.ignorance.ai/p/the-emerging-harness-engineering |
| Hashimoto: My AI Adoption Journey | https://mitchellh.com/writing/my-ai-adoption-journey |
| Ghostty AGENTS.md 实例 | https://github.com/ghostty-org/ghostty/blob/main/src/inspector/AGENTS.md |
| Anthropic 官方示例代码 | https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding |

### 本项目源文章存档

详见 `harness-sources/` 目录中保存的各篇文章全文与摘要。
              
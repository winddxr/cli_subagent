# CLI Subagent

[English](./README.md)

将任意 LLM CLI 当作 subagent 或一次性 API 调用来使用。配置驱动、stdin 传参 —— 换模型只改配置，不改代码。

目的很朴素：**省钱**，在合适的地方混用不同模型。

全 vibe coding。不优雅。

## 实现版本

| | 语言 | 运行时 | 入口 |
|---|------|--------|------|
| **TS** (主力) | TypeScript | [Bun](https://bun.sh) | [`ts-lib/cli_subagent.test.ts`](ts-lib/cli_subagent.test.ts) |
| **Python** (参考) | Python 3.10+ | CPython / uv | [`py-lib/`](py-lib/) |

两个版本对相同输入产生一致的 `AgentResult`。Python 版本是行为规范；TypeScript 版本是推荐的运行时。

## 支持的 CLI

| CLI | Profile | 系统提示词机制 |
|-----|---------|---------------|
| **Gemini CLI** | `GEMINI_PROFILE` | `GEMINI_SYSTEM_MD` 环境变量 → 文件路径 |
| **Codex CLI** | `CODEX_PROFILE` | `AGENTS.override.md` (文件模式) / `AGENTS.md` (目录模式) |

## 快速开始 (TypeScript / Bun)

```ts
import {
  UniversalCLIAgent, GEMINI_PROFILE, CODEX_PROFILE
} from "./ts-lib/cli_subagent.test.ts";

// 自动检测文件或目录
const agent = UniversalCLIAgent.fromPath({
  profile: GEMINI_PROFILE,
  agentName: "creator",
  path: "./prompts/creator.system.md",
});

const result = await agent.call("生成一个创意概念...");
if (result.ok) {
  console.log(result.content);
} else {
  console.error(result.error);
}
```

### 文件模式

```ts
const agent = UniversalCLIAgent.fromFile({
  profile: GEMINI_PROFILE,
  agentName: "creator",
  agentPromptPath: "./prompts/creator.system.md",
});
```

### 目录模式

```ts
// 目录需包含对应 CLI 的系统提示词文件：
//   Codex  → {workspace}/AGENTS.md
//   Gemini → {workspace}/.gemini/system.md
const agent = UniversalCLIAgent.fromDirectory({
  profile: CODEX_PROFILE,
  agentName: "coder",
  agentWorkspace: "./workspaces/coder",
});
```

### 模型覆盖

```ts
// 构造时指定
const agent = UniversalCLIAgent.fromPath({
  profile: GEMINI_PROFILE,
  agentName: "writer",
  path: "./prompts/writer.system.md",
  model: "gemini-2.5-pro",
});

// 调用时覆盖（优先级最高）
const result = await agent.call("写一首诗", { model: "gemini-2.5-flash" });
```

> **模型优先级**: `call(model=)` > 构造函数 `model` > `profile.model`

## 快速开始 (Python)

完整 Python API 参考见 [py-lib/README_CN.md](py-lib/README_CN.md)。

```python
from cli_subagent import UniversalCLIAgent, GEMINI_PROFILE

agent = UniversalCLIAgent.from_path(
    profile=GEMINI_PROFILE,
    agent_name="creator",
    path="./prompts/creator.system.md",
)
result = agent.call("生成一个创意概念...")
```

## 核心概念

### AgentResult

每次调用返回标准化的 `AgentResult`：

| 字段 | 类型 | 描述 |
|------|------|------|
| `ok` | `boolean` | 调用是否成功 |
| `content` | `string` | AI 生成的内容 (Markdown) |
| `stats` | `object` | Token 用量统计 |
| `error` | `object?` | 结构化错误详情（失败时） |

Token 访问器：`inputTokens()`, `outputTokens()`, `totalTokens()`, `cachedTokens()`, `perModel()`

### CLIProfile

定义如何调用一个 CLI 的配置：

| 字段 | 类型 | 描述 |
|------|------|------|
| `name` | `string` | Profile 标识 |
| `commandTemplate` | `string[]` | 命令行模板（仅路径占位符） |
| `envVars` | `Record<string, string>` | 环境变量模板 |
| `outputParser` | `function` | 输出解析函数 |
| `requiresTempDir` | `boolean` | 文件模式是否需要临时目录 |
| `fileModeOverrideName` | `string` | 文件模式下复制的文件名 |
| `dirModeSystemFile` | `string` | 目录模式下系统提示词相对路径 |

> 任务提示词**始终**通过 stdin 传递，不使用命令行参数。

### 错误类型

| 类型 | 说明 | 是否可重试 |
|------|------|-----------|
| `timeout` | CLI 执行超时 | 是 |
| `cli_not_found` | CLI 可执行文件未找到 | 否 |
| `cli_error` | CLI 返回非零退出码 | 视情况 |
| `parse_error` | 输出解析失败 | 否 |
| `agent_error` | Agent 内部错误 (Codex) | 视情况 |
| `execution_error` | 其他执行异常 | 视情况 |

## 添加新的 CLI

1. 编写 CLI 输出格式的解析函数
2. 创建 `CLIProfile` 对象
3. 注册到 profiles map

```ts
const NEW_PROFILE: CLIProfile = {
  name: "new_cli",
  commandTemplate: ["new_cli", "--json"],
  envVars: { NEW_CLI_SYSTEM: "{agent_prompt_path}" },
  outputParser: parseNewCli,
  requiresTempDir: false,
  fileModeOverrideName: "",
  dirModeSystemFile: ".new_cli/system.md",
};
PROFILES.set("new_cli", NEW_PROFILE);
```

## 项目结构

```
cli_subagent/
├── ts-lib/cli_subagent.test.ts              # TypeScript 实现（单文件，Bun）
├── ts-lib/cli_subagent.test.ts         # TypeScript 测试
├── py-lib/                     # Python 参考实现
│   ├── cli_subagent/            # Python 包
│   │   ├── __init__.py
│   │   ├── core.py              # 核心类
│   │   └── profiles.py          # CLI Profile 及解析器
│   ├── test_compatibility.py    # 集成测试
│   ├── README.md                # Python API 参考（英文）
│   └── README_CN.md             # Python API 参考（中文）
├── dev-doc/                     # 设计文档
│   ├── CLI_INVOCATION_PROTOCOL.md
│   ├── BUN_API_REFERENCE.md
│   └── COMPATIBILITY_FINDINGS.md
├── AGENTS.md                    # Agent 指令
└── model_list.md                # 支持的模型标识
```

## 运行测试

```bash
# TypeScript
bun test

# Python
cd py-lib && uv run python test_compatibility.py
```

## 许可证

[MIT](LICENSE)

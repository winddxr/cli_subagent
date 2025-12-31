# CLI Subagent Module

[English](./README.md)

项目的目的：让你在各种场景下，可以将cli当作一个subagent或者一个单次调用的api来使用，实现了低成本的多模型调用。而目录模式启动的时候，每个cli又能作为一个实现相对复杂的子代理来使用。你可以灵活的在任何你需要御三家API模型的地方使用。
最终目的很朴素：省钱。
全vibe coding。不优雅。

通用 CLI 代理抽象层，支持通过配置驱动方式调用任意 LLM CLI (Codex/Gemini)。

## 功能特性

- **解耦**: 编排逻辑与底层 CLI 实现分离
- **可扩展**: 新增 CLI 只需定义新的 Profile 配置
- **标准化**: 统一的输入/输出接口 (`AgentResult`)
- **Token 统计**: 自动归一化不同 CLI 的用量数据
- **双模式**: 支持文件模式和目录模式两种输入方式
- **日志支持**: 使用标准 `logging` 模块，调用方可控
- **详细错误**: 返回结构化错误信息，便于调用方决策重试

## 安装

### 作为 Git 子模块 (推荐)

如果你希望将此代理作为另一个项目的一部分使用：

```bash
git submodule add https://github.com/winddxr/cli_subagent.git scripts/cli_subagent
```

### 独立使用

克隆仓库并确保 `scripts` 目录在 Python 路径中：

```bash
git clone https://github.com/winddxr/cli_subagent.git
cd cli_subagent
export PYTHONPATH=$PYTHONPATH:$(pwd)
```

## 快速开始

### 自动检测模式（推荐）

```python
from cli_subagent import UniversalCLIAgent, GEMINI_PROFILE

# 自动检测输入是文件还是目录
agent = UniversalCLIAgent.from_path(
    profile=GEMINI_PROFILE,
    agent_name="creator",
    path="./prompts/creator.system.md"  # 文件或目录
)

result = agent.call("生成一个创意概念...")
if result.ok:
    print(result.content)
    print(f"Tokens: {result.total_tokens}")
else:
    print(f"Error: {result.error}")
```

### 文件模式

```python
from cli_subagent import UniversalCLIAgent, GEMINI_PROFILE

agent = UniversalCLIAgent.from_file(
    profile=GEMINI_PROFILE,
    agent_name="creator",
    agent_prompt_path="./prompts/creator.system.md"
)
result = agent.call("生成一个创意概念...")
```

### 目录模式

```python
from cli_subagent import UniversalCLIAgent, CODEX_PROFILE

# 目录结构要求:
# - Codex: {workspace}/AGENTS.md
# - Gemini: {workspace}/.gemini/system.md
agent = UniversalCLIAgent.from_directory(
    profile=CODEX_PROFILE,
    agent_name="coder",
    agent_workspace="./workspaces/coder"
)
result = agent.call("实现该功能...")
```

## 支持的 CLI

| CLI | Profile | 说明 |
|-----|---------|----- |
| **Gemini** | `GEMINI_PROFILE` | 使用 `GEMINI_SYSTEM_MD` 环境变量指定系统提示词 |
| **Codex** | `CODEX_PROFILE` | 使用 `AGENTS.override.md` (文件模式) 或 `AGENTS.md` (目录模式) |

## 目录结构约定

### Codex Workspace
```
workspace/
└── AGENTS.md              # 或 AGENTS.override.md
```

### Gemini Workspace
```
workspace/
└── .gemini/
    └── system.md
```

## API 参考

### `UniversalCLIAgent`

主代理类，提供三种工厂方法：

```python
# 自动检测模式（推荐）
agent = UniversalCLIAgent.from_path(
    profile: CLIProfile,   # CLI 配置
    agent_name: str,       # Agent 名称 (用于日志)
    path: Path | str,      # 文件或目录路径
)

# 文件模式
agent = UniversalCLIAgent.from_file(
    profile: CLIProfile,
    agent_name: str,
    agent_prompt_path: Path | str,  # 系统提示词文件
)

# 目录模式
agent = UniversalCLIAgent.from_directory(
    profile: CLIProfile,
    agent_name: str,
    agent_workspace: Path | str,    # Workspace 目录
)

# 调用 Agent
result = agent.call(
    task_content: str,     # 任务提示词
    timeout: int = 300,    # 超时秒数
) -> AgentResult
```

### `AgentResult`

标准化的调用结果：

| 属性 | 类型 | 描述 |
|------|------|------|
| `ok` | `bool` | 调用是否成功 |
| `content` | `str` | AI 生成的内容 (Markdown) |
| `stats` | `dict` | Token 用量统计 |
| `error` | `dict` | 错误详情 (失败时) |
| `input_tokens` | `int` | 输入 Token 数 |
| `output_tokens` | `int` | 输出 Token 数 |
| `total_tokens` | `int` | 总 Token 数 |
| `cached_tokens` | `int` | 缓存命中 Token 数 |
| `per_model` | `dict` | 按模型分类的 Token 统计 (仅 Gemini) |

### `CLIProfile`

CLI 配置定义：

| 属性 | 类型 | 描述 |
|------|------|------|
| `name` | `str` | Profile 标识 |
| `command_template` | `List[str]` | 命令行模板（仅支持路径占位符） |
| `env_vars` | `Dict[str, str]` | 环境变量模板 |
| `output_parser` | `Callable` | 输出解析函数 |
| `requires_temp_dir` | `bool` | 是否需要临时目录 (文件模式) |
| `file_mode_override_name` | `str` | 文件模式下复制的文件名 (Codex: `AGENTS.override.md`) |
| `dir_mode_system_file` | `str` | 目录模式下系统提示词的相对路径 |

> **注意**: 任务提示词（Task Prompt）始终通过 **stdin** 传递，不在 `command_template` 中使用。
> 支持的占位符仅限于路径：`{agent_prompt_path}`, `{temp_dir}`。

### `InputMode`

输入模式枚举：

```python
from cli_subagent import InputMode

InputMode.FILE       # 文件模式
InputMode.DIRECTORY  # 目录模式
```

### 错误处理

当 `result.ok == False` 时，`result.error` 包含结构化错误信息：

| 错误类型 | 说明 | 是否建议重试 |
|----------|------|-------------|
| `timeout` | CLI 执行超时 | ✅ 可重试 |
| `cli_not_found` | CLI 可执行文件未找到 | ❌ 不重试 |
| `cli_error` | CLI 返回非零退出码 | 视情况 |
| `parse_error` | 输出解析失败 | ❌ 不重试 |
| `agent_error` | Agent 内部错误 (Codex) | 视情况 |
| `execution_error` | 其他执行异常 | 视 `exception_type` |

`execution_error` 包含 `exception_type` 字段帮助判断：

```python
if not result.ok:
    err = result.error
    if err["type"] == "timeout":
        # 可以重试
        pass
    elif err["type"] == "execution_error":
        # 根据异常类型判断
        if err.get("exception_type") in ("OSError", "IOError"):
            # 可能可重试
            pass
```

### 日志记录

模块使用标准 `logging` 模块，默认不输出任何日志（使用 `NullHandler`）。

启用日志：

```python
import logging

# 方式 1: 全局启用 DEBUG
logging.basicConfig(level=logging.DEBUG)

# 方式 2: 仅启用 cli_subagent 日志
logging.getLogger("cli_subagent.core").setLevel(logging.DEBUG)
logging.getLogger("cli_subagent.core").addHandler(logging.StreamHandler())
```

日志包含：CLI 发现、命令执行、返回状态、解析结果等关键信息。

## 添加新的 CLI

1. 在 `profiles.py` 中定义新的解析函数
2. 创建新的 `CLIProfile` 实例
3. 添加到 `PROFILES` 字典

示例：

```python
def parse_new_cli(stdout: str, stderr: str, returncode: int) -> AgentResult:
    # 解析逻辑
    ...

NEW_CLI_PROFILE = CLIProfile(
    name="new_cli",
    command_template=["new_cli", "--json"],
    env_vars={"NEW_CLI_SYSTEM": "{agent_prompt_path}"},
    output_parser=parse_new_cli,
    dir_mode_system_file=".new_cli/system.md",
)

PROFILES["new_cli"] = NEW_CLI_PROFILE
```


## 文件结构

```
cli_subagent/
├── README.md       # 本文档
├── __init__.py     # 包导出
├── core.py         # 核心类定义 (UniversalCLIAgent, AgentResult, InputMode)
└── profiles.py     # CLI Profile 配置 (GEMINI_PROFILE, CODEX_PROFILE)
```

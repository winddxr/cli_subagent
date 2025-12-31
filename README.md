# CLI Subagent Module

通用 CLI 代理抽象层，支持通过配置驱动方式调用任意 LLM CLI (Codex/Gemini)。

## 功能特性

- **解耦**: 编排逻辑与底层 CLI 实现分离
- **可扩展**: 新增 CLI 只需定义新的 Profile 配置
- **标准化**: 统一的输入/输出接口 (`AgentResult`)
- **Token 统计**: 自动归一化不同 CLI 的用量数据
- **双模式**: 支持文件模式和目录模式两种输入方式

## 安装

模块为项目内置，无需额外安装。确保项目根目录在 Python 路径中：

```python
import sys
sys.path.insert(0, "path/to/RednoteWriterDev/scripts")
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

## 测试

```bash
# 单元测试
uv run python -m pytest tests/test_cli_subagent.py -v

# 真实 CLI 调用测试 (需要配置凭据)
uv run python tests/test_real_cli_invocation.py
```

## 文件结构

```
cli_subagent/
├── README.md       # 本文档
├── __init__.py     # 包导出
├── core.py         # 核心类定义 (UniversalCLIAgent, AgentResult, InputMode)
└── profiles.py     # CLI Profile 配置 (GEMINI_PROFILE, CODEX_PROFILE)
```

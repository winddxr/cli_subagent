# CLI Subagent Module

通用 CLI 代理抽象层，支持通过配置驱动方式调用任意 LLM CLI(Codex/Gemini)。

## 功能特性

- **解耦**: 编排逻辑与底层 CLI 实现分离
- **可扩展**: 新增 CLI 只需定义新的 Profile 配置
- **标准化**: 统一的输入/输出接口 (`AgentResult`)
- **Token 统计**: 自动归一化不同 CLI 的用量数据

## 安装

模块为项目内置，无需额外安装。确保项目根目录在 Python 路径中：

```python
import sys
sys.path.insert(0, "path/to/RednoteWriterDev/scripts")
```

## 快速开始

```python
from cli_subagent import UniversalCLIAgent, GEMINI_PROFILE
from pathlib import Path

# 1. 创建 Agent 实例
agent = UniversalCLIAgent(
    profile=GEMINI_PROFILE,
    persona_name="creator",
    persona_path=Path("./personas/creator.system.md")
)

# 2. 调用任务
result = agent.call("生成一个创意概念...")

# 3. 处理结果
if result.ok:
    print(result.content)
    print(f"Tokens: {result.total_tokens}")
else:
    print(f"Error: {result.error}")
```

## 支持的 CLI

| CLI | Profile | 命令格式 |
|-----|---------|---------|
| **Gemini** | `GEMINI_PROFILE` | `gemini --output-format json --prompt {prompt}` |
| **Codex** | `CODEX_PROFILE` | `codex exec -m gpt-5.1 --json {prompt}` |

## API 参考

### `AgentResult`

标准化的调用结果：

| 属性 | 类型 | 描述 |
|------|------|------|
| `ok` | `bool` | 调用是否成功 |
| `content` | `str` | AI 生成的内容 (Markdown) |
| `stats` | `dict` | Token 用量统计 |
| `error` | `dict` | 错误详情 (失败时) |
| `input_tokens` | `int` | 输入 Token 数 |
| `output_tokens` | `int` | 输出 Token 数 (Gemini: candidates) |
| `total_tokens` | `int` | 总 Token 数 |
| `cached_tokens` | `int` | 缓存命中 Token 数 |
| `thoughts_tokens` | `int` | 思考 Token 数 (仅 Gemini) |
| `tool_tokens` | `int` | 工具调用 Token 数 (仅 Gemini) |
| `per_model` | `dict` | 按模型分类的 Token 统计 (仅 Gemini，用于分模型计费) |

### `CLIProfile`

CLI 配置定义：

| 属性 | 类型 | 描述 |
|------|------|------|
| `name` | `str` | Profile 标识 |
| `command_template` | `List[str]` | 命令行模板 |
| `env_vars` | `Dict[str, str]` | 环境变量模板 |
| `output_parser` | `Callable` | 输出解析函数 |
| `requires_temp_dir` | `bool` | 是否需要临时目录 |

### `UniversalCLIAgent`

主代理类：

```python
agent = UniversalCLIAgent(
    profile: CLIProfile,      # CLI 配置
    persona_name: str,        # 角色名称 (用于日志)
    persona_path: Path,       # Persona 文件路径
)

result = agent.call(
    task_content: str,        # 任务提示词
    timeout: int = 300,       # 超时秒数
) -> AgentResult
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
    command_template=["new_cli", "--json", "{prompt}"],
    env_vars={"NEW_CLI_SYSTEM": "{persona_path}"},
    output_parser=parse_new_cli,
)

PROFILES["new_cli"] = NEW_CLI_PROFILE
```

## 测试

```bash
uv run python -m unittest tests.test_cli_subagent -v
```

## 文件结构

```
cli_subagent/
├── README.md       # 本文档
├── __init__.py     # 包导出
├── core.py         # 核心类定义
└── profiles.py     # CLI Profile 配置
```

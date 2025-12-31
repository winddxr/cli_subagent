# CLI Subagent Module

[中文](./README_CN.md)

Project Goal: To allow you to use the CLI as a subagent or a single-call API in various scenarios, achieving low-cost multi-model invocation. When started in directory mode, each CLI can serve as a relatively complex subagent. You can flexibly use it wherever you need the "Big Three" (GPT, CLAUDE, and GEMINI) API models.

The ultimate goal is simple: Save money.

Full vibe coding. Not elegant.

Universal CLI agent abstraction layer, supporting the invocation of arbitrary LLM CLIs (Codex/Gemini) via configuration-driven methods.

## Features

- **Decoupled**: Orchestration logic separated from underlying CLI implementation
- **Extensible**: Adding a new CLI only requires defining a new Profile configuration
- **Standardized**: Unified input/output interface (`AgentResult`)
- **Token Statistics**: Automatically normalize usage data from different CLIs
- **Dual Mode**: Supports both file mode and directory mode inputs
- **Logging Support**: Uses standard `logging` module, controllable by the caller
- **Detailed Errors**: Returns structured error information for caller retry decisions

## Installation

### As a Git Submodule (Recommended)

If you wish to use this agent as part of another project:

```bash
git submodule add https://github.com/winddxr/cli_subagent.git scripts/cli_subagent
```

### Standalone Use

Clone the repository and ensure the `scripts` directory is in your Python path:

```bash
git clone https://github.com/winddxr/cli_subagent.git
cd cli_subagent
export PYTHONPATH=$PYTHONPATH:$(pwd)
```

## Quick Start

### Auto-Detection Mode (Recommended)

```python
from cli_subagent import UniversalCLIAgent, GEMINI_PROFILE

# Automatically detect if input is a file or directory
agent = UniversalCLIAgent.from_path(
    profile=GEMINI_PROFILE,
    agent_name="creator",
    path="./prompts/creator.system.md"  # File or directory
)

result = agent.call("Generate a creative concept...")
if result.ok:
    print(result.content)
    print(f"Tokens: {result.total_tokens}")
else:
    print(f"Error: {result.error}")
```

### File Mode

```python
from cli_subagent import UniversalCLIAgent, GEMINI_PROFILE

agent = UniversalCLIAgent.from_file(
    profile=GEMINI_PROFILE,
    agent_name="creator",
    agent_prompt_path="./prompts/creator.system.md"
)
result = agent.call("Generate a creative concept...")
```

### Directory Mode

```python
from cli_subagent import UniversalCLIAgent, CODEX_PROFILE

# Directory structure requirements:
# - Codex: {workspace}/AGENTS.md
# - Gemini: {workspace}/.gemini/system.md
agent = UniversalCLIAgent.from_directory(
    profile=CODEX_PROFILE,
    agent_name="coder",
    agent_workspace="./workspaces/coder"
)
result = agent.call("Implement this function...")
```

## Supported CLIs

| CLI | Profile | Description |
|-----|---------|----- |
| **Gemini** | `GEMINI_PROFILE` | Uses `GEMINI_SYSTEM_MD` environment variable to specify system prompt |
| **Codex** | `CODEX_PROFILE` | Uses `AGENTS.override.md` (File Mode) or `AGENTS.md` (Directory Mode) |

## Directory Structure Convention

### Codex Workspace
```
workspace/
└── AGENTS.md              # or AGENTS.override.md
```

### Gemini Workspace
```
workspace/
└── .gemini/
    └── system.md
```

## API Reference

### `UniversalCLIAgent`

Main agent class, providing three factory methods:

```python
# Auto-detection mode (Recommended)
agent = UniversalCLIAgent.from_path(
    profile: CLIProfile,   # CLI Configuration
    agent_name: str,       # Agent Name (for logging)
    path: Path | str,      # File or directory path
)

# File mode
agent = UniversalCLIAgent.from_file(
    profile: CLIProfile,
    agent_name: str,
    agent_prompt_path: Path | str,  # System prompt file
)

# Directory mode
agent = UniversalCLIAgent.from_directory(
    profile: CLIProfile,
    agent_name: str,
    agent_workspace: Path | str,    # Workspace directory
)

# Call Agent
result = agent.call(
    task_content: str,     # Task prompt
    timeout: int = 300,    # Timeout in seconds
) -> AgentResult
```

### `AgentResult`

Standardized call result:

| Attribute | Type | Description |
|------|------|------|
| `ok` | `bool` | Whether the call was successful |
| `content` | `str` | AI generated content (Markdown) |
| `stats` | `dict` | Token usage statistics |
| `error` | `dict` | Error details (if failed) |
| `input_tokens` | `int` | Input Token count |
| `output_tokens` | `int` | Output Token count |
| `total_tokens` | `int` | Total Token count |
| `cached_tokens` | `int` | Cache hit Token count |
| `per_model` | `dict` | Token statistics by model (Gemini only) |

### `CLIProfile`

CLI Configuration Definition:

| Attribute | Type | Description |
|------|------|------|
| `name` | `str` | Profile Identifier |
| `command_template` | `List[str]` | Command line template (only supports path placeholders) |
| `env_vars` | `Dict[str, str]` | Environment variable template |
| `output_parser` | `Callable` | Output parsing function |
| `requires_temp_dir` | `bool` | Whether a temporary directory is required (File Mode) |
| `file_mode_override_name` | `str` | Filename to copy in file mode (Codex: `AGENTS.override.md`) |
| `dir_mode_system_file` | `str` | Relative path to system prompt file in directory mode |

> **Note**: Task Prompt is always passed via **stdin**, not used in `command_template`.
> Supported placeholders are limited to paths: `{agent_prompt_path}`, `{temp_dir}`.

### `InputMode`

Input Mode Enum:

```python
from cli_subagent import InputMode

InputMode.FILE       # File Mode
InputMode.DIRECTORY  # Directory Mode
```

### Error Handling

When `result.ok == False`, `result.error` contains structured error information:

| Error Type | Description | Retry Suggested |
|----------|------|-------------|
| `timeout` | CLI execution timeout | ✅ Retryable |
| `cli_not_found` | CLI executable not found | ❌ Do not retry |
| `cli_error` | CLI returned non-zero exit code | Depends |
| `parse_error` | Output parsing failed | ❌ Do not retry |
| `agent_error` | Agent internal error (Codex) | Depends |
| `execution_error` | Other execution exceptions | Depends on `exception_type` |

`execution_error` contains `exception_type` field to help judge:

```python
if not result.ok:
    err = result.error
    if err["type"] == "timeout":
        # Can retry
        pass
    elif err["type"] == "execution_error":
        # Judge based on exception type
        if err.get("exception_type") in ("OSError", "IOError"):
            # May be retryable
            pass
```

### Logging

The module uses the standard `logging` module and does not output any logs by default (uses `NullHandler`).

Enable logging:

```python
import logging

# Method 1: Enable DEBUG globally
logging.basicConfig(level=logging.DEBUG)

# Method 2: Enable only cli_subagent logs
logging.getLogger("cli_subagent.core").setLevel(logging.DEBUG)
logging.getLogger("cli_subagent.core").addHandler(logging.StreamHandler())
```

Logs include: CLI discovery, command execution, return status, parsing results, etc.

## Adding a New CLI

1. Define a new parsing function in `profiles.py`
2. Create a new `CLIProfile` instance
3. Add to `PROFILES` dictionary

Example:

```python
def parse_new_cli(stdout: str, stderr: str, returncode: int) -> AgentResult:
    # Parsing logic
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


## File Structure

```
cli_subagent/
├── README.md       # This document
├── __init__.py     # Package exports
├── core.py         # Core class definitions (UniversalCLIAgent, AgentResult, InputMode)
└── profiles.py     # CLI Profile configurations (GEMINI_PROFILE, CODEX_PROFILE)
```

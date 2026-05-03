# CLI Subagent

[中文](./README_CN.md)

Use any LLM CLI as a subagent or a one-shot API call. Profile-driven, stdin-based invocation — swap models by changing one config, not your code.

The goal is simple: **save money** by mixing models where it matters.

Full vibe coding. Not elegant.

## Implementations

| | Language | Runtime | Entry Point |
|---|----------|---------|-------------|
| **TS** (primary) | TypeScript | [Bun](https://bun.sh) | [`ts-lib/cli_subagent.test.ts`](ts-lib/cli_subagent.test.ts) |
| **Python** (reference) | Python 3.10+ | CPython / uv | [`py-lib/`](py-lib/) |

Both produce identical `AgentResult` for the same inputs. The Python version is the behavioral spec; the TypeScript version is the recommended runtime.

## Supported CLIs

| CLI | Profile | System Prompt Mechanism |
|-----|---------|------------------------|
| **Gemini CLI** | `GEMINI_PROFILE` | `GEMINI_SYSTEM_MD` env var → file path |
| **Codex CLI** | `CODEX_PROFILE` | `AGENTS.override.md` (file mode) / `AGENTS.md` (dir mode) |

## Quick Start (TypeScript / Bun)

```ts
import {
  UniversalCLIAgent, GEMINI_PROFILE, CODEX_PROFILE
} from "./ts-lib/cli_subagent.test.ts";

// Auto-detect file vs directory
const agent = UniversalCLIAgent.fromPath({
  profile: GEMINI_PROFILE,
  agentName: "creator",
  path: "./prompts/creator.system.md",
});

const result = await agent.call("Generate a creative concept...");
if (result.ok) {
  console.log(result.content);
} else {
  console.error(result.error);
}
```

### File Mode

```ts
const agent = UniversalCLIAgent.fromFile({
  profile: GEMINI_PROFILE,
  agentName: "creator",
  agentPromptPath: "./prompts/creator.system.md",
});
```

### Directory Mode

```ts
// Directory must contain the expected system prompt file:
//   Codex  → {workspace}/AGENTS.md
//   Gemini → {workspace}/.gemini/system.md
const agent = UniversalCLIAgent.fromDirectory({
  profile: CODEX_PROFILE,
  agentName: "coder",
  agentWorkspace: "./workspaces/coder",
});
```

### Model Override

```ts
// At construction
const agent = UniversalCLIAgent.fromPath({
  profile: GEMINI_PROFILE,
  agentName: "writer",
  path: "./prompts/writer.system.md",
  model: "gemini-2.5-pro",
});

// At call time (highest priority)
const result = await agent.call("Write a poem", { model: "gemini-2.5-flash" });
```

> **Model priority**: `call(model=)` > constructor `model` > `profile.model`

## Quick Start (Python)

See [py-lib/README.md](py-lib/README.md) for the full Python API reference.

```python
from cli_subagent import UniversalCLIAgent, GEMINI_PROFILE

agent = UniversalCLIAgent.from_path(
    profile=GEMINI_PROFILE,
    agent_name="creator",
    path="./prompts/creator.system.md",
)
result = agent.call("Generate a creative concept...")
```

## CLI Runner

This project provides a standalone command-line entry point [`cli_runner.ts`](./cli_runner.ts), allowing direct invocation of underlying CLI models from the terminal. For more details, see the [CLI Interface documentation](./cli_runner.md).

## Core Concepts

### AgentResult

Every call returns a standardized `AgentResult`:

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `boolean` | Whether the call succeeded |
| `content` | `string` | AI-generated content (Markdown) |
| `stats` | `object` | Token usage statistics |
| `error` | `object?` | Structured error details (on failure) |

Token accessors: `inputTokens()`, `outputTokens()`, `totalTokens()`, `cachedTokens()`, `perModel()`

### CLIProfile

Configuration that defines how to invoke a CLI:

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Profile identifier |
| `commandTemplate` | `string[]` | Command template (path placeholders only) |
| `envVars` | `Record<string, string>` | Env var template |
| `outputParser` | `function` | Output parsing function |
| `requiresTempDir` | `boolean` | Whether file mode needs a temp dir |
| `fileModeOverrideName` | `string` | Filename to copy in file mode |
| `dirModeSystemFile` | `string` | System prompt relative path in dir mode |

> Task prompts are **always** delivered via stdin, never as command args.

### Error Types

| Type | Description | Retry? |
|------|-------------|--------|
| `timeout` | CLI execution timed out | Yes |
| `cli_not_found` | CLI executable not found | No |
| `cli_error` | CLI returned non-zero exit code | Maybe |
| `parse_error` | Output parsing failed | No |
| `agent_error` | Agent internal error (Codex) | Maybe |
| `execution_error` | Other execution exceptions | Depends |

## Adding a New CLI

1. Write a parser function for the CLI's output format
2. Create a `CLIProfile` object
3. Register it in the profiles map

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

## Project Structure

```
cli_subagent/
├── ts-lib/cli_subagent.test.ts              # TypeScript implementation (single file, Bun)
├── ts-lib/cli_subagent.test.ts         # TypeScript tests
├── py-lib/                     # Python reference implementation
│   ├── cli_subagent/            # Python package
│   │   ├── __init__.py
│   │   ├── core.py              # Core classes
│   │   └── profiles.py          # CLI profiles & parsers
│   ├── test_compatibility.py    # Integration tests
│   ├── README.md                # Python API reference
│   └── README_CN.md             # Python API reference (Chinese)
├── dev-doc/                     # Design documents
│   ├── CLI_INVOCATION_PROTOCOL.md
│   ├── BUN_API_REFERENCE.md
│   └── COMPATIBILITY_FINDINGS.md
├── AGENTS.md                    # Agent instructions
└── model_list.md                # Supported model identifiers
```

## Running Tests

```bash
# TypeScript
bun test

# Python
cd py-lib && uv run python test_compatibility.py
```

## License

[MIT](LICENSE)

# Claude Code CLI Invocation Protocol — Complete Reference

> **Purpose**: This document describes the exact invocation protocol for Claude Code CLI (`claude -p`) as used by `cli_subagent`. It is intended to provide sufficient detail for reimplementing this project in any programming language.
>
> **Version**: 2026-04-29
> **Claude Code CLI**: `claude@2.1.91`
> **Source Documentation**: [code.claude.com/docs](https://code.claude.com/docs/llms.txt)

---

## Table of Contents

1. [Prerequisites & Installation](#1-prerequisites--installation)
2. [CLI Executable Discovery](#2-cli-executable-discovery)
3. [Claude Code CLI Invocation Protocol](#3-claude-code-cli-invocation-protocol)
4. [JSON Output Format](#4-json-output-format)
5. [Output Parsing Logic](#5-output-parsing-logic)
6. [Unified Abstraction Integration](#6-unified-abstraction-integration)
7. [Error Handling](#7-error-handling)
8. [Platform-Specific Concerns](#8-platform-specific-concerns)
9. [Complete Raw Output Samples](#9-complete-raw-output-samples)
10. [Supported Models](#10-supported-models)

---

## 1. Prerequisites & Installation

### Installation

Claude Code is distributed as a standalone CLI, **not** an npm global package (unlike Gemini/Codex).

```bash
# Install via npm (installs native binary)
npm install -g @anthropic-ai/claude-code

# Or direct install script
curl -fsSL https://code.claude.com/install | sh
```

### Authentication

`cli_subagent` auto-selects bare or non-bare mode via `getClaudeProfile()`:

- When `ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK=1`, or `CLAUDE_CODE_USE_VERTEX=1` is detected → **`CLAUDE_PROFILE`** (with `--bare` — faster, deterministic)
- Otherwise → **`CLAUDE_OAUTH_PROFILE`** (without `--bare` — supports `claude auth login` OAuth)

`--bare` skips hooks, skills, plugins, MCP servers, auto memory, and CLAUDE.md discovery. It requires non-OAuth auth:

| Auth Method | How to Configure | Auto-detected? |
|---|---|---|
| `ANTHROPIC_API_KEY` env var | `export ANTHROPIC_API_KEY=sk-ant-...` | **Yes** → bare mode |
| Amazon Bedrock | `CLAUDE_CODE_USE_BEDROCK=1` + AWS credentials | **Yes** → bare mode |
| Google Vertex AI | `CLAUDE_CODE_USE_VERTEX=1` + GCP credentials | **Yes** → bare mode |
| `apiKeyHelper` in settings | `--settings '{"apiKeyHelper":"cmd"}'` | No (use `CLAUDE_PROFILE` directly) |
| `claude auth login` (OAuth) | Browser-based login | **Yes** → non-bare mode (fallback) |

> To override auto-detection, use `CLAUDE_PROFILE` or `CLAUDE_OAUTH_PROFILE` directly instead of `getClaudeProfile()`.

### Executables

| CLI | Executable name | Windows variant |
|---|---|---|
| Claude Code | `claude` | `claude.cmd` |

---

## 2. CLI Executable Discovery

Claude Code uses the **same discovery algorithm** as Gemini and Codex in `cli_subagent`. See `CLI_INVOCATION_PROTOCOL.md` Section 2 for the full algorithm.

Key differences from Gemini/Codex:

| Aspect | Gemini / Codex | Claude Code |
|---|---|---|
| Package manager | Always npm global | May be npm, standalone binary, or system install |
| Typical Windows path | `%APPDATA%/npm/gemini.cmd` | `%APPDATA%/npm/claude.cmd` or standalone `claude.exe` |
| Typical Unix path | `~/.npm-global/bin/gemini` | `~/.npm-global/bin/claude` or `/usr/local/bin/claude` |
| Version check | `gemini --version` / `codex --version` | `claude --version` → `2.1.91 (Claude Code)` |

The `resolveCliExecutable("claude", extendedPath, verifyVersion=true)` function works identically: `Bun.which("claude")`, then `.cmd` fallback on Windows, then `--version` verification.

---

## 3. Claude Code CLI Invocation Protocol

### 3.1 Command Structure

```bash
# With --bare (CLAUDE_PROFILE — API key / Bedrock / Vertex):
claude --bare -p --output-format json --append-system-prompt-file <system_prompt_path> [--model <model>]

# Without --bare (CLAUDE_OAUTH_PROFILE — OAuth via `claude auth login`):
claude -p --output-format json --append-system-prompt-file <system_prompt_path> [--model <model>]
```

`getClaudeProfile()` selects automatically based on environment. See [Authentication](#authentication).

**stdin**: Task prompt (the user's question/instruction).

### 3.2 Flags

| Flag | Value | Purpose |
|---|---|---|
| `--bare` | *(none)* | Skip hooks, skills, plugins, MCP servers, auto memory, CLAUDE.md discovery. Required for deterministic CI/scripted behavior. Reduces startup time. |
| `-p` / `--print` | *(none)* | Non-interactive print mode. Read task from stdin (or argument), execute, print result, exit. |
| `--output-format` | `json` | Return a single JSON object (`SDKResultMessage`) instead of plain text. |
| `--append-system-prompt-file` | `<path>` | Load system prompt text from file and **append** to Claude Code's built-in default prompt. Preserves built-in capabilities while adding custom instructions. |
| `--model` | `<model_id>` | Override the model for this session. Accepts aliases (`sonnet`, `opus`) or full IDs (`claude-sonnet-4-6`). |

> **Note on `--model` vs `-m`**: Claude Code uses `--model`, not `-m` like Gemini/Codex. The `CLIProfile.modelFlag` field handles this difference.

### 3.3 Optional Flags (Not in Default Profile)

These flags are **not** included in the default `CLAUDE_PROFILE.commandTemplate` but can be added by creating a custom profile or appending to the command:

| Flag | Value | Purpose |
|---|---|---|
| `--max-turns` | `<int>` | Limit agentic turns. Exits with error subtype `error_max_turns` when reached. |
| `--max-budget-usd` | `<float>` | Maximum dollar spend. Exits with error subtype `error_max_budget_usd` when exceeded. |
| `--allowedTools` | `"Tool1,Tool2"` | Auto-approve specific tools without prompting. Example: `"Bash,Read,Edit"`. |
| `--tools` | `"Tool1,Tool2"` | Restrict available tools. Use `""` to disable all tools (pure LLM mode). |
| `--permission-mode` | `dontAsk` / `acceptEdits` / `auto` | Control permission behavior. `dontAsk` denies unapproved tools (good for CI). |
| `--system-prompt` | `<text>` | **Replace** the entire default prompt (instead of appending). |
| `--system-prompt-file` | `<path>` | Replace entire prompt from file. Mutually exclusive with `--system-prompt`. |
| `--continue` / `-c` | *(none)* | Continue most recent conversation. |
| `--resume` / `-r` | `<session_id>` | Resume a specific session by ID. |
| `--json-schema` | `<schema>` | Constrain output to match a JSON Schema (result in `structured_output` field). |
| `--fallback-model` | `<model>` | Automatic fallback when default model is overloaded. |
| `--no-session-persistence` | *(none)* | Don't save session to disk. |
| `--effort` | `low`/`medium`/`high`/`xhigh`/`max` | Control effort level. |

### 3.4 Input Delivery

**Task prompt** — Always via **stdin**, consistent with Gemini/Codex:

```
echo "Your task here" | claude --bare -p --output-format json ...
```

Or via subprocess stdin pipe:
```
subprocess.run([...], input="Your task here", ...)
```

**System prompt** — Via `--append-system-prompt-file` CLI flag:

```
claude --bare -p --output-format json --append-system-prompt-file /path/to/system.md
```

This is distinct from Gemini (env var `GEMINI_SYSTEM_MD`) and Codex (file `AGENTS.override.md` in cwd). Claude delivers the system prompt through a command-line flag with the file path as its argument.

| Delivery Method | Gemini | Codex | Claude Code |
|---|---|---|---|
| System prompt | `GEMINI_SYSTEM_MD` env var → file path | `AGENTS.override.md` file placed in cwd | `--append-system-prompt-file` flag → file path |
| Task prompt | stdin | stdin | stdin |

### 3.5 File Mode

In file mode, a single system prompt file is provided. Claude does **not** require a temp directory.

```
Inputs:
  system_prompt_path = "/path/to/system.md"
  task_content = "Your task here"

Command:
  claude --bare -p --output-format json \
    --append-system-prompt-file /path/to/system.md \
    --model claude-sonnet-4-6

stdin: "Your task here"
cwd: (caller's cwd, or any directory)
env: {
  ...process.env,
  PATH: extended_path
}
```

The `{agent_prompt_path}` placeholder in the command template resolves to the absolute path of the system prompt file.

### 3.6 Directory Mode

In directory mode, a workspace directory contains the system prompt at a conventional location.

```
workspace/
  .claude/
    system.md          ← System prompt (read by --append-system-prompt-file)
  src/
    ...                ← Project files

Command:
  claude --bare -p --output-format json \
    --append-system-prompt-file /workspace/.claude/system.md \
    --model claude-sonnet-4-6

stdin: "Your task here"
cwd: /workspace
env: {
  ...process.env,
  PATH: extended_path
}
```

The `{agent_prompt_path}` placeholder resolves to `{workspace}/.claude/system.md`.

---

## 4. JSON Output Format

When invoked with `--output-format json`, Claude Code returns a single JSON object on stdout. This object is the serialized `SDKResultMessage` type from the Claude Agent SDK.

### 4.1 Success Response

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "result": "answer text",
  "stop_reason": "end_turn",
  "session_id": "uuid-string",
  "uuid": "uuid-string",
  "duration_ms": 5304,
  "duration_api_ms": 5255,
  "num_turns": 1,
  "total_cost_usd": 0.018,
  "usage": {
    "input_tokens": 2,
    "output_tokens": 4,
    "cache_creation_input_tokens": 4793,
    "cache_read_input_tokens": 0,
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 0,
      "ephemeral_5m_input_tokens": 4793
    }
  },
  "modelUsage": {
    "claude-sonnet-4-6": {
      "inputTokens": 500,
      "outputTokens": 100,
      "cacheReadInputTokens": 50,
      "cacheCreationInputTokens": 200,
      "webSearchRequests": 0,
      "costUSD": 0.018,
      "contextWindow": 200000,
      "maxOutputTokens": 32000
    }
  },
  "permission_denials": [],
  "terminal_reason": "completed",
  "fast_mode_state": "off"
}
```

### 4.2 Error Response

```json
{
  "type": "result",
  "subtype": "error_max_budget_usd",
  "is_error": true,
  "num_turns": 1,
  "stop_reason": "end_turn",
  "session_id": "uuid-string",
  "uuid": "uuid-string",
  "duration_ms": 6699,
  "duration_api_ms": 0,
  "total_cost_usd": 0.018,
  "usage": { ... },
  "modelUsage": { ... },
  "permission_denials": [],
  "errors": ["Reached maximum budget ($1e-7)"],
  "fast_mode_state": "off"
}
```

### 4.3 Field Reference

#### Top-Level Fields

| Field | Type | Present | Description |
|---|---|---|---|
| `type` | `"result"` | Always | Message type discriminator |
| `subtype` | string | Always | `"success"` or error variant (see §7) |
| `is_error` | bool | Always | `true` if the run failed |
| `result` | string | Success only | The AI-generated response text (markdown) |
| `errors` | string[] | Error only | Human-readable error messages |
| `stop_reason` | string \| null | Always | Why generation stopped: `"end_turn"`, `"tool_deferred"`, etc. |
| `session_id` | string | Always | UUID identifying this session (for `--resume`) |
| `uuid` | string | Always | Unique event identifier |
| `duration_ms` | int | Always | Wall-clock time in milliseconds |
| `duration_api_ms` | int | Always | Time spent in API calls |
| `num_turns` | int | Always | Number of agentic turns executed |
| `total_cost_usd` | float | Always | Client-side estimated cost (not authoritative billing) |
| `usage` | object | Always | Aggregate token usage (see below) |
| `modelUsage` | object | Always | Per-model token and cost breakdown (see below) |
| `permission_denials` | array | Always | Tools that were denied permission |
| `structured_output` | unknown | Optional | Present when `--json-schema` was used |
| `terminal_reason` | string | Optional | `"completed"`, etc. |
| `fast_mode_state` | string | Optional | `"off"` or `"on"` |

#### `usage` Object (Aggregate)

| Field | Type | Description |
|---|---|---|
| `input_tokens` | int | Total input tokens (excluding cache tokens) |
| `output_tokens` | int | Total output tokens |
| `cache_creation_input_tokens` | int | Tokens used to create new cache entries |
| `cache_read_input_tokens` | int | Tokens read from existing cache entries |
| `server_tool_use.web_search_requests` | int | Number of web searches |
| `server_tool_use.web_fetch_requests` | int | Number of web fetches |
| `service_tier` | string | `"standard"` or other tier |
| `cache_creation.ephemeral_5m_input_tokens` | int | Cache writes with 5-minute TTL |
| `cache_creation.ephemeral_1h_input_tokens` | int | Cache writes with 1-hour TTL |

> **Note on `input_tokens`**: In the aggregate `usage` object, `input_tokens` may report a very low number (e.g., 2) because most input goes through prompt caching. The true input cost is reflected in `cache_creation_input_tokens` + `cache_read_input_tokens`. The `modelUsage` object provides more accurate per-model breakdowns.

#### `modelUsage` Object (Per-Model)

The `modelUsage` field is a dictionary keyed by model name. Each value contains:

| Field | Type | Description |
|---|---|---|
| `inputTokens` | int | Input tokens for this model |
| `outputTokens` | int | Output tokens for this model |
| `cacheReadInputTokens` | int | Cache-read tokens for this model |
| `cacheCreationInputTokens` | int | Cache-creation tokens for this model |
| `webSearchRequests` | int | Web search requests for this model |
| `costUSD` | float | Estimated cost for this model |
| `contextWindow` | int | Context window size (e.g., 200000) |
| `maxOutputTokens` | int | Max output token limit (e.g., 32000) |

> **Important**: `modelUsage` uses **camelCase** field names, while `usage` uses **snake_case**. Parsers must normalize accordingly.

---

## 5. Output Parsing Logic

### 5.1 Algorithm

```
parseClaudeJson(stdout, stderr, returncode) -> AgentResult:

  1. Try JSON parse (regardless of exit code — Claude returns structured
     JSON even on non-zero exits, e.g. budget exceeded):
     try:
         data = JSON.parse(stdout.trim())
     except ParseError:
         if returncode != 0:
             return AgentResult(
                 ok = false,
                 error = {type: "cli_error", message: stderr OR "CLI exited with code ...",
                          returncode, raw_output: stdout[:1000]}
             )
         return AgentResult(
             ok = false,
             error = {type: "parse_error", message, raw_output: stdout[:1000]}
         )

  2. Check for error result (covers both zero and non-zero exit codes):
     if data.is_error == true OR (data.subtype exists AND data.subtype != "success"):
         errors = data.errors ?? []
         stats  = _normalizeClaudeStats(data)    # preserve usage/cost on errors
         return AgentResult(
             ok = false,
             stats = stats,
             error = {
                 type: "agent_error",
                 message: errors.join("; ") OR data.subtype OR "unknown error",
                 subtype: data.subtype,
                 errors: errors
             }
         )

  3. Valid JSON + non-zero exit without error subtype (rare edge case):
     if returncode != 0:
         return AgentResult(ok=false, error={type: "cli_error", ...})

  4. Extract content:
     content = data.result ?? ""

  5. Normalize stats via _normalizeClaudeStats(data):
     - Aggregate token stats from data.usage
     - Per-model stats from data.modelUsage (camelCase → snake_case)
     - Cost, duration, turns from top-level fields

  6. Return:
     AgentResult(ok=true, content=content, stats=stats)

_normalizeClaudeStats(data) -> stats:
  usage = data.usage ?? {}
  input_tokens  = usage.input_tokens ?? 0
  output_tokens = usage.output_tokens ?? 0

  per_model = {}
  for each (model_name, mu) in (data.modelUsage ?? {}):
      per_model[model_name] = {
          input_tokens:          mu.inputTokens ?? 0,
          output_tokens:         mu.outputTokens ?? 0,
          cached_tokens:         mu.cacheReadInputTokens ?? 0,
          cache_creation_tokens: mu.cacheCreationInputTokens ?? 0,
          cost_usd:              mu.costUSD ?? 0
      }

  return {
      input_tokens, output_tokens,
      total_tokens:          input_tokens + output_tokens,
      cached_tokens:         usage.cache_read_input_tokens ?? 0,
      cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
      cost_usd:              data.total_cost_usd ?? 0,
      duration_ms:           data.duration_ms ?? 0,
      num_turns:             data.num_turns ?? 1,
      per_model,
      raw:                   usage
  }
```

### 5.2 Token Field Mapping

**Aggregate `usage` → `stats`:**

| `usage` field (snake_case) | `stats` key | Notes |
|---|---|---|
| `input_tokens` | `input_tokens` | Direct mapping |
| `output_tokens` | `output_tokens` | Direct mapping |
| *(computed)* | `total_tokens` | `input_tokens + output_tokens` |
| `cache_read_input_tokens` | `cached_tokens` | Tokens read from cache |
| `cache_creation_input_tokens` | `cache_creation_tokens` | Tokens written to cache |

**Per-model `modelUsage` → `stats.per_model` (camelCase → snake_case):**

| `modelUsage[model]` field (camelCase) | `per_model[model]` key (snake_case) |
|---|---|
| `inputTokens` | `input_tokens` |
| `outputTokens` | `output_tokens` |
| `cacheReadInputTokens` | `cached_tokens` |
| `cacheCreationInputTokens` | `cache_creation_tokens` |
| `costUSD` | `cost_usd` |

**Additional top-level fields → `stats`:**

| JSON field | `stats` key | Notes |
|---|---|---|
| `total_cost_usd` | `cost_usd` | Client-side estimate |
| `duration_ms` | `duration_ms` | Wall-clock time |
| `num_turns` | `num_turns` | Agentic turns count |

### 5.3 Fields NOT Available (Compared to Gemini/Codex)

| Field | Available in Gemini? | Available in Codex? | Available in Claude? |
|---|---|---|---|
| `thoughts_tokens` (reasoning) | Yes (`tokens.thoughts`) | Yes (`reasoning_output_tokens`) | **No** |
| `tool_tokens` | Yes (`tokens.tool`) | No | **No** |
| `per_model` breakdown | Yes | No | **Yes** (via `modelUsage`) |
| `cost_usd` | No | No | **Yes** (via `total_cost_usd`) |
| `duration_ms` | No | No | **Yes** |
| `num_turns` | No | No | **Yes** |
| `cache_creation_tokens` | No | No | **Yes** |

---

## 6. Unified Abstraction Integration

### 6.1 CLIProfile for Claude Code

```
CLAUDE_PROFILE (bare mode — API key / Bedrock / Vertex):
  name                    = "claude"
  command_template         = ["claude", "--bare", "-p", "--output-format", "json",
                             "--append-system-prompt-file", "{agent_prompt_path}"]
  env_vars                = {}
  output_parser           = parseClaudeJson
  requires_temp_dir       = false
  file_mode_override_name = ""
  dir_mode_system_file    = ".claude/system.md"
  model_flag              = "--model"

CLAUDE_OAUTH_PROFILE (non-bare — OAuth / keychain):
  (identical to above, but command_template omits "--bare")
  command_template         = ["claude", "-p", "--output-format", "json",
                             "--append-system-prompt-file", "{agent_prompt_path}"]

Auto-selection:
  getClaudeProfile() → checks hasBareCompatibleAuth()
    → ANTHROPIC_API_KEY / CLAUDE_CODE_USE_BEDROCK=1 / CLAUDE_CODE_USE_VERTEX=1
      → returns CLAUDE_PROFILE
    → otherwise
      → returns CLAUDE_OAUTH_PROFILE
  PROFILES["claude"] is a getter that delegates to getClaudeProfile().
```

### 6.2 Key Differences from Gemini/Codex Profiles

| Aspect | Gemini | Codex | Claude Code |
|---|---|---|---|
| **Output format** | Single JSON blob | NDJSON event stream | Single JSON blob |
| **System prompt delivery** | `GEMINI_SYSTEM_MD` env var → file path | `AGENTS.override.md` file in cwd | `--append-system-prompt-file` flag → file path |
| **Task prompt delivery** | stdin | stdin | stdin |
| **Temp dir (file mode)** | No | Yes | No |
| **Model flag** | `-m` | `-m` | `--model` |
| **Auth mechanism** | Google Cloud credentials | `~/.codex/auth.json` | Auto-detected: API key/Bedrock/Vertex → `--bare`; OAuth → non-bare (via `getClaudeProfile()`) |
| **Trust mechanism** | `--skip-trust` flag | `--skip-git-repo-check` flag | `--bare` flag (skips all discovery; auto-selected when applicable) |
| **Env vars set** | `GEMINI_SYSTEM_MD` | *(none)* | *(none)* |
| **Content location** | `response` field | `item.completed` events | `result` field |
| **Token stats location** | `stats.models.*.tokens.*` | `turn.completed.usage.*` | `usage.*` + `modelUsage.*` |
| **Multi-model stats** | Yes (per-model in `stats.models`) | No | Yes (`modelUsage` dict) |
| **Cost tracking** | No | No | Yes (`total_cost_usd`) |

### 6.3 model_flag Extension

Claude Code uses `--model` instead of `-m` for model selection. The `CLIProfile` data structure requires a `model_flag` field to support this:

```
CLIProfile:
  ...existing fields...
  model_flag: string?    # Flag prefix for model arg; defaults to "-m"
```

In the execution flow (step 4 from CLI_INVOCATION_PROTOCOL.md §5.2), the model flag line becomes:

```
  if effective_model:
      flag = profile.model_flag ?? "-m"
      cmd.extend([flag, effective_model])
```

This is backward-compatible: existing Gemini/Codex profiles omit `model_flag` and get the default `-m`.

### 6.4 Placeholder Substitution

Same mechanism as Gemini/Codex. The `{agent_prompt_path}` placeholder in `command_template` resolves to the system prompt file path.

| Placeholder | Resolves to |
|---|---|
| `{agent_prompt_path}` | FILE mode: the system prompt file path. DIRECTORY mode: `workspace/.claude/system.md` |
| `{temp_dir}` | Not used (Claude profile does not require temp dir) |

For Claude, `{agent_prompt_path}` appears as an argument to the `--append-system-prompt-file` flag within `command_template`, not in `env_vars`.

---

## 7. Error Handling

### 7.1 Error Types

| Error Type | Trigger | Error Dict Shape |
|---|---|---|
| `cli_error` | Non-zero exit code from `claude` | `{type, message, returncode, raw_output}` |
| `parse_error` | stdout is not valid JSON | `{type, message, raw_output}` |
| `agent_error` | `is_error == true` or `subtype != "success"` | `{type, message, subtype, errors}` |
| `timeout` | Subprocess exceeded timeout | `{type, message}` |
| `cli_not_found` | `claude` executable not found | `{type, message}` |
| `execution_error` | Any other exception | `{type, exception_type, message}` |

### 7.2 Error Subtypes in JSON Response

When `is_error == true`, the `subtype` field indicates the reason:

| `subtype` value | Trigger | Exit Code |
|---|---|---|
| `error_max_turns` | `--max-turns` limit reached | 1 |
| `error_during_execution` | Runtime error during agent loop | 1 |
| `error_max_budget_usd` | `--max-budget-usd` limit exceeded | 1 |
| `error_max_structured_output_retries` | `--json-schema` validation failed too many times | 1 |

> **Note**: Unlike Gemini (which returns exit code 0 + error in JSON), Claude Code returns **non-zero exit code** for error subtypes. This means the `cli_error` branch in the parser fires first. However, the parser should also check `is_error` and `subtype` when exit code is 0, as future versions may change this behavior.

### 7.3 Non-Zero Exit Code Without JSON

When `claude` fails before producing output (e.g., auth failure, invalid flags), stdout may be empty or contain plain text error messages, not JSON. The parser must handle this:

```
if returncode != 0:
    return {type: "cli_error", returncode, raw_output: stdout[:500]}
```

---

## 8. Platform-Specific Concerns

Same concerns as Gemini/Codex apply to Claude Code. See `CLI_INVOCATION_PROTOCOL.md` Section 7 for the full treatment.

### Claude-Specific Notes

| Concern | Detail |
|---|---|
| Windows `.cmd` shim | `claude.cmd` works with `Bun.spawnSync` / `Bun.spawn` when resolved via `Bun.which("claude.cmd")` |
| Standalone binary | Some installs place `claude.exe` (not `.cmd` shim) directly on PATH. Discovery handles both. |
| `ANTHROPIC_API_KEY` propagation | The subprocess inherits `process.env` including the API key. Never filter it out. |
| `CODEX_HOME` / `GEMINI_*` isolation | Claude does not read Codex/Gemini env vars. No cross-contamination risk. |
| Encoding | Same as Gemini/Codex: use explicit `encoding="utf-8"` on Windows |

### Subprocess Configuration

```
subprocess.run(
    args       = [resolved_exe_path, "--bare", "-p", "--output-format", "json",
                  "--append-system-prompt-file", system_prompt_path,
                  "--model", model_id],
    input      = task_content,          # stdin
    capture_output = True,              # capture stdout + stderr
    text       = True,                  # string mode
    timeout    = 300,                   # seconds
    env        = env_dict,              # with extended PATH + ANTHROPIC_API_KEY
    cwd        = working_directory,     # or None for file mode
    encoding   = "utf-8",              # explicit encoding
    # Windows only:
    creationflags = CREATE_NO_WINDOW    # 0x08000000 on Windows, 0 on Unix
)
```

---

## 9. Complete Raw Output Samples

### 9.1 Success Response

**Command**: `claude --bare -p --output-format json --model claude-sonnet-4-6`
**stdin**: `Reply with exactly one word: TEST`

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 5304,
  "duration_api_ms": 5255,
  "num_turns": 1,
  "result": "TEST",
  "stop_reason": "end_turn",
  "session_id": "f32adf25-acb0-4013-b748-9414f3d1d699",
  "total_cost_usd": 0.01803975,
  "usage": {
    "input_tokens": 2,
    "cache_creation_input_tokens": 4793,
    "cache_read_input_tokens": 0,
    "output_tokens": 4,
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 0,
      "ephemeral_5m_input_tokens": 4793
    },
    "inference_geo": "",
    "iterations": [],
    "speed": "standard"
  },
  "modelUsage": {
    "claude-sonnet-4-6": {
      "inputTokens": 2,
      "outputTokens": 4,
      "cacheReadInputTokens": 0,
      "cacheCreationInputTokens": 4793,
      "webSearchRequests": 0,
      "costUSD": 0.01803975,
      "contextWindow": 200000,
      "maxOutputTokens": 32000
    }
  },
  "permission_denials": [],
  "terminal_reason": "completed",
  "fast_mode_state": "off",
  "uuid": "81ccec2a-cf7a-4f7b-9baa-d1db83cc2c56"
}
```

### 9.2 Error Response (Budget Exceeded)

**Command**: `claude --bare -p --output-format json --max-budget-usd 0.0000001 --model claude-sonnet-4-6`
**stdin**: `Reply with exactly one word: TEST`
**Exit code**: `1`

```json
{
  "type": "result",
  "subtype": "error_max_budget_usd",
  "duration_ms": 6699,
  "duration_api_ms": 0,
  "is_error": true,
  "num_turns": 1,
  "stop_reason": "end_turn",
  "session_id": "0613b07f-7ab1-486b-8131-3cd5bf350ca6",
  "total_cost_usd": 0.01797975,
  "usage": {
    "input_tokens": 0,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "output_tokens": 0,
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 0,
      "ephemeral_5m_input_tokens": 0
    },
    "inference_geo": "",
    "iterations": [],
    "speed": "standard"
  },
  "modelUsage": {
    "claude-sonnet-4-6": {
      "inputTokens": 2,
      "outputTokens": 4,
      "cacheReadInputTokens": 0,
      "cacheCreationInputTokens": 4777,
      "webSearchRequests": 0,
      "costUSD": 0.01797975,
      "contextWindow": 200000,
      "maxOutputTokens": 32000
    }
  },
  "permission_denials": [],
  "fast_mode_state": "off",
  "uuid": "cf4876c2-18b6-4799-8b38-ce46c840b71a",
  "errors": [
    "Reached maximum budget ($1e-7)"
  ]
}
```

---

## 10. Supported Models

| Model ID | Alias | Notes |
|---|---|---|
| `claude-opus-4-6` | `opus` | Most capable model |
| `claude-sonnet-4-6` | `sonnet` | Balanced capability and speed (recommended for testing) |
| `claude-haiku-4-5-20251001` | `haiku` | Fastest, most cost-effective |

Model aliases (`sonnet`, `opus`, `haiku`) are resolved by the CLI itself. Both forms work with `--model`.

---

## Appendix A: Quick Reference — Minimal Invocation

### Claude Code (simplest possible call)

```bash
# With API key (auto-selects --bare via getClaudeProfile())
export ANTHROPIC_API_KEY=sk-ant-...
echo "Your task here" | claude --bare -p --output-format json --model sonnet

# With system prompt file
echo "Your task here" | claude --bare -p --output-format json \
  --append-system-prompt-file /path/to/system.md \
  --model sonnet

# With OAuth auth (no --bare — auto-selected when no API key/Bedrock/Vertex)
echo "Your task here" | claude -p --output-format json --model sonnet
```

### Extract result with jq

```bash
# Get just the response text
echo "What is 2+2?" | claude --bare -p --output-format json | jq -r '.result'

# Get token counts
echo "What is 2+2?" | claude --bare -p --output-format json | jq '{
  input: .usage.input_tokens,
  output: .usage.output_tokens,
  cached: .usage.cache_read_input_tokens,
  cost: .total_cost_usd
}'
```

---

## Appendix B: Differences Between All Three CLIs

| Aspect | Gemini CLI | Codex CLI | Claude Code CLI |
|---|---|---|---|
| **Output format** | Single JSON blob | NDJSON event stream | Single JSON blob |
| **System prompt delivery** | `GEMINI_SYSTEM_MD` env var → file | `AGENTS.override.md` file in cwd | `--append-system-prompt-file` flag → file |
| **Task prompt delivery** | stdin | stdin | stdin |
| **Temp dir (file mode)** | No | Yes | No |
| **Model flag** | `-m` | `-m` | `--model` |
| **Auth mechanism** | Google Cloud | `~/.codex/auth.json` | Auto-detected (bare for API key/Bedrock/Vertex, non-bare for OAuth) |
| **Token stats location** | `stats.models.*.tokens.*` | `turn.completed.usage.*` | `usage.*` + `modelUsage.*` |
| **Multi-model stats** | Yes | No | Yes |
| **CoT/reasoning tokens** | `tokens.thoughts` | `reasoning_output_tokens` | Not exposed |
| **Cached tokens** | `tokens.cached` | `cached_input_tokens` | `cache_read_input_tokens` |
| **Cost tracking** | No | No | `total_cost_usd` |
| **Content location** | `response` field | `item.completed` events | `result` field |
| **Multiple content parts** | No (single string) | Yes (join with `\n\n`) | No (single string) |
| **Session resumption** | No | No | `--resume <session_id>` |
| **Budget limit** | No | No | `--max-budget-usd` |
| **Turn limit** | No | No | `--max-turns` |

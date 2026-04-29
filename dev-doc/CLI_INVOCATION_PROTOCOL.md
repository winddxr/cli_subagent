# CLI Invocation Protocol — Complete Reference

> **Purpose**: This document describes the exact invocation protocols for Gemini CLI and Codex CLI as used by `cli_subagent`. It is intended to provide sufficient detail for reimplementing this project in any programming language.
>
> **Claude Code** is a third supported CLI and is documented separately in `CLAUDE_CODE_INVOCATION_PROTOCOL.md`.
>
> **Version**: 2026-04-26
> **Gemini CLI**: `@google/gemini-cli@0.39.1`
> **Codex CLI**: `@openai/codex@0.125.0`

---

## Table of Contents

1. [Prerequisites & Installation](#1-prerequisites--installation)
2. [CLI Executable Discovery](#2-cli-executable-discovery)
3. [Gemini CLI Invocation Protocol](#3-gemini-cli-invocation-protocol)
4. [Codex CLI Invocation Protocol](#4-codex-cli-invocation-protocol)
5. [Unified Abstraction Design](#5-unified-abstraction-design)
6. [Error Handling](#6-error-handling)
7. [Platform-Specific Concerns](#7-platform-specific-concerns)
8. [Complete Raw Output Samples](#8-complete-raw-output-samples)
9. [Supported Models](#9-supported-models)

---

## 1. Prerequisites & Installation

Both CLIs are **npm global packages** installed via Node.js package managers.

### Installation

```bash
# Gemini CLI
npm install -g @google/gemini-cli

# Codex CLI
npm install -g @openai/codex
```

### Authentication

- **Gemini CLI**: Uses Google Cloud credentials. Authentication is handled by the CLI itself (browser-based OAuth or API key).
- **Codex CLI**: Uses OpenAI API key. Stored in `$CODEX_HOME/auth.json` (default `CODEX_HOME` is `~/.codex`). **Do NOT override `CODEX_HOME` env var** — it would break authentication.

### Executables

| CLI | Executable name | Windows variant |
|-----|----------------|-----------------|
| Gemini | `gemini` | `gemini.cmd` |
| Codex | `codex` | `codex.cmd` |

---

## 2. CLI Executable Discovery

Since CLIs are installed via npm, they may not be on the default system `PATH`. A robust discovery mechanism is required.

### Algorithm

```
1. Build candidate paths list (priority order):
   a. Environment-driven:
      - $PNPM_HOME
      - $NVM_SYMLINK
      - $NVM_HOME
      - $NPM_CONFIG_PREFIX (on Windows: as-is; on Unix: append /bin)
   b. Windows-specific:
      - $APPDATA/npm
      - $LOCALAPPDATA/Yarn/bin
      - $LOCALAPPDATA/pnpm
   c. Unix-specific:
      - ~/.npm-global/bin
      - ~/.local/share/pnpm
      - ~/.yarn/bin
      - /usr/local/bin
   d. Node's parent directory:
      - which("node") → parent directory

2. Deduplicate paths (preserve order)

3. Construct extended PATH:
   extended_path = join(candidate_paths, PATH_SEPARATOR) + PATH_SEPARATOR + $PATH

4. Resolve executable:
   exe = which(cli_name, path=extended_path)
   if Windows and exe is None:
       exe = which(cli_name + ".cmd", path=extended_path)

5. Verify executable (optional but recommended):
   Run: [exe, "--version"]
   - timeout: 10 seconds
   - On Windows: use CREATE_NO_WINDOW flag
   - If exit code != 0 → return None
   - If timeout/error → return None

6. Return full executable path (or None if not found)
```

### Key Points

- **Always resolve the full path** before passing to subprocess. Bare names like `"gemini"` can fail on Windows.
- The extended PATH is injected **per-subprocess** (via env dict), never modifying the global environment.
- The `--version` check ensures the found binary is actually functional.

---

## 3. Gemini CLI Invocation Protocol

### 3.1 Command Structure

```
gemini --output-format json --skip-trust [-m MODEL] < stdin
```

| Flag | Required | Description |
|------|----------|-------------|
| `--output-format json` | **Yes** | Output a single JSON blob instead of text |
| `--skip-trust` | **Yes** | Skip trusted directory check (required since v0.35+ for headless/non-interactive mode) |
| `-m MODEL` | No | Specify model (e.g., `gemini-3-flash-preview`) |

> **Note**: `--output-format` also accepts `stream-json` (new in recent versions) for streaming JSON output. This project currently uses `json` only.

### 3.2 Input Delivery

| Input Type | Delivery Method |
|------------|-----------------|
| **System prompt** | Environment variable `GEMINI_SYSTEM_MD` pointing to a file path |
| **Task prompt** | **stdin** (piped into the process) |

The system prompt is a Markdown file. Gemini CLI reads the file path from `GEMINI_SYSTEM_MD` and uses its content as the system instruction.

### 3.3 File Mode (Single Prompt File)

```
┌─────────────────────────────────────────────────────────┐
│ Caller has: system_prompt.md + task_string              │
│                                                         │
│ 1. Set env: GEMINI_SYSTEM_MD = /path/to/system_prompt.md│
│ 2. Set env: PATH = extended_path                        │
│ 3. Run subprocess:                                      │
│    gemini --output-format json --skip-trust [-m MODEL]  │
│    stdin  = task_string                                 │
│    cwd    = (not critical, can be anything)             │
│ 4. Parse stdout as JSON                                 │
└─────────────────────────────────────────────────────────┘
```

- **No temp directory needed** for Gemini file mode.
- `cwd` is not significant — Gemini reads the system prompt from the env var path.

### 3.4 Directory Mode (Workspace)

```
┌─────────────────────────────────────────────────────────┐
│ Caller has: workspace_dir/ containing .gemini/system.md │
│                                                         │
│ 1. Set env: GEMINI_SYSTEM_MD = workspace/.gemini/system.md │
│ 2. Set env: PATH = extended_path                        │
│ 3. Run subprocess:                                      │
│    gemini --output-format json --skip-trust [-m MODEL]  │
│    stdin  = task_string                                 │
│    cwd    = workspace_dir                               │
│ 4. Parse stdout as JSON                                 │
└─────────────────────────────────────────────────────────┘
```

- Expected system prompt location: `{workspace}/.gemini/system.md`
- `cwd` is set to the workspace directory.

### 3.5 Output Format (JSON)

Gemini outputs a **single JSON object** on stdout:

```json
{
  "session_id": "uuid-string",
  "response": "The AI-generated content (markdown string)",
  "stats": {
    "models": {
      "[model-name]": {
        "api": {
          "totalRequests": 1,
          "totalErrors": 0,
          "totalLatencyMs": 3167
        },
        "tokens": {
          "input": 7587,
          "prompt": 7587,
          "candidates": 1,
          "total": 7649,
          "cached": 0,
          "thoughts": 61,
          "tool": 0
        },
        "roles": {
          "main": {
            "totalRequests": 1,
            "totalErrors": 0,
            "totalLatencyMs": 3167,
            "tokens": { ... }
          }
        }
      }
    },
    "tools": { ... },
    "files": { ... }
  },
  "error": { ... }
}
```

### 3.6 Parsing Logic

```
1. If exit code != 0 → return error (type: "cli_error")
   - Special case: exit code 55 = untrusted directory (need --skip-trust)

2. Parse stdout as JSON
   - If parse fails → return error (type: "parse_error")

3. If data["error"] exists and is truthy → return error with data["error"]

4. Extract content: data["response"] (string)

5. Extract stats: data["stats"]["models"] → iterate each model:
   - tokens.prompt    → input_tokens
   - tokens.candidates → output_tokens
   - tokens.total     → total_tokens
   - tokens.cached    → cached_tokens
   - tokens.thoughts  → thoughts_tokens (Chain-of-Thought)
   - tokens.tool      → tool_tokens
   
   Aggregate across all models (sum). Also store per-model breakdown.
```

### 3.7 Token Field Mapping

| Gemini raw field | Normalized field | Description |
|-----------------|------------------|-------------|
| `tokens.prompt` | `input_tokens` | Prompt/input token count |
| `tokens.candidates` | `output_tokens` | Generated output token count |
| `tokens.total` | `total_tokens` | Total tokens |
| `tokens.cached` | `cached_tokens` | Cached token count |
| `tokens.thoughts` | `thoughts_tokens` | Chain-of-Thought reasoning tokens |
| `tokens.tool` | `tool_tokens` | Tool-use tokens |
| `tokens.input` | *(not mapped)* | Actual input tokens (may differ from prompt when cache is used) |

### 3.8 Environment Variables Summary

| Variable | Value | Purpose |
|----------|-------|---------|
| `GEMINI_SYSTEM_MD` | Absolute path to system prompt `.md` file | Overrides built-in system prompt |
| `PATH` | Extended PATH with npm candidate dirs prepended | CLI discovery |

---

## 4. Codex CLI Invocation Protocol

### 4.1 Command Structure

```
codex exec --json --skip-git-repo-check [-m MODEL] < stdin
```

| Flag | Required | Description |
|------|----------|-------------|
| `exec` | **Yes** | Execute a task (non-interactive mode) |
| `--json` | **Yes** | Output NDJSON event stream |
| `--skip-git-repo-check` | **Yes** | Skip requirement for a git repository |
| `-m MODEL` | No | Specify model (e.g., `gpt-5.4-mini`) |

### 4.2 Input Delivery

| Input Type | Delivery Method |
|------------|-----------------|
| **System prompt** | File named `AGENTS.override.md` placed in the subprocess `cwd` |
| **Task prompt** | **stdin** (piped into the process) |

Codex CLI automatically reads `AGENTS.md` (or `AGENTS.override.md` which takes full precedence) from its working directory.

**Critical**: Do **NOT** override the `CODEX_HOME` environment variable. It defaults to `~/.codex` and contains `auth.json` for API authentication.

### 4.3 File Mode (Single Prompt File) — With Temp Directory

```
┌──────────────────────────────────────────────────────────────┐
│ Caller has: system_prompt.md + task_string                   │
│                                                              │
│ 1. Create temp directory: /tmp/cli_agent_codex_XXXXXX/       │
│ 2. Copy system_prompt.md → temp_dir/AGENTS.override.md       │
│ 3. Set env: PATH = extended_path                             │
│    (Do NOT set CODEX_HOME)                                   │
│ 4. Run subprocess:                                           │
│    codex exec --json --skip-git-repo-check [-m MODEL]        │
│    stdin  = task_string                                      │
│    cwd    = temp_dir                                         │
│ 5. Parse stdout as NDJSON                                    │
│ 6. Finally: delete temp_dir (always, even on error)          │
└──────────────────────────────────────────────────────────────┘
```

**Why temp directory is needed**: Codex reads `AGENTS.override.md` from `cwd`. To inject a custom system prompt without polluting the user's workspace, we create a temp dir, copy the prompt file there as `AGENTS.override.md`, and set `cwd` to that temp dir.

**Cleanup**: The temp directory MUST be cleaned up in a `finally` block to avoid leaking directories.

### 4.4 Directory Mode (Workspace)

```
┌──────────────────────────────────────────────────────────────┐
│ Caller has: workspace_dir/ containing AGENTS.md              │
│                                                              │
│ 1. Set env: PATH = extended_path                             │
│    (Do NOT set CODEX_HOME)                                   │
│ 2. Run subprocess:                                           │
│    codex exec --json --skip-git-repo-check [-m MODEL]        │
│    stdin  = task_string                                      │
│    cwd    = workspace_dir                                    │
│ 3. Parse stdout as NDJSON                                    │
└──────────────────────────────────────────────────────────────┘
```

- Expected system prompt location: `{workspace}/AGENTS.md` (or `AGENTS.override.md`)
- **No temp directory needed** in directory mode.
- `cwd` is set to the workspace directory.

### 4.5 Output Format (NDJSON Event Stream)

Codex outputs **Newline-Delimited JSON (NDJSON)** — one JSON object per line on stdout:

```jsonl
{"type":"thread.started","thread_id":"019dca17-45f9-7552-ba1e-a7666beda607"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
{"type":"turn.completed","usage":{"input_tokens":N,"cached_input_tokens":N,"output_tokens":N,"reasoning_output_tokens":N}}
```

#### Event Types

| Event Type | Fields | Description |
|------------|--------|-------------|
| `thread.started` | `thread_id` (string) | Thread/conversation created |
| `turn.started` | *(none)* | A new turn begins |
| `item.completed` | `item.id`, `item.type`, `item.text` | A response item is complete |
| `turn.completed` | `usage` (object) | Turn finished, includes token usage |
| `error` | `message` (string) | An error occurred |

#### Content Extraction

From `item.completed` events where `item.type == "agent_message"`:
- Extract `item.text` (string)
- There may be **multiple** `item.completed` events — join all `agent_message` texts with `"\n\n"`

#### Usage Object (from `turn.completed`)

```json
{
  "input_tokens": 11912,
  "cached_input_tokens": 6528,
  "output_tokens": 29,
  "reasoning_output_tokens": 22
}
```

### 4.6 Parsing Logic

```
1. If exit code != 0 → return error (type: "cli_error")

2. Split stdout by newlines, for each non-empty line:
   a. Try to parse as JSON; skip non-JSON lines silently
   b. Read event["type"]:
      - "item.completed" AND item.type == "agent_message":
          → collect item.text into content_parts list
      - "turn.completed":
          → extract event.usage as usage dict
      - "error":
          → collect into errors list

3. If any errors collected → return error (type: "agent_error")

4. Join content_parts with "\n\n" → content string

5. Normalize usage stats
```

### 4.7 Token Field Mapping

| Codex raw field | Normalized field | Description |
|----------------|------------------|-------------|
| `usage.input_tokens` | `input_tokens` | Total input tokens |
| `usage.output_tokens` | `output_tokens` | Output tokens |
| *(calculated)* | `total_tokens` | `input_tokens + output_tokens` |
| `usage.cached_input_tokens` | `cached_tokens` | Cached input tokens |
| `usage.reasoning_output_tokens` | *(not mapped)* | Reasoning/CoT output tokens (new field) |

### 4.8 Environment Variables Summary

| Variable | Value | Purpose |
|----------|-------|---------|
| `PATH` | Extended PATH with npm candidate dirs prepended | CLI discovery |
| `CODEX_HOME` | **Do NOT set** | Must remain default for auth.json access |

---


## 5. Unified Abstraction Design

### 5.1 Core Data Structures

#### CLIProfile

A declarative configuration object that defines how to invoke a specific CLI:

```
CLIProfile:
  name: string                    # "gemini" or "codex"
  command_template: string[]      # Base command + flags (without model or task)
  env_vars: dict<string, string>  # Env vars to set; supports {agent_prompt_path} placeholder
  output_parser: function         # Parses (stdout, stderr, returncode) -> AgentResult
  requires_temp_dir: bool         # Whether file mode needs a temp directory
  file_mode_override_name: string # Filename for system prompt in temp dir (e.g., "AGENTS.override.md")
  dir_mode_system_file: string    # Expected system prompt path relative to workspace
  model: string?                  # Optional default model
```

#### Concrete Profiles

**Gemini:**
```
name = "gemini"
command_template = ["gemini", "--output-format", "json", "--skip-trust"]
env_vars = { "GEMINI_SYSTEM_MD": "{agent_prompt_path}" }
requires_temp_dir = false
dir_mode_system_file = ".gemini/system.md"
```

**Codex:**
```
name = "codex"
command_template = ["codex", "exec", "--json", "--skip-git-repo-check"]
env_vars = {}
requires_temp_dir = true
file_mode_override_name = "AGENTS.override.md"
dir_mode_system_file = "AGENTS.md"
```

#### InputMode

```
enum InputMode:
  FILE       # Single system prompt file
  DIRECTORY  # Workspace directory with expected structure
```

#### AgentResult

```
AgentResult:
  ok: bool                       # Whether the call succeeded
  content: string                # AI-generated response (markdown)
  stats: dict                    # Normalized token statistics
  error: dict?                   # Error details if ok=false

  # Convenience properties (read from stats):
  input_tokens: int
  output_tokens: int
  total_tokens: int
  cached_tokens: int
  thoughts_tokens: int           # Gemini only (CoT)
  tool_tokens: int               # Gemini only
  per_model: dict                # Gemini only (per-model breakdown)
```

### 5.2 Execution Flow

```
call(task_content, timeout=300, model=None):

  1. Resolve effective model:
     effective_model = model ?? self.model ?? profile.model

  2. Determine cwd and temp_dir:
     if mode == DIRECTORY:
         cwd = workspace_dir
         temp_dir = None
     elif profile.requires_temp_dir:
         temp_dir = create_temp_dir("cli_agent_{profile.name}_")
         copy(system_prompt -> temp_dir/profile.file_mode_override_name)
         cwd = temp_dir
     else:
         cwd = None (or caller's cwd)
         temp_dir = None

  3. Build environment:
     env = copy(os.environ)
     env["PATH"] = extended_path  (prepend candidate paths to current PATH)
     for each (key, template) in profile.env_vars:
         env[key] = substitute(template, {
             "{agent_prompt_path}": resolved_prompt_path,
             "{temp_dir}": temp_dir_path
         })

  4. Build command:
     cmd = []
     for i, part in enumerate(profile.command_template):
         part = substitute(part, placeholders)
         if i == 0:  # CLI executable name
             part = resolve_cli_executable(part, extended_path)
             if not found: raise FileNotFoundError
         cmd.append(part)
     if effective_model:
         cmd.extend(["-m", effective_model])

  5. Execute subprocess:
     result = subprocess.run(
         cmd,
         input   = task_content,   # stdin
         stdout  = PIPE,
         stderr  = PIPE,
         text    = true,
         timeout = timeout,
         env     = env,
         cwd     = cwd,
         encoding = "utf-8"
     )

  6. Parse output:
     return profile.output_parser(result.stdout, result.stderr, result.returncode)

  7. Finally (always):
     if temp_dir exists: delete temp_dir recursively
```

### 5.3 Placeholder Substitution

The command template and env vars support these placeholders:

| Placeholder | Resolves to |
|-------------|-------------|
| `{agent_prompt_path}` | In FILE mode: the system prompt file path. In DIRECTORY mode: `workspace/profile.dir_mode_system_file` |
| `{temp_dir}` | Path to the created temp directory (empty string if not applicable) |

---

## 6. Error Handling

### 6.1 Error Types

| Error Type | Trigger | Error Dict Shape |
|------------|---------|------------------|
| `timeout` | `subprocess.TimeoutExpired` | `{type, message}` |
| `cli_not_found` | `FileNotFoundError` from subprocess | `{type, message}` |
| `cli_error` | Non-zero exit code from CLI | `{type, message, returncode, raw_output}` |
| `parse_error` | JSON/NDJSON parse failure | `{type, message, raw_output}` |
| `agent_error` | Codex NDJSON `error` event | `{type, message, errors}` |
| `execution_error` | Any other exception | `{type, exception_type, message}` |

### 6.2 Gemini-Specific Error Codes

| Exit Code | Meaning |
|-----------|---------|
| 0 | Success |
| 55 | Untrusted directory (need `--skip-trust`) |
| Other | General error (check stderr) |

### 6.3 Gemini Error in JSON

Gemini may return exit code 0 but include an `"error"` field in the JSON response. Always check `data["error"]` even when returncode == 0.

---

## 7. Platform-Specific Concerns

### 7.1 Windows

| Concern | Solution |
|---------|----------|
| `.cmd` extension | If `which("gemini")` returns None, try `which("gemini.cmd")` |
| Console window popup | Use `CREATE_NO_WINDOW` flag (`0x08000000`) in subprocess creationflags |
| Encoding | Use `encoding="utf-8"` explicitly. Default console encoding (GBK on Chinese Windows) causes `UnicodeDecodeError` |
| Path separator | Use `;` (semicolon) on Windows, `:` (colon) on Unix |
| npm global paths | Check `%APPDATA%/npm`, `%LOCALAPPDATA%/pnpm`, `%NVM_SYMLINK%`, `%NVM_HOME%` |

### 7.2 Unix / macOS

| Concern | Solution |
|---------|----------|
| npm global paths | Check `~/.npm-global/bin`, `~/.local/share/pnpm`, `~/.yarn/bin`, `/usr/local/bin` |
| `NPM_CONFIG_PREFIX` | Append `/bin` to the prefix path |
| `CREATE_NO_WINDOW` | Not needed (pass 0 for creationflags) |

### 7.3 Subprocess Configuration Summary

```
subprocess.run(
    args       = [resolved_exe_path, ...flags],
    input      = task_content,          # stdin
    capture_output = True,              # capture stdout + stderr
    text       = True,                  # string mode (not bytes)
    timeout    = 300,                   # seconds
    env        = env_dict,              # with extended PATH
    cwd        = working_directory,     # or None
    encoding   = "utf-8",              # explicit encoding
    # Windows only:
    creationflags = CREATE_NO_WINDOW    # 0x08000000 on Windows, 0 on Unix
)
```

---

## 8. Complete Raw Output Samples

### 8.1 Gemini CLI Output

**Command**: `gemini --output-format json --skip-trust -m gemini-3-flash-preview`
**stdin**: `Reply with exactly one word: TEST`

```json
{
  "session_id": "a7c39938-bb3a-437d-aa16-a33b1d8bb569",
  "response": "TEST",
  "stats": {
    "models": {
      "gemini-3-flash-preview": {
        "api": {
          "totalRequests": 1,
          "totalErrors": 0,
          "totalLatencyMs": 3167
        },
        "tokens": {
          "input": 7587,
          "prompt": 7587,
          "candidates": 1,
          "total": 7649,
          "cached": 0,
          "thoughts": 61,
          "tool": 0
        },
        "roles": {
          "main": {
            "totalRequests": 1,
            "totalErrors": 0,
            "totalLatencyMs": 3167,
            "tokens": {
              "input": 7587,
              "prompt": 7587,
              "candidates": 1,
              "total": 7649,
              "cached": 0,
              "thoughts": 61,
              "tool": 0
            }
          }
        }
      }
    },
    "tools": {
      "totalCalls": 0,
      "totalSuccess": 0,
      "totalFail": 0,
      "totalDurationMs": 0,
      "totalDecisions": {
        "accept": 0,
        "reject": 0,
        "modify": 0,
        "auto_accept": 0
      },
      "byName": {}
    },
    "files": {
      "totalLinesAdded": 0,
      "totalLinesRemoved": 0
    }
  }
}
```

### 8.2 Codex CLI Output

**Command**: `codex exec --json --skip-git-repo-check -m gpt-5.4-mini`
**stdin**: `Reply with exactly one word: TEST`

```jsonl
{"type":"thread.started","thread_id":"019dca17-45f9-7552-ba1e-a7666beda607"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"TEST"}}
{"type":"turn.completed","usage":{"input_tokens":11912,"cached_input_tokens":6528,"output_tokens":29,"reasoning_output_tokens":22}}
```

---

## 9. Supported Models

### Gemini CLI

| Model | Notes |
|-------|-------|
| `gemini-3-pro-preview` | Latest pro preview |
| `gemini-3-flash-preview` | Latest flash preview (recommended for testing) |
| `gemini-2.5-pro` | Production pro model |
| `gemini-2.5-flash` | Production flash model |
| `gemini-2.5-flash-lite` | Lightweight flash variant |

### Codex CLI

| Model | Notes |
|-------|-------|
| `gpt-5.5` | Latest flagship model |
| `gpt-5.4` | High-capability model |
| `gpt-5.4-mini` | Cost-effective (recommended for testing) |
| `gpt-5.3-codex` | Code-specialized model |
| `gpt-5.3-codex-spark` | Lightweight code model |
| `gpt-5.2` | Previous generation |

---

## Appendix A: Quick Reference — Minimal Invocation

### Gemini (simplest possible call)

```bash
# Set system prompt (optional)
export GEMINI_SYSTEM_MD=/path/to/system.md

# Invoke
echo "Your task here" | gemini --output-format json --skip-trust -m gemini-3-flash-preview
```

### Codex (simplest possible call)

```bash
# Create temp dir with system prompt
mkdir /tmp/codex_work
cp /path/to/system.md /tmp/codex_work/AGENTS.override.md

# Invoke
cd /tmp/codex_work
echo "Your task here" | codex exec --json --skip-git-repo-check -m gpt-5.4-mini

# Cleanup
rm -rf /tmp/codex_work
```

---

## Appendix B: Differences Between Gemini and Codex

| Aspect | Gemini CLI | Codex CLI |
|--------|-----------|-----------|
| **Output format** | Single JSON blob | NDJSON event stream |
| **System prompt delivery** | `GEMINI_SYSTEM_MD` env var pointing to file path | `AGENTS.override.md` file in cwd |
| **Task prompt delivery** | stdin | stdin |
| **Temp dir needed (file mode)** | No | Yes |
| **Auth location** | Google Cloud credentials | `$CODEX_HOME/auth.json` |
| **Trust mechanism** | `--skip-trust` flag required | None |
| **Token stats location** | `stats.models.*.tokens.*` | `turn.completed.usage.*` |
| **Multi-model stats** | Yes (per-model breakdown) | No |
| **CoT/reasoning tokens** | `tokens.thoughts` | `usage.reasoning_output_tokens` |
| **Cached tokens** | `tokens.cached` | `usage.cached_input_tokens` |
| **Content location** | `response` field | `item.completed` events with `agent_message` type |
| **Multiple content parts** | No (single string) | Yes (multiple `item.completed` events, join with `\n\n`) |

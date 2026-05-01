## CLI Interface

```
bun run cli_runner.ts <provider> [options]

Providers: gemini | codex | claude

Options:
  --task-file <path>       Read task prompt from file (recommended for complex prompts)
  --system-prompt <path>   System prompt file (file mode)
  --workspace <path>       Workspace directory (directory mode, uses CLI's config files)
  --model <model>          Override default model
  --timeout <seconds>      Execution timeout (default: 300)

Task input priority:
  1. --task-file <path>    File-based (recommended): bypasses shell escaping entirely
  2. stdin pipe            Fallback: echo "simple" | bun run cli_runner.ts ...
  3. Error if neither      Exits with code 2 and usage message

Constraints:
  - --system-prompt and --workspace are mutually exclusive
  - Neither is required (bare mode — run with CLI's built-in behavior only)
  - --task-file and stdin are mutually exclusive (--task-file takes precedence if both present)
```

## Output Contract

| Exit code | stdout | stderr |
|-----------|--------|--------|
| 0 | Agent's plain-text response (no wrapper) | Optional: `{"stats":{...}}` JSON line with token usage |
| 1 | Single-line JSON: `{"type":"<error_type>","message":"..."}` | — |
| 2 | — | Usage/arg error message |

Error types: `cli_not_found` `cli_error` `parse_error` `agent_error` `timeout` `execution_error`

### Stats object (stderr, exit 0 only)

When the CLI returns successfully, a single JSON line is written to stderr:
```json
{"stats":{"input_tokens":123,"output_tokens":456,"total_tokens":579,"cached_tokens":0}}
```

Gemini additionally includes `thoughts_tokens`, `tool_tokens`, and `per_model` breakdown.
Callers can ignore stderr entirely — stats are opt-in.

### Agent parsing pseudocode

```
result = run("bun run cli_runner.ts ...")
if exit_code == 0:  answer = stdout           # plain text
if exit_code == 0:  stats  = JSON.parse(stderr_lines[-1]).stats  # optional
if exit_code == 1:  error  = JSON.parse(stdout)  # {type, message, ...}
if exit_code == 2:  # bad invocation, check stderr
```

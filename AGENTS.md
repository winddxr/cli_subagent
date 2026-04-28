# AGENTS.md

## Project Overview

TypeScript/Bun rewrite of a CLI subagent library. Wraps LLM CLIs (Gemini CLI, Codex CLI) as subprocess-based subagents through a unified, profile-driven interface. Optimize for correctness of CLI invocation protocols and cross-platform compatibility (Windows + Unix). The Python reference implementation (`py-impl/cli_subagent/`) is the behavioral spec — the TS version must produce identical `AgentResult` for the same inputs.

## Tech Stack

- TypeScript, Bun runtime (`Bun.spawn`, `Bun.which`)
- Zero external runtime dependencies — use `node:fs/promises`, `node:os`, `node:path` only
- CLIs under test: `@google/gemini-cli`, `@openai/codex` (npm global packages)
- Python reference: `py-impl/cli_subagent/` (behavioral ground truth)

## Commands

```bash
# Run the Python reference tests (verify CLIs are working)
cd py-impl && uv run python test_compatibility.py

# TypeScript (once scaffolded)
bun test                    # run tests
bun run build               # type-check + bundle
```

## Architecture

### Python Reference (read-only, do not modify without reason)

- `py-impl/cli_subagent/core.py` — `UniversalCLIAgent`, `CLIProfile`, `AgentResult`, `InputMode`, CLI discovery
- `py-impl/cli_subagent/profiles.py` — `GEMINI_PROFILE` / `CODEX_PROFILE`, output parsers, profile registry

### TypeScript Target Structure

Port the same abstractions. Key mapping:

| Python | TypeScript equivalent |
|--------|----------------------|
| `subprocess.run()` with stdin pipe | `Bun.spawn()` with stdin + `stdout: "pipe"` |
| `shutil.which()` | `Bun.which()` |
| `tempfile.mkdtemp()` | `mkdtemp()` from `node:fs/promises` |
| `os.environ.copy()` | `{ ...process.env }` spread |
| `os.pathsep` | `delimiter` from `node:path` |

### Invariant Design Rules

- Task prompt is ALWAYS delivered via **stdin**, never command args
- System prompt delivery differs per CLI: Gemini uses `GEMINI_SYSTEM_MD` env var pointing to file; Codex uses `AGENTS.override.md` file placed in subprocess `cwd`
- Adding a new CLI = define parser function + `CLIProfile` object + register in profiles map
- Two input modes: FILE (single prompt file) and DIRECTORY (workspace with expected structure)

## Coding Conventions

- Zero runtime dependencies — `node:*` imports only
- All subprocess calls use per-call `env` object with extended PATH — NEVER mutate `process.env`
- Codex file mode MUST: create temp dir → copy prompt as `AGENTS.override.md` → set `cwd` → cleanup in `finally`
- Use explicit UTF-8 encoding for all subprocess I/O
- On Windows: try `.cmd` extension fallback for CLI resolution
- Timeout: track `timedOut` boolean via `setTimeout` + `proc.kill()`, return `{ type: "timeout" }` error — must match Python behavior
- Async by default (`Bun.spawn`), `Bun.spawnSync` only for `--version` checks if needed

## Boundaries

- NEVER set or override `CODEX_HOME` env var — breaks Codex authentication
- NEVER pass task prompt via command-line arguments — always via stdin
- Do NOT add external runtime dependencies
- Do NOT modify the Python reference files (`py-impl/`) unless fixing a confirmed bug

## Verification

- Python reference tests: `cd py-impl && uv run python test_compatibility.py` — all 5 layers must pass
- TS implementation must produce identical `AgentResult` shape and error types for the same CLI outputs
- After any parser change, verify against raw output samples in `dev-doc/COMPATIBILITY_FINDINGS.md` Section 6

## Drill-Down Reading

Only read these when working on the matching scope:

| Condition | Document |
|-----------|----------|
| Implementing subprocess calls, command flags, output parsing, or CLI discovery | `dev-doc/CLI_INVOCATION_PROTOCOL.md` (complete protocol spec) |
| Mapping Python APIs to Bun equivalents (`Bun.spawn`, `Bun.which`, fs, env) | `dev-doc/BUN_API_REFERENCE.md` |
| Debugging CLI version breakage or verifying output format assumptions | `dev-doc/COMPATIBILITY_FINDINGS.md` |
| Looking up model identifiers for Gemini or Codex | `model_list.md` |

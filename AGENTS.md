# AGENTS.md

## Project Overview
TypeScript/Bun rewrite of a CLI subagent library. Wraps LLM CLIs (Gemini CLI, Codex CLI) as subprocess-based subagents through a unified, profile-driven interface. Optimize for correctness of CLI invocation protocols and cross-platform compatibility (Windows + Unix). The Python reference implementation (`py-lib/cli_subagent/`) is the behavioral spec — the TS version must produce identical `AgentResult` for the same inputs.

## Deliverable
**Single-file library**: the entire TS implementation MUST be a single `ts-lib/cli_subagent.test.ts` file at the project root. No multi-file module structure, no barrel exports, no splitting by concern. All types, profiles, parsers, and core logic live in one file.

## Tech Stack

- TypeScript, Bun runtime — **Bun API 优先**，仅在 Bun 无对应 API 时回退 `node:*`
- **Zero external runtime dependencies**
- **Zero build step required** — `bun run ts-lib/cli_subagent.test.ts` must work directly
- CLIs under test: `@google/gemini-cli`, `@openai/codex` (npm global packages), `@anthropic-ai/claude-code` (standalone CLI)
- Python reference: `py-lib/cli_subagent/` (behavioral ground truth)

## Commands

```bash
# Run the Python reference tests (verify CLIs are working)
cd py-lib && uv run python test_compatibility.py

# TypeScript — no build step, run directly
bun run ts-lib/cli_subagent.test.ts     # run / import as library
bun test                    # run tests (test file imports ts-lib/cli_subagent.test.ts)
```

## Architecture

### Python Reference (read-only, do not modify without reason)

- `py-lib/cli_subagent/core.py` — `UniversalCLIAgent`, `CLIProfile`, `AgentResult`, `InputMode`, CLI discovery
- `py-lib/cli_subagent/profiles.py` — `GEMINI_PROFILE` / `CODEX_PROFILE`, output parsers, profile registry

### TypeScript Target Structure

All code lives in **one file**: `ts-lib/cli_subagent.test.ts`. Internal organization uses regions/comments, not separate files. The file should export the public API at the bottom (`export { UniversalCLIAgent, AgentResult, CLIProfile, ... }`).

Port the same abstractions. Key mapping:

| Python | TypeScript equivalent | API 来源 |
|--------|----------------------|----------|
| `subprocess.run()` with stdin pipe | `Bun.spawn()` with stdin + `stdout: "pipe"` | **Bun** |
| `shutil.which()` | `Bun.which()` | **Bun** |
| `tempfile.mkdtemp()` | `mkdtemp()` from `node:fs/promises` | node:fs (Bun 无直接等价) |
| `os.environ.copy()` | `{ ...process.env }` spread | JS 内置 |
| `os.pathsep` | `delimiter` from `node:path` | node:path (Bun 无直接等价) |
| `open(path).read()` | `Bun.file(path).text()` | **Bun** |
| `open(path).write(data)` | `Bun.write(path, data)` | **Bun** |
| `os.path.exists()` | `Bun.file(path).exists()` | **Bun** |
| `time.sleep()` | `Bun.sleep()` | **Bun** |

### Invariant Design Rules

- Task prompt is ALWAYS delivered via **stdin**, never command args
- System prompt delivery differs per CLI: Gemini uses `GEMINI_SYSTEM_MD` env var pointing to file; Codex uses `AGENTS.override.md` file placed in subprocess `cwd`; Claude uses `--append-system-prompt-file` flag with file path
- Adding a new CLI = define parser function + `CLIProfile` object + register in profiles map
- Two input modes: FILE (single prompt file) and DIRECTORY (workspace with expected structure)

## Coding Conventions

- **Single file** — all code in `ts-lib/cli_subagent.test.ts`, no splitting
- **Bun API 优先原则** — 有 Bun 原生 API 的场景必须用 Bun API，禁止用 `node:*` 替代：
  - 文件读写：`Bun.file()` / `Bun.write()` — 不用 `fs.readFile` / `fs.writeFile`
  - 文件存在检查：`Bun.file(path).exists()` — 不用 `fs.access` / `fs.stat`
  - 子进程：`Bun.spawn()` / `Bun.spawnSync()` — 不用 `child_process`
  - CLI 发现：`Bun.which()` — 不用手动 PATH 搜索
  - Sleep：`Bun.sleep()` — 不用 `setTimeout` wrapper
- 仅在 Bun 无对应 API 时使用 `node:*`（如 `mkdtemp`、`path.delimiter`、`os.tmpdir`）
- No `package.json` required for runtime — the file is self-contained and directly runnable by Bun
- All subprocess calls use per-call `env` object with extended PATH — NEVER mutate `process.env`
- Codex file mode MUST: create temp dir → copy prompt as `AGENTS.override.md` → set `cwd` → cleanup in `finally`
- On Windows: try `.cmd` extension fallback for CLI resolution
- Timeout: track `timedOut` boolean via `setTimeout` + `proc.kill()`, return `{ type: "timeout" }` error — must match Python behavior
- Async by default (`Bun.spawn`), `Bun.spawnSync` only for `--version` checks if needed

## Boundaries

- NEVER set or override `CODEX_HOME` env var — breaks Codex authentication
- NEVER pass task prompt via command-line arguments — always via stdin
- Do NOT add external runtime dependencies
- Do NOT split `ts-lib/cli_subagent.test.ts` into multiple files — single-file is a hard constraint
- Do NOT modify the Python reference files (`py-lib/`) unless fixing a confirmed bug

## Verification

- Python reference tests: `cd py-lib && uv run python test_compatibility.py` — all 5 layers must pass
- TS implementation must produce identical `AgentResult` shape and error types for the same CLI outputs
- After any parser change, verify against raw output samples in `dev-doc/COMPATIBILITY_FINDINGS.md` Section 6

## Drill-Down Reading

Only read these when working on the matching scope:

| Condition | Document |
|-----------|----------|
| Implementing subprocess calls, command flags, output parsing, or CLI discovery (Gemini/Codex) | `dev-doc/CLI_INVOCATION_PROTOCOL.md` (complete protocol spec) |
| Implementing Claude Code subprocess calls, flags, output parsing, auth detection | `dev-doc/CLAUDE_CODE_INVOCATION_PROTOCOL.md` |
| Mapping Python APIs to Bun equivalents (`Bun.spawn`, `Bun.which`, fs, env) | `dev-doc/BUN_API_REFERENCE.md` |
| Debugging CLI version breakage or verifying output format assumptions | `dev-doc/COMPATIBILITY_FINDINGS.md` |
| Looking up model identifiers for Gemini, Codex, or Claude | `model_list.md` |

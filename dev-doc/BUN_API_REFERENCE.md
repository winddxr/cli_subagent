# Bun API Reference for TypeScript Rewrite

This document lists the Bun and Bun-compatible APIs needed to rewrite this
project from Python to TypeScript on the Bun runtime.

Scope:

- Invoke Gemini CLI and Codex CLI as subprocesses.
- Pass task prompts through stdin.
- Capture stdout/stderr for JSON and NDJSON parsing.
- Set per-call environment variables and working directories.
- Resolve npm-installed CLI executables across platforms.
- Implement Python-compatible timeout and cleanup behavior.

Primary implementation reference: `CLI_INVOCATION_PROTOCOL.md`.

## 1. Runtime And Types

Install Bun type declarations for TypeScript:

```bash
bun add -d @types/bun
```

Recommended minimum `tsconfig.json` fields:

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "strict": true,
    "noEmit": true
  }
}
```

Use top-level `await` freely in Bun TypeScript modules.

## 2. `Bun.spawn`

Use `Bun.spawn` for the main CLI calls. This is the Bun equivalent of
Python's `subprocess.run(...)`, but it is stream-based and async.

Project mapping:

| Python `subprocess.run` | Bun API |
|---|---|
| `args=[...]` | `cmd: string[]` |
| `input=task_content` | `stdin` |
| `capture_output=True` | `stdout: "pipe"`, `stderr: "pipe"` |
| `text=True`, `encoding="utf-8"` | `await proc.stdout.text()`, `await proc.stderr.text()` |
| `timeout=seconds` | custom timer or `timeout: seconds * 1000` |
| `env=env` | `env: Record<string, string \| undefined>` |
| `cwd=...` | `cwd: string` |

Recommended wrapper shape:

```ts
type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  timedOut: boolean;
};

async function runCli(
  cmd: string[],
  taskContent: string,
  options: {
    cwd?: string;
    env: Record<string, string | undefined>;
    timeoutSeconds: number;
  },
): Promise<RunResult> {
  let timedOut = false;

  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd,
    env: options.env,
    stdin: new TextEncoder().encode(taskContent),
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGTERM");
  }, options.timeoutSeconds * 1000);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    return {
      stdout,
      stderr,
      exitCode,
      signalCode: proc.signalCode,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}
```

Important details:

- Set `stderr: "pipe"` explicitly. Bun's default stderr behavior is not the same
  as Python `capture_output=True`.
- `proc.exited` resolves to the exit code. It does not produce parsed output.
- `proc.stdout` and `proc.stderr` are readable streams when configured as
  `"pipe"`.
- Use `TextEncoder` for stdin to avoid relying on string coercion behavior.
- Bun's built-in `timeout` option accepts milliseconds, not seconds.

## 3. Timeout Semantics

The Python implementation returns an `AgentResult` with:

```json
{
  "type": "timeout",
  "message": "CLI execution timed out after N seconds"
}
```

To preserve that behavior, track timeout state yourself. Do not rely only on the
subprocess exit code, because a killed process is not enough to prove why it was
killed.

Recommended pattern:

```ts
let timedOut = false;

const timer = setTimeout(() => {
  timedOut = true;
  proc.kill("SIGTERM");
}, timeoutSeconds * 1000);
```

Then after the process exits:

```ts
if (result.timedOut) {
  return {
    ok: false,
    content: "",
    error: {
      type: "timeout",
      message: `CLI execution timed out after ${timeoutSeconds} seconds`,
    },
  };
}
```

You may also use Bun's `timeout` and `killSignal` spawn options, but a custom
timer is clearer here because this project needs a stable, Python-compatible
`timeout` error type.

## 4. `Bun.which`

Use `Bun.which` to resolve executable paths. This replaces Python's
`shutil.which(...)`.

Basic usage:

```ts
const exe = Bun.which("gemini", { PATH: extendedPath });
```

Project requirements:

- Build an extended `PATH` using the same candidate directory algorithm from
  `CLI_INVOCATION_PROTOCOL.md`.
- Resolve the first command element before passing it to `Bun.spawn`.
- On Windows, if `Bun.which("codex", ...)` returns `null`, also try
  `Bun.which("codex.cmd", ...)`.
- Verify the resolved executable with `--version` before using it for real work.

Recommended function shape:

```ts
async function resolveCliExecutable(
  name: string,
  extendedPath: string,
  env: Record<string, string | undefined>,
): Promise<string | null> {
  let exe = Bun.which(name, { PATH: extendedPath });

  if (!exe && process.platform === "win32") {
    exe = Bun.which(`${name}.cmd`, { PATH: extendedPath });
  }

  if (!exe) return null;

  const check = Bun.spawn({
    cmd: [exe, "--version"],
    env: { ...env, PATH: extendedPath },
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await check.exited;
  return exitCode === 0 ? exe : null;
}
```

## 5. Environment Variables

Use `process.env` or `Bun.env` as the source environment. Bun documents
`Bun.env` as an alias for `process.env`; prefer `process.env` if you want
Node-compatible TypeScript code.

Recommended environment builder:

```ts
function buildEnv(extraPath: string, profileEnv: Record<string, string>) {
  return {
    ...process.env,
    PATH: extraPath,
    ...profileEnv,
  };
}
```

Project-specific environment rules:

- Gemini file and directory modes must set `GEMINI_SYSTEM_MD` to the resolved
  system prompt file path.
- Codex must not override `CODEX_HOME`, because authentication lives under the
  user's Codex home directory.
- Inject the extended `PATH` per subprocess. Do not mutate global `process.env`.

## 6. Working Directory

Use the `cwd` field in `Bun.spawn`.

Project mapping:

| Mode | CLI | `cwd` |
|---|---|---|
| File mode | Gemini | optional; current process cwd is acceptable |
| Directory mode | Gemini | agent workspace directory |
| File mode | Codex | temporary directory containing `AGENTS.override.md` |
| Directory mode | Codex | agent workspace directory |

Example:

```ts
const proc = Bun.spawn({
  cmd,
  cwd: workspacePath,
  env,
  stdin: new TextEncoder().encode(taskContent),
  stdout: "pipe",
  stderr: "pipe",
});
```

## 7. Filesystem APIs

Bun supports Node's filesystem APIs. For this project, prefer Node-compatible
imports for path and temp-directory logic because they are portable and familiar:

```ts
import { mkdtemp, copyFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, delimiter, dirname } from "node:path";
```

Required operations:

| Operation | Recommended API |
|---|---|
| Resolve input file/directory | `resolve(...)`, `stat(...)` |
| Create Codex temp dir | `mkdtemp(join(tmpdir(), "cli_agent_codex_"))` |
| Copy prompt file | `copyFile(source, join(tempDir, "AGENTS.override.md"))` |
| Cleanup temp dir | `rm(tempDir, { recursive: true, force: true })` |
| Build PATH | `delimiter` from `node:path` |

Codex file-mode skeleton:

```ts
let tempDir: string | undefined;

try {
  tempDir = await mkdtemp(join(tmpdir(), "cli_agent_codex_"));
  await copyFile(agentPromptPath, join(tempDir, "AGENTS.override.md"));

  return await runCli(cmd, taskContent, {
    cwd: tempDir,
    env,
    timeoutSeconds,
  });
} finally {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
}
```

## 8. `Bun.spawnSync`

`Bun.spawnSync` exists, but it should not be the default for this project.

Use it only for very small, local checks if the blocking behavior is acceptable.
For example, executable `--version` verification could use either `Bun.spawn` or
`Bun.spawnSync`.

Async `Bun.spawn` is preferred because:

- Main CLI calls can run for several minutes.
- It supports stream-based stdout/stderr collection.
- It avoids blocking the Bun event loop if this library is used inside a server
  or larger orchestration process.

## 9. CLI-Specific Command Construction

Gemini:

```ts
const cmd = [
  geminiExe,
  "--output-format",
  "json",
  "--skip-trust",
];

if (model) cmd.push("-m", model);
```

Environment:

```ts
env.GEMINI_SYSTEM_MD = agentPromptPath;
```

Codex:

```ts
const cmd = [
  codexExe,
  "exec",
  "--json",
  "--skip-git-repo-check",
];

if (model) cmd.push("-m", model);
```

Environment:

```ts
// Do not set CODEX_HOME.
```

## 10. Output Collection And Parsing

The Bun API only collects raw text. The existing parser logic should be ported
directly from `py-impl/cli_subagent/profiles.py`.

Gemini:

```ts
const data = JSON.parse(stdout || "{}");
const content = data.response ?? "";
```

Codex:

```ts
for (const line of stdout.trim().split("\n")) {
  if (!line.trim()) continue;

  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    continue;
  }

  // item.completed + item.type === "agent_message"
  // turn.completed + usage
  // error events
}
```

Parser responsibilities remain unchanged:

- Non-zero exit code returns `cli_error`.
- Gemini invalid JSON returns `parse_error`.
- Gemini top-level `error` returns that error.
- Codex NDJSON `error` event returns `agent_error`.
- Successful calls return normalized token stats.

## 11. Minimal End-To-End Pattern

```ts
async function callAgent(taskContent: string) {
  const extendedPath = buildExtendedPath();
  const env = {
    ...process.env,
    PATH: extendedPath,
    GEMINI_SYSTEM_MD: "/absolute/path/to/system.md",
  };

  const exe = await resolveCliExecutable("gemini", extendedPath, env);
  if (!exe) {
    return {
      ok: false,
      content: "",
      error: {
        type: "cli_not_found",
        message: "CLI 'gemini' not found",
      },
    };
  }

  const result = await runCli(
    [exe, "--output-format", "json", "--skip-trust"],
    taskContent,
    {
      env,
      timeoutSeconds: 300,
    },
  );

  if (result.timedOut) {
    return {
      ok: false,
      content: "",
      error: {
        type: "timeout",
        message: "CLI execution timed out after 300 seconds",
      },
    };
  }

  return parseGeminiJson(result.stdout, result.stderr, result.exitCode ?? 1);
}
```

## 12. Official Bun Docs Used

- Runtime child processes: `https://bun.com/docs/runtime/child-process`
- `Bun.which`: `https://bun.com/docs/runtime/utils#bun-which`
- TypeScript declarations: `https://bun.com/docs/guides/runtime/typescript`


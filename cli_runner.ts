#!/usr/bin/env bun
/**
 * cli_runner.ts — Self-Contained CLI Subagent Runner
 *
 * Standalone script that invokes Gemini CLI, Codex CLI, or Claude Code CLI
 * as subagents via command line. Zero dependencies, runs directly with Bun.
 *
 * Usage:
 *   bun run cli_runner.ts <provider> [options]
 *   bun run cli_runner.ts gemini --task-file /tmp/task.txt --system-prompt ./agent.md
 *   echo "say hello" | bun run cli_runner.ts gemini
 *
 * Output:
 *   Success (exit 0): plain text content to stdout
 *   Failure (exit 1): JSON error object to stdout
 *   Usage error (exit 2): error message to stderr
 */

import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve, delimiter, dirname } from "node:path";

// =============================================================================
// Types
// =============================================================================

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signalCode: string | null;
  timedOut: boolean;
}

type CLIErrorType =
  | "cli_not_found"
  | "cli_error"
  | "parse_error"
  | "agent_error"
  | "timeout"
  | "execution_error"
  | "unknown_error";

interface CLIError {
  type: CLIErrorType;
  message: string;
  returncode?: number;
  errors?: any[];
  raw_output?: string;
  subtype?: string;
}

type Provider = "gemini" | "codex" | "claude";

interface ParsedArgs {
  provider: Provider;
  taskFile: string | null;
  systemPrompt: string | null;
  workspace: string | null;
  model: string | null;
  timeout: number;
}

interface Invocation {
  cmd: string[];
  env: Record<string, string | undefined>;
  cwd?: string;
  cleanup?: () => Promise<void>;
}

interface ParsedOutput {
  ok: boolean;
  content: string;
  error?: CLIError;
}

// =============================================================================
// CLI Discovery
// =============================================================================

function _existsSync(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

function _addPathIfExists(paths: string[], p: string | undefined): void {
  if (!p) return;
  const resolved = p.startsWith("~") ? join(homedir(), p.slice(1)) : resolve(p);
  if (_existsSync(resolved)) {
    paths.push(resolved);
  }
}

function buildCandidatePaths(): string[] {
  const paths: string[] = [];
  const env = process.env;

  for (const v of ["PNPM_HOME", "NVM_SYMLINK", "NVM_HOME"]) {
    _addPathIfExists(paths, env[v]);
  }

  const npmPrefix = env.NPM_CONFIG_PREFIX;
  if (npmPrefix) {
    if (process.platform === "win32") {
      _addPathIfExists(paths, npmPrefix);
    } else {
      _addPathIfExists(paths, join(npmPrefix, "bin"));
    }
  }

  const appdata = env.APPDATA;
  if (appdata) {
    _addPathIfExists(paths, join(appdata, "npm"));
  }
  const localapp = env.LOCALAPPDATA;
  if (localapp) {
    _addPathIfExists(paths, join(localapp, "Yarn", "bin"));
    _addPathIfExists(paths, join(localapp, "pnpm"));
  }

  _addPathIfExists(paths, join(homedir(), ".npm-global", "bin"));
  _addPathIfExists(paths, join(homedir(), ".local", "share", "pnpm"));
  _addPathIfExists(paths, join(homedir(), ".yarn", "bin"));
  _addPathIfExists(paths, "/usr/local/bin");

  const nodePath = Bun.which("node");
  if (nodePath) {
    _addPathIfExists(paths, dirname(nodePath));
  }

  return [...new Set(paths)];
}

function buildExtendedPath(): string {
  const extra = buildCandidatePaths();
  const current = process.env.PATH ?? "";
  return [...extra, current].join(delimiter);
}

async function resolveCliExecutable(
  name: string,
  extendedPath?: string,
  verifyVersion: boolean = true,
  env?: Record<string, string | undefined>,
): Promise<string | null> {
  if (!extendedPath) {
    extendedPath = buildExtendedPath();
  }

  let exe = Bun.which(name, { PATH: extendedPath });

  if (process.platform === "win32" && !exe) {
    exe = Bun.which(`${name}.cmd`, { PATH: extendedPath });
  }

  if (!exe) return null;

  if (verifyVersion) {
    try {
      const checkEnv: Record<string, string | undefined> = env
        ? { ...env, PATH: extendedPath }
        : { ...process.env, PATH: extendedPath };

      const result = Bun.spawnSync({
        cmd: [exe, "--version"],
        env: checkEnv,
        stdout: "pipe",
        stderr: "pipe",
        timeout: 10_000,
      });
      if (result.exitCode !== 0) return null;
    } catch {
      return null;
    }
  }

  return exe;
}

// =============================================================================
// Subprocess Runner
// =============================================================================

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

    return { stdout, stderr, exitCode, signalCode: proc.signalCode, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

// =============================================================================
// Output Parsers
// =============================================================================

function parseGeminiOutput(stdout: string, stderr: string, returncode: number): ParsedOutput {
  if (returncode !== 0) {
    return {
      ok: false,
      content: "",
      error: {
        type: "cli_error",
        message: stderr || `CLI exited with code ${returncode}`,
        returncode,
      },
    };
  }

  let data: any;
  try {
    data = JSON.parse(stdout || "{}");
  } catch (e: any) {
    return {
      ok: false,
      content: "",
      error: {
        type: "parse_error",
        message: `Failed to parse Gemini JSON: ${e.message}`,
        raw_output: stdout.slice(0, 2000),
      },
    };
  }

  if (data.error) {
    return {
      ok: false,
      content: "",
      error: data.error,
    };
  }

  return { ok: true, content: data.response ?? "" };
}

function parseCodexOutput(stdout: string, stderr: string, returncode: number): ParsedOutput {
  if (returncode !== 0) {
    return {
      ok: false,
      content: "",
      error: {
        type: "cli_error",
        message: stderr || `CLI exited with code ${returncode}`,
        returncode,
      },
    };
  }

  const contentParts: string[] = [];
  const errors: any[] = [];

  for (const line of (stdout || "").trim().split("\n")) {
    if (!line.trim()) continue;

    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    const eventType: string = event.type ?? "";

    if (eventType === "item.completed") {
      const item = event.item ?? {};
      if (item.type === "agent_message") {
        const text: string = item.text ?? "";
        if (text) contentParts.push(text);
      }
    } else if (eventType === "error") {
      errors.push(event);
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      content: "",
      error: {
        type: "agent_error",
        message: errors[0].message ?? "Unknown error",
        errors,
      },
    };
  }

  return { ok: true, content: contentParts.join("\n\n") };
}

function parseClaudeOutput(stdout: string, stderr: string, returncode: number): ParsedOutput {
  let data: any;
  try {
    data = JSON.parse(stdout.trim());
  } catch (e) {
    if (returncode !== 0) {
      return {
        ok: false,
        content: "",
        error: {
          type: "cli_error",
          message: stderr || `CLI exited with code ${returncode}`,
          returncode,
        },
      };
    }
    return {
      ok: false,
      content: "",
      error: {
        type: "parse_error",
        message: `JSON parse failed: ${e}`,
        raw_output: stdout.slice(0, 1000),
      },
    };
  }

  if (data.is_error === true || (data.subtype && data.subtype !== "success")) {
    const errors: string[] = data.errors ?? [];
    return {
      ok: false,
      content: "",
      error: {
        type: "agent_error",
        message: errors.join("; ") || data.subtype || "unknown error",
        subtype: data.subtype,
        errors,
      },
    };
  }

  if (returncode !== 0) {
    return {
      ok: false,
      content: "",
      error: {
        type: "cli_error",
        message: stderr || `CLI exited with code ${returncode}`,
        returncode,
      },
    };
  }

  return { ok: true, content: data.result ?? "" };
}

const PARSERS: Record<Provider, (stdout: string, stderr: string, rc: number) => ParsedOutput> = {
  gemini: parseGeminiOutput,
  codex: parseCodexOutput,
  claude: parseClaudeOutput,
};

// =============================================================================
// Auth Detection
// =============================================================================

function hasBareCompatibleAuth(): boolean {
  return (
    !!process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_CODE_USE_BEDROCK === "1" ||
    process.env.CLAUDE_CODE_USE_VERTEX === "1"
  );
}

// =============================================================================
// Command Builders
// =============================================================================

const CLI_NAMES: Record<Provider, string> = {
  gemini: "gemini",
  codex: "codex",
  claude: "claude",
};

const INSTALL_HINTS: Record<Provider, string> = {
  gemini: "npm i -g @google/gemini-cli",
  codex: "npm i -g @openai/codex",
  claude: "npm i -g @anthropic-ai/claude-code",
};

/** Resolve CLI executable and build extended env. Shared by all builders. */
async function resolveProviderCli(
  provider: Provider,
): Promise<{ exe: string; env: Record<string, string | undefined>; extendedPath: string }> {
  const extendedPath = buildExtendedPath();
  const env: Record<string, string | undefined> = { ...process.env, PATH: extendedPath };
  const exe = await resolveCliExecutable(CLI_NAMES[provider], extendedPath, true, env);
  if (!exe) fail({ type: "cli_not_found", message: `CLI '${CLI_NAMES[provider]}' not found. Install: ${INSTALL_HINTS[provider]}` });
  return { exe, env, extendedPath };
}

async function buildGeminiInvocation(args: ParsedArgs): Promise<Invocation> {
  const { exe, env } = await resolveProviderCli("gemini");

  const cmd = [exe, "--output-format", "json", "--skip-trust"];

  if (args.systemPrompt) {
    env.GEMINI_SYSTEM_MD = args.systemPrompt;
  }
  if (args.model) {
    cmd.push("-m", args.model);
  }

  return { cmd, env, cwd: args.workspace ?? undefined };
}

async function buildCodexInvocation(args: ParsedArgs): Promise<Invocation> {
  const { exe, env } = await resolveProviderCli("codex");

  const cmd = [exe, "exec", "--json", "--skip-git-repo-check"];

  if (args.model) {
    cmd.push("-m", args.model);
  }

  if (args.workspace) {
    return { cmd, env, cwd: args.workspace };
  }

  // Codex always needs a temp dir as cwd in file/bare mode
  const tempDir = await mkdtemp(join(tmpdir(), "cli_runner_codex_"));

  if (args.systemPrompt) {
    await copyFile(args.systemPrompt, join(tempDir, "AGENTS.override.md"));
  }

  return {
    cmd,
    env,
    cwd: tempDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function buildClaudeInvocation(args: ParsedArgs): Promise<Invocation> {
  const { exe, env } = await resolveProviderCli("claude");

  const cmd: string[] = [exe];
  if (hasBareCompatibleAuth()) {
    cmd.push("--bare");
  }
  cmd.push("-p", "--output-format", "json");

  if (args.systemPrompt) {
    cmd.push("--append-system-prompt-file", args.systemPrompt);
  }
  if (args.model) {
    cmd.push("--model", args.model);
  }

  return { cmd, env, cwd: args.workspace ?? undefined };
}

const BUILDERS: Record<Provider, (args: ParsedArgs) => Promise<Invocation>> = {
  gemini: buildGeminiInvocation,
  codex: buildCodexInvocation,
  claude: buildClaudeInvocation,
};

// =============================================================================
// Arg Parser
// =============================================================================

const VALID_PROVIDERS: Set<string> = new Set<Provider>(["gemini", "codex", "claude"]);

const USAGE = `Usage: bun run cli_runner.ts <provider> [options]

Providers: gemini | codex | claude

Options:
  --task-file <path>       Read task prompt from file (recommended)
  --system-prompt <path>   System prompt file (file mode)
  --workspace <path>       Workspace directory (directory mode)
  --model <model>          Override default model
  --timeout <seconds>      Execution timeout (default: 300)
  --help                   Show this help message

Task input (pick one):
  --task-file <path>       Read from file (safe for any content)
  stdin pipe               echo "task" | bun run cli_runner.ts ...

Examples:
  bun run cli_runner.ts gemini --task-file /tmp/task.txt
  bun run cli_runner.ts codex --task-file /tmp/task.txt --system-prompt ./agent.md
  bun run cli_runner.ts claude --task-file /tmp/task.txt --workspace ./project/
  echo "say hello" | bun run cli_runner.ts gemini
`;

function parseArgs(argv: string[]): ParsedArgs {
  // argv: bun run cli_runner.ts [provider] [flags...]
  // Bun gives process.argv as: [bun, cli_runner.ts, ...]
  const args = argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stderr.write(USAGE);
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 2);
  }

  // First positional arg is the provider
  const providerArg = args[0];
  if (!VALID_PROVIDERS.has(providerArg)) {
    process.stderr.write(`Error: unknown provider '${providerArg}'. Must be: gemini | codex | claude\n`);
    process.exit(2);
  }

  const result: ParsedArgs = {
    provider: providerArg as Provider,
    taskFile: null,
    systemPrompt: null,
    workspace: null,
    model: null,
    timeout: 300,
  };

  let i = 1;
  while (i < args.length) {
    const flag = args[i];
    switch (flag) {
      case "--task-file":
        result.taskFile = resolve(args[++i] ?? die("--task-file requires a path"));
        break;
      case "--system-prompt":
        result.systemPrompt = resolve(args[++i] ?? die("--system-prompt requires a path"));
        break;
      case "--workspace":
        result.workspace = resolve(args[++i] ?? die("--workspace requires a path"));
        break;
      case "--model":
        result.model = args[++i] ?? die("--model requires a value");
        break;
      case "--timeout":
        result.timeout = Number(args[++i] ?? die("--timeout requires a number"));
        if (isNaN(result.timeout) || result.timeout <= 0) {
          die("--timeout must be a positive number");
        }
        break;
      default:
        die(`Unknown flag: ${flag}`);
    }
    i++;
  }

  // Validate mutual exclusivity
  if (result.systemPrompt && result.workspace) {
    die("--system-prompt and --workspace are mutually exclusive");
  }

  // Validate paths exist
  if (result.taskFile && !_existsSync(result.taskFile)) {
    die(`Task file not found: ${result.taskFile}`);
  }
  if (result.systemPrompt && !_existsSync(result.systemPrompt)) {
    die(`System prompt file not found: ${result.systemPrompt}`);
  }
  if (result.workspace) {
    try {
      if (!statSync(result.workspace).isDirectory()) {
        die(`Workspace path is not a directory: ${result.workspace}`);
      }
    } catch {
      die(`Workspace directory not found: ${result.workspace}`);
    }
  }

  return result;
}

// =============================================================================
// Task Content Reader
// =============================================================================

/**
 * Eagerly read stdin at top level to work around Bun 1.x Windows bug where
 * `Bun.stdin.text()` inside a nested async function never resolves (the event
 * loop exits before the promise settles). Top-level await works correctly.
 *
 * `null` means stdin was a TTY (interactive terminal) — caller should require
 * --task-file in that case.
 */
const _stdinContent: string | null = process.stdin.isTTY
  ? null
  : await Bun.stdin.text();

async function readTaskContent(args: ParsedArgs): Promise<string> {
  // Priority 1: --task-file (recommended, shell-safe)
  if (args.taskFile) {
    try {
      return await Bun.file(args.taskFile).text();
    } catch (e: any) {
      die(`Failed to read task file: ${e.message}`);
    }
  }

  // Priority 2: stdin pipe (only when not a TTY — avoid hanging on interactive terminal)
  if (_stdinContent == null) {
    process.stderr.write("Error: no task provided. Use --task-file <path> or pipe to stdin.\n");
    process.exit(2);
  }
  if (!_stdinContent.trim()) {
    process.stderr.write("Error: empty stdin. Use --task-file <path> or pipe non-empty content.\n");
    process.exit(2);
  }
  return _stdinContent!;
}

// =============================================================================
// Output Helpers
// =============================================================================

function fail(error: CLIError): never {
  process.stdout.write(JSON.stringify(error) + "\n");
  process.exit(1);
}

function die(message: string): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(2);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const taskContent = await readTaskContent(args);

  // Build CLI invocation
  const invocation = await BUILDERS[args.provider](args);

  // Ensure temp dir cleanup on abrupt termination (Ctrl+C)
  const sigCleanup = async () => {
    if (invocation.cleanup) await invocation.cleanup();
    process.exit(130);
  };
  process.on("SIGINT", sigCleanup);
  process.on("SIGTERM", sigCleanup);

  try {
    // Run CLI subprocess
    const result = await runCli(invocation.cmd, taskContent, {
      cwd: invocation.cwd,
      env: invocation.env,
      timeoutSeconds: args.timeout,
    });

    // Handle timeout
    if (result.timedOut) {
      fail({
        type: "timeout",
        message: `CLI execution timed out after ${args.timeout} seconds`,
      });
    }

    // Parse output
    const parsed = PARSERS[args.provider](
      result.stdout,
      result.stderr,
      result.exitCode ?? 1,
    );

    if (parsed.ok) {
      process.stdout.write(parsed.content);
      process.exit(0);
    } else {
      fail(parsed.error ?? { type: "unknown_error", message: "Unknown error" });
    }
  } catch (e: any) {
    if (e.code === "ENOENT") {
      fail({
        type: "cli_not_found",
        message: `CLI executable not found: ${e.message}`,
      });
    }
    fail({
      type: "execution_error",
      message: String(e.message ?? e),
    });
  } finally {
    if (invocation.cleanup) {
      await invocation.cleanup();
    }
  }
}

main();

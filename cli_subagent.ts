/**
 * CLI Subagent — Universal CLI Agent Abstraction Layer (TypeScript/Bun)
 *
 * Single-file library that wraps LLM CLIs (Gemini CLI, Codex CLI) as
 * subprocess-based subagents through a unified, profile-driven interface.
 *
 * Port of the Python reference implementation in py-lib/cli_subagent/.
 *
 * @module cli_subagent
 */

import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve, delimiter, dirname } from "node:path";

// =============================================================================
// Types
// =============================================================================

/** Standardized result from any CLI agent call. */
interface AgentResult {
  ok: boolean;
  content: string;
  stats: Record<string, any>;
  error?: Record<string, any>;
}

/** Convenience accessors for AgentResult stats. */
function inputTokens(r: AgentResult): number {
  return r.stats.input_tokens ?? 0;
}
function outputTokens(r: AgentResult): number {
  return r.stats.output_tokens ?? 0;
}
function totalTokens(r: AgentResult): number {
  return r.stats.total_tokens ?? 0;
}
function cachedTokens(r: AgentResult): number {
  return r.stats.cached_tokens ?? 0;
}
function thoughtsTokens(r: AgentResult): number {
  return r.stats.thoughts_tokens ?? 0;
}
function toolTokens(r: AgentResult): number {
  return r.stats.tool_tokens ?? 0;
}
function perModel(r: AgentResult): Record<string, Record<string, number>> {
  return r.stats.per_model ?? {};
}

/** Output parser function signature. */
type OutputParser = (stdout: string, stderr: string, returncode: number) => AgentResult;

/** Configuration profile for a specific CLI tool. */
interface CLIProfile {
  name: string;
  commandTemplate: string[];
  envVars: Record<string, string>;
  outputParser: OutputParser;
  requiresTempDir: boolean;
  fileModeOverrideName: string;
  dirModeSystemFile: string;
  model?: string;
  /** Flag prefix used to pass model name; defaults to "-m". Claude uses "--model". */
  modelFlag?: string;
}

/** Input mode for CLI agent invocation. */
const InputMode = {
  FILE: "file",
  DIRECTORY: "directory",
} as const;
type InputMode = (typeof InputMode)[keyof typeof InputMode];

/** Internal result from subprocess execution. */
interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signalCode: string | null;
  timedOut: boolean;
}

// =============================================================================
// CLI Discovery Utilities
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
  // Resolve ~ to home dir
  const resolved = p.startsWith("~") ? join(homedir(), p.slice(1)) : resolve(p);
  if (_existsSync(resolved)) {
    paths.push(resolved);
  }
}

/**
 * Build a list of candidate paths where npm-based CLIs might be installed.
 */
function buildCandidatePaths(): string[] {
  const paths: string[] = [];
  const env = process.env;

  // Environment-driven locations (highest priority)
  for (const v of ["PNPM_HOME", "NVM_SYMLINK", "NVM_HOME"]) {
    _addPathIfExists(paths, env[v]);
  }

  // NPM custom prefix
  const npmPrefix = env.NPM_CONFIG_PREFIX;
  if (npmPrefix) {
    if (process.platform === "win32") {
      _addPathIfExists(paths, npmPrefix);
    } else {
      _addPathIfExists(paths, join(npmPrefix, "bin"));
    }
  }

  // Windows-specific paths
  const appdata = env.APPDATA;
  if (appdata) {
    _addPathIfExists(paths, join(appdata, "npm"));
  }
  const localapp = env.LOCALAPPDATA;
  if (localapp) {
    _addPathIfExists(paths, join(localapp, "Yarn", "bin"));
    _addPathIfExists(paths, join(localapp, "pnpm"));
  }

  // Unix-specific paths
  _addPathIfExists(paths, join(homedir(), ".npm-global", "bin"));
  _addPathIfExists(paths, join(homedir(), ".local", "share", "pnpm"));
  _addPathIfExists(paths, join(homedir(), ".yarn", "bin"));
  _addPathIfExists(paths, "/usr/local/bin");

  // Node's directory (if node is found, CLIs installed via npm might be there)
  const nodePath = Bun.which("node");
  if (nodePath) {
    _addPathIfExists(paths, dirname(nodePath));
  }

  // Deduplicate while preserving order (Set preserves insertion order)
  return [...new Set(paths)];
}

/**
 * Build an extended PATH string with candidate directories prepended.
 */
function buildExtendedPath(): string {
  const extra = buildCandidatePaths();
  const current = process.env.PATH ?? "";
  return [...extra, current].join(delimiter);
}

/**
 * Find CLI executable using Bun.which, then optionally verify with --version.
 */
async function resolveCliExecutable(
  name: string,
  extendedPath?: string,
  verifyVersion: boolean = true,
  env?: Record<string, string | undefined>,
): Promise<string | null> {
  if (!extendedPath) {
    extendedPath = buildExtendedPath();
  }

  // Use Bun.which to find the executable
  let exe = Bun.which(name, { PATH: extendedPath });

  // On Windows, also try with .cmd extension if not found
  if (process.platform === "win32" && !exe) {
    exe = Bun.which(`${name}.cmd`, { PATH: extendedPath });
  }

  if (!exe) return null;

  // Optionally verify the CLI works by running --version.
  // Uses Bun.spawnSync per AGENTS.md: "Bun.spawnSync only for --version checks if needed"
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
        timeout: 10_000, // 10 seconds in milliseconds
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

/**
 * Run a CLI subprocess with stdin piped, capturing stdout/stderr.
 * Implements Python-compatible timeout semantics.
 */
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

// =============================================================================
// Output Parsers
// =============================================================================

/**
 * Parse Gemini CLI JSON output into AgentResult.
 */
function parseGeminiJson(stdout: string, stderr: string, returncode: number): AgentResult {
  if (returncode !== 0) {
    return {
      ok: false,
      content: "",
      stats: {},
      error: {
        type: "cli_error",
        message: stderr || `CLI exited with code ${returncode}`,
        returncode,
        raw_output: stdout ? stdout.slice(0, 1000) : null,
      },
    };
  }

  stdout = stdout || "{}";
  let data: any;
  try {
    data = JSON.parse(stdout);
  } catch (e: any) {
    return {
      ok: false,
      content: "",
      stats: {},
      error: {
        type: "parse_error",
        message: `Failed to parse JSON: ${e.message}`,
        raw_output: stdout.slice(0, 2000),
      },
    };
  }

  // Check for error in response
  if (data.error) {
    return {
      ok: false,
      content: "",
      stats: {},
      error: data.error,
    };
  }

  // Extract content
  const content: string = data.response ?? "";

  // Extract and normalize stats
  const stats = _normalizeGeminiStats(data.stats ?? {});

  return { ok: true, content, stats };
}

function _normalizeGeminiStats(rawStats: Record<string, any>): Record<string, any> {
  const stats: Record<string, any> = {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cached_tokens: 0,
    thoughts_tokens: 0,
    tool_tokens: 0,
    per_model: {},
    raw: rawStats,
  };

  const models = rawStats.models ?? {};
  for (const [modelName, modelData] of Object.entries<any>(models)) {
    const tokens = modelData.tokens ?? {};

    // Aggregate totals
    stats.input_tokens += tokens.prompt ?? 0;
    stats.output_tokens += tokens.candidates ?? 0;
    stats.total_tokens += tokens.total ?? 0;
    stats.cached_tokens += tokens.cached ?? 0;
    stats.thoughts_tokens += tokens.thoughts ?? 0;
    stats.tool_tokens += tokens.tool ?? 0;

    // Store per-model breakdown
    stats.per_model[modelName] = {
      input_tokens: tokens.prompt ?? 0,
      output_tokens: tokens.candidates ?? 0,
      total_tokens: tokens.total ?? 0,
      cached_tokens: tokens.cached ?? 0,
      thoughts_tokens: tokens.thoughts ?? 0,
      tool_tokens: tokens.tool ?? 0,
    };
  }

  return stats;
}

/**
 * Parse Codex CLI NDJSON output into AgentResult.
 */
function parseCodexNdjson(stdout: string, stderr: string, returncode: number): AgentResult {
  if (returncode !== 0) {
    return {
      ok: false,
      content: "",
      stats: {},
      error: {
        type: "cli_error",
        message: stderr || `CLI exited with code ${returncode}`,
        returncode,
        raw_output: stdout ? stdout.slice(0, 1000) : null,
      },
    };
  }

  const contentParts: string[] = [];
  let usage: Record<string, any> = {};
  const errors: Record<string, any>[] = [];

  stdout = stdout || "";

  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;

    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      // Skip non-JSON lines
      continue;
    }

    const eventType: string = event.type ?? "";

    // Collect agent messages
    if (eventType === "item.completed") {
      const item = event.item ?? {};
      if (item.type === "agent_message") {
        const text: string = item.text ?? "";
        if (text) contentParts.push(text);
      }
    }
    // Collect usage from turn completion
    else if (eventType === "turn.completed") {
      usage = event.usage ?? {};
    }
    // Collect errors
    else if (eventType === "error") {
      errors.push(event);
    }
  }

  // Check for errors
  if (errors.length > 0) {
    return {
      ok: false,
      content: "",
      stats: {},
      error: {
        type: "agent_error",
        message: errors[0].message ?? "Unknown error",
        errors,
      },
    };
  }

  // Combine all content parts
  const content = contentParts.join("\n\n");

  // Normalize stats
  const stats = _normalizeCodexStats(usage);

  return { ok: true, content, stats };
}

function _normalizeCodexStats(usage: Record<string, any>): Record<string, any> {
  const inputTk = usage.input_tokens ?? 0;
  const outputTk = usage.output_tokens ?? 0;

  return {
    input_tokens: inputTk,
    output_tokens: outputTk,
    total_tokens: inputTk + outputTk,
    cached_tokens: usage.cached_input_tokens ?? 0,
    raw: usage,
  };
}

/**
 * Parse `claude --bare -p --output-format json` output.
 *
 * stdout is a single JSON object (SDKResultMessage) with fields:
 *   type, subtype, is_error, result, usage, modelUsage, total_cost_usd, ...
 *
 * Token stats are mapped to AgentResult.stats with snake_case keys.
 * Per-model breakdown in modelUsage is normalized from camelCase to snake_case.
 */
function parseClaudeJson(stdout: string, stderr: string, returncode: number): AgentResult {
  // Try JSON parse regardless of exit code — Claude returns structured JSON
  // even on non-zero exits (e.g. budget exceeded §9.2).
  let data: any;
  try {
    data = JSON.parse(stdout.trim());
  } catch (e) {
    if (returncode !== 0) {
      return {
        ok: false,
        content: "",
        stats: {},
        error: {
          type: "cli_error",
          message: stderr || `CLI exited with code ${returncode}`,
          returncode,
          raw_output: stdout ? stdout.slice(0, 1000) : null,
        },
      };
    }
    return {
      ok: false,
      content: "",
      stats: {},
      error: {
        type: "parse_error",
        message: `JSON parse failed: ${e}`,
        raw_output: stdout.slice(0, 1000),
      },
    };
  }

  // Error subtypes: "error_max_turns", "error_during_execution", "error_max_budget_usd", etc.
  if (data.is_error === true || (data.subtype && data.subtype !== "success")) {
    const errors: string[] = data.errors ?? [];
    return {
      ok: false,
      content: "",
      stats: _normalizeClaudeStats(data),
      error: {
        type: "agent_error",
        message: errors.join("; ") || data.subtype || "unknown error",
        subtype: data.subtype,
        errors,
      },
    };
  }

  // Valid JSON but non-zero exit without error subtype — still an error
  if (returncode !== 0) {
    return {
      ok: false,
      content: "",
      stats: {},
      error: {
        type: "cli_error",
        message: stderr || `CLI exited with code ${returncode}`,
        returncode,
        raw_output: stdout ? stdout.slice(0, 1000) : null,
      },
    };
  }

  const content: string = data.result ?? "";
  return { ok: true, content, stats: _normalizeClaudeStats(data) };
}

/**
 * Normalize Claude usage/cost data into the standard stats shape.
 * Called for both success and error results (Claude uniquely provides
 * usage data even in error responses like error_max_budget_usd).
 */
function _normalizeClaudeStats(data: Record<string, any>): Record<string, any> {
  const usage: Record<string, any> = data.usage ?? {};
  const modelUsageRaw: Record<string, any> = data.modelUsage ?? {};
  const inputTk = usage.input_tokens ?? 0;
  const outputTk = usage.output_tokens ?? 0;

  // Normalize modelUsage: camelCase → snake_case
  const perModel: Record<string, Record<string, number>> = {};
  for (const [modelName, mu] of Object.entries(modelUsageRaw)) {
    const m = mu as Record<string, any>;
    perModel[modelName] = {
      input_tokens: m.inputTokens ?? 0,
      output_tokens: m.outputTokens ?? 0,
      cached_tokens: m.cacheReadInputTokens ?? 0,
      cache_creation_tokens: m.cacheCreationInputTokens ?? 0,
      cost_usd: m.costUSD ?? 0,
    };
  }

  return {
    input_tokens: inputTk,
    output_tokens: outputTk,
    total_tokens: inputTk + outputTk,
    cached_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
    cost_usd: data.total_cost_usd ?? 0,
    duration_ms: data.duration_ms ?? 0,
    num_turns: data.num_turns ?? 1,
    per_model: perModel,
    raw: usage,
  };
}

// =============================================================================
// Predefined CLI Profiles
// =============================================================================

const GEMINI_PROFILE: CLIProfile = {
  name: "gemini",
  commandTemplate: ["gemini", "--output-format", "json", "--skip-trust"],
  envVars: {
    GEMINI_SYSTEM_MD: "{agent_prompt_path}",
  },
  outputParser: parseGeminiJson,
  requiresTempDir: false,
  fileModeOverrideName: "",
  dirModeSystemFile: ".gemini/system.md",
};

const CODEX_PROFILE: CLIProfile = {
  name: "codex",
  commandTemplate: ["codex", "exec", "--json", "--skip-git-repo-check"],
  envVars: {},
  outputParser: parseCodexNdjson,
  requiresTempDir: true,
  fileModeOverrideName: "AGENTS.override.md",
  dirModeSystemFile: "AGENTS.md",
};

/**
 * Base profile fields shared between bare and non-bare Claude profiles.
 */
const _CLAUDE_PROFILE_BASE = {
  name: "claude",
  envVars: {},
  outputParser: parseClaudeJson,
  requiresTempDir: false,
  fileModeOverrideName: "",
  dirModeSystemFile: ".claude/system.md",
  modelFlag: "--model",
} as const satisfies Omit<CLIProfile, "commandTemplate">;

/**
 * Claude Code profile with `--bare` flag.
 *
 * `--bare` skips hooks, skills, plugins, MCP servers, auto memory, CLAUDE.md
 * discovery.  Faster and deterministic, but requires non-OAuth auth:
 *   ANTHROPIC_API_KEY env var, Bedrock, or Vertex.
 *
 * Use `getClaudeProfile()` for automatic detection instead of picking manually.
 */
const CLAUDE_PROFILE: CLIProfile = {
  ..._CLAUDE_PROFILE_BASE,
  commandTemplate: [
    "claude", "--bare", "-p",
    "--output-format", "json",
    "--append-system-prompt-file", "{agent_prompt_path}",
  ],
};

/**
 * Claude Code profile **without** `--bare` flag.
 *
 * Enables OAuth/keychain auth (`claude auth login`), but also loads hooks,
 * skills, plugins, MCP servers and CLAUDE.md — slower startup.
 *
 * Use `getClaudeProfile()` for automatic detection instead of picking manually.
 */
const CLAUDE_OAUTH_PROFILE: CLIProfile = {
  ..._CLAUDE_PROFILE_BASE,
  commandTemplate: [
    "claude", "-p",
    "--output-format", "json",
    "--append-system-prompt-file", "{agent_prompt_path}",
  ],
};

/**
 * Detect whether the current environment supports `--bare` mode for Claude Code.
 *
 * Returns `true` when any of these are set:
 *   - `ANTHROPIC_API_KEY`
 *   - `CLAUDE_CODE_USE_BEDROCK=1`
 *   - `CLAUDE_CODE_USE_VERTEX=1`
 *
 * When none are present, the user is likely using `claude auth login` (OAuth),
 * which is skipped under `--bare`.
 */
function hasBareCompatibleAuth(): boolean {
  return (
    !!process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_CODE_USE_BEDROCK === "1" ||
    process.env.CLAUDE_CODE_USE_VERTEX === "1"
  );
}

/**
 * Get the appropriate Claude Code profile based on the current auth environment.
 *
 * - If `ANTHROPIC_API_KEY`, Bedrock, or Vertex credentials are detected,
 *   returns `CLAUDE_PROFILE` (with `--bare` — faster, deterministic).
 * - Otherwise returns `CLAUDE_OAUTH_PROFILE` (without `--bare` — supports
 *   `claude auth login` OAuth flow).
 */
function getClaudeProfile(): CLIProfile {
  return hasBareCompatibleAuth() ? CLAUDE_PROFILE : CLAUDE_OAUTH_PROFILE;
}

/** Profile registry for easy lookup by name. Claude uses auto-detected profile. */
const PROFILES: Record<string, CLIProfile> = {
  gemini: GEMINI_PROFILE,
  codex: CODEX_PROFILE,
  get claude() { return getClaudeProfile(); },
};

/**
 * Get a CLI profile by name.
 * @throws {Error} If the profile name is not found.
 */
function getProfile(name: string): CLIProfile {
  const profile = PROFILES[name];
  if (!profile) {
    const available = Object.keys(PROFILES).join(", ");
    throw new Error(`Unknown profile '${name}'. Available: ${available}`);
  }
  return profile;
}

// =============================================================================
// Universal CLI Agent
// =============================================================================

class UniversalCLIAgent {
  readonly profile: CLIProfile;
  readonly agentName: string;
  readonly mode: InputMode;
  readonly agentPromptPath: string | null;
  readonly agentWorkspace: string | null;
  readonly model: string | undefined;

  private constructor(options: {
    profile: CLIProfile;
    agentName: string;
    agentPromptPath?: string;
    agentWorkspace?: string;
    model?: string;
  }) {
    this.profile = options.profile;
    this.agentName = options.agentName;
    this.model = options.model;

    if (options.agentPromptPath && options.agentWorkspace) {
      throw new Error("Cannot specify both agentPromptPath and agentWorkspace");
    }
    if (!options.agentPromptPath && !options.agentWorkspace) {
      throw new Error("Must specify either agentPromptPath or agentWorkspace");
    }

    if (options.agentPromptPath) {
      this.mode = InputMode.FILE;
      this.agentPromptPath = resolve(options.agentPromptPath);
      this.agentWorkspace = null;
      // Validate prompt file exists (matches Python reference behavior)
      if (!_existsSync(this.agentPromptPath)) {
        throw new Error(`Agent prompt file not found: ${this.agentPromptPath}`);
      }
    } else {
      this.mode = InputMode.DIRECTORY;
      this.agentWorkspace = resolve(options.agentWorkspace!);
      this.agentPromptPath = null;
      // Validate workspace directory exists and is a directory
      if (!_existsSync(this.agentWorkspace)) {
        throw new Error(`Agent workspace not found: ${this.agentWorkspace}`);
      }
      try {
        const stat = statSync(this.agentWorkspace);
        if (!stat.isDirectory()) {
          throw new Error(`Agent workspace must be a directory: ${this.agentWorkspace}`);
        }
      } catch (e: any) {
        if (e.message?.startsWith("Agent workspace must be")) throw e;
        throw new Error(`Agent workspace not found: ${this.agentWorkspace}`);
      }
      // Validate system prompt file exists in workspace
      if (this.profile.dirModeSystemFile) {
        const expectedPrompt = join(this.agentWorkspace, this.profile.dirModeSystemFile);
        if (!_existsSync(expectedPrompt)) {
          throw new Error(
            `System prompt not found in workspace: ${expectedPrompt}\n` +
            `Expected location based on profile '${this.profile.name}': ${this.profile.dirModeSystemFile}`,
          );
        }
      }
    }
  }

  /**
   * Create an agent in file mode with a single system prompt file.
   */
  static fromFile(options: {
    profile: CLIProfile;
    agentName: string;
    agentPromptPath: string;
    model?: string;
  }): UniversalCLIAgent {
    return new UniversalCLIAgent({
      profile: options.profile,
      agentName: options.agentName,
      agentPromptPath: options.agentPromptPath,
      model: options.model,
    });
  }

  /**
   * Create an agent in directory mode with a workspace directory.
   */
  static fromDirectory(options: {
    profile: CLIProfile;
    agentName: string;
    agentWorkspace: string;
    model?: string;
  }): UniversalCLIAgent {
    return new UniversalCLIAgent({
      profile: options.profile,
      agentName: options.agentName,
      agentWorkspace: options.agentWorkspace,
      model: options.model,
    });
  }

  /**
   * Auto-detect input type and create agent in appropriate mode.
   */
  static fromPath(options: {
    profile: CLIProfile;
    agentName: string;
    path: string;
    model?: string;
  }): UniversalCLIAgent {
    const resolved = resolve(options.path);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(resolved);
    } catch {
      throw new Error(`Path not found: ${resolved}`);
    }

    if (stat.isDirectory()) {
      return UniversalCLIAgent.fromDirectory({
        profile: options.profile,
        agentName: options.agentName,
        agentWorkspace: resolved,
        model: options.model,
      });
    } else {
      return UniversalCLIAgent.fromFile({
        profile: options.profile,
        agentName: options.agentName,
        agentPromptPath: resolved,
        model: options.model,
      });
    }
  }

  /**
   * Invoke the CLI with the given task content.
   */
  async call(
    taskContent: string,
    options?: { timeout?: number; model?: string },
  ): Promise<AgentResult> {
    const timeout = options?.timeout ?? 300;
    // Model priority: call() > constructor > profile.model
    const effectiveModel = options?.model ?? this.model ?? this.profile.model;

    let tempDir: string | undefined;
    let cwd: string | undefined;

    try {
      // Determine working directory and temp dir based on mode
      if (this.mode === InputMode.DIRECTORY) {
        cwd = this.agentWorkspace!;
      } else if (this.profile.requiresTempDir) {
        tempDir = await mkdtemp(join(tmpdir(), `cli_agent_${this.profile.name}_`));
        await this._prepareTempDir(tempDir);
        cwd = tempDir;
      }

      // Build environment variables
      const env = this._buildEnv(tempDir);

      // Build command
      const cmd = await this._buildCommand(tempDir, env, effectiveModel);

      // Execute subprocess
      const result = await runCli(cmd, taskContent, {
        cwd,
        env,
        timeoutSeconds: timeout,
      });

      // Handle timeout
      if (result.timedOut) {
        return {
          ok: false,
          content: "",
          stats: {},
          error: {
            type: "timeout",
            message: `CLI execution timed out after ${timeout} seconds`,
          },
        };
      }

      // Parse output using profile-specific parser
      return this.profile.outputParser(
        result.stdout,
        result.stderr,
        result.exitCode ?? 1,
      );
    } catch (e: any) {
      // Match Python: only FileNotFoundError from subprocess.run (missing CLI binary)
      // maps to cli_not_found. With constructor validation, ENOENT from missing
      // prompt/workspace files no longer reaches here.
      if (e.code === "ENOENT") {
        return {
          ok: false,
          content: "",
          stats: {},
          error: {
            type: "cli_not_found",
            message: `CLI executable not found: ${e.message}`,
          },
        };
      }
      return {
        ok: false,
        content: "",
        stats: {},
        error: {
          type: "execution_error",
          exception_type: e.constructor?.name ?? "Error",
          message: String(e.message ?? e),
        },
      };
    } finally {
      // Cleanup temp directory
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  /**
   * Prepare temporary directory for CLIs that need it (file mode only).
   */
  private async _prepareTempDir(tempDir: string): Promise<void> {
    if (this.profile.fileModeOverrideName && this.agentPromptPath) {
      const dest = join(tempDir, this.profile.fileModeOverrideName);
      await copyFile(this.agentPromptPath, dest);
    }
  }

  /**
   * Resolve the effective agent prompt path based on mode.
   */
  private _resolvePromptPath(): string {
    if (this.mode === InputMode.DIRECTORY && this.agentWorkspace) {
      return join(this.agentWorkspace, this.profile.dirModeSystemFile);
    }
    return this.agentPromptPath ?? "";
  }

  /**
   * Build placeholder map for template substitution.
   */
  private _buildPlaceholders(tempDir?: string): Record<string, string> {
    return {
      "{agent_prompt_path}": this._resolvePromptPath(),
      "{temp_dir}": tempDir ?? "",
    };
  }

  /**
   * Apply placeholder substitution to a template string.
   */
  private _substitute(template: string, placeholders: Record<string, string>): string {
    let result = template;
    for (const [placeholder, replacement] of Object.entries(placeholders)) {
      result = result.replaceAll(placeholder, replacement);
    }
    return result;
  }

  /**
   * Build environment variables with placeholder substitution.
   */
  private _buildEnv(tempDir?: string): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = { ...process.env };

    // Inject extended PATH for CLI discovery (per-subprocess, not global)
    env.PATH = buildExtendedPath();

    const placeholders = this._buildPlaceholders(tempDir);
    for (const [key, template] of Object.entries(this.profile.envVars)) {
      env[key] = this._substitute(template, placeholders);
    }

    return env;
  }

  /**
   * Build the command with placeholder substitution.
   */
  private async _buildCommand(
    tempDir: string | undefined,
    env: Record<string, string | undefined>,
    model: string | undefined,
  ): Promise<string[]> {
    const placeholders = this._buildPlaceholders(tempDir);
    const extendedPath = env.PATH as string;

    const cmd: string[] = [];
    for (let i = 0; i < this.profile.commandTemplate.length; i++) {
      let part = this._substitute(this.profile.commandTemplate[i], placeholders);

      // For the first element (CLI executable), resolve full path
      if (i === 0) {
        const cliPath = await resolveCliExecutable(part, extendedPath, true, env);
        if (cliPath) {
          part = cliPath;
        } else {
          throw new Error(
            `CLI '${part}' not found. Searched paths: ${extendedPath.slice(0, 200)}...`,
          );
        }
      }

      cmd.push(part);
    }

    // Add model flag if specified
    if (model) {
      const flag = this.profile.modelFlag ?? "-m";
      cmd.push(flag, model);
    }

    return cmd;
  }
}

// =============================================================================
// Public API Exports
// =============================================================================

export {
  // Core classes / types
  UniversalCLIAgent,
  InputMode,
  // Types
  type AgentResult,
  type CLIProfile,
  type RunResult,
  // Predefined profiles
  GEMINI_PROFILE,
  CODEX_PROFILE,
  CLAUDE_PROFILE,
  CLAUDE_OAUTH_PROFILE,
  PROFILES,
  // Claude profile helpers
  getClaudeProfile,
  hasBareCompatibleAuth,
  // Utility functions
  getProfile,
  buildCandidatePaths,
  buildExtendedPath,
  resolveCliExecutable,
  // Parsers
  parseGeminiJson,
  parseCodexNdjson,
  parseClaudeJson,
  // AgentResult accessors
  inputTokens,
  outputTokens,
  totalTokens,
  cachedTokens,
  thoughtsTokens,
  toolTokens,
  perModel,
};

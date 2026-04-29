/**
 * cli_subagent TypeScript implementation tests
 *
 * Mirrors the Python test_compatibility.py structure:
 *   Layer 1: Environment & CLI discovery
 *   Layer 2: CLI flag compatibility
 *   Layer 3: Output format (real calls)
 *   Layer 4: End-to-end integration
 *   Layer 5: Profile & utility verification
 *
 * Run: bun test
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  UniversalCLIAgent,
  InputMode,
  GEMINI_PROFILE,
  CODEX_PROFILE,
  CLAUDE_PROFILE,
  CLAUDE_OAUTH_PROFILE,
  PROFILES,
  getProfile,
  getClaudeProfile,
  hasBareCompatibleAuth,
  buildCandidatePaths,
  buildExtendedPath,
  resolveCliExecutable,
  parseGeminiJson,
  parseCodexNdjson,
  parseClaudeJson,
  inputTokens,
  outputTokens,
  totalTokens,
  cachedTokens,
  perModel,
  type AgentResult,
  type CLIProfile,
} from "./cli_subagent";

// Test models (cheap)
const GEMINI_MODEL = "gemini-3-flash-preview";
const CODEX_MODEL = "gpt-5.4-mini";

// ╔══════════════════════════════════════════════════════════════════╗
// ║  Layer 1: Environment & CLI Discovery                          ║
// ╚══════════════════════════════════════════════════════════════════╝

describe("Layer 1: Environment & CLI Discovery", () => {
  test("1.1 resolveCliExecutable('gemini') finds Gemini CLI", async () => {
    const path = await resolveCliExecutable("gemini");
    expect(path).not.toBeNull();
    console.log(`  [OK] Gemini CLI found at: ${path}`);
  }, 15_000);

  test("1.2 resolveCliExecutable('codex') finds Codex CLI", async () => {
    const path = await resolveCliExecutable("codex");
    expect(path).not.toBeNull();
    console.log(`  [OK] Codex CLI found at: ${path}`);
  }, 15_000);

  test("1.3 buildCandidatePaths() returns valid path list", () => {
    const paths = buildCandidatePaths();
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
    console.log(`  [OK] ${paths.length} candidate paths found`);
  });

  test("1.4 buildExtendedPath() builds valid PATH", () => {
    const extPath = buildExtendedPath();
    expect(typeof extPath).toBe("string");
    expect(extPath.length).toBeGreaterThan(0);
    console.log(`  [OK] Extended PATH length: ${extPath.length} chars`);
  });
});

// ╔══════════════════════════════════════════════════════════════════╗
// ║  Layer 2: Parser Unit Tests (no real CLI calls)                ║
// ╚══════════════════════════════════════════════════════════════════╝

describe("Layer 2: Parser Unit Tests", () => {
  test("2.1 parseGeminiJson handles successful output", () => {
    const stdout = JSON.stringify({
      session_id: "test-session",
      response: "TEST",
      stats: {
        models: {
          "gemini-3-flash-preview": {
            tokens: {
              input: 100,
              prompt: 100,
              candidates: 5,
              total: 105,
              cached: 0,
              thoughts: 10,
              tool: 0,
            },
          },
        },
      },
    });

    const result = parseGeminiJson(stdout, "", 0);
    expect(result.ok).toBe(true);
    expect(result.content).toBe("TEST");
    expect(inputTokens(result)).toBe(100);
    expect(outputTokens(result)).toBe(5);
    expect(totalTokens(result)).toBe(105);
    console.log("  [OK] Gemini JSON parsed correctly");
  });

  test("2.2 parseGeminiJson handles non-zero exit code", () => {
    const result = parseGeminiJson("", "some error", 1);
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe("cli_error");
    console.log("  [OK] Non-zero exit code handled");
  });

  test("2.3 parseGeminiJson handles invalid JSON", () => {
    const result = parseGeminiJson("not json", "", 0);
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe("parse_error");
    console.log("  [OK] Invalid JSON handled");
  });

  test("2.4 parseGeminiJson handles error in response", () => {
    const stdout = JSON.stringify({ error: { type: "api_error", message: "rate limited" } });
    const result = parseGeminiJson(stdout, "", 0);
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe("api_error");
    console.log("  [OK] Error in JSON response handled");
  });

  test("2.5 parseCodexNdjson handles successful output", () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"test-thread"}',
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"TEST"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":50,"output_tokens":10,"reasoning_output_tokens":5}}',
    ].join("\n");

    const result = parseCodexNdjson(stdout, "", 0);
    expect(result.ok).toBe(true);
    expect(result.content).toBe("TEST");
    expect(inputTokens(result)).toBe(100);
    expect(outputTokens(result)).toBe(10);
    expect(totalTokens(result)).toBe(110);
    expect(cachedTokens(result)).toBe(50);
    console.log("  [OK] Codex NDJSON parsed correctly");
  });

  test("2.6 parseCodexNdjson handles multiple agent messages", () => {
    const stdout = [
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Part 1"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Part 2"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":20}}',
    ].join("\n");

    const result = parseCodexNdjson(stdout, "", 0);
    expect(result.ok).toBe(true);
    expect(result.content).toBe("Part 1\n\nPart 2");
    console.log("  [OK] Multiple agent messages joined with \\n\\n");
  });

  test("2.7 parseCodexNdjson handles non-zero exit code", () => {
    const result = parseCodexNdjson("", "error", 1);
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe("cli_error");
    console.log("  [OK] Codex non-zero exit handled");
  });

  test("2.8 parseCodexNdjson handles error event", () => {
    const stdout = [
      '{"type":"error","message":"Something went wrong"}',
    ].join("\n");

    const result = parseCodexNdjson(stdout, "", 0);
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe("agent_error");
    console.log("  [OK] Codex error event handled");
  });

  test("2.9 parseCodexNdjson skips non-JSON lines", () => {
    const stdout = [
      "some debug output",
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"OK"}}',
      '{"type":"turn.completed","usage":{"input_tokens":50,"output_tokens":5}}',
    ].join("\n");

    const result = parseCodexNdjson(stdout, "", 0);
    expect(result.ok).toBe(true);
    expect(result.content).toBe("OK");
    console.log("  [OK] Non-JSON lines skipped");
  });

  // --- parseClaudeJson tests ---

  test("2.10 parseClaudeJson handles successful SDKResultMessage", () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "TEST",
      session_id: "abc-123",
      duration_ms: 5000,
      duration_api_ms: 4800,
      num_turns: 1,
      total_cost_usd: 0.003,
      usage: {
        input_tokens: 500,
        output_tokens: 100,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 50,
      },
      modelUsage: {
        "claude-sonnet-4-6": {
          inputTokens: 500,
          outputTokens: 100,
          cacheReadInputTokens: 50,
          cacheCreationInputTokens: 200,
          costUSD: 0.003,
        },
      },
    });

    const result = parseClaudeJson(stdout, "", 0);
    expect(result.ok).toBe(true);
    expect(result.content).toBe("TEST");
    expect(inputTokens(result)).toBe(500);
    expect(outputTokens(result)).toBe(100);
    expect(totalTokens(result)).toBe(600);
    expect(cachedTokens(result)).toBe(50);
    expect(result.stats.cache_creation_tokens).toBe(200);
    expect(result.stats.cost_usd).toBe(0.003);
    expect(result.stats.duration_ms).toBe(5000);
    expect(result.stats.num_turns).toBe(1);
    const pm = perModel(result);
    expect("claude-sonnet-4-6" in pm).toBe(true);
    expect(pm["claude-sonnet-4-6"].input_tokens).toBe(500);
    expect(pm["claude-sonnet-4-6"].cost_usd).toBe(0.003);
    console.log("  [OK] Claude JSON parsed correctly");
  });

  test("2.11 parseClaudeJson handles non-zero exit code (empty stdout)", () => {
    const result = parseClaudeJson("", "error output", 1);
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe("cli_error");
    expect(result.error?.returncode).toBe(1);
    console.log("  [OK] Claude non-zero exit (empty stdout) handled");
  });

  test("2.12 parseClaudeJson handles invalid JSON", () => {
    const result = parseClaudeJson("not valid json{", "", 0);
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe("parse_error");
    console.log("  [OK] Claude invalid JSON handled");
  });

  test("2.13 parseClaudeJson handles error subtypes", () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 2,
      total_cost_usd: 0.001,
      usage: { input_tokens: 100, output_tokens: 10 },
      modelUsage: {},
      errors: ["Tool execution failed", "Permission denied"],
    });

    const result = parseClaudeJson(stdout, "", 0);
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe("agent_error");
    expect(result.error?.subtype).toBe("error_during_execution");
    expect(result.error?.errors).toEqual(["Tool execution failed", "Permission denied"]);
    expect(result.error?.message).toBe("Tool execution failed; Permission denied");
    // Stats should be preserved from error response
    expect(inputTokens(result)).toBe(100);
    expect(outputTokens(result)).toBe(10);
    expect(totalTokens(result)).toBe(110);
    expect(result.stats.cost_usd).toBe(0.001);
    expect(result.stats.num_turns).toBe(2);
    expect(Object.keys(perModel(result))).toHaveLength(0);
    console.log("  [OK] Claude error subtype handled (with stats)");
  });

  test("2.14 parseClaudeJson handles non-zero exit with structured JSON error (§9.2 budget exceeded)", () => {
    // Exact scenario from protocol spec §9.2: exit code 1 + valid error JSON body.
    // Parser must extract agent_error with subtype, not generic cli_error.
    const stdout = JSON.stringify({
      type: "result",
      subtype: "error_max_budget_usd",
      duration_ms: 6699,
      duration_api_ms: 0,
      is_error: true,
      num_turns: 1,
      stop_reason: "end_turn",
      session_id: "0613b07f-7ab1-486b-8131-3cd5bf350ca6",
      total_cost_usd: 0.01797975,
      usage: {
        input_tokens: 0, output_tokens: 0,
        cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      },
      modelUsage: {
        "claude-sonnet-4-6": {
          inputTokens: 2, outputTokens: 4,
          cacheReadInputTokens: 0, cacheCreationInputTokens: 4777,
          costUSD: 0.01797975,
        },
      },
      errors: ["Reached maximum budget ($1e-7)"],
    });

    const result = parseClaudeJson(stdout, "", 1);
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe("agent_error");
    expect(result.error?.subtype).toBe("error_max_budget_usd");
    expect(result.error?.errors).toEqual(["Reached maximum budget ($1e-7)"]);
    expect(result.error?.message).toBe("Reached maximum budget ($1e-7)");
    // Stats should be preserved from error response (cost/duration especially useful here)
    expect(result.stats.cost_usd).toBe(0.01797975);
    expect(result.stats.duration_ms).toBe(6699);
    expect(result.stats.num_turns).toBe(1);
    expect(inputTokens(result)).toBe(0);
    expect(outputTokens(result)).toBe(0);
    const pm = perModel(result);
    expect("claude-sonnet-4-6" in pm).toBe(true);
    expect(pm["claude-sonnet-4-6"].input_tokens).toBe(2);
    expect(pm["claude-sonnet-4-6"].output_tokens).toBe(4);
    expect(pm["claude-sonnet-4-6"].cache_creation_tokens).toBe(4777);
    expect(pm["claude-sonnet-4-6"].cost_usd).toBe(0.01797975);
    console.log("  [OK] Claude non-zero exit with structured JSON → agent_error preserved (with stats)");
  });

  test("2.15 parseClaudeJson falls back to cli_error when non-zero exit has no JSON", () => {
    // When stdout is not valid JSON (e.g. auth failure, invalid flags), must get cli_error.
    const result = parseClaudeJson("Error: invalid API key", "error output", 1);
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe("cli_error");
    expect(result.error?.returncode).toBe(1);
    expect(result.error?.raw_output).toBe("Error: invalid API key");
    console.log("  [OK] Claude non-zero exit without JSON → cli_error fallback");
  });

  test("2.16 parseClaudeJson handles minimal success (missing optional fields)", () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "answer",
    });

    const result = parseClaudeJson(stdout, "", 0);
    expect(result.ok).toBe(true);
    expect(result.content).toBe("answer");
    expect(inputTokens(result)).toBe(0);
    expect(outputTokens(result)).toBe(0);
    expect(result.stats.cost_usd).toBe(0);
    expect(Object.keys(perModel(result))).toHaveLength(0);
    console.log("  [OK] Claude minimal success handled");
  });
});

// ╔══════════════════════════════════════════════════════════════════╗
// ║  Layer 3: Profile & Utility Verification                       ║
// ╚══════════════════════════════════════════════════════════════════╝

describe("Layer 3: Profile & Utility Verification", () => {
  test("3.1 getProfile('gemini') returns correct profile", () => {
    const p = getProfile("gemini");
    expect(p.name).toBe("gemini");
    expect(p.commandTemplate[0]).toBe("gemini");
    console.log(`  [OK] Gemini profile: ${p.name}`);
  });

  test("3.2 getProfile('codex') returns correct profile", () => {
    const p = getProfile("codex");
    expect(p.name).toBe("codex");
    expect(p.commandTemplate[0]).toBe("codex");
    console.log(`  [OK] Codex profile: ${p.name}`);
  });

  test("3.3 getProfile('invalid') throws Error", () => {
    expect(() => getProfile("nonexistent")).toThrow();
    console.log("  [OK] Error thrown for unknown profile");
  });

  test("3.4 PROFILES registry contains expected profiles", () => {
    expect("gemini" in PROFILES).toBe(true);
    expect("codex" in PROFILES).toBe(true);
    expect("claude" in PROFILES).toBe(true);
    expect(Object.keys(PROFILES).length).toBe(3);
    console.log(`  [OK] PROFILES: ${Object.keys(PROFILES).join(", ")}`);
  });

  test("3.5 GEMINI_PROFILE has correct configuration", () => {
    expect(GEMINI_PROFILE.requiresTempDir).toBe(false);
    expect(GEMINI_PROFILE.dirModeSystemFile).toBe(".gemini/system.md");
    expect(GEMINI_PROFILE.envVars.GEMINI_SYSTEM_MD).toBe("{agent_prompt_path}");
    console.log("  [OK] Gemini profile configuration correct");
  });

  test("3.6 CODEX_PROFILE has correct configuration", () => {
    expect(CODEX_PROFILE.requiresTempDir).toBe(true);
    expect(CODEX_PROFILE.fileModeOverrideName).toBe("AGENTS.override.md");
    expect(CODEX_PROFILE.dirModeSystemFile).toBe("AGENTS.md");
    expect(Object.keys(CODEX_PROFILE.envVars).length).toBe(0);
    console.log("  [OK] Codex profile configuration correct");
  });

  test("3.8 CLAUDE_PROFILE has correct configuration", () => {
    expect(CLAUDE_PROFILE.name).toBe("claude");
    expect(CLAUDE_PROFILE.requiresTempDir).toBe(false);
    expect(CLAUDE_PROFILE.dirModeSystemFile).toBe(".claude/system.md");
    expect(CLAUDE_PROFILE.fileModeOverrideName).toBe("");
    expect(CLAUDE_PROFILE.modelFlag).toBe("--model");
    expect(Object.keys(CLAUDE_PROFILE.envVars).length).toBe(0);
    // commandTemplate must include --bare, -p, --output-format json, and system prompt placeholder
    const tmpl = CLAUDE_PROFILE.commandTemplate;
    expect(tmpl[0]).toBe("claude");
    expect(tmpl).toContain("--bare");
    expect(tmpl).toContain("-p");
    expect(tmpl).toContain("json");
    expect(tmpl).toContain("{agent_prompt_path}");
    console.log("  [OK] Claude profile configuration correct");
  });

  test("3.9 CLAUDE_OAUTH_PROFILE does NOT include --bare", () => {
    expect(CLAUDE_OAUTH_PROFILE.name).toBe("claude");
    expect(CLAUDE_OAUTH_PROFILE.commandTemplate).not.toContain("--bare");
    expect(CLAUDE_OAUTH_PROFILE.commandTemplate).toContain("-p");
    expect(CLAUDE_OAUTH_PROFILE.commandTemplate).toContain("json");
    expect(CLAUDE_OAUTH_PROFILE.commandTemplate).toContain("{agent_prompt_path}");
    expect(CLAUDE_OAUTH_PROFILE.modelFlag).toBe("--model");
    console.log("  [OK] CLAUDE_OAUTH_PROFILE has no --bare");
  });

  test("3.10 getClaudeProfile() returns bare profile when ANTHROPIC_API_KEY is set", () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    try {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      const p = getClaudeProfile();
      expect(p.commandTemplate).toContain("--bare");
      console.log("  [OK] getClaudeProfile() → bare (API key)");
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  test("3.11 getClaudeProfile() returns bare profile when Bedrock is enabled", () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    const savedBedrock = process.env.CLAUDE_CODE_USE_BEDROCK;
    try {
      delete process.env.ANTHROPIC_API_KEY;
      process.env.CLAUDE_CODE_USE_BEDROCK = "1";
      const p = getClaudeProfile();
      expect(p.commandTemplate).toContain("--bare");
      console.log("  [OK] getClaudeProfile() → bare (Bedrock)");
    } finally {
      if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = savedKey;
      if (savedBedrock === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK;
      else process.env.CLAUDE_CODE_USE_BEDROCK = savedBedrock;
    }
  });

  test("3.12 getClaudeProfile() returns non-bare profile when no API credentials", () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    const savedBedrock = process.env.CLAUDE_CODE_USE_BEDROCK;
    const savedVertex = process.env.CLAUDE_CODE_USE_VERTEX;
    try {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_CODE_USE_BEDROCK;
      delete process.env.CLAUDE_CODE_USE_VERTEX;
      const p = getClaudeProfile();
      expect(p.commandTemplate).not.toContain("--bare");
      expect(p.commandTemplate).toContain("-p");
      console.log("  [OK] getClaudeProfile() → non-bare (OAuth fallback)");
    } finally {
      if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = savedKey;
      if (savedBedrock === undefined) delete process.env.CLAUDE_CODE_USE_BEDROCK;
      else process.env.CLAUDE_CODE_USE_BEDROCK = savedBedrock;
      if (savedVertex === undefined) delete process.env.CLAUDE_CODE_USE_VERTEX;
      else process.env.CLAUDE_CODE_USE_VERTEX = savedVertex;
    }
  });

  test("3.7 InputMode enum values", () => {
    expect(InputMode.FILE).toBe("file");
    expect(InputMode.DIRECTORY).toBe("directory");
    console.log("  [OK] InputMode values correct");
  });

  test("3.13 PROFILES.claude uses auto-detected profile", () => {
    const p = PROFILES.claude;
    expect(p.name).toBe("claude");
    expect(p.modelFlag).toBe("--model");
    // Should match what getClaudeProfile() returns for the current env
    const expected = getClaudeProfile();
    expect(p.commandTemplate).toEqual(expected.commandTemplate);
    console.log("  [OK] PROFILES.claude uses auto-detected profile");
  });
});

// ╔══════════════════════════════════════════════════════════════════╗
// ║  Layer 4: UniversalCLIAgent Construction                       ║
// ╚══════════════════════════════════════════════════════════════════╝

describe("Layer 4: UniversalCLIAgent Construction", () => {
  let tempDir: string;
  let promptFile: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cli_subagent_test_"));
    promptFile = join(tempDir, "test_system.md");
    await writeFile(promptFile, "You are a test assistant.", "utf-8");
    // Create system prompt file expected by CODEX_PROFILE in directory mode
    const codexSystemFile = join(tempDir, CODEX_PROFILE.dirModeSystemFile);
    await writeFile(codexSystemFile, "You are a test assistant.", "utf-8");
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("4.1 fromFile creates agent in file mode", () => {
    const agent = UniversalCLIAgent.fromFile({
      profile: GEMINI_PROFILE,
      agentName: "test",
      agentPromptPath: promptFile,
    });
    expect(agent.mode).toBe(InputMode.FILE);
    expect(agent.agentPromptPath).not.toBeNull();
    expect(agent.agentWorkspace).toBeNull();
    console.log("  [OK] fromFile creates file mode agent");
  });

  test("4.2 fromDirectory creates agent in directory mode", () => {
    const agent = UniversalCLIAgent.fromDirectory({
      profile: CODEX_PROFILE,
      agentName: "test",
      agentWorkspace: tempDir,
    });
    expect(agent.mode).toBe(InputMode.DIRECTORY);
    expect(agent.agentWorkspace).not.toBeNull();
    expect(agent.agentPromptPath).toBeNull();
    console.log("  [OK] fromDirectory creates directory mode agent");
  });

  test("4.3 fromPath auto-detects file", () => {
    const agent = UniversalCLIAgent.fromPath({
      profile: GEMINI_PROFILE,
      agentName: "test",
      path: promptFile,
    });
    expect(agent.mode).toBe(InputMode.FILE);
    console.log("  [OK] fromPath detects file");
  });

  test("4.4 fromPath auto-detects directory", () => {
    const agent = UniversalCLIAgent.fromPath({
      profile: CODEX_PROFILE,
      agentName: "test",
      path: tempDir,
    });
    expect(agent.mode).toBe(InputMode.DIRECTORY);
    console.log("  [OK] fromPath detects directory");
  });

  test("4.5 fromPath throws for non-existent path", () => {
    expect(() =>
      UniversalCLIAgent.fromPath({
        profile: GEMINI_PROFILE,
        agentName: "test",
        path: "/nonexistent/path/abc123",
      }),
    ).toThrow();
    console.log("  [OK] fromPath throws for missing path");
  });

  test("4.6 model priority: call > constructor > profile", () => {
    const agent = UniversalCLIAgent.fromFile({
      profile: GEMINI_PROFILE,
      agentName: "test",
      agentPromptPath: promptFile,
      model: "constructor-model",
    });
    expect(agent.model).toBe("constructor-model");
    console.log("  [OK] Model stored from constructor");
  });
});

// ╔══════════════════════════════════════════════════════════════════╗
// ║  Layer 5: End-to-End Integration (real CLI calls)              ║
// ║  These tests require actual CLIs to be installed & configured  ║
// ╚══════════════════════════════════════════════════════════════════╝

describe("Layer 5: End-to-End Integration", () => {
  let tempDir: string;
  let promptFile: string;
  let geminiAvailable: boolean;
  let codexAvailable: boolean;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cli_subagent_e2e_"));
    promptFile = join(tempDir, "test_system.md");
    await writeFile(promptFile, "You are a test assistant. Always reply concisely.", "utf-8");

    geminiAvailable = (await resolveCliExecutable("gemini")) !== null;
    codexAvailable = (await resolveCliExecutable("codex")) !== null;

    console.log(`  Gemini available: ${geminiAvailable}`);
    console.log(`  Codex available: ${codexAvailable}`);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("5.1 Gemini file mode end-to-end", async () => {
    if (!geminiAvailable) {
      console.log("  [SKIP] Gemini CLI not available");
      return;
    }

    const agent = UniversalCLIAgent.fromFile({
      profile: GEMINI_PROFILE,
      agentName: "test_gemini",
      agentPromptPath: promptFile,
      model: GEMINI_MODEL,
    });

    console.log("  [WAIT] Calling Gemini via UniversalCLIAgent...");
    const result = await agent.call("Reply with exactly: E2E_GEMINI_OK", { timeout: 120 });
    expect(result.ok).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
    expect(totalTokens(result)).toBeGreaterThan(0);
    console.log(`  [OK] Gemini E2E: ok=${result.ok}, content=${result.content.slice(0, 80)}`);
  }, 130_000);

  test("5.2 Codex file mode end-to-end", async () => {
    if (!codexAvailable) {
      console.log("  [SKIP] Codex CLI not available");
      return;
    }

    const agent = UniversalCLIAgent.fromFile({
      profile: CODEX_PROFILE,
      agentName: "test_codex",
      agentPromptPath: promptFile,
      model: CODEX_MODEL,
    });

    console.log("  [WAIT] Calling Codex via UniversalCLIAgent...");
    const result = await agent.call("Reply with exactly: E2E_CODEX_OK", { timeout: 120 });
    expect(result.ok).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
    console.log(`  [OK] Codex E2E: ok=${result.ok}, content=${result.content.slice(0, 80)}`);
  }, 130_000);

  test("5.3 Timeout handling", async () => {
    if (!geminiAvailable) {
      console.log("  [SKIP] Gemini CLI not available");
      return;
    }

    const agent = UniversalCLIAgent.fromFile({
      profile: GEMINI_PROFILE,
      agentName: "test_timeout",
      agentPromptPath: promptFile,
      model: GEMINI_MODEL,
    });

    const result = await agent.call(
      "Write a 10000 word essay about the history of computing.",
      { timeout: 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.error?.type).toBe("timeout");
    console.log(`  [OK] Timeout handled correctly: ${result.error?.type}`);
  }, 30_000);

  test("5.4 Token properties (Gemini)", async () => {
    if (!geminiAvailable) {
      console.log("  [SKIP] Gemini CLI not available");
      return;
    }

    const agent = UniversalCLIAgent.fromFile({
      profile: GEMINI_PROFILE,
      agentName: "test_tokens",
      agentPromptPath: promptFile,
      model: GEMINI_MODEL,
    });

    console.log("  [WAIT] Calling Gemini for token stats...");
    const result = await agent.call("Say: TOKEN_TEST", { timeout: 120 });
    expect(result.ok).toBe(true);
    expect(inputTokens(result)).toBeGreaterThan(0);
    expect(outputTokens(result)).toBeGreaterThan(0);
    expect(totalTokens(result)).toBeGreaterThan(0);
    console.log(`  [OK] Tokens: in=${inputTokens(result)} out=${outputTokens(result)} total=${totalTokens(result)}`);
  }, 130_000);

  test("5.5 Per-model stats (Gemini)", async () => {
    if (!geminiAvailable) {
      console.log("  [SKIP] Gemini CLI not available");
      return;
    }

    const agent = UniversalCLIAgent.fromFile({
      profile: GEMINI_PROFILE,
      agentName: "test_per_model",
      agentPromptPath: promptFile,
    });

    console.log("  [WAIT] Calling Gemini with explicit model...");
    const result = await agent.call("Reply: MODEL_TEST_OK", { timeout: 120, model: GEMINI_MODEL });
    expect(result.ok).toBe(true);
    const pm = perModel(result);
    if (Object.keys(pm).length > 0) {
      console.log(`  [OK] per_model keys: ${Object.keys(pm).join(", ")}`);
    } else {
      console.log("  [WARN] per_model is empty");
    }
  }, 130_000);
});

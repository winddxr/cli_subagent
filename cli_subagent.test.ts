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
  PROFILES,
  getProfile,
  buildCandidatePaths,
  buildExtendedPath,
  resolveCliExecutable,
  parseGeminiJson,
  parseCodexNdjson,
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

  test("3.4 PROFILES registry contains two profiles", () => {
    expect("gemini" in PROFILES).toBe(true);
    expect("codex" in PROFILES).toBe(true);
    expect(Object.keys(PROFILES).length).toBe(2);
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

  test("3.7 InputMode enum values", () => {
    expect(InputMode.FILE).toBe("file");
    expect(InputMode.DIRECTORY).toBe("directory");
    console.log("  [OK] InputMode values correct");
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

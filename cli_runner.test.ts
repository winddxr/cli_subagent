/**
 * cli_runner.ts — Argument parsing & output contract tests
 *
 * Tests the runner as a subprocess (it calls process.exit, so it can't be
 * imported as a module). Focuses on arg validation, exit codes, and the
 * output contract defined in cli_runner.md.
 *
 * Run: bun test cli_runner.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const RUNNER = resolve(import.meta.dir, "cli_runner.ts");

/** Run cli_runner.ts with given args, optionally piping stdin. */
async function run(
  args: string[],
  options?: { stdin?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", RUNNER, ...args],
    stdin: options?.stdin != null
      ? new TextEncoder().encode(options.stdin)
      : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = options?.timeout
    ? setTimeout(() => proc.kill("SIGTERM"), options.timeout)
    : null;

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  if (timer) clearTimeout(timer);

  return { stdout, stderr, exitCode: exitCode ?? 1 };
}

/** Create a temp dir with a task file, run `fn`, then always clean up. */
async function withTempTask(
  taskContent: string,
  fn: (taskFile: string, tempDir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "cli_runner_test_"));
  const taskFile = join(tempDir, "task.txt");
  await Bun.write(taskFile, taskContent);
  try {
    await fn(taskFile, tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║  Section 1: Arg Parsing — exit code 2 paths                    ║
// ╚══════════════════════════════════════════════════════════════════╝

describe("Arg Parsing", () => {
  test("no args → exit 2, usage on stderr", async () => {
    const r = await run([]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Usage:");
    expect(r.stderr).toContain("Providers:");
  });

  test("--help → exit 0, usage on stderr", async () => {
    const r = await run(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain("Usage:");
  });

  test("-h → exit 0, usage on stderr", async () => {
    const r = await run(["-h"]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain("Usage:");
  });

  test("unknown provider → exit 2", async () => {
    const r = await run(["invalid"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("unknown provider");
    expect(r.stderr).toContain("invalid");
  });

  test("unknown flag → exit 2", async () => {
    const r = await run(["gemini", "--bogus"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Unknown flag");
  });

  test("--task-file with nonexistent path → exit 2", async () => {
    const r = await run(["gemini", "--task-file", "/nonexistent/path/task.txt"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("not found");
  });

  test("--system-prompt with nonexistent path → exit 2", async () => {
    const r = await run(["gemini", "--system-prompt", "/nonexistent/sys.md"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("not found");
  });

  test("--workspace with nonexistent path → exit 2", async () => {
    const r = await run(["gemini", "--workspace", "/nonexistent/dir/"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("not found");
  });

  test("--timeout with non-number → exit 2", async () => {
    const r = await run(["gemini", "--timeout", "abc"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("positive number");
  });

  test("--timeout with negative number → exit 2", async () => {
    const r = await run(["gemini", "--timeout", "-5"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("positive number");
  });
});

// ╔══════════════════════════════════════════════════════════════════╗
// ║  Section 2: Mutual exclusivity                                 ║
// ╚══════════════════════════════════════════════════════════════════╝

describe("Mutual Exclusivity", () => {
  let tempDir: string;
  let taskFile: string;
  let sysFile: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cli_runner_test_"));
    taskFile = join(tempDir, "task.txt");
    sysFile = join(tempDir, "sys.md");
    await Bun.write(taskFile, "test task");
    await Bun.write(sysFile, "you are a test agent");
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  test("--system-prompt + --workspace → exit 2", async () => {
    const r = await run([
      "gemini",
      "--task-file", taskFile,
      "--system-prompt", sysFile,
      "--workspace", tempDir,
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("mutually exclusive");
  });
});

// ╔══════════════════════════════════════════════════════════════════╗
// ║  Section 3: Task input — TTY guard & stdin                     ║
// ╚══════════════════════════════════════════════════════════════════╝

describe("Task Input", () => {
  test("no --task-file and empty stdin → exit 2", async () => {
    const r = await run(["gemini"], { stdin: "" });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Error:");
  });

  test("--task-file with valid file reads content", async () => {
    await withTempTask("say hello", async (taskFile) => {
      // This will attempt to actually invoke gemini; if not installed, expect
      // exit 1 with cli_not_found JSON error — which proves task reading worked.
      const r = await run(["gemini", "--task-file", taskFile], { timeout: 15_000 });
      // Either success (exit 0) or CLI error (exit 1) — not arg error (exit 2)
      expect(r.exitCode).not.toBe(2);
    });
  }, 20_000);
});

// ╔══════════════════════════════════════════════════════════════════╗
// ║  Section 4: Output contract — exit 1 JSON errors               ║
// ╚══════════════════════════════════════════════════════════════════╝

describe("Output Contract", () => {
  test("CLI not found → exit 1 with JSON error on stdout", async () => {
    await withTempTask("test", async (taskFile) => {
      // Build a minimal PATH that includes bun but excludes npm-installed CLIs
      const bunPath = Bun.which("bun");
      const bunDir = bunPath ? join(bunPath, "..") : "";

      const proc = Bun.spawn({
        cmd: ["bun", "run", RUNNER, "gemini", "--task-file", taskFile],
        env: {
          ...process.env,
          PATH: [bunDir].join(require("node:path").delimiter),
          PNPM_HOME: undefined,
          NVM_SYMLINK: undefined,
          NVM_HOME: undefined,
          NPM_CONFIG_PREFIX: undefined,
          APPDATA: undefined,
          LOCALAPPDATA: undefined,
        },
        stdin: undefined,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(1);

      let parsed: any;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        throw new Error(`Expected JSON on stdout, got: ${stdout.slice(0, 200)}`);
      }

      expect(parsed.type).toBe("cli_not_found");
      expect(typeof parsed.message).toBe("string");
    });
  }, 30_000);
});

// ╔══════════════════════════════════════════════════════════════════╗
// ║  Section 5: Provider acceptance                                ║
// ╚══════════════════════════════════════════════════════════════════╝

describe("Provider Acceptance", () => {
  for (const provider of ["gemini", "codex", "claude"] as const) {
    test(`'${provider}' is accepted as a valid provider`, async () => {
      await withTempTask("test", async (taskFile) => {
        const r = await run([provider, "--task-file", taskFile], { timeout: 15_000 });
        // Should not be exit 2 (arg error) — provider is valid
        expect(r.exitCode).not.toBe(2);
      });
    }, 20_000);
  }
});

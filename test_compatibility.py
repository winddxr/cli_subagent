# -*- coding: utf-8 -*-
"""
cli_subagent 兼容性测试 - 验证 Gemini CLI 和 Codex CLI 更新后功能是否正常

测试模型（低价）：
- Gemini: gemini-3-flash-preview
- Codex:  gpt-5.4-mini

运行方式: uv run python test_compatibility.py
"""

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

# Windows GBK 兼容：强制 stdout 使用 utf-8
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

# 确保 cli_subagent 包可导入（将父目录加入 sys.path）
sys.path.insert(0, str(Path(__file__).parent.parent))

from cli_subagent.core import (
    AgentResult,
    CLIProfile,
    InputMode,
    UniversalCLIAgent,
    build_candidate_paths,
    build_extended_path,
    resolve_cli_executable,
)
from cli_subagent.profiles import (
    CODEX_PROFILE,
    GEMINI_PROFILE,
    PROFILES,
    get_profile,
    parse_codex_ndjson,
    parse_gemini_json,
)

# ── 测试用低价模型 ──────────────────────────────────────────────────
GEMINI_MODEL = "gemini-3-flash-preview"
CODEX_MODEL = "gpt-5.4-mini"

# ── Windows 子进程 flags ────────────────────────────────────────────
_CREATION_FLAGS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def _get_extended_env():
    """获取带扩展 PATH 的环境变量副本"""
    env = os.environ.copy()
    env["PATH"] = build_extended_path()
    return env


# ╔══════════════════════════════════════════════════════════════════╗
# ║  第一层：环境与 CLI 可用性验证                                    ║
# ╚══════════════════════════════════════════════════════════════════╝

class TestLayer1_Environment(unittest.TestCase):
    """Layer 1: CLI discovery and availability."""

    def test_1_1_resolve_gemini(self):
        """1.1 resolve_cli_executable('gemini') 能找到 Gemini CLI"""
        path = resolve_cli_executable("gemini")
        self.assertIsNotNone(path, "Gemini CLI not found")
        print(f"  [OK] Gemini CLI found at: {path}")

    def test_1_2_resolve_codex(self):
        """1.2 resolve_cli_executable('codex') 能找到 Codex CLI"""
        path = resolve_cli_executable("codex")
        self.assertIsNotNone(path, "Codex CLI not found")
        print(f"  [OK] Codex CLI found at: {path}")

    def test_1_3_candidate_paths_exist(self):
        """1.3 build_candidate_paths() 返回有效路径列表"""
        paths = build_candidate_paths()
        self.assertIsInstance(paths, list)
        self.assertGreater(len(paths), 0, "No candidate paths found")
        for p in paths:
            self.assertTrue(Path(p).exists(), f"Candidate path does not exist: {p}")
        print(f"  [OK] {len(paths)} candidate paths found")

    def test_1_4_extended_path(self):
        """1.4 build_extended_path() 构建有效 PATH"""
        ext_path = build_extended_path()
        self.assertIsInstance(ext_path, str)
        self.assertGreater(len(ext_path), 0)
        print(f"  [OK] Extended PATH length: {len(ext_path)} chars")


# ╔══════════════════════════════════════════════════════════════════╗
# ║  第二层：CLI 命令行参数兼容性                                     ║
# ╚══════════════════════════════════════════════════════════════════╝

class TestLayer2_CLIFlags(unittest.TestCase):
    """Layer 2: CLI flag compatibility checks via --help."""

    @classmethod
    def setUpClass(cls):
        env = _get_extended_env()

        gemini_exe = resolve_cli_executable("gemini", verify_version=False)
        codex_exe = resolve_cli_executable("codex", verify_version=False)

        if not gemini_exe:
            raise unittest.SkipTest("Gemini CLI not found")
        if not codex_exe:
            raise unittest.SkipTest("Codex CLI not found")

        r = subprocess.run(
            [gemini_exe, "--help"], capture_output=True, text=True,
            timeout=15, env=env, creationflags=_CREATION_FLAGS,
        )
        cls.gemini_help = r.stdout + r.stderr

        r = subprocess.run(
            [codex_exe, "exec", "--help"], capture_output=True, text=True,
            timeout=15, env=env, creationflags=_CREATION_FLAGS,
        )
        cls.codex_help = r.stdout + r.stderr

    def test_2_1_gemini_output_format_json(self):
        """2.1 Gemini --output-format json 仍可用"""
        self.assertIn("--output-format", self.gemini_help)
        self.assertIn("json", self.gemini_help)
        print("  [OK] --output-format json available")

    def test_2_2_gemini_model_flag(self):
        """2.2 Gemini -m 模型参数仍可用"""
        self.assertIn("-m", self.gemini_help)
        self.assertIn("--model", self.gemini_help)
        print("  [OK] -m/--model available")

    def test_2_3_codex_json_flag(self):
        """2.3 Codex exec --json 仍可用"""
        self.assertIn("--json", self.codex_help)
        print("  [OK] --json available")

    def test_2_4_codex_skip_git_repo_check(self):
        """2.4 Codex --skip-git-repo-check 仍可用"""
        self.assertIn("--skip-git-repo-check", self.codex_help)
        print("  [OK] --skip-git-repo-check available")

    def test_2_5_codex_model_flag(self):
        """2.5 Codex -m 模型参数仍可用"""
        self.assertIn("-m", self.codex_help)
        self.assertIn("--model", self.codex_help)
        print("  [OK] -m/--model available")

    def test_2_6_gemini_stream_json(self):
        """2.6 Gemini 新增 stream-json 输出格式（信息性）"""
        has_stream_json = "stream-json" in self.gemini_help
        print(f"  [INFO] stream-json format: {'available' if has_stream_json else 'not found'}")


# ╔══════════════════════════════════════════════════════════════════╗
# ║  第三层：输出格式兼容性（实际调用）                                ║
# ╚══════════════════════════════════════════════════════════════════╝

class TestLayer3_OutputFormat(unittest.TestCase):
    """Layer 3: Verify CLI output format with real calls."""

    _gemini_raw: str = ""
    _codex_raw: str = ""

    @classmethod
    def setUpClass(cls):
        env = _get_extended_env()

        gemini_exe = resolve_cli_executable("gemini", verify_version=False)
        codex_exe = resolve_cli_executable("codex", verify_version=False)

        if not gemini_exe:
            raise unittest.SkipTest("Gemini CLI not found")
        if not codex_exe:
            raise unittest.SkipTest("Codex CLI not found")

        # ── Gemini 调用 ─────────────────────────────────────────────
        print("\n  [WAIT] Calling Gemini CLI (gemini-3-flash-preview)...")
        r = subprocess.run(
            [gemini_exe, "--output-format", "json", "-m", GEMINI_MODEL,
             "--skip-trust",
             "-p", "Reply with exactly: HELLO_TEST_OK"],
            capture_output=True, text=True, timeout=120, env=env,
            creationflags=_CREATION_FLAGS,
        )
        cls._gemini_raw = r.stdout
        cls._gemini_stderr = r.stderr
        cls._gemini_rc = r.returncode
        print(f"  Gemini returned: code={r.returncode}, stdout={len(r.stdout)} bytes")

        # ── Codex 调用 ──────────────────────────────────────────────
        print("  [WAIT] Calling Codex CLI (gpt-5.4-mini)...")
        r = subprocess.run(
            [codex_exe, "exec", "--json", "--skip-git-repo-check",
             "-m", CODEX_MODEL, "Reply with exactly: HELLO_TEST_OK"],
            capture_output=True, text=True, timeout=120, env=env,
            creationflags=_CREATION_FLAGS,
        )
        cls._codex_raw = r.stdout
        cls._codex_stderr = r.stderr
        cls._codex_rc = r.returncode
        print(f"  Codex returned: code={r.returncode}, stdout={len(r.stdout)} bytes")

    # ── Gemini 格式验证 ─────────────────────────────────────────────

    def test_3_1_gemini_json_structure(self):
        """3.1 Gemini JSON 输出结构未变"""
        self.assertEqual(self._gemini_rc, 0,
                         f"Gemini non-zero exit: {self._gemini_stderr[:500]}")
        data = json.loads(self._gemini_raw)
        self.assertIn("response", data, f"Missing 'response' key. Keys: {list(data.keys())}")
        print(f"  [OK] Gemini JSON keys: {list(data.keys())}")

    def test_3_2_gemini_token_fields(self):
        """3.2 Gemini token 字段名未变"""
        data = json.loads(self._gemini_raw)
        stats = data.get("stats", {})
        models = stats.get("models", {})
        self.assertGreater(len(models), 0, "No models in stats")
        for model_name, model_data in models.items():
            tokens = model_data.get("tokens", {})
            for expected in ("prompt", "candidates", "total"):
                self.assertIn(expected, tokens,
                              f"Missing '{expected}' in tokens for {model_name}. Got: {list(tokens.keys())}")
            print(f"  [OK] Model '{model_name}' tokens: {tokens}")

    def test_3_3_parse_gemini_json(self):
        """3.3 parse_gemini_json() 能正确解析真实输出"""
        result = parse_gemini_json(self._gemini_raw, self._gemini_stderr, self._gemini_rc)
        self.assertTrue(result.ok, f"Parser returned ok=False: {result.error}")
        self.assertGreater(len(result.content), 0, "Empty content")
        self.assertGreater(result.total_tokens, 0, "Zero total tokens")
        print(f"  [OK] Parsed: ok={result.ok}, content_len={len(result.content)}, "
              f"tokens={result.total_tokens}")

    # ── Codex 格式验证 ──────────────────────────────────────────────

    def test_3_4_codex_ndjson_structure(self):
        """3.4 Codex NDJSON 输出结构未变"""
        self.assertEqual(self._codex_rc, 0,
                         f"Codex non-zero exit: {self._codex_stderr[:500]}")
        events = []
        for line in self._codex_raw.strip().split("\n"):
            if line.strip():
                events.append(json.loads(line))
        event_types = [e.get("type") for e in events]
        print(f"  [INFO] Codex event types: {event_types}")
        self.assertIn("item.completed", event_types,
                      f"Missing 'item.completed'. Got: {event_types}")

    def test_3_5_codex_event_types(self):
        """3.5 Codex event 类型名未变"""
        events = []
        for line in self._codex_raw.strip().split("\n"):
            if line.strip():
                events.append(json.loads(line))
        event_types = {e.get("type") for e in events}
        # item.completed with agent_message
        item_events = [e for e in events
                       if e.get("type") == "item.completed"
                       and e.get("item", {}).get("type") == "agent_message"]
        self.assertGreater(len(item_events), 0,
                           f"No agent_message items found. Event types: {event_types}")
        print(f"  [OK] Found {len(item_events)} agent_message item(s)")

    def test_3_6_parse_codex_ndjson(self):
        """3.6 parse_codex_ndjson() 能正确解析真实输出"""
        result = parse_codex_ndjson(self._codex_raw, self._codex_stderr, self._codex_rc)
        self.assertTrue(result.ok, f"Parser returned ok=False: {result.error}")
        self.assertGreater(len(result.content), 0, "Empty content")
        print(f"  [OK] Parsed: ok={result.ok}, content_len={len(result.content)}, "
              f"tokens={result.total_tokens}")

    def test_3_7_codex_token_fields(self):
        """3.7 Codex token 统计字段名未变"""
        events = []
        for line in self._codex_raw.strip().split("\n"):
            if line.strip():
                events.append(json.loads(line))
        turn_completed = [e for e in events if e.get("type") == "turn.completed"]
        if turn_completed:
            usage = turn_completed[-1].get("usage", {})
            print(f"  [INFO] Codex usage fields: {list(usage.keys())}")
            for expected in ("input_tokens", "output_tokens"):
                self.assertIn(expected, usage,
                              f"Missing '{expected}' in usage. Got: {list(usage.keys())}")
            print(f"  [OK] Codex usage: {usage}")
            # 检查新增的 reasoning_tokens 字段
            if "reasoning_tokens" in usage:
                print(f"  [INFO] NEW FIELD: reasoning_tokens={usage['reasoning_tokens']}")
        else:
            print("  [WARN] No turn.completed event found - usage stats unavailable")


# ╔══════════════════════════════════════════════════════════════════╗
# ║  第四层：端到端集成测试                                           ║
# ╚══════════════════════════════════════════════════════════════════╝

class TestLayer4_EndToEnd(unittest.TestCase):
    """Layer 4: End-to-end integration through UniversalCLIAgent."""

    _prompt_file: Path = None
    _temp_dir: str = None

    @classmethod
    def setUpClass(cls):
        cls._temp_dir = tempfile.mkdtemp(prefix="cli_subagent_test_")
        cls._prompt_file = Path(cls._temp_dir) / "test_system.md"
        cls._prompt_file.write_text(
            "You are a test assistant. Always reply concisely.", encoding="utf-8"
        )
        print(f"\n  [INFO] Temp prompt file: {cls._prompt_file}")

    @classmethod
    def tearDownClass(cls):
        import shutil
        if cls._temp_dir and Path(cls._temp_dir).exists():
            shutil.rmtree(cls._temp_dir, ignore_errors=True)

    def test_4_1_gemini_file_mode_e2e(self):
        """4.1 Gemini file mode 端到端"""
        agent = UniversalCLIAgent.from_file(
            profile=GEMINI_PROFILE,
            agent_name="test_gemini",
            agent_prompt_path=self._prompt_file,
            model=GEMINI_MODEL,
        )
        print("  [WAIT] Calling Gemini via UniversalCLIAgent...")
        result = agent.call("Reply with exactly: E2E_GEMINI_OK", timeout=120)
        self.assertTrue(result.ok, f"Gemini E2E failed: {result.error}")
        self.assertGreater(len(result.content), 0, "Empty content")
        print(f"  [OK] Gemini E2E: ok={result.ok}, content={result.content[:80]!r}")

    def test_4_2_codex_file_mode_e2e(self):
        """4.2 Codex file mode 端到端"""
        agent = UniversalCLIAgent.from_file(
            profile=CODEX_PROFILE,
            agent_name="test_codex",
            agent_prompt_path=self._prompt_file,
            model=CODEX_MODEL,
        )
        print("  [WAIT] Calling Codex via UniversalCLIAgent...")
        result = agent.call("Reply with exactly: E2E_CODEX_OK", timeout=120)
        self.assertTrue(result.ok, f"Codex E2E failed: {result.error}")
        self.assertGreater(len(result.content), 0, "Empty content")
        print(f"  [OK] Codex E2E: ok={result.ok}, content={result.content[:80]!r}")

    def test_4_3_gemini_model_param(self):
        """4.3 Gemini 指定模型调用"""
        agent = UniversalCLIAgent.from_file(
            profile=GEMINI_PROFILE,
            agent_name="test_gemini_model",
            agent_prompt_path=self._prompt_file,
        )
        print(f"  [WAIT] Calling Gemini with model={GEMINI_MODEL}...")
        result = agent.call("Reply: MODEL_TEST_OK", timeout=120, model=GEMINI_MODEL)
        self.assertTrue(result.ok, f"Failed: {result.error}")
        per_model = result.per_model
        if per_model:
            print(f"  [OK] per_model keys: {list(per_model.keys())}")
        else:
            print(f"  [WARN] per_model is empty (stats: {result.stats})")
        print(f"  [OK] Model param test passed: content={result.content[:60]!r}")

    def test_4_4_codex_model_param(self):
        """4.4 Codex 指定模型调用"""
        agent = UniversalCLIAgent.from_file(
            profile=CODEX_PROFILE,
            agent_name="test_codex_model",
            agent_prompt_path=self._prompt_file,
        )
        print(f"  [WAIT] Calling Codex with model={CODEX_MODEL}...")
        result = agent.call("Reply: MODEL_TEST_OK", timeout=120, model=CODEX_MODEL)
        self.assertTrue(result.ok, f"Failed: {result.error}")
        print(f"  [OK] Codex model param test passed: content={result.content[:60]!r}")

    def test_4_5_timeout_handling(self):
        """4.5 超时处理"""
        agent = UniversalCLIAgent.from_file(
            profile=GEMINI_PROFILE,
            agent_name="test_timeout",
            agent_prompt_path=self._prompt_file,
            model=GEMINI_MODEL,
        )
        result = agent.call(
            "Write a 10000 word essay about the history of computing.",
            timeout=1,
        )
        self.assertFalse(result.ok, "Expected timeout but got ok=True")
        self.assertEqual(result.error.get("type"), "timeout",
                         f"Expected timeout error, got: {result.error}")
        print(f"  [OK] Timeout handled correctly: {result.error['type']}")

    def test_4_6_token_properties(self):
        """4.6 Token 属性访问"""
        agent = UniversalCLIAgent.from_file(
            profile=GEMINI_PROFILE,
            agent_name="test_tokens",
            agent_prompt_path=self._prompt_file,
            model=GEMINI_MODEL,
        )
        print("  [WAIT] Calling Gemini for token stats...")
        result = agent.call("Say: TOKEN_TEST", timeout=120)
        self.assertTrue(result.ok, f"Failed: {result.error}")
        print(f"  [INFO] input_tokens={result.input_tokens}")
        print(f"  [INFO] output_tokens={result.output_tokens}")
        print(f"  [INFO] total_tokens={result.total_tokens}")
        print(f"  [INFO] cached_tokens={result.cached_tokens}")
        print(f"  [INFO] thoughts_tokens={result.thoughts_tokens}")
        print(f"  [INFO] tool_tokens={result.tool_tokens}")
        self.assertGreater(result.input_tokens, 0, "input_tokens should be > 0")
        self.assertGreater(result.output_tokens, 0, "output_tokens should be > 0")
        self.assertGreater(result.total_tokens, 0, "total_tokens should be > 0")
        print(f"  [OK] Token properties valid")


# ╔══════════════════════════════════════════════════════════════════╗
# ║  第五层：profile 与工具函数验证                                   ║
# ╚══════════════════════════════════════════════════════════════════╝

class TestLayer5_Profiles(unittest.TestCase):
    """Layer 5: Profile registry and utility functions."""

    def test_5_1_get_profile_gemini(self):
        """5.1 get_profile('gemini') 返回正确 profile"""
        p = get_profile("gemini")
        self.assertEqual(p.name, "gemini")
        self.assertEqual(p.command_template[0], "gemini")
        print(f"  [OK] Gemini profile: {p.name}")

    def test_5_2_get_profile_codex(self):
        """5.2 get_profile('codex') 返回正确 profile"""
        p = get_profile("codex")
        self.assertEqual(p.name, "codex")
        self.assertEqual(p.command_template[0], "codex")
        print(f"  [OK] Codex profile: {p.name}")

    def test_5_3_get_profile_invalid(self):
        """5.3 get_profile('invalid') 抛出 KeyError"""
        with self.assertRaises(KeyError):
            get_profile("nonexistent")
        print("  [OK] KeyError raised for unknown profile")

    def test_5_4_profiles_registry(self):
        """5.4 PROFILES 注册表包含两个 profile"""
        self.assertIn("gemini", PROFILES)
        self.assertIn("codex", PROFILES)
        self.assertEqual(len(PROFILES), 2)
        print(f"  [OK] PROFILES: {list(PROFILES.keys())}")


# ╔══════════════════════════════════════════════════════════════════╗
# ║  运行入口                                                        ║
# ╚══════════════════════════════════════════════════════════════════╝

if __name__ == "__main__":
    print("=" * 70)
    print("cli_subagent 兼容性测试")
    print(f"Gemini CLI version: {subprocess.getoutput('gemini --version')}")
    print(f"Codex CLI version:  {subprocess.getoutput('codex --version')}")
    print(f"Test models: Gemini={GEMINI_MODEL}, Codex={CODEX_MODEL}")
    print("=" * 70)

    # 按层顺序运行
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    suite.addTests(loader.loadTestsFromTestCase(TestLayer1_Environment))
    suite.addTests(loader.loadTestsFromTestCase(TestLayer2_CLIFlags))
    suite.addTests(loader.loadTestsFromTestCase(TestLayer5_Profiles))
    suite.addTests(loader.loadTestsFromTestCase(TestLayer3_OutputFormat))
    suite.addTests(loader.loadTestsFromTestCase(TestLayer4_EndToEnd))

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    # 汇总
    print("\n" + "=" * 70)
    print("[SUMMARY] 测试汇总")
    print(f"  运行: {result.testsRun}")
    print(f"  通过: {result.testsRun - len(result.failures) - len(result.errors)}")
    print(f"  失败: {len(result.failures)}")
    print(f"  错误: {len(result.errors)}")
    if result.failures:
        print("\n[FAIL] 失败的测试:")
        for test, traceback in result.failures:
            print(f"  - {test}: {traceback.strip().split(chr(10))[-1]}")
    if result.errors:
        print("\n[ERROR] 出错的测试:")
        for test, traceback in result.errors:
            print(f"  - {test}: {traceback.strip().split(chr(10))[-1]}")
    print("=" * 70)

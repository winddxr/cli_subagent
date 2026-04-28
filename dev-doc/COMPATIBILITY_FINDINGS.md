# cli_subagent 兼容性测试发现 — 更新指南

> 测试日期: 2026-04-26
> Gemini CLI: `@google/gemini-cli@0.39.1`
> Codex CLI: `@openai/codex@0.125.0`

---

## 1. [已修复] Gemini CLI 新增信任目录机制

### 问题

Gemini CLI v0.35+ 引入了**信任目录（Trusted Folders）**机制。在非交互（headless）模式下，如果当前工作目录未被信任，CLI 会直接以 **exit code 55** 退出并报错：

```
Gemini CLI is not running in a trusted directory. To proceed, either use
`--skip-trust`, set the `GEMINI_CLI_TRUST_WORKSPACE=true` environment variable,
or trust this directory in interactive mode.
```

### 影响

`GEMINI_PROFILE` 的所有调用（file mode 和 directory mode）都会失败，因为 `command_template` 中没有 `--skip-trust`。

### 已执行的修复

在 `py-impl/cli_subagent/profiles.py` 的 `GEMINI_PROFILE.command_template` 中添加了 `"--skip-trust"`：

```python
# py-impl/cli_subagent/profiles.py line 252-255
command_template=[
    "gemini",
    "--output-format", "json",
    "--skip-trust",  # <-- 新增
],
```

### 替代方案（未采用）

也可以通过环境变量 `GEMINI_CLI_TRUST_WORKSPACE=true` 实现，但 `--skip-trust` 更显式且不依赖环境。

### 参考

- https://geminicli.com/docs/cli/trusted-folders/#headless-and-automated-environments

---

## 2. Gemini JSON 输出结构变化

### 2.1 新增顶层 `session_id` 字段

**旧版输出顶层 keys**：`["response", "stats"]`（以及可选的 `"error"`）

**新版输出顶层 keys**：`["session_id", "response", "stats"]`

```json
{
  "session_id": "a7c39938-bb3a-437d-aa16-a33b1d8bb569",
  "response": "...",
  "stats": { ... }
}
```

**影响**：无。当前代码只读取 `data.get("response")` 和 `data.get("stats")`，新增字段被安全忽略。

**可选更新**：如需要会话追踪或日志，可将 `session_id` 提取到 `AgentResult.stats` 中。

### 2.2 tokens 新增 `input` 字段

**旧版 tokens 结构**（docstring 中记录的）：

```json
{"prompt": N, "response": N, "total": N}
```

**实际旧版结构**（代码中使用的）：

```json
{"prompt": N, "candidates": N, "total": N, "cached": N, "thoughts": N, "tool": N}
```

> 注意：`py-impl/cli_subagent/profiles.py` 第 32 行 docstring 中写的是 `"response": N`，但代码中实际使用的是 `"candidates"`。这个 **docstring 本身就是错误的**，应该修正。

**新版 tokens 结构**：

```json
{
  "input": 7587,
  "prompt": 7587,
  "candidates": 1,
  "total": 7649,
  "cached": 0,
  "thoughts": 61,
  "tool": 0
}
```

新增了 `input` 字段。实测观察：
- **无缓存时**：`input` == `prompt`（两者值相同）
- **有缓存时**：`input` < `prompt`（`input` 似乎是扣除缓存后的实际输入 token 数）

| 字段 | 含义 | 当前代码是否使用 |
|------|------|-----------------|
| `input` | 实际输入 token（可能扣除缓存） | ❌ 未使用（新字段） |
| `prompt` | 原始 prompt token 数 | ✅ 映射为 `input_tokens` |
| `candidates` | 模型输出 token | ✅ 映射为 `output_tokens` |
| `total` | 总 token | ✅ 映射为 `total_tokens` |
| `cached` | 缓存命中 token | ✅ 映射为 `cached_tokens` |
| `thoughts` | 思考 token（CoT） | ✅ 映射为 `thoughts_tokens` |
| `tool` | 工具调用 token | ✅ 映射为 `tool_tokens` |

**影响**：无。`_normalize_gemini_stats()` 使用 `.get()` 安全获取，新字段被忽略。

**可选更新**：
- 将 `input` 字段纳入标准化统计，例如 `stats["actual_input_tokens"]`
- 用 `input` 字段计算更精确的计费 token（若 `input` 确实是扣除缓存后的数量）

### 2.3 新增 stats 层级结构

新版输出中 `stats.models.[model].` 下新增了以下结构：

```json
{
  "api": {
    "totalRequests": 1,
    "totalErrors": 0,
    "totalLatencyMs": 3167
  },
  "tokens": { ... },
  "roles": {
    "main": {
      "totalRequests": 1,
      "totalErrors": 0,
      "totalLatencyMs": 3167,
      "tokens": { ... }
    }
  }
}
```

| 新增字段路径 | 含义 |
|-------------|------|
| `api.totalRequests` | API 请求次数 |
| `api.totalErrors` | 错误次数 |
| `api.totalLatencyMs` | 总延迟（毫秒） |
| `roles.main.tokens` | 按角色（main/sub-agent）分类的 token 统计 |
| `roles` | 可能在多 agent 场景下包含多个角色 |

**影响**：无。代码只读取 `model_data.get("tokens")`。

**可选更新**：
- 提取 `api.totalLatencyMs` 作为延迟指标
- 如需支持 sub-agent 场景，考虑解析 `roles` 层级

---

## 3. Codex NDJSON 输出结构变化

### 3.1 新增 `reasoning_output_tokens` 字段

**旧版 `turn.completed` usage**：

```json
{
  "input_tokens": N,
  "output_tokens": N,
  "cached_input_tokens": N
}
```

**新版 `turn.completed` usage**：

```json
{
  "input_tokens": 11912,
  "cached_input_tokens": 6528,
  "output_tokens": 29,
  "reasoning_output_tokens": 22
}
```

新增 `reasoning_output_tokens`（推理输出 token）。

**影响**：无。`_normalize_codex_stats()` 使用 `.get()` 安全获取已知字段，未知字段被忽略。`raw` 字段中保留了完整 usage 数据。

**可选更新**：在 `_normalize_codex_stats()` 中新增 `reasoning_tokens` 映射：

```python
# py-impl/cli_subagent/profiles.py _normalize_codex_stats() 中添加：
return {
    "input_tokens": input_tokens,
    "output_tokens": output_tokens,
    "total_tokens": input_tokens + output_tokens,
    "cached_tokens": usage.get("cached_input_tokens", 0),
    "reasoning_tokens": usage.get("reasoning_output_tokens", 0),  # <-- 新增
    "raw": usage,
}
```

同步更新 `AgentResult` 中添加对应属性（如果需要与 Gemini 的 `thoughts_tokens` 概念统一）。

### 3.2 整体事件结构未变

NDJSON 事件流格式完全兼容：

```
{"type":"thread.started","thread_id":"..."}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
{"type":"turn.completed","usage":{...}}
```

所有 event type 名称、`item.type == "agent_message"`、`item.text` 等路径均未改变。

---

## 4. Gemini CLI 新增 `stream-json` 输出格式

`--output-format` 选项现在支持三个值：

| 值 | 说明 | 当前是否使用 |
|---|------|-------------|
| `text` | 纯文本输出 | ❌ |
| `json` | 单次 JSON blob 输出 | ✅ 当前使用 |
| `stream-json` | 流式 JSON 输出（新增） | ❌ |

`stream-json` 可能适用于需要实时处理长任务输出的场景。如需支持，需要：
1. 新增 `parse_gemini_stream_json()` 解析器
2. 研究 `stream-json` 的具体输出格式（可能类似 Codex 的 NDJSON 事件流）
3. 考虑是否需要新建 `GEMINI_STREAM_PROFILE`

---

## 5. Docstring 修正建议

`py-impl/cli_subagent/profiles.py` 第 23-38 行 `parse_gemini_json()` 的 docstring 中记录的 JSON 结构与实际不符：

**当前 docstring（不准确）**：

```python
"""
Gemini outputs a single JSON object with structure:
{
    "response": "...",
    "stats": {
        "models": {
            "[model-name]": {
                "tokens": {"prompt": N, "response": N, "total": N}
            }
        }
    },
    "error": {...}  // optional
}
"""
```

**应修正为**：

```python
"""
Gemini outputs a single JSON object with structure:
{
    "session_id": "...",
    "response": "...",
    "stats": {
        "models": {
            "[model-name]": {
                "api": {"totalRequests": N, "totalErrors": N, "totalLatencyMs": N},
                "tokens": {
                    "input": N, "prompt": N, "candidates": N, "total": N,
                    "cached": N, "thoughts": N, "tool": N
                },
                "roles": { ... }
            }
        },
        "tools": { ... },
        "files": { ... }
    },
    "error": {...}  // optional
}
"""
```

---

## 6. 完整的新版原始输出样本

### Gemini CLI (`gemini-3-flash-preview`)

```json
{
  "session_id": "a7c39938-bb3a-437d-aa16-a33b1d8bb569",
  "response": "TEST",
  "stats": {
    "models": {
      "gemini-3-flash-preview": {
        "api": {
          "totalRequests": 1,
          "totalErrors": 0,
          "totalLatencyMs": 3167
        },
        "tokens": {
          "input": 7587,
          "prompt": 7587,
          "candidates": 1,
          "total": 7649,
          "cached": 0,
          "thoughts": 61,
          "tool": 0
        },
        "roles": {
          "main": {
            "totalRequests": 1,
            "totalErrors": 0,
            "totalLatencyMs": 3167,
            "tokens": {
              "input": 7587,
              "prompt": 7587,
              "candidates": 1,
              "total": 7649,
              "cached": 0,
              "thoughts": 61,
              "tool": 0
            }
          }
        }
      }
    },
    "tools": {
      "totalCalls": 0,
      "totalSuccess": 0,
      "totalFail": 0,
      "totalDurationMs": 0,
      "totalDecisions": {
        "accept": 0,
        "reject": 0,
        "modify": 0,
        "auto_accept": 0
      },
      "byName": {}
    },
    "files": {
      "totalLinesAdded": 0,
      "totalLinesRemoved": 0
    }
  }
}
```

### Codex CLI (`gpt-5.4-mini`)

```jsonl
{"type":"thread.started","thread_id":"019dca17-45f9-7552-ba1e-a7666beda607"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"TEST"}}
{"type":"turn.completed","usage":{"input_tokens":11912,"cached_input_tokens":6528,"output_tokens":29,"reasoning_output_tokens":22}}
```

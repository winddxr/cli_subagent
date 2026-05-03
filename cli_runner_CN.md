# CLI Runner

[English](./cli_runner.md)

## CLI 接口

```
bun run cli_runner.ts <provider> [options]

Providers: gemini | codex | claude

Options:
  --task-file <path>       从文件中读取任务提示词（推荐用于复杂的提示词）
  --system-prompt <path>   系统提示词文件（文件模式）
  --workspace <path>       工作区目录（目录模式，使用 CLI 的配置文件）
  --model <model>          覆盖默认模型
  --timeout <seconds>      执行超时时间（默认：300 秒）

任务输入优先级:
  1. --task-file <path>    基于文件（推荐）：完全绕过 shell 转义问题
  2. stdin pipe            后备方案：echo "simple" | bun run cli_runner.ts ...
  3. 如果都没有提供，报错      以状态码 2 退出并显示用法信息

约束条件:
  - --system-prompt 和 --workspace 互斥
  - 均不是必选项（裸模式 — 仅运行 CLI 的内置行为）
  - --task-file 和 stdin 互斥（如果两者都提供，优先使用 --task-file）
```

## 输出契约 (Output Contract)

| 退出码 | stdout | stderr |
|-----------|--------|--------|
| 0 | Agent 的纯文本响应（无包装） | 可选：带有 Token 用量的 `{"stats":{...}}` JSON 行 |
| 1 | 单行 JSON：`{"type":"<error_type>","message":"..."}` | — |
| 2 | — | 用法/参数错误信息 |

错误类型：`cli_not_found` `cli_error` `parse_error` `agent_error` `timeout` `execution_error`

### 统计对象 (stderr, 仅退出码 0 时)

当 CLI 成功返回时，会将一行 JSON 写入 stderr：
```json
{"stats":{"input_tokens":123,"output_tokens":456,"total_tokens":579,"cached_tokens":0}}
```

Gemini 还会额外包含 `thoughts_tokens`、`tool_tokens` 以及 `per_model` 的细分。
调用方可以完全忽略 stderr — 统计信息是可选的。

### Agent 解析伪代码

```
result = run("bun run cli_runner.ts ...")
if exit_code == 0:  answer = stdout           # 纯文本
if exit_code == 0:  stats  = JSON.parse(stderr_lines[-1]).stats  # 可选
if exit_code == 1:  error  = JSON.parse(stdout)  # {type, message, ...}
if exit_code == 2:  # 调用方式错误，检查 stderr
```

# -*- coding: utf-8 -*-
"""
CLI Profiles - Predefined configurations for supported LLM CLIs.

Each profile defines:
- Command template
- Environment variables
- Output parser

Supported CLIs:
- Codex (OpenAI): Uses CODEX_HOME for AGENTS.md, NDJSON streaming output
- Gemini (Google): Uses GEMINI_SYSTEM_MD for system prompt, JSON output
"""

from __future__ import annotations

import json
from typing import Any, Dict, List

from .core import AgentResult, CLIProfile


def parse_gemini_json(stdout: str, stderr: str, returncode: int) -> AgentResult:
    """Parse Gemini CLI JSON output into AgentResult.
    
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
    if returncode != 0:
        return AgentResult(
            ok=False,
            content="",
            error={
                "type": "cli_error",
                "message": (stderr or "") or f"CLI exited with code {returncode}",
                "returncode": returncode,
                "raw_output": stdout[:1000] if stdout else None,
            },
        )
    
    stdout = stdout or "{}"
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as e:
        return AgentResult(
            ok=False,
            content="",
            error={
                "type": "parse_error",
                "message": f"Failed to parse JSON: {e}",
                "raw_output": stdout[:2000],
            },
        )
    
    # Check for error in response
    if "error" in data and data["error"]:
        return AgentResult(
            ok=False,
            content="",
            error=data["error"],
        )
    
    # Extract content
    content = data.get("response", "")
    
    # Extract and normalize stats
    stats = _normalize_gemini_stats(data.get("stats", {}))
    
    return AgentResult(
        ok=True,
        content=content,
        stats=stats,
    )


def _normalize_gemini_stats(raw_stats: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize Gemini stats to standard format.
    
    Mapping (supports multi-model responses):
    - stats.models.*.tokens.prompt -> input_tokens
    - stats.models.*.tokens.candidates -> output_tokens
    - stats.models.*.tokens.total -> total_tokens
    - stats.models.*.tokens.cached -> cached_tokens
    - stats.models.*.tokens.thoughts -> thoughts_tokens
    - stats.models.*.tokens.tool -> tool_tokens
    
    Also preserves per-model breakdown in 'per_model' for cost estimation.
    """
    stats: Dict[str, Any] = {
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "cached_tokens": 0,
        "thoughts_tokens": 0,
        "tool_tokens": 0,
        "per_model": {},  # Per-model breakdown for cost estimation
        "raw": raw_stats,
    }
    
    models = raw_stats.get("models", {})
    for model_name, model_data in models.items():
        tokens = model_data.get("tokens", {})
        
        # Aggregate totals
        stats["input_tokens"] += tokens.get("prompt", 0)
        stats["output_tokens"] += tokens.get("candidates", 0)
        stats["total_tokens"] += tokens.get("total", 0)
        stats["cached_tokens"] += tokens.get("cached", 0)
        stats["thoughts_tokens"] += tokens.get("thoughts", 0)
        stats["tool_tokens"] += tokens.get("tool", 0)
        
        # Store per-model breakdown
        stats["per_model"][model_name] = {
            "input_tokens": tokens.get("prompt", 0),
            "output_tokens": tokens.get("candidates", 0),
            "total_tokens": tokens.get("total", 0),
            "cached_tokens": tokens.get("cached", 0),
            "thoughts_tokens": tokens.get("thoughts", 0),
            "tool_tokens": tokens.get("tool", 0),
        }
    
    return stats


def parse_codex_ndjson(stdout: str, stderr: str, returncode: int) -> AgentResult:
    """Parse Codex CLI NDJSON (Newline Delimited JSON) output into AgentResult.
    
    Codex outputs a series of JSON events, one per line:
    {"type":"thread.started","thread_id":"..."}
    {"type":"turn.started"}
    {"type":"item.completed","item":{"id":"...","type":"agent_message","text":"..."}}
    {"type":"turn.completed","usage":{"input_tokens":N,"output_tokens":N,...}}
    
    We extract:
    - Content from the last "item.completed" where item.type="agent_message"
    - Stats from "turn.completed" usage
    """
    if returncode != 0:
        return AgentResult(
            ok=False,
            content="",
            error={
                "type": "cli_error",
                "message": stderr or f"CLI exited with code {returncode}",
                "returncode": returncode,
                "raw_output": stdout[:1000] if stdout else None,
            },
        )
    
    content_parts: List[str] = []
    usage: Dict[str, Any] = {}
    errors: List[Dict] = []
    
    
    stdout = stdout or ""
    stderr = stderr or ""
    
    for line in stdout.strip().split("\n"):
        if not line.strip():
            continue
        
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            # Skip non-JSON lines (e.g., debug output)
            continue
        
        event_type = event.get("type", "")
        
        # Collect agent messages
        if event_type == "item.completed":
            item = event.get("item", {})
            if item.get("type") == "agent_message":
                text = item.get("text", "")
                if text:
                    content_parts.append(text)
        
        # Collect usage from turn completion
        elif event_type == "turn.completed":
            usage = event.get("usage", {})
        
        # Collect errors
        elif event_type == "error":
            errors.append(event)
    
    # Check for errors
    if errors:
        return AgentResult(
            ok=False,
            content="",
            error={
                "type": "agent_error",
                "message": errors[0].get("message", "Unknown error"),
                "errors": errors,
            },
        )
    
    # Combine all content parts
    content = "\n\n".join(content_parts)
    
    # Normalize stats
    stats = _normalize_codex_stats(usage)
    
    return AgentResult(
        ok=True,
        content=content,
        stats=stats,
    )


def _normalize_codex_stats(usage: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize Codex usage stats to standard format.
    
    Mapping:
    - usage.input_tokens -> input_tokens
    - usage.output_tokens -> output_tokens
    - (calculated) -> total_tokens
    - usage.cached_input_tokens -> cached_tokens
    """
    input_tokens = usage.get("input_tokens", 0)
    output_tokens = usage.get("output_tokens", 0)
    
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "cached_tokens": usage.get("cached_input_tokens", 0),
        "raw": usage,
    }


# =============================================================================
# Predefined CLI Profiles
# =============================================================================

GEMINI_PROFILE = CLIProfile(
    name="gemini",
    # Command template for Gemini CLI
    # Task prompt is passed via stdin, system prompt via GEMINI_SYSTEM_MD env var
    command_template=[
        "gemini",
        "--output-format", "json",
    ],
    env_vars={
        # System prompt file path - GEMINI_SYSTEM_MD overrides the built-in system prompt
        "GEMINI_SYSTEM_MD": "{agent_prompt_path}",
    },
    output_parser=parse_gemini_json,
    requires_temp_dir=False,
    dir_mode_system_file=".gemini/system.md",
)


CODEX_PROFILE = CLIProfile(
    name="codex",
    # Command template for Codex CLI
    # Both file mode and directory mode use subprocess cwd to set working directory.
    # Do NOT override CODEX_HOME as it contains auth.json for authentication
    command_template=[
        "codex",
        "exec",
        "-m", "gpt-5.1",
        "--json",
        "--skip-git-repo-check",
        # No -C flag needed: subprocess cwd handles working directory
    ],
    env_vars={
        # Empty - do not override CODEX_HOME to preserve auth.json access
    },
    output_parser=parse_codex_ndjson,
    requires_temp_dir=True,  # Only needed in file mode
    file_mode_override_name="AGENTS.override.md",  # Completely override system prompt
    dir_mode_system_file="AGENTS.md",  # Or user-placed AGENTS.override.md
)


# Profile registry for easy lookup by name
PROFILES: Dict[str, CLIProfile] = {
    "gemini": GEMINI_PROFILE,
    "codex": CODEX_PROFILE,
}


def get_profile(name: str) -> CLIProfile:
    """Get a CLI profile by name.
    
    Args:
        name: Profile name (e.g., "gemini", "codex")
        
    Returns:
        The CLIProfile configuration.
        
    Raises:
        KeyError: If the profile name is not found.
    """
    if name not in PROFILES:
        available = ", ".join(PROFILES.keys())
        raise KeyError(f"Unknown profile '{name}'. Available: {available}")
    return PROFILES[name]

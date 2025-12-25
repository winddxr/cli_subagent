# -*- coding: utf-8 -*-
"""
CLI Subagent Module - Universal CLI Agent Abstraction Layer

This module provides a unified interface for invoking various LLM CLIs
(Codex, Gemini, etc.) through configuration-driven profiles.

Main components:
- UniversalCLIAgent: The main agent class for CLI invocation
- CLIProfile: Configuration dataclass for defining CLI behavior
- AgentResult: Standardized result dataclass
- GEMINI_PROFILE, CODEX_PROFILE: Predefined profiles

Example usage:
    from cli_subagent import UniversalCLIAgent, GEMINI_PROFILE
    from pathlib import Path
    
    agent = UniversalCLIAgent(
        profile=GEMINI_PROFILE,
        persona_name="creator",
        persona_path=Path("./cli_subagent/personas/creator.system.md")
    )
    
    result = agent.call("Generate a creative concept...")
    if result.ok:
        print(result.content)
        print(f"Tokens used: {result.total_tokens}")
"""

from .core import AgentResult, CLIProfile, UniversalCLIAgent
from .profiles import (
    CODEX_PROFILE,
    GEMINI_PROFILE,
    PROFILES,
    get_profile,
    parse_codex_ndjson,
    parse_gemini_json,
)

__all__ = [
    # Core classes
    "UniversalCLIAgent",
    "CLIProfile",
    "AgentResult",
    # Predefined profiles
    "GEMINI_PROFILE",
    "CODEX_PROFILE",
    "PROFILES",
    # Utility functions
    "get_profile",
    "parse_gemini_json",
    "parse_codex_ndjson",
]

__version__ = "1.0.0"

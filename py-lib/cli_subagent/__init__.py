# -*- coding: utf-8 -*-
"""
CLI Subagent Module - Universal CLI Agent Abstraction Layer

This module provides a unified interface for invoking various LLM CLIs
(Codex, Gemini, etc.) through configuration-driven profiles.

Main components:
- UniversalCLIAgent: The main agent class for CLI invocation
- CLIProfile: Configuration dataclass for defining CLI behavior
- AgentResult: Standardized result dataclass
- InputMode: Enum for file/directory input modes
- GEMINI_PROFILE, CODEX_PROFILE: Predefined profiles

Example usage (file mode):
    from cli_subagent import UniversalCLIAgent, GEMINI_PROFILE
    from pathlib import Path
    
    agent = UniversalCLIAgent.from_file(
        profile=GEMINI_PROFILE,
        agent_name="creator",
        agent_prompt_path=Path("./prompts/creator.system.md")
    )
    
    result = agent.call("Generate a creative concept...")
    if result.ok:
        print(result.content)
        print(f"Tokens used: {result.total_tokens}")

Example usage (directory mode):
    agent = UniversalCLIAgent.from_directory(
        profile=CODEX_PROFILE,
        agent_name="coder",
        agent_workspace=Path("./workspaces/coder")
    )
    
    result = agent.call("Implement the feature...")

Example usage (auto-detect mode):
    # Automatically detects file vs directory
    agent = UniversalCLIAgent.from_path(
        profile=GEMINI_PROFILE,
        agent_name="agent",
        path="./path/to/file_or_dir"
    )
"""

from .core import AgentResult, CLIProfile, InputMode, UniversalCLIAgent
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
    "InputMode",
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

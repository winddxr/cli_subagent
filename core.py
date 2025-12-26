# -*- coding: utf-8 -*-
"""
CLI Agent Abstraction Core Module

This module provides the core abstractions for interacting with various LLM CLIs
(Codex, Gemini, etc.) through a unified interface.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


# =============================================================================
# CLI Discovery Utilities
# =============================================================================

def _ensure_npm_in_path() -> None:
    """Ensure npm global bin directory is in PATH for subprocess calls."""
    # Common npm global paths on Windows
    common_paths = [
        r"C:\nvm4w\nodejs",
        os.path.expandvars(r"%APPDATA%\npm"),
        os.path.expanduser("~/.npm-global/bin"),
        "/usr/local/bin",  # macOS/Linux
    ]
    
    current_path = os.environ.get("PATH", "")
    
    for path in common_paths:
        if os.path.exists(path) and path not in current_path:
            os.environ["PATH"] = path + os.pathsep + current_path
            current_path = os.environ["PATH"]


# Ensure npm is in PATH at module load time
_ensure_npm_in_path()


@lru_cache(maxsize=16)
def find_cli_executable(name: str) -> Optional[str]:
    """Find CLI executable, trying various locations.
    
    Args:
        name: Base name of the CLI (e.g., 'gemini', 'codex')
        
    Returns:
        Full path to executable or name itself if found in PATH, None if not found
    """
    # Try direct command first (works if already in PATH)
    try:
        result = subprocess.run(
            [name, "--version"],
            capture_output=True,
            timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        if result.returncode == 0:
            return name
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        pass
    
    # Try with .cmd extension (Windows)
    if os.name == 'nt':
        cmd_name = f"{name}.cmd"
        try:
            result = subprocess.run(
                [cmd_name, "--version"],
                capture_output=True,
                timeout=10,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            if result.returncode == 0:
                return cmd_name
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            pass
    
    # Try known paths on Windows
    if os.name == 'nt':
        known_paths = [
            os.path.join(r"C:\nvm4w\nodejs", f"{name}.cmd"),
            os.path.join(os.path.expandvars(r"%APPDATA%\npm"), f"{name}.cmd"),
        ]
        for path in known_paths:
            if os.path.exists(path):
                return path
    
    # Try shutil.which as a fallback
    which_result = shutil.which(name)
    if which_result:
        return which_result
    
    return None


@dataclass
class AgentResult:
    """Standardized result from any CLI agent call.
    
    Attributes:
        ok: Whether the call succeeded.
        content: The AI-generated content (markdown).
        stats: Normalized usage statistics (tokens, latency, etc.).
        error: Error details if the call failed.
    """
    ok: bool
    content: str
    stats: Dict[str, Any] = field(default_factory=dict)
    error: Optional[Dict[str, Any]] = None
    
    @property
    def input_tokens(self) -> int:
        return self.stats.get("input_tokens", 0)
    
    @property
    def output_tokens(self) -> int:
        return self.stats.get("output_tokens", 0)
    
    @property
    def total_tokens(self) -> int:
        return self.stats.get("total_tokens", 0)
    
    @property
    def cached_tokens(self) -> int:
        return self.stats.get("cached_tokens", 0)
    
    @property
    def thoughts_tokens(self) -> int:
        return self.stats.get("thoughts_tokens", 0)
    
    @property
    def tool_tokens(self) -> int:
        return self.stats.get("tool_tokens", 0)
    
    @property
    def per_model(self) -> Dict[str, Dict[str, int]]:
        """Per-model token breakdown (Gemini only). Returns empty dict for other backends."""
        return self.stats.get("per_model", {})


@dataclass
class CLIProfile:
    """Configuration profile for a specific CLI tool.
    
    Attributes:
        name: Profile identifier (e.g., "codex", "gemini").
        command_template: Command line template. Supports placeholders:
            - {prompt}: The task prompt content
            - {persona_path}: Path to the persona/system file
            - {temp_dir}: Temporary directory path (for Codex AGENTS.md)
        env_vars: Environment variables to set. Supports same placeholders.
        output_parser: Function to parse stdout/stderr into AgentResult.
        requires_temp_dir: Whether this CLI needs a temp dir setup (e.g., Codex).
        model: Optional model name override.
    """
    name: str
    command_template: List[str]
    env_vars: Dict[str, str]
    output_parser: Callable[[str, str, int], AgentResult]
    requires_temp_dir: bool = False
    model: Optional[str] = None


class UniversalCLIAgent:
    """Universal CLI agent that can invoke any LLM CLI through profile configuration.
    
    This class handles:
    - Environment setup based on profile
    - Command construction with placeholder substitution
    - Subprocess execution with stdin input
    - Output parsing through profile-specific parsers
    - Temporary directory management for CLIs that need it (e.g., Codex)
    
    Example:
        >>> from agents.profiles import GEMINI_PROFILE
        >>> agent = UniversalCLIAgent(
        ...     profile=GEMINI_PROFILE,
        ...     persona_name="creator",
        ...     persona_path=Path("./agents/personas/creator.system.md")
        ... )
        >>> result = agent.call("Generate a creative concept for...")
        >>> if result.ok:
        ...     print(result.content)
    """
    
    def __init__(
        self,
        profile: CLIProfile,
        persona_name: str,
        persona_path: Path,
    ):
        """Initialize the CLI agent.
        
        Args:
            profile: The CLI profile configuration to use.
            persona_name: A human-readable name for logging/debugging.
            persona_path: Path to the persona/system prompt file.
        """
        self.profile = profile
        self.persona_name = persona_name
        self.persona_path = Path(persona_path).resolve()
        
        if not self.persona_path.exists():
            raise FileNotFoundError(f"Persona file not found: {self.persona_path}")
    
    def call(self, task_content: str, timeout: int = 300) -> AgentResult:
        """Invoke the CLI with the given task content.
        
        Args:
            task_content: The prompt/task to send to the LLM.
            timeout: Maximum seconds to wait for the CLI to complete.
            
        Returns:
            AgentResult with the response content and stats.
        """
        temp_dir: Optional[Path] = None
        
        try:
            # Prepare temp directory if needed (e.g., for Codex AGENTS.md)
            if self.profile.requires_temp_dir:
                temp_dir = Path(tempfile.mkdtemp(prefix=f"cli_agent_{self.profile.name}_"))
                self._prepare_temp_dir(temp_dir)
            
            # Build environment variables
            env = self._build_env(temp_dir)
            
            # Build command
            cmd = self._build_command(task_content, temp_dir)
            
            # Execute subprocess
            result = subprocess.run(
                cmd,
                input=task_content,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
                cwd=str(temp_dir) if temp_dir else None,
                encoding="utf-8",
            )

            # Parse output using profile-specific parser
            return self.profile.output_parser(
                result.stdout,
                result.stderr,
                result.returncode,
            )
            
        except subprocess.TimeoutExpired:
            return AgentResult(
                ok=False,
                content="",
                error={
                    "type": "timeout",
                    "message": f"CLI execution timed out after {timeout} seconds",
                },
            )
        except FileNotFoundError as e:
            return AgentResult(
                ok=False,
                content="",
                error={
                    "type": "cli_not_found",
                    "message": f"CLI executable not found: {e}",
                },
            )
        except Exception as e:
            return AgentResult(
                ok=False,
                content="",
                error={
                    "type": "execution_error",
                    "message": str(e),
                },
            )
        finally:
            # Cleanup temp directory
            if temp_dir and temp_dir.exists():
                shutil.rmtree(temp_dir, ignore_errors=True)
    
    def _prepare_temp_dir(self, temp_dir: Path) -> None:
        """Prepare temporary directory for CLIs that need it.
        
        For Codex, this copies the persona file as AGENTS.md.
        """
        if self.profile.name == "codex":
            agents_md_path = temp_dir / "AGENTS.md"
            shutil.copy2(self.persona_path, agents_md_path)
    
    def _build_env(self, temp_dir: Optional[Path]) -> Dict[str, str]:
        """Build environment variables with placeholder substitution."""
        env = os.environ.copy()
        
        placeholders = {
            "{persona_path}": str(self.persona_path),
            "{temp_dir}": str(temp_dir) if temp_dir else "",
        }
        
        for key, value_template in self.profile.env_vars.items():
            value = value_template
            for placeholder, replacement in placeholders.items():
                value = value.replace(placeholder, replacement)
            env[key] = value
        
        return env
    
    def _build_command(
        self,
        task_content: str,
        temp_dir: Optional[Path],
    ) -> List[str]:
        """Build the command with placeholder substitution."""
        placeholders = {
            "{prompt}": task_content,
            "{persona_path}": str(self.persona_path),
            "{temp_dir}": str(temp_dir) if temp_dir else "",
        }
        
        cmd = []
        for i, part in enumerate(self.profile.command_template):
            for placeholder, replacement in placeholders.items():
                part = part.replace(placeholder, replacement)
            
            # For the first element (CLI executable), try to find full path
            if i == 0:
                cli_path = find_cli_executable(part)
                if cli_path:
                    part = cli_path
            
            cmd.append(part)
        
        return cmd


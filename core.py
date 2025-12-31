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
from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Union


# =============================================================================
# CLI Discovery Utilities
# =============================================================================

def _add_path_if_exists(paths: List[str], p: Optional[str]) -> None:
    """Add path to list if it exists and is not empty."""
    if not p:
        return
    resolved = Path(p).expanduser()
    if resolved.exists():
        paths.append(str(resolved))


def build_candidate_paths() -> List[str]:
    """Build a list of candidate paths where npm-based CLIs might be installed.
    
    Dynamically discovers paths from:
    - NVM_SYMLINK, NVM_HOME (nvm-windows)
    - PNPM_HOME (pnpm global bin)
    - NPM_CONFIG_PREFIX (npm custom prefix)
    - APPDATA/npm (Windows npm global)
    - LOCALAPPDATA/Yarn/bin, LOCALAPPDATA/pnpm (Windows installers)
    - ~/.npm-global/bin, ~/.local/share/pnpm, ~/.yarn/bin (Unix)
    - Directory containing node executable (via shutil.which)
    
    Returns:
        Deduplicated list of existing paths, in priority order.
    """
    paths: List[str] = []
    
    # Environment-driven locations (highest priority)
    for var in ("PNPM_HOME", "NVM_SYMLINK", "NVM_HOME"):
        _add_path_if_exists(paths, os.environ.get(var))
    
    # NPM custom prefix
    npm_prefix = os.environ.get("NPM_CONFIG_PREFIX")
    if npm_prefix:
        if os.name == "nt":
            _add_path_if_exists(paths, npm_prefix)
        else:
            _add_path_if_exists(paths, str(Path(npm_prefix) / "bin"))
    
    # Windows-specific paths
    appdata = os.environ.get("APPDATA")
    if appdata:
        _add_path_if_exists(paths, str(Path(appdata) / "npm"))
    
    localapp = os.environ.get("LOCALAPPDATA")
    if localapp:
        _add_path_if_exists(paths, str(Path(localapp) / "Yarn" / "bin"))
        _add_path_if_exists(paths, str(Path(localapp) / "pnpm"))
    
    # Unix-specific paths
    _add_path_if_exists(paths, str(Path.home() / ".npm-global" / "bin"))
    _add_path_if_exists(paths, str(Path.home() / ".local" / "share" / "pnpm"))
    _add_path_if_exists(paths, str(Path.home() / ".yarn" / "bin"))
    _add_path_if_exists(paths, "/usr/local/bin")
    
    # Node's directory (if node is found, CLIs installed via npm might be there)
    node_path = shutil.which("node")
    if node_path:
        _add_path_if_exists(paths, str(Path(node_path).parent))
    
    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: List[str] = []
    for p in paths:
        if p not in seen:
            unique.append(p)
            seen.add(p)
    
    return unique


def build_extended_path() -> str:
    """Build an extended PATH string with candidate directories prepended.
    
    Returns:
        PATH string with candidate paths prepended to the current PATH.
    """
    extra = build_candidate_paths()
    current = os.environ.get("PATH", "")
    return os.pathsep.join(extra + [current])


def resolve_cli_executable(
    name: str,
    extended_path: Optional[str] = None,
    verify_version: bool = True,
    env: Optional[Dict[str, str]] = None,
) -> Optional[str]:
    """Find CLI executable using shutil.which, then optionally verify with --version.
    
    This approach is more robust than running `name --version` first because:
    1. shutil.which correctly handles .cmd/.bat on Windows
    2. Avoids subprocess failures when CLI is not found
    3. Only runs --version on a known-existing executable
    
    Args:
        name: Base name of the CLI (e.g., 'gemini', 'codex')
        extended_path: Custom PATH string to search in. If None, uses build_extended_path().
        verify_version: Whether to run --version to verify the CLI works.
        env: Environment dict to pass to subprocess (for version check).
        
    Returns:
        Full path to executable, or None if not found/verification failed.
    """
    if extended_path is None:
        extended_path = build_extended_path()
    
    # Use shutil.which to find the executable
    exe = shutil.which(name, path=extended_path)
    
    # On Windows, also try with .cmd extension if not found
    if os.name == "nt" and not exe:
        exe = shutil.which(f"{name}.cmd", path=extended_path)
    
    if not exe:
        return None
    
    # Optionally verify the CLI works by running --version
    if verify_version:
        try:
            check_env = env if env else os.environ.copy()
            check_env["PATH"] = extended_path
            
            result = subprocess.run(
                [exe, "--version"],
                capture_output=True,
                text=True,
                timeout=10,
                env=check_env,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            if result.returncode != 0:
                return None
        except (subprocess.TimeoutExpired, OSError, Exception):
            return None
    
    return exe


# Legacy alias for backwards compatibility
@lru_cache(maxsize=16)
def find_cli_executable(name: str) -> Optional[str]:
    """Find CLI executable (DEPRECATED).
    
    .. deprecated::
        Use resolve_cli_executable() directly for more control.
    """
    import warnings
    warnings.warn(
        "find_cli_executable is deprecated, use resolve_cli_executable instead",
        DeprecationWarning,
        stacklevel=2
    )
    return resolve_cli_executable(name, verify_version=True)


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
        command_template: Command line template. Supports path placeholders only:
            - {agent_prompt_path}: Path to the agent system prompt file
            - {temp_dir}: Temporary directory path
            Note: Task prompt is ALWAYS passed via stdin, NOT via command template.
        env_vars: Environment variables to set. Supports same placeholders.
        output_parser: Function to parse stdout/stderr into AgentResult.
        requires_temp_dir: Whether this CLI needs a temp dir setup (e.g., Codex in file mode).
        file_mode_override_name: Filename to use when copying prompt to temp dir (Codex: AGENTS.override.md).
        dir_mode_system_file: Expected system prompt path relative to workspace dir.
        model: Optional model name override.
    """
    name: str
    command_template: List[str]
    env_vars: Dict[str, str]
    output_parser: Callable[[str, str, int], AgentResult]
    requires_temp_dir: bool = False
    file_mode_override_name: str = ""  # e.g., "AGENTS.override.md" for Codex
    dir_mode_system_file: str = ""     # e.g., "AGENTS.md" or ".gemini/system.md"
    model: Optional[str] = None


class InputMode(Enum):
    """Input mode for CLI agent invocation."""
    FILE = "file"           # Single system prompt file
    DIRECTORY = "directory" # Workspace directory with expected structure


class UniversalCLIAgent:
    """Universal CLI agent that can invoke any LLM CLI through profile configuration.
    
    This class handles:
    - Environment setup based on profile
    - Command construction with placeholder substitution
    - Subprocess execution with stdin input
    - Output parsing through profile-specific parsers
    - Temporary directory management for CLIs that need it (e.g., Codex)
    
    Supports two input modes:
    - File mode: Use a single system prompt file (original behavior)
    - Directory mode: Use a workspace directory with expected structure
    
    Example (file mode):
        >>> from cli_subagent.profiles import GEMINI_PROFILE
        >>> agent = UniversalCLIAgent.from_file(
        ...     profile=GEMINI_PROFILE,
        ...     agent_name="creator",
        ...     agent_prompt_path=Path("./prompts/creator.system.md")
        ... )
        >>> result = agent.call("Generate a creative concept for...")
    
    Example (directory mode):
        >>> agent = UniversalCLIAgent.from_directory(
        ...     profile=CODEX_PROFILE,
        ...     agent_name="coder",
        ...     agent_workspace=Path("./workspaces/coder")
        ... )
        >>> result = agent.call("Implement the feature...")
    """
    
    def __init__(
        self,
        profile: CLIProfile,
        agent_name: str,
        agent_prompt_path: Optional[Path] = None,
        agent_workspace: Optional[Path] = None,
    ):
        """Initialize the CLI agent.
        
        Args:
            profile: The CLI profile configuration to use.
            agent_name: A human-readable name for logging/debugging.
            agent_prompt_path: Path to the agent system prompt file (file mode).
            agent_workspace: Path to the workspace directory (directory mode).
            
        Raises:
            ValueError: If neither or both agent_prompt_path and agent_workspace are provided.
            FileNotFoundError: If the specified path does not exist.
        """
        self.profile = profile
        self.agent_name = agent_name
        
        # Validate input mode
        if agent_prompt_path and agent_workspace:
            raise ValueError("Cannot specify both agent_prompt_path and agent_workspace")
        if not agent_prompt_path and not agent_workspace:
            raise ValueError("Must specify either agent_prompt_path or agent_workspace")
        
        if agent_prompt_path:
            self.mode = InputMode.FILE
            self.agent_prompt_path = Path(agent_prompt_path).resolve()
            self.agent_workspace = None
            if not self.agent_prompt_path.exists():
                raise FileNotFoundError(f"Agent prompt file not found: {self.agent_prompt_path}")
        else:
            self.mode = InputMode.DIRECTORY
            self.agent_workspace = Path(agent_workspace).resolve()
            self.agent_prompt_path = None
            if not self.agent_workspace.exists():
                raise FileNotFoundError(f"Agent workspace not found: {self.agent_workspace}")
            if not self.agent_workspace.is_dir():
                raise ValueError(f"Agent workspace must be a directory: {self.agent_workspace}")
    
    @classmethod
    def from_file(
        cls,
        profile: CLIProfile,
        agent_name: str,
        agent_prompt_path: Union[str, Path],
    ) -> "UniversalCLIAgent":
        """Create an agent in file mode with a single system prompt file.
        
        Args:
            profile: The CLI profile configuration to use.
            agent_name: A human-readable name for logging/debugging.
            agent_prompt_path: Path to the agent system prompt file.
            
        Returns:
            A configured UniversalCLIAgent instance.
        """
        return cls(
            profile=profile,
            agent_name=agent_name,
            agent_prompt_path=Path(agent_prompt_path),
        )
    
    @classmethod
    def from_directory(
        cls,
        profile: CLIProfile,
        agent_name: str,
        agent_workspace: Union[str, Path],
    ) -> "UniversalCLIAgent":
        """Create an agent in directory mode with a workspace directory.
        
        Expected directory structure:
        - Codex: {workspace}/AGENTS.md or AGENTS.override.md
        - Gemini: {workspace}/.gemini/system.md
        
        Args:
            profile: The CLI profile configuration to use.
            agent_name: A human-readable name for logging/debugging.
            agent_workspace: Path to the workspace directory.
            
        Returns:
            A configured UniversalCLIAgent instance.
        """
        return cls(
            profile=profile,
            agent_name=agent_name,
            agent_workspace=Path(agent_workspace),
        )
    
    @classmethod
    def from_path(
        cls,
        profile: CLIProfile,
        agent_name: str,
        path: Union[str, Path],
    ) -> "UniversalCLIAgent":
        """Auto-detect input type and create agent in appropriate mode.
        
        Automatically determines whether the path is a file or directory
        and calls from_file() or from_directory() accordingly.
        
        Args:
            profile: The CLI profile configuration to use.
            agent_name: A human-readable name for logging/debugging.
            path: Path to either a system prompt file or workspace directory.
            
        Returns:
            A configured UniversalCLIAgent instance.
            
        Raises:
            FileNotFoundError: If the path does not exist.
        """
        resolved = Path(path).resolve()
        if not resolved.exists():
            raise FileNotFoundError(f"Path not found: {resolved}")
        
        if resolved.is_dir():
            return cls.from_directory(profile, agent_name, resolved)
        else:
            return cls.from_file(profile, agent_name, resolved)
    
    def call(self, task_content: str, timeout: int = 300) -> AgentResult:
        """Invoke the CLI with the given task content.
        
        Args:
            task_content: The prompt/task to send to the LLM.
            timeout: Maximum seconds to wait for the CLI to complete.
            
        Returns:
            AgentResult with the response content and stats.
        """
        temp_dir: Optional[Path] = None
        cwd: Optional[Path] = None
        
        try:
            # Determine working directory and temp dir based on mode
            if self.mode == InputMode.DIRECTORY:
                # Directory mode: use workspace as cwd, no temp dir needed
                cwd = self.agent_workspace
            elif self.profile.requires_temp_dir:
                # File mode with temp dir requirement (e.g., Codex)
                temp_dir = Path(tempfile.mkdtemp(prefix=f"cli_agent_{self.profile.name}_"))
                self._prepare_temp_dir(temp_dir)
                cwd = temp_dir
            
            # Build environment variables
            env = self._build_env(temp_dir)
            
            # Build command (pass env for extended PATH resolution)
            cmd = self._build_command(task_content, temp_dir, env)
            
            # Execute subprocess
            result = subprocess.run(
                cmd,
                input=task_content,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
                cwd=str(cwd) if cwd else None,
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
        """Prepare temporary directory for CLIs that need it (file mode only).
        
        Copies agent prompt file to temp dir with the configured override filename.
        """
        # Copy agent prompt to temp dir if profile defines an override filename
        if self.profile.file_mode_override_name and self.agent_prompt_path:
            agents_md_path = temp_dir / self.profile.file_mode_override_name
            shutil.copy2(self.agent_prompt_path, agents_md_path)
    
    def _build_env(self, temp_dir: Optional[Path]) -> Dict[str, str]:
        """Build environment variables with placeholder substitution.
        
        Importantly, this injects the extended PATH per-subprocess call,
        avoiding modification of the global os.environ.
        """
        env = os.environ.copy()
        
        # Inject extended PATH for CLI discovery (per-subprocess, not global)
        env["PATH"] = build_extended_path()
        
        # Determine agent prompt path for placeholders
        if self.mode == InputMode.DIRECTORY and self.agent_workspace:
            # In directory mode, use the expected system file path
            prompt_path = self.agent_workspace / self.profile.dir_mode_system_file
        else:
            prompt_path = self.agent_prompt_path or Path("")
        
        placeholders = {
            "{agent_prompt_path}": str(prompt_path),
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
        env: Optional[Dict[str, str]] = None,
    ) -> List[str]:
        """Build the command with placeholder substitution.
        
        Args:
            task_content: The prompt/task content.
            temp_dir: Temporary directory path for CLIs that need it.
            env: Environment dict (used for CLI resolution with extended PATH).
        """
        # Determine agent prompt path for placeholders
        if self.mode == InputMode.DIRECTORY and self.agent_workspace:
            prompt_path = self.agent_workspace / self.profile.dir_mode_system_file
        else:
            prompt_path = self.agent_prompt_path or Path("")
        
        placeholders = {
            "{agent_prompt_path}": str(prompt_path),
            "{temp_dir}": str(temp_dir) if temp_dir else "",
        }
        
        # Get extended PATH for CLI resolution
        extended_path = env.get("PATH") if env else build_extended_path()
        
        cmd = []
        for i, part in enumerate(self.profile.command_template):
            for placeholder, replacement in placeholders.items():
                part = part.replace(placeholder, replacement)
            
            # For the first element (CLI executable), resolve full path
            if i == 0:
                cli_path = resolve_cli_executable(
                    part,
                    extended_path=extended_path,
                    verify_version=True,
                    env=env,
                )
                if cli_path:
                    part = cli_path
                else:
                    # Raise early with helpful error message
                    raise FileNotFoundError(
                        f"CLI '{part}' not found. Searched paths: {extended_path[:200]}..."
                    )
            
            cmd.append(part)
        
        return cmd


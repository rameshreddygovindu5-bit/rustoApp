"""Permission and confirmation policy for agent tools."""
from typing import Tuple
from .tools import TOOL_REGISTRY


def check_tool_permission(user_role: str, tool_name: str) -> Tuple[bool, str]:
    """Returns (allowed, reason)."""
    meta = TOOL_REGISTRY.get(tool_name)
    if not meta:
        return False, f"Unknown tool: {tool_name}"
    if meta["admin_only"] and user_role not in ("admin", "super_admin"):
        return False, f"Tool '{tool_name}' requires admin access."
    return True, "ok"


def needs_confirmation(tool_name: str, confirmation_mode: str = "writes_only") -> bool:
    """
    confirmation_mode:
      "all"          - confirm everything (paranoid)
      "writes_only"  - confirm any write that isn't auto_run    (default)
      "high_risk"    - confirm only checkouts and cancellations
      "none"         - skip confirmation, run everything
    """
    meta = TOOL_REGISTRY.get(tool_name)
    if not meta:
        return True
    if confirmation_mode == "none":
        return False
    if confirmation_mode == "all":
        return True
    if confirmation_mode == "high_risk":
        return tool_name in {"checkout_guest", "cancel_booking",
                             "set_agency_status"}
    # writes_only: default
    return meta["write"] and not meta["auto_run"]

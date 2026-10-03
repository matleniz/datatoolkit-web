"""Drive the dtk MCP tools with the stub pack against a running dtk-api.

stdin: JSON ``[{tool, args}]``; stdout: JSON ``[{tool, is_error, result}]``.
The MCP server uses ``RemoteUiPort`` (``$DTK_HOME/agent/runtime.json``), so
each UI tool goes MCP server -> policy -> audit -> /api/ui/commands -> Studio.
"""

import asyncio
import json
import sys

from dtk_engine.agent.policy import AuditLog
from dtk_engine.agent.ports import RemoteUiPort
from dtk_engine.agent.packs.stub import PACK
from dtk_engine.agent.server import build_server


async def main() -> None:
    script = json.load(sys.stdin)
    audit = AuditLog()
    out = await PACK.run_script(build_server(RemoteUiPort(), audit), script)
    print(json.dumps({"results": out, "audit": audit.entries()}))


asyncio.run(main())

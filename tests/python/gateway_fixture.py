"""Local tests only: real FastAPI gateway, with only Anthropic HTTP mocked."""
import json
import re
import httpx
from api import ai

async def provider(request):
    payload = json.loads(request.content)
    latest = payload["messages"][-1]["content"]
    context = latest[0]["text"]
    tempo = re.search(r"(\d+) BPM", context)
    history = json.dumps(payload["messages"])
    text = ("Ada, " if "Ada" in history else "") + "the project is at " + (tempo.group(1) if tempo else "?") + " BPM."
    return httpx.Response(200, json={"model": "local-fixture-not-Claude", "stop_reason": "end_turn",
        "content": [{"type": "text", "text": text}], "usage": {"input_tokens": 50, "output_tokens": 15}})

ai.http_client = lambda: httpx.AsyncClient(transport=httpx.MockTransport(provider))
app = ai.app

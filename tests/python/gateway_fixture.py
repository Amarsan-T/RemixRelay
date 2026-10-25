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
    if "dreamy" in latest[1]["text"].lower():
        # A canned coaching reply with one suggestion the project can't hold, to check it is left out.
        text = "Long, soft notes in a major key sound dreamy.\n<note-suggestions>" + json.dumps({
            "summary": "Dreamy lead", "items": [
                {"action": "add", "channel": "Retro Lead", "pattern": 1, "step": 1, "note": "E4", "length": 4, "why": "A long note feels calm"},
                {"action": "add", "channel": "Retro Lead", "pattern": 1, "step": 5, "note": "G4", "length": 4, "why": "Rises gently"},
                {"action": "add", "channel": "Retro Lead", "pattern": 1, "step": 60, "note": "C6", "length": 2, "why": "A bright sparkle at the end"},
                {"action": "add", "channel": "Kick 808", "pattern": 1, "step": 1, "why": "A soft pulse"},
                {"action": "add", "channel": "Missing Synth", "pattern": 1, "step": 1, "note": "C4"},
            ]}) + "</note-suggestions>"
    if "prose only" in latest[1]["text"].lower():
        # The reliability bug: exact steps described in prose, with no block to apply.
        text = "Put the kick on steps 1, 5, 9 and 13 of pattern 2 for a steady pulse."
    if "note suggestions i can show and apply" in latest[1]["text"].lower():
        # The follow-up returns the same idea in the natural block-first form.
        text = "<note_suggestions>" + json.dumps({"summary": "Kick pulse", "items": [
            {"action": "add", "channel": "Kick", "pattern": 2, "steps": [1, 5, 9, 13], "note": "C1", "why": "A steady pulse"},
        ]}) + "</note_suggestions>\nHere are those kick steps, ready to apply."
    return httpx.Response(200, json={"model": "local-fixture-not-Claude", "stop_reason": "end_turn",
        "content": [{"type": "text", "text": text}], "usage": {"input_tokens": 50, "output_tokens": 15}})

ai.http_client = lambda: httpx.AsyncClient(transport=httpx.MockTransport(provider))
app = ai.app

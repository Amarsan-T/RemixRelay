"""Authenticated, stateless Claude gateway. Convex remains the durable authority."""
import asyncio
import hashlib
import hmac
import json
import os
import re
import time
from collections import OrderedDict
from typing import Literal

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictStr, model_validator

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, redirect_slashes=False)
MAX_BODY_BYTES = 196608
MAX_TOKENS = 4096
TIMEOUT_SECONDS = 55
CACHE_SECONDS = 300
CACHE_SIZE = 128
MAX_IN_FLIGHT = 4
# Completed and in-flight replay protection is process-local. Cross-instance
# authority is Convex's durable claim; this is not a distributed billing lock.
_cache = OrderedDict()
_inflight = {}


def failure(code, status=502, request_id=None, retry_after=None):
    body = {"status": "error", "error": {"code": code, "retryable": code in {
        "busy", "timeout", "network", "upstream", "rate_limit"
    }}}
    if request_id:
        body["requestId"] = request_id
    headers = {"cache-control": "no-store"}
    if retry_after is not None:
        headers["retry-after"] = str(retry_after)
    return JSONResponse(body, status_code=status, headers=headers)


@app.middleware("http")
async def protect(request: Request, call_next):
    if request.url.path == "/api/ai" and request.method == "POST":
        expected = os.environ.get("AI_SERVICE_TOKEN", "")
        if len(expected) < 32 or re.search(r"\s", expected):
            return failure("configuration", 503)
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied.encode(), ("Bearer " + expected).encode()):
            return failure("unauthorized", 401)
        if request.headers.get("content-type", "").split(";")[0].lower() != "application/json":
            return failure("invalid_request", 415)
        try:
            if int(request.headers.get("content-length", "0")) > MAX_BODY_BYTES:
                return failure("invalid_request", 413)
        except ValueError:
            return failure("invalid_request", 400)
        # Check before parsing or validation. Never echo submitted input/errors.
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_BODY_BYTES:
                return failure("invalid_request", 413)
            chunks.append(chunk)
        request._body = b"".join(chunks)
    response = await call_next(request)
    response.headers["cache-control"] = "no-store"
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(_request, _error):
    return failure("invalid_request", 422)


class Turn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    role: Literal["user", "assistant"]
    content: StrictStr = Field(min_length=1, max_length=6006)


class Inquiry(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    requestId: StrictStr = Field(pattern=r"^[A-Za-z0-9_:-]{8,128}$")
    systemPrompt: StrictStr = Field(min_length=1, max_length=5000)
    projectContext: StrictStr = Field(min_length=1, max_length=9000)
    history: list[Turn] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def bounded_conversation(self):
        if self.history[0].role != "user" or self.history[-1].role != "user":
            raise ValueError("History must start and finish with the user")
        if len(self.history[-1].content) > 2000 or sum(len(t.content) for t in self.history) > 24000:
            raise ValueError("Conversation exceeds its budget")
        return self


def provider_code(status, detail):
    # Classify privately; neither provider bodies nor credentials reach logs/UI.
    message = str(detail).lower()
    if re.search(r"credit balance|insufficient (?:credit|fund)|billing|spend(?:ing)? limit|purchase credits", message):
        return "billing"
    if "workspace" in message:
        return "workspace"
    if status in (401, 403):
        return "provider_auth"
    if status == 429:
        return "rate_limit"
    if status == 404 or (status == 400 and "model" in message):
        return "model"
    if status == 400 and re.search(r"fallback|beta|effort|output_config|thinking|max_tokens", message):
        return "settings"
    return "invalid_request" if status == 400 else "upstream"


def http_client():
    return httpx.AsyncClient(timeout=httpx.Timeout(50, connect=5), follow_redirects=False, trust_env=False)


async def call_claude(inquiry):
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        return failure("configuration", 503, inquiry.requestId)
    model = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5").strip()
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", model):
        return failure("configuration", 503, inquiry.requestId)
    messages = [turn.model_dump() for turn in inquiry.history]
    messages[-1]["content"] = [
        {"type": "text", "text": "<project>\n" + inquiry.projectContext + "\n</project>"},
        {"type": "text", "text": inquiry.history[-1].content},
    ]
    payload = {"model": model, "max_tokens": MAX_TOKENS, "system": inquiry.systemPrompt, "messages": messages}
    if model in {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}:
        payload["output_config"] = {"effort": "low"}
    # Do not auto-fallback to another paid model or automatically retry a POST.
    headers = {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    workspace = os.environ.get("ANTHROPIC_WORKSPACE_ID", "").strip()
    if workspace:
        headers["anthropic-workspace-id"] = workspace
    try:
        async with asyncio.timeout(TIMEOUT_SECONDS):
            async with http_client() as client:
                async with client.stream("POST", "https://api.anthropic.com/v1/messages", json=payload, headers=headers) as response:
                    raw = bytearray()
                    async for chunk in response.aiter_bytes():
                        raw.extend(chunk)
                        if len(raw) > 262144:
                            return failure("upstream", 502, inquiry.requestId)
                    try:
                        data = json.loads(raw)
                    except (ValueError, UnicodeError):
                        data = {}
                    if response.status_code != 200:
                        detail = data.get("error", {}).get("message", "") if isinstance(data, dict) else ""
                        # Also classify non-JSON billing errors, but never return them.
                        code = provider_code(response.status_code, detail or raw.decode(errors="replace"))
                        delay = response.headers.get("retry-after", "")
                        retry_after = min(int(delay), 300) if delay.isdecimal() else None
                        return failure(code, 429 if code == "rate_limit" else 502, inquiry.requestId, retry_after)
    except (TimeoutError, httpx.TimeoutException):
        return failure("timeout", 504, inquiry.requestId)
    except httpx.HTTPError:
        return failure("network", 502, inquiry.requestId)
    if not isinstance(data, dict):
        return failure("upstream", 502, inquiry.requestId)
    if data.get("stop_reason") == "refusal":
        return failure("refusal", 422, inquiry.requestId)
    blocks = data.get("content", [])
    if not isinstance(blocks, list):
        return failure("upstream", 502, inquiry.requestId)
    text = "\n".join(b["text"] for b in blocks if isinstance(b, dict) and b.get("type") == "text" and isinstance(b.get("text"), str)).strip()
    if not text:
        return failure("empty_reply", 502, inquiry.requestId)
    if data.get("stop_reason") == "max_tokens":
        text += "\n\n[This answer was cut short.]"
    usage = data.get("usage", {})
    actual_model = data.get("model")
    if not isinstance(usage, dict) or not isinstance(actual_model, str) or len(actual_model) > 128:
        return failure("upstream", 502, inquiry.requestId)
    counts = [usage.get("input_tokens"), usage.get("output_tokens")]
    if any(type(n) is not int or n < 0 for n in counts) or counts[1] > MAX_TOKENS or len(text) > 24000:
        return failure("upstream", 502, inquiry.requestId)
    return JSONResponse({"status": "complete", "requestId": inquiry.requestId, "content": text,
                         "model": actual_model, "inputTokens": counts[0], "outputTokens": counts[1]})


@app.get("/api/ai")
async def health():
    # Free liveness only; does not disclose environment presence or call Claude.
    return {"service": "remixrelay-ai", "runtime": "python", "status": "ok"}


@app.post("/api/ai")
async def answer(inquiry: Inquiry):
    now = time.monotonic()
    for key, entry in list(_cache.items()):
        if entry[0] < now:
            del _cache[key]
    digest = hashlib.sha256(inquiry.model_dump_json().encode()).hexdigest()
    previous = _cache.get(inquiry.requestId) or _inflight.get(inquiry.requestId)
    if previous:
        if previous[1] != digest:
            return failure("conflict", 409, inquiry.requestId)
        if inquiry.requestId in _cache:
            return previous[2]
        return await asyncio.shield(previous[2])
    if len(_inflight) >= MAX_IN_FLIGHT:
        return failure("busy", 503, inquiry.requestId, 5)

    async def generate():
        try:
            response = await call_claude(inquiry)
        except Exception:
            # Safe error boundary: no raw exception/provider data in response.
            response = failure("upstream", 502, inquiry.requestId)
        _cache[inquiry.requestId] = (time.monotonic() + CACHE_SECONDS, digest, response)
        while len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
        _inflight.pop(inquiry.requestId, None)
        return response

    task = asyncio.create_task(generate())
    _inflight[inquiry.requestId] = (now, digest, task)
    return await asyncio.shield(task)

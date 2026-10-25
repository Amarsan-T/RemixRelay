import asyncio
import copy
import json
import os
import unittest
from unittest.mock import patch

import httpx
from api import ai

TOKEN = "test-only-service-token-" + "x" * 40
BODY = {"requestId": "reply_test:1", "systemPrompt": "You are a music assistant.",
        "projectContext": "Project: test. 97 BPM. Bass plays C3.",
        "history": [{"role": "user", "content": "My name is Ada. What is my tempo?"}]}


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, {"AI_SERVICE_TOKEN": TOKEN, "ANTHROPIC_API_KEY": "test-private-key",
                                         "ANTHROPIC_WORKSPACE_ID": "", "CLAUDE_MODEL": "claude-opus-5-5"})
        self.env.start()
        ai._cache.clear()
        ai._inflight.clear()
        self.calls = []
        self.provider_status = 200
        self.provider_body = None
        self.delay = 0
        self.transport_error = None

        async def provider(request):
            self.calls.append(request)
            if self.transport_error:
                raise self.transport_error
            if self.delay:
                await asyncio.sleep(self.delay)
            body = self.provider_body
            if body is None:
                body = {"model": "claude-opus-5-5", "stop_reason": "end_turn",
                        "content": [{"type": "text", "text": "Ada, your song is at 97 BPM."}],
                        "usage": {"input_tokens": 100, "output_tokens": 12}}
            if isinstance(body, str):
                return httpx.Response(self.provider_status, text=body, headers={"retry-after": "9"})
            return httpx.Response(self.provider_status, json=body, headers={"retry-after": "9"})

        self.factory = patch.object(ai, "http_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(provider)))
        self.factory.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=ai.app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        self.factory.stop()
        self.env.stop()

    async def send(self, body=None, token=TOKEN, **kwargs):
        return await self.client.post("/api/ai", json=body or BODY,
                                      headers={"authorization": "Bearer " + token}, **kwargs)

    async def test_authentication_precedes_parsing_and_provider_call(self):
        for token in ["", "wrong", TOKEN + "wrong"]:
            response = await self.send(token=token)
            self.assertEqual(response.status_code, 401)
            self.assertNotIn("test-private-key", response.text)
        bad_json = await self.client.post("/api/ai", content="{", headers={"content-type": "application/json"})
        self.assertEqual(bad_json.status_code, 401)
        self.assertEqual(self.calls, [])

    async def test_missing_or_weak_service_token_fails_closed(self):
        for token in ["", "short", "x" * 32 + " bad"]:
            os.environ["AI_SERVICE_TOKEN"] = token
            self.assertEqual((await self.send()).status_code, 503)
        self.assertEqual(self.calls, [])

    async def test_success_context_memory_and_workspace_are_server_side(self):
        os.environ["ANTHROPIC_WORKSPACE_ID"] = " wrkspc_test "
        body = copy.deepcopy(BODY)
        body["history"] += [{"role": "assistant", "content": "Hello Ada."}, {"role": "user", "content": "Remember my name?"}]
        response = await self.send(body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "complete")
        self.assertEqual(response.json()["inputTokens"], 100)
        request = self.calls[0]
        self.assertEqual(str(request.url), "https://api.anthropic.com/v1/messages")
        self.assertEqual(request.headers["anthropic-workspace-id"], "wrkspc_test")
        payload = json.loads(request.content)
        self.assertEqual(payload["max_tokens"], 4096)
        self.assertEqual(payload["model"], "claude-opus-5-5")
        self.assertEqual(payload["output_config"]["effort"], "low")
        self.assertNotIn("fallbacks", payload)
        self.assertIn("Ada", payload["messages"][0]["content"])
        self.assertIn("97 BPM", payload["messages"][-1]["content"][0]["text"])
        self.assertEqual(payload["messages"][-1]["content"][1]["text"], "Remember my name?")
        self.assertNotIn(TOKEN, request.content.decode())
        self.assertNotIn("test-private-key", response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")

    async def test_custom_model_is_server_controlled(self):
        os.environ["CLAUDE_MODEL"] = "custom-model"
        await self.send()
        payload = json.loads(self.calls[0].content)
        self.assertEqual(payload["model"], "custom-model")
        self.assertNotIn("output_config", payload)
        body = {**BODY, "requestId": "different:1", "model": "expensive-unapproved"}
        self.assertEqual((await self.send(body)).status_code, 422)

    async def test_bounded_payload_validation_never_echoes_input(self):
        cases = [
            {**BODY, "projectContext": "x" * 9001},
            {**BODY, "systemPrompt": "x" * 5001},
            {**BODY, "history": [{"role": "system", "content": "secret-marker"}]},
            {**BODY, "history": [{"role": "user", "content": "x" * 2001}]},
            {**BODY, "history": [{"role": "user", "content": "secret-marker"}] * 21},
            {**BODY, "history": [{"role": "user", "content": "x" * 6000}] * 4 + [{"role": "user", "content": "tail"}]},
            {**BODY, "history": [{"role": "assistant", "content": "secret-marker"}]},
            {**BODY, "requestId": "../bad"},
            {**BODY, "extra": "secret-marker"},
        ]
        for body in cases:
            response = await self.send(body)
            self.assertEqual(response.status_code, 422)
            self.assertNotIn("secret-marker", response.text)
        self.assertEqual(self.calls, [])

    async def test_large_and_invalid_json_rejected_without_provider(self):
        response = await self.client.post("/api/ai", content="x" * (ai.MAX_BODY_BYTES + 1),
                                          headers={"authorization": "Bearer " + TOKEN, "content-type": "application/json"})
        self.assertEqual(response.status_code, 413)
        response = await self.client.post("/api/ai", content="{",
                                          headers={"authorization": "Bearer " + TOKEN, "content-type": "application/json"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.calls, [])

    async def test_concurrent_and_completed_replays_make_one_provider_request(self):
        self.delay = 0.03
        responses = await asyncio.gather(*[self.send() for _ in range(4)])
        self.assertTrue(all(r.status_code == 200 for r in responses))
        self.assertEqual((await self.send()).status_code, 200)
        self.assertEqual(len(self.calls), 1)
        response = await self.send({**BODY, "projectContext": "Different project"})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(len(self.calls), 1)

    async def test_failed_replay_does_not_silently_bill_again(self):
        self.provider_status = 500
        self.provider_body = {"error": {"message": "private upstream diagnostic"}}
        await self.send()
        await self.send()
        self.assertEqual(len(self.calls), 1)
        self.assertEqual((await self.send({**BODY, "requestId": "reply_test:2"})).status_code, 502)
        self.assertEqual(len(self.calls), 2)

    async def test_errors_are_classified_without_returning_provider_bodies(self):
        cases = [(401, "API key rejected", "provider_auth"), (403, "Forbidden", "provider_auth"),
                 (429, "Slow down", "rate_limit"), (500, "private crash", "upstream"),
                 (400, "Credit balance too low", "billing"), (400, "Workspace missing", "workspace"),
                 (404, "Model not found", "model"), (400, "Invalid model", "model"),
                 (400, "Unsupported output_config", "settings"), (400, "Invalid message", "invalid_request")]
        for i, (status, message, code) in enumerate(cases):
            self.provider_status = status
            self.provider_body = {"error": {"message": message + " private-marker"}}
            response = await self.send({**BODY, "requestId": "error_" + str(i) + ":1"})
            self.assertEqual(response.json()["error"]["code"], code)
            self.assertNotIn("private-marker", response.text)
            if status == 429:
                self.assertEqual(response.headers["retry-after"], "9")
        self.assertEqual(len(self.calls), len(cases))

    async def test_non_json_billing_and_network_errors(self):
        self.provider_status = 400
        self.provider_body = "Credit balance is too low; private-provider-detail"
        response = await self.send()
        self.assertEqual(response.json()["error"]["code"], "billing")
        self.assertNotIn("private-provider-detail", response.text)
        self.transport_error = httpx.ConnectError("private transport error")
        response = await self.send({**BODY, "requestId": "network_test:1"})
        self.assertEqual(response.json()["error"]["code"], "network")
        self.transport_error = httpx.ReadTimeout("private timeout")
        response = await self.send({**BODY, "requestId": "timeout_test:1"})
        self.assertEqual(response.json()["error"]["code"], "timeout")
        self.assertEqual(len(self.calls), 3)

    async def test_missing_key_health_and_old_routes(self):
        os.environ["ANTHROPIC_API_KEY"] = ""
        self.assertEqual((await self.send()).json()["error"]["code"], "configuration")
        health = await self.client.get("/api/ai")
        self.assertEqual(health.json()["runtime"], "python")
        for path in ["/", "/api/startInquiry", "/api/aiAssist", "/docs", "/openapi.json"]:
            self.assertEqual((await self.client.post(path)).status_code, 404)
        self.assertEqual(self.calls, [])

    async def test_empty_refusal_and_truncation(self):
        for i, (content, stop, expected) in enumerate([([], "end_turn", "empty_reply"),
                                                       ([], "refusal", "refusal")]):
            self.provider_body = {"content": content, "stop_reason": stop}
            response = await self.send({**BODY, "requestId": "empty_" + str(i) + ":1"})
            self.assertEqual(response.json()["error"]["code"], expected)
        self.provider_body = {"model": "claude-opus-5-5", "content": [{"type": "text", "text": "Partial"}],
                              "stop_reason": "max_tokens", "usage": {"input_tokens": 1, "output_tokens": 4096}}
        response = await self.send({**BODY, "requestId": "truncated:1"})
        self.assertIn("[This answer was cut short.]", response.json()["content"])

    async def test_capacity_is_bounded_before_starting_more_paid_requests(self):
        self.delay = 0.1
        tasks = [asyncio.create_task(self.send({**BODY, "requestId": "active_" + str(i) + ":1"}))
                 for i in range(ai.MAX_IN_FLIGHT)]
        for _ in range(100):
            if len(ai._inflight) == ai.MAX_IN_FLIGHT:
                break
            await asyncio.sleep(0.001)
        response = await self.send({**BODY, "requestId": "over_capacity:1"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "busy")
        await asyncio.gather(*tasks)
        self.assertEqual(len(self.calls), ai.MAX_IN_FLIGHT)
        self.assertEqual(len(ai._inflight), 0)

    async def test_total_deadline_and_cache_bound(self):
        self.delay = 0.05
        with patch.object(ai, "TIMEOUT_SECONDS", 0.01):
            response = await self.send()
        self.assertEqual(response.json()["error"]["code"], "timeout")
        self.assertEqual(len(self.calls), 1)
        self.delay = 0
        with patch.object(ai, "CACHE_SIZE", 2):
            for i in range(3):
                await self.send({**BODY, "requestId": "bounded_" + str(i) + ":1"})
            self.assertEqual(len(ai._cache), 2)

    async def test_existing_history_truncation_marker_remains_compatible(self):
        body = {**BODY, "history": [
            {"role": "user", "content": "Earlier"},
            {"role": "assistant", "content": "x" * 6000 + " [...]"},
            {"role": "user", "content": "Continue"},
        ]}
        self.assertEqual((await self.send(body)).status_code, 200)


if __name__ == "__main__":
    unittest.main()

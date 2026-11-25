// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { AnsatzAiService } from "../src/services/ai/ansatz-ai.js";
import { AnthropicProvider, OpenAICompatibleProvider } from "../src/services/ai/llm-client.js";
import { LibraryStorage } from "../src/storage.js";

test("OpenAICompatibleProvider parses tool_calls and streams SSE chunks", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // 1. Non-streaming tool_calls
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: "gpt-4o-mini",
          choices: [
            {
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "ansatz_flatten", arguments: "{}" },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const provider = new OpenAICompatibleProvider("test-key", "https://api.openai.com/v1");
    const res = await provider.complete([{ role: "user", content: "Flatten this" }]);
    assert.equal(res.model, "gpt-4o-mini");
    assert.equal(res.toolCalls?.length, 1);
    assert.equal(res.toolCalls?.[0]?.name, "ansatz_flatten");

    // 2. Streaming SSE with incremental tool_calls
    const ssePayload = [
      `data: ${JSON.stringify({ model: "gpt-4o-mini", choices: [{ delta: { content: "Checking " } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_2", function: { name: "ansatz_sim", arguments: '{"a":' } }] } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "ulate", arguments: "1}" } }] } }] })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");

    globalThis.fetch = (async () =>
      new Response(ssePayload, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })) as typeof fetch;

    const chunks = [];
    for await (const chunk of provider.completeStream([{ role: "user", content: "Simulate" }])) {
      chunks.push(chunk);
    }
    assert.equal(chunks[0]?.type, "text");
    assert.equal((chunks[0] as { type: "text"; delta: string }).delta, "Checking ");
    const tcChunk = chunks.find((c) => c.type === "tool_calls") as
      | { type: "tool_calls"; toolCalls: { id?: string; name: string; arguments: Record<string, unknown> }[] }
      | undefined;
    assert.ok(tcChunk);
    assert.equal(tcChunk.toolCalls[0]?.name, "ansatz_simulate");
    assert.deepEqual(tcChunk.toolCalls[0]?.arguments, { a: 1 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AnthropicProvider parses text and tool_use blocks", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: "claude-sonnet-4-5",
          content: [
            { type: "text", text: "Running flatten." },
            { type: "tool_use", id: "toolu_1", name: "ansatz_flatten", input: {} },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const provider = new AnthropicProvider("anth-key");
    const res = await provider.complete([{ role: "user", content: "Flatten" }]);
    assert.equal(res.content, "Running flatten.");
    assert.equal(res.toolCalls?.[0]?.name, "ansatz_flatten");

    const anthropicSse = [
      `data: ${JSON.stringify({ type: "message_start", message: { model: "claude-sonnet-4-5" } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_2", name: "ansatz_simulate" } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"x":2}' } })}\n\n`,
    ].join("");

    globalThis.fetch = (async () =>
      new Response(anthropicSse, { status: 200, headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;

    const streamChunks = [];
    for await (const chunk of provider.completeStream([{ role: "user", content: "Simulate" }])) {
      streamChunks.push(chunk);
    }
    assert.equal((streamChunks[0] as { type: "text"; delta: string }).delta, "Hello ");
    const anthTc = streamChunks.find((c) => c.type === "tool_calls") as
      { type: "tool_calls"; toolCalls: { name: string; arguments: Record<string, unknown> }[] } | undefined;
    assert.equal(anthTc?.toolCalls[0]?.name, "ansatz_simulate");
    assert.deepEqual(anthTc?.toolCalls[0]?.arguments, { x: 2 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AnsatzAiService blocks external custom URLs in strict air-gap mode", async () => {
  const prevAirgap = process.env["AIRGAP_ENFORCED"];
  process.env["AIRGAP_ENFORCED"] = "true";
  try {
    const svc = new AnsatzAiService();
    await assert.rejects(
      () =>
        svc.resolveProvider({
          messages: [{ role: "user", content: "hi" }],
          providerMode: "custom",
          customProvider: {
            protocol: "openai",
            baseUrl: "https://api.openai.com/v1",
            apiKey: "sk-test",
            model: "gpt-4o-mini",
          },
        }),
      /Air-Gap Egress Blocked/,
    );
  } finally {
    if (prevAirgap === undefined) delete process.env["AIRGAP_ENFORCED"];
    else process.env["AIRGAP_ENFORCED"] = prevAirgap;
  }
});

test("GET /api/v1/ai/providers and POST /api/v1/ai/ansatz/chat work end-to-end", async () => {
  const prevOllama = process.env["OLLAMA_BASE_URL"];
  process.env["OLLAMA_BASE_URL"] = "http://127.0.0.1:1";
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ansatz-ai-test-"));
  const database = new LibraryDatabase(path.join(tmpDir, "db.sqlite"));
  const storage = new LibraryStorage(path.join(tmpDir, "storage"));
  const app = await createApp({ database, storage });

  try {
    const providersRes = await request(app).get("/api/v1/ai/providers").expect(200);
    assert.equal(typeof providersRes.body.ansatzAvailable, "boolean");
    assert.ok(Array.isArray(providersRes.body.supportedProtocols));
    assert.ok(providersRes.body.supportedProtocols.includes("openai"));
    assert.ok(providersRes.body.supportedProtocols.includes("anthropic"));

    const chatRes = await request(app)
      .post("/api/v1/ai/ansatz/chat")
      .send({
        messages: [{ role: "user", content: "Simulate a pendulum" }],
        context: { fileName: "Pendulum.mo", dialect: "modelica", code: "model Pendulum end Pendulum;" },
      })
      .expect(200);

    assert.match(chatRes.headers["content-type"] || "", /text\/event-stream/);
    assert.match(chatRes.text, /"type":"text"/);
    assert.match(chatRes.text, /"type":"done"/);
  } finally {
    if (prevOllama === undefined) delete process.env["OLLAMA_BASE_URL"];
    else process.env["OLLAMA_BASE_URL"] = prevOllama;
    database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

import express from "express";
import { mcpRouter } from "../src/routes/mcp.js";
import { createBackendMcpSession } from "../src/services/ai/ansatz-mcp-runner.js";

test("createBackendMcpSession connects to @modelscript/mcp and lists curated tools", async () => {
  const session = await createBackendMcpSession(1);
  try {
    assert.ok(session.toolNames.has("modelica_load"));
    assert.ok(session.toolNames.has("modelica_flatten"));
    assert.ok(session.toolNames.has("modelica_simulate"));
  } finally {
    await session.close();
  }
});

test("POST /api/v1/mcp handles Streamable HTTP MCP initialize request", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ansatz-mcp-http-"));
  const database = new LibraryDatabase(path.join(tmpDir, "db.sqlite"));
  const app = express();
  app.use(express.json());
  app.use("/api/v1", mcpRouter(database));

  try {
    const res = await request(app)
      .post("/api/v1/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "ansatz-test", version: "0.1.0" },
        },
      })
      .expect(200);

    assert.match(res.text, /modelscript-hub/);
  } finally {
    database.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

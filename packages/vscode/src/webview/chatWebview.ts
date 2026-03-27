// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Chat webview frontend — runs WebLLM directly in the webview main thread.
// WebLLM internally creates its own web workers for GPU inference, so the
// main thread won't freeze. The webview has a proper origin (required for
// Cache API which WebLLM uses for model file caching).
// Model files are self-hosted from the IDE server at /api/models/.

import { CreateMLCEngine, prebuiltAppConfig } from "@mlc-ai/web-llm";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const acquireVsCodeApi: () => { postMessage(msg: unknown): void; getState(): any; setState(s: any): void };
declare const MODEL_BASE_URL: string;
const vscode = acquireVsCodeApi();

// ── DOM Elements ──

const messagesEl = document.getElementById("messages") as HTMLDivElement;
const inputEl = document.getElementById("input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const statusEl = document.getElementById("model-status") as HTMLDivElement;
const progressContainer = document.getElementById("progress-container") as HTMLDivElement;
const progressBar = document.getElementById("progress-bar") as HTMLDivElement;
const progressText = document.getElementById("progress-text") as HTMLDivElement;

// ── State ──

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any = null;
let engineLoading = false;
let isGenerating = false;
const conversation: ChatMessage[] = [];
const pendingToolCalls = new Map<string, (result: unknown) => void>();

const MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";

const SYSTEM_PROMPT = `You are ModelScript AI, an expert Modelica language assistant integrated into the ModelScript IDE.

You help users with:
- Writing and debugging Modelica models, packages, functions, and connectors
- Understanding the Modelica Standard Library (MSL) components
- Setting up simulations and interpreting results
- Explaining compiler diagnostics and suggesting fixes

You have access to the following tools:
- modelscript_flatten: Flatten a Modelica class. Use: TOOL_CALL: {"tool":"modelscript_flatten","name":"ClassName"}
- modelscript_simulate: Simulate a model. Use: TOOL_CALL: {"tool":"modelscript_simulate","name":"ClassName"}
- modelscript_query: Inspect a class. Use: TOOL_CALL: {"tool":"modelscript_query","name":"ClassName"}
- modelscript_parse: Parse Modelica code. Use: TOOL_CALL: {"tool":"modelscript_parse","code":"model M end M;"}

When referencing Modelica code, use proper syntax. Be concise and helpful.
Do not use <think> tags or internal reasoning blocks. Respond directly.`;

// ── WebLLM Engine (runs in main thread, GPU inference in internal workers) ──

function getAppConfig() {
  const prebuiltModel = prebuiltAppConfig.model_list.find((m) => m.model_id === MODEL_ID);

  return {
    model_list: [
      {
        model: `${MODEL_BASE_URL}/${MODEL_ID}`,
        model_id: MODEL_ID,
        model_lib: `${MODEL_BASE_URL}/Qwen3-0.6B-q4f16_1-ctx4k_cs1k-webgpu.wasm`,
        overrides: prebuiltModel?.overrides,
      },
    ],
  };
}

async function ensureEngine(): Promise<void> {
  if (engine) return;
  if (engineLoading) {
    while (engineLoading) await new Promise((r) => setTimeout(r, 200));
    return;
  }

  engineLoading = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any;
    if (!nav.gpu) throw new Error("WebGPU not available");
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter found");

    progressContainer.style.display = "block";
    progressText.textContent = "Downloading model (~336 MB, cached after first time)...";
    statusEl.textContent = "Loading...";

    engine = await CreateMLCEngine(MODEL_ID, {
      appConfig: getAppConfig(),
      initProgressCallback: (report: { text: string; progress: number }) => {
        const pct = Math.round(report.progress * 100);
        progressBar.style.width = pct + "%";
        progressText.textContent = report.text;
        statusEl.textContent = `Loading ${pct}%`;
      },
    });

    progressContainer.style.display = "none";
    statusEl.textContent = "Qwen3-0.6B ready";
  } catch (e) {
    progressContainer.style.display = "none";
    statusEl.textContent = "Error";
    throw e;
  } finally {
    engineLoading = false;
  }
}

// ── Message UI ──

function addMessage(role: "user" | "assistant" | "tool", content: string): HTMLElement {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  if (role === "assistant" || role === "tool") {
    div.innerHTML = formatContent(content);
  } else {
    div.textContent = content;
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

function formatContent(text: string): string {
  let html = stripThinkTags(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>");
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background:var(--vscode-textCodeBlock-background,#1a1a1a);padding:1px 4px;border-radius:3px;">$1</code>',
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return html;
}

function addTypingIndicator(): HTMLElement {
  const div = document.createElement("div");
  div.className = "msg assistant typing";
  div.innerHTML = "<span></span><span></span><span></span>";
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

// ── Tool call relay (via extension host to LSP) ──

function requestToolCall(tool: string, input: Record<string, unknown>): Promise<unknown> {
  const id = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    pendingToolCalls.set(id, resolve);
    vscode.postMessage({ type: "toolCall", id, tool, input });
  });
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "toolResult":
      if (pendingToolCalls.has(msg.id)) {
        pendingToolCalls.get(msg.id)?.(msg.result);
        pendingToolCalls.delete(msg.id);
      }
      break;
    case "activeFileContext":
      if (msg.content) {
        conversation.push({
          role: "system",
          content: `The user currently has the file "${msg.fileName}" open:\n\`\`\`modelica\n${msg.content}\n\`\`\``,
        });
      }
      break;
  }
});

// ── Chat Logic ──

async function sendMessage(): Promise<void> {
  const text = inputEl.value.trim();
  if (!text || isGenerating) return;

  isGenerating = true;
  inputEl.value = "";
  inputEl.style.height = "36px";
  sendBtn.disabled = true;

  addMessage("user", text);
  conversation.push({ role: "user", content: text });

  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...conversation];

  const typingEl = addTypingIndicator();

  try {
    await ensureEngine();

    const completion = await engine.chat.completions.create({
      messages,
      temperature: 0.7,
      max_tokens: 4096,
      stream: false,
    });

    typingEl.remove();
    const resultText = completion.choices?.[0]?.message?.content ?? "";

    addMessage("assistant", resultText);
    conversation.push({ role: "assistant", content: resultText });

    // Check for tool calls in the response
    const toolCallMatch = resultText.match(/TOOL_CALL:\s*(\{[\s\S]*?\})/);
    if (toolCallMatch) {
      try {
        const toolReq = JSON.parse(toolCallMatch[1]);
        const toolName = toolReq.tool;
        delete toolReq.tool;

        addMessage("tool", `🔧 Calling ${toolName}...`);
        const toolResult = await requestToolCall(toolName, toolReq);
        const resultStr = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2);
        addMessage("tool", resultStr);

        conversation.push({
          role: "user",
          content: `Tool result for ${toolName}:\n${resultStr}\n\nPlease analyze the result and respond.`,
        });

        const followUpTyping = addTypingIndicator();
        const followUp = await engine.chat.completions.create({
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...conversation],
          temperature: 0.7,
          max_tokens: 4096,
          stream: false,
        });
        followUpTyping.remove();

        const followUpText = followUp.choices?.[0]?.message?.content ?? "";
        addMessage("assistant", followUpText);
        conversation.push({ role: "assistant", content: followUpText });
      } catch (toolErr) {
        addMessage("tool", `⚠️ Tool error: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`);
      }
    }
  } catch (e) {
    typingEl.remove();
    addMessage("assistant", `⚠️ Error: ${e instanceof Error ? e.message : String(e)}`);
  }

  isGenerating = false;
  sendBtn.disabled = false;
  inputEl.focus();
}

// ── Event Listeners ──

sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
inputEl.addEventListener("input", () => {
  inputEl.style.height = "36px";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
});

// ── Initialize ──

inputEl.disabled = false;
sendBtn.disabled = false;
inputEl.focus();

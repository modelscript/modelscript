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

// Workspace context (updated automatically by extension host)
let activeFileName: string | null = null;
let activeFileContent: string | null = null;

const MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";

const SYSTEM_PROMPT = `You are ModelScript AI, a Modelica language assistant. Answer questions about Modelica code concisely. When the user provides code context, base your answer on that specific code. Do not use <think> tags.`;

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
  // Strip complete <think>...</think> blocks
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
  // Strip incomplete <think> blocks (no closing tag, model was cut off)
  cleaned = cleaned.replace(/<think>[\s\S]*/g, "");
  return cleaned.trim();
}

function formatContent(text: string): string {
  let html = stripThinkTags(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>");
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background:var(--vscode-textCodeBlock-background,#1a1a1a);padding:1px 4px;border-radius:3px;">$1</code>',
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Display math: $$...$$
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_m, expr) => `<div class="math-block">${renderLatex(expr)}</div>`);
  // Inline math: $...$
  html = html.replace(/\$([^$\n]+)\$/g, (_m, expr) => `<span class="math-inline">${renderLatex(expr)}</span>`);
  return html;
}

function renderLatex(expr: string): string {
  let text = expr.trim();
  // \frac{a}{b} → a/b
  text = text.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1)/($2)");
  // \text{...} → ...
  text = text.replace(/\\text\{([^}]+)\}/g, "$1");
  // \cdot → ·
  text = text.replace(/\\cdot/g, "·");
  // \times → ×
  text = text.replace(/\\times/g, "×");
  // \leq, \geq, \neq
  text = text.replace(/\\leq/g, "≤").replace(/\\geq/g, "≥").replace(/\\neq/g, "≠");
  // \sum, \prod, \int
  text = text
    .replace(/\\sum/g, "∑")
    .replace(/\\prod/g, "∏")
    .replace(/\\int/g, "∫");
  // \infty → ∞
  text = text.replace(/\\infty/g, "∞");
  // \sqrt{x} → √(x)
  text = text.replace(/\\sqrt\{([^}]+)\}/g, "√($1)");
  // \partial → ∂
  text = text.replace(/\\partial/g, "∂");
  // d(...)/dt style: keep as-is
  // Remove remaining backslashes from unknown commands
  text = text.replace(/\\([a-zA-Z]+)/g, "$1");
  return text;
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
      activeFileName = msg.fileName ?? null;
      activeFileContent = msg.content ?? null;
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

  // Show what the user typed, but send augmented version with context to the model
  addMessage("user", text);

  // Build the augmented user message with workspace context prepended
  let augmentedText = "";
  if (activeFileName && activeFileContent) {
    const lines = activeFileContent.split("\n");
    const truncated = lines.length > 25 ? lines.slice(0, 25).join("\n") + "\n// ..." : activeFileContent;
    augmentedText += `Here is the code from "${activeFileName}" currently open in the editor:\n${truncated}\n\n`;
  }
  augmentedText += text;

  conversation.push({ role: "user", content: augmentedText });
  console.log("[chat] context:", { activeFile: activeFileName, hasContent: !!activeFileContent });

  // Build messages: short system prompt + conversation with augmented user messages
  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...conversation];

  const typingEl = addTypingIndicator();

  try {
    await ensureEngine();

    const completion = await engine.chat.completions.create({
      messages,
      temperature: 0.7,
      max_tokens: 2048,
      stream: false,
    });

    let rawText = completion.choices?.[0]?.message?.content ?? "";
    let finishReason = completion.choices?.[0]?.finish_reason ?? "stop";
    let visibleText = stripThinkTags(rawText);

    // If the model only produced <think> content, retry once with a direct instruction
    if (!visibleText) {
      statusEl.textContent = "Retrying...";
      const retryMessages = [
        { role: "system" as const, content: "Answer directly and concisely. No reasoning tags." },
        ...conversation,
      ];
      const retry = await engine.chat.completions.create({
        messages: retryMessages,
        temperature: 0.5,
        max_tokens: 2048,
        stream: false,
      });
      rawText = retry.choices?.[0]?.message?.content ?? "";
      finishReason = retry.choices?.[0]?.finish_reason ?? "stop";
      visibleText = stripThinkTags(rawText);
    }

    // If truncated (finish_reason="length"), try one continuation with stripped content
    if (finishReason === "length" && visibleText) {
      statusEl.textContent = "Continuing...";
      const contMessages = [
        ...messages,
        { role: "assistant" as const, content: visibleText },
        { role: "user" as const, content: "Continue." },
      ];
      const cont = await engine.chat.completions.create({
        messages: contMessages,
        temperature: 0.7,
        max_tokens: 2048,
        stream: false,
      });
      const contChunk = stripThinkTags(cont.choices?.[0]?.message?.content ?? "");
      if (contChunk) {
        visibleText += " " + contChunk;
        rawText += cont.choices?.[0]?.message?.content ?? "";
      }
    }

    typingEl.remove();
    statusEl.textContent = "Qwen3-0.6B ready";

    if (visibleText) {
      addMessage("assistant", visibleText);
    } else {
      addMessage("assistant", "I couldn't generate a response. Try a shorter or more specific question.");
    }

    conversation.push({ role: "assistant", content: visibleText || rawText });

    // Check for tool calls in the response
    const toolCallMatch = visibleText.match(/TOOL_CALL:\s*(\{[\s\S]*?\})/);
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

// Request workspace context now that the script is loaded
vscode.postMessage({ type: "getActiveFileContext" });

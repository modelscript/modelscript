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

const SYSTEM_PROMPT = `You are ModelScript AI, an expert Modelica assistant.
To invoke actions contextually, you MUST output exactly this raw text format (do not use markdown code blocks):
TOOL_CALL: {"tool": "TOOL_NAME", "input": {"arg1": "value"}}

Available tools:
- modelscript_add_component: Insert a component. Input: {"className": "...", "classKind": "model"}. Use when asked to add a component.
- modelscript_simulate_and_plot: Run simulation and plot results dynamically. Input: {}. Use when asked to simulate or plot.
- modelscript_query: Print internal class hierarchy. Input: {"name": "..."}
- modelscript_parse: Syntax-check code. Input: {"code": "..."}

Do not use <think> tags. Base your answers concisely on the context provided.`;

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
  // Switch from centered empty state to normal chat layout
  document.body.classList.remove("empty");

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
  if (!text) return "";
  let displayText = text;
  const tcIdx = displayText.indexOf("TOOL_CALL:");
  if (tcIdx !== -1) {
    displayText = displayText.substring(0, tcIdx);
  }

  let html = displayText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>");
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background:var(--vscode-textCodeBlock-background,#1a1a1a);padding:1px 4px;border-radius:3px;">$1</code>',
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_m, expr) => `<div class="math-block">${renderLatex(expr)}</div>`);
  html = html.replace(/\$([^$\n]+)\$/g, (_m, expr) => `<span class="math-inline">${renderLatex(expr)}</span>`);
  html = html.replace(/\n/g, "<br>");

  const thinkRegex = /&lt;think&gt;([\s\S]*?)(?:&lt;\/think&gt;|$)/;
  const match = html.match(thinkRegex);

  let thinkHtml = "";
  if (match) {
    const isClosed = html.includes("&lt;/think&gt;");
    const content = match[1];
    const summary = isClosed ? "Thought Process" : 'Thinking<span class="animated-ellipsis"></span>';
    thinkHtml = `<details class="think-block"><summary>${summary}</summary><div class="think-content">${content}</div></details>`;
    html = html.replace(thinkRegex, "");
  }

  if (html.trim()) {
    html = `<div class="response-block" style="align-self: stretch;">${html}</div>`;
  }

  return thinkHtml + html;
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
  inputEl.style.height = "28px";
  sendBtn.disabled = true;

  // Show what the user typed
  addMessage("user", text);

  conversation.push({ role: "user", content: text });

  // Prune history to keep only the last 6 turns (3 exchanges)
  if (conversation.length > 6) {
    conversation.splice(0, conversation.length - 6);
  }

  console.log("[chat] context:", { activeFile: activeFileName, hasContent: !!activeFileContent });

  // Dynamically inject the active file context into the system prompt (not the conversation history)
  let dynamicSystemPrompt = SYSTEM_PROMPT;
  if (activeFileName && activeFileContent) {
    const lines = activeFileContent.split("\n");
    const truncated = lines.length > 25 ? lines.slice(0, 25).join("\n") + "\n// ..." : activeFileContent;
    dynamicSystemPrompt += `\n\nActive file "${activeFileName}":\n\`\`\`modelica\n${truncated}\n\`\`\``;
  }

  // Build messages: dynamic system prompt + conversation
  const messages: ChatMessage[] = [{ role: "system", content: dynamicSystemPrompt }, ...conversation];

  const typingEl = addTypingIndicator();

  try {
    await ensureEngine();

    const completion = await engine.chat.completions.create({
      messages,
      temperature: 0.7,
      max_tokens: 2048,
      stream: true,
    });

    typingEl.remove();
    const msgEl = addMessage("assistant", "Thinking...");

    let rawText = "";
    let finishReason = "stop";

    for await (const chunk of completion) {
      rawText += chunk.choices[0]?.delta?.content || "";
      if (chunk.choices[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
      if (rawText) {
        msgEl.innerHTML = formatContent(rawText);
      } else {
        msgEl.innerHTML = 'Thinking<span class="animated-ellipsis"></span>';
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

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
        stream: true,
      });

      rawText = "";
      for await (const chunk of retry) {
        rawText += chunk.choices[0]?.delta?.content || "";
        if (rawText) {
          msgEl.innerHTML = formatContent(rawText);
        } else {
          msgEl.innerHTML = 'Thinking<span class="animated-ellipsis"></span>';
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }
      finishReason = "stop"; // Reset finish reason for retry
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
        stream: true,
      });

      let contRaw = "";
      for await (const chunk of cont) {
        contRaw += chunk.choices[0]?.delta?.content || "";
        if (contRaw) {
          msgEl.innerHTML = formatContent(rawText + " " + contRaw);
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      const contChunk = stripThinkTags(contRaw);
      if (contChunk) {
        visibleText += " " + contChunk;
        rawText += contRaw;
      }
    }

    statusEl.textContent = "Qwen3-0.6B ready";

    if (!visibleText) {
      msgEl.innerHTML = "I couldn't generate a response. Try a shorter or more specific question.";
    }

    conversation.push({ role: "assistant", content: visibleText || rawText });

    // Check for tool calls in the response
    const toolCallIndex = visibleText.indexOf("TOOL_CALL:");
    if (toolCallIndex !== -1) {
      try {
        const jsonStart = visibleText.indexOf("{", toolCallIndex);
        let jsonStr = "";

        if (jsonStart !== -1) {
          let braceCount = 0;
          let jsonEnd = jsonStart;
          for (let i = jsonStart; i < visibleText.length; i++) {
            if (visibleText[i] === "{") braceCount++;
            else if (visibleText[i] === "}") braceCount--;

            if (braceCount === 0) {
              jsonEnd = i;
              break;
            }
          }
          if (braceCount === 0) {
            jsonStr = visibleText.substring(jsonStart, jsonEnd + 1);
          }
        }

        if (!jsonStr) {
          throw new Error("Could not find properly closed JSON object for tool call.");
        }

        const toolReq = JSON.parse(jsonStr);
        const toolName = toolReq.tool;
        const toolInput = toolReq.input || {};

        const callMsgEl = addMessage("tool", "");
        callMsgEl.style.width = "100%";
        callMsgEl.style.alignSelf = "stretch";
        callMsgEl.style.display = "block";
        callMsgEl.classList.remove("tool");
        callMsgEl.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px; opacity: 0.8; font-size: 12px; margin: 2px 0;">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zm.5 12.5h-1v-5h1v5zm0-6h-1v-1h1v1z"/></svg>
            <span>Action: <b>${toolName}</b></span>
          </div>
        `;

        const toolResult = (await requestToolCall(toolName, toolInput)) as Record<string, unknown>;
        const resultStr = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2);

        if (toolResult && toolResult.action === "Edited" && toolResult.file) {
          callMsgEl.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.1)); border-radius: 4px; padding: 4px 8px; font-size: 12.5px; font-family: var(--vscode-font-family, system-ui, sans-serif); margin: 2px 0; width: 100%; box-sizing: border-box;">
              <svg style="opacity: 0.7;" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.8 4.7l-3.5-3.5A1 1 0 0 0 9.6 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V5.4a1 1 0 0 0-.2-.7zM10 2.4L12.6 5H10V2.4zM13 14H3V2h6v4h4v8z"/>
              </svg>
              <span style="opacity: 0.9; font-weight: 500;">${toolName}</span>
              <span style="color: var(--vscode-descriptionForeground); font-family: monospace; font-size: 11.5px;">${toolResult.file}</span>
              <span style="margin-left: auto; color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b);">+${toolResult.added || 0}</span>
              <span style="color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); margin-left: 4px;">-${toolResult.deleted || 0}</span>
            </div>
          `;
        } else {
          callMsgEl.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.1)); border-radius: 4px; padding: 4px 8px; font-size: 12.5px; margin: 2px 0; width: 100%; box-sizing: border-box;">
              <svg style="opacity: 0.7;" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zm.5 12.5h-1v-5h1v5zm0-6h-1v-1h1v1z"/></svg>
              <span style="opacity: 0.9; font-weight: 500;">${toolName}</span>
              <span style="margin-left: auto; font-family: monospace; opacity: 0.6; font-size: 11px;">Success</span>
            </div>
          `;
        }

        conversation.push({
          role: "user",
          content: `Tool result for ${toolName}:\n${resultStr}\n\nPlease analyze the result and respond.`,
        });

        const followUpTyping = addTypingIndicator();
        const followUp = await engine.chat.completions.create({
          messages: [{ role: "system", content: dynamicSystemPrompt }, ...conversation],
          temperature: 0.7,
          max_tokens: 4096,
          stream: true,
        });
        followUpTyping.remove();

        const followUpMsgEl = addMessage("assistant", "Thinking...");
        let followUpRaw = "";
        for await (const chunk of followUp) {
          followUpRaw += chunk.choices[0]?.delta?.content || "";
          if (followUpRaw) {
            followUpMsgEl.innerHTML = formatContent(followUpRaw);
          } else {
            followUpMsgEl.innerHTML = 'Thinking<span class="animated-ellipsis"></span>';
          }
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        const followUpText = stripThinkTags(followUpRaw) || followUpRaw;
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
  inputEl.style.height = "28px";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
});

// ── Initialize ──

inputEl.disabled = false;
sendBtn.disabled = false;
inputEl.focus();

// Request workspace context now that the script is loaded
vscode.postMessage({ type: "getActiveFileContext" });

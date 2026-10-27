// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Chat webview frontend — runs WebLLM directly in the webview main thread.
// WebLLM internally creates its own web workers for GPU inference, so the
// main thread won't freeze. The webview has a proper origin (required for
// Cache API which WebLLM uses for model file caching).
// Model files are self-hosted from the IDE server at /api/models/.

import { CreateMLCEngine, prebuiltAppConfig } from "@mlc-ai/web-llm";

declare const acquireVsCodeApi: () => {
  postMessage(msg: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(s: T): T;
};
declare const MODEL_BASE_URL: string;
declare const OLLAMA_BASE_URL: string | undefined;
declare const OLLAMA_MODEL: string | undefined;
const vscode = acquireVsCodeApi();

// ── DOM Elements ──

const messagesEl = document.getElementById("messages") as HTMLDivElement;
const inputEl = document.getElementById("input") as HTMLTextAreaElement;
const sendBtn = document.getElementById("send-btn") as HTMLButtonElement;
const statusEl = document.getElementById("model-status") as HTMLDivElement;
const progressContainer = document.getElementById("progress-container") as HTMLDivElement;
const progressBar = document.getElementById("progress-bar") as HTMLDivElement;
const progressText = document.getElementById("progress-text") as HTMLDivElement;
const modelProviderSelect = document.getElementById("model-provider-select") as HTMLSelectElement | null;

// ── State ──

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface NativeToolCall {
  id?: string | undefined;
  function?:
    | {
        name?: string | undefined;
        arguments?: string | Record<string, unknown> | undefined;
      }
    | undefined;
}

interface CompletionChunk {
  content?: string | undefined;
  finish_reason?: string | null | undefined;
  tool_calls?: NativeToolCall[] | undefined;
}

interface ChatCompletionChunkChoice {
  delta?:
    | {
        content?: string | null | undefined;
        tool_calls?: NativeToolCall[] | undefined;
      }
    | undefined;
  finish_reason?: string | null | undefined;
  message?:
    | {
        content?: string | null | undefined;
      }
    | undefined;
}

interface ChatCompletionStreamChunk {
  choices: ChatCompletionChunkChoice[];
}

interface MLCEngineLike {
  chat: {
    completions: {
      create(
        params: Record<string, unknown>,
      ): Promise<AsyncIterable<ChatCompletionStreamChunk> & { choices?: ChatCompletionChunkChoice[] | undefined }>;
    };
  };
}

interface PendingCloudStream {
  onChunk: (chunk: CompletionChunk) => void;
  onError: (err: Error) => void;
  onEnd: () => void;
}

let engine: MLCEngineLike | null = null;
let engineLoading = false;
let isGenerating = false;
let currentProvider = modelProviderSelect?.value || "webgpu";
const conversation: ChatMessage[] = [];
const pendingToolCalls = new Map<string, (result: unknown) => void>();
const pendingCloudStreams = new Map<string, PendingCloudStream>();

// Workspace context (updated automatically by extension host)
let activeFileName: string | null = null;
let activeFileContent: string | null = null;
let activeSelectedText: string | null = null;
let activeCursorLine: number | null = null;
let activeSymbols: { name: string; kind: string }[] = [];

if (modelProviderSelect) {
  modelProviderSelect.addEventListener("change", () => {
    currentProvider = modelProviderSelect.value;
    if (currentProvider === "webgpu") {
      statusEl.textContent = engine ? "Qwen3-0.6B ready" : "Ready";
    } else if (currentProvider === "ollama") {
      statusEl.textContent = "Ollama ready";
    } else if (currentProvider === "hosted-mcp") {
      statusEl.textContent = "Cloud ready";
    }
  });
}

const MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";

export const MODELSCRIPT_TOOLS = [
  {
    type: "function",
    function: {
      name: "modelscript_closed_loop_synthesize",
      description:
        "Synthesize, tune, and certify a SysML v2 or Modelica model across 5 compiler gates (Syntax, QUDV Dimensions, SMT Feasibility, DAE Balance, Dynamic Simulation & STL Robustness).",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Specification or requirement prompt" },
          language: { type: "string", enum: ["sysml2", "modelica"], description: "Target language" },
          initialCode: { type: "string", description: "Optional candidate code to repair or tune" },
          className: { type: "string", description: "Target model or class name" },
          tunableParameters: {
            type: "array",
            items: { type: "string" },
            description: "Parameters to tune via sensitivity / IMC-PID optimization (e.g. ['Kp', 'Ki', 'Kd'])",
          },
          stopTime: { type: "number", description: "Closed-loop simulation horizon in seconds" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modelica_flatten",
      description:
        "Flatten a Modelica class to a system of differential-algebraic equations (DAEs) and inspect state/algebraic counts, BLT blocks, and Pantelides index reduction.",
      parameters: {
        type: "object",
        properties: {
          className: { type: "string", description: "Target Modelica class name" },
          code: { type: "string", description: "Optional Modelica code to flatten" },
          includeMetrics: { type: "boolean", description: "Return structured DAE balance metrics" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modelica_simulate",
      description: "Simulate a Modelica model and compute trajectory verification metrics.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Modelica class name" },
          stopTime: { type: "number", description: "Simulation stop time in seconds" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "validate_system_consistency",
      description:
        "Verify cross-domain consistency between SysML v2 requirements/architecture and Modelica physical models (ports, QUDV units, and shared parameter slots).",
      parameters: {
        type: "object",
        properties: {
          sysmlCode: { type: "string", description: "SysML v2 source code" },
          modelicaCode: { type: "string", description: "Modelica source code" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tgg_reconcile_slot",
      description:
        "Reconcile a divergent cross-domain parameter slot across SysML v2 and Modelica using Triple Graph Grammar (TGG) rules and lossless CST writeback.",
      parameters: {
        type: "object",
        properties: {
          slotId: { type: "string", description: "Divergent parameter slot or conflict ID" },
          strategy: {
            type: "string",
            enum: ["source-wins", "target-wins", "physics-simplex", "interval_intersection"],
            description: "Reconciliation strategy",
          },
          customValue: { type: "number", description: "Optional explicit resolved numeric value" },
        },
        required: ["slotId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rtm_query_matrix",
      description:
        "Query the live Requirements Traceability Matrix (RTM) for requirement coverage and verification verdicts.",
      parameters: {
        type: "object",
        properties: {
          statusFilter: {
            type: "string",
            enum: ["all", "verified", "failed", "unverified", "suspect"],
            description: "Optional status filter",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cad_fea_closed_loop_size",
      description:
        "Run closed-loop 3D CAD/OpenSCAD/STEP parametric sizing coupled with tetrahedral FEA von Mises stress analysis and BVH collision clearance verification.",
      parameters: {
        type: "object",
        properties: {
          partName: { type: "string", description: "Target structural component name" },
          materialYieldMpa: { type: "number", description: "Material yield strength in MPa" },
          minSafetyFactor: { type: "number", description: "Required minimum safety factor" },
          appliedLoadN: { type: "number", description: "Applied peak load in Newtons" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "polyglot_migrate_and_verify_b2b",
      description:
        "Migrate legacy Simulink (.slx), SPICE (.cir), or Adams (.adm) models to Modelica & SysML v2 and certify ISO 26262 Back-to-Back (B2B) equivalence.",
      parameters: {
        type: "object",
        properties: {
          sourceFormat: { type: "string", enum: ["simulink", "spice", "adams"], description: "Legacy CAE format" },
          modelName: { type: "string", description: "Target Modelica / SysML v2 model name" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "formal_verify_safety_and_mcdc",
      description:
        "Prove unbounded safety invariants via IC3/PDR and SOS barrier certificates, and generate DO-178C / ISO 26262 MC/DC test vectors.",
      parameters: {
        type: "object",
        properties: {
          modelName: { type: "string", description: "Target model or state machine name" },
          safetyProperty: { type: "string", description: "Safety invariant expression to prove" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modelscript_patch_code",
      description: "Surgically patch a section of code in the active file using search and replace blocks.",
      parameters: {
        type: "object",
        properties: {
          searchBlock: { type: "string", description: "Exact lines or unique code block to replace" },
          replaceBlock: { type: "string", description: "New replacement code block" },
          fileName: { type: "string", description: "Optional target file name" },
        },
        required: ["searchBlock", "replaceBlock"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modelscript_verify",
      description: "Run 4-gate verification (Syntax, Dimensions, SMT Feasibility, DAE Balance) on model code.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Model code to verify" },
          language: { type: "string", enum: ["sysml2", "modelica"], description: "Target language" },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modelscript_add_component",
      description: "Insert a component into the diagram or model.",
      parameters: {
        type: "object",
        properties: {
          className: { type: "string", description: "Component class name" },
          classKind: { type: "string", description: "Kind of class: model, block, connector, etc." },
        },
        required: ["className"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modelscript_simulate_and_plot",
      description: "Run simulation and open the interactive simulation plot panel.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modelscript_query",
      description: "Print internal class hierarchy or symbol table for a specific class.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Fully qualified class name to query" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modelscript_parse",
      description: "Syntax-check and inspect CST parse tree for a code snippet.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Code snippet to check" },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modelscript_read_file",
      description: "Read file contents or a range of lines from any file in the workspace.",
      parameters: {
        type: "object",
        properties: {
          fileName: { type: "string", description: "Relative file path or file name in workspace" },
          startLine: { type: "number", description: "Optional 1-indexed starting line number" },
          endLine: { type: "number", description: "Optional 1-indexed ending line number" },
        },
        required: ["fileName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modelscript_list_workspace_files",
      description: "List model files in the workspace matching an optional glob pattern.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Optional glob pattern (defaults to model files)" },
          maxResults: { type: "number", description: "Max files to return (default 50)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modelscript_find_symbols",
      description: "Find classes, models, blocks, records, or packages across the workspace by query or kind.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keyword or symbol name" },
          kind: {
            type: "string",
            description: "Optional kind filter: model, class, block, package, connector, record, function",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "modelscript_get_diagnostics",
      description: "Retrieve compiler and linter diagnostics (errors, warnings) for a file or whole workspace.",
      parameters: {
        type: "object",
        properties: {
          fileName: { type: "string", description: "Optional file name to filter diagnostics for" },
        },
      },
    },
  },
];

const SYSTEM_PROMPT = `You are ModelScript AI, an expert systems engineering and physical modeling assistant connected to the deterministic WebAssembly compiler, DAE solver, and Triple Graph Grammar (TGG) engine.
You have access to tools to navigate the workspace, query multi-file symbols, inspect compiler diagnostics, run 5-gate closed-loop synthesis & parameter tuning (modelscript_closed_loop_synthesize), flatten & balance DAEs (modelica_flatten), reconcile cross-domain SysML v2 ↔ Modelica parameters (validate_system_consistency, tgg_reconcile_slot), size 3D CAD/FEA geometry (cad_fea_closed_loop_size), certify ISO 26262 B2B migrations (polyglot_migrate_and_verify_b2b), prove IC3/SOS + MC/DC formal safety (formal_verify_safety_and_mcdc), patch code surgically, add components, and simulate models.
When working across multiple files or libraries, locate and read relevant files or symbols before modifying code.
Always inspect or verify code before and after modifying it.
To invoke actions, call the available functions or output:
TOOL_CALL: {"tool": "TOOL_NAME", "input": {"arg1": "value"}}
Do not use <think> tags. Answer concisely based on the context provided.`;

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
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
    if (!nav.gpu) throw new Error("WebGPU not available");
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter found");

    progressContainer.style.display = "block";
    progressText.textContent = "Downloading model (~336 MB, cached after first time)...";
    statusEl.textContent = "Loading...";

    engine = (await CreateMLCEngine(MODEL_ID, {
      appConfig: getAppConfig(),
      initProgressCallback: (report: { text: string; progress: number }) => {
        const pct = Math.round(report.progress * 100);
        progressBar.style.width = pct + "%";
        progressText.textContent = report.text;
        statusEl.textContent = `Loading ${pct}%`;
      },
    })) as unknown as MLCEngineLike;

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
      activeSelectedText = msg.selectedText ?? null;
      activeCursorLine = typeof msg.cursorLine === "number" ? msg.cursorLine : null;
      activeSymbols = Array.isArray(msg.symbols) ? msg.symbols : [];
      break;
    case "cloudStreamChunk": {
      const stream = pendingCloudStreams.get(msg.id);
      if (stream) stream.onChunk({ content: msg.content || "" });
      break;
    }
    case "cloudStreamEnd": {
      const stream = pendingCloudStreams.get(msg.id);
      if (stream) {
        stream.onEnd();
        pendingCloudStreams.delete(msg.id);
      }
      break;
    }
    case "cloudStreamError": {
      const stream = pendingCloudStreams.get(msg.id);
      if (stream) {
        stream.onError(new Error(msg.error || "Cloud stream error"));
        pendingCloudStreams.delete(msg.id);
      }
      break;
    }
  }
});

interface ExtractedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

function extractToolCalls(rawText: string, nativeToolCalls?: NativeToolCall[]): ExtractedToolCall[] {
  const calls: ExtractedToolCall[] = [];

  // 1. Native tool calls from WebLLM completion
  if (Array.isArray(nativeToolCalls) && nativeToolCalls.length > 0) {
    for (const ntc of nativeToolCalls) {
      try {
        const inputObj =
          typeof ntc.function?.arguments === "string"
            ? (JSON.parse(ntc.function.arguments) as Record<string, unknown>)
            : (ntc.function?.arguments ?? {});
        calls.push({
          id: ntc.id || Math.random().toString(36).slice(2),
          name: ntc.function?.name || "",
          input: inputObj,
        });
      } catch {
        // ignore malformed arguments
      }
    }
  }

  // 2. Text-based TOOL_CALL: fallback
  let searchIdx = 0;
  while ((searchIdx = rawText.indexOf("TOOL_CALL:", searchIdx)) !== -1) {
    const jsonStart = rawText.indexOf("{", searchIdx);
    if (jsonStart === -1) break;
    let braceCount = 0;
    let jsonEnd = -1;
    for (let i = jsonStart; i < rawText.length; i++) {
      if (rawText[i] === "{") braceCount++;
      else if (rawText[i] === "}") braceCount--;
      if (braceCount === 0) {
        jsonEnd = i;
        break;
      }
    }
    if (jsonEnd !== -1) {
      try {
        const jsonStr = rawText.substring(jsonStart, jsonEnd + 1);
        const parsed = JSON.parse(jsonStr);
        if (parsed.tool) {
          calls.push({
            id: Math.random().toString(36).slice(2),
            name: parsed.tool,
            input: parsed.input || {},
          });
        }
      } catch {
        // ignore parse error
      }
      searchIdx = jsonEnd + 1;
    } else {
      break;
    }
  }

  return calls;
}

function buildDynamicSystemPrompt(): string {
  let prompt = SYSTEM_PROMPT;
  if (!activeFileName || !activeFileContent) {
    return prompt;
  }

  prompt += `\n\n### Current Workspace Context: File "${activeFileName}"`;

  // 1. Semantic Outline
  if (activeSymbols.length > 0) {
    const symbolList = activeSymbols
      .slice(0, 25)
      .map((s) => `- ${s.kind} ${s.name}`)
      .join("\n");
    prompt += `\n\nSemantic Outline:\n${symbolList}`;
  }

  // 2. Focused Cursor Window / Selection (SWE-agent / Claude Code windowing)
  const lines = activeFileContent.split("\n");
  const totalLines = lines.length;

  if (activeSelectedText && activeSelectedText.trim().length > 0) {
    prompt += `\n\nCurrently Selected Code:\n\`\`\`modelica\n${activeSelectedText}\n\`\`\``;
  }

  if (totalLines <= 120) {
    prompt += `\n\nFull File Content (${totalLines} lines):\n\`\`\`modelica\n${activeFileContent}\n\`\`\``;
  } else {
    const focusLine = activeCursorLine ?? 0;
    const windowStart = Math.max(0, focusLine - 45);
    const windowEnd = Math.min(totalLines, focusLine + 45);
    const windowedLines = lines.slice(windowStart, windowEnd).join("\n");

    prompt += `\n\nFile Excerpt (lines ${windowStart + 1}–${windowEnd} of ${totalLines}, focused around cursor at line ${focusLine + 1}):\n\`\`\`modelica\n${windowedLines}\n\`\`\``;
  }

  return prompt;
}

async function* streamFromCloud(messages: ChatMessage[]): AsyncGenerator<CompletionChunk, void, unknown> {
  const id = Math.random().toString(36).slice(2);
  type StreamEvent = { type: "chunk"; chunk: CompletionChunk } | { type: "error"; err: Error } | { type: "end" };
  const queue: StreamEvent[] = [];
  let notify: (() => void) | null = null;

  pendingCloudStreams.set(id, {
    onChunk: (chunk) => {
      queue.push({ type: "chunk", chunk });
      notify?.();
    },
    onError: (err) => {
      queue.push({ type: "error", err });
      notify?.();
    },
    onEnd: () => {
      queue.push({ type: "end" });
      notify?.();
    },
  });

  vscode.postMessage({ type: "cloudChatCompletion", id, messages });

  try {
    while (true) {
      while (queue.length > 0) {
        const event = queue.shift()!;
        if (event.type === "end") return;
        if (event.type === "error") throw event.err;
        yield event.chunk;
      }
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  } finally {
    pendingCloudStreams.delete(id);
  }
}

async function* streamChatCompletion(
  messages: ChatMessage[],
  tools: typeof MODELSCRIPT_TOOLS,
): AsyncGenerator<CompletionChunk, void, unknown> {
  if (currentProvider === "webgpu") {
    await ensureEngine();
    if (!engine) throw new Error("WebLLM engine not initialized");

    let completion: AsyncIterable<ChatCompletionStreamChunk>;
    try {
      completion = await engine.chat.completions.create({
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.7,
        max_tokens: 2048,
        stream: true,
      });
    } catch {
      completion = await engine.chat.completions.create({
        messages,
        temperature: 0.7,
        max_tokens: 2048,
        stream: true,
      });
    }
    for await (const chunk of completion) {
      yield {
        content: chunk.choices[0]?.delta?.content || "",
        finish_reason: chunk.choices[0]?.finish_reason,
        tool_calls: chunk.choices[0]?.delta?.tool_calls,
      };
    }
  } else if (currentProvider === "ollama") {
    const baseUrl =
      typeof OLLAMA_BASE_URL === "string" && OLLAMA_BASE_URL.length > 0 ? OLLAMA_BASE_URL : "http://localhost:11434";
    const targetModel =
      typeof OLLAMA_MODEL === "string" && OLLAMA_MODEL.length > 0 ? OLLAMA_MODEL : "qwen2.5-coder:latest";
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: targetModel,
        messages,
        tools,
        stream: true,
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Ollama request failed: ${res.statusText} (${res.status}). Verify Ollama is running at ${baseUrl} with '${targetModel}' or configure 'modelscript.llm.endpoint'.`,
      );
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response stream received from Ollama");
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (trimmed.startsWith("data: ")) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const choice = parsed.choices?.[0];
            yield {
              content: choice?.delta?.content || "",
              finish_reason: choice?.finish_reason,
              tool_calls: choice?.delta?.tool_calls,
            };
          } catch {
            // ignore JSON parse error for partial chunk
          }
        }
      }
    }
  } else if (currentProvider === "hosted-mcp") {
    yield* streamFromCloud(messages);
  }
}

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

  // Prune history to keep only the last 8 turns
  if (conversation.length > 8) {
    conversation.splice(0, conversation.length - 8);
  }

  const dynamicSystemPrompt = buildDynamicSystemPrompt();

  const MAX_REACT_HOPS = 6;
  let hop = 0;

  try {
    if (currentProvider === "webgpu") {
      await ensureEngine();
    }

    while (hop < MAX_REACT_HOPS) {
      hop++;
      const typingEl = addTypingIndicator();

      const messages: ChatMessage[] = [{ role: "system", content: dynamicSystemPrompt }, ...conversation];
      const completion = streamChatCompletion(messages, MODELSCRIPT_TOOLS);

      typingEl.remove();
      const msgEl = addMessage("assistant", "Thinking...");

      let rawText = "";
      let finishReason = "stop";

      let nativeToolCalls: NativeToolCall[] = [];

      for await (const chunk of completion) {
        rawText += chunk.content || "";
        if (chunk.finish_reason) {
          finishReason = chunk.finish_reason;
        }
        if (chunk.tool_calls) {
          nativeToolCalls = chunk.tool_calls;
        }
        if (rawText) {
          msgEl.innerHTML = formatContent(rawText);
        } else {
          msgEl.innerHTML = 'Thinking<span class="animated-ellipsis"></span>';
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      let visibleText = stripThinkTags(rawText);
      if (!visibleText && rawText) visibleText = rawText;

      // If truncated (finish_reason="length") on WebGPU, try one continuation
      if (finishReason === "length" && visibleText && currentProvider === "webgpu" && engine) {
        statusEl.textContent = "Continuing...";
        const cont = await engine.chat.completions.create({
          messages: [
            ...messages,
            { role: "assistant" as const, content: visibleText },
            { role: "user" as const, content: "Continue." },
          ],
          temperature: 0.7,
          max_tokens: 2048,
          stream: false,
        });
        const contRaw = cont.choices?.[0]?.message?.content || "";
        if (contRaw) {
          visibleText += " " + stripThinkTags(contRaw);
          msgEl.innerHTML = formatContent(visibleText);
        }
      }

      statusEl.textContent =
        currentProvider === "webgpu"
          ? "Qwen3-0.6B ready"
          : currentProvider === "ollama"
            ? "Ollama ready"
            : "Cloud ready";

      if (!visibleText && nativeToolCalls.length === 0) {
        msgEl.innerHTML = "I couldn't generate a response. Try a more specific instruction.";
      }

      conversation.push({ role: "assistant", content: visibleText || rawText });

      // Extract tool calls (native or text fallback)
      const toolCalls = extractToolCalls(visibleText, nativeToolCalls);
      if (toolCalls.length === 0) {
        // No further tool calls: autonomous ReAct chain finished!
        break;
      }

      // Execute each detected tool call
      let traceStepIdx = 0;
      for (const call of toolCalls) {
        traceStepIdx++;
        const callMsgEl = addMessage("tool", "");
        callMsgEl.style.width = "100%";
        callMsgEl.style.alignSelf = "stretch";
        callMsgEl.style.display = "block";
        callMsgEl.classList.remove("tool");
        callMsgEl.innerHTML = `
          <div class="trace-card">
            <div class="trace-head">
              <span class="trace-step-num">${traceStepIdx}</span>
              <span class="trace-tool">${call.name}</span>
              <span class="trace-proto">JSON-RPC tools/call</span>
            </div>
            <div class="trace-running">Executing tool call<span class="animated-ellipsis"></span></div>
          </div>
        `;

        try {
          const toolResult = (await requestToolCall(call.name, call.input)) as Record<string, unknown>;
          const resultStr = typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2);

          const hasStructuredTrace =
            toolResult &&
            typeof toolResult === "object" &&
            (typeof toolResult.resultTitle === "string" ||
              Array.isArray(toolResult.metrics) ||
              Array.isArray(toolResult.gates));

          if (hasStructuredTrace) {
            const titleText =
              typeof toolResult.resultTitle === "string"
                ? toolResult.resultTitle
                : typeof toolResult.summary === "string"
                  ? toolResult.summary
                  : `${call.name} completed`;
            const rawMetrics = Array.isArray(toolResult.metrics)
              ? (toolResult.metrics as { label: string; value: string; status?: string }[])
              : Array.isArray(toolResult.gates)
                ? (toolResult.gates as { gate: number; gateName: string; passed: boolean }[]).map((g) => ({
                    label: `Gate ${g.gate}: ${g.gateName}`,
                    value: g.passed ? "PASS" : "FAIL",
                    status: g.passed ? "pass" : "fail",
                  }))
                : [];
            const escapedArgs = JSON.stringify(call.input ?? {}, null, 2)
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            const metricsHtml = rawMetrics
              .map(
                (m) => `
              <div class="trace-metric ${m.status || "info"}">
                <span class="tm-label">${m.label}</span>
                <span class="tm-val">${m.value}</span>
              </div>`,
              )
              .join("");
            const verdictHtml =
              typeof toolResult.verdict === "string"
                ? `
              <div class="verdict-banner">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.2" style="flex-shrink:0;margin-top:2px;">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                <div><strong>Deterministic Compiler Proof:</strong> ${toolResult.verdict}</div>
              </div>`
                : "";

            callMsgEl.innerHTML = `
              <div class="trace-card">
                <div class="trace-head">
                  <span class="trace-step-num">${traceStepIdx}</span>
                  <span class="trace-tool">${call.name}</span>
                  <span class="trace-proto">JSON-RPC tools/call</span>
                </div>
                <pre class="trace-args"><code>${escapedArgs}</code></pre>
                <div class="trace-result">
                  <div class="trace-res-title">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    ${titleText}
                  </div>
                  ${metricsHtml ? `<div class="trace-metrics">${metricsHtml}</div>` : ""}
                </div>
              </div>
              ${verdictHtml}
            `;
          } else if (toolResult && toolResult.action === "Edited" && toolResult.file) {
            callMsgEl.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.1)); border-radius: 4px; padding: 4px 8px; font-size: 12.5px; font-family: var(--vscode-font-family, system-ui, sans-serif); margin: 2px 0; width: 100%; box-sizing: border-box;">
                <svg style="opacity: 0.7;" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.8 4.7l-3.5-3.5A1 1 0 0 0 9.6 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V5.4a1 1 0 0 0-.2-.7zM10 2.4L12.6 5H10V2.4zM13 14H3V2h6v4h4v8z"/>
                </svg>
                <span style="opacity: 0.9; font-weight: 500;">${call.name}</span>
                <span style="color: var(--vscode-descriptionForeground); font-family: monospace; font-size: 11.5px;">${toolResult.file}</span>
                <span style="margin-left: auto; color: var(--vscode-gitDecoration-addedResourceForeground, #81b88b);">+${toolResult.added || 0}</span>
                <span style="color: var(--vscode-gitDecoration-deletedResourceForeground, #c74e39); margin-left: 4px;">-${toolResult.deleted || 0}</span>
              </div>
            `;
          } else if (call.name === "modelscript_read_file" && toolResult && toolResult.fileName) {
            callMsgEl.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.1)); border-radius: 4px; padding: 4px 8px; font-size: 12.5px; margin: 2px 0; width: 100%; box-sizing: border-box;">
                <svg style="opacity: 0.7;" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 4.5V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h6.5L14 4.5zm-1 0L9.5 2H3v12h10V4.5z"/></svg>
                <span style="opacity: 0.9; font-weight: 500;">Read</span>
                <span style="color: var(--vscode-descriptionForeground); font-family: monospace; font-size: 11.5px;">${toolResult.fileName}</span>
                <span style="margin-left: auto; font-family: monospace; opacity: 0.6; font-size: 11px;">lines ${toolResult.startLine ?? 1}–${toolResult.endLine ?? toolResult.totalLines}</span>
              </div>
            `;
          } else if (call.name === "modelscript_find_symbols" && toolResult) {
            callMsgEl.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.1)); border-radius: 4px; padding: 4px 8px; font-size: 12.5px; margin: 2px 0; width: 100%; box-sizing: border-box;">
                <svg style="opacity: 0.7;" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.5 12.5h-1v-5h1v5zm0-6h-1v-1h1v1z"/></svg>
                <span style="opacity: 0.9; font-weight: 500;">Find Symbols</span>
                <span style="margin-left: auto; font-family: monospace; opacity: 0.6; font-size: 11px;">${toolResult.count ?? 0} found</span>
              </div>
            `;
          } else if (call.name === "modelscript_list_workspace_files" && toolResult) {
            callMsgEl.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.1)); border-radius: 4px; padding: 4px 8px; font-size: 12.5px; margin: 2px 0; width: 100%; box-sizing: border-box;">
                <svg style="opacity: 0.7;" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h3.764a2 2 0 0 1 1.789 1.106l.447.894H13.5A1.5 1.5 0 0 1 15 4.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 13.5v-11z"/></svg>
                <span style="opacity: 0.9; font-weight: 500;">Workspace Files</span>
                <span style="margin-left: auto; font-family: monospace; opacity: 0.6; font-size: 11px;">${toolResult.count ?? 0} files</span>
              </div>
            `;
          } else if (call.name === "modelscript_get_diagnostics" && toolResult) {
            callMsgEl.innerHTML = `
              <div style="display: flex; align-items: center; gap: 8px; background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.1)); border-radius: 4px; padding: 4px 8px; font-size: 12.5px; margin: 2px 0; width: 100%; box-sizing: border-box;">
                <svg style="opacity: 0.7;" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/></svg>
                <span style="opacity: 0.9; font-weight: 500;">Diagnostics</span>
                <span style="margin-left: auto; font-family: monospace; opacity: 0.6; font-size: 11px;">${toolResult.count ?? 0} items</span>
              </div>
            `;
          } else {
            callMsgEl.innerHTML = `
              <div class="trace-card">
                <div class="trace-head">
                  <span class="trace-step-num">${traceStepIdx}</span>
                  <span class="trace-tool">${call.name}</span>
                  <span class="trace-proto">JSON-RPC tools/call</span>
                </div>
                <div class="trace-result">
                  <div class="trace-res-title">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Completed
                  </div>
                </div>
              </div>
            `;
          }

          conversation.push({
            role: "user",
            content: `Tool result for ${call.name}:\n${resultStr}\n\nPlease analyze this result and determine the next action or provide the final response.`,
          });
        } catch (toolErr) {
          addMessage("tool", `⚠️ Tool error: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`);
          conversation.push({
            role: "user",
            content: `Tool error for ${call.name}: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`,
          });
        }
      }
    }
  } catch (e) {
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

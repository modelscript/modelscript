// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  draftPostWithAi,
  getArtifactView,
  polishPostWithAi,
  type AiDraftResponse,
  type AiDraftTone,
  type AiPolishMode,
  type AiPolishResponse,
} from "../api";

export type ComposerAiEngineMode = "auto" | "local" | "remote";

const AI_ENGINE_STORAGE_KEY = "modelscript:composer_ai_engine";

const WEBLLM_MODEL_CANDIDATES: readonly {
  modelId: string;
  wasmFiles: readonly string[];
}[] = [
  {
    modelId: "Qwen3-1.7B-q4f16_1-MLC",
    wasmFiles: ["Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm", "Qwen3-1.7B-q4f16_1-ctx4k_cs1k-webgpu.wasm"],
  },
  {
    modelId: "Qwen3-0.6B-q4f16_1-MLC",
    wasmFiles: ["Qwen3-0.6B-q4f16_1-ctx4k_cs1k-webgpu.wasm", "Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm"],
  },
];

export function getPreferredAiEngine(): ComposerAiEngineMode {
  if (typeof window === "undefined") return "auto";
  try {
    const val = window.localStorage.getItem(AI_ENGINE_STORAGE_KEY);
    if (val === "local" || val === "remote" || val === "auto") {
      return val;
    }
  } catch {
    // Ignore storage access errors
  }
  return "auto";
}

export function setPreferredAiEngine(mode: ComposerAiEngineMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AI_ENGINE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage access errors
  }
}

interface BrowserPromptSession {
  prompt(input: string): Promise<string>;
}

interface BrowserLanguageModelFactory {
  create(options?: { systemPrompt?: string | undefined }): Promise<BrowserPromptSession>;
  availability?: (() => Promise<string>) | undefined;
  capabilities?: (() => Promise<{ available?: string | undefined }>) | undefined;
}

interface WindowWithBuiltInAi {
  ai?: {
    languageModel?: BrowserLanguageModelFactory | undefined;
  };
  LanguageModel?: BrowserLanguageModelFactory | undefined;
}

interface WebLLMChatCompletionResponse {
  choices?: {
    message?: {
      content?: string | null | undefined;
    };
  }[];
}

interface WebLLMEngineInstance {
  chat: {
    completions: {
      create(params: {
        messages: { role: "system" | "user" | "assistant"; content: string }[];
        temperature?: number;
        max_tokens?: number;
        stream?: false;
        extra_body?: Record<string, unknown>;
      }): Promise<WebLLMChatCompletionResponse>;
    };
  };
}

let cachedBrowserSession: BrowserPromptSession | null = null;
let cachedWebLLMEngine: WebLLMEngineInstance | null = null;
let activeWebLLMModelId: string = WEBLLM_MODEL_CANDIDATES[0]!.modelId;
let webllmLoadingPromise: Promise<WebLLMEngineInstance | null> | null = null;

/**
 * Returns true only when an actual in-browser LLM (WebLLM WebGPU engine or Browser Prompt API)
 * is already initialized in memory.
 */
export function isLocalAiLoaded(): boolean {
  return cachedWebLLMEngine !== null || cachedBrowserSession !== null;
}

function stripThinkAndQuotes(raw: string): string {
  let cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>\s*/gi, "")
    .replace(/<think>[\s\S]*/gi, "")
    .trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"') && !cleaned.slice(1, -1).includes('"')) ||
    (cleaned.startsWith("“") && cleaned.endsWith("”"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

async function getBrowserBuiltInSession(systemPrompt: string): Promise<BrowserPromptSession | null> {
  if (typeof window === "undefined") return null;
  const win = window as unknown as WindowWithBuiltInAi;
  const factory = win.ai?.languageModel || win.LanguageModel;
  if (!factory || typeof factory.create !== "function") return null;

  try {
    if (typeof factory.availability === "function") {
      const avail = await factory.availability();
      if (avail === "no" || avail === "unavailable") return null;
    } else if (typeof factory.capabilities === "function") {
      const caps = await factory.capabilities();
      if (caps?.available === "no") return null;
    }
    const session = await factory.create({ systemPrompt });
    cachedBrowserSession = session;
    return session;
  } catch {
    return null;
  }
}

/**
 * Lazily initializes the in-browser WebLLM engine over WebGPU, preferring
 * `Qwen3-1.7B-q4f16_1-MLC` and falling back to `Qwen3-0.6B-q4f16_1-MLC`
 * on memory-constrained devices or when only 0.6B is cached locally.
 */
async function ensureWebLLMEngine(): Promise<WebLLMEngineInstance | null> {
  if (cachedWebLLMEngine) return cachedWebLLMEngine;
  if (webllmLoadingPromise) return webllmLoadingPromise;
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;

  const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } };
  if (!nav.gpu) return null;

  webllmLoadingPromise = (async () => {
    try {
      const adapter = await nav.gpu!.requestAdapter();
      if (!adapter) return null;

      const webllm = await import("@mlc-ai/web-llm");
      const origin = window.location.origin;

      for (const candidate of WEBLLM_MODEL_CANDIDATES) {
        try {
          const prebuiltModel = webllm.prebuiltAppConfig.model_list.find((m) => m.model_id === candidate.modelId);
          let modelUrl = prebuiltModel?.model || `https://huggingface.co/mlc-ai/${candidate.modelId}`;
          let modelLibUrl = prebuiltModel?.model_lib || `${origin}/api/models/${candidate.wasmFiles[0]}`;

          // Check if model weights are self-hosted at /api/models/<modelId> (Docker / EE Appliance / modelscript.org)
          try {
            const localConfigRes = await fetch(`${origin}/api/models/${candidate.modelId}/mlc-chat-config.json`, {
              method: "HEAD",
            });
            if (localConfigRes.ok) {
              modelUrl = `${origin}/api/models/${candidate.modelId}`;
            }
          } catch {
            // Fall back to HuggingFace CDN URL
          }

          // Check if WASM runtime is self-hosted at /api/models/<wasmFile>
          for (const wasmFile of candidate.wasmFiles) {
            try {
              const localWasmUrl = `${origin}/api/models/${wasmFile}`;
              const localWasmRes = await fetch(localWasmUrl, { method: "HEAD" });
              if (localWasmRes.ok) {
                modelLibUrl = localWasmUrl;
                break;
              }
            } catch {
              // Ignore and try next or use prebuiltModel.model_lib
            }
          }

          const engine = (await webllm.CreateMLCEngine(candidate.modelId, {
            appConfig: {
              model_list: [
                {
                  model: modelUrl,
                  model_id: candidate.modelId,
                  model_lib: modelLibUrl,
                  overrides: prebuiltModel?.overrides,
                },
              ],
            },
          })) as unknown as WebLLMEngineInstance;

          cachedWebLLMEngine = engine;
          activeWebLLMModelId = candidate.modelId;
          return engine;
        } catch {
          // Try next smaller candidate (e.g., Qwen3-0.6B-q4f16_1-MLC)
        }
      }

      return null;
    } catch {
      return null;
    } finally {
      webllmLoadingPromise = null;
    }
  })();

  return webllmLoadingPromise;
}

async function completeWithLocalBrowserLLM(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ text: string; provider: string; model: string } | null> {
  // 1. Try WebLLM (Qwen3-1.7B / Qwen3-0.6B WebGPU)
  const webllmEngine = await ensureWebLLMEngine();
  if (webllmEngine) {
    try {
      const response = await webllmEngine.chat.completions.create({
        messages: [
          { role: "system", content: `${systemPrompt}\n/no_think` },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 400,
        stream: false,
        extra_body: { enable_thinking: false },
      });
      const raw = response.choices?.[0]?.message?.content || "";
      const text = stripThinkAndQuotes(raw);
      if (text) {
        return {
          text,
          provider: "local-window-ai",
          model: activeWebLLMModelId,
        };
      }
    } catch {
      // Fall through to browser built-in Prompt API
    }
  }

  // 2. Try Browser Built-in Prompt API (window.ai / LanguageModel)
  const browserSession = await getBrowserBuiltInSession(systemPrompt);
  if (browserSession) {
    try {
      const raw = await browserSession.prompt(userPrompt);
      const text = stripThinkAndQuotes(raw);
      if (text) {
        return {
          text,
          provider: "local-window-ai",
          model: "browser-builtin-llm",
        };
      }
    } catch {
      // Fall through
    }
  }

  return null;
}

interface LocalArtifactSummary {
  viewType: string;
  title: string;
  domain: string;
  highlights: string[];
  suggestedHashtags: string[];
}

const LOCAL_DOMAIN_MAP: Record<string, { domain: string; hashtags: string[] }> = {
  modelica: { domain: "Modelica & Physical Modeling", hashtags: ["#Modelica", "#DAE", "#Simulation"] },
  "modelica-diagram": { domain: "Modelica & Physical Modeling", hashtags: ["#Modelica", "#DAE", "#Simulation"] },
  "modelica-code": { domain: "Modelica & Physical Modeling", hashtags: ["#Modelica", "#DAE", "#PhysicalModeling"] },
  morsel: { domain: "Multi-Domain Simulation", hashtags: ["#ModelScript", "#Simulation", "#DAE"] },
  modelscript: {
    domain: "ModelScript Native Modeling",
    hashtags: ["#ModelScript", "#Simulation", "#SystemsEngineering"],
  },
  sysml: { domain: "Systems Engineering & SysML v2", hashtags: ["#SysMLv2", "#MBSE", "#SystemsEngineering"] },
  sysml2: { domain: "Systems Engineering & SysML v2", hashtags: ["#SysMLv2", "#MBSE", "#SystemsEngineering"] },
  pscad: { domain: "Power Systems & EMT", hashtags: ["#PSCAD", "#PowerSystems", "#EMT"] },
  psse: { domain: "Transmission Grid & Power Flow", hashtags: ["#PSSE", "#PowerGrid", "#PowerFlow"] },
  "cad-step": { domain: "3D CAD & Mechanical Geometry", hashtags: ["#CAD", "#STEP", "#MechanicalEngineering"] },
  "3d-model": { domain: "3D Visualization & Digital Twin", hashtags: ["#3D", "#DigitalTwin", "#CAD"] },
  scad: { domain: "Parametric CSG & CAD", hashtags: ["#OpenSCAD", "#ParametricCAD", "#CSG"] },
  cfd: { domain: "Computational Fluid Dynamics", hashtags: ["#CFD", "#Aerodynamics", "#FluidDynamics"] },
  "cfd-config": { domain: "Computational Fluid Dynamics", hashtags: ["#CFD", "#Aerodynamics", "#FluidDynamics"] },
  "cfd-result": { domain: "Computational Fluid Dynamics", hashtags: ["#CFD", "#Aerodynamics", "#FlowSimulation"] },
  fea: { domain: "Finite Element Structural Analysis", hashtags: ["#FEA", "#StructuralAnalysis", "#Mechanics"] },
  "fea-deck": { domain: "Finite Element Structural Analysis", hashtags: ["#FEA", "#StructuralAnalysis", "#Mechanics"] },
  "fea-result": {
    domain: "Finite Element Structural Analysis",
    hashtags: ["#FEA", "#VonMises", "#StructuralAnalysis"],
  },
  fmu: { domain: "FMI Co-Simulation & Exchange", hashtags: ["#FMI", "#FMU", "#CoSimulation"] },
  ssp: { domain: "System Structure & Parameterization", hashtags: ["#SSP", "#FMI", "#CoSimulation"] },
  "simulation-plot": {
    domain: "Simulation Trajectory Analysis",
    hashtags: ["#Simulation", "#Dynamics", "#TimeSeries"],
  },
  "vega-plot": { domain: "Simulation Trajectory Analysis", hashtags: ["#Simulation", "#Dynamics", "#DataViz"] },
  package: { domain: "Engineering Package Registry", hashtags: ["#ModelScript", "#OpenSource", "#EngineeringLibrary"] },
  repository: { domain: "Engineering Git Repository", hashtags: ["#Git", "#ModelScript", "#ReproducibleEngineering"] },
};

export function classifyArtifactLocally(rawView: Record<string, unknown> | null | undefined): LocalArtifactSummary {
  const viewType = String(rawView?.["view_type"] || rawView?.["artifact_type"] || "modelica-diagram")
    .toLowerCase()
    .trim();
  const rawConfig = rawView?.["view_config"] ?? rawView?.["config"];
  let config: Record<string, unknown> = {};
  if (typeof rawConfig === "string") {
    try {
      const parsed = JSON.parse(rawConfig) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        config = parsed as Record<string, unknown>;
      }
    } catch {
      config = {};
    }
  } else if (typeof rawConfig === "object" && rawConfig !== null) {
    config = rawConfig as Record<string, unknown>;
  }

  const mapped = LOCAL_DOMAIN_MAP[viewType] || {
    domain: "Multi-Domain Systems Engineering",
    hashtags: ["#ModelScript", "#Engineering", "#Simulation"],
  };

  const rawTitle = String(
    rawView?.["title"] ||
      config["title"] ||
      config["modelName"] ||
      config["name"] ||
      config["project"] ||
      "Engineering Artifact",
  );
  const title = rawTitle.replace(/\.[a-z0-9]{1,8}$/i, "").trim() || rawTitle;

  const highlights: string[] = [];
  const code = String(config["code"] || config["modelicaCode"] || config["source"] || "");
  if (code) {
    const derMatches = Array.from(code.matchAll(/\bder\s*\(\s*([A-Za-z0-9_]+)\s*\)/g)).map((m) => m[1]!);
    const uniqueStates = Array.from(new Set(derMatches));
    if (uniqueStates.length > 0) {
      highlights.push(
        `${uniqueStates.length} state${uniqueStates.length > 1 ? "s" : ""} (${uniqueStates.slice(0, 3).join(", ")})`,
      );
    }
    const paramMatches = Array.from(
      code.matchAll(/\bparameter\s+(?:Real|Integer|Boolean)\s+([A-Za-z0-9_]+)\s*(?:=\s*([0-9.eE+-]+))?/g),
    );
    if (paramMatches.length > 0) {
      highlights.push(
        `Parameters: ${paramMatches
          .slice(0, 3)
          .map((m) => (m[2] ? `${m[1]}=${m[2]}` : m[1]))
          .join(", ")}`,
      );
    }
  }

  if (typeof config["componentCount"] === "number" && config["componentCount"] > 0) {
    highlights.push(
      `${config["componentCount"]} components${
        typeof config["connectionCount"] === "number" ? `, ${config["connectionCount"]} connections` : ""
      }`,
    );
  }
  if (typeof config["busCount"] === "number") {
    highlights.push(
      `${config["busCount"]}-bus network${
        typeof config["generatorCount"] === "number" ? `, ${config["generatorCount"]} generators` : ""
      }`,
    );
  }
  if (typeof config["solver"] === "string" && config["solver"]) {
    highlights.push(
      `Solver: ${config["solver"]}${typeof config["machNumber"] === "number" ? ` · Mach ${config["machNumber"]}` : ""}`,
    );
  }
  if (typeof config["description"] === "string" && config["description"].trim()) {
    highlights.push(config["description"].trim());
  }

  return {
    viewType,
    title,
    domain: mapped.domain,
    highlights,
    suggestedHashtags: mapped.hashtags,
  };
}

export function draftLocallyFromSummary(
  summary: LocalArtifactSummary,
  tone: AiDraftTone = "technical",
  existingText?: string,
): AiDraftResponse {
  const tags = summary.suggestedHashtags.join(" ");
  const notebookTitle = `${summary.title}: ${summary.domain} Analysis`;
  const notebookSummary = `Interactive ${summary.domain.toLowerCase()} exploration of ${summary.title}.`;

  if (tone === "hashtags") {
    const base = (existingText || `Sharing ${summary.title} (${summary.domain}).`).trim();
    const missing = summary.suggestedHashtags.filter((t) => !base.toLowerCase().includes(t.toLowerCase()));
    return {
      draft: missing.length > 0 ? `${base}\n\n${missing.join(" ")}` : base,
      notebookTitle,
      notebookSummary,
      domain: summary.domain,
      highlights: summary.highlights,
      suggestedHashtags: summary.suggestedHashtags,
      provider: "local-browser-ai",
      model: "browser-engineering-classifier-v1",
    };
  }

  if (tone === "concise") {
    const body =
      summary.highlights.length > 0
        ? `Sharing **${summary.title}** — ${summary.highlights.slice(0, 2).join(" | ")}.`
        : `Sharing **${summary.title}** (${summary.domain}) for interactive simulation and inspection.`;
    return {
      draft: `${body} ${tags}`.trim(),
      notebookTitle,
      notebookSummary,
      domain: summary.domain,
      highlights: summary.highlights,
      suggestedHashtags: summary.suggestedHashtags,
      provider: "local-browser-ai",
      model: "browser-engineering-classifier-v1",
    };
  }

  if (tone === "expand") {
    const bullets =
      summary.highlights.length > 0
        ? summary.highlights.map((h) => `- ${h}`).join("\n")
        : `- Domain: ${summary.domain}\n- Interactive model inspection & simulation`;
    const draft = [
      `Sharing **${summary.title}** for ${summary.domain.toLowerCase()} verification and analysis.`,
      `### Key Highlights\n${bullets}`,
      `Open the attached artifact in the playground to inspect parameters and simulation trajectories.\n\n${tags}`,
    ].join("\n\n");
    return {
      draft,
      notebookTitle,
      notebookSummary,
      domain: summary.domain,
      highlights: summary.highlights,
      suggestedHashtags: summary.suggestedHashtags,
      provider: "local-browser-ai",
      model: "browser-engineering-classifier-v1",
    };
  }

  const detail =
    summary.highlights.length > 0
      ? `Key model characteristics: ${summary.highlights.join("; ")}.`
      : `Configured for interactive ${summary.domain.toLowerCase()} inspection and parameter exploration.`;

  return {
    draft: `Exploring **${summary.title}** in ${summary.domain}. ${detail}\n\n${tags}`.trim(),
    notebookTitle,
    notebookSummary,
    domain: summary.domain,
    highlights: summary.highlights,
    suggestedHashtags: summary.suggestedHashtags,
    provider: "local-browser-ai",
    model: "browser-engineering-classifier-v1",
  };
}

export function polishLocally(
  rawContent: string,
  mode: AiPolishMode = "polish",
  artifactSummary?: LocalArtifactSummary | null,
): AiPolishResponse {
  const trimmed = rawContent.trim();
  const domain = artifactSummary?.domain || "Multi-Domain Systems Engineering";

  const existingTags = Array.from(new Set(trimmed.match(/#[a-zA-Z0-9_-]+/g) || []));
  const candidateTags: string[] = [...(artifactSummary?.suggestedHashtags || [])];

  if (/\b(modelica|dae|der|oscillator|pendulum|equation)\b/i.test(trimmed)) {
    candidateTags.push("#Modelica", "#DAE", "#Simulation");
  }
  if (/\b(cfd|mach|airfoil|navier|turbulence|su2)\b/i.test(trimmed)) {
    candidateTags.push("#CFD", "#Aerodynamics");
  }
  if (/\b(fea|stress|von\s*mises|mesh|structural)\b/i.test(trimmed)) {
    candidateTags.push("#FEA", "#StructuralAnalysis");
  }
  if (/\b(pscad|psse|grid|bus|transformer|fault|ieee)\b/i.test(trimmed)) {
    candidateTags.push("#PowerSystems", "#GridSimulation");
  }
  if (/\b(sysml|requirement|mbse|architecture)\b/i.test(trimmed)) {
    candidateTags.push("#SysMLv2", "#MBSE");
  }
  if (candidateTags.length === 0) {
    candidateTags.push("#ModelScript", "#Engineering", "#Simulation");
  }

  const newTags = Array.from(new Set(candidateTags))
    .filter((t) => !existingTags.some((e) => e.toLowerCase() === t.toLowerCase()))
    .slice(0, 3);

  if (!trimmed && artifactSummary) {
    const drafted = draftLocallyFromSummary(artifactSummary, "technical");
    return {
      polished: drafted.draft,
      mode,
      domain,
      suggestedHashtags: artifactSummary.suggestedHashtags,
      provider: "local-browser-ai",
      model: "browser-engineering-classifier-v1",
    };
  }

  if (mode === "hashtags") {
    const polished = newTags.length > 0 ? `${trimmed}\n\n${newTags.join(" ")}`.trim() : trimmed;
    return {
      polished,
      mode,
      domain,
      suggestedHashtags: [...existingTags, ...newTags],
      provider: "local-browser-ai",
      model: "browser-engineering-classifier-v1",
    };
  }

  return {
    polished: trimmed,
    mode,
    domain,
    suggestedHashtags: [...existingTags, ...newTags],
    provider: "local-browser-ai",
    model: "browser-engineering-classifier-v1",
  };
}

/**
 * Orchestrates AI post drafting across Local Browser LLM (WebLLM WebGPU / Browser Prompt API)
 * and Remote LLM (`POST /api/v1/social/ai/draft` backed by Ollama / OpenAI / Gemini / BYOK).
 */
export async function runComposerAiDraft(options: {
  artifactId?: number | null | undefined;
  artifactView?: Record<string, unknown> | null | undefined;
  existingText?: string | undefined;
  tone?: AiDraftTone | undefined;
  isNotebook?: boolean | undefined;
  engine?: ComposerAiEngineMode | undefined;
}): Promise<AiDraftResponse> {
  const engineMode = options.engine || getPreferredAiEngine();
  const tone = options.tone || "technical";

  const shouldUseLocalFirst = engineMode === "local" || (engineMode === "auto" && isLocalAiLoaded());

  if (shouldUseLocalFirst) {
    let rawView = options.artifactView;
    if (!rawView && options.artifactId) {
      try {
        const fetched = (await getArtifactView(options.artifactId)) as Record<string, unknown> | null;
        rawView =
          (fetched?.["artifactView"] as Record<string, unknown> | undefined) ||
          (fetched?.["artifact_view"] as Record<string, unknown> | undefined) ||
          fetched;
      } catch {
        rawView = null;
      }
    }
    const localSummary = classifyArtifactLocally(rawView);

    const systemPrompt =
      "You are Ansatz AI Composer Assistant (powered by ModelScript). Draft a concise, engaging technical engineering post introducing the attached artifact with 2-3 relevant hashtags. Output ONLY the post text.";
    const userPrompt = `Draft a ${tone} post for artifact "${localSummary.title}" (${localSummary.domain}). Highlights: ${
      localSummary.highlights.join("; ") || "Interactive model"
    }. Suggested hashtags: ${localSummary.suggestedHashtags.join(" ")}`;

    const llmOut = await completeWithLocalBrowserLLM(systemPrompt, userPrompt);
    if (llmOut) {
      return {
        draft: llmOut.text,
        notebookTitle: `${localSummary.title}: ${localSummary.domain} Analysis`,
        notebookSummary: `Interactive ${localSummary.domain.toLowerCase()} exploration of ${localSummary.title}.`,
        domain: localSummary.domain,
        highlights: localSummary.highlights,
        suggestedHashtags: localSummary.suggestedHashtags,
        provider: llmOut.provider,
        model: llmOut.model,
      };
    }

    // If user chose "local" but WebGPU/window.ai wasn't available, try remote LLM before static fallback
    if (engineMode === "local") {
      try {
        return await draftPostWithAi({
          artifactId: options.artifactId,
          existingText: options.existingText,
          tone,
          isNotebook: options.isNotebook,
        });
      } catch {
        // Fall through to offline summary
      }
    }

    return draftLocallyFromSummary(localSummary, tone, options.existingText);
  }

  // Remote-first (or Auto when local browser LLM is not yet loaded in memory)
  try {
    return await draftPostWithAi({
      artifactId: options.artifactId,
      existingText: options.existingText,
      tone,
      isNotebook: options.isNotebook,
    });
  } catch {
    let rawView = options.artifactView;
    if (!rawView && options.artifactId) {
      try {
        const fetched = (await getArtifactView(options.artifactId)) as Record<string, unknown> | null;
        rawView =
          (fetched?.["artifactView"] as Record<string, unknown> | undefined) ||
          (fetched?.["artifact_view"] as Record<string, unknown> | undefined) ||
          fetched;
      } catch {
        rawView = null;
      }
    }
    const localSummary = classifyArtifactLocally(rawView);
    return draftLocallyFromSummary(localSummary, tone, options.existingText);
  }
}

export async function runComposerAiPolish(options: {
  content: string;
  mode?: AiPolishMode | undefined;
  artifactId?: number | null | undefined;
  artifactView?: Record<string, unknown> | null | undefined;
  engine?: ComposerAiEngineMode | undefined;
}): Promise<AiPolishResponse> {
  const engineMode = options.engine || getPreferredAiEngine();
  const mode = options.mode || "polish";

  const shouldUseLocalFirst = engineMode === "local" || (engineMode === "auto" && isLocalAiLoaded());

  if (shouldUseLocalFirst && options.content.trim()) {
    const localSummary = options.artifactView ? classifyArtifactLocally(options.artifactView) : null;
    const fallback = polishLocally(options.content, mode, localSummary);

    const modeInstructions: Record<AiPolishMode, string> = {
      polish:
        "Correct all spelling errors, typos, grammar mistakes, capitalization, and punctuation while lightly polishing the phrasing. Do NOT add hashtags unless hashtags are already in the text.",
      concise:
        "Correct all spelling and grammar errors and make the text concise and direct. Do NOT add hashtags unless hashtags are already in the text.",
      expand:
        "Correct all spelling and grammar errors, expand with brief technical context, and add 2-3 engineering hashtags at the end.",
      hashtags:
        "Correct any spelling or grammar errors in the text and append 3-4 relevant engineering hashtags at the end.",
    };

    const systemPrompt = [
      "You are an AI writing assistant integrated into the Ansatz social composer (powered by ModelScript).",
      `Instruction: ${modeInstructions[mode]}`,
      "Preserve @mentions, #hashtags, LaTeX math ($...$), code blocks, and ::artifact directives verbatim.",
      "Output ONLY the revised text without quotes or explanation.",
    ].join("\n");

    const llmOut = await completeWithLocalBrowserLLM(systemPrompt, options.content);
    if (llmOut) {
      return {
        polished: llmOut.text,
        mode,
        domain: fallback.domain,
        suggestedHashtags: fallback.suggestedHashtags,
        provider: llmOut.provider,
        model: llmOut.model,
      };
    }

    // If local WebGPU/Prompt API wasn't available, fall back to remote LLM API
    try {
      return await polishPostWithAi({
        content: options.content,
        mode,
        artifactId: options.artifactId ?? undefined,
      });
    } catch {
      return fallback;
    }
  }

  try {
    return await polishPostWithAi({
      content: options.content,
      mode,
      artifactId: options.artifactId ?? undefined,
    });
  } catch {
    const localSummary = options.artifactView ? classifyArtifactLocally(options.artifactView) : null;
    return polishLocally(options.content, mode, localSummary);
  }
}

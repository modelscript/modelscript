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

let cachedBrowserSession: BrowserPromptSession | null = null;
let localEngineReady = false;

export function isLocalAiLoaded(): boolean {
  return localEngineReady || cachedBrowserSession !== null;
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
    localEngineReady = true;
    return session;
  } catch {
    return null;
  }
}

interface LocalArtifactSummary {
  viewType: string;
  title: string;
  domain: string;
  highlights: string[];
  suggestedHashtags: string[];
}

const LOCAL_DOMAIN_MAP: Record<string, { domain: string; hashtags: string[] }> = {
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
  "cfd-config": { domain: "Computational Fluid Dynamics", hashtags: ["#CFD", "#Aerodynamics", "#FluidDynamics"] },
  "cfd-result": { domain: "Computational Fluid Dynamics", hashtags: ["#CFD", "#Aerodynamics", "#FlowSimulation"] },
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
  const rawConfig = rawView?.["view_config"];
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

  const rawTitle = String(
    rawView?.["title"] || config["title"] || config["modelName"] || config["name"] || config["project"] || "Model",
  );
  const cleanTitle = rawTitle.replace(/\.[a-z0-9]{1,8}$/i, "").trim() || rawTitle;

  const mapped = LOCAL_DOMAIN_MAP[viewType] || {
    domain: "Multi-Domain Systems Engineering",
    hashtags: ["#ModelScript", "#Engineering", "#Simulation"],
  };

  const highlights: string[] = [];
  const code = typeof config["code"] === "string" ? config["code"] : "";
  if (code) {
    const derMatches = Array.from(code.matchAll(/\bder\s*\(\s*([A-Za-z0-9_]+)\s*\)/g)).map((m) => m[1]!);
    const uniqueStates = Array.from(new Set(derMatches));
    if (uniqueStates.length > 0) {
      highlights.push(
        `${uniqueStates.length} continuous state${uniqueStates.length > 1 ? "s" : ""} (${uniqueStates.slice(0, 4).join(", ")})`,
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

  if (typeof config["busCount"] === "number") {
    highlights.push(`${config["busCount"]}-bus network`);
  }
  if (typeof config["componentCount"] === "number" && config["componentCount"] > 0) {
    highlights.push(`${config["componentCount"]} components`);
  }
  if (typeof config["solver"] === "string") {
    highlights.push(`Solver: ${config["solver"]}`);
  }
  if (typeof config["fmiVersion"] === "string") {
    highlights.push(`FMI ${config["fmiVersion"]} FMU`);
  }
  if (typeof config["version"] === "string" && viewType === "package") {
    highlights.push(`v${config["version"]}`);
  }
  if (typeof config["description"] === "string" && config["description"].trim()) {
    highlights.push(config["description"].trim());
  }

  return {
    viewType,
    title: cleanTitle,
    domain: mapped.domain,
    highlights,
    suggestedHashtags: mapped.hashtags,
  };
}

function draftLocallyFromSummary(
  summary: LocalArtifactSummary,
  tone: AiDraftTone = "technical",
  existingText?: string,
): AiDraftResponse {
  const tags = summary.suggestedHashtags.join(" ");
  const notebookTitle = `${summary.title}: ${summary.domain} Analysis`;
  const notebookSummary = `Interactive ${summary.domain.toLowerCase()} exploration of ${summary.title}.`;

  let draft: string;
  if (tone === "hashtags") {
    const base = (existingText || `Exploring **${summary.title}** (${summary.domain}).`).trim();
    const missing = summary.suggestedHashtags.filter((t) => !base.toLowerCase().includes(t.toLowerCase()));
    draft = missing.length > 0 ? `${base}\n\n${missing.join(" ")}` : base;
  } else if (tone === "concise") {
    const detail = summary.highlights.length > 0 ? ` — ${summary.highlights.slice(0, 2).join(" | ")}` : "";
    draft = `Sharing **${summary.title}** (${summary.domain})${detail}. ${tags}`.trim();
  } else if (tone === "expand") {
    const bullets =
      summary.highlights.length > 0
        ? summary.highlights.map((h) => `- ${h}`).join("\n")
        : `- Domain: ${summary.domain}\n- Ready for interactive simulation and parameter inspection`;
    draft = `Sharing **${summary.title}** for ${summary.domain.toLowerCase()} verification.\n\n### Technical Highlights\n${bullets}\n\n${tags}`;
  } else {
    const detail =
      summary.highlights.length > 0
        ? `Key model characteristics: ${summary.highlights.join("; ")}.`
        : `Configured for interactive ${summary.domain.toLowerCase()} inspection and parameter exploration.`;
    draft = `Exploring **${summary.title}** in ${summary.domain}. ${detail}\n\n${tags}`;
  }

  localEngineReady = true;
  return {
    draft: draft.trim(),
    notebookTitle,
    notebookSummary,
    domain: summary.domain,
    suggestedHashtags: summary.suggestedHashtags,
    provider: "local-browser-ai",
    model: "browser-engineering-classifier-v1",
  };
}

function polishLocally(
  content: string,
  mode: AiPolishMode = "polish",
  artifactSummary?: LocalArtifactSummary | null,
): AiPolishResponse {
  const trimmed = content.trim();
  const domain = artifactSummary?.domain || "Multi-Domain Systems Engineering";
  const existingTags = Array.from(new Set(trimmed.match(/#[a-zA-Z0-9_-]+/g) || []));

  const candidateTags: string[] = [...(artifactSummary?.suggestedHashtags || [])];
  if (/\b(modelica|dae|der|oscillator|pendulum|equation)\b/i.test(trimmed)) {
    candidateTags.push("#Modelica", "#DAE", "#Simulation");
  }
  if (/\b(cfd|mach|airfoil|navier|turbulence|su2|openfoam)\b/i.test(trimmed)) {
    candidateTags.push("#CFD", "#Aerodynamics");
  }
  if (/\b(fea|stress|von\s*mises|mesh|calculix|structural)\b/i.test(trimmed)) {
    candidateTags.push("#FEA", "#StructuralAnalysis");
  }
  if (/\b(pscad|psse|grid|bus|transformer|fault|ieee)\b/i.test(trimmed)) {
    candidateTags.push("#PowerSystems", "#GridSimulation");
  }
  if (/\b(sysml|requirement|mbse|architecture)\b/i.test(trimmed)) {
    candidateTags.push("#SysMLv2", "#MBSE");
  }
  if (/\b(fmu|fmi|ssp|cosim)\b/i.test(trimmed)) {
    candidateTags.push("#FMI", "#CoSimulation");
  }
  if (candidateTags.length === 0) {
    candidateTags.push("#ModelScript", "#Engineering", "#Simulation");
  }

  const newTags: string[] = [];
  for (const tag of candidateTags) {
    if (
      !newTags.some((t) => t.toLowerCase() === tag.toLowerCase()) &&
      !existingTags.some((t) => t.toLowerCase() === tag.toLowerCase())
    ) {
      newTags.push(tag);
    }
    if (newTags.length >= 3) break;
  }

  if (mode === "hashtags") {
    const polished = newTags.length > 0 ? `${trimmed}\n\n${newTags.join(" ")}` : trimmed;
    localEngineReady = true;
    return {
      polished: polished.trim(),
      mode,
      domain,
      suggestedHashtags: [...existingTags, ...newTags],
      provider: "local-browser-ai",
      model: "browser-engineering-classifier-v1",
    };
  }

  // Preserve code blocks, math, and ::artifact directives
  const preserved: string[] = [];
  const masked = trimmed.replace(
    /(```[\s\S]*?```|\$\$[\s\S]*?\$\$|::artifact(?:\[[^[\]\r\n]*\])?\{[^{}\r\n]*\})/g,
    (m) => {
      const idx = preserved.length;
      preserved.push(m);
      return `__MS_LOCAL_BLOCK_${idx}__`;
    },
  );

  let body = masked
    .replace(/[ \t]+/g, " ")
    .replace(/\bi\b/g, "I")
    .replace(/\bim\b/gi, "I'm")
    .replace(/\bdont\b/gi, "don't")
    .replace(/\bcant\b/gi, "can't")
    .trim();

  if (/^[a-z]/.test(body)) {
    body = body.charAt(0).toUpperCase() + body.slice(1);
  }

  const trailingTagsMatch = body.match(/((?:\s+#[a-zA-Z0-9_-]+)+)\s*$/);
  const trailingTags = trailingTagsMatch ? trailingTagsMatch[1]!.trim() : "";
  let mainText = trailingTagsMatch ? body.slice(0, body.length - trailingTagsMatch[0].length).trim() : body;

  if (mainText && !/[.!?`:_]$/.test(mainText)) {
    mainText += ".";
  }

  if (mode === "concise") {
    mainText = mainText
      .replace(/\b(?:just wanted to share|i wanted to share|here is a quick look at|check out this)\b\s*/gi, "Sharing ")
      .replace(/\b(?:in order to)\b/gi, "to")
      .replace(/\b(?:due to the fact that)\b/gi, "because")
      .trim();
    if (/^[a-z]/.test(mainText)) {
      mainText = mainText.charAt(0).toUpperCase() + mainText.slice(1);
    }
    const restored = mainText.replace(/__MS_LOCAL_BLOCK_(\d+)__/g, (_m, i) => preserved[Number(i)] || "");
    const tagSuffix = trailingTags || newTags.slice(0, 2).join(" ");
    localEngineReady = true;
    return {
      polished: tagSuffix ? `${restored} ${tagSuffix}`.trim() : restored,
      mode,
      domain,
      suggestedHashtags: [...existingTags, ...newTags],
      provider: "local-browser-ai",
      model: "browser-engineering-classifier-v1",
    };
  }

  if (mode === "expand") {
    const restored = mainText.replace(/__MS_LOCAL_BLOCK_(\d+)__/g, (_m, i) => preserved[Number(i)] || "");
    const extra =
      artifactSummary && artifactSummary.highlights.length > 0
        ? `\n\n**Technical Context (${artifactSummary.title}):** ${artifactSummary.highlights.join(" · ")}.`
        : `\n\nVerified for reproducible ${domain.toLowerCase()} analysis and interactive simulation.`;
    const tagSuffix = trailingTags || newTags.join(" ");
    localEngineReady = true;
    return {
      polished: `${restored}${extra}${tagSuffix ? `\n\n${tagSuffix}` : ""}`.trim(),
      mode,
      domain,
      suggestedHashtags: [...existingTags, ...newTags],
      provider: "local-browser-ai",
      model: "browser-engineering-classifier-v1",
    };
  }

  // Default "polish" mode
  mainText = mainText
    .replace(/^hey\s+(?:everyone|guys|folks)[,!\s]*/i, "")
    .replace(/\bcheck out my\b/gi, "Exploring our")
    .replace(/\bi made a\b/gi, "Developed a");
  if (/^[a-z]/.test(mainText)) {
    mainText = mainText.charAt(0).toUpperCase() + mainText.slice(1);
  }
  const restored = mainText.replace(/__MS_LOCAL_BLOCK_(\d+)__/g, (_m, i) => preserved[Number(i)] || "");
  const tagSuffix = trailingTags || newTags.join(" ");
  localEngineReady = true;
  return {
    polished: tagSuffix ? `${restored}\n\n${tagSuffix}`.trim() : restored,
    mode,
    domain,
    suggestedHashtags: [...existingTags, ...newTags],
    provider: "local-browser-ai",
    model: "browser-engineering-classifier-v1",
  };
}

export async function runComposerAiDraft(options: {
  artifactId: number;
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

    // Check if browser built-in Prompt API is available
    const browserSession = await getBrowserBuiltInSession(
      "You are ModelScript AI Composer Assistant. Draft a concise, technical engineering social post with 2-3 relevant hashtags.",
    );
    if (browserSession) {
      try {
        const promptText = `Draft a ${tone} post for artifact "${localSummary.title}" (${localSummary.domain}). Highlights: ${localSummary.highlights.join("; ")}. Include hashtags: ${localSummary.suggestedHashtags.join(" ")}`;
        const generated = (await browserSession.prompt(promptText)).trim();
        if (generated) {
          return {
            draft: generated,
            notebookTitle: `${localSummary.title}: ${localSummary.domain} Analysis`,
            notebookSummary: `Interactive ${localSummary.domain.toLowerCase()} exploration of ${localSummary.title}.`,
            domain: localSummary.domain,
            suggestedHashtags: localSummary.suggestedHashtags,
            provider: "local-window-ai",
            model: "browser-builtin-llm",
          };
        }
      } catch {
        // Fall through to deterministic local synthesizer
      }
    }

    return draftLocallyFromSummary(localSummary, tone, options.existingText);
  }

  // Remote-first (or Auto when local AI is not yet loaded)
  try {
    return await draftPostWithAi({
      artifactId: options.artifactId,
      existingText: options.existingText,
      tone,
      isNotebook: options.isNotebook,
    });
  } catch {
    // Fallback to local browser classification & drafting if remote call fails
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

  if (shouldUseLocalFirst) {
    const localSummary = options.artifactView ? classifyArtifactLocally(options.artifactView) : null;

    const browserSession = await getBrowserBuiltInSession(
      "You are ModelScript AI Writing Polish Assistant. Improve clarity and technical precision while preserving @mentions, #hashtags, code blocks, math, and ::artifact directives. Output only the revised text.",
    );
    if (browserSession && options.content.trim()) {
      try {
        const promptText = `Mode: ${mode}\nText:\n${options.content}`;
        const generated = (await browserSession.prompt(promptText)).trim();
        if (generated) {
          const fallback = polishLocally(options.content, mode, localSummary);
          return {
            polished: generated,
            mode,
            domain: fallback.domain,
            suggestedHashtags: fallback.suggestedHashtags,
            provider: "local-window-ai",
            model: "browser-builtin-llm",
          };
        }
      } catch {
        // Fall through to local deterministic polisher
      }
    }

    return polishLocally(options.content, mode, localSummary);
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

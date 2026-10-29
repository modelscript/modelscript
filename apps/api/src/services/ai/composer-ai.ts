// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LibraryDatabase } from "../../database.js";
import { extractTopics } from "../../util/extract-topics.js";
import {
  createDefaultLLMProvider,
  DeterministicEngineeringProvider,
  discoverOllamaProvider,
  getDefaultCloudModelId,
  OpenAICompatibleProvider,
  type LLMMessage,
  type LLMProvider,
} from "./llm-client.js";

export type ComposerPolishMode = "polish" | "concise" | "expand" | "hashtags";
export type ComposerDraftTone = "technical" | "concise" | "expand" | "hashtags";

export interface ArtifactSummaryContext {
  artifactId?: number | undefined;
  viewType: string;
  title: string;
  domain: string;
  dialect?: string | undefined;
  highlights: string[];
  codeExcerpt?: string | undefined;
  suggestedHashtags: string[];
}

export interface DraftFromArtifactInput {
  userId?: number | undefined;
  artifactId?: number | undefined;
  artifactIds?: number[] | undefined;
  artifactMeta?:
    | {
        viewType?: string | undefined;
        title?: string | undefined;
        viewConfig?: Record<string, unknown> | string | undefined;
      }
    | undefined;
  existingText?: string | undefined;
  tone?: ComposerDraftTone | undefined;
  isNotebook?: boolean | undefined;
}

export interface DraftFromArtifactResult {
  draft: string;
  notebookTitle: string;
  notebookSummary: string;
  domain: string;
  highlights: string[];
  hashtags: string[];
  suggestedHashtags: string[];
  source: "remote-llm" | "remote-deterministic";
  provider: "remote-llm" | "remote-deterministic";
  model: string;
}

export interface PolishContentInput {
  userId?: number | undefined;
  content: string;
  mode?: ComposerPolishMode | undefined;
  artifactId?: number | undefined;
}

export interface PolishContentResult {
  polished: string;
  mode: ComposerPolishMode;
  domain: string;
  hashtags: string[];
  suggestedHashtags: string[];
  source: "remote-llm" | "remote-deterministic";
  provider: "remote-llm" | "remote-deterministic";
  model: string;
}

interface DomainClassification {
  domain: string;
  hashtags: string[];
}

const DOMAIN_MAP: Record<string, DomainClassification> = {
  modelica: {
    domain: "Modelica & Physical Modeling",
    hashtags: ["#Modelica", "#DAE", "#Simulation"],
  },
  "modelica-diagram": {
    domain: "Modelica & Physical Modeling",
    hashtags: ["#Modelica", "#DAE", "#Simulation"],
  },
  "modelica-code": {
    domain: "Modelica & Physical Modeling",
    hashtags: ["#Modelica", "#DAE", "#PhysicalModeling"],
  },
  morsel: {
    domain: "Multi-Domain Simulation",
    hashtags: ["#ModelScript", "#Simulation", "#DAE"],
  },
  modelscript: {
    domain: "ModelScript Native Modeling",
    hashtags: ["#ModelScript", "#Simulation", "#SystemsEngineering"],
  },
  sysml: {
    domain: "Systems Engineering & SysML v2",
    hashtags: ["#SysMLv2", "#MBSE", "#SystemsEngineering"],
  },
  sysml2: {
    domain: "Systems Engineering & SysML v2",
    hashtags: ["#SysMLv2", "#MBSE", "#SystemsEngineering"],
  },
  pscad: {
    domain: "Power Systems & EMT",
    hashtags: ["#PSCAD", "#PowerSystems", "#EMT"],
  },
  psout: {
    domain: "Power Systems & EMT",
    hashtags: ["#PSCAD", "#PowerSystems", "#Transients"],
  },
  psse: {
    domain: "Transmission Grid & Power Flow",
    hashtags: ["#PSSE", "#PowerGrid", "#PowerFlow"],
  },
  opendss: {
    domain: "Distribution Grid Analysis",
    hashtags: ["#OpenDSS", "#DistributionGrid", "#PowerSystems"],
  },
  "cad-step": {
    domain: "3D CAD & Mechanical Geometry",
    hashtags: ["#CAD", "#STEP", "#MechanicalEngineering"],
  },
  "3d-model": {
    domain: "3D Visualization & Digital Twin",
    hashtags: ["#3D", "#DigitalTwin", "#CAD"],
  },
  scad: {
    domain: "Parametric CSG & CAD",
    hashtags: ["#OpenSCAD", "#ParametricCAD", "#CSG"],
  },
  cfd: {
    domain: "Computational Fluid Dynamics",
    hashtags: ["#CFD", "#Aerodynamics", "#FluidDynamics"],
  },
  "cfd-config": {
    domain: "Computational Fluid Dynamics",
    hashtags: ["#CFD", "#Aerodynamics", "#FluidDynamics"],
  },
  "cfd-result": {
    domain: "Computational Fluid Dynamics",
    hashtags: ["#CFD", "#Aerodynamics", "#FlowSimulation"],
  },
  "cfd-animation": {
    domain: "Computational Fluid Dynamics",
    hashtags: ["#CFD", "#FluidDynamics", "#Simulation"],
  },
  fea: {
    domain: "Finite Element Structural Analysis",
    hashtags: ["#FEA", "#StructuralAnalysis", "#Mechanics"],
  },
  "fea-deck": {
    domain: "Finite Element Structural Analysis",
    hashtags: ["#FEA", "#StructuralAnalysis", "#Mechanics"],
  },
  "fea-result": {
    domain: "Finite Element Structural Analysis",
    hashtags: ["#FEA", "#VonMises", "#StructuralAnalysis"],
  },
  fmu: {
    domain: "FMI Co-Simulation & Exchange",
    hashtags: ["#FMI", "#FMU", "#CoSimulation"],
  },
  ssp: {
    domain: "System Structure & Parameterization",
    hashtags: ["#SSP", "#FMI", "#CoSimulation"],
  },
  "simulation-plot": {
    domain: "Simulation Trajectory Analysis",
    hashtags: ["#Simulation", "#Dynamics", "#TimeSeries"],
  },
  "simulation-result": {
    domain: "Simulation Trajectory Analysis",
    hashtags: ["#Simulation", "#DAE", "#NumericalAnalysis"],
  },
  "vega-plot": {
    domain: "Simulation Trajectory Analysis",
    hashtags: ["#Simulation", "#Dynamics", "#DataViz"],
  },
  olga: {
    domain: "Multiphase Flow & Pipeline Assurance",
    hashtags: ["#OLGA", "#FlowAssurance", "#Multiphase"],
  },
  easy5: {
    domain: "Control & Hydromechanical Systems",
    hashtags: ["#Easy5", "#ControlSystems", "#Hydraulics"],
  },
  rocets: {
    domain: "Aerospace Propulsion & Rocket Engines",
    hashtags: ["#Propulsion", "#Aerospace", "#ROCETS"],
  },
  gtsuite: {
    domain: "1D Thermo-Fluid & Powertrain",
    hashtags: ["#GTSUITE", "#ThermoFluid", "#Powertrain"],
  },
  sima: {
    domain: "Marine Operations & Mooring Dynamics",
    hashtags: ["#Offshore", "#Hydrodynamics", "#SIMA"],
  },
  lps: {
    domain: "Pipeline Hydraulics & Line Pack",
    hashtags: ["#Pipeline", "#Hydraulics", "#EnergyGrid"],
  },
  gensys: {
    domain: "Railway Vehicle-Track Dynamics",
    hashtags: ["#RailwayDynamics", "#GENSYS", "#Multibody"],
  },
  simpack: {
    domain: "Multibody Spatial Kinematics",
    hashtags: ["#Multibody", "#SIMPACK", "#Kinematics"],
  },
  package: {
    domain: "Engineering Package Registry",
    hashtags: ["#ModelScript", "#OpenSource", "#EngineeringLibrary"],
  },
  repository: {
    domain: "Engineering Git Repository",
    hashtags: ["#Git", "#ModelScript", "#ReproducibleEngineering"],
  },
  csv: {
    domain: "Experimental & Simulation Dataset",
    hashtags: ["#Dataset", "#Telemetry", "#EngineeringData"],
  },
  owl2: {
    domain: "Ontological Knowledge Graph",
    hashtags: ["#OWL2", "#SemanticWeb", "#KnowledgeGraph"],
  },
  fortran: {
    domain: "Scientific Computing & Fortran",
    hashtags: ["#Fortran", "#HPC", "#NumericalMethods"],
  },
};

function parseViewConfig(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function classifyArtifactAndExtractSummary(input: {
  artifactId?: number | undefined;
  viewType?: string | undefined;
  title?: string | undefined;
  viewConfig?: unknown;
}): ArtifactSummaryContext {
  const config = parseViewConfig(input.viewConfig);
  const rawViewType = (input.viewType || String(config["dialect"] || config["view_type"] || "modelica-diagram"))
    .toLowerCase()
    .trim();

  const classification = DOMAIN_MAP[rawViewType] || {
    domain: "Multi-Domain Systems Engineering",
    hashtags: ["#ModelScript", "#Engineering", "#Simulation"],
  };

  const rawTitle =
    input.title ||
    (typeof config["title"] === "string" ? config["title"] : undefined) ||
    (typeof config["modelName"] === "string" ? config["modelName"] : undefined) ||
    (typeof config["name"] === "string" ? config["name"] : undefined) ||
    (typeof config["project"] === "string" ? config["project"] : undefined) ||
    "Engineering Artifact";

  const cleanTitle = rawTitle.replace(/\.[a-z0-9]{1,8}$/i, "").trim() || rawTitle;

  const highlights: string[] = [];
  const meta =
    typeof config["metadata"] === "object" && config["metadata"] !== null
      ? (config["metadata"] as Record<string, unknown>)
      : {};
  const metrics =
    typeof config["metrics"] === "object" && config["metrics"] !== null
      ? (config["metrics"] as Record<string, unknown>)
      : {};

  const getNum = (key: string): number | undefined => {
    const val = config[key] ?? meta[key] ?? metrics[key];
    return typeof val === "number" && Number.isFinite(val) ? val : undefined;
  };
  const getStr = (key: string): string | undefined => {
    const val = config[key] ?? meta[key] ?? metrics[key];
    return typeof val === "string" && val.trim().length > 0 ? val.trim() : undefined;
  };

  const code =
    typeof config["code"] === "string"
      ? config["code"]
      : typeof config["modelicaCode"] === "string"
        ? config["modelicaCode"]
        : typeof config["source"] === "string"
          ? config["source"]
          : "";

  // Extract code-level telemetry if code is present
  if (code) {
    const modelMatch = code.match(/\b(?:model|block|class|package|connector|part\s+def|program)\s+([A-Za-z0-9_]+)/);
    if (modelMatch?.[1] && modelMatch[1] !== cleanTitle) {
      highlights.push(`Model class: ${modelMatch[1]}`);
    }
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
      const paramSummary = paramMatches
        .slice(0, 3)
        .map((m) => (m[2] ? `${m[1]}=${m[2]}` : m[1]))
        .join(", ");
      highlights.push(`Parameters: ${paramSummary}`);
    }
  }

  // Extract domain-specific structured metrics
  const busCount = getNum("busCount");
  const genCount = getNum("generatorCount");
  const branchCount = getNum("branchCount");
  const totalGenMw = getNum("totalGenMw");
  if (busCount !== undefined) {
    highlights.push(
      `${busCount}-bus network${genCount !== undefined ? `, ${genCount} generators` : ""}${branchCount !== undefined ? `, ${branchCount} branches` : ""}`,
    );
  }
  if (totalGenMw !== undefined) {
    highlights.push(`Total generation: ${totalGenMw.toFixed(1)} MW`);
  }

  const compCount = getNum("componentCount");
  const connCount = getNum("connectionCount");
  const stateCount = getNum("stateCount");
  if (compCount !== undefined && compCount > 0) {
    highlights.push(
      `${compCount} components${connCount !== undefined ? `, ${connCount} connections` : ""}${stateCount !== undefined ? `, ${stateCount} states` : ""}`,
    );
  }

  const solver = getStr("solver");
  const machNumber = getNum("machNumber");
  const aoaDeg = getNum("aoaDeg");
  if (solver || machNumber !== undefined) {
    const parts: string[] = [];
    if (solver) parts.push(`Solver: ${solver}`);
    if (machNumber !== undefined) parts.push(`Mach ${machNumber}`);
    if (aoaDeg !== undefined) parts.push(`AoA ${aoaDeg}°`);
    highlights.push(parts.join(" · "));
  }

  const fmiVersion = getStr("fmiVersion");
  if (fmiVersion) {
    const vars = Array.isArray(config["variables"]) ? config["variables"].length : undefined;
    highlights.push(`FMI ${fmiVersion} FMU${vars ? ` (${vars} exposed variables)` : ""}`);
  }

  const pkgVersion = getStr("version");
  const pkgDesc = getStr("description");
  if (rawViewType === "package") {
    if (pkgVersion) highlights.push(`Version v${pkgVersion}`);
    if (pkgDesc) highlights.push(pkgDesc);
  } else if (rawViewType === "repository") {
    const ns = getStr("namespace");
    const proj = getStr("project");
    if (ns && proj) highlights.push(`Repository ${ns}/${proj}`);
    if (pkgDesc) highlights.push(pkgDesc);
  }

  const series = Array.isArray(config["series"]) ? config["series"] : null;
  if (series && series.length > 0) {
    const names = series
      .map((s: unknown) =>
        typeof s === "object" && s !== null && typeof (s as Record<string, unknown>)["name"] === "string"
          ? String((s as Record<string, unknown>)["name"])
          : null,
      )
      .filter((n): n is string => Boolean(n));
    if (names.length > 0) {
      highlights.push(`Plotted trajectories: ${names.slice(0, 4).join(", ")}`);
    }
  }

  const activeField = getStr("activeField");
  if (activeField) {
    highlights.push(`Field visualization: ${activeField}`);
  }

  // Deduplicate hashtags and enrich from title/highlights
  const tagSet = new Set<string>(classification.hashtags);
  const dialect = getStr("dialect");
  if (dialect && dialect.length > 1) {
    const formattedDialect = dialect.charAt(0).toUpperCase() + dialect.slice(1);
    tagSet.add(`#${formattedDialect.replace(/[^a-zA-Z0-9]/g, "")}`);
  }
  const extraTopics = extractTopics(`${cleanTitle} ${highlights.join(" ")}`).slice(0, 2);
  for (const t of extraTopics) {
    const cleanTag = t.displayName.replace(/[^a-zA-Z0-9]/g, "");
    if (cleanTag.length >= 4 && tagSet.size < 5) {
      const cap = cleanTag.charAt(0).toUpperCase() + cleanTag.slice(1);
      if (!Array.from(tagSet).some((existing) => existing.toLowerCase() === `#${cap.toLowerCase()}`)) {
        tagSet.add(`#${cap}`);
      }
    }
  }

  return {
    artifactId: input.artifactId,
    viewType: rawViewType,
    title: cleanTitle,
    domain: classification.domain,
    dialect,
    highlights,
    codeExcerpt: code ? code.slice(0, 600) : undefined,
    suggestedHashtags: Array.from(tagSet).slice(0, 4),
  };
}

export function buildDeterministicArtifactDraft(
  ctx: ArtifactSummaryContext,
  tone: ComposerDraftTone = "technical",
  existingText?: string,
): { draft: string; notebookTitle: string; notebookSummary: string } {
  const tags = ctx.suggestedHashtags.join(" ");
  const highlightText = ctx.highlights.length > 0 ? ctx.highlights.join(" · ") : `${ctx.domain} interactive view`;

  const notebookTitle = `${ctx.title}: ${ctx.domain} Analysis`;
  const notebookSummary = `Interactive ${ctx.domain.toLowerCase()} exploration of ${ctx.title}${
    ctx.highlights.length > 0 ? ` featuring ${ctx.highlights[0]}` : ""
  }.`;

  if (tone === "hashtags") {
    const base = (existingText || `Sharing ${ctx.title} (${ctx.domain}).`).trim();
    const missingTags = ctx.suggestedHashtags.filter((tag) => !base.toLowerCase().includes(tag.toLowerCase()));
    return {
      draft: missingTags.length > 0 ? `${base}\n\n${missingTags.join(" ")}` : base,
      notebookTitle,
      notebookSummary,
    };
  }

  if (tone === "concise") {
    const conciseBody =
      ctx.highlights.length > 0
        ? `Sharing **${ctx.title}** — ${ctx.highlights.slice(0, 2).join(" | ")}.`
        : `Sharing **${ctx.title}** (${ctx.domain}) for interactive inspection and verification.`;
    return {
      draft: `${conciseBody} ${tags}`.trim(),
      notebookTitle,
      notebookSummary,
    };
  }

  if (tone === "expand") {
    const bulletLines =
      ctx.highlights.length > 0
        ? ctx.highlights.map((h) => `- ${h}`).join("\n")
        : `- Domain: ${ctx.domain}\n- Interactive browser inspection & simulation ready`;
    const expanded = [
      `Sharing **${ctx.title}** for ${ctx.domain.toLowerCase()} verification and collaborative analysis.`,
      `### Key Engineering Highlights\n${bulletLines}`,
      `Open the attached artifact in the playground or workbench to inspect parameters, boundary conditions, and trajectories.\n\n${tags}`,
    ].join("\n\n");
    return {
      draft: expanded.trim(),
      notebookTitle,
      notebookSummary,
    };
  }

  // Default "technical" tone
  if (ctx.viewType === "package") {
    const draft = `Published package **${ctx.title}** (${highlightText}). Explore the modules, documentation, and interactive examples in the registry!\n\n${tags}`;
    return { draft: draft.trim(), notebookTitle, notebookSummary };
  }
  if (ctx.viewType === "repository") {
    const draft = `Sharing engineering repository **${ctx.title}** (${highlightText}). Clone or open directly in the ModelScript Web IDE to run simulations.\n\n${tags}`;
    return { draft: draft.trim(), notebookTitle, notebookSummary };
  }

  const detailSentence =
    ctx.highlights.length > 0
      ? `Key model characteristics: ${ctx.highlights.join("; ")}.`
      : `Configured for interactive ${ctx.domain.toLowerCase()} inspection and parameter exploration.`;

  const draft = `Exploring **${ctx.title}** in ${ctx.domain}. ${detailSentence}\n\n${tags}`;
  return {
    draft: draft.trim(),
    notebookTitle,
    notebookSummary,
  };
}

function cleanLLMOutput(raw: string): string {
  let cleaned = raw.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"') && !cleaned.slice(1, -1).includes('"')) ||
    (cleaned.startsWith("“") && cleaned.endsWith("”"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned;
}

export function buildDeterministicPolishedText(
  content: string,
  mode: ComposerPolishMode,
  artifactCtx?: ArtifactSummaryContext | null,
): { polished: string; domain: string; suggestedHashtags: string[] } {
  const trimmed = content.trim();
  if (!trimmed) {
    if (artifactCtx) {
      const drafted = buildDeterministicArtifactDraft(
        artifactCtx,
        mode === "concise" ? "concise" : mode === "expand" ? "expand" : "technical",
      );
      return {
        polished: drafted.draft,
        domain: artifactCtx.domain,
        suggestedHashtags: artifactCtx.suggestedHashtags,
      };
    }
    return { polished: "", domain: "Systems Engineering", suggestedHashtags: ["#ModelScript", "#Simulation"] };
  }

  let domain = artifactCtx?.domain || "Systems Engineering";
  let baseTags = artifactCtx?.suggestedHashtags ? [...artifactCtx.suggestedHashtags] : [];

  const lower = trimmed.toLowerCase();
  if (baseTags.length === 0) {
    if (/\b(modelica|dae|equation|der\(|pendulum|oscillator|thermal|damper)\b/.test(lower)) {
      domain = "Modelica & Physical Modeling";
      baseTags = ["#Modelica", "#DAE", "#Simulation"];
    } else if (/\b(cfd|navier|aerodynamic|turbulence|mach|airfoil|su2)\b/.test(lower)) {
      domain = "Computational Fluid Dynamics";
      baseTags = ["#CFD", "#Aerodynamics", "#FluidDynamics"];
    } else if (/\b(fea|stress|strain|von mises|structural|mesh|calculix)\b/.test(lower)) {
      domain = "Finite Element Structural Analysis";
      baseTags = ["#FEA", "#StructuralAnalysis", "#Mechanics"];
    } else if (/\b(sysml|requirement|mbse|architecture|block)\b/.test(lower)) {
      domain = "Systems Engineering & SysML v2";
      baseTags = ["#SysMLv2", "#MBSE", "#SystemsEngineering"];
    } else if (/\b(pscad|psse|microgrid|voltage|frequency|power|grid|inverter|ieee)\b/.test(lower)) {
      domain = "Power Systems & Grid Dynamics";
      baseTags = ["#PowerSystems", "#GridSimulation", "#EMT"];
    } else if (/\b(cad|step|scad|csg|geometry|3d)\b/.test(lower)) {
      domain = "3D CAD & Mechanical Geometry";
      baseTags = ["#CAD", "#3DModeling", "#Engineering"];
    } else if (/\b(fmu|fmi|ssp|cosim|co-simulation)\b/.test(lower)) {
      domain = "FMI Co-Simulation & Exchange";
      baseTags = ["#FMI", "#FMU", "#CoSimulation"];
    } else {
      baseTags = ["#ModelScript", "#Simulation", "#SystemsEngineering"];
    }
  }

  const existingHashtags = Array.from(trimmed.matchAll(/#([a-zA-Z0-9_]+)/g)).map((m) => `#${m[1]}`);
  const existingLower = new Set(existingHashtags.map((t) => t.toLowerCase()));
  const uniqueSuggestedTags = baseTags.filter((t) => !existingLower.has(t.toLowerCase())).slice(0, 4);

  if (mode === "hashtags") {
    const tagBlock = uniqueSuggestedTags.join(" ");
    const polished = tagBlock ? `${trimmed}\n\n${tagBlock}` : trimmed;
    return {
      polished,
      domain,
      suggestedHashtags: [...existingHashtags, ...uniqueSuggestedTags],
    };
  }

  if (mode === "expand") {
    const contextAddendum =
      artifactCtx && artifactCtx.highlights.length > 0
        ? `\n\n**Technical Context (${artifactCtx.title}):** ${artifactCtx.highlights.join(" · ")}.`
        : `\n\nVerified for reproducible ${domain.toLowerCase()} analysis and interactive parameter inspection.`;
    const tagSuffix = uniqueSuggestedTags.slice(0, 3).join(" ");
    return {
      polished: `${trimmed}${contextAddendum}${tagSuffix ? `\n\n${tagSuffix}` : ""}`.trim(),
      domain,
      suggestedHashtags: [...existingHashtags, ...uniqueSuggestedTags],
    };
  }

  return {
    polished: trimmed,
    domain,
    suggestedHashtags: [...existingHashtags, ...uniqueSuggestedTags],
  };
}

export class ComposerAIService {
  #database: LibraryDatabase;
  #llm: LLMProvider;

  constructor(database: LibraryDatabase, llmProvider?: LLMProvider) {
    this.#database = database;
    this.#llm = llmProvider || createDefaultLLMProvider();
  }

  async #resolveProviderForUser(
    userId?: number,
  ): Promise<{ provider: LLMProvider; model: string; isDeterministic: boolean }> {
    const defaultCloudModel = getDefaultCloudModelId();
    if (userId) {
      try {
        const bots = this.#database.getUserBots(userId);
        const byokBot = bots.find((b) => Boolean(b.bot_api_key && b.bot_api_key.trim()));
        if (byokBot && byokBot.bot_api_key) {
          return {
            provider: new OpenAICompatibleProvider(
              byokBot.bot_api_key,
              byokBot.bot_endpoint_url || "https://api.openai.com/v1",
            ),
            model: byokBot.bot_model || defaultCloudModel,
            isDeterministic: false,
          };
        }
      } catch {
        // Ignore lookup error and fall back to default provider
      }
    }

    if (!(this.#llm instanceof DeterministicEngineeringProvider)) {
      return {
        provider: this.#llm,
        model: defaultCloudModel,
        isDeterministic: false,
      };
    }

    // Check if local/server Ollama LLM is running (127.0.0.1:11434, host.docker.internal:11434, ollama:11434)
    const ollama = await discoverOllamaProvider({ preferTier: "fast" });
    if (ollama) {
      return {
        provider: ollama.provider,
        model: ollama.model,
        isDeterministic: false,
      };
    }

    return {
      provider: this.#llm,
      model: "modelscript-engineering-v1",
      isDeterministic: true,
    };
  }

  #loadArtifactContext(
    artifactId?: number,
    artifactMeta?: DraftFromArtifactInput["artifactMeta"],
  ): ArtifactSummaryContext {
    if (artifactId && Number.isFinite(artifactId)) {
      const row = this.#database.getArtifactView(Number(artifactId));
      if (row) {
        return classifyArtifactAndExtractSummary({
          artifactId: Number(artifactId),
          viewType: row.view_type,
          title: row.title || undefined,
          viewConfig: row.view_config,
        });
      }
    }
    return classifyArtifactAndExtractSummary({
      artifactId,
      viewType: artifactMeta?.viewType,
      title: artifactMeta?.title,
      viewConfig: artifactMeta?.viewConfig,
    });
  }

  async draftFromArtifact(input: DraftFromArtifactInput): Promise<DraftFromArtifactResult> {
    const primaryId = input.artifactId ?? input.artifactIds?.[0];
    const ctx = this.#loadArtifactContext(primaryId, input.artifactMeta);
    const tone: ComposerDraftTone = input.tone || "technical";
    const fallback = buildDeterministicArtifactDraft(ctx, tone, input.existingText);

    const { provider, model, isDeterministic } = await this.#resolveProviderForUser(input.userId);
    if (isDeterministic) {
      return {
        draft: fallback.draft,
        notebookTitle: fallback.notebookTitle,
        notebookSummary: fallback.notebookSummary,
        domain: ctx.domain,
        highlights: ctx.highlights,
        hashtags: ctx.suggestedHashtags,
        suggestedHashtags: ctx.suggestedHashtags,
        source: "remote-deterministic",
        provider: "remote-deterministic",
        model,
      };
    }

    const systemPrompt = `Draft a concise technical social post introducing "${ctx.title}" (${ctx.domain}).
Rules:
- Mention the exact title "${ctx.title}".
- Style: ${tone === "concise" ? "1-2 short sentences" : tone === "expand" ? "include a '## Key Highlights' heading and 2-3 bullet points" : "2-3 technical sentences"}.
- End with hashtags: ${ctx.suggestedHashtags.join(" ")}.
- Output ONLY the post markdown without quotes.`;

    const userPrompt = [
      `Title: ${ctx.title} (${ctx.viewType})`,
      ctx.highlights.length > 0 ? `Highlights: ${ctx.highlights.join("; ")}` : "",
      input.existingText?.trim() ? `Notes: "${input.existingText.trim()}"` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const messages: LLMMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
      const response = await provider.complete(messages, {
        model,
        temperature: 0.3,
        maxTokens: tone === "concise" ? 80 : 140,
        reasoningEffort: "none",
      });
      const text = cleanLLMOutput(response.content || "");
      if (text && !text.startsWith("I have received your request:")) {
        const finalDraft = tone === "expand" && !text.includes("##") ? `## ${ctx.title}\n\n${text}` : text;
        return {
          draft: finalDraft,
          notebookTitle: fallback.notebookTitle,
          notebookSummary: fallback.notebookSummary,
          domain: ctx.domain,
          highlights: ctx.highlights,
          hashtags: ctx.suggestedHashtags,
          suggestedHashtags: ctx.suggestedHashtags,
          source: "remote-llm",
          provider: "remote-llm",
          model: response.model || model,
        };
      }
    } catch {
      // Fall back to deterministic engineering draft
    }

    return {
      draft: fallback.draft,
      notebookTitle: fallback.notebookTitle,
      notebookSummary: fallback.notebookSummary,
      domain: ctx.domain,
      highlights: ctx.highlights,
      hashtags: ctx.suggestedHashtags,
      suggestedHashtags: ctx.suggestedHashtags,
      source: "remote-deterministic",
      provider: "remote-deterministic",
      model,
    };
  }

  async polishContent(input: PolishContentInput): Promise<PolishContentResult> {
    const mode: ComposerPolishMode = input.mode || "polish";
    const artifactCtx = input.artifactId ? this.#loadArtifactContext(input.artifactId) : null;
    const fallback = buildDeterministicPolishedText(input.content, mode, artifactCtx);

    const { provider, model, isDeterministic } = await this.#resolveProviderForUser(input.userId);
    if (isDeterministic || !input.content.trim()) {
      return {
        polished: fallback.polished,
        mode,
        domain: fallback.domain,
        hashtags: fallback.suggestedHashtags,
        suggestedHashtags: fallback.suggestedHashtags,
        source: "remote-deterministic",
        provider: "remote-deterministic",
        model,
      };
    }

    const modeInstructions: Record<ComposerPolishMode, string> = {
      polish:
        "Correct all spelling errors, typos, grammar mistakes, capitalization, and punctuation while lightly polishing the text for clarity. Keep the user's original intent and tone. Do NOT add hashtags unless hashtags were already present in the input.",
      concise:
        "Correct all spelling and grammar errors, and condense the text into a concise, direct, punchy version. Do NOT add hashtags unless hashtags were already present.",
      expand:
        "Correct all spelling and grammar errors, expand the post with 1-2 sentences of technical context, and include 2-3 relevant engineering hashtags at the end.",
      hashtags:
        "Correct any spelling or grammar errors in the text and append 3-4 relevant engineering hashtags at the end without duplicating existing hashtags.",
    };

    const systemPrompt = [
      "You are an AI writing assistant integrated into the ModelScript social composer.",
      `Task: ${modeInstructions[mode]}`,
      "Rules:",
      "- Preserve all @mentions (e.g. @alice, @user@domain), existing #hashtags, LaTeX math ($...$, $$...$$), code blocks (```...```), and ::artifact[...]{...} directives verbatim.",
      "- Output ONLY the revised text. Do NOT wrap the output in quotes and do NOT include any preamble or explanation.",
    ].join("\n");

    const userPrompt =
      artifactCtx && (mode === "expand" || mode === "hashtags")
        ? `Attached Artifact Context: ${artifactCtx.title} (${artifactCtx.domain} — ${artifactCtx.highlights.join(", ")})\n\nText to revise:\n${input.content}`
        : input.content;

    try {
      const messages: LLMMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
      const maxTokens = mode === "expand" ? 180 : Math.min(300, Math.max(60, Math.ceil(input.content.length * 0.6)));
      const response = await provider.complete(messages, {
        model,
        temperature: 0.2,
        maxTokens,
        reasoningEffort: "none",
      });
      const text = cleanLLMOutput(response.content || "");
      if (text && !text.startsWith("I have received your request:")) {
        return {
          polished: text,
          mode,
          domain: fallback.domain,
          hashtags: fallback.suggestedHashtags,
          suggestedHashtags: fallback.suggestedHashtags,
          source: "remote-llm",
          provider: "remote-llm",
          model: response.model || model,
        };
      }
    } catch {
      // Fall back to deterministic engineering polisher
    }

    return {
      polished: fallback.polished,
      mode,
      domain: fallback.domain,
      hashtags: fallback.suggestedHashtags,
      suggestedHashtags: fallback.suggestedHashtags,
      source: "remote-deterministic",
      provider: "remote-deterministic",
      model,
    };
  }
}

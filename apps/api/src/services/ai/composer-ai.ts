// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LibraryDatabase } from "../../database.js";
import { extractTopics } from "../../util/extract-topics.js";
import {
  createDefaultLLMProvider,
  DeterministicEngineeringProvider,
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

export function buildDeterministicPolishedText(
  rawContent: string,
  mode: ComposerPolishMode = "polish",
  artifactCtx?: ArtifactSummaryContext | null,
): { polished: string; domain: string; suggestedHashtags: string[] } {
  const trimmed = rawContent.trim();
  const domain = artifactCtx?.domain || "Multi-Domain Systems Engineering";

  // Extract existing hashtags & topics
  const existingHashtags = Array.from(new Set(trimmed.match(/#[a-zA-Z0-9_-]+/g) || []));
  const topics = extractTopics(trimmed);
  const derivedTags: string[] = [...(artifactCtx?.suggestedHashtags || [])];

  if (/\b(modelica|dae|der|oscillator|pendulum|equation)\b/i.test(trimmed)) {
    derivedTags.push("#Modelica", "#DAE", "#Simulation");
  }
  if (/\b(cfd|mach|airfoil|navier|turbulence|su2|openfoam)\b/i.test(trimmed)) {
    derivedTags.push("#CFD", "#Aerodynamics");
  }
  if (/\b(fea|stress|von\s*mises|mesh|calculix|structural)\b/i.test(trimmed)) {
    derivedTags.push("#FEA", "#StructuralAnalysis");
  }
  if (/\b(pscad|psse|grid|bus|transformer|fault|ieee)\b/i.test(trimmed)) {
    derivedTags.push("#PowerSystems", "#GridSimulation");
  }
  if (/\b(sysml|requirement|mbse|architecture)\b/i.test(trimmed)) {
    derivedTags.push("#SysMLv2", "#MBSE");
  }
  if (/\b(fmu|fmi|ssp|cosim)\b/i.test(trimmed)) {
    derivedTags.push("#FMI", "#CoSimulation");
  }
  if (/\b(cad|step|csg|geometry|scad)\b/i.test(trimmed)) {
    derivedTags.push("#CAD", "#3DGeometry");
  }

  for (const t of topics) {
    const clean = t.displayName.replace(/[^a-zA-Z0-9]/g, "");
    if (clean.length >= 4 && derivedTags.length < 6) {
      derivedTags.push(`#${clean.charAt(0).toUpperCase()}${clean.slice(1)}`);
    }
  }

  if (derivedTags.length === 0) {
    derivedTags.push("#ModelScript", "#Engineering", "#Simulation");
  }

  const uniqueSuggestedTags: string[] = [];
  for (const tag of derivedTags) {
    if (
      !uniqueSuggestedTags.some((u) => u.toLowerCase() === tag.toLowerCase()) &&
      !existingHashtags.some((e) => e.toLowerCase() === tag.toLowerCase())
    ) {
      uniqueSuggestedTags.push(tag);
    }
    if (uniqueSuggestedTags.length >= 4) break;
  }

  if (!trimmed) {
    if (artifactCtx) {
      const drafted = buildDeterministicArtifactDraft(artifactCtx, "technical");
      return {
        polished: drafted.draft,
        domain,
        suggestedHashtags: artifactCtx.suggestedHashtags,
      };
    }
    return { polished: "", domain, suggestedHashtags: uniqueSuggestedTags };
  }

  if (mode === "hashtags") {
    const tagsToAdd = uniqueSuggestedTags.slice(0, 3);
    const polished = tagsToAdd.length > 0 ? `${trimmed}\n\n${tagsToAdd.join(" ")}` : trimmed;
    return {
      polished,
      domain,
      suggestedHashtags: [...existingHashtags, ...tagsToAdd],
    };
  }

  // Protect code blocks, inline math, and ::artifact directives while polishing prose
  const preservedBlocks: string[] = [];
  const placeholderText = trimmed.replace(
    /(```[\s\S]*?```|\$\$[\s\S]*?\$\$|::artifact(?:\[[^[\]\r\n]*\])?\{[^{}\r\n]*\})/g,
    (match) => {
      const idx = preservedBlocks.length;
      preservedBlocks.push(match);
      return `__MS_PRESERVED_${idx}__`;
    },
  );

  // Clean whitespace and sentence capitalization on prose segments
  let normalizedProse = placeholderText
    .replace(/[ \t]+/g, " ")
    .replace(/\bi\b/g, "I")
    .replace(/\bim\b/gi, "I'm")
    .replace(/\bdont\b/gi, "don't")
    .replace(/\bcant\b/gi, "can't")
    .replace(/\bwont\b/gi, "won't")
    .trim();

  // Capitalize first letter if it starts with a lowercase letter (not @mention or #hashtag or placeholder)
  if (/^[a-z]/.test(normalizedProse)) {
    normalizedProse = normalizedProse.charAt(0).toUpperCase() + normalizedProse.slice(1);
  }

  // Ensure terminal punctuation before trailing hashtags or end of sentence
  const trailingTagsMatch = normalizedProse.match(/((?:\s+#[a-zA-Z0-9_-]+)+)\s*$/);
  const trailingTags = trailingTagsMatch ? trailingTagsMatch[1]!.trim() : "";
  let mainBody = trailingTagsMatch
    ? normalizedProse.slice(0, normalizedProse.length - trailingTagsMatch[0].length).trim()
    : normalizedProse;

  if (mainBody && !/[.!?`:_]$/.test(mainBody)) {
    mainBody += ".";
  }

  if (mode === "concise") {
    mainBody = mainBody
      .replace(/\b(?:just wanted to share|i wanted to share|here is a quick look at|check out this)\b\s*/gi, "Sharing ")
      .replace(/\b(?:in order to)\b/gi, "to")
      .replace(/\b(?:due to the fact that)\b/gi, "because")
      .replace(/\b(?:at this point in time)\b/gi, "now")
      .replace(/\s+/g, " ")
      .trim();
    if (/^[a-z]/.test(mainBody)) {
      mainBody = mainBody.charAt(0).toUpperCase() + mainBody.slice(1);
    }
    const restored = mainBody.replace(/__MS_PRESERVED_(\d+)__/g, (_m, idxStr) => preservedBlocks[Number(idxStr)] || "");
    const finalTags = trailingTags || uniqueSuggestedTags.slice(0, 2).join(" ");
    return {
      polished: finalTags ? `${restored} ${finalTags}`.trim() : restored,
      domain,
      suggestedHashtags: [...existingHashtags, ...uniqueSuggestedTags],
    };
  }

  if (mode === "expand") {
    const restored = mainBody.replace(/__MS_PRESERVED_(\d+)__/g, (_m, idxStr) => preservedBlocks[Number(idxStr)] || "");
    const contextAddendum =
      artifactCtx && artifactCtx.highlights.length > 0
        ? `\n\n**Technical Context (${artifactCtx.title}):** ${artifactCtx.highlights.join(" · ")}.`
        : `\n\nVerified for reproducible ${domain.toLowerCase()} analysis and interactive parameter inspection.`;
    const allTags = trailingTags
      ? `${trailingTags} ${uniqueSuggestedTags.slice(0, 2).join(" ")}`.trim()
      : uniqueSuggestedTags.slice(0, 3).join(" ");
    return {
      polished: `${restored}${contextAddendum}${allTags ? `\n\n${allTags}` : ""}`.trim(),
      domain,
      suggestedHashtags: [...existingHashtags, ...uniqueSuggestedTags],
    };
  }

  // Default "polish" mode: clean technical phrasing + ensure hashtags
  mainBody = mainBody
    .replace(/^hey\s+(?:everyone|guys|folks)[,!\s]*/i, "")
    .replace(/\bcheck out my\b/gi, "Exploring our")
    .replace(/\bi made a\b/gi, "Developed a");

  if (/^[a-z]/.test(mainBody)) {
    mainBody = mainBody.charAt(0).toUpperCase() + mainBody.slice(1);
  }

  if (artifactCtx && !mainBody.toLowerCase().includes(artifactCtx.title.toLowerCase()) && mainBody.length < 90) {
    const highlightSnippet = artifactCtx.highlights[0] ? ` (${artifactCtx.highlights[0]})` : "";
    mainBody = `${mainBody} Attached: **${artifactCtx.title}**${highlightSnippet}.`;
  }

  const restored = mainBody.replace(/__MS_PRESERVED_(\d+)__/g, (_m, idxStr) => preservedBlocks[Number(idxStr)] || "");
  const effectiveTags = trailingTags || uniqueSuggestedTags.slice(0, 3).join(" ");

  return {
    polished: effectiveTags ? `${restored}\n\n${effectiveTags}`.trim() : restored,
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

  #resolveProviderForUser(userId?: number): { provider: LLMProvider; model: string; isDeterministic: boolean } {
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
            model: byokBot.bot_model || "gemini-1.5-flash",
            isDeterministic: false,
          };
        }
      } catch {
        // Ignore lookup error and fall back to default provider
      }
    }
    const isDeterministic = this.#llm instanceof DeterministicEngineeringProvider;
    return {
      provider: this.#llm,
      model: isDeterministic ? "modelscript-engineering-v1" : "gemini-1.5-flash",
      isDeterministic,
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

    const { provider, model, isDeterministic } = this.#resolveProviderForUser(input.userId);
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

    const systemPrompt = `You are ModelScript AI Composer Assistant for an engineering and scientific modeling platform.
Draft a concise, engaging, technically accurate social post introducing the user's attached engineering artifact.
Rules:
- Highlight specific model parameters, equations, or simulation metrics when provided.
- Keep the tone ${tone === "concise" ? "ultra-concise (1-2 sentences)" : tone === "expand" ? "detailed with bulleted technical takeaways" : "professional, insightful, and technical (2-4 sentences)"}.
- Include 2-4 relevant hashtags at the end (${ctx.suggestedHashtags.join(" ")}).
- Output ONLY the post markdown text without surrounding quotes or preamble.`;

    const userPrompt = [
      `Artifact Title: ${ctx.title}`,
      `Artifact Type: ${ctx.viewType} (${ctx.domain})`,
      ctx.highlights.length > 0 ? `Extracted Telemetry & Highlights: ${ctx.highlights.join("; ")}` : "",
      ctx.codeExcerpt ? `Code Excerpt:\n\`\`\`\n${ctx.codeExcerpt}\n\`\`\`` : "",
      input.existingText?.trim() ? `User's current notes/text: "${input.existingText.trim()}"` : "",
      `Please draft the post in "${tone}" style.`,
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
        temperature: 0.4,
        maxTokens: 400,
      });
      const text = response.content?.trim();
      if (text && !text.startsWith("I have received your request:")) {
        return {
          draft: text,
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

    const { provider, model, isDeterministic } = this.#resolveProviderForUser(input.userId);
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
        "Improve clarity, grammar, technical precision, and flow while keeping the author's voice. Append 2-3 relevant engineering hashtags if none are present.",
      concise: "Condense and tighten the text into a punchy, high-signal engineering post with zero fluff.",
      expand:
        "Expand the post with deeper technical context, physical modeling significance, and structured takeaways.",
      hashtags:
        "Keep the existing text intact and append 3-4 highly relevant engineering domain hashtags at the end without duplicating existing tags.",
    };

    const systemPrompt = `You are ModelScript AI Writing Polish Assistant for systems engineers and researchers.
Task: ${modeInstructions[mode]}
Critical rules:
- Preserve all @mentions (e.g. @alice, @user@domain), existing #hashtags, LaTeX math ($...$, $$...$$), code blocks (\`\`\`...\`\`\`), and ::artifact[...]{...} directives verbatim.
- Output ONLY the revised post text without any explanation, quotes, or conversational filler.`;

    const userPrompt = [
      artifactCtx
        ? `Attached Artifact Context: ${artifactCtx.title} (${artifactCtx.domain} — ${artifactCtx.highlights.join(", ")})`
        : "",
      `Original Post Text:\n${input.content}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const messages: LLMMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];
      const response = await provider.complete(messages, {
        model,
        temperature: 0.3,
        maxTokens: 500,
      });
      const text = response.content?.trim();
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

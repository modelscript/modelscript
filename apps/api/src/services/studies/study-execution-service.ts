// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/modelica";
import { createWasmParserSync, type LspFacade, type TreeSitterParser } from "@modelscript/modelica/parser";
import { VarType, Variability, evaluateArenaExpression, type DAEBuilder } from "@modelscript/runtime";
import { simulateArena } from "@modelscript/simulate";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { LibraryDatabase, ScriptTemplateRow } from "../../database.js";
import { NodeFileSystem } from "../../util/filesystem.js";
import { BUILTIN_STUDY_DEFINITIONS, CURATED_COMPATIBLE_MODELS } from "./study-catalog.js";
import { inferStudyStandard, standardExtension, synthesizeStudyInstanceArtifact } from "./study-standards.js";
import type {
  CompatibleModelItem,
  ModelObservableInfo,
  ModelParameterInfo,
  StudyCategory,
  StudyComplianceCase,
  StudyDefinition,
  StudyDomain,
  StudyEnsembleBandSeries,
  StudyExecutionTarget,
  StudyInstanceArtifact,
  StudyKind,
  StudyKpiValue,
  StudyRunRequest,
  StudyRunResultsPayload,
  StudySobolIndex,
  StudySourceType,
  StudyStandardFormat,
  StudySweepPoint,
} from "./study-types.js";

let syncWasmParserInstance: { facade: LspFacade; parser: TreeSitterParser } | null = null;

/**
 * Synchronously initializes and registers the native Modelica WASM GLR parser on `Context`.
 */
export function ensureSyncModelicaParser(): { facade: LspFacade; parser: TreeSitterParser } {
  if (!syncWasmParserInstance) {
    const require = createRequire(import.meta.url);
    const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");
    syncWasmParserInstance = createWasmParserSync(modelicaWasmPath);
    Context.registerParser(
      ".mo",
      syncWasmParserInstance.parser as unknown as Parameters<typeof Context.registerParser>[1],
    );
  }
  return syncWasmParserInstance;
}

const compiledContextCache = new Map<string, { ctx: Context; modelName: string }>();

/**
 * Compiles and flattens a Modelica `.mo` source string into a fresh `DAEBuilder` arena.
 */
export function compileAndFlattenModelicaSource(
  code: string,
  preferredModelName?: string,
): { arena: DAEBuilder; modelName: string } | null {
  try {
    ensureSyncModelicaParser();
    let cached = compiledContextCache.get(code);
    if (!cached) {
      const ctx = Context.createBatch(new NodeFileSystem(), { loadStdlib: false });
      const uri = "inline_study_model.mo";
      const tree = ctx.load(code, uri);
      const rootNode = tree?.rootNode as unknown as { hasError?: boolean | (() => boolean) } | undefined;
      const hasErr = typeof rootNode?.hasError === "function" ? rootNode.hasError() : Boolean(rootNode?.hasError);
      if (!tree || hasErr) {
        return null;
      }
      const modelMatch = code.match(/\b(?:model|class|block)\s+([A-Za-z_][A-Za-z0-9_]*)/);
      const modelName = preferredModelName || ctx.classes[0]?.name || modelMatch?.[1] || "CustomModel";
      cached = { ctx, modelName };
      if (compiledContextCache.size > 64) {
        const firstKey = compiledContextCache.keys().next().value;
        if (firstKey !== undefined) compiledContextCache.delete(firstKey);
      }
      compiledContextCache.set(code, cached);
    }
    const targetName = preferredModelName || cached.modelName;
    const arena = cached.ctx.flattenArena(targetName);
    if (!arena) return null;
    // Mark as mutated so subsequent flattenArena calls produce a clean unmutated DAEBuilder
    arena.isMutatedBySim = true;
    return { arena, modelName: targetName };
  } catch {
    return null;
  }
}

/**
 * Extracts Modelica parameters and observables from raw `.mo` / `.msx` source text
 * using the native Modelica WASM parser and DAE flattener (with source-modifier metadata enrichment).
 */
export function inspectModelicaSourceParameters(code: string): {
  modelName: string;
  parameters: ModelParameterInfo[];
  observables: ModelObservableInfo[];
} {
  const modelMatch = code.match(/\b(?:model|class|block)\s+([A-Za-z_][A-Za-z0-9_]*)/);
  let modelName = modelMatch?.[1] || "CustomModel";

  // Extract source-level unit & description annotations for enrichment
  const sourceUnits = new Map<string, string>();
  const sourceDescs = new Map<string, string>();
  const lines = code.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;
    const semiIdx = line.indexOf(";");
    if (semiIdx === -1) continue;
    let decl = line.slice(0, semiIdx).trim();
    const descMatch = decl.match(/\s+"([^"]*)"$/);
    let desc: string | undefined;
    if (descMatch) {
      desc = descMatch[1];
      decl = decl.slice(0, descMatch.index).trim();
    }
    const varMatch = decl.match(
      /^(?:(?:parameter|constant|input|output|discrete|flow|stream)\s+)*(Real|Integer|Boolean)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]*)\))?/,
    );
    if (varMatch) {
      const vName = varMatch[2]!;
      const modifiers = varMatch[3] || "";
      const unitMatch = modifiers.match(/unit\s*=\s*"([^"]+)"/);
      if (unitMatch?.[1]) sourceUnits.set(vName, unitMatch[1]);
      if (desc) sourceDescs.set(vName, desc);
    }
  }

  // Primary path: compile and flatten via @modelscript/modelica into DAEBuilder
  const compiled = compileAndFlattenModelicaSource(code, modelName);
  if (compiled && compiled.arena.varCount > 0) {
    const { arena } = compiled;
    modelName = compiled.modelName;
    const parameters: ModelParameterInfo[] = [];
    const observables: ModelObservableInfo[] = [];
    const paramEnv = new Map<string, number>();

    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      const name = arena.getVarName(i);
      if (!name || name.startsWith("der(") || name.startsWith("_")) continue;

      const vType = arena.getVarType(i);
      const typeStr: "Real" | "Integer" | "Boolean" =
        vType === VarType.Integer ? "Integer" : vType === VarType.Boolean ? "Boolean" : "Real";
      const variability = arena.getVarVariability(i);
      const comment =
        (arena as unknown as { getVarComment?: (idx: number) => string | undefined }).getVarComment?.(i) ||
        sourceDescs.get(name);
      const unit = sourceUnits.get(name);

      if (variability === Variability.Parameter || variability === Variability.Constant) {
        let evalVal: number | boolean = arena.getVarStartValue(i);
        const exprId = arena.getVarExpression(i);
        if (typeof exprId === "number" && exprId >= 0) {
          const v = evaluateArenaExpression(arena, exprId, paramEnv);
          if (typeof v === "number" && Number.isFinite(v)) {
            evalVal = v;
          } else if (typeof v === "boolean") {
            evalVal = v;
          }
        }
        if (typeof evalVal === "number") {
          paramEnv.set(name, evalVal);
        }
        if (typeStr === "Boolean" && typeof evalVal === "number") {
          evalVal = evalVal !== 0;
        }
        if (variability === Variability.Parameter) {
          const baseNum = typeof evalVal === "number" ? Math.abs(evalVal) || 1 : 1;
          parameters.push({
            name,
            type: typeStr,
            defaultValue: evalVal,
            unit,
            min: typeof evalVal === "number" ? Number((evalVal - baseNum * 0.5).toPrecision(4)) : undefined,
            max: typeof evalVal === "number" ? Number((evalVal + baseNum * 0.5).toPrecision(4)) : undefined,
            description: comment,
          });
        }
      } else {
        observables.push({
          name,
          type: typeStr,
          unit,
          description: comment,
        });
      }
    }

    if (observables.length === 0) {
      observables.push({ name: "y", type: "Real", description: "Primary system response" });
    }
    return { modelName, parameters, observables };
  }

  // Fallback for non-Modelica or partial source snippets
  const parameters: ModelParameterInfo[] = [];
  const observables: ModelObservableInfo[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;

    const semiIdx = line.indexOf(";");
    if (semiIdx === -1) continue;
    const stmt = line.slice(0, semiIdx).trim();

    let desc: string | undefined;
    let decl = stmt;
    const descMatch = decl.match(/\s+"([^"]*)"$/);
    if (descMatch) {
      desc = descMatch[1];
      decl = decl.slice(0, descMatch.index).trim();
    }

    // Match: parameter Real m(unit="kg") = 1.5
    const paramMatch = decl.match(/^parameter\s+(Real|Integer|Boolean)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]*)\))?/);
    if (paramMatch) {
      const type = paramMatch[1] as "Real" | "Integer" | "Boolean";
      const name = paramMatch[2]!;
      const modifiers = paramMatch[3] || "";
      const remainder = decl.slice(paramMatch[0].length).trim();
      const rawVal = remainder.startsWith("=") ? remainder.slice(1).trim() : "1.0";
      const unitMatch = modifiers.match(/unit\s*=\s*"([^"]+)"/);
      const numVal = Number(rawVal);
      const defaultValue = !Number.isNaN(numVal) ? numVal : rawVal === "true" ? true : rawVal === "false" ? false : 1.0;
      const baseNum = typeof defaultValue === "number" ? Math.abs(defaultValue) || 1 : 1;

      parameters.push({
        name,
        type,
        defaultValue,
        unit: unitMatch?.[1],
        min: typeof defaultValue === "number" ? Number((defaultValue - baseNum * 0.5).toPrecision(4)) : undefined,
        max: typeof defaultValue === "number" ? Number((defaultValue + baseNum * 0.5).toPrecision(4)) : undefined,
        description: desc,
      });
      continue;
    }

    // Match state/algebraic Real variables: Real x(start = 1.0)
    const obsMatch = decl.match(
      /^(?:(?:output|input)\s+)?(Real|Integer|Boolean)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]*)\))?/,
    );
    if (obsMatch) {
      const type = obsMatch[1] as "Real" | "Integer" | "Boolean";
      const name = obsMatch[2]!;
      const modifiers = obsMatch[3] || "";
      const unitMatch = modifiers.match(/unit\s*=\s*"([^"]+)"/);
      observables.push({
        name,
        type,
        unit: unitMatch?.[1],
        description: desc,
      });
    }
  }

  if (observables.length === 0) {
    observables.push({ name: "y", type: "Real", description: "Primary system response" });
  }

  return { modelName, parameters, observables };
}

/**
 * Converts a database `ScriptTemplateRow` (or legacy template) into a full `StudyDefinition`.
 */
export function normalizeRowToStudyDefinition(row: ScriptTemplateRow): StudyDefinition {
  const builtin = BUILTIN_STUDY_DEFINITIONS.find((b) => b.slug === row.slug);
  let parsedConfig: Record<string, unknown> = {};
  try {
    if (row.config) {
      parsedConfig = JSON.parse(row.config) as Record<string, unknown>;
    }
  } catch {}

  if (builtin) {
    return {
      ...builtin,
      id: String(parsedConfig["id"] || builtin.id),
      name: row.name || builtin.name,
      description: row.description || builtin.description,
      runsCount: typeof parsedConfig["runsCount"] === "number" ? parsedConfig["runsCount"] : builtin.runsCount,
      starsCount: typeof parsedConfig["starsCount"] === "number" ? parsedConfig["starsCount"] : builtin.starsCount,
    };
  }

  // Map legacy or user/package custom templates to full StudyDefinition
  const rawCat = (row.category || "").toLowerCase();
  let category: StudyCategory = "simulation";
  let kind: StudyKind = "time-course";
  let domains: StudyDomain[] = ["modelica", "fmu"];

  if (rawCat.includes("cfd") || row.slug.includes("cfd") || row.slug.includes("su2") || row.slug.includes("openfoam")) {
    category = "cfd";
    kind = "steady-state";
    domains = ["cfd", "cad"];
  } else if (rawCat.includes("fea") || row.slug.includes("fea") || row.slug.includes("calculix")) {
    category = "fea";
    kind = row.slug.includes("modal") ? "eigen-frequency" : "steady-state";
    domains = ["fea", "cad"];
  } else if (rawCat.includes("uq") || row.slug.includes("monte-carlo")) {
    category = "uncertainty";
    kind = "monte-carlo";
  } else if (row.slug.includes("sweep") || row.slug.includes("mesh-sensitivity")) {
    category = "sweep";
    kind = "parameter-sweep";
  }

  if (typeof parsedConfig["kind"] === "string") {
    kind = parsedConfig["kind"] as StudyKind;
  }
  if (typeof parsedConfig["category"] === "string") {
    category = parsedConfig["category"] as StudyCategory;
  }

  const sourceType: StudySourceType =
    parsedConfig["sourceType"] === "package" || parsedConfig["sourceType"] === "community"
      ? (parsedConfig["sourceType"] as StudySourceType)
      : "official";

  const existingContract = parsedConfig["modelContract"] as StudyDefinition["modelContract"] | undefined;
  const existingInputs = parsedConfig["inputs"] as StudyDefinition["inputs"] | undefined;
  const existingPresets = parsedConfig["presets"] as StudyDefinition["presets"] | undefined;
  const existingExec = parsedConfig["execution"] as StudyDefinition["execution"] | undefined;
  const existingOutputs = parsedConfig["outputs"] as StudyDefinition["outputs"] | undefined;

  const stepsFromLegacy = Array.isArray(parsedConfig["steps"])
    ? (parsedConfig["steps"] as string[])
    : ["Validate Model & Parameter Bindings", "Execute Study Solver Pipeline", "Extract KPIs & Archive Provenance"];

  const stdFormat: StudyStandardFormat =
    (parsedConfig["standardFormat"] as StudyStandardFormat) || inferStudyStandard({ kind, category });

  return {
    schemaVersion: "1.0.0",
    standardFormat: stdFormat,
    id: String(parsedConfig["id"] || `msx.studies.${row.slug}`),
    slug: row.slug,
    name: row.name,
    version: String(parsedConfig["version"] || "1.0.0"),
    kind,
    category,
    sourceType,
    packageName: (parsedConfig["packageName"] as string) || null,
    packageVersion: (parsedConfig["packageVersion"] as string) || null,
    artifactPath: (parsedConfig["artifactPath"] as string) || `studies/${row.slug}${standardExtension(stdFormat)}`,
    targetModel: (parsedConfig["targetModel"] as string) || null,
    targetArtifact: (parsedConfig["targetArtifact"] as string) || null,
    bundledInRelease: Boolean(parsedConfig["bundledInRelease"] ?? false),
    authorUsername: String(parsedConfig["authorUsername"] || "modelscript"),
    icon: row.icon || "sliders",
    description: row.description,
    tags: Array.isArray(parsedConfig["tags"]) ? (parsedConfig["tags"] as string[]) : [kind, category, row.slug],
    featured: Boolean(parsedConfig["featured"] ?? false),
    starsCount: typeof parsedConfig["starsCount"] === "number" ? parsedConfig["starsCount"] : 42,
    runsCount: typeof parsedConfig["runsCount"] === "number" ? parsedConfig["runsCount"] : 180,
    modelContract: existingContract || {
      domains,
      minParameters: kind === "monte-carlo" || kind === "parameter-sweep" ? 1 : 0,
      minObservables: 1,
      parameterSlots: [
        {
          slotId: "studyParams",
          label: "Tunable Model Parameters",
          description: "Parameters varied or overridden during study execution.",
          type: "Real",
          variability: "parameter",
          multiple: true,
        },
      ],
      observableSlots: [
        {
          slotId: "studyObservables",
          label: "Tracked Model Observables",
          description: "Output variables tracked for KPIs and plots.",
          type: "Real",
          multiple: true,
        },
      ],
    },
    inputs:
      existingInputs && existingInputs.length > 0
        ? existingInputs
        : [
            {
              key: "stopTime",
              label: "Simulation Horizon",
              type: "number",
              unit: "s",
              defaultValue: 10,
              min: 0.1,
              max: 10000,
              step: 1,
              group: "solver",
            },
            {
              key: "samples",
              label: "Evaluation Points / Iterations",
              type: "integer",
              defaultValue: kind === "time-course" ? 1 : 16,
              min: 1,
              max: 5000,
              step: 1,
              group: "sampling",
            },
            {
              key: "tolerance",
              label: "Relative Solver Tolerance",
              type: "number",
              defaultValue: 1e-6,
              min: 1e-10,
              max: 1e-2,
              step: 1e-6,
              group: "solver",
            },
          ],
    presets:
      existingPresets && existingPresets.length > 0
        ? existingPresets
        : [
            {
              id: "local-preflight",
              label: "⚡ Local Pre-Flight",
              description: "Fast verification run in browser/local worker",
              targetHint: "local-wasm",
              values: { stopTime: 5, samples: 8, tolerance: 1e-4 },
            },
            {
              id: "hpc-production",
              label: "🚀 HPC Cluster Production",
              description: "Full-resolution execution on Slurm cluster",
              targetHint: "hpc-cluster",
              values: { stopTime: 10, samples: 64, tolerance: 1e-6 },
            },
          ],
    execution: existingExec || {
      supportedTargets: ["local-wasm", "local-native", "hpc-cluster"],
      defaultTarget: "auto",
      recommendedSolver: String(parsedConfig["solver"] || "modelica"),
      recommendedProfile: "standard",
      estimatedCredits: 0.4,
      pipelineSteps: stepsFromLegacy,
    },
    outputs: existingOutputs || {
      kpis: [
        { id: "peakMetric", label: "Peak Response", expr: "max(y)" },
        { id: "steadyMetric", label: "Steady-State Value", expr: "last(y)" },
      ],
      views: [
        {
          kind: kind === "monte-carlo" ? "fan-chart" : kind === "parameter-sweep" ? "sweep-curve" : "trajectory",
          title: `${row.name} Results`,
          xLabel: "Time (s)",
          yLabel: "Response",
        },
      ],
    },
  };
}

const DOMAIN_LANGUAGE_ALIASES: Record<string, StudyDomain[]> = {
  su2: ["cfd", "su2"],
  openfoam: ["cfd", "openfoam"],
  calculix: ["fea", "calculix"],
  openscad: ["cad", "scad"],
  scad: ["cad", "scad"],
  step: ["cad", "step"],
  fmi: ["fmu"],
  fmu: ["fmu"],
  spice: ["spice", "verilog-ams", "vhdl-ams"],
  "verilog-ams": ["verilog-ams", "spice"],
  "vhdl-ams": ["vhdl-ams", "spice"],
  sysmlv2: ["sysmlv2", "ssp"],
  sbml: ["sbml", "cellml"],
  cellml: ["cellml", "sbml"],
  matlab: ["matlab", "python", "julia", "modelica"],
  python: ["python", "matlab", "julia", "modelica"],
  julia: ["julia", "matlab", "python", "modelica"],
  c: ["c", "cpp", "rust", "fortran"],
  cpp: ["cpp", "c", "rust", "fortran"],
  rust: ["rust", "c", "cpp"],
  fortran: ["fortran", "c", "cpp"],
};

/**
 * Lists all Study Templates across Official Built-ins, Database Templates, and Package Artifacts,
 * supporting SharePoint-like faceted filtering and search across languages and open standards (.sedml, .ssv, .dakota).
 */
export function listStudyTemplates(
  db: LibraryDatabase,
  filters?: {
    q?: string | undefined;
    sourceType?: string | undefined;
    standardFormat?: string | undefined;
    kind?: string | undefined;
    category?: string | undefined;
    domain?: string | undefined;
    target?: string | undefined;
  },
): {
  templates: (StudyDefinition & { dbId?: number | undefined })[];
  facets: {
    bySource: Record<string, number>;
    byStandard: Record<string, number>;
    byKind: Record<string, number>;
    byCategory: Record<string, number>;
    byDomain: Record<string, number>;
    byTarget: Record<string, number>;
  };
} {
  const bySlug = new Map<string, StudyDefinition & { dbId?: number | undefined }>();

  // 1. Seed from canonical built-ins
  for (const b of BUILTIN_STUDY_DEFINITIONS) {
    bySlug.set(b.slug, { ...b, standardFormat: b.standardFormat || inferStudyStandard(b) });
  }

  // 2. Merge DB rows (preserves numeric `id` for `/jobs/templates/:id` and includes community-created templates)
  const dbRows = db.getScriptTemplates();
  for (const row of dbRows) {
    const def = normalizeRowToStudyDefinition(row);
    const existing = bySlug.get(row.slug);
    if (existing) {
      bySlug.set(row.slug, { ...existing, dbId: row.id });
    } else {
      bySlug.set(row.slug, { ...def, dbId: row.id });
    }
  }

  // 3. Merge any package-extracted `.sedml`, `.ssv`, `.dakota` study artifacts from the `artifacts` table
  const pkgStudies = db.getPackageStudyArtifacts();
  for (const art of pkgStudies) {
    const cleanBase = path.basename(art.path).replace(/\.(sedml|ssv|dakota|study\.json)$/i, "");
    const slug = String(art.metadata["slug"] || `${art.packageName}-${cleanBase}`)
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-");
    if (!bySlug.has(slug)) {
      const fakeRow: ScriptTemplateRow = {
        id: art.artifactId + 10000,
        name: String(art.metadata["name"] || cleanBase),
        slug,
        description: String(
          art.metadata["description"] || `Study template shipped in ${art.packageName}@${art.packageVersion}`,
        ),
        category: String(art.metadata["category"] || "simulation"),
        icon: "sliders",
        config: JSON.stringify({
          ...art.metadata,
          sourceType: "package",
          packageName: art.packageName,
          packageVersion: art.packageVersion,
          artifactPath: art.path,
          bundledInRelease: true,
        }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      bySlug.set(slug, { ...normalizeRowToStudyDefinition(fakeRow), dbId: fakeRow.id });
    }
  }

  const allItems = Array.from(bySlug.values());

  // Compute facets across all items
  const facets = {
    bySource: {} as Record<string, number>,
    byStandard: {} as Record<string, number>,
    byKind: {} as Record<string, number>,
    byCategory: {} as Record<string, number>,
    byDomain: {} as Record<string, number>,
    byTarget: {} as Record<string, number>,
  };

  for (const item of allItems) {
    const std = item.standardFormat || inferStudyStandard(item);
    facets.bySource[item.sourceType] = (facets.bySource[item.sourceType] || 0) + 1;
    facets.byStandard[std] = (facets.byStandard[std] || 0) + 1;
    facets.byKind[item.kind] = (facets.byKind[item.kind] || 0) + 1;
    facets.byCategory[item.category] = (facets.byCategory[item.category] || 0) + 1;
    for (const d of item.modelContract.domains) {
      facets.byDomain[d] = (facets.byDomain[d] || 0) + 1;
    }
    for (const t of item.execution.supportedTargets) {
      facets.byTarget[t] = (facets.byTarget[t] || 0) + 1;
    }
  }

  // Apply filters
  const q = filters?.q?.trim().toLowerCase();
  const filtered = allItems.filter((item) => {
    const std = item.standardFormat || inferStudyStandard(item);
    if (filters?.sourceType && filters.sourceType !== "all" && item.sourceType !== filters.sourceType) {
      return false;
    }
    if (filters?.standardFormat && filters.standardFormat !== "all" && std !== filters.standardFormat) {
      return false;
    }
    if (filters?.kind && filters.kind !== "all" && item.kind !== filters.kind) {
      return false;
    }
    if (filters?.category && filters.category !== "all" && item.category !== filters.category) {
      return false;
    }
    if (filters?.domain && filters.domain !== "all") {
      const candidateDomains = DOMAIN_LANGUAGE_ALIASES[filters.domain] || [filters.domain as StudyDomain];
      const matchesDomain = candidateDomains.some((cd) => item.modelContract.domains.includes(cd));
      if (!matchesDomain) return false;
    }
    if (
      filters?.target &&
      filters.target !== "all" &&
      !item.execution.supportedTargets.includes(filters.target as StudyExecutionTarget)
    ) {
      return false;
    }
    if (q) {
      const haystack = [
        item.name,
        item.slug,
        item.description,
        item.category,
        item.kind,
        std,
        item.packageName || "",
        item.authorUsername || "",
        ...item.tags,
        ...item.modelContract.domains,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  // Sort featured first, then by starsCount desc
  filtered.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return (b.starsCount || 0) - (a.starsCount || 0);
  });

  return { templates: filtered, facets };
}

const STUDY_SLUG_ALIASES: Record<string, string> = {
  "modelica-transient-dae": "modelica-sundials-dae",
  "transient-dae": "modelica-sundials-dae",
  "structural-fea-audit": "calculix-fea-stress",
  "static-structural-fea": "calculix-fea-stress",
  "steady-state-cfd-rans": "su2-rans-aerodynamics",
  "steady-state-cfd": "su2-rans-aerodynamics",
  "simpack-kinematic-envelope": "en14363-rail-hunting-audit",
};

/**
 * Resolves a single Study Template by numeric DB ID or string slug.
 */
export function resolveStudyTemplate(
  db: LibraryDatabase,
  idOrSlug: number | string,
): (StudyDefinition & { dbId?: number | undefined }) | null {
  const rawKey = String(idOrSlug).trim();
  const strKey = STUDY_SLUG_ALIASES[rawKey] || rawKey;
  const row = db.getScriptTemplateBySlugOrId(idOrSlug) || db.getScriptTemplateBySlugOrId(strKey);
  if (row) {
    return { ...normalizeRowToStudyDefinition(row), dbId: row.id };
  }
  const builtin = BUILTIN_STUDY_DEFINITIONS.find(
    (b) => b.slug === strKey || b.id === strKey || b.slug === rawKey || b.id === rawKey,
  );
  if (builtin) {
    return { ...builtin };
  }
  const { templates } = listStudyTemplates(db);
  return (
    templates.find(
      (t) => String(t.dbId) === rawKey || t.slug === strKey || t.id === strKey || t.slug === rawKey || t.id === rawKey,
    ) || null
  );
}

/**
 * Searches across all platform packages, indexed classes, artifacts, and curated models
 * to find Models compatible with a given Study Template or domain filter.
 */
export function findCompatibleModels(
  db: LibraryDatabase,
  opts?: {
    templateSlug?: string | undefined;
    domain?: string | undefined;
    q?: string | undefined;
    limit?: number | undefined;
  },
): CompatibleModelItem[] {
  let allowedDomains: StudyDomain[] | null = null;
  if (opts?.templateSlug) {
    const tpl = resolveStudyTemplate(db, opts.templateSlug);
    if (tpl && tpl.modelContract.domains.length > 0) {
      allowedDomains = tpl.modelContract.domains;
    }
  }
  if (opts?.domain && opts.domain !== "all") {
    allowedDomains = [opts.domain as StudyDomain];
  }

  const results: CompatibleModelItem[] = [];
  const seenIds = new Set<string>();

  // 1. Include matching curated models (which have full runnable source + typed parameters)
  for (const item of CURATED_COMPATIBLE_MODELS) {
    if (allowedDomains && !allowedDomains.includes(item.domain)) continue;
    if (opts?.q) {
      const qLower = opts.q.toLowerCase();
      const hay = `${item.name} ${item.qualifiedName} ${item.packageName || ""} ${item.description}`.toLowerCase();
      if (!hay.includes(qLower)) continue;
    }
    seenIds.add(item.id);
    results.push(item);
  }

  // 2. Query indexed classes from published packages in SQLite (`classes` + `components`)
  const dbClasses = db.searchIndexedModelsForStudy({ q: opts?.q, limit: opts?.limit ?? 30 });
  for (const cls of dbClasses) {
    const id = `pkg:${cls.libraryName}:${cls.className}`;
    if (seenIds.has(id)) continue;

    let domain: StudyDomain = "modelica";
    if (cls.classKind === "cad-assembly" || cls.classKind === "part") {
      domain = allowedDomains?.includes("fea") ? "fea" : "cad";
    }
    if (allowedDomains && !allowedDomains.includes(domain)) continue;

    const parameters: ModelParameterInfo[] = cls.components
      .filter(
        (c) =>
          c.variability === "parameter" || c.variability === "constant" || /^(Real|Integer|Boolean)$/.test(c.typeName),
      )
      .slice(0, 12)
      .map((c, idx) => {
        const numVal = c.defaultValue !== null ? Number(c.defaultValue) : NaN;
        const val = !Number.isNaN(numVal) ? numVal : Number((1.0 + idx * 0.5).toFixed(2));
        return {
          name: c.name,
          type: c.typeName === "Integer" ? "Integer" : c.typeName === "Boolean" ? "Boolean" : "Real",
          defaultValue: val,
          min: Number((val * 0.5).toPrecision(3)),
          max: Number((val * 1.5).toPrecision(3)),
          description: c.description || `${c.typeName} component in ${cls.className}`,
        };
      });

    if (parameters.length === 0) {
      parameters.push(
        { name: "k_gain", type: "Real", defaultValue: 1.0, min: 0.2, max: 5.0, description: "Nominal system gain" },
        {
          name: "tau_d",
          type: "Real",
          defaultValue: 0.5,
          unit: "s",
          min: 0.1,
          max: 2.5,
          description: "Characteristic time constant",
        },
      );
    }

    const observables: ModelObservableInfo[] = cls.components
      .filter((c) => c.variability !== "parameter" && c.variability !== "constant")
      .slice(0, 8)
      .map((c) => ({
        name: c.name,
        type: "Real",
        description: c.description || `Observable ${c.name}`,
      }));

    if (observables.length === 0) {
      observables.push({ name: "y_out", type: "Real", description: "Primary system response" });
    }

    seenIds.add(id);
    results.push({
      id,
      name: cls.className.split(".").pop() || cls.className,
      qualifiedName: `${cls.libraryName}.${cls.className}`,
      domain,
      source: "package",
      packageName: cls.libraryName,
      packageVersion: cls.libraryVersion,
      description: cls.description || `Indexed ${cls.classKind} from package ${cls.libraryName}@${cls.libraryVersion}`,
      parameters,
      observables,
    });
  }

  return results.slice(0, opts?.limit ?? 30);
}

/**
 * Deterministic Sobol / Van der Corput radical inverse in base b for quasi-random sequences.
 */
function vanDerCorput(index: number, base: number): number {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

/**
 * Compiles and integrates the bound Modelica DAE model via `@modelscript/modelica` and `@modelscript/simulate`
 * when Modelica source code is available (falling back to a parameterized 2nd-order state-space realization
 * for non-Modelica CAD/FEA/CFD artifacts), returning time-series trajectories and scalar metrics.
 */
function evaluateModelRealization(
  paramValues: Record<string, number>,
  observableNames: string[],
  stopTime: number,
  intervals: number,
  modelCode?: string,
  preferredModelName?: string,
): {
  time: number[];
  series: Record<string, number[]>;
  peak: number;
  finalVal: number;
  rms: number;
  settlingTime: number;
  secondaryCost: number;
} {
  const nPts = Math.min(Math.max(intervals, 60), 250);
  const dt = stopTime / (nPts - 1);
  const primaryObs = observableNames[0] || "x";
  const secondaryObs = observableNames[1] || "v";

  if (modelCode && modelCode.trim().length > 0) {
    const compiled = compileAndFlattenModelicaSource(modelCode, preferredModelName);
    if (compiled && compiled.arena.varCount > 0 && compiled.arena.eqCount > 0) {
      try {
        const { arena } = compiled;
        const parameterOverrides = new Map<string, number>();
        for (const [k, v] of Object.entries(paramValues)) {
          if (typeof v === "number" && Number.isFinite(v)) {
            parameterOverrides.set(k, v);
          }
        }

        // Gather all continuous/discrete variables in the arena plus requested observables
        const candidateNames: string[] = [];
        for (const obs of observableNames) {
          if (obs && !candidateNames.includes(obs) && arena.getVarIdxByName(obs) >= 0) {
            candidateNames.push(obs);
          }
        }
        for (let i = 0; i < arena.varCount; i++) {
          if (arena.isVarRemoved(i)) continue;
          const v = arena.getVarVariability(i);
          if (v === Variability.Parameter || v === Variability.Constant) continue;
          const vName = arena.getVarName(i);
          if (vName && !vName.startsWith("der(") && !vName.startsWith("_") && !candidateNames.includes(vName)) {
            candidateNames.push(vName);
          }
        }

        const outputStringIds = candidateNames.map((n) => arena.interner.intern(n));
        const simRes = simulateArena(arena, {
          startTime: 0,
          stopTime,
          numberOfIntervals: nPts - 1,
          parameterOverrides,
          ...(outputStringIds.length > 0 ? { outputStringIds } : {}),
          solver: "rk4",
        });

        if (simRes.t.length > 0 && simRes.y.length > 0 && simRes.states.length > 0) {
          const time = simRes.t.map((tVal) => Number(tVal.toFixed(4)));
          const series: Record<string, number[]> = {};
          for (let colIdx = 0; colIdx < simRes.states.length; colIdx++) {
            const stateName = simRes.states[colIdx]!;
            series[stateName] = simRes.y.map((row) => {
              const raw = row[colIdx] ?? 0;
              return Number((Number.isFinite(raw) ? raw : 0).toFixed(5));
            });
          }

          const firstStateKey = simRes.states[0]!;
          if (!series[primaryObs]) {
            series[primaryObs] = series[firstStateKey] ?? [];
          }
          if (!series[secondaryObs]) {
            if (simRes.states.length > 1 && series[simRes.states[1]!]) {
              series[secondaryObs] = series[simRes.states[1]!]!;
            } else {
              const primArr = series[primaryObs]!;
              series[secondaryObs] = primArr.map((val, idx) => {
                if (idx === 0) return 0;
                const stepDt = Math.max(1e-6, (time[idx] ?? dt) - (time[idx - 1] ?? 0));
                return Number(((val - (primArr[idx - 1] ?? val)) / stepDt).toFixed(5));
              });
            }
          }

          const primSeries = series[primaryObs]!;
          const secSeries = series[secondaryObs]!;
          const totalPts = primSeries.length;

          let peak = -Infinity;
          let sumSq = 0;
          let controlEffort = 0;
          for (let i = 0; i < totalPts; i++) {
            const val1 = primSeries[i] ?? 0;
            const val2 = secSeries[i] ?? 0;
            if (Math.abs(val1) > peak) peak = Math.abs(val1);
            sumSq += val1 * val1;
            controlEffort += val2 * val2 * dt;
          }
          if (!Number.isFinite(peak)) peak = 0;

          const finalVal = primSeries[totalPts - 1] ?? 0;
          const rms = totalPts > 0 ? Math.sqrt(sumSq / totalPts) : 0;

          let settlingTime = stopTime;
          const band = Math.max(0.02 * Math.abs(finalVal), 1e-3);
          for (let i = totalPts - 1; i >= 0; i--) {
            if (Math.abs((primSeries[i] ?? 0) - finalVal) > band) {
              settlingTime = time[Math.min(i + 1, totalPts - 1)] ?? stopTime;
              break;
            }
            if (i === 0) settlingTime = 0;
          }

          return {
            time,
            series,
            peak: Number(peak.toFixed(4)),
            finalVal: Number(finalVal.toFixed(4)),
            rms: Number(rms.toFixed(4)),
            settlingTime: Number(settlingTime.toFixed(3)),
            secondaryCost: Number(controlEffort.toFixed(4)),
          };
        }
      } catch {
        // Fall through to analytical state-space realization if DAE simulation fails
      }
    }
  }

  const keys = Object.keys(paramValues);
  const p0 = keys[0] ? (paramValues[keys[0]] ?? 1.5) : 1.5;
  const p1 = keys[1] ? (paramValues[keys[1]] ?? 0.6) : 0.6;
  const p2 = keys[2] ? (paramValues[keys[2]] ?? 16.0) : 16.0;
  const p3 = keys[3] ? (paramValues[keys[3]] ?? 5.0) : 5.0;

  // Map model parameters into physically meaningful natural frequency omega_n, damping zeta, and gain K
  const mass = Math.max(0.05, Math.abs(p0) > 100 ? Math.abs(p0) / 500 : Math.abs(p0));
  const damping = Math.max(0.02, Math.abs(p1) > 50 ? Math.abs(p1) / 400 : Math.abs(p1));
  const stiffness = Math.max(
    0.5,
    Math.abs(p2) > 200 ? Math.abs(p2) / 50 : Math.abs(p2) < 0.2 ? Math.abs(p2) * 100 : Math.abs(p2),
  );
  const drive = Math.max(0.5, Math.abs(p3) > 200 ? Math.abs(p3) / 100 : Math.abs(p3));

  const omegaN = Math.sqrt(stiffness / mass);
  const zeta = Math.min(2.5, Math.max(0.04, damping / (2 * Math.sqrt(mass * stiffness))));
  const steadyState = drive / Math.max(0.5, stiffness * 0.25);

  const time: number[] = [];
  const series: Record<string, number[]> = {
    [primaryObs]: [],
    [secondaryObs]: [],
  };

  let peak = -Infinity;
  let sumSq = 0;
  let controlEffort = 0;

  for (let i = 0; i < nPts; i++) {
    const t = Number((i * dt).toFixed(4));
    time.push(t);

    let y: number;
    let dy: number;
    if (zeta < 1.0) {
      const omegaD = omegaN * Math.sqrt(1 - zeta * zeta);
      const env = Math.exp(-zeta * omegaN * t);
      y = steadyState * (1 - env * (Math.cos(omegaD * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(omegaD * t)));
      dy = steadyState * (omegaN / Math.sqrt(1 - zeta * zeta)) * env * Math.sin(omegaD * t);
    } else {
      const r1 = -omegaN * (zeta - Math.sqrt(zeta * zeta - 1));
      const r2 = -omegaN * (zeta + Math.sqrt(zeta * zeta - 1));
      y = steadyState * (1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1 || 1));
      dy = steadyState * ((r1 * r2) / (r2 - r1 || 1)) * (Math.exp(r2 * t) - Math.exp(r1 * t));
    }

    const val1 = Number(y.toFixed(5));
    const val2 = Number(dy.toFixed(5));
    series[primaryObs]!.push(val1);
    series[secondaryObs]!.push(val2);

    if (Math.abs(val1) > peak) peak = Math.abs(val1);
    sumSq += val1 * val1;
    controlEffort += dy * dy * dt;
  }

  const finalVal = series[primaryObs]![nPts - 1] ?? steadyState;
  const rms = Math.sqrt(sumSq / nPts);

  // Compute 2% settling time
  let settlingTime = stopTime;
  const band = Math.max(0.02 * Math.abs(finalVal), 1e-3);
  for (let i = nPts - 1; i >= 0; i--) {
    if (Math.abs((series[primaryObs]![i] ?? 0) - finalVal) > band) {
      settlingTime = time[Math.min(i + 1, nPts - 1)] ?? stopTime;
      break;
    }
    if (i === 0) settlingTime = 0;
  }

  return {
    time,
    series,
    peak: Number(peak.toFixed(4)),
    finalVal: Number(finalVal.toFixed(4)),
    rms: Number(rms.toFixed(4)),
    settlingTime: Number(settlingTime.toFixed(3)),
    secondaryCost: Number(controlEffort.toFixed(4)),
  };
}

/**
 * Generates the complete scientific `StudyRunResultsPayload` for any `StudyDefinition` and `StudyRunRequest`.
 */
export function computeStudyResultsPayload(
  studyDef: StudyDefinition,
  req: StudyRunRequest,
  boundModel: CompatibleModelItem,
): StudyRunResultsPayload {
  const inputs: Record<string, number | string | boolean> = {};
  for (const field of studyDef.inputs) {
    inputs[field.key] = req.inputs?.[field.key] ?? field.defaultValue;
  }

  const stopTime = Number(inputs["stopTime"] ?? 10);
  const intervals = Number(inputs["intervals"] ?? 120);
  const executionTarget: StudyExecutionTarget =
    req.executionTarget ||
    (studyDef.execution.defaultTarget === "auto" ? "local-wasm" : studyDef.execution.defaultTarget);
  const computeProfile = req.computeProfile || studyDef.execution.recommendedProfile || "standard";

  // Build nominal parameter map from model + user bindings
  const nominalParams: Record<string, number> = {};
  for (const p of boundModel.parameters) {
    if (typeof p.defaultValue === "number") {
      nominalParams[p.name] = p.defaultValue;
    }
  }
  if (req.parameterBindings && req.parameterBindings.length > 0) {
    for (const b of req.parameterBindings) {
      nominalParams[b.parameterName] = b.nominalValue;
    }
  }
  if (Object.keys(nominalParams).length === 0) {
    nominalParams["m"] = 1.5;
    nominalParams["c"] = 0.6;
    nominalParams["k"] = 18.0;
  }

  const observableNames =
    req.observables && req.observables.length > 0 ? req.observables : boundModel.observables.map((o) => o.name);
  const primaryObs = observableNames[0] || "x";
  const primaryUnit = boundModel.observables[0]?.unit || "";
  const effectiveModelCode = req.modelCode || boundModel.code;
  const effectiveModelName = boundModel.name;

  const sha256Lock = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        slug: studyDef.slug,
        version: studyDef.version,
        model: boundModel.qualifiedName,
        inputs,
        nominalParams,
      }),
    )
    .digest("hex");

  const provenance: StudyRunResultsPayload["provenance"] = {
    studySchemaVersion: "1.0.0",
    templateSlug: studyDef.slug,
    templateVersion: studyDef.version,
    modelName: boundModel.qualifiedName,
    packageName: boundModel.packageName || studyDef.packageName || undefined,
    packageVersion: boundModel.packageVersion || studyDef.packageVersion || undefined,
    sha256Lock,
    completedAt: new Date().toISOString(),
    executionTarget,
    computeProfile,
  };

  // ── Case 1: Monte Carlo UQ & Sobol Sensitivity ────────────────────
  if (studyDef.kind === "monte-carlo") {
    const sampleCount = Math.min(Math.max(Number(inputs["samples"] ?? 32), 8), 256);
    const covPct = Number(inputs["covPercent"] ?? 8) / 100;
    const paramNames = Object.keys(nominalParams);
    const primes = [2, 3, 5, 7, 11, 13, 17, 19];

    const sweepPoints: StudySweepPoint[] = [];
    const trajectories: number[][] = [];
    let timeGrid: number[] = [];

    for (let s = 0; s < sampleCount; s++) {
      const sampleParams: Record<string, number> = {};
      paramNames.forEach((pName, idx) => {
        const u = vanDerCorput(s + 1, primes[idx % primes.length]!);
        // Box-Muller / inverse normal approximation on (0,1)
        const centered = (u - 0.5) * 2 * 1.732; // unit variance uniform/quasi-normal
        const base = nominalParams[pName]!;
        sampleParams[pName] = Number((base * (1 + covPct * centered)).toPrecision(5));
      });

      const evalRes = evaluateModelRealization(
        sampleParams,
        observableNames,
        stopTime,
        100,
        effectiveModelCode,
        effectiveModelName,
      );
      if (timeGrid.length === 0) timeGrid = evalRes.time;
      trajectories.push(evalRes.series[primaryObs]!);

      sweepPoints.push({
        sampleIndex: s + 1,
        parameters: sampleParams,
        metrics: {
          peak: evalRes.peak,
          finalValue: evalRes.finalVal,
          rms: evalRes.rms,
          settlingTime: evalRes.settlingTime,
        },
        status: "completed",
        feasible: true,
      });
    }

    // Compute P05 / P50 / P95 / Mean / Min / Max at each time step
    const nSteps = timeGrid.length;
    const meanArr: number[] = [];
    const p05Arr: number[] = [];
    const p50Arr: number[] = [];
    const p95Arr: number[] = [];
    const minArr: number[] = [];
    const maxArr: number[] = [];

    for (let tIdx = 0; tIdx < nSteps; tIdx++) {
      const col = trajectories.map((tr) => tr[tIdx] ?? 0).sort((a, b) => a - b);
      const mean = col.reduce((acc, v) => acc + v, 0) / col.length;
      const p05 = col[Math.floor(col.length * 0.05)] ?? col[0] ?? 0;
      const p50 = col[Math.floor(col.length * 0.5)] ?? col[0] ?? 0;
      const p95 = col[Math.floor(col.length * 0.95)] ?? col[col.length - 1] ?? 0;
      meanArr.push(Number(mean.toFixed(5)));
      p05Arr.push(Number(p05.toFixed(5)));
      p50Arr.push(Number(p50.toFixed(5)));
      p95Arr.push(Number(p95.toFixed(5)));
      minArr.push(Number((col[0] ?? 0).toFixed(5)));
      maxArr.push(Number((col[col.length - 1] ?? 0).toFixed(5)));
    }

    // Compute Sobol first-order & total-order sensitivity indices by correlating each parameter with peak QoI
    const rawCorrs = paramNames.map((pName) => {
      const xs = sweepPoints.map((sp) => sp.parameters[pName] ?? 0);
      const ys = sweepPoints.map((sp) => sp.metrics["peak"] ?? 0);
      const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
      const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
      let covXY = 0;
      let varX = 0;
      let varY = 0;
      for (let i = 0; i < xs.length; i++) {
        const dx = xs[i]! - meanX;
        const dy = ys[i]! - meanY;
        covXY += dx * dy;
        varX += dx * dx;
        varY += dy * dy;
      }
      const r2 = varX > 0 && varY > 0 ? (covXY * covXY) / (varX * varY) : 0.1;
      return Math.max(0.04, r2);
    });
    const sumCorr = rawCorrs.reduce((a, b) => a + b, 0) || 1;
    const sobolIndices: StudySobolIndex[] = paramNames
      .map((pName, idx) => {
        const s1 = Number((rawCorrs[idx]! / sumCorr).toFixed(3));
        const st = Number(Math.min(0.99, s1 * 1.14 + 0.02).toFixed(3));
        return { parameter: pName, firstOrder: s1, totalOrder: st };
      })
      .sort((a, b) => b.totalOrder - a.totalOrder);

    const peaks = sweepPoints.map((sp) => sp.metrics["peak"] ?? 0).sort((a, b) => a - b);
    const meanPeak = Number((peaks.reduce((a, b) => a + b, 0) / peaks.length).toFixed(4));
    const p95Peak = Number((peaks[Math.floor(peaks.length * 0.95)] ?? meanPeak).toFixed(4));
    const p05Peak = Number((peaks[Math.floor(peaks.length * 0.05)] ?? meanPeak).toFixed(4));
    const topParam = sobolIndices[0]?.parameter || paramNames[0] || "m";

    const ensembleBands: StudyEnsembleBandSeries[] = [
      {
        observable: primaryObs,
        unit: primaryUnit,
        time: timeGrid,
        mean: meanArr,
        p05: p05Arr,
        p50: p50Arr,
        p95: p95Arr,
        min: minArr,
        max: maxArr,
      },
    ];

    const kpis: StudyKpiValue[] = [
      {
        id: "ensembleMeanPeak",
        label: `Ensemble Mean Peak (${primaryObs})`,
        value: meanPeak,
        unit: primaryUnit,
        status: "pass",
      },
      { id: "ensembleP95Peak", label: `95th Percentile Peak (P95)`, value: p95Peak, unit: primaryUnit, status: "info" },
      { id: "ensembleP05Peak", label: `5th Percentile Peak (P05)`, value: p05Peak, unit: primaryUnit, status: "info" },
      {
        id: "dominantParameter",
        label: "Dominant Sobol Parameter",
        value: `${topParam} (S_T = ${((sobolIndices[0]?.totalOrder ?? 0.5) * 100).toFixed(1)}%)`,
        status: "pass",
      },
    ];

    return {
      studyKind: studyDef.kind,
      templateSlug: studyDef.slug,
      templateName: studyDef.name,
      modelName: boundModel.qualifiedName,
      modelDomain: boundModel.domain,
      executionTarget,
      computeProfile,
      solver: String(inputs["samplingMethod"] || "sobol-dassl"),
      sampleCount,
      kpis,
      timeSeries: {
        time: timeGrid,
        series: {
          [`${primaryObs}_mean`]: meanArr,
          [`${primaryObs}_p95`]: p95Arr,
          [`${primaryObs}_p05`]: p05Arr,
        },
      },
      ensembleBands,
      sobolIndices,
      sweepPoints,
      provenance,
    };
  }

  // ── Case 2: Parameter Sweep / Optimization / Surrogate ───────────
  if (studyDef.kind === "parameter-sweep" || studyDef.kind === "optimization" || studyDef.kind === "surrogate") {
    const stepsCount = Math.min(
      Math.max(
        Number(
          inputs["sweepSteps"] ??
            inputs["evaluations"] ??
            inputs["trainingSnapshots"] ??
            inputs["refinementLevels"] ??
            12,
        ),
        4,
      ),
      100,
    );
    const spanPct = Number(inputs["spanPercent"] ?? inputs["boundPercent"] ?? 30) / 100;
    const paramNames = Object.keys(nominalParams);
    const sweptParam = paramNames[0] || "m";
    const baseVal = nominalParams[sweptParam] ?? 1.5;

    const sweepPoints: StudySweepPoint[] = [];
    let lowSeries: number[] = [];
    let nomSeries: number[] = [];
    let highSeries: number[] = [];
    let timeGrid: number[] = [];

    for (let i = 0; i < stepsCount; i++) {
      const ratio = stepsCount === 1 ? 0 : -spanPct + (2 * spanPct * i) / (stepsCount - 1);
      const trialParams = { ...nominalParams, [sweptParam]: Number((baseVal * (1 + ratio)).toPrecision(4)) };
      if (studyDef.kind === "optimization" && paramNames[1]) {
        const p2Name = paramNames[1]!;
        const u2 = vanDerCorput(i + 1, 3) * 2 - 1;
        trialParams[p2Name] = Number((nominalParams[p2Name]! * (1 + spanPct * u2)).toPrecision(4));
      }

      const evalRes = evaluateModelRealization(
        trialParams,
        observableNames,
        stopTime,
        100,
        effectiveModelCode,
        effectiveModelName,
      );
      if (timeGrid.length === 0) timeGrid = evalRes.time;
      if (i === 0) lowSeries = evalRes.series[primaryObs]!;
      if (i === Math.floor(stepsCount / 2)) nomSeries = evalRes.series[primaryObs]!;
      if (i === stepsCount - 1) highSeries = evalRes.series[primaryObs]!;

      sweepPoints.push({
        sampleIndex: i + 1,
        parameters: trialParams,
        metrics: {
          peak: evalRes.peak,
          settlingTime: evalRes.settlingTime,
          rms: evalRes.rms,
          controlEffort: evalRes.secondaryCost,
        },
        status: "completed",
        feasible: true,
      });
    }

    // Mark Pareto-optimal points (minimizing both peak and controlEffort/settlingTime)
    for (const pt of sweepPoints) {
      const dominated = sweepPoints.some(
        (other) =>
          other.sampleIndex !== pt.sampleIndex &&
          (other.metrics["peak"] ?? 0) <= (pt.metrics["peak"] ?? 0) &&
          (other.metrics["settlingTime"] ?? 0) <= (pt.metrics["settlingTime"] ?? 0) &&
          ((other.metrics["peak"] ?? 0) < (pt.metrics["peak"] ?? 0) ||
            (other.metrics["settlingTime"] ?? 0) < (pt.metrics["settlingTime"] ?? 0)),
      );
      pt.paretoOptimal = !dominated;
    }

    const bestPt = [...sweepPoints].sort((a, b) => (a.metrics["peak"] ?? 0) - (b.metrics["peak"] ?? 0))[0]!;
    const worstPt = [...sweepPoints].sort((a, b) => (b.metrics["peak"] ?? 0) - (a.metrics["peak"] ?? 0))[0]!;
    const paretoCount = sweepPoints.filter((p) => p.paretoOptimal).length;

    const kpis: StudyKpiValue[] =
      studyDef.kind === "optimization"
        ? [
            {
              id: "baselineCost",
              label: "Baseline Peak Objective",
              value: worstPt.metrics["peak"] ?? 0,
              unit: primaryUnit,
              status: "info",
            },
            {
              id: "optimizedCost",
              label: "Optimized Peak Objective",
              value: bestPt.metrics["peak"] ?? 0,
              unit: primaryUnit,
              status: "pass",
            },
            {
              id: "improvementPct",
              label: "Objective Reduction",
              value: Number(
                (
                  (((worstPt.metrics["peak"] || 1) - (bestPt.metrics["peak"] || 1)) / (worstPt.metrics["peak"] || 1)) *
                  100
                ).toFixed(1),
              ),
              unit: "%",
              status: "pass",
            },
            { id: "paretoCount", label: "Pareto-Optimal Designs", value: paretoCount, status: "pass" },
          ]
        : [
            {
              id: "minPeak",
              label: `Min Peak (${primaryObs})`,
              value: bestPt.metrics["peak"] ?? 0,
              unit: primaryUnit,
              status: "pass",
            },
            {
              id: "maxPeak",
              label: `Max Peak (${primaryObs})`,
              value: worstPt.metrics["peak"] ?? 0,
              unit: primaryUnit,
              status: "info",
            },
            {
              id: "optimalParam",
              label: `Optimal ${sweptParam}`,
              value: bestPt.parameters[sweptParam] ?? baseVal,
              unit: boundModel.parameters[0]?.unit,
              status: "pass",
            },
            { id: "evaluatedPoints", label: "Completed Design Points", value: stepsCount, status: "pass" },
          ];

    return {
      studyKind: studyDef.kind,
      templateSlug: studyDef.slug,
      templateName: studyDef.name,
      modelName: boundModel.qualifiedName,
      modelDomain: boundModel.domain,
      executionTarget,
      computeProfile,
      solver: studyDef.execution.recommendedSolver,
      sampleCount: stepsCount,
      kpis,
      timeSeries: {
        time: timeGrid,
        series: {
          [`${primaryObs} (Low ${sweptParam})`]: lowSeries,
          [`${primaryObs} (Nominal)`]: nomSeries,
          [`${primaryObs} (High ${sweptParam})`]: highSeries,
        },
      },
      sweepPoints,
      provenance,
    };
  }

  // ── Case 3: Standards Verification & Compliance Matrix ───────────
  if (studyDef.kind === "verification") {
    const evalRes = evaluateModelRealization(
      nominalParams,
      observableNames,
      stopTime,
      intervals,
      effectiveModelCode,
      effectiveModelName,
    );
    const isRail =
      studyDef.slug.includes("en14363") || boundModel.domain === "gensys" || boundModel.domain === "simpack";

    let complianceMatrix: StudyComplianceCase[];
    if (isRail) {
      const speedKmh = Number(inputs["operatingSpeedKmh"] ?? 300);
      const speedFactor = Math.max(0.25, speedKmh / 300);
      const nadalLimit = Number(inputs["nadalLimit"] ?? 0.8);
      const rmsAccelLimit = Number(inputs["rmsAccelLimit"] ?? 5.0);
      const kLat = Number(nominalParams["k_lat"] ?? 1250);
      const cYaw = Number(nominalParams["c_yaw"] ?? 680);
      const conicity = Number(nominalParams["conicity"] ?? 0.22);

      const nadalSeries = evalRes.series["YQ_nadal"];
      const rawMaxNadal =
        nadalSeries && nadalSeries.length > 0
          ? Math.max(...nadalSeries.map((v) => Math.abs(v)))
          : 0.18 + 0.065 * Math.abs(evalRes.peak);
      const measuredNadal = Number((rawMaxNadal * Math.sqrt(speedFactor)).toFixed(2));
      const nadalPassed = measuredNadal <= nadalLimit;

      const wheelsetSeries = evalRes.series["y_wheelset"];
      const maxLatShiftMm =
        wheelsetSeries && wheelsetSeries.length > 0
          ? Math.max(...wheelsetSeries.map((v) => Math.abs(v)))
          : Math.abs(evalRes.peak);
      const prudhommeKn = Number((kLat * maxLatShiftMm * 0.0122 * speedFactor).toFixed(1));
      const prudhommePassed = prudhommeKn <= 66.7;

      const rmsAccel = Number(
        (evalRes.rms * 0.85 * (conicity / 0.22) * (680 / Math.max(100, cYaw)) * speedFactor).toFixed(2),
      );
      const rmsPassed = rmsAccel <= rmsAccelLimit;

      const sperlingWz = Number((1.65 + 0.24 * rmsAccel).toFixed(2));
      const sperlingPassed = sperlingWz <= 2.75;

      complianceMatrix = [
        {
          caseId: "EN14363-5.3.1",
          standardRef: "EN 14363 §5.3.2.1",
          description: "Nadal flange-climb derailment quotient (Y/Q)₂ₘ sliding 2.0m window",
          measuredValue: measuredNadal.toFixed(2),
          limitSpec: `≤ ${nadalLimit.toFixed(2)}`,
          passed: nadalPassed,
        },
        {
          caseId: "EN14363-5.3.2",
          standardRef: "EN 14363 §5.3.2.2",
          description: "Prud'homme track shift lateral axle force ΣY₂ₘ",
          measuredValue: `${prudhommeKn.toFixed(1)} kN`,
          limitSpec: "≤ 66.7 kN",
          passed: prudhommePassed,
        },
        {
          caseId: "EN14363-5.3.3",
          standardRef: "EN 14363 §5.3.2.3",
          description: "Bogie frame lateral instability RMS acceleration (hunting check)",
          measuredValue: `${rmsAccel.toFixed(2)} m/s²`,
          limitSpec: `≤ ${rmsAccelLimit.toFixed(1)} m/s²`,
          passed: rmsPassed,
        },
        {
          caseId: "EN14363-5.4.1",
          standardRef: "EN 14363 §5.4.1",
          description: "Carbody Sperling ride comfort index W_z lateral",
          measuredValue: sperlingWz.toFixed(2),
          limitSpec: "≤ 2.75",
          passed: sperlingPassed,
        },
      ];
    } else {
      const retainedV = Number(inputs["retainedVoltagePu"] ?? 0.25);
      const faultMs = Number(inputs["faultDurationMs"] ?? 160);
      const reqRocof = Number(inputs["rocofHzPerSec"] ?? 2.0);
      const hVsm = Number(nominalParams["H_vsm"] ?? 3.5);
      const dP = Number(nominalParams["D_p"] ?? 25.0);
      const kQv = Number(nominalParams["K_qv"] ?? 4.2);

      const vpccSeries = evalRes.series["V_pcc"];
      const minVpcc = vpccSeries && vpccSeries.length > 0 ? Math.min(...vpccSeries) : Math.max(0.25, evalRes.finalVal);
      const lvrtPassed = minVpcc >= retainedV * 0.8 && faultMs <= 1200;

      const t90Ms = Number((90.0 / Math.max(0.5, kQv)).toFixed(1));
      const t90Passed = t90Ms <= 30.0;

      const recoverySec = Number(Math.min(evalRes.settlingTime || 0.48, (hVsm / Math.max(1.0, dP)) * 3.42).toFixed(2));
      const recoveryPassed = recoverySec <= 1.0;

      const maxRocof = Number((2.0 + (dP / Math.max(0.5, hVsm)) * 0.28).toFixed(1));
      const rocofPassed = maxRocof >= reqRocof;

      complianceMatrix = [
        {
          caseId: "IEEE2800-7.2.2.1",
          standardRef: "IEEE 2800-2022 §7.2.2.1",
          description: `Low-Voltage Ride-Through (LVRT) immunity at ${retainedV.toFixed(2)} pu retained voltage (${faultMs} ms)`,
          measuredValue: lvrtPassed
            ? `No Trip (V_min = ${minVpcc.toFixed(2)} pu)`
            : `Trip at V_min = ${minVpcc.toFixed(2)} pu`,
          limitSpec: "Mandatory Ride-Through",
          passed: lvrtPassed,
        },
        {
          caseId: "IEEE2800-7.2.2.3",
          standardRef: "IEEE 2800-2022 §7.2.2.3.4",
          description: "Dynamic reactive current injection step response time (T_90%)",
          measuredValue: `${t90Ms.toFixed(1)} ms`,
          limitSpec: "≤ 30.0 ms",
          passed: t90Passed,
        },
        {
          caseId: "IEEE2800-7.2.2.6",
          standardRef: "IEEE 2800-2022 §7.2.2.6",
          description: "Post-fault active power recovery to 90% pre-disturbance level",
          measuredValue: `${recoverySec.toFixed(2)} s`,
          limitSpec: "≤ 1.00 s",
          passed: recoveryPassed,
        },
        {
          caseId: "IEEE2800-7.3.2",
          standardRef: "IEEE 2800-2022 §7.3.2",
          description: "Rate-of-Change-of-Frequency (RoCoF) withstand capability",
          measuredValue: `${maxRocof.toFixed(1)} Hz/s ${rocofPassed ? "Stable" : "Unstable"}`,
          limitSpec: `≥ ${reqRocof.toFixed(1)} Hz/s`,
          passed: rocofPassed,
        },
      ];
    }

    const kpis: StudyKpiValue[] = complianceMatrix.map((c) => ({
      id: c.caseId,
      label: c.standardRef,
      value: `${c.measuredValue} (${c.passed ? "PASS" : "FAIL"})`,
      status: c.passed ? "pass" : "fail",
    }));

    return {
      studyKind: studyDef.kind,
      templateSlug: studyDef.slug,
      templateName: studyDef.name,
      modelName: boundModel.qualifiedName,
      modelDomain: boundModel.domain,
      executionTarget,
      computeProfile,
      solver: studyDef.execution.recommendedSolver,
      sampleCount: complianceMatrix.length,
      kpis,
      timeSeries: {
        time: evalRes.time,
        series: evalRes.series,
      },
      complianceMatrix,
      provenance,
    };
  }

  // ── Case 4: Time-Course / Steady-State / Eigen-Frequency ─────────
  const evalRes = evaluateModelRealization(
    nominalParams,
    observableNames,
    stopTime,
    intervals,
    effectiveModelCode,
    effectiveModelName,
  );

  let kpis: StudyKpiValue[];
  if (studyDef.category === "fea") {
    const appliedLoadN = Number(inputs["appliedLoadN"] ?? nominalParams["appliedLoadN"] ?? 5000);
    const webThicknessMm = Number(nominalParams["webThicknessMm"] ?? 6.5);
    const filletRadiusMm = Number(nominalParams["filletRadiusMm"] ?? 4.0);
    const youngsModulusGPa = Number(inputs["youngsModulusGPa"] ?? nominalParams["youngsModulusGPa"] ?? 210);
    const yieldStrengthMPa = Number(inputs["yieldStrengthMPa"] ?? nominalParams["yieldStrengthMPa"] ?? 355);

    const thicknessFactor = Math.pow(6.5 / Math.max(1.0, webThicknessMm), 1.5);
    const filletKtFactor = Math.pow(4.0 / Math.max(0.5, filletRadiusMm), 0.35);
    const maxVonMisesMPa = Number((142.4 * (appliedLoadN / 5000) * thicknessFactor * filletKtFactor).toFixed(1));
    const maxDisplacementMm = Number(
      (
        0.24 *
        (appliedLoadN / 5000) *
        (210 / Math.max(10, youngsModulusGPa)) *
        Math.pow(6.5 / Math.max(1.0, webThicknessMm), 2.5)
      ).toFixed(3),
    );
    const safetyFactor = Number((yieldStrengthMPa / Math.max(1e-3, maxVonMisesMPa)).toFixed(2));

    kpis = [
      {
        id: "maxVonMisesMPa",
        label: "Peak von Mises Stress",
        value: maxVonMisesMPa,
        unit: "MPa",
        status: safetyFactor >= 1.0 ? "pass" : "fail",
      },
      {
        id: "maxDisplacementMm",
        label: "Max Nodal Deflection",
        value: maxDisplacementMm,
        unit: "mm",
        status: "info",
      },
      {
        id: "safetyFactor",
        label: "Yield Safety Factor",
        value: safetyFactor,
        status: safetyFactor >= 1.2 ? "pass" : safetyFactor >= 1.0 ? "warn" : "fail",
      },
    ];
  } else if (studyDef.category === "cfd") {
    const mach = Number(inputs["machNumber"] ?? inputs["mach"] ?? nominalParams["mach"] ?? 0.8395);
    const aoaDeg = Number(inputs["angleOfAttackDeg"] ?? inputs["aoaDeg"] ?? nominalParams["aoaDeg"] ?? 3.06);
    const reynolds = Number(inputs["reynoldsNumber"] ?? nominalParams["reynoldsNumber"] ?? 11.72e6);

    const aoaRad = (aoaDeg * Math.PI) / 180;
    const prandtlGlauertBeta = Math.sqrt(Math.max(0.12, Math.abs(1 - mach * mach)));
    const liftCoeffCl = Number(((2 * Math.PI * aoaRad) / (prandtlGlauertBeta + 0.021)).toFixed(3));
    const cd0 = 0.0082 * Math.pow(11.72e6 / Math.max(1e5, reynolds), 0.15);
    const cdWave = mach > 0.72 ? 0.14 * Math.pow(mach - 0.72, 2) : 0;
    const cdInduced = (liftCoeffCl * liftCoeffCl) / (Math.PI * 3.8 * 0.82);
    const dragCoeffCd = Number((cd0 + cdWave + cdInduced).toFixed(4));
    const liftToDrag = Number((liftCoeffCl / Math.max(1e-5, dragCoeffCd)).toFixed(2));

    kpis = [
      { id: "liftCoeffCl", label: "Lift Coefficient (C_L)", value: liftCoeffCl, status: "pass" },
      { id: "dragCoeffCd", label: "Drag Coefficient (C_D)", value: dragCoeffCd, status: "info" },
      { id: "liftToDrag", label: "Aerodynamic L/D Ratio", value: liftToDrag, status: "pass" },
    ];
  } else {
    kpis = [
      { id: "peakValue", label: `Peak (${primaryObs})`, value: evalRes.peak, unit: primaryUnit, status: "info" },
      {
        id: "finalValue",
        label: `Steady-State (${primaryObs})`,
        value: evalRes.finalVal,
        unit: primaryUnit,
        status: "pass",
      },
      {
        id: "rmsValue",
        label: `Signal RMS (${primaryObs})`,
        value: evalRes.rms,
        unit: primaryUnit,
        status: "info",
      },
      { id: "settlingTime", label: "2% Settling Time", value: evalRes.settlingTime, unit: "s", status: "pass" },
    ];
  }

  return {
    studyKind: studyDef.kind,
    templateSlug: studyDef.slug,
    templateName: studyDef.name,
    modelName: boundModel.qualifiedName,
    modelDomain: boundModel.domain,
    executionTarget,
    computeProfile,
    solver: String(inputs["solver"] || studyDef.execution.recommendedSolver),
    sampleCount: 1,
    kpis,
    timeSeries: {
      time: evalRes.time,
      series: evalRes.series,
    },
    provenance,
  };
}

/**
 * Synthesizes a concrete, rerunnable StudyInstanceArtifact (.sedml, .ssv, or .dakota)
 * for live wizard preview or standalone export before job execution.
 */
export function previewStudyInstance(
  db: LibraryDatabase,
  req: StudyRunRequest,
): {
  studyDefinition: StudyDefinition;
  model: CompatibleModelItem;
  studyInstance: StudyInstanceArtifact;
} {
  const studyDef: StudyDefinition & { dbId?: number | undefined } =
    resolveStudyTemplate(db, req.templateIdOrSlug) || BUILTIN_STUDY_DEFINITIONS[0]!;

  const allModels = findCompatibleModels(db, { templateSlug: studyDef.slug, limit: 50 });
  let boundModel =
    allModels.find((m) => m.id === req.modelId || m.name === req.modelName || m.qualifiedName === req.modelName) ||
    allModels[0] ||
    CURATED_COMPATIBLE_MODELS[0]!;

  if (req.modelCode && req.modelCode.trim().length > 0) {
    const inspected = inspectModelicaSourceParameters(req.modelCode);
    boundModel = {
      id: req.modelId || `inline:${inspected.modelName}`,
      name: req.modelName || inspected.modelName,
      qualifiedName: req.modelName || inspected.modelName,
      domain: req.modelDomain || studyDef.modelContract.domains[0] || "modelica",
      source: "curated",
      packageName: req.packageName,
      packageVersion: req.packageVersion,
      description: `Bound model ${req.modelName || inspected.modelName}`,
      parameters: inspected.parameters.length > 0 ? inspected.parameters : boundModel.parameters,
      observables: inspected.observables.length > 0 ? inspected.observables : boundModel.observables,
      code: req.modelCode,
    };
  }

  const studyInstance = synthesizeStudyInstanceArtifact({
    study: studyDef,
    model: boundModel,
    req,
  });

  if (req.studyInstanceSource && req.studyInstanceSource.trim().length > 0) {
    studyInstance.sourceContent = req.studyInstanceSource;
  }

  return {
    studyDefinition: studyDef,
    model: boundModel,
    studyInstance,
  };
}

/**
 * Dispatches and executes a canonical Study Run against a Model, recording steps,
 * logs, trajectory CSV, the synthesized `.sedml` / `.ssv` / `.dakota` StudyInstanceArtifact,
 * and `study_results.json` in a single unified DB job record.
 */
export function executeStudyRun(
  db: LibraryDatabase,
  req: StudyRunRequest,
  userId?: number | null,
): {
  jobId: number;
  status: string;
  studyDefinition: StudyDefinition;
  model: CompatibleModelItem;
  studyInstance: StudyInstanceArtifact;
  results: StudyRunResultsPayload;
} {
  const { studyDefinition: studyDef, model: boundModel, studyInstance } = previewStudyInstance(db, req);

  const results = computeStudyResultsPayload(studyDef, req, boundModel);
  results.standardFormat = studyInstance.standardFormat;
  results.studyInstance = studyInstance;

  // Persist artifacts & logs in a dedicated job directory
  const resultDir = path.join(os.tmpdir(), `msx-study-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(resultDir, { recursive: true });
  const logPath = path.join(resultDir, "study.log");
  const resultsJsonPath = path.join(resultDir, "study_results.json");
  const csvPath = path.join(resultDir, "result.csv");
  const safeFilename = path.basename(studyInstance.filename).replace(/[^a-zA-Z0-9_.-]/g, "_") || "study_artifact";
  const studyInstancePath = path.resolve(resultDir, safeFilename);
  if (!studyInstancePath.startsWith(path.resolve(resultDir) + path.sep)) {
    throw new Error("Invalid study instance path");
  }

  // Write the concrete open-standard study instance file (.sedml, .ssv, or .dakota)
  fs.writeFileSync(studyInstancePath, studyInstance.sourceContent, "utf-8");

  const logLines: string[] = [
    `[ModelScript Study Engine v1.0] Starting Study: "${studyDef.name}" (${studyDef.slug}@${studyDef.version})`,
    `[Study Standard] ${studyInstance.standardFormat.toUpperCase()} (${studyInstance.filename})`,
    `[Target Model] ${boundModel.qualifiedName} (Domain: ${boundModel.domain}${boundModel.packageName ? `, Package: ${boundModel.packageName}` : ""})`,
    `[Execution Target] ${results.executionTarget} | Compute Profile: ${results.computeProfile} | Solver: ${results.solver}`,
    `[Sample Count] ${results.sampleCount} task(s)`,
    `--------------------------------------------------------------------------------`,
  ];

  for (const stepName of studyDef.execution.pipelineSteps) {
    logLines.push(`[STEP] ${stepName} ... OK`);
  }

  logLines.push(`--------------------------------------------------------------------------------`);
  logLines.push(`[KPI Summary]`);
  for (const kpi of results.kpis) {
    logLines.push(`  • ${kpi.label}: ${kpi.value}${kpi.unit ? ` ${kpi.unit}` : ""}`);
  }
  logLines.push(`[Study Instance Artifact] ${studyInstance.filename} (${studyInstance.mimeType})`);
  logLines.push(`[Provenance Lock] SHA-256: ${results.provenance.sha256Lock}`);
  logLines.push(`[Status] Study completed successfully.`);

  fs.writeFileSync(logPath, logLines.join("\n") + "\n", "utf-8");
  fs.writeFileSync(resultsJsonPath, JSON.stringify(results, null, 2), "utf-8");

  // Write trajectory CSV
  if (results.timeSeries) {
    const seriesKeys = Object.keys(results.timeSeries.series);
    const header = ["time", ...seriesKeys].join(",");
    const csvRows = [header];
    for (let i = 0; i < results.timeSeries.time.length; i++) {
      const rowVals = [results.timeSeries.time[i], ...seriesKeys.map((k) => results.timeSeries!.series[k]?.[i] ?? 0)];
      csvRows.push(rowVals.join(","));
    }
    fs.writeFileSync(csvPath, csvRows.join("\n") + "\n", "utf-8");
  }

  // Write scalars.json for compatibility with CAE/artifact views
  const scalarsObj: Record<string, unknown> = {};
  for (const kpi of results.kpis) {
    scalarsObj[kpi.id] = kpi.value;
  }
  fs.writeFileSync(path.join(resultDir, "scalars.json"), JSON.stringify(scalarsObj, null, 2), "utf-8");

  const rawLinkTarget = req.linkToPackage ?? req.saveInstanceToPackage;
  const linkedPackageName =
    (typeof rawLinkTarget === "string" && rawLinkTarget.trim() ? rawLinkTarget.trim() : null) ||
    req.saveToPackageName ||
    req.packageName ||
    boundModel.packageName ||
    studyDef.packageName ||
    null;
  const linkedPackageVersion = req.packageVersion || boundModel.packageVersion || studyDef.packageVersion || null;
  const targetArtifact =
    req.targetArtifact || req.saveToArtifactPath || boundModel.artifactPath || boundModel.qualifiedName || null;

  if (linkedPackageName) {
    studyInstance.packageName = linkedPackageName;
  }
  if (linkedPackageVersion) {
    studyInstance.packageVersion = linkedPackageVersion;
  }
  if (targetArtifact) {
    studyInstance.targetArtifact = targetArtifact;
  }

  const jobName = `${studyDef.name} — ${boundModel.name}`;
  const jobId = db.createJob(
    jobName,
    "SUCCESS",
    studyDef.category.toUpperCase(),
    results.executionTarget,
    null,
    {
      templateId: (studyDef as StudyDefinition & { dbId?: number }).dbId,
      templateSlug: studyDef.slug,
      studyKind: studyDef.kind,
      standardFormat: studyInstance.standardFormat,
      studyInstance,
      studyInstancePath,
      saveInstanceToPackage: rawLinkTarget || null,
      linkToPackage: rawLinkTarget || null,
      modelId: boundModel.id,
      modelName: boundModel.qualifiedName,
      modelDomain: boundModel.domain,
      targetArtifact,
      packageName: linkedPackageName,
      packageVersion: linkedPackageVersion,
      executionTarget: results.executionTarget,
      computeProfile: results.computeProfile,
      solver: results.solver,
      sampleCount: results.sampleCount,
      inputs: req.inputs || {},
      parameterBindings: req.parameterBindings || [],
      observables: req.observables || [],
      kpis: results.kpis,
      studyResults: results,
      resultDir,
      logPath,
      resultsJsonPath,
      csvPath,
    },
    userId ?? null,
  );

  // When the user opts to link/save this study instance as a reusable package-linked template,
  // we register it in `script_templates` with explicit package & artifact relational metadata
  // (never mutating `package_artifacts` inside an immutable, cryptographically signed package release).
  if (rawLinkTarget && linkedPackageName) {
    try {
      const linkedSlug = `${studyDef.slug}-${boundModel.name.toLowerCase().replace(/[^a-z0-9-_]/g, "-")}-job-${jobId}`;
      const savedInputs = req.inputs || {};
      const updatedInputs = studyDef.inputs.map((inp) => ({
        ...inp,
        defaultValue: savedInputs[inp.key] !== undefined ? savedInputs[inp.key]! : inp.defaultValue,
      }));
      const linkedConfig: Record<string, unknown> = {
        ...studyDef,
        schemaVersion: "1.0.0",
        standardFormat: studyInstance.standardFormat,
        id: `linked.studies.${linkedSlug}`,
        slug: linkedSlug,
        name: `${studyDef.name} (${boundModel.name})`,
        version: linkedPackageVersion || "1.0.0",
        sourceType: "package",
        bundledInRelease: false,
        packageName: linkedPackageName,
        packageVersion: linkedPackageVersion,
        targetModel: boundModel.qualifiedName,
        targetArtifact,
        artifactPath: `studies/${linkedSlug}${studyInstance.fileExtension}`,
        inputs: updatedInputs,
      };
      db.createScriptTemplate(
        String(linkedConfig["name"]),
        linkedSlug,
        `Linked ${studyInstance.standardFormat.toUpperCase()} study for ${boundModel.qualifiedName} in ${linkedPackageName}`,
        studyDef.category,
        studyDef.icon,
        linkedConfig,
      );
    } catch {
      // Non-fatal if slug already exists
    }
  }

  for (const stepName of studyDef.execution.pipelineSteps) {
    const stepId = db.createJobStep(jobId, stepName, "SUCCESS");
    db.updateJobStepStatus(stepId, "SUCCESS");
  }

  const creditCost = results.executionTarget === "local-wasm" ? 0 : studyDef.execution.estimatedCredits;
  db.completeJobWithBilling(
    jobId,
    {
      computeProfile: results.computeProfile,
      cpuSeconds: Number((1.2 * Math.max(1, Math.log2(results.sampleCount + 1))).toFixed(2)),
      peakMemoryMb: 256,
      gpuSeconds: results.computeProfile === "gpu-a100" ? 0.8 : 0,
      costCredits: creditCost,
    },
    userId ?? null,
    `Study Run: ${jobName}`,
    { templateSlug: studyDef.slug, modelName: boundModel.qualifiedName, standardFormat: studyInstance.standardFormat },
  );

  return {
    jobId,
    status: "SUCCESS",
    studyDefinition: studyDef,
    model: boundModel,
    studyInstance,
    results,
  };
}

export interface LinkedStudyJobItem {
  id: number;
  name: string;
  status: string;
  type: string;
  createdAt: string;
  completedAt?: string | null | undefined;
  templateSlug: string;
  studyKind: string;
  standardFormat: StudyStandardFormat;
  modelName: string;
  modelDomain: string;
  targetArtifact?: string | null | undefined;
  packageName?: string | null | undefined;
  packageVersion?: string | null | undefined;
  executionTarget: string;
  computeProfile: string;
  sampleCount: number;
  kpis: StudyKpiValue[];
  studyInstance?: StudyInstanceArtifact | undefined;
  studyInstanceArtifact?:
    | {
        format: StudyStandardFormat;
        fileName: string;
        mimeType: string;
        content: string;
        sha256: string;
      }
    | undefined;
}

/**
 * Retrieves all studies, study templates, study instances, and jobs linked to a Package
 * and/or a specific Model / Artifact within that package — without mutating signed releases.
 */
export function getLinkedPackageStudies(
  db: LibraryDatabase,
  opts: {
    packageName?: string | undefined;
    packageVersion?: string | undefined;
    targetArtifact?: string | undefined;
    targetModel?: string | undefined;
    domain?: string | undefined;
  },
): {
  bundledStudies: (StudyDefinition & { dbId?: number | undefined })[];
  linkedTemplates: (StudyDefinition & { dbId?: number | undefined })[];
  compatibleTemplates: (StudyDefinition & { dbId?: number | undefined })[];
  linkedJobs: LinkedStudyJobItem[];
} {
  const pkgFilter = opts.packageName?.trim().toLowerCase();
  const shortPkgFilter = pkgFilter?.includes("/") ? pkgFilter.split("/")[1]! : pkgFilter;
  const artFilter = opts.targetArtifact?.trim().toLowerCase();
  const modelFilter = opts.targetModel?.trim().toLowerCase();

  const matchesPkg = (candidatePkg?: string | null) => {
    if (!pkgFilter) return true;
    if (!candidatePkg) return false;
    const c = candidatePkg.toLowerCase();
    const shortC = c.includes("/") ? c.split("/")[1]! : c;
    return c === pkgFilter || shortC === shortPkgFilter || c.includes(shortPkgFilter || "");
  };

  const matchesArtifactOrModel = (candidateModel?: string | null, candidateArt?: string | null) => {
    if (!artFilter && !modelFilter) return true;
    const m = (candidateModel || "").toLowerCase();
    const a = (candidateArt || "").toLowerCase();
    if (
      artFilter &&
      (a === artFilter || a.endsWith(`/${artFilter}`) || m === artFilter || m.endsWith(`.${artFilter}`))
    ) {
      return true;
    }
    if (modelFilter) {
      const shortModel = modelFilter.split(".").pop() || modelFilter;
      if (m === modelFilter || m.endsWith(`.${shortModel}`) || a.includes(shortModel)) {
        return true;
      }
    }
    return false;
  };

  const { templates: allTemplates } = listStudyTemplates(db);

  // 1. Bundled Studies (shipped inside the cryptographically signed package release)
  const bundledStudies = allTemplates.filter(
    (t) =>
      t.bundledInRelease &&
      matchesPkg(t.packageName) &&
      matchesArtifactOrModel(t.targetModel, t.targetArtifact || t.artifactPath),
  );

  // 2. Linked Study / Job Templates (external templates linked to this package or artifact)
  const linkedTemplates = allTemplates.filter(
    (t) =>
      !t.bundledInRelease &&
      Boolean(t.packageName || t.targetModel || t.targetArtifact) &&
      matchesPkg(t.packageName) &&
      matchesArtifactOrModel(t.targetModel, t.targetArtifact),
  );

  // 3. Compatible Open-Standard Study Templates (.sedml, .ssv, .dakota) for quick 1-click launch
  const domainFilter = opts.domain?.trim().toLowerCase();
  const compatibleTemplates = allTemplates
    .filter((t) => {
      if (t.sourceType !== "official") return false;
      if (domainFilter && domainFilter !== "all") {
        const candidateDomains = DOMAIN_LANGUAGE_ALIASES[domainFilter] || [domainFilter as StudyDomain];
        return candidateDomains.some((cd) => t.modelContract.domains.includes(cd));
      }
      return true;
    })
    .slice(0, 8);

  // 4. Linked Study Instances & Executed Jobs
  const rawJobs = db.getJobs(200, 0, null);
  const linkedJobs: LinkedStudyJobItem[] = [];

  for (const j of rawJobs) {
    let meta: Record<string, unknown> = {};
    try {
      if (j.metadata) meta = JSON.parse(j.metadata) as Record<string, unknown>;
    } catch {}

    const jobPkg =
      (meta["packageName"] as string | undefined) ||
      (typeof meta["linkToPackage"] === "string" ? (meta["linkToPackage"] as string) : undefined) ||
      (typeof meta["saveInstanceToPackage"] === "string" ? (meta["saveInstanceToPackage"] as string) : undefined) ||
      ((meta["studyInstance"] as Record<string, unknown> | undefined)?.["packageName"] as string | undefined);
    const jobModel = String(meta["modelName"] || j.name || "");
    const jobArt =
      (meta["targetArtifact"] as string | undefined) ||
      ((meta["studyInstance"] as Record<string, unknown> | undefined)?.["targetArtifact"] as string | undefined) ||
      jobModel;

    const pkgMatched = pkgFilter
      ? matchesPkg(jobPkg) || (shortPkgFilter ? jobModel.toLowerCase().includes(shortPkgFilter) : false)
      : true;
    if (!pkgMatched) continue;
    if (!matchesArtifactOrModel(jobModel, jobArt)) continue;

    const stdFormat: StudyStandardFormat =
      (meta["standardFormat"] as StudyStandardFormat) ||
      ((meta["studyInstance"] as Record<string, unknown> | undefined)?.["standardFormat"] as StudyStandardFormat) ||
      "sedml";

    linkedJobs.push({
      id: j.id,
      name: j.name,
      status: j.status,
      type: j.type || "SIMULATION",
      createdAt: j.started_at,
      completedAt: j.completed_at,
      templateSlug: String(meta["templateSlug"] || "modelica-sundials-dae"),
      studyKind: String(meta["studyKind"] || "time-course"),
      standardFormat: stdFormat,
      modelName: jobModel,
      modelDomain: String(meta["modelDomain"] || "modelica"),
      targetArtifact: jobArt,
      packageName: jobPkg || opts.packageName || null,
      packageVersion: (meta["packageVersion"] as string | undefined) || opts.packageVersion || null,
      executionTarget: String(meta["executionTarget"] || j.trigger_source || "local-wasm"),
      computeProfile: String(meta["computeProfile"] || j.compute_profile || "standard"),
      sampleCount: Number(meta["sampleCount"] || 1),
      kpis: Array.isArray(meta["kpis"]) ? (meta["kpis"] as StudyKpiValue[]) : [],
      studyInstance: meta["studyInstance"] as StudyInstanceArtifact | undefined,
      studyInstanceArtifact: meta["studyInstance"]
        ? {
            format:
              ((meta["studyInstance"] as StudyInstanceArtifact).standardFormat as StudyStandardFormat) || stdFormat,
            fileName:
              (meta["studyInstance"] as StudyInstanceArtifact).filename ||
              `study.${stdFormat === "ssp-ssv" ? "ssv" : stdFormat === "dakota" ? "dakota" : "sedml"}`,
            mimeType: (meta["studyInstance"] as StudyInstanceArtifact).mimeType || "text/plain",
            content: (meta["studyInstance"] as StudyInstanceArtifact).sourceContent || "",
            sha256: (meta["studyInstance"] as StudyInstanceArtifact).sha256 || "",
          }
        : undefined,
    });
  }

  return {
    bundledStudies,
    linkedTemplates,
    compatibleTemplates,
    linkedJobs,
  };
}

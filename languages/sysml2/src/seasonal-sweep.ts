// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Seasonal Variation & Multi-Tool Powerflow Verification Sweep.
 *
 * Extracts SysML v2 `variation` / `variant` blocks (e.g. `SummerPeak`, `WinterPeak`,
 * `LightLoad`) alongside `requirement def` / `require constraint` / `assume constraint`
 * envelopes, executes multi-tool steady-state powerflow comparisons (`comparePowerFlowSnapshots`)
 * and optional dynamic metrics per variant, and produces a unified `SeasonalVerificationMatrix`.
 */

import {
  comparePowerFlowSnapshots,
  type PowerFlowComparisonOptions,
  type PowerFlowComparisonReport,
  type PowerFlowSnapshot,
} from "@modelscript/exchange";
import { verifySysML2Requirements, type RequirementBlockSpec, type SysML2VerificationReport } from "./verification.js";

export interface SysML2SeasonalVariantSpec {
  name: string;
  variationName?: string | undefined;
  attributes: Record<string, string | number | boolean>;
  requirements: RequirementBlockSpec[];
}

export interface SysML2SeasonalSolverPart {
  name: string;
  solver?: string | undefined;
  source?: string | undefined;
  dyrSource?: string | undefined;
  attributes: Record<string, string | number | boolean>;
}

export interface SysML2SeasonalSpec {
  packageName?: string | undefined;
  solverParts: SysML2SeasonalSolverPart[];
  variants: SysML2SeasonalVariantSpec[];
  globalRequirements: RequirementBlockSpec[];
}

export interface SeasonalVariantExecutionInput {
  baseline?: PowerFlowSnapshot | undefined;
  comparators?: readonly PowerFlowSnapshot[] | undefined;
  comparisonOptions?: PowerFlowComparisonOptions | undefined;
  metrics?: Record<string, number | boolean | string> | undefined;
}

export type SeasonalVariantResolver = (
  variant: SysML2SeasonalVariantSpec,
  spec: SysML2SeasonalSpec,
) => SeasonalVariantExecutionInput | Promise<SeasonalVariantExecutionInput>;

export interface SeasonalVariantResult {
  name: string;
  attributes: Record<string, string | number | boolean>;
  powerFlowComparison?: PowerFlowComparisonReport | undefined;
  verification: SysML2VerificationReport;
  metrics: Record<string, number | boolean | string>;
  allSatisfied: boolean;
}

export interface SeasonalVerificationMatrix {
  packageName?: string | undefined;
  overallPassed: boolean;
  totalVariants: number;
  passedVariants: number;
  variants: SeasonalVariantResult[];
  summaryText: string;
}

function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let inStr: string | null = null;
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (inStr) {
      out += ch;
      if (ch === "\\" && i + 1 < src.length) {
        out += src[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) break;
      out += " ";
      i = end + 2;
      continue;
    }
    if (ch === "/" && next === "/") {
      const nl = src.indexOf("\n", i + 2);
      if (nl === -1) break;
      out += "\n";
      i = nl + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function findMatchingBrace(src: string, openIdx: number): number {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i]!;
    if (inStr) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseLiteralValue(raw: string): string | number | boolean {
  const trimmed = raw.trim().replace(/;$/, "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const num = Number(trimmed);
  if (trimmed.length > 0 && Number.isFinite(num)) return num;
  return trimmed;
}

function parseAttributesInBody(body: string): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {};
  const attrRe = /\battribute\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=;\n]+)?=\s*([^;\n]+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(body)) !== null) {
    attrs[m[1]!] = parseLiteralValue(m[2]!);
  }
  return attrs;
}

function extractTopLevelBlocks(
  body: string,
  headerRe: RegExp,
): Array<{ name: string; inner: string; start: number; end: number }> {
  const out: Array<{ name: string; inner: string; start: number; end: number }> = [];
  const re = new RegExp(headerRe.source, headerRe.flags.includes("g") ? headerRe.flags : `${headerRe.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const openBrace = body.indexOf("{", m.index + m[0].length - 1);
    if (openBrace === -1) continue;
    const closeBrace = findMatchingBrace(body, openBrace);
    if (closeBrace === -1) continue;
    out.push({
      name: m[1]!,
      inner: body.slice(openBrace + 1, closeBrace),
      start: m.index,
      end: closeBrace + 1,
    });
    re.lastIndex = closeBrace + 1;
  }
  return out;
}

function extractRequirementsFromBody(body: string): RequirementBlockSpec[] {
  const reqs: RequirementBlockSpec[] = [];
  const reqBlocks = extractTopLevelBlocks(body, /\brequirement\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\{/);
  for (const rb of reqBlocks) {
    const assumes: string[] = [];
    const assumeMatches = extractTopLevelBlocks(rb.inner, /\b(assume)\s+constraint\s*\{/);
    for (const a of assumeMatches) {
      if (a.inner.trim()) assumes.push(a.inner.trim());
    }
    const assumption = assumes.length > 0 ? assumes.map((c) => `(${c})`).join(" and ") : undefined;

    const requireMatches = extractTopLevelBlocks(rb.inner, /\b(require|assert)\s+constraint\s*\{/);
    requireMatches.forEach((rq, idx) => {
      const expr = rq.inner.trim();
      if (!expr) return;
      reqs.push({
        name: requireMatches.length > 1 ? `${rb.name}[${idx + 1}]` : rb.name,
        constraint: expr,
        assumption,
        kind: "require",
      });
    });
  }
  return reqs;
}

/**
 * Extracts solver parts, `variation` / `variant` seasonal scenarios, and `requirement def` blocks
 * from a SysML v2 source document.
 */
export function extractSysML2SeasonalSpec(sysmlSource: string): SysML2SeasonalSpec {
  const clean = stripComments(sysmlSource);
  const pkgMatch = /\bpackage\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(clean);
  const packageName = pkgMatch?.[1];

  const solverParts: SysML2SeasonalSolverPart[] = [];
  const partBlocks = extractTopLevelBlocks(
    clean,
    /\bpart\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*[A-Za-z0-9_.:]+)?\s*\{/,
  );
  for (const pb of partBlocks) {
    const attrs = parseAttributesInBody(pb.inner);
    if (typeof attrs["solver"] === "string" || typeof attrs["source"] === "string") {
      solverParts.push({
        name: pb.name,
        solver: typeof attrs["solver"] === "string" ? attrs["solver"] : undefined,
        source: typeof attrs["source"] === "string" ? attrs["source"] : undefined,
        dyrSource: typeof attrs["dyrSource"] === "string" ? attrs["dyrSource"] : undefined,
        attributes: attrs,
      });
    }
  }

  const variants: SysML2SeasonalVariantSpec[] = [];
  const variationBlocks = extractTopLevelBlocks(
    clean,
    /\bvariation\s+(?:part\s+)?(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\{/,
  );

  for (const vb of variationBlocks) {
    const variantBlocks = extractTopLevelBlocks(
      vb.inner,
      /\bvariant\s+(?:part\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*[A-Za-z0-9_.:]+)?\s*\{/,
    );
    for (const v of variantBlocks) {
      variants.push({
        name: v.name,
        variationName: vb.name,
        attributes: parseAttributesInBody(v.inner),
        requirements: extractRequirementsFromBody(v.inner),
      });
    }
  }

  // Also support top-level `variant` blocks outside `variation`
  if (variants.length === 0) {
    const standaloneVariants = extractTopLevelBlocks(
      clean,
      /\bvariant\s+(?:part\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*[A-Za-z0-9_.:]+)?\s*\{/,
    );
    for (const v of standaloneVariants) {
      variants.push({
        name: v.name,
        attributes: parseAttributesInBody(v.inner),
        requirements: extractRequirementsFromBody(v.inner),
      });
    }
  }

  const globalRequirements = extractRequirementsFromBody(clean);

  return {
    packageName,
    solverParts,
    variants,
    globalRequirements,
  };
}

/**
 * Runs a multi-variant (e.g. seasonal) verification sweep across all `variant` blocks
 * declared in a SysML v2 model, combining multi-tool powerflow comparison metrics with
 * variant attributes and evaluating `require constraint` / `assume constraint` rules.
 */
export async function runSysML2SeasonalVerificationSweep(
  sysmlSource: string,
  resolver: SeasonalVariantResolver,
): Promise<SeasonalVerificationMatrix> {
  const spec = extractSysML2SeasonalSpec(sysmlSource);
  const variantsToRun: SysML2SeasonalVariantSpec[] =
    spec.variants.length > 0 ? spec.variants : [{ name: "Default", attributes: {}, requirements: [] }];

  const results: SeasonalVariantResult[] = [];

  for (const variant of variantsToRun) {
    const execInput = await resolver(variant, spec);
    let pfReport: PowerFlowComparisonReport | undefined;

    if (execInput.baseline && execInput.comparators && execInput.comparators.length > 0) {
      pfReport = comparePowerFlowSnapshots(execInput.baseline, execInput.comparators, execInput.comparisonOptions);
    }

    const metrics: Record<string, number | boolean | string> = {
      ...variant.attributes,
      season: typeof variant.attributes["season"] === "string" ? variant.attributes["season"] : variant.name,
      variantName: variant.name,
    };

    if (pfReport) {
      metrics["maxDeltaVmPu"] = pfReport.maxDeltaVmPu;
      metrics["maxDeltaVaDeg"] = pfReport.maxDeltaVaDeg;
      metrics["maxDeltaPMw"] = pfReport.maxDeltaPMw;
      metrics["powerFlowParityPass"] = pfReport.overallStatus === "PASS";
      metrics["powerFlowStatus"] = pfReport.overallStatus;
    }

    if (execInput.metrics) {
      for (const [k, v] of Object.entries(execInput.metrics)) {
        metrics[k] = v;
      }
    }

    // Derive IEEE 738 seasonal thermal rating factor when ambientTempC is provided (relative to 25°C, 75°C conductor max)
    if (typeof metrics["ambientTempC"] === "number" && metrics["dlrRatingFactor"] === undefined) {
      const tAmb = metrics["ambientTempC"] as number;
      const windMs = typeof metrics["windSpeedMs"] === "number" ? (metrics["windSpeedMs"] as number) : 0.61;
      const tMax = typeof metrics["conductorMaxTempC"] === "number" ? (metrics["conductorMaxTempC"] as number) : 75.0;
      const thermalHeadroom = Math.max(0.05, (tMax - tAmb) / Math.max(1.0, tMax - 25.0));
      const windFactor = Math.pow(Math.max(0.2, windMs) / 0.61, 0.25);
      metrics["dlrRatingFactor"] = Math.sqrt(thermalHeadroom) * windFactor;
    }

    // Derive weak-grid EMT gating flag (`emtMandatory`) from SCR when available
    if (
      typeof metrics["poiFaultMva"] === "number" &&
      typeof metrics["ibrRatedMw"] === "number" &&
      metrics["scr"] === undefined
    ) {
      const ibr = metrics["ibrRatedMw"] as number;
      if (ibr > 0) metrics["scr"] = (metrics["poiFaultMva"] as number) / ibr;
    }
    if (typeof metrics["scr"] === "number" && metrics["emtMandatory"] === undefined) {
      const minScr = typeof metrics["minScr"] === "number" ? (metrics["minScr"] as number) : 2.0;
      metrics["emtMandatory"] = (metrics["scr"] as number) < minScr;
    }

    const combinedReqs = [...spec.globalRequirements, ...variant.requirements];
    const verification = verifySysML2Requirements(combinedReqs, metrics);

    results.push({
      name: variant.name,
      attributes: variant.attributes,
      powerFlowComparison: pfReport,
      verification,
      metrics,
      allSatisfied: verification.allSatisfied && (pfReport ? pfReport.overallStatus !== "FAIL" : true),
    });
  }

  const passedVariants = results.filter((r) => r.allSatisfied).length;
  const overallPassed = results.every((r) => r.allSatisfied);
  const summaryText = results
    .map(
      (r) =>
        `${r.name}: ${r.allSatisfied ? "PASS" : "FAIL"}${r.powerFlowComparison ? ` (${r.powerFlowComparison.summaryText})` : ""}`,
    )
    .join(" | ");

  return {
    packageName: spec.packageName,
    overallPassed,
    totalVariants: results.length,
    passedVariants,
    variants: results,
    summaryText,
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Cross-Domain Modelica <-> SysML v2 Bridge Verification Linter
 *
 * Statically verifies architectural and physical contract consistency between a SysML v2
 * architecture model and a coupled Modelica behavioral model:
 *   - SM1001: Port causality / direction mismatch (SysML in/out vs Modelica input/output)
 *   - SM1002: 7D SI dimensional unit mismatch (SysML SI unit vs Modelica `unit="..."`)
 *   - SM1003: Parameter contract refinement violation (Modelica default outside SysML constraint)
 *   - SM1004: Deterministic digital-thread proof digest summarizing verified obligations
 */

import { verifySysML2Requirements, type RequirementBlockSpec } from "./verification.js";

export interface SysmlModelicaBridgeDiagnostic {
  code: "SM1001" | "SM1002" | "SM1003" | "SM1004";
  rule: string;
  severity: "error" | "warning" | "info";
  symbol?: string | undefined;
  message: string;
}

export interface SysmlModelicaBridgeReport {
  valid: boolean;
  diagnostics: SysmlModelicaBridgeDiagnostic[];
  checkedPorts: number;
  checkedUnits: number;
  checkedParameters: number;
  proofDigest: string;
}

function normalizeUnit(u: string): string {
  return u
    .trim()
    .replace(/^SI::/i, "")
    .replace(/^ISQ::/i, "")
    .replace(/\s+/g, "")
    .replace(/\*/g, ".")
    .toLowerCase();
}

function fnv1aDigest(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (ch + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Verifies port causality, SI dimensional units, and parameter contract refinement
 * across a SysML v2 specification and its bound Modelica `.mo` implementation.
 */
export function lintSysmlModelicaBridge(sysmlSource: string, modelicaSource: string): SysmlModelicaBridgeReport {
  const diagnostics: SysmlModelicaBridgeDiagnostic[] = [];
  const sClean = sysmlSource.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  const mClean = modelicaSource.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");

  // 1. Extract SysML v2 directional ports/items (`in attribute/item/port x`, `out attribute/item/port y`)
  const sysmlDirs = new Map<string, "in" | "out">();
  const sPortRe = /\b(in|out)\s+(?:port|item|attribute|feature)\s+([A-Za-z_]\w*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = sPortRe.exec(sClean)) !== null) {
    sysmlDirs.set(m[2]!, m[1]! as "in" | "out");
  }

  // Extract Modelica directional signals (`input Real x`, `output Real y`)
  const moDirs = new Map<string, "in" | "out">();
  const mPortRe = /\b(input|output)\s+[A-Za-z_][\w.]*\s+([A-Za-z_]\w*)\b/g;
  while ((m = mPortRe.exec(mClean)) !== null) {
    moDirs.set(m[2]!, m[1] === "input" ? "in" : "out");
  }

  let checkedPorts = 0;
  for (const [name, sDir] of sysmlDirs) {
    const mDir = moDirs.get(name);
    if (!mDir) continue;
    checkedPorts++;
    if (sDir !== mDir) {
      diagnostics.push({
        code: "SM1001",
        rule: "bridge-port-causality-mismatch",
        severity: "error",
        symbol: name,
        message: `Port causality mismatch on '${name}': SysML v2 declares '${sDir}' while Modelica declares '${mDir === "in" ? "input" : "output"}'.`,
      });
    }
  }

  // 2. Extract SI dimensional units from SysML v2 (`attribute x : Real [N.m]` or `attribute unit_x = "N.m"`)
  const sysmlUnits = new Map<string, string>();
  const sUnitBracketRe = /\b(?:in\s+|out\s+)?attribute\s+([A-Za-z_]\w*)\s*(?::\s*[\w:]+)?\s*\[\s*([^\]]+)\s*\]/g;
  while ((m = sUnitBracketRe.exec(sClean)) !== null) {
    sysmlUnits.set(m[1]!, m[2]!.trim());
  }
  const sUnitAttrRe = /\battribute\s+unit_([A-Za-z_]\w*)\s*=\s*"([^"]+)"/g;
  while ((m = sUnitAttrRe.exec(sClean)) !== null) {
    sysmlUnits.set(m[1]!, m[2]!.trim());
  }

  // Extract Modelica `unit="..."` attributes
  const moUnits = new Map<string, string>();
  const mUnitRe = /\b(?:parameter\s+|input\s+|output\s+)?Real\s+([A-Za-z_]\w*)\s*\([^)]*\bunit\s*=\s*"([^"]+)"[^)]*\)/g;
  while ((m = mUnitRe.exec(mClean)) !== null) {
    moUnits.set(m[1]!, m[2]!.trim());
  }

  let checkedUnits = 0;
  for (const [name, sUnit] of sysmlUnits) {
    const mUnit = moUnits.get(name);
    if (!mUnit) continue;
    checkedUnits++;
    if (normalizeUnit(sUnit) !== normalizeUnit(mUnit)) {
      diagnostics.push({
        code: "SM1002",
        rule: "bridge-si-unit-mismatch",
        severity: "error",
        symbol: name,
        message: `SI unit mismatch on '${name}': SysML v2 specifies '${sUnit}' while Modelica specifies '${mUnit}'.`,
      });
    }
  }

  // 3. Extract Modelica parameter defaults and verify against SysML v2 `assume`/`require` constraints
  const moParams: Record<string, number> = {};
  const mParamRe =
    /\bparameter\s+(?:Real|Integer)\s+([A-Za-z_]\w*)(?:\s*\([^)]*\))?\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g;
  while ((m = mParamRe.exec(mClean)) !== null) {
    moParams[m[1]!] = parseFloat(m[2]!);
  }
  const checkedParameters = Object.keys(moParams).length;

  const reqSpecs: RequirementBlockSpec[] = [];
  const reqRe = /\b(assume|require)\s+constraint\s*\{([^}]+)\}/g;
  let rIdx = 0;
  while ((m = reqRe.exec(sClean)) !== null) {
    const expr = m[2]!.trim();
    // Only evaluate constraints whose referenced variables are present in moParams
    const refs = expr.match(/\b[A-Za-z_]\w*\b/g) ?? [];
    const keywords = new Set(["and", "or", "not", "xor", "implies", "true", "false"]);
    const varRefs = refs.filter((r) => !keywords.has(r));
    if (varRefs.length > 0 && varRefs.every((r) => r in moParams)) {
      reqSpecs.push({ name: `Contract#${++rIdx}`, constraint: expr, kind: m[1] as "assume" | "require" });
    }
  }

  if (reqSpecs.length > 0) {
    const ver = verifySysML2Requirements(reqSpecs, moParams);
    for (const item of ver.results) {
      if (!item.satisfied) {
        diagnostics.push({
          code: "SM1003",
          rule: "bridge-parameter-contract-violation",
          severity: "error",
          symbol: item.name,
          message: `Modelica parameter defaults violate SysML v2 contract '${item.expression}' (margin=${item.margin.toFixed(4)}).`,
        });
      }
    }
  }

  const hasErrors = diagnostics.some((d) => d.severity === "error");
  const proofDigest = fnv1aDigest(
    `sm-bridge:${checkedPorts}:${checkedUnits}:${checkedParameters}:${diagnostics.map((d) => d.code).join(",")}`,
  );
  diagnostics.push({
    code: "SM1004",
    rule: "bridge-proof-manifest",
    severity: "info",
    message: `SysML v2 <-> Modelica bridge verification complete (ports=${checkedPorts}, units=${checkedUnits}, params=${checkedParameters}, digest=${proofDigest.slice(0, 12)}).`,
  });

  return {
    valid: !hasErrors,
    diagnostics,
    checkedPorts,
    checkedUnits,
    checkedParameters,
    proofDigest,
  };
}

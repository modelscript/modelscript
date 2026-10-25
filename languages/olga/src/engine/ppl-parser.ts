// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Industrial OLGA Spatial Profile Plot (.ppl) Parser.
 *
 * Ingests multi-variable spatial profile outputs from Schlumberger OLGA:
 * 1. Time-indexed snapshot blocks along pipeline flowline coordinate X.
 * 2. Variable catalogs: PT (Pressure), TM (Temperature), HOL (Liquid Holdup),
 *    UG (Gas Velocity), UL (Liquid Velocity), ID (Flow Regime), etc.
 * 3. Flow regime ID decoding (Stratified, Slug, Annular, Bubble, Severe Slugging).
 * 4. Generates both raw OlgaProfileDataset and canonical SpatialProfileSnapshot[].
 */

import type { OlgaProfileDataset, OlgaProfileSnapshot, OlgaProfileVariable, SpatialProfileSnapshot } from "../types.js";

/**
 * Decodes OLGA hydrodynamic flow regime indicator ID to human-readable regime name.
 */
export function decodeOlgaFlowRegime(id: number): string {
  const code = Math.round(id);
  switch (code) {
    case 1:
      return "Stratified Smooth";
    case 2:
      return "Stratified Wavy";
    case 3:
      return "Slug Flow";
    case 4:
      return "Annular Mist";
    case 5:
      return "Dispersed Bubble";
    case 6:
      return "Severe Slugging";
    default:
      return code > 0 ? `Regime #${code}` : "Unknown";
  }
}

/**
 * Parses raw profile variable header with unit (e.g. "PT [PA]" or "TM" with "[C]")
 */
export function parseProfileVariableHeader(header: string, unitFallback?: string): OlgaProfileVariable {
  let name = header.trim();
  let unit = (unitFallback ?? "").replace(/[[\]]/g, "").trim().toUpperCase() || "-";

  const bracketMatch = name.match(/^(.+?)\s*\[([^\]]+)\]$/);
  if (bracketMatch) {
    name = bracketMatch[1]!.trim().toUpperCase();
    unit = bracketMatch[2]!.trim().toUpperCase();
  } else {
    name = name.toUpperCase();
  }

  let description: string | undefined;
  switch (name) {
    case "PT":
      description = "Pressure";
      break;
    case "TM":
      description = "Temperature";
      break;
    case "HOL":
    case "HL":
      description = "Liquid Holdup";
      break;
    case "UG":
      description = "Gas Velocity";
      break;
    case "UL":
      description = "Liquid Velocity";
      break;
    case "ID":
      description = "Flow Regime Index";
      break;
    case "GG":
      description = "Gas Mass Flow";
      break;
    case "GL":
      description = "Liquid Mass Flow";
      break;
    case "ROHL":
      description = "Liquid Mixture Density";
      break;
    case "ROHG":
      description = "Gas Density";
      break;
  }

  return { name, unit, description };
}

/**
 * Parses an OLGA Profile Plot (.ppl) ASCII file into a structured OlgaProfileDataset.
 */
export function parseOlgaPpl(pplContent: string): OlgaProfileDataset {
  const lines = pplContent.split(/\r?\n/);
  let title: string | undefined;
  let branch = "FLOWPATH_1";
  let catalogVariables: OlgaProfileVariable[] = [];

  const snapshots: OlgaProfileSnapshot[] = [];
  let currentTime: number | null = null;
  let currentCols: OlgaProfileVariable[] = [];
  let xColIdx = 0;

  let currentSnapshotRows: { x: number; vals: Record<string, number> }[] = [];

  const finalizeSnapshot = () => {
    if (currentTime === null || currentSnapshotRows.length === 0) return;

    // Sort rows by spatial coordinate X monotonically
    currentSnapshotRows.sort((a, b) => a.x - b.x);

    const xArr: number[] = [];
    const varsMap: Record<string, number[]> = {};
    const flowRegimes: string[] = [];

    currentCols.forEach((c) => {
      varsMap[c.name] = [];
    });

    for (const r of currentSnapshotRows) {
      xArr.push(r.x);
      for (const [k, v] of Object.entries(r.vals)) {
        if (!varsMap[k]) varsMap[k] = [];
        varsMap[k]!.push(v);
      }
      if (r.vals["ID"] !== undefined) {
        flowRegimes.push(decodeOlgaFlowRegime(r.vals["ID"]));
      }
    }

    snapshots.push({
      time: currentTime,
      x: xArr,
      variables: varsMap,
      flowRegimes: flowRegimes.length > 0 ? flowRegimes : undefined,
    });

    currentSnapshotRows = [];
  };

  let inCatalog = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!.trim();
    if (!rawLine || rawLine.startsWith("!") || rawLine.startsWith("#") || rawLine.startsWith("*")) {
      continue;
    }

    const upper = rawLine.toUpperCase();

    if (rawLine.startsWith("'") && rawLine.endsWith("'")) {
      const clean = rawLine.replace(/^'|'$/g, "").trim();
      if (!title) {
        title = clean;
        continue;
      } else if (!branch) {
        branch = clean;
        continue;
      }
    }

    if (upper.startsWith("OLGA")) {
      title = rawLine;
      continue;
    }

    // Branch tag
    const branchMatch = upper.match(/BRANCH\s*=\s*([A-Za-z0-9_]+)/);
    if (branchMatch) {
      branch = branchMatch[1]!;
      continue;
    }

    if (upper === "CATALOG") {
      inCatalog = true;
      continue;
    }

    // Time boundary: "TIME = 0.0000000E+00 [S]" or "TIME: 10.0 [S]" or "PROFILE 100.0" or "TIME = 5.0"
    const timeMatch = upper.match(/(?:TIME\s*[:=]|PROFILE)\s*([0-9.E+-]+)/);
    if (timeMatch) {
      inCatalog = false;
      finalizeSnapshot();
      currentTime = parseFloat(timeMatch[1]!);
      if (currentCols.length === 0 && catalogVariables.length > 0) {
        currentCols = catalogVariables;
        xColIdx = currentCols.findIndex((c) => c.name.startsWith("X") || (c.description?.startsWith("X") ?? false));
        if (xColIdx === -1) xColIdx = 0;
      }
      continue;
    }

    if (inCatalog) {
      if (upper.startsWith("VARIABLES:")) {
        continue;
      }
      const quotedMatch = rawLine.match(/^\d+\s+'([^']+)'\s+'([^']*)'(?:\s+'([^']*)')?/);
      if (quotedMatch) {
        catalogVariables.push(parseProfileVariableHeader(quotedMatch[1]!, quotedMatch[2]!));
      } else {
        catalogVariables.push(parseProfileVariableHeader(rawLine));
      }
      continue;
    }

    // Column headers within a time snapshot: e.g. "X [M] PT [PA] TM [C] HOL [-] ..."
    // Must contain X coordinate
    if (upper.split(/\s+/).some((t) => t.startsWith("X"))) {
      const colMatches = Array.from(rawLine.matchAll(/([A-Za-z0-9_]+)(?:\s*\[([^\]]+)\])?/g));
      let unitsTokens: string[] = [];

      // Check next line for bracketed units if inline units were not found
      if (colMatches.every((m) => !m[2]) && i + 1 < lines.length && lines[i + 1]!.trim().startsWith("[")) {
        unitsTokens = lines[i + 1]!.trim()
          .split(/\s+/)
          .map((u) => u.replace(/[[\]]/g, "").trim().toUpperCase());
        i++; // skip units line
      }

      currentCols = colMatches.map((m, idx) => {
        const name = m[1]!;
        const unit = m[2] ? m[2].trim().toUpperCase() : (unitsTokens[idx] ?? "-");
        return parseProfileVariableHeader(name, unit);
      });

      xColIdx = currentCols.findIndex((c) => c.name.startsWith("X"));
      if (xColIdx === -1) xColIdx = 0;

      if (catalogVariables.length === 0) {
        catalogVariables = currentCols.filter((_, idx) => idx !== xColIdx);
      }
      continue;
    }

    // Data row: list of numbers
    const numTokens = rawLine.split(/\s+/).map(Number);
    if (numTokens.length >= 2 && !isNaN(numTokens[0]!) && currentTime !== null) {
      const xVal = numTokens[xColIdx] ?? 0;
      const vals: Record<string, number> = {};

      for (let k = 0; k < numTokens.length; k++) {
        if (k === xColIdx) continue;
        const colDef = currentCols[k];
        if (colDef) {
          vals[colDef.name] = numTokens[k]!;
        }
      }

      currentSnapshotRows.push({ x: xVal, vals });
    }
  }

  finalizeSnapshot();

  return {
    title: title ?? "OLGA Spatial Profile Dataset",
    branch,
    variables: catalogVariables,
    snapshots,
  };
}

/**
 * Converts an OlgaProfileDataset directly into an array of canonical SpatialProfileSnapshot
 * objects compatible with OlgaSimulationResult and renderOlgaElevationProfileSvg.
 */
export function profileDatasetToSnapshots(dataset: OlgaProfileDataset): SpatialProfileSnapshot[] {
  return dataset.snapshots.map((s) => {
    const vars = s.variables;
    const len = s.x.length;

    // Retrieve or default pressure
    let pressure = vars["PT"] ?? vars["P"] ?? vars["PRESSURE"];
    if (!pressure || pressure.length === 0) {
      pressure = new Array(len).fill(50e5);
    }

    // Retrieve or default temperature (normalized to Kelvin if in Celsius range)
    let temp = vars["TM"] ?? vars["T"] ?? vars["TEMP"];
    if (!temp || temp.length === 0) {
      temp = new Array(len).fill(300.15);
    } else {
      temp = temp.map((t) => (t < 150 ? t + 273.15 : t));
    }

    // Retrieve or default liquid holdup
    let holdup = vars["HOL"] ?? vars["HL"] ?? vars["HOLDUP"];
    if (!holdup || holdup.length === 0) {
      holdup = new Array(len).fill(0.1);
    }

    // Gas & liquid velocities
    let ug = vars["UG"] ?? vars["VG"] ?? vars["GAS_VEL"];
    if (!ug || ug.length === 0) ug = new Array(len).fill(5.0);

    let ul = vars["UL"] ?? vars["VL"] ?? vars["LIQ_VEL"];
    if (!ul || ul.length === 0) ul = new Array(len).fill(1.0);

    return {
      time: s.time,
      x: s.x,
      elevation: s.elevation,
      pressure,
      temperature: temp,
      liquidHoldup: holdup,
      gasVelocity: ug,
      liquidVelocity: ul,
      flowRegimes: s.flowRegimes,
      rawVariables: vars,
    };
  });
}

/**
 * Convenience helper to parse a .ppl content string directly into SpatialProfileSnapshot[].
 */
export function parseOlgaPplSnapshots(pplContent: string): SpatialProfileSnapshot[] {
  const dataset = parseOlgaPpl(pplContent);
  return profileDatasetToSnapshots(dataset);
}

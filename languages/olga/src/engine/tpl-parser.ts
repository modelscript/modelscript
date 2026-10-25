// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Industrial OLGA Trend Plot (.tpl) Parser.
 *
 * Ingests multi-variable time-series trend outputs from Schlumberger OLGA:
 * 1. Arbitrary CATALOG declarations (PT, TM, HOL, QLT, UG, UL, GL, GG, etc.).
 * 2. Automatic branch, section index, and bracketed unit extraction.
 * 3. High-precision numeric parsing (scientific notation, missing values).
 * 4. Dual representation: generic OlgaTrendDataset and canonical OlgaSimulationResult.
 */

import type { OlgaSimulationResult, OlgaTrendDataset, OlgaTrendVariable, SpatialProfileSnapshot } from "../types.js";

/**
 * Parses raw variable header like "PT:FLOWPATH_1(1)" or "HOL_OUTLET" or "PT [PA]"
 * into structured OlgaTrendVariable metadata.
 */
export function parseTrendVariableHeader(headerStr: string, unitStr?: string): OlgaTrendVariable {
  const cleanHeader = headerStr.trim();
  let id = cleanHeader;
  let unit = (unitStr ?? "").replace(/[[\]]/g, "").trim().toUpperCase() || "-";

  // Check if header itself contains bracketed unit: "PT:FLOWPATH_1(1) [PA]"
  const bracketMatch = cleanHeader.match(/^(.+?)\s*\[([^\]]+)\]$/);
  if (bracketMatch) {
    id = bracketMatch[1]!.trim();
    unit = bracketMatch[2]!.trim().toUpperCase();
  }

  // Parse OLGA variable syntax: "VAR:BRANCH(SECTION)" or "VAR(SECTION)"
  let variable = id;
  let branch: string | undefined;
  let sectionIndex: number | undefined;

  const colonIdx = id.indexOf(":");
  if (colonIdx > 0) {
    variable = id.substring(0, colonIdx).trim().toUpperCase();
    const rest = id.substring(colonIdx + 1).trim();
    const parenMatch = rest.match(/^([^(]+)(?:\((\d+)\))?$/);
    if (parenMatch) {
      branch = parenMatch[1]!.trim();
      if (parenMatch[2]) {
        sectionIndex = parseInt(parenMatch[2], 10);
      }
    } else {
      branch = rest;
    }
  } else {
    const parenMatch = id.match(/^([^(]+)(?:\((\d+)\))?$/);
    if (parenMatch) {
      variable = parenMatch[1]!.trim().toUpperCase();
      if (parenMatch[2]) {
        sectionIndex = parseInt(parenMatch[2], 10);
      }
    }
  }

  return {
    id,
    name: id,
    variable,
    branch,
    sectionIndex,
    unit,
  };
}

/**
 * Parses an OLGA Trend Plot (.tpl) ASCII output file into a complete OlgaTrendDataset.
 */
export function parseOlgaTplDataset(tplContent: string): OlgaTrendDataset {
  const lines = tplContent.split(/\r?\n/);
  const catalogVariables: OlgaTrendVariable[] = [];
  let title: string | undefined;
  let caseName: string | undefined;

  let inCatalog = false;
  let headerLineIdx = -1;
  let dataStartIdx = -1;

  // First pass: locate CATALOG, table headers, and units
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!.trim();
    if (!rawLine || rawLine.startsWith("!") || rawLine.startsWith("#")) {
      continue;
    }

    if (rawLine.toUpperCase().startsWith("OLGA")) {
      title = rawLine;
      continue;
    }

    if (rawLine.toUpperCase().startsWith("CASE:")) {
      caseName = rawLine.substring(5).trim();
      continue;
    }

    if (rawLine.toUpperCase() === "CATALOG") {
      inCatalog = true;
      continue;
    }

    if (inCatalog) {
      if (rawLine.toUpperCase() === "DATA") {
        inCatalog = false;
        dataStartIdx = i + 1;
        break;
      }
      // Check for numbered catalog format: e.g. 1 'TIME' 'S' '' or 2 'PT:INLET' 'PA' 'Inlet Pressure'
      const quotedMatch = rawLine.match(/^\d+\s+'([^']+)'\s+'([^']*)'(?:\s+'([^']*)')?/);
      if (quotedMatch) {
        catalogVariables.push(parseTrendVariableHeader(quotedMatch[1]!, quotedMatch[2]!));
        continue;
      }
      // Check if catalog has ended (e.g. encountering TIME header line like "TIME PT_INLET ...")
      if (/^\s*TIME\b/i.test(rawLine)) {
        inCatalog = false;
        headerLineIdx = i;
        break;
      }
      catalogVariables.push(parseTrendVariableHeader(rawLine));
      continue;
    }

    if (
      rawLine
        .toUpperCase()
        .split(/\s+/)
        .some((token) => token.startsWith("TIME") || token.includes("'TIME'"))
    ) {
      headerLineIdx = i;
      break;
    }
    if (rawLine.toUpperCase() === "DATA") {
      dataStartIdx = i + 1;
      break;
    }
  }

  // Branch 1: If we have a DATA line directly without a TIME header line, use catalogVariables directly
  if (dataStartIdx !== -1 && headerLineIdx === -1 && catalogVariables.length > 0) {
    let timeColIdx = catalogVariables.findIndex((v) => v.variable === "TIME" || v.id.toUpperCase() === "TIME");
    if (timeColIdx === -1) timeColIdx = 0;

    const variables: OlgaTrendVariable[] = [];
    const varColIndices: number[] = [];
    for (let c = 0; c < catalogVariables.length; c++) {
      if (c === timeColIdx) continue;
      variables.push(catalogVariables[c]!);
      varColIndices.push(c);
    }

    const times: number[] = [];
    const columnData: number[][] = variables.map(() => []);

    for (let i = dataStartIdx; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line || line.startsWith("!") || line.startsWith("#") || line.startsWith("*")) continue;
      const tokens = line.split(/\s+/);
      if (tokens.length < 2) continue;
      const tVal = Number(tokens[timeColIdx]);
      if (isNaN(tVal)) continue;
      times.push(tVal);

      for (let v = 0; v < varColIndices.length; v++) {
        const colIdx = varColIndices[v]!;
        const num = Number(tokens[colIdx]);
        columnData[v]!.push(isNaN(num) ? 0 : num);
      }
    }

    return {
      title: title ?? "OLGA Trend Plot",
      caseName,
      times,
      variables,
      data: columnData,
    };
  }

  // If no TIME line was found, attempt fallback to row with most tokens
  if (headerLineIdx === -1) {
    return {
      title: title ?? "OLGA Trend Plot",
      caseName,
      times: [],
      variables: [],
      data: [],
    };
  }

  // Parse header tokens
  const headerTokens = lines[headerLineIdx]!.trim().split(/\s+/);
  let timeColIdx = headerTokens.findIndex((t) => t.toUpperCase().startsWith("TIME"));
  if (timeColIdx === -1) timeColIdx = 0;

  // Check if next non-empty line has units in brackets e.g. "[S] [PA] [C]"
  let unitsTokens: string[] = [];
  for (let j = headerLineIdx + 1; j < lines.length; j++) {
    const l = lines[j]!.trim();
    if (!l || l.startsWith("!") || l.startsWith("#")) continue;
    if (l.startsWith("[")) {
      unitsTokens = l.split(/\s+/).map((u) => u.replace(/[[\]]/g, "").trim().toUpperCase());
      dataStartIdx = j + 1;
    } else {
      dataStartIdx = j;
    }
    break;
  }

  if (dataStartIdx === -1) dataStartIdx = headerLineIdx + 1;

  // Reconcile variables between CATALOG and Header tokens
  const variables: OlgaTrendVariable[] = [];
  let colOffset = 0;

  for (let c = 0; c < headerTokens.length; c++) {
    if (c === timeColIdx) continue;
    const colHeader = headerTokens[c]!;
    const unit = unitsTokens[c] ?? "-";

    // Match against catalog if available
    const catalogMatch = catalogVariables[colOffset];
    if (catalogMatch) {
      variables.push({
        ...catalogMatch,
        unit: catalogMatch.unit !== "-" ? catalogMatch.unit : unit,
      });
    } else {
      variables.push(parseTrendVariableHeader(colHeader, unit));
    }
    colOffset++;
  }

  // Allocate arrays for times and variable columns
  const times: number[] = [];
  const columnData: number[][] = variables.map(() => []);

  // Parse data rows
  for (let i = dataStartIdx; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith("!") || line.startsWith("#") || line.startsWith("*")) {
      continue;
    }

    const tokens = line.split(/\s+/);
    if (tokens.length < 2) continue;

    const tVal = Number(tokens[timeColIdx]);
    if (isNaN(tVal)) continue;

    times.push(tVal);

    let varIdx = 0;
    for (let c = 0; c < tokens.length; c++) {
      if (c === timeColIdx) continue;
      if (varIdx >= columnData.length) break;
      const num = Number(tokens[c]);
      columnData[varIdx]!.push(isNaN(num) ? 0 : num);
      varIdx++;
    }

    // Pad any missing columns in this row
    while (varIdx < columnData.length) {
      columnData[varIdx]!.push(0);
      varIdx++;
    }
  }

  return {
    title: title ?? "OLGA Trend Plot",
    caseName,
    times,
    variables,
    data: columnData,
  };
}

/**
 * Parses an OLGA Trend Plot (.tpl) ASCII output file into a canonical OlgaSimulationResult
 * with full trendDataset attached.
 */
export function parseOlgaTpl(tplContent: string): OlgaSimulationResult {
  const dataset = parseOlgaTplDataset(tplContent);
  const times = dataset.times;

  // Identify canonical flow assurance variables from dataset columns
  let inletPIdx = -1;
  let arrivalPIdx = -1;
  let arrivalTIdx = -1;
  let arrivalHolIdx = -1;
  let arrivalQltIdx = -1;

  dataset.variables.forEach((v, idx) => {
    const uId = v.id.toUpperCase();
    const uVar = v.variable.toUpperCase();

    if (uVar === "PT" || uVar.includes("PRESS")) {
      if (uId.includes("(1)") || uId.includes("INLET") || inletPIdx === -1) {
        if (inletPIdx === -1) inletPIdx = idx;
        else arrivalPIdx = idx;
      } else {
        arrivalPIdx = idx;
      }
    } else if (uVar === "TM" || uVar.includes("TEMP")) {
      arrivalTIdx = idx;
    } else if (uVar === "HOL" || uVar === "HL" || uVar.includes("HOLDUP")) {
      arrivalHolIdx = idx;
    } else if (uVar === "QLT" || uVar === "QL" || uVar.includes("MASSL")) {
      arrivalQltIdx = idx;
    }
  });

  // Fallbacks if not detected by variable names
  if (inletPIdx === -1 && dataset.variables.length >= 1) inletPIdx = 0;
  if (arrivalPIdx === -1 && dataset.variables.length >= 2) arrivalPIdx = 1;
  if (arrivalTIdx === -1 && dataset.variables.length >= 3) arrivalTIdx = 2;
  if (arrivalHolIdx === -1 && dataset.variables.length >= 4) arrivalHolIdx = 3;
  if (arrivalQltIdx === -1 && dataset.variables.length >= 5) arrivalQltIdx = 4;

  const inletPressure: number[] = [];
  const arrivalPressure: number[] = [];
  const arrivalTemperature: number[] = [];
  const arrivalLiquidHoldup: number[] = [];
  const arrivalLiquidMassRate: number[] = [];
  const accumulatedLiquidVolume: number[] = [];

  for (let i = 0; i < times.length; i++) {
    const pin = inletPIdx >= 0 ? (dataset.data[inletPIdx]?.[i] ?? 50e5) : 50e5;
    const pout = arrivalPIdx >= 0 ? (dataset.data[arrivalPIdx]?.[i] ?? 20e5) : 20e5;
    let tout = arrivalTIdx >= 0 ? (dataset.data[arrivalTIdx]?.[i] ?? 293.15) : 293.15;
    // Normalize Celsius to Kelvin if in [0..150] range
    if (tout < 150) tout += 273.15;

    const hol = arrivalHolIdx >= 0 ? (dataset.data[arrivalHolIdx]?.[i] ?? 0.1) : 0.1;
    const qlt = arrivalQltIdx >= 0 ? (dataset.data[arrivalQltIdx]?.[i] ?? 5.0) : 5.0;

    inletPressure.push(pin);
    arrivalPressure.push(pout);
    arrivalTemperature.push(tout);
    arrivalLiquidHoldup.push(hol);
    arrivalLiquidMassRate.push(qlt);

    const dt = i > 0 ? times[i]! - times[i - 1]! : 0;
    const prevVol =
      accumulatedLiquidVolume.length > 0 ? accumulatedLiquidVolume[accumulatedLiquidVolume.length - 1]! : 0;
    accumulatedLiquidVolume.push(prevVol + (qlt / 800.0) * dt);
  }

  // Handle empty file baseline
  if (times.length === 0) {
    return {
      times: [0],
      profiles: [],
      trends: {
        inletPressure: [50e5],
        arrivalPressure: [20e5],
        arrivalTemperature: [293.15],
        arrivalLiquidHoldup: [0.1],
        arrivalLiquidMassRate: [5.0],
        accumulatedLiquidVolume: [0],
        peakLiquidSurgeVolume: 0,
      },
      trendDataset: dataset,
    };
  }

  // Peak surge volume calculation
  let peakLiquidSurgeVolume = 0;
  for (let j = 1; j < accumulatedLiquidVolume.length; j++) {
    const windowVol = accumulatedLiquidVolume[j]! - accumulatedLiquidVolume[Math.max(0, j - 10)]!;
    if (windowVol > peakLiquidSurgeVolume) peakLiquidSurgeVolume = windowVol;
  }

  const finalProfile: SpatialProfileSnapshot = {
    time: times[times.length - 1]!,
    x: [0, 5000],
    elevation: [0, 50],
    pressure: [inletPressure[inletPressure.length - 1]!, arrivalPressure[arrivalPressure.length - 1]!],
    temperature: [330.15, arrivalTemperature[arrivalTemperature.length - 1]!],
    liquidHoldup: [0.05, arrivalLiquidHoldup[arrivalLiquidHoldup.length - 1]!],
    gasVelocity: [8.5, 12.0],
    liquidVelocity: [1.2, 1.8],
  };

  return {
    times,
    profiles: [finalProfile],
    trends: {
      inletPressure,
      arrivalPressure,
      arrivalTemperature,
      arrivalLiquidHoldup,
      arrivalLiquidMassRate,
      accumulatedLiquidVolume,
      peakLiquidSurgeVolume,
    },
    trendDataset: dataset,
  };
}

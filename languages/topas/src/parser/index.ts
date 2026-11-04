// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/topas — TOPAS (.topas) and GATE (.mac) Parser.
 *
 * Supports:
 * 1. TOPAS parameter syntax (`d:`, `i:`, `b:`, `s:`, `u:`, `dv:`, `iv:`, `sv:`, `includeFile`)
 * 2. GATE Geant4 macro syntax (`/gate/...`)
 * 3. JSON serialized representation
 */

import type {
  TopasDocument,
  TopasGeometryComponent,
  TopasIncludeDirective,
  TopasMaterialDefinition,
  TopasParameterAssignment,
  TopasParticleSource,
  TopasScorer,
  TopasSourceRange,
} from "../types.js";

function convertLengthToMm(val: number, unit?: string): number {
  if (!unit) return val;
  const u = unit.trim();
  switch (u) {
    case "m":
      return val * 1000.0;
    case "cm":
      return val * 10.0;
    case "mm":
      return val;
    case "um":
    case "µm":
      return val * 1e-3;
    case "nm":
      return val * 1e-6;
    default:
      return val;
  }
}

function convertEnergyToMeV(val: number, unit?: string): number {
  if (!unit) return val;
  const u = unit.trim();
  switch (u) {
    case "GeV":
      return val * 1000.0;
    case "MeV":
      return val;
    case "keV":
      return val * 1e-3;
    case "eV":
      return val * 1e-6;
    default:
      return val;
  }
}

function tokenizeValue(rhs: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < rhs.length) {
    while (i < rhs.length && /\s/.test(rhs[i]!)) i++;
    if (i >= rhs.length) break;
    if (rhs[i] === '"') {
      let end = i + 1;
      while (end < rhs.length && rhs[end] !== '"') {
        if (rhs[end] === "\\") end++;
        end++;
      }
      tokens.push(rhs.slice(i, end + 1));
      i = end + 1;
    } else {
      let end = i;
      while (end < rhs.length && !/\s/.test(rhs[end]!)) end++;
      tokens.push(rhs.slice(i, end));
      i = end;
    }
  }
  return tokens;
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

const KNOWN_UNITS = new Set([
  "m",
  "cm",
  "mm",
  "um",
  "nm",
  "deg",
  "rad",
  "mrad",
  "MeV",
  "GeV",
  "keV",
  "eV",
  "g/cm3",
  "mg/cm3",
  "kg/m3",
  "s",
  "ms",
  "us",
  "ns",
  "Gy",
  "T",
  "V",
  "kV",
  "MV",
  "Hz",
  "%",
]);

export function parseTopas(text: string, sourceUri?: string): TopasDocument {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const parsed = JSON.parse(trimmed) as TopasDocument;
    if (sourceUri !== undefined) {
      parsed.sourceUri = sourceUri;
    }
    return parsed;
  }

  const lines = text.split(/\r?\n/);
  const parameters: TopasParameterAssignment[] = [];
  const componentsMap = new Map<string, TopasGeometryComponent>();
  const sourcesMap = new Map<string, TopasParticleSource>();
  const scorersMap = new Map<string, TopasScorer>();
  const materialsMap = new Map<string, TopasMaterialDefinition>();
  const includes: TopasIncludeDirective[] = [];
  const includeGraph: Record<string, string[]> = {};

  let isGateDialect = false;
  let currentOffset = 0;

  const getOrCreateComponent = (name: string, range: TopasSourceRange): TopasGeometryComponent => {
    let comp = componentsMap.get(name);
    if (!comp) {
      comp = {
        name,
        type: "TsBox",
        range,
      };
      componentsMap.set(name, comp);
    }
    return comp;
  };

  const getOrCreateSource = (name: string, range: TopasSourceRange): TopasParticleSource => {
    let src = sourcesMap.get(name);
    if (!src) {
      src = {
        name,
        type: "Beam",
        beamParticle: "proton",
        range,
      };
      sourcesMap.set(name, src);
    }
    return src;
  };

  const getOrCreateScorer = (name: string, range: TopasSourceRange): TopasScorer => {
    let sc = scorersMap.get(name);
    if (!sc) {
      sc = {
        name,
        range,
      };
      scorersMap.set(name, sc);
    }
    return sc;
  };

  const getOrCreateMaterial = (name: string, range: TopasSourceRange): TopasMaterialDefinition => {
    let mat = materialsMap.get(name);
    if (!mat) {
      mat = {
        name,
        range,
      };
      materialsMap.set(name, mat);
    }
    return mat;
  };

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const lineStartOffset = currentOffset;
    const lineEndOffset = currentOffset + rawLine.length;
    currentOffset = lineEndOffset + 1;

    const lineRange: TopasSourceRange = {
      startOffset: lineStartOffset,
      endOffset: lineEndOffset,
      startLine: lineIdx + 1,
      startColumn: 1,
      endLine: lineIdx + 1,
      endColumn: rawLine.length + 1,
    };

    // Strip inline comments not inside quotes
    let cleanLine = "";
    let inQuotes = false;
    for (let c = 0; c < rawLine.length; c++) {
      const ch = rawLine[c]!;
      if (ch === '"') inQuotes = !inQuotes;
      if (ch === "#" && !inQuotes) break;
      cleanLine += ch;
    }
    cleanLine = cleanLine.trim();
    if (!cleanLine) continue;

    // 1. Check GATE macro syntax: `/gate/...`
    if (cleanLine.startsWith("/gate/") || cleanLine.startsWith("/control/")) {
      isGateDialect = true;
      const parts = tokenizeValue(cleanLine);
      const cmd = parts[0]!;
      const args = parts.slice(1);

      if (cmd === "/control/execute" || cmd === "/gate/control/execute") {
        const filePath = stripQuotes(args[0] ?? "");
        if (filePath) {
          includes.push({ filePath, range: lineRange });
        }
        continue;
      }

      // e.g. /gate/world/daughters/name WaterPhantom
      const daughterNameMatch = /^\/gate\/([^/]+)\/daughters\/name$/.exec(cmd);
      if (daughterNameMatch) {
        const parentRaw = daughterNameMatch[1]!;
        const parentName = parentRaw.toLowerCase() === "world" ? "World" : parentRaw;
        const childName = stripQuotes(args[0] ?? "");
        if (childName) {
          const comp = getOrCreateComponent(childName, lineRange);
          comp.parent = parentName;
        }
        continue;
      }

      const daughterInsertMatch = /^\/gate\/([^/]+)\/daughters\/insert$/.exec(cmd);
      if (daughterInsertMatch) {
        const geomType = stripQuotes(args[0] ?? "box").toLowerCase();
        // Attach to most recently created component if its parent matches
        const allComps = Array.from(componentsMap.values());
        const lastComp = allComps[allComps.length - 1];
        if (lastComp) {
          if (geomType === "box") lastComp.type = "TsBox";
          else if (geomType === "cylinder") lastComp.type = "TsCylinder";
          else if (geomType === "sphere") lastComp.type = "TsSphere";
          else lastComp.type = geomType;
        }
        continue;
      }

      const matMatch = /^\/gate\/([^/]+)\/setMaterial$/.exec(cmd);
      if (matMatch) {
        const compName = matMatch[1]!;
        const comp = getOrCreateComponent(compName, lineRange);
        comp.material = stripQuotes(args[0] ?? "");
        continue;
      }

      const transMatch = /^\/gate\/([^/]+)\/placement\/setTranslation$/.exec(cmd);
      if (transMatch && args.length >= 3) {
        const compName = transMatch[1]!;
        const comp = getOrCreateComponent(compName, lineRange);
        const unit = args[3];
        comp.transX = convertLengthToMm(Number(args[0]), unit);
        comp.transY = convertLengthToMm(Number(args[1]), unit);
        comp.transZ = convertLengthToMm(Number(args[2]), unit);
        continue;
      }

      const geomPropMatch = /^\/gate\/([^/]+)\/geometry\/set([A-Za-z]+)$/.exec(cmd);
      if (geomPropMatch && args.length >= 1) {
        const compName = geomPropMatch[1]!;
        const prop = geomPropMatch[2]!;
        const comp = getOrCreateComponent(compName, lineRange);
        const val = Number(args[0]);
        const unit = args[1];
        const mmVal = convertLengthToMm(val, unit);
        if (prop === "XLength") comp.hlx = mmVal / 2.0;
        else if (prop === "YLength") comp.hly = mmVal / 2.0;
        else if (prop === "ZLength") comp.hlz = mmVal / 2.0;
        else if (prop === "HLX") comp.hlx = mmVal;
        else if (prop === "HLY") comp.hly = mmVal;
        else if (prop === "HLZ") comp.hlz = mmVal;
        else if (prop === "Rmax" || prop === "RMax") comp.rMax = mmVal;
        else if (prop === "Rmin" || prop === "RMin") comp.rMin = mmVal;
        else if (prop === "Height") comp.hl = mmVal / 2.0;
        continue;
      }

      if (cmd === "/gate/source/addSource" && args.length >= 1) {
        const srcName = stripQuotes(args[0]!);
        const src = getOrCreateSource(srcName, lineRange);
        if (args[1]) src.type = stripQuotes(args[1]);
        continue;
      }

      const srcParticleMatch = /^\/gate\/source\/([^/]+)\/(?:gps\/)?particle$/.exec(cmd);
      if (srcParticleMatch && args.length >= 1) {
        const src = getOrCreateSource(srcParticleMatch[1]!, lineRange);
        src.beamParticle = stripQuotes(args[0]!);
        continue;
      }

      const srcEnergyMatch = /^\/gate\/source\/([^/]+)\/gps\/ene\/mono$/.exec(cmd);
      if (srcEnergyMatch && args.length >= 1) {
        const src = getOrCreateSource(srcEnergyMatch[1]!, lineRange);
        src.beamEnergy = convertEnergyToMeV(Number(args[0]), args[1]);
        continue;
      }

      const srcSigmaMatch = /^\/gate\/source\/([^/]+)\/gps\/ene\/sigma$/.exec(cmd);
      if (srcSigmaMatch && args.length >= 1) {
        const src = getOrCreateSource(srcSigmaMatch[1]!, lineRange);
        src.beamEnergySpread = Number(args[0]);
        continue;
      }

      if (cmd === "/gate/actor/addActor" && args.length >= 2) {
        const actorType = stripQuotes(args[0]!);
        const actorName = stripQuotes(args[1]!);
        const sc = getOrCreateScorer(actorName, lineRange);
        sc.quantity = actorType === "DoseActor" ? "DoseToWater" : actorType;
        continue;
      }

      const actorAttachMatch = /^\/gate\/actor\/([^/]+)\/attachTo$/.exec(cmd);
      if (actorAttachMatch && args.length >= 1) {
        const sc = getOrCreateScorer(actorAttachMatch[1]!, lineRange);
        sc.component = stripQuotes(args[0]!);
        continue;
      }

      continue;
    }

    // 2. Check TOPAS `includeFile = ...`
    const includeMatch = /^includeFile\s*=\s*(.+)$/i.exec(cleanLine);
    if (includeMatch) {
      const rhs = includeMatch[1]!.trim();
      if (rhs.includes("->")) {
        const chain = rhs
          .split("->")
          .map((s) => stripQuotes(s.trim()))
          .filter(Boolean);
        const first = chain[0] ?? rhs;
        includes.push({ filePath: first, chain, range: lineRange });
        for (let k = 0; k < chain.length - 1; k++) {
          const from = chain[k]!;
          const to = chain[k + 1]!;
          const list = includeGraph[from] ?? [];
          list.push(to);
          includeGraph[from] = list;
        }
      } else {
        const tokens = tokenizeValue(rhs).map(stripQuotes);
        for (const tok of tokens) {
          includes.push({ filePath: tok, range: lineRange });
        }
      }
      continue;
    }

    // 3. Parse TOPAS Parameter Assignment: `[change] <typePrefix>:<Path> = <Value>`
    const eqIdx = cleanLine.indexOf("=");
    if (eqIdx === -1) continue;

    let lhs = cleanLine.slice(0, eqIdx).trim();
    const rhs = cleanLine.slice(eqIdx + 1).trim();

    let isChangeOverride = false;
    if (/^change\s+/i.test(lhs)) {
      isChangeOverride = true;
      lhs = lhs.replace(/^change\s+/i, "").trim();
    } else if (/^c:/i.test(lhs) || /^change:/i.test(lhs)) {
      isChangeOverride = true;
      lhs = lhs.replace(/^(?:c|change):/i, "").trim();
    }

    const colonIdx = lhs.indexOf(":");
    if (colonIdx === -1) continue;

    const typePrefix = lhs.slice(0, colonIdx).trim();
    const fullPath = lhs.slice(colonIdx + 1).trim();
    const pathSegments = fullPath.split("/");
    const category = pathSegments[0] ?? "";
    const componentName = pathSegments.length >= 3 ? pathSegments.slice(1, -1).join("/") : undefined;
    const propertyName = pathSegments[pathSegments.length - 1] ?? fullPath;

    const tokens = tokenizeValue(rhs);
    const param: TopasParameterAssignment = {
      rawLine,
      typePrefix,
      isChangeOverride,
      category,
      componentName,
      propertyName,
      fullPath,
      rawValue: rhs,
      range: lineRange,
    };

    // Validate type prefix and extract values
    if (typePrefix === "d") {
      // Dimensioned double: `<number> <unit>` (or arithmetic expression with unit)
      const firstTok = tokens[0] ?? "";
      const numVal = Number(firstTok);
      const unitTok = tokens[1];
      if (
        firstTok === "" ||
        Number.isNaN(numVal) ||
        firstTok.startsWith('"') ||
        firstTok === "True" ||
        firstTok === "False"
      ) {
        param.typeMismatch = true;
        param.typeMismatchReason = `Expected numeric double with unit for prefix 'd:', got '${rhs}'`;
      } else if (!unitTok || unitTok.startsWith('"') || !Number.isNaN(Number(unitTok))) {
        param.typeMismatch = true;
        param.typeMismatchReason = `Prefix 'd:' requires a physical unit token after value '${firstTok}'`;
        param.numericValue = numVal;
      } else {
        param.numericValue = numVal;
        param.unit = unitTok;
      }
    } else if (typePrefix === "u") {
      // Unitless real number: `<number>` with NO unit token
      const firstTok = tokens[0] ?? "";
      const numVal = Number(firstTok);
      if (firstTok === "" || Number.isNaN(numVal) || firstTok.startsWith('"') || tokens.length > 1) {
        param.typeMismatch = true;
        param.typeMismatchReason = `Expected unitless real number for prefix 'u:', got '${rhs}'`;
      } else {
        param.numericValue = numVal;
      }
    } else if (typePrefix === "i") {
      // Integer: `<integer>` with no decimal point and no unit
      const firstTok = tokens[0] ?? "";
      const numVal = Number(firstTok);
      if (
        firstTok === "" ||
        Number.isNaN(numVal) ||
        !Number.isInteger(numVal) ||
        firstTok.includes(".") ||
        firstTok.startsWith('"') ||
        tokens.length > 1
      ) {
        param.typeMismatch = true;
        param.typeMismatchReason = `Expected integer literal for prefix 'i:', got '${rhs}'`;
        if (!Number.isNaN(numVal)) param.numericValue = numVal;
      } else {
        param.numericValue = numVal;
      }
    } else if (typePrefix === "b") {
      // Boolean: `"True"` or `"False"` or `True` / `False`
      const stripped = stripQuotes(tokens[0] ?? "");
      if (
        tokens.length !== 1 ||
        (stripped !== "True" && stripped !== "False" && stripped !== "true" && stripped !== "false")
      ) {
        param.typeMismatch = true;
        param.typeMismatchReason = `Expected boolean '"True"' or '"False"' for prefix 'b:', got '${rhs}'`;
      } else {
        param.booleanValue = stripped.toLowerCase() === "true";
        param.stringValue = stripped;
      }
    } else if (typePrefix === "s") {
      // String: must be quoted string `"..."` (or non-numeric identifier if not strictly quoted, wait: in TOPAS `s:` requires a string, so an unquoted number or boolean without quotes or numeric with unit is a type mismatch)
      const firstTok = tokens[0] ?? "";
      const isQuoted = firstTok.startsWith('"') && firstTok.endsWith('"');
      const isBareNumber = firstTok !== "" && !Number.isNaN(Number(firstTok));
      if (!isQuoted && isBareNumber) {
        param.typeMismatch = true;
        param.typeMismatchReason = `Expected string literal for prefix 's:', got numeric '${rhs}'`;
      } else {
        param.stringValue = stripQuotes(rhs);
      }
    } else if (
      typePrefix === "dv" ||
      typePrefix === "iv" ||
      typePrefix === "sv" ||
      typePrefix === "uv" ||
      typePrefix === "bv"
    ) {
      // Vector parameter: `<count> <elem_1> ... <elem_n> [unit]`
      const countTok = tokens[0] ?? "";
      const declaredCount = Number(countTok);
      if (countTok === "" || Number.isNaN(declaredCount) || !Number.isInteger(declaredCount) || declaredCount < 0) {
        param.typeMismatch = true;
        param.typeMismatchReason = `Vector parameter '${typePrefix}:' must start with an integer element count, got '${countTok}'`;
      } else {
        param.declaredVectorLength = declaredCount;
        let elemTokens = tokens.slice(1);
        if (typePrefix === "dv" && elemTokens.length > 0) {
          const lastTok = elemTokens[elemTokens.length - 1]!;
          if (KNOWN_UNITS.has(lastTok) || (/^[A-Za-z%/]+/.test(lastTok) && Number.isNaN(Number(lastTok)))) {
            param.unit = lastTok;
            elemTokens = elemTokens.slice(0, -1);
          } else {
            param.typeMismatch = true;
            param.typeMismatchReason = `Dimensioned vector 'dv:' requires a trailing unit token, got '${rhs}'`;
          }
        }
        param.actualVectorLength = elemTokens.length;
        if (elemTokens.length !== declaredCount) {
          param.vectorLengthMismatch = true;
        }
        const parsedVec: (number | string | boolean)[] = [];
        for (const et of elemTokens) {
          if (typePrefix === "dv" || typePrefix === "uv") {
            const n = Number(et);
            if (Number.isNaN(n) || et.startsWith('"')) {
              param.typeMismatch = true;
            }
            parsedVec.push(n);
          } else if (typePrefix === "iv") {
            const n = Number(et);
            if (Number.isNaN(n) || !Number.isInteger(n) || et.includes(".") || et.startsWith('"')) {
              param.typeMismatch = true;
            }
            parsedVec.push(n);
          } else if (typePrefix === "sv") {
            parsedVec.push(stripQuotes(et));
          } else {
            const s = stripQuotes(et);
            parsedVec.push(s.toLowerCase() === "true");
          }
        }
        param.vectorValues = parsedVec;
      }
    } else {
      param.typeMismatch = true;
      param.typeMismatchReason = `Unknown TOPAS type prefix '${typePrefix}:'`;
    }

    parameters.push(param);

    // Populate high-level domain models (Geometry, Sources, Scorers, Materials)
    if (category === "Ge" && componentName) {
      const comp = getOrCreateComponent(componentName, lineRange);
      const prop = propertyName;
      if (prop === "Type" && param.stringValue !== undefined) {
        comp.type = param.stringValue;
      } else if (prop === "Parent" && param.stringValue !== undefined) {
        comp.parent = param.stringValue;
      } else if (prop === "Material" && param.stringValue !== undefined) {
        comp.material = param.stringValue;
      } else if (prop === "HLX" && param.numericValue !== undefined) {
        comp.hlx = convertLengthToMm(param.numericValue, param.unit);
      } else if (prop === "HLY" && param.numericValue !== undefined) {
        comp.hly = convertLengthToMm(param.numericValue, param.unit);
      } else if (prop === "HLZ" && param.numericValue !== undefined) {
        comp.hlz = convertLengthToMm(param.numericValue, param.unit);
      } else if (prop === "RMin" && param.numericValue !== undefined) {
        comp.rMin = convertLengthToMm(param.numericValue, param.unit);
      } else if (prop === "RMax" && param.numericValue !== undefined) {
        comp.rMax = convertLengthToMm(param.numericValue, param.unit);
      } else if (prop === "HL" && param.numericValue !== undefined) {
        comp.hl = convertLengthToMm(param.numericValue, param.unit);
      } else if (prop === "TransX" && param.numericValue !== undefined) {
        comp.transX = convertLengthToMm(param.numericValue, param.unit);
      } else if (prop === "TransY" && param.numericValue !== undefined) {
        comp.transY = convertLengthToMm(param.numericValue, param.unit);
      } else if (prop === "TransZ" && param.numericValue !== undefined) {
        comp.transZ = convertLengthToMm(param.numericValue, param.unit);
      } else if (prop === "RotX" && param.numericValue !== undefined) {
        comp.rotX = param.numericValue;
      } else if (prop === "RotY" && param.numericValue !== undefined) {
        comp.rotY = param.numericValue;
      } else if (prop === "RotZ" && param.numericValue !== undefined) {
        comp.rotZ = param.numericValue;
      } else if (prop === "XBins" && param.numericValue !== undefined) {
        comp.xBins = param.numericValue;
      } else if (prop === "YBins" && param.numericValue !== undefined) {
        comp.yBins = param.numericValue;
      } else if (prop === "ZBins" && param.numericValue !== undefined) {
        comp.zBins = param.numericValue;
      }
    } else if (category === "So" && componentName) {
      const src = getOrCreateSource(componentName, lineRange);
      const prop = propertyName;
      if (prop === "Type" && param.stringValue !== undefined) {
        src.type = param.stringValue;
      } else if (prop === "Component" && param.stringValue !== undefined) {
        src.component = param.stringValue;
      } else if (prop === "BeamParticle" && param.stringValue !== undefined) {
        src.beamParticle = param.stringValue;
      } else if (prop === "BeamEnergy" && param.numericValue !== undefined) {
        src.beamEnergy = convertEnergyToMeV(param.numericValue, param.unit);
      } else if (prop === "BeamEnergySpread" && param.numericValue !== undefined) {
        src.beamEnergySpread = param.numericValue;
      } else if (prop === "BeamPositionSpreadX" && param.numericValue !== undefined) {
        src.beamPositionSpreadX = convertLengthToMm(param.numericValue, param.unit);
      } else if (prop === "BeamPositionSpreadY" && param.numericValue !== undefined) {
        src.beamPositionSpreadY = convertLengthToMm(param.numericValue, param.unit);
      } else if (prop === "NumberOfHistoriesInRun" && param.numericValue !== undefined) {
        src.numberOfHistoriesInRun = param.numericValue;
      }
    } else if (category === "Sc" && componentName) {
      const sc = getOrCreateScorer(componentName, lineRange);
      const prop = propertyName;
      if (prop === "Quantity" && param.stringValue !== undefined) {
        sc.quantity = param.stringValue;
      } else if (prop === "Component" && param.stringValue !== undefined) {
        sc.component = param.stringValue;
      } else if (prop === "OutputFile" && param.stringValue !== undefined) {
        sc.outputFile = param.stringValue;
      } else if (prop === "OutputType" && param.stringValue !== undefined) {
        sc.outputType = param.stringValue;
      } else if (prop === "OnlyIncludeIfIncidentParticleNamed" && param.stringValue !== undefined) {
        sc.onlyIncludeIfIncidentParticleNamed = param.stringValue;
      }
    } else if (category === "Ma" && componentName) {
      const mat = getOrCreateMaterial(componentName, lineRange);
      const prop = propertyName;
      if (prop === "Density" && param.numericValue !== undefined) {
        mat.density = param.numericValue;
      } else if (prop === "Components" && param.vectorValues !== undefined) {
        mat.components = param.vectorValues.map(String);
      } else if (prop === "Fractions" && param.vectorValues !== undefined) {
        mat.fractions = param.vectorValues.map(Number);
      } else if (prop === "MeanExcitationEnergy" && param.numericValue !== undefined) {
        mat.meanExcitationEnergy = param.numericValue;
      }
    }
  }

  const docRange: TopasSourceRange = {
    startOffset: 0,
    endOffset: text.length,
    startLine: 1,
    startColumn: 1,
    endLine: lines.length,
    endColumn: (lines[lines.length - 1]?.length ?? 0) + 1,
  };

  const doc: TopasDocument = {
    dialect: isGateDialect ? "gate" : "topas",
    parameters,
    components: Array.from(componentsMap.values()),
    sources: Array.from(sourcesMap.values()),
    scorers: Array.from(scorersMap.values()),
    materials: Array.from(materialsMap.values()),
    includes,
    range: docRange,
  };

  if (Object.keys(includeGraph).length > 0) {
    doc.includeGraph = includeGraph;
  }
  if (sourceUri !== undefined) {
    doc.sourceUri = sourceUri;
  }

  return doc;
}

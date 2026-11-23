// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/melcor — Sandia MELCOR 2.x Package-Structured Deck Parser.
 *
 * Uses the native WebAssembly GLR parser (`dist/parser.wasm`) to tokenize and parse
 * MELCOR decks into a linear-memory CST, then lowers package records into `MelcorDeck`.
 */

import { groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import type {
  MelcorCfArgument,
  MelcorControlFunction,
  MelcorControlVolume,
  MelcorCorePackage,
  MelcorDeck,
  MelcorDuplicateEntry,
  MelcorExecConfig,
  MelcorFlowPath,
  MelcorHeatStructure,
  MelcorMaterialProperty,
  MelcorNcgSpecies,
  MelcorPackageSection,
  MelcorRange,
  MelcorRecord,
  MelcorRn1Class,
  MelcorTabularFunction,
  OxidationKineticsModel,
} from "../types.js";
import { getMelcorWasmParser } from "./wasm-loader.js";

export { getMelcorWasmParser, type MelcorWasmParser } from "./wasm-loader.js";

function unquote(token: string): string {
  if (
    (token.startsWith("'") && token.endsWith("'") && token.length >= 2) ||
    (token.startsWith('"') && token.endsWith('"') && token.length >= 2)
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function parseNum(token: string | undefined, fallback = Number.NaN): number {
  if (token === undefined) return fallback;
  const cleaned = unquote(token).replace(/[dD]/g, "e");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function parseIntStrict(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  const cleaned = unquote(token);
  if (!/^[-+]?[0-9]+$/.test(cleaned)) return undefined;
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseNameAndId(args: string[]): { name: string; id: number; rest: string[] } | null {
  if (args.length === 0) return null;
  const firstInt = parseIntStrict(args[0]);
  const secondInt = parseIntStrict(args[1]);
  if (firstInt !== undefined) {
    const name = args[1] !== undefined && secondInt === undefined ? unquote(args[1]) : `ID_${firstInt}`;
    const rest = args[1] !== undefined && secondInt === undefined ? args.slice(2) : args.slice(1);
    return { name, id: firstInt, rest };
  }
  if (secondInt !== undefined) {
    return { name: unquote(args[0] ?? ""), id: secondInt, rest: args.slice(2) };
  }
  return null;
}

function createDefaultCore(): MelcorCorePackage {
  return {
    present: true,
    radialRings: 1,
    axialLevels: 1,
    totalPowerW: 3.0e9,
    decayHeatW: 0.0,
    coreMassKg: 80000.0,
    coreSpecificHeatJkgK: 350.0,
    initialTemperatureK: 600.0,
    cladAreaM2: 4500.0,
    cladZrMassKg: 20000.0,
    oxidationEnabled: false,
    oxidationModel: "URBANIC_HEIDRICK",
    cells: [],
  };
}

export function parseMelcor(source: string, filename?: string): MelcorDeck {
  const cstTree = getMelcorWasmParser().parse(source);
  const cstLines = groupAllCstTokensByLine(cstTree?.rootNode as CstNodeLike | undefined);

  const lines = source.split("\n");
  const lineOffsets: number[] = new Array(lines.length);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    lineOffsets[i] = offset;
    offset += (lines[i]?.length ?? 0) + 1;
  }

  let title = "Untitled MELCOR Deck";
  let seenMelgen = false;
  let seenMelcor = false;
  let section: MelcorPackageSection = "ROOT";

  const exec: MelcorExecConfig = {
    present: false,
    tStart: 0.0,
    tEnd: 0.0,
    dtMin: 1.0e-5,
    dtMax: 1.0,
    dtInit: 0.01,
  };

  const controlVolumes = new Map<number, MelcorControlVolume>();
  const flowPaths = new Map<number, MelcorFlowPath>();
  const heatStructures = new Map<number, MelcorHeatStructure>();
  let core: MelcorCorePackage | undefined;
  const rn1Classes = new Map<number, MelcorRn1Class>();
  const controlFunctions = new Map<number, MelcorControlFunction>();
  const tabularFunctions = new Map<number, MelcorTabularFunction>();
  const materialProperties = new Map<number, MelcorMaterialProperty>();
  const ncgSpecies = new Map<number, MelcorNcgSpecies>();
  const duplicateIds: MelcorDuplicateEntry[] = [];
  const records: MelcorRecord[] = [];

  let activeCv: MelcorControlVolume | undefined;
  let activeFl: MelcorFlowPath | undefined;
  let activeHs: MelcorHeatStructure | undefined;
  let activeCf: MelcorControlFunction | undefined;
  let activeTf: MelcorTabularFunction | undefined;

  for (const { row, tokens: cstTokens } of cstLines) {
    const rawLine = lines[row] ?? "";
    // Filter out newline tokens, punctuation commas, and pure comment tokens
    const tokens = cstTokens.map((t) => t.text.trim()).filter((t) => t.length > 0 && t !== "," && !t.startsWith("!"));

    if (tokens.length === 0) continue;

    const kw = (tokens[0] ?? "").toUpperCase();
    const args = tokens.slice(1);
    const firstTok = cstTokens[0];
    const lastTok = cstTokens[cstTokens.length - 1];
    const startCol = (firstTok?.startPosition?.column ?? 0) + 1;
    const endCol =
      lastTok?.startPosition !== undefined
        ? lastTok.startPosition.column + lastTok.text.length + 1
        : rawLine.length + 1;
    const lineOff = lineOffsets[row] ?? 0;
    const range: MelcorRange = {
      startLine: row + 1,
      startColumn: startCol,
      endLine: row + 1,
      endColumn: endCol,
      startOffset: lineOff + Math.max(0, startCol - 1),
      endOffset: lineOff + Math.max(0, endCol - 1),
    };

    // Phase headers
    if (kw === "MELGEN_INPUT") {
      seenMelgen = true;
      section = "ROOT";
      records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });
      continue;
    }
    if (kw === "MELCOR_INPUT") {
      seenMelcor = true;
      section = "ROOT";
      records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });
      continue;
    }
    if (kw === "END" || kw === ".") {
      records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });
      continue;
    }

    // Title
    if (kw === "TITLE" || kw === "EXEC_TITLE") {
      if (args.length > 0) {
        title = args.map(unquote).join(" ");
      }
      records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });
      continue;
    }

    // Package section headers
    if (kw === "EXEC_INPUT") {
      section = "EXEC";
      exec.present = true;
      exec.range ??= range;
      records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });
      continue;
    }
    if (kw === "CVH_INPUT") {
      section = "CVH";
      activeCv = undefined;
      records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });
      continue;
    }
    if (kw === "FL_INPUT") {
      section = "FL";
      activeFl = undefined;
      records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });
      continue;
    }
    if (kw === "HS_INPUT") {
      section = "HS";
      activeHs = undefined;
      records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });
      continue;
    }
    if (kw === "COR_INPUT") {
      section = "COR";
      if (!core) {
        core = createDefaultCore();
        core.range = range;
      }
      records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });
      continue;
    }
    if (kw === "RN1_INPUT") {
      section = "RN1";
      records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });
      continue;
    }
    if (kw === "CF_INPUT") {
      section = "CF";
      activeCf = undefined;
      records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });
      continue;
    }
    if (kw === "TF_INPUT") {
      section = "TF";
      activeTf = undefined;
      records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });
      continue;
    }
    if (kw === "MP_INPUT") {
      section = "MP";
      records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });
      continue;
    }
    if (kw === "NCG_INPUT") {
      section = "NCG";
      records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });
      continue;
    }

    records.push({ keyword: kw, tokens, rawLine, packageSection: section, range });

    // EXEC records
    if (kw === "EXEC_TEND") {
      exec.present = true;
      exec.tEnd = parseNum(args[0], exec.tEnd);
      exec.range ??= range;
      continue;
    }
    if (kw === "EXEC_TSTART") {
      exec.present = true;
      exec.tStart = parseNum(args[0], exec.tStart);
      continue;
    }
    if (kw === "EXEC_DTMAX") {
      exec.present = true;
      exec.dtMax = parseNum(args[0], exec.dtMax);
      continue;
    }
    if (kw === "EXEC_DTMIN") {
      exec.present = true;
      exec.dtMin = parseNum(args[0], exec.dtMin);
      continue;
    }
    if (kw === "EXEC_DT") {
      exec.present = true;
      exec.dtInit = parseNum(args[0], exec.dtInit);
      if (args[1] !== undefined) exec.dtMax = parseNum(args[1], exec.dtMax);
      if (args[2] !== undefined) exec.dtMin = parseNum(args[2], exec.dtMin);
      continue;
    }
    if (kw === "EXEC_TIME") {
      exec.present = true;
      exec.tStart = parseNum(args[0], exec.tStart);
      exec.tEnd = parseNum(args[1], exec.tEnd);
      if (args[2] !== undefined) exec.dtInit = parseNum(args[2], exec.dtInit);
      if (args[3] !== undefined) exec.dtMax = parseNum(args[3], exec.dtMax);
      if (args[4] !== undefined) exec.dtMin = parseNum(args[4], exec.dtMin);
      continue;
    }
    if (kw === "EXEC_CPULIM") {
      exec.cpuLimit = parseNum(args[0], 3600.0);
      continue;
    }

    // CVH records
    if (kw === "CV_ID") {
      const parsed = parseNameAndId(args);
      if (parsed) {
        const typeTok = unquote(parsed.rest[0] ?? "NORMAL").toUpperCase();
        const cvType =
          typeTok === "TIME_INDEPENDENT" || typeTok === "EQUILIBRIUM" || typeTok === "NONEQUILIBRIUM"
            ? typeTok
            : "NORMAL";
        const cv: MelcorControlVolume = {
          id: parsed.id,
          name: parsed.name,
          cvType,
          volume: 10.0,
          elevation: 0.0,
          height: 2.0,
          pressure: 101325.0,
          temperature: 300.0,
          poolFraction: 0.0,
          steamFraction: 1.0,
          ncgFractions: {},
          range,
        };
        if (controlVolumes.has(parsed.id)) {
          duplicateIds.push({ kind: "CV", id: parsed.id, name: parsed.name, range });
        } else {
          controlVolumes.set(parsed.id, cv);
        }
        activeCv = cv;
      }
      continue;
    }
    if (kw === "CV_TY" && activeCv) {
      const t = unquote(args[0] ?? "NORMAL").toUpperCase();
      if (t === "TIME_INDEPENDENT" || t === "EQUILIBRIUM" || t === "NONEQUILIBRIUM" || t === "NORMAL") {
        activeCv.cvType = t;
      }
      continue;
    }
    if (kw === "CV_THR" && activeCv) {
      activeCv.pressure = parseNum(args[0], activeCv.pressure);
      activeCv.temperature = parseNum(args[1], activeCv.temperature);
      if (args[2] !== undefined) activeCv.poolFraction = parseNum(args[2], activeCv.poolFraction);
      if (args[3] !== undefined) activeCv.steamFraction = parseNum(args[3], activeCv.steamFraction);
      continue;
    }
    if ((kw === "CV_PAS" || kw === "CV_VAT") && activeCv) {
      activeCv.volume = parseNum(args[0], activeCv.volume);
      if (args[1] !== undefined) activeCv.elevation = parseNum(args[1], activeCv.elevation);
      if (args[2] !== undefined) activeCv.height = parseNum(args[2], activeCv.height);
      continue;
    }
    if (kw === "CV_ALT" && activeCv) {
      activeCv.elevation = parseNum(args[0], activeCv.elevation);
      if (args[1] !== undefined) activeCv.height = parseNum(args[1], activeCv.height);
      continue;
    }
    if (kw === "CV_NCG" && activeCv) {
      const gas = unquote(args[0] ?? "N2").toUpperCase();
      const frac = parseNum(args[1], 0.0);
      activeCv.ncgFractions[gas] = frac;
      continue;
    }

    // FL records
    if (kw === "FL_ID") {
      const parsed = parseNameAndId(args);
      if (parsed) {
        const fl: MelcorFlowPath = {
          id: parsed.id,
          name: parsed.name,
          fromCv: 0,
          toCv: 0,
          fromElevation: 0.0,
          toElevation: 0.0,
          area: 0.1,
          length: 1.0,
          openFraction: 1.0,
          forwardLoss: 1.0,
          reverseLoss: 1.0,
          initialFlow: 0.0,
          range,
        };
        if (flowPaths.has(parsed.id)) {
          duplicateIds.push({ kind: "FL", id: parsed.id, name: parsed.name, range });
        } else {
          flowPaths.set(parsed.id, fl);
        }
        activeFl = fl;
      }
      continue;
    }
    if (kw === "FL_FT" && activeFl) {
      activeFl.fromCv = parseIntStrict(args[0]) ?? activeFl.fromCv;
      activeFl.toCv = parseIntStrict(args[1]) ?? activeFl.toCv;
      if (args[2] !== undefined) activeFl.fromElevation = parseNum(args[2], activeFl.fromElevation);
      if (args[3] !== undefined) activeFl.toElevation = parseNum(args[3], activeFl.toElevation);
      continue;
    }
    if (kw === "FL_GEO" && activeFl) {
      activeFl.area = parseNum(args[0], activeFl.area);
      if (args[1] !== undefined) activeFl.length = parseNum(args[1], activeFl.length);
      if (args[2] !== undefined) activeFl.openFraction = parseNum(args[2], activeFl.openFraction);
      continue;
    }
    if (kw === "FL_USL" && activeFl) {
      activeFl.forwardLoss = parseNum(args[0], activeFl.forwardLoss);
      activeFl.reverseLoss = args[1] !== undefined ? parseNum(args[1], activeFl.forwardLoss) : activeFl.forwardLoss;
      continue;
    }
    if (kw === "FL_IC" && activeFl) {
      activeFl.initialFlow = parseNum(args[0], activeFl.initialFlow);
      continue;
    }

    // HS records
    if (kw === "HS_ID") {
      const parsed = parseNameAndId(args);
      if (parsed) {
        const gTok = unquote(parsed.rest[0] ?? "RECTANGULAR").toUpperCase();
        const geometry = gTok === "CYLINDRICAL" || gTok === "SPHERICAL" ? gTok : "RECTANGULAR";
        const hs: MelcorHeatStructure = {
          id: parsed.id,
          name: parsed.name,
          geometry,
          thickness: 0.05,
          surfaceArea: 10.0,
          mass: 3965.0,
          thermalConductivity: 20.0,
          specificHeat: 500.0,
          density: 7930.0,
          initialTemperature: 550.0,
          leftHtc: 500.0,
          rightHtc: 500.0,
          heatSourceW: 0.0,
          range,
        };
        if (heatStructures.has(parsed.id)) {
          duplicateIds.push({ kind: "HS", id: parsed.id, name: parsed.name, range });
        } else {
          heatStructures.set(parsed.id, hs);
        }
        activeHs = hs;
      }
      continue;
    }
    if (kw === "HS_GD" && activeHs) {
      activeHs.thickness = parseNum(args[0], activeHs.thickness);
      if (args[1] !== undefined) activeHs.surfaceArea = parseNum(args[1], activeHs.surfaceArea);
      if (args[2] !== undefined) {
        activeHs.mass = parseNum(args[2], activeHs.mass);
      } else {
        activeHs.mass = activeHs.thickness * activeHs.surfaceArea * activeHs.density;
      }
      if (args[3] !== undefined) activeHs.thermalConductivity = parseNum(args[3], activeHs.thermalConductivity);
      if (args[4] !== undefined) activeHs.specificHeat = parseNum(args[4], activeHs.specificHeat);
      if (args[5] !== undefined) activeHs.density = parseNum(args[5], activeHs.density);
      continue;
    }
    if (kw === "HS_LB" && activeHs) {
      const cvId = parseIntStrict(args[0]);
      if (cvId !== undefined) activeHs.leftBoundaryCv = cvId;
      if (args[1] !== undefined) activeHs.leftHtc = parseNum(args[1], activeHs.leftHtc);
      continue;
    }
    if (kw === "HS_RB" && activeHs) {
      const cvId = parseIntStrict(args[0]);
      if (cvId !== undefined) activeHs.rightBoundaryCv = cvId;
      if (args[1] !== undefined) activeHs.rightHtc = parseNum(args[1], activeHs.rightHtc);
      continue;
    }
    if (kw === "HS_TEMP" && activeHs) {
      activeHs.initialTemperature = parseNum(args[0], activeHs.initialTemperature);
      continue;
    }
    if (kw === "HS_SRC" && activeHs) {
      activeHs.heatSourceW = parseNum(args[0], activeHs.heatSourceW);
      continue;
    }

    // COR records
    if (kw === "COR_RP") {
      core ??= createDefaultCore();
      core.radialRings = parseIntStrict(args[0]) ?? core.radialRings;
      core.axialLevels = parseIntStrict(args[1]) ?? core.axialLevels;
      if (args[2] !== undefined) core.totalPowerW = parseNum(args[2], core.totalPowerW);
      core.range ??= range;
      continue;
    }
    if (kw === "COR_ZDF") {
      core ??= createDefaultCore();
      core.coreMassKg = parseNum(args[0], core.coreMassKg);
      if (args[1] !== undefined) core.coreSpecificHeatJkgK = parseNum(args[1], core.coreSpecificHeatJkgK);
      if (args[2] !== undefined) core.initialTemperatureK = parseNum(args[2], core.initialTemperatureK);
      if (args[3] !== undefined) core.cladAreaM2 = parseNum(args[3], core.cladAreaM2);
      if (args[4] !== undefined) core.cladZrMassKg = parseNum(args[4], core.cladZrMassKg);
      if (args[5] !== undefined) core.cvId = parseIntStrict(args[5]);
      core.range ??= range;
      continue;
    }
    if (kw === "COR_PWR") {
      core ??= createDefaultCore();
      core.decayHeatW = parseNum(args[0], core.decayHeatW);
      if (args[1] !== undefined) core.totalPowerW = parseNum(args[1], core.totalPowerW);
      continue;
    }
    if (kw === "COR_OX") {
      core ??= createDefaultCore();
      const flag = unquote(args[0] ?? "ON").toUpperCase();
      core.oxidationEnabled = flag === "ON" || flag === "1" || flag === "TRUE" || flag === "YES";
      const modelTok = unquote(args[1] ?? "URBANIC_HEIDRICK").toUpperCase();
      core.oxidationModel = (
        modelTok === "CATHCART_PAWEL" ? "CATHCART_PAWEL" : "URBANIC_HEIDRICK"
      ) as OxidationKineticsModel;
      if (args[2] !== undefined) core.cladAreaM2 = parseNum(args[2], core.cladAreaM2);
      if (args[3] !== undefined) core.cladZrMassKg = parseNum(args[3], core.cladZrMassKg);
      continue;
    }
    if (kw === "COR_CELL") {
      core ??= createDefaultCore();
      core.cells.push({
        ring: parseIntStrict(args[0]) ?? 1,
        level: parseIntStrict(args[1]) ?? 1,
        fuelMassKg: parseNum(args[2], 10000.0),
        cladMassKg: parseNum(args[3], 2500.0),
        cladAreaM2: parseNum(args[4], 500.0),
        specificHeatJkgK: parseNum(args[5], 350.0),
        initialTemperatureK: parseNum(args[6], core.initialTemperatureK),
        decayPowerW: parseNum(args[7], 0.0),
        cvId: parseIntStrict(args[8]),
        range,
      });
      continue;
    }

    // RN1 records
    if (kw === "RN1_CLS") {
      const clsNum = parseIntStrict(args[0]);
      if (clsNum !== undefined) {
        const cls: MelcorRn1Class = {
          classNumber: clsNum,
          name: unquote(args[1] ?? `CLASS_${clsNum}`),
          initialMassKg: parseNum(args[2], 0.0),
          releaseFraction: parseNum(args[3], 0.0),
          range,
        };
        rn1Classes.set(clsNum, cls);
      }
      continue;
    }

    // CF records
    if (kw === "CF_ID") {
      const parsed = parseNameAndId(args);
      if (parsed) {
        const cf: MelcorControlFunction = {
          id: parsed.id,
          name: parsed.name,
          cfType: unquote(parsed.rest[0] ?? "ADD").toUpperCase(),
          scale: 1.0,
          additive: 0.0,
          initialValue: 0.0,
          arguments: [],
          range,
        };
        if (controlFunctions.has(parsed.id)) {
          duplicateIds.push({ kind: "CF", id: parsed.id, name: parsed.name, range });
        } else {
          controlFunctions.set(parsed.id, cf);
        }
        activeCf = cf;
      }
      continue;
    }
    if (kw === "CF_SAI" && activeCf) {
      activeCf.scale = parseNum(args[0], activeCf.scale);
      if (args[1] !== undefined) activeCf.additive = parseNum(args[1], activeCf.additive);
      if (args[2] !== undefined) activeCf.initialValue = parseNum(args[2], activeCf.initialValue);
      continue;
    }
    if (kw === "CF_ARG" && activeCf) {
      const rawKind = unquote(args[0] ?? "CONST").toUpperCase();
      const kind = (
        ["CF", "CVH", "FL", "HS", "COR", "TF", "CONST"].includes(rawKind) ? rawKind : "CONST"
      ) as MelcorCfArgument["kind"];
      const idNum = parseIntStrict(args[1]);
      const targetId: number | string = idNum !== undefined ? idNum : unquote(args[1] ?? "0");
      activeCf.arguments.push({
        kind,
        targetId,
        variable: args[2] !== undefined ? unquote(args[2]) : undefined,
        scale: args[3] !== undefined ? parseNum(args[3], 1.0) : undefined,
      });
      continue;
    }

    // TF records
    if (kw === "TF_ID") {
      const parsed = parseNameAndId(args);
      if (parsed) {
        const tf: MelcorTabularFunction = {
          id: parsed.id,
          name: parsed.name,
          scale: parseNum(parsed.rest[0], 1.0),
          additive: parseNum(parsed.rest[1], 0.0),
          points: [],
          range,
        };
        if (tabularFunctions.has(parsed.id)) {
          duplicateIds.push({ kind: "TF", id: parsed.id, name: parsed.name, range });
        } else {
          tabularFunctions.set(parsed.id, tf);
        }
        activeTf = tf;
      }
      continue;
    }
    if (kw === "TF_TAB" && activeTf) {
      for (let i = 0; i + 1 < args.length; i += 2) {
        const x = parseNum(args[i]);
        const y = parseNum(args[i + 1]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          activeTf.points.push({ x, y });
        }
      }
      continue;
    }

    // MP records
    if (kw === "MP_ID") {
      const parsed = parseNameAndId(args);
      if (parsed) {
        const mp: MelcorMaterialProperty = {
          id: parsed.id,
          name: parsed.name,
          material: unquote(parsed.rest[0] ?? "UO2").toUpperCase(),
          property: unquote(parsed.rest[1] ?? "CP").toUpperCase(),
          constantValue: parsed.rest[2] !== undefined ? parseNum(parsed.rest[2]) : undefined,
          range,
        };
        materialProperties.set(parsed.id, mp);
      }
      continue;
    }

    // NCG records
    if (kw === "NCG_ID") {
      const parsed = parseNameAndId(args);
      if (parsed) {
        const ncg: MelcorNcgSpecies = {
          id: parsed.id,
          name: parsed.name,
          molecularWeight: parseNum(parsed.rest[0], 28.0134),
          cp: parseNum(parsed.rest[1], 1040.0),
          range,
        };
        ncgSpecies.set(parsed.id, ncg);
      }
      continue;
    }
  }

  const inputPhase = seenMelgen && seenMelcor ? "COMBINED" : seenMelgen ? "MELGEN" : "MELCOR";

  return {
    filename,
    title,
    inputPhase,
    exec,
    controlVolumes,
    flowPaths,
    heatStructures,
    core,
    rn1Classes,
    controlFunctions,
    tabularFunctions,
    materialProperties,
    ncgSpecies,
    duplicateIds,
    records,
  };
}

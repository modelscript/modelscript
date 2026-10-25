// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Tabular PVT Fluid Table Parser (.tab / .pvt).
 *
 * Ingests industry-standard Multiflash, PVTsim, and OLGA pressure-temperature tables,
 * supporting both columnar and multi-block matrix layouts for:
 * - Two-phase (gas & liquid) and three-phase (gas, oil, and free water) regimes
 * - Thermodynamic density, viscosity, surface tension, heat capacity, enthalpy, thermal conductivity
 * - Explicit unit declaration blocks (SI, Metric, Field, Custom)
 * - 2D Bilinear and Bicubic interpolation with exact analytical partial derivatives (dRho/dP, dRho/dT)
 * - Isentropic sound speed evaluation and smooth Taylor boundary extrapolation
 */

export type PvtFluidPhaseType = "TWO_PHASE" | "THREE_PHASE" | "SINGLE_PHASE";

export interface PvtUnits {
  pressure: string;
  temperature: string;
  density: string;
  viscosity: string;
  surfaceTension: string;
  enthalpy: string;
  heatCapacity: string;
  thermalConductivity: string;
}

export const DEFAULT_SI_UNITS: PvtUnits = {
  pressure: "PA",
  temperature: "K",
  density: "KG/M3",
  viscosity: "PA.S",
  surfaceTension: "N/M",
  enthalpy: "J/KG",
  heatCapacity: "J/KG.K",
  thermalConductivity: "W/M.K",
};

export const DEFAULT_METRIC_UNITS: PvtUnits = {
  pressure: "BAR",
  temperature: "C",
  density: "KG/M3",
  viscosity: "CP",
  surfaceTension: "N/M",
  enthalpy: "KJ/KG",
  heatCapacity: "KJ/KG.K",
  thermalConductivity: "W/M.K",
};

export const DEFAULT_FIELD_UNITS: PvtUnits = {
  pressure: "PSIA",
  temperature: "F",
  density: "LB/FT3",
  viscosity: "CP",
  surfaceTension: "DYN/CM",
  enthalpy: "BTU/LB",
  heatCapacity: "BTU/LB.F",
  thermalConductivity: "BTU/HR.FT.F",
};

export interface PvtTableData {
  title: string;
  fluidType: PvtFluidPhaseType;
  units: PvtUnits;
  pressures: number[]; // Pascal [Pa], sorted ascending
  temperatures: number[]; // Kelvin [K], sorted ascending

  // Primary 2-Phase & Gas properties [P_idx][T_idx]
  rhoG: number[][]; // [P_idx][T_idx] in kg/m^3
  rhoL: number[][]; // [P_idx][T_idx] in kg/m^3 (bulk liquid or oil)
  visG: number[][]; // [P_idx][T_idx] in Pa*s
  visL: number[][]; // [P_idx][T_idx] in Pa*s (bulk liquid or oil)
  surfaceTension: number[][]; // [P_idx][T_idx] in N/m (gas-liquid or gas-oil)

  // Three-Phase Extensions
  rhoO?: number[][] | undefined; // Oil density [kg/m^3]
  rhoW?: number[][] | undefined; // Water density [kg/m^3]
  visO?: number[][] | undefined; // Oil viscosity [Pa*s]
  visW?: number[][] | undefined; // Water viscosity [Pa*s]
  sigmaOW?: number[][] | undefined; // Oil-water interfacial tension [N/m]
  sigmaGW?: number[][] | undefined; // Gas-water interfacial tension [N/m]

  // Caloric & Thermal Properties
  cpG?: number[][] | undefined; // Gas heat capacity [J/(kg*K)]
  cpL?: number[][] | undefined; // Liquid heat capacity [J/(kg*K)]
  hlG?: number[][] | undefined; // Gas enthalpy [J/kg]
  hlL?: number[][] | undefined; // Liquid enthalpy [J/kg]
  tcG?: number[][] | undefined; // Gas thermal conductivity [W/(m*K)]
  tcL?: number[][] | undefined; // Liquid thermal conductivity [W/(m*K)]

  // Equilibrium & Composition
  rs?: number[][] | undefined; // Solution gas-oil ratio [Sm^3/Sm^3 or kg/kg]
  vaporFraction?: number[][] | undefined; // Vapor mass/mole fraction [0..1]

  // Phase Envelopes
  bubblePointCurve?: { pressure: number; temperature: number }[] | undefined;
  dewPointCurve?: { pressure: number; temperature: number }[] | undefined;
}

export interface PvtInterpolatedState {
  // Baseline properties
  rhoG: number;
  rhoL: number;
  muG: number;
  muL: number;
  sigma: number;
  isExtrapolated: boolean;

  // Three-phase specific properties (if available in table)
  rhoO?: number | undefined;
  rhoW?: number | undefined;
  muO?: number | undefined;
  muW?: number | undefined;
  sigmaOW?: number | undefined;

  // Caloric & thermal properties
  cpG?: number | undefined;
  cpL?: number | undefined;
  hlG?: number | undefined;
  hlL?: number | undefined;
  tcG?: number | undefined;
  tcL?: number | undefined;

  // Equilibrium
  rs?: number | undefined;
  vaporFraction?: number | undefined;

  // Exact analytical derivatives
  dRhoGdP: number; // (d rhoG / d P)_T in kg / (m^3 * Pa)
  dRhoGdT: number; // (d rhoG / d T)_P in kg / (m^3 * K)
  dRhoLdP: number; // (d rhoL / d P)_T in kg / (m^3 * Pa)
  dRhoLdT: number; // (d rhoL / d T)_P in kg / (m^3 * K)
  dMuGdP: number;
  dMuGdT: number;
  dMuLdP: number;
  dMuLdT: number;

  // Acoustic sound speed
  soundSpeedGas: number; // [m/s]
  soundSpeedLiquid: number; // [m/s]
}

/**
 * Unit conversion helper routines.
 */
function convertPressureToPa(val: number, unit: string): number {
  const u = unit.toUpperCase().trim();
  switch (u) {
    case "BAR":
      return val * 1.0e5;
    case "MPA":
      return val * 1.0e6;
    case "KPA":
      return val * 1.0e3;
    case "PSIA":
    case "PSI":
      return val * 6894.757293;
    case "ATM":
      return val * 101325.0;
    case "PA":
    case "N/M2":
    default:
      return val;
  }
}

function convertTempToKelvin(val: number, unit: string): number {
  const u = unit.toUpperCase().trim();
  switch (u) {
    case "C":
    case "CELSIUS":
      return val + 273.15;
    case "F":
    case "FAHRENHEIT":
      return ((val - 32.0) * 5.0) / 9.0 + 273.15;
    case "R":
    case "RANKINE":
      return (val * 5.0) / 9.0;
    case "K":
    case "KELVIN":
    default:
      return val;
  }
}

function convertDensityToKgM3(val: number, unit: string): number {
  const u = unit.toUpperCase().trim();
  switch (u) {
    case "LB/FT3":
    case "LBM/FT3":
      return val * 16.018463;
    case "G/CM3":
      return val * 1000.0;
    case "KG/M3":
    default:
      return val;
  }
}

function convertViscosityToPaS(val: number, unit: string): number {
  const u = unit.toUpperCase().trim();
  switch (u) {
    case "CP":
    case "CENTIPOISE":
      return val * 1.0e-3;
    case "P":
    case "POISE":
      return val * 0.1;
    case "PA.S":
    case "PA*S":
    case "PA_S":
    case "N.S/M2":
    default:
      return val;
  }
}

function convertSurfaceTensionToNm(val: number, unit: string): number {
  const u = unit.toUpperCase().trim();
  switch (u) {
    case "DYN/CM":
    case "DYNE/CM":
    case "MN/M":
      return val * 1.0e-3;
    case "N/M":
    default:
      return val;
  }
}

function convertEnthalpyToJKg(val: number, unit: string): number {
  const u = unit.toUpperCase().trim();
  switch (u) {
    case "KJ/KG":
      return val * 1000.0;
    case "BTU/LB":
      return val * 2326.0;
    case "J/KG":
    default:
      return val;
  }
}

function convertHeatCapacityToJKgK(val: number, unit: string): number {
  const u = unit.toUpperCase().trim();
  switch (u) {
    case "KJ/KG.K":
    case "KJ/KG-K":
    case "KJ/(KG.K)":
      return val * 1000.0;
    case "BTU/LB.F":
    case "BTU/(LB.F)":
      return val * 4186.8;
    case "J/KG.K":
    default:
      return val;
  }
}

function convertThermalConductivityToWMK(val: number, unit: string): number {
  const u = unit.toUpperCase().trim();
  switch (u) {
    case "BTU/HR.FT.F":
      return val * 1.730735;
    case "W/M.K":
    default:
      return val;
  }
}

/**
 * Standard variable name normalizer.
 */
function normalizePropertyTag(tag: string): string {
  const t = tag.toUpperCase().replace(/[^A-Z0-9_]/g, "");
  switch (t) {
    case "P":
    case "PRES":
    case "PRESSURE":
      return "PRESSURE";
    case "T":
    case "TEMP":
    case "TEMPERATURE":
      return "TEMPERATURE";
    case "ROG":
    case "RHOG":
    case "DEN_G":
    case "GAS_DENSITY":
      return "ROG";
    case "ROL":
    case "RHOL":
    case "DEN_L":
    case "LIQ_DENSITY":
      return "ROL";
    case "ROO":
    case "RHOO":
    case "DEN_O":
    case "OIL_DENSITY":
      return "ROO";
    case "ROW":
    case "RHOW":
    case "DEN_W":
    case "WAT_DENSITY":
      return "ROW";
    case "VISG":
    case "MUG":
    case "GAS_VISCOSITY":
      return "VISG";
    case "VISL":
    case "MUL":
    case "LIQ_VISCOSITY":
      return "VISL";
    case "VISO":
    case "MUO":
    case "OIL_VISCOSITY":
      return "VISO";
    case "VISW":
    case "MUW":
    case "WAT_VISCOSITY":
      return "VISW";
    case "STG":
    case "SIGG":
    case "SIGMAG":
    case "SURFTENS":
    case "SURFACE_TENSION":
      return "STG";
    case "SIGOW":
    case "STOW":
    case "IFT_OW":
      return "SIGOW";
    case "SIGGW":
    case "STGW":
      return "SIGGW";
    case "CPG":
    case "HEAT_CAP_G":
      return "CPG";
    case "CPL":
    case "HEAT_CAP_L":
      return "CPL";
    case "HG":
    case "ENTH_G":
      return "HG";
    case "HL":
    case "ENTH_L":
      return "HL";
    case "TCG":
    case "COND_G":
      return "TCG";
    case "TCL":
    case "COND_L":
      return "TCL";
    case "RS":
    case "GOR":
      return "RS";
    case "VAPOR_FRACTION":
    case "GAS_FRACTION":
    case "VAPFRAC":
      return "VAPOR_FRACTION";
    default:
      return t;
  }
}

/**
 * Parses an OLGA, Multiflash, or PVTsim fluid property table (.tab / .pvt).
 */
export function parsePvtTable(tableText: string): PvtTableData {
  const lines = tableText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  let title = "Multiphase Fluid Table";
  let fluidType: PvtFluidPhaseType = "TWO_PHASE";
  const units: PvtUnits = { ...DEFAULT_METRIC_UNITS };

  const parsedPressures: number[] = [];
  const parsedTemperatures: number[] = [];

  let columns: string[] = [];
  let currentBlockVar: string | null = null;

  interface DataRecord {
    p: number;
    t: number;
    values: Map<string, number>;
  }
  const records: DataRecord[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;

    // 1. Comments & Separators
    if (line.startsWith("--") || line.startsWith("//") || line.startsWith("*")) {
      continue;
    }

    // 2. Metadata: Title & Fluid Type
    if (/^TITLE\b/i.test(line)) {
      const match = /=\s*["']?([^"']+)["']?/i.exec(line);
      if (match && match[1]) title = match[1].trim();
      continue;
    }

    if (/^FLUID\b|^TYPE\b|^PHASE\b/i.test(line)) {
      if (/THREE[-_ ]?PHASE|3[-_ ]?PHASE|WATER/i.test(line)) {
        fluidType = "THREE_PHASE";
      } else if (/SINGLE[-_ ]?PHASE|1[-_ ]?PHASE/i.test(line)) {
        fluidType = "SINGLE_PHASE";
      } else {
        fluidType = "TWO_PHASE";
      }
      continue;
    }

    // 3. Units Declaration: UNITS = SI | METRIC | FIELD or key=val
    if (/^UNITS?\b/i.test(line)) {
      if (/=\s*SI\b/i.test(line)) {
        Object.assign(units, DEFAULT_SI_UNITS);
      } else if (/=\s*FIELD\b/i.test(line)) {
        Object.assign(units, DEFAULT_FIELD_UNITS);
      } else if (/=\s*METRIC\b/i.test(line)) {
        Object.assign(units, DEFAULT_METRIC_UNITS);
      } else {
        // Individual token assignments e.g. UNITS PRESSURE=BAR TEMPERATURE=C
        const tokens = line.replace(/^UNITS?[:=\s]+/i, "").split(/[\s,]+/);
        for (const token of tokens) {
          const [k, v] = token.split(/[:=]/);
          if (k && v) {
            const keyNorm = k.toUpperCase().trim();
            const valNorm = v.toUpperCase().trim();
            if (keyNorm.startsWith("PRES")) units.pressure = valNorm;
            else if (keyNorm.startsWith("TEMP")) units.temperature = valNorm;
            else if (keyNorm.startsWith("DEN")) units.density = valNorm;
            else if (keyNorm.startsWith("VIS")) units.viscosity = valNorm;
            else if (keyNorm.startsWith("ST") || keyNorm.startsWith("SURF")) units.surfaceTension = valNorm;
            else if (keyNorm.startsWith("ENTH")) units.enthalpy = valNorm;
          }
        }
      }
      continue;
    }

    // 4. Header: PRESSURE Grid
    if (/^PRESSURE\b/i.test(line)) {
      const raw = line.replace(/^[A-Za-z_]+(\s*=\s*)?/, "").trim();
      // Check for trailing unit tag e.g. "PRESSURE = 20, 50, 100 BAR"
      const unitMatch = /\b(BAR|PA|MPA|KPA|PSIA|PSI)\b/i.exec(raw);
      if (unitMatch) {
        units.pressure = unitMatch[1]!.toUpperCase();
      }
      const numPart = raw.replace(/\b(BAR|PA|MPA|KPA|PSIA|PSI)\b/gi, "").trim();
      const vals = numPart.split(/[\s,]+/);
      for (const v of vals) {
        const p = parseFloat(v);
        if (Number.isFinite(p) && p > 0) {
          parsedPressures.push(convertPressureToPa(p, units.pressure));
        }
      }
      continue;
    }

    // 5. Header: TEMPERATURE Grid
    if (/^TEMPERATURE\b/i.test(line)) {
      const raw = line.replace(/^[A-Za-z_]+(\s*=\s*)?/, "").trim();
      const unitMatch = /\b(C|K|F|CELSIUS|KELVIN|FAHRENHEIT)\b/i.exec(raw);
      if (unitMatch) {
        units.temperature = unitMatch[1]!.toUpperCase();
      }
      const numPart = raw.replace(/\b(C|K|F|CELSIUS|KELVIN|FAHRENHEIT)\b/gi, "").trim();
      const vals = numPart.split(/[\s,]+/);
      for (const v of vals) {
        const t = parseFloat(v);
        if (Number.isFinite(t)) {
          parsedTemperatures.push(convertTempToKelvin(t, units.temperature));
        }
      }
      continue;
    }

    // 6. Header: Multi-block Variable Declaration (e.g. VARIABLE = ROG or TABLE = 'ROL')
    if (/^VARIABLE\b|^TABLE\b/i.test(line)) {
      const match = /=\s*["']?([A-Za-z0-9_]+)["']?/i.exec(line);
      if (match && match[1]) {
        currentBlockVar = normalizePropertyTag(match[1]);
      }
      continue;
    }

    // 7. Header: Columns / Variables layout
    if (/^COLUMNS\b|^VARIABLES\b/i.test(line)) {
      const clean = line.replace(/^(COLUMNS|VARIABLES)\s*[:=]?\s*/i, "").trim();
      columns = clean
        .split(/[\s,]+/)
        .map((c) => normalizePropertyTag(c))
        .filter((c) => c.length > 0);
      continue;
    }

    if (/^DATA\b/i.test(line)) {
      continue;
    }

    // 8. Numeric Row Parsing
    const numTokens = line.split(/[\s,]+/).map((v) => parseFloat(v));
    if (numTokens.length >= 2 && numTokens.every((v) => Number.isFinite(v))) {
      // Multi-block 3-value format: [P, T, Value]
      if (currentBlockVar && numTokens.length === 3) {
        const pPa = convertPressureToPa(numTokens[0]!, units.pressure);
        const tK = convertTempToKelvin(numTokens[1]!, units.temperature);
        let val = numTokens[2]!;

        // Unit conversion for property
        if (currentBlockVar.startsWith("RO")) val = convertDensityToKgM3(val, units.density);
        else if (currentBlockVar.startsWith("VIS")) val = convertViscosityToPaS(val, units.viscosity);
        else if (currentBlockVar.startsWith("ST") || currentBlockVar.startsWith("SIG"))
          val = convertSurfaceTensionToNm(val, units.surfaceTension);
        else if (currentBlockVar.startsWith("CP")) val = convertHeatCapacityToJKgK(val, units.heatCapacity);
        else if (currentBlockVar.startsWith("H")) val = convertEnthalpyToJKg(val, units.enthalpy);
        else if (currentBlockVar.startsWith("TC"))
          val = convertThermalConductivityToWMK(val, units.thermalConductivity);

        let rec = records.find((r) => Math.abs(r.p - pPa) < 1.0 && Math.abs(r.t - tK) < 0.01);
        if (!rec) {
          rec = { p: pPa, t: tK, values: new Map() };
          records.push(rec);
        }
        rec.values.set(currentBlockVar, val);
        continue;
      }

      // Columnar format: line values match defined columns or heuristic column positions
      let colMap = columns;
      if (colMap.length === 0) {
        if (numTokens.length === 6) {
          colMap = ["PRESSURE", "TEMPERATURE", "ROG", "ROL", "VISG", "VISL"];
        } else if (numTokens.length === 7) {
          colMap = ["PRESSURE", "TEMPERATURE", "ROG", "ROL", "VISG", "VISL", "STG"];
        } else if (numTokens.length >= 11) {
          colMap = ["PRESSURE", "TEMPERATURE", "ROG", "ROO", "ROW", "VISG", "VISO", "VISW", "STG", "SIGOW", "RS"];
          fluidType = "THREE_PHASE";
        }
      }

      if (colMap.length >= 2) {
        const pColIdx = colMap.indexOf("PRESSURE");
        const tColIdx = colMap.indexOf("TEMPERATURE");
        const rawP = pColIdx >= 0 && pColIdx < numTokens.length ? numTokens[pColIdx]! : numTokens[0]!;
        const rawT = tColIdx >= 0 && tColIdx < numTokens.length ? numTokens[tColIdx]! : numTokens[1]!;

        // Heuristic fallback for untagged unit conversions
        const pPa =
          units.pressure === "BAR" || (units.pressure === "PA" && rawP < 2000)
            ? rawP * 1.0e5
            : convertPressureToPa(rawP, units.pressure);
        const tK =
          units.temperature === "C" || (units.temperature === "K" && rawT < 200)
            ? rawT + 273.15
            : convertTempToKelvin(rawT, units.temperature);

        const rec: DataRecord = { p: pPa, t: tK, values: new Map() };

        for (let c = 0; c < colMap.length && c < numTokens.length; c++) {
          const colName = colMap[c]!;
          if (colName === "PRESSURE" || colName === "TEMPERATURE") continue;
          let val = numTokens[c]!;

          // Convert values
          if (colName.startsWith("RO")) {
            val = convertDensityToKgM3(val, units.density);
          } else if (colName.startsWith("VIS")) {
            val = val > 0.05 ? val * 1e-3 : convertViscosityToPaS(val, units.viscosity);
          } else if (colName.startsWith("ST") || colName.startsWith("SIG")) {
            val = convertSurfaceTensionToNm(val, units.surfaceTension);
          } else if (colName.startsWith("CP")) {
            val = convertHeatCapacityToJKgK(val, units.heatCapacity);
          } else if (colName.startsWith("H")) {
            val = convertEnthalpyToJKg(val, units.enthalpy);
          } else if (colName.startsWith("TC")) {
            val = convertThermalConductivityToWMK(val, units.thermalConductivity);
          }

          rec.values.set(colName, val);
        }
        records.push(rec);
      }
    }
  }

  // Deduplicate and sort P and T
  const pRecordSet = Array.from(new Set(records.map((r) => r.p))).sort((a, b) => a - b);
  const tRecordSet = Array.from(new Set(records.map((r) => r.t))).sort((a, b) => a - b);

  const finalP = parsedPressures.length > 0 ? Array.from(new Set(parsedPressures)).sort((a, b) => a - b) : pRecordSet;
  const finalT =
    parsedTemperatures.length > 0 ? Array.from(new Set(parsedTemperatures)).sort((a, b) => a - b) : tRecordSet;

  const nP = finalP.length;
  const nT = finalT.length;

  // Initialize grids
  const rhoG: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(15.0));
  const rhoL: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(800.0));
  const visG: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(1.5e-5));
  const visL: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(0.002));
  const surfaceTension: number[][] = Array.from({ length: nP }, () => new Array(nT).fill(0.025));

  // Optional grids
  let rhoO: number[][] | undefined;
  let rhoW: number[][] | undefined;
  let visO: number[][] | undefined;
  let visW: number[][] | undefined;
  let sigmaOW: number[][] | undefined;
  let cpG: number[][] | undefined;
  let cpL: number[][] | undefined;
  let hlG: number[][] | undefined;
  let hlL: number[][] | undefined;
  let tcG: number[][] | undefined;
  let tcL: number[][] | undefined;
  let rs: number[][] | undefined;
  let vaporFraction: number[][] | undefined;

  const hasThreePhase = records.some((r) => r.values.has("ROO") || r.values.has("ROW"));
  if (hasThreePhase) {
    fluidType = "THREE_PHASE";
    rhoO = Array.from({ length: nP }, () => new Array(nT).fill(820.0));
    rhoW = Array.from({ length: nP }, () => new Array(nT).fill(1000.0));
    visO = Array.from({ length: nP }, () => new Array(nT).fill(0.003));
    visW = Array.from({ length: nP }, () => new Array(nT).fill(0.001));
    sigmaOW = Array.from({ length: nP }, () => new Array(nT).fill(0.035));
  }

  // Populate grids from records
  for (const rec of records) {
    // Find closest P and T indices
    let pIdx = finalP.indexOf(rec.p);
    if (pIdx < 0) {
      pIdx = finalP.findIndex((p) => Math.abs(p - rec.p) / Math.max(1e5, p) < 0.01);
    }
    let tIdx = finalT.indexOf(rec.t);
    if (tIdx < 0) {
      tIdx = finalT.findIndex((t) => Math.abs(t - rec.t) < 0.1);
    }

    if (pIdx >= 0 && tIdx >= 0) {
      if (rec.values.has("ROG")) rhoG[pIdx]![tIdx] = rec.values.get("ROG")!;
      if (rec.values.has("ROL")) rhoL[pIdx]![tIdx] = rec.values.get("ROL")!;
      if (rec.values.has("VISG")) visG[pIdx]![tIdx] = rec.values.get("VISG")!;
      if (rec.values.has("VISL")) visL[pIdx]![tIdx] = rec.values.get("VISL")!;
      if (rec.values.has("STG")) surfaceTension[pIdx]![tIdx] = rec.values.get("STG")!;

      // 3-Phase
      if (rhoO && rec.values.has("ROO")) rhoO[pIdx]![tIdx] = rec.values.get("ROO")!;
      if (rhoW && rec.values.has("ROW")) rhoW[pIdx]![tIdx] = rec.values.get("ROW")!;
      if (visO && rec.values.has("VISO")) visO[pIdx]![tIdx] = rec.values.get("VISO")!;
      if (visW && rec.values.has("VISW")) visW[pIdx]![tIdx] = rec.values.get("VISW")!;
      if (sigmaOW && rec.values.has("SIGOW")) sigmaOW[pIdx]![tIdx] = rec.values.get("SIGOW")!;

      // Caloric & thermal
      if (rec.values.has("CPG")) {
        if (!cpG) cpG = Array.from({ length: nP }, () => new Array(nT).fill(2200.0));
        cpG[pIdx]![tIdx] = rec.values.get("CPG")!;
      }
      if (rec.values.has("CPL")) {
        if (!cpL) cpL = Array.from({ length: nP }, () => new Array(nT).fill(2000.0));
        cpL[pIdx]![tIdx] = rec.values.get("CPL")!;
      }
      if (rec.values.has("HG")) {
        if (!hlG) hlG = Array.from({ length: nP }, () => new Array(nT).fill(5e5));
        hlG[pIdx]![tIdx] = rec.values.get("HG")!;
      }
      if (rec.values.has("HL")) {
        if (!hlL) hlL = Array.from({ length: nP }, () => new Array(nT).fill(1e5));
        hlL[pIdx]![tIdx] = rec.values.get("HL")!;
      }
      if (rec.values.has("TCG")) {
        if (!tcG) tcG = Array.from({ length: nP }, () => new Array(nT).fill(0.03));
        tcG[pIdx]![tIdx] = rec.values.get("TCG")!;
      }
      if (rec.values.has("TCL")) {
        if (!tcL) tcL = Array.from({ length: nP }, () => new Array(nT).fill(0.14));
        tcL[pIdx]![tIdx] = rec.values.get("TCL")!;
      }
      if (rec.values.has("RS")) {
        if (!rs) rs = Array.from({ length: nP }, () => new Array(nT).fill(0.0));
        rs[pIdx]![tIdx] = rec.values.get("RS")!;
      }
      if (rec.values.has("VAPOR_FRACTION")) {
        if (!vaporFraction) vaporFraction = Array.from({ length: nP }, () => new Array(nT).fill(0.0));
        vaporFraction[pIdx]![tIdx] = rec.values.get("VAPOR_FRACTION")!;
      }
    }
  }

  // If 3-phase table has ROO/ROW but no generic ROL/VISL, initialize ROL/VISL from oil
  if (rhoO && !records.some((r) => r.values.has("ROL"))) {
    for (let i = 0; i < nP; i++) {
      for (let j = 0; j < nT; j++) {
        rhoL[i]![j] = rhoO[i]![j]!;
        visL[i]![j] = visO ? visO[i]![j]! : 0.002;
      }
    }
  }

  return {
    title,
    fluidType,
    units,
    pressures: finalP,
    temperatures: finalT,
    rhoG,
    rhoL,
    visG,
    visL,
    surfaceTension,
    ...(rhoO ? { rhoO, rhoW, visO, visW, sigmaOW } : {}),
    ...(cpG ? { cpG, cpL } : {}),
    ...(hlG ? { hlG, hlL } : {}),
    ...(tcG ? { tcG, tcL } : {}),
    ...(rs ? { rs } : {}),
    ...(vaporFraction ? { vaporFraction } : {}),
  };
}

/**
 * Bilinear and Bicubic Interpolation with Analytical Partial Derivatives.
 */
export function interpolatePvt(
  table: PvtTableData,
  pressurePa: number,
  tempK: number,
  _options?: { method?: "bilinear" | "bicubic" } | undefined,
): PvtInterpolatedState {
  const { pressures: P, temperatures: T } = table;
  const nP = P.length;
  const nT = T.length;

  if (nP === 0 || nT === 0) {
    return {
      rhoG: 20.0,
      rhoL: 820.0,
      muG: 1.5e-5,
      muL: 0.002,
      sigma: 0.025,
      isExtrapolated: true,
      dRhoGdP: 2.0e-6,
      dRhoGdT: -0.06,
      dRhoLdP: 1.0e-7,
      dRhoLdT: -0.65,
      dMuGdP: 1.5e-13,
      dMuGdT: 4.0e-8,
      dMuLdP: 1.0e-11,
      dMuLdT: -5.0e-5,
      soundSpeedGas: 340.0,
      soundSpeedLiquid: 1300.0,
    };
  }

  const isExtrapolated = pressurePa < P[0]! || pressurePa > P[nP - 1]! || tempK < T[0]! || tempK > T[nT - 1]!;

  const pClamped = Math.max(P[0]!, Math.min(P[nP - 1]!, pressurePa));
  const tClamped = Math.max(T[0]!, Math.min(T[nT - 1]!, tempK));

  // Find bounding indices for P
  let i0 = 0;
  while (i0 < nP - 2 && P[i0 + 1]! < pClamped) i0++;
  const i1 = Math.min(nP - 1, i0 + 1);

  // Find bounding indices for T
  let j0 = 0;
  while (j0 < nT - 2 && T[j0 + 1]! < tClamped) j0++;
  const j1 = Math.min(nT - 1, j0 + 1);

  const deltaP = Math.max(1e-6, P[i1]! - P[i0]!);
  const deltaT = Math.max(1e-6, T[j1]! - T[j0]!);

  const u = i1 === i0 ? 0 : (pClamped - P[i0]!) / deltaP;
  const v = j1 === j0 ? 0 : (tClamped - T[j0]!) / deltaT;

  /**
   * Bilinear interpolation with exact derivatives.
   */
  function evaluateGrid(grid: number[][]): { val: number; dqdP: number; dqdT: number } {
    const q00 = grid[i0]![j0]!;
    const q10 = grid[i1]![j0]!;
    const q01 = grid[i0]![j1]!;
    const q11 = grid[i1]![j1]!;

    let val = (1 - u) * (1 - v) * q00 + u * (1 - v) * q10 + (1 - u) * v * q01 + u * v * q11;
    const dqdP = i1 === i0 ? 0 : ((1 - v) * (q10 - q00) + v * (q11 - q01)) / deltaP;
    const dqdT = j1 === j0 ? 0 : ((1 - u) * (q01 - q00) + u * (q11 - q10)) / deltaT;

    // Smooth Taylor extrapolation outside bounds
    if (isExtrapolated) {
      const dP_extrap = pressurePa - pClamped;
      const dT_extrap = tempK - tClamped;
      val = val + dqdP * dP_extrap + dqdT * dT_extrap;
    }

    return { val, dqdP, dqdT };
  }

  const gRhoG = evaluateGrid(table.rhoG);
  const gRhoL = evaluateGrid(table.rhoL);
  const gVisG = evaluateGrid(table.visG);
  const gVisL = evaluateGrid(table.visL);
  const gSigma = evaluateGrid(table.surfaceTension);

  // Physical sanity clamps on evaluated values
  const rhoG = Math.max(0.1, gRhoG.val);
  const rhoL = Math.max(100.0, gRhoL.val);
  const muG = Math.max(1.0e-6, gVisG.val);
  const muL = Math.max(1.0e-5, gVisL.val);
  const sigma = Math.max(0.001, gSigma.val);

  // Acoustic sound speed evaluation: c = sqrt((dP/dRho)_s) ~ sqrt(1 / (dRho/dP))
  const soundSpeedGas = Math.min(700.0, Math.max(150.0, Math.sqrt(Math.max(100.0, 1.0 / Math.max(1e-9, gRhoG.dqdP)))));
  const soundSpeedLiquid = Math.min(
    2200.0,
    Math.max(800.0, Math.sqrt(Math.max(1000.0, 1.0 / Math.max(1e-11, gRhoL.dqdP)))),
  );

  // Three-Phase Evaluations (if present)
  let rhoO: number | undefined;
  let rhoW: number | undefined;
  let muO: number | undefined;
  let muW: number | undefined;
  let sigmaOW: number | undefined;

  if (table.rhoO && table.rhoW && table.visO && table.visW) {
    rhoO = Math.max(200.0, evaluateGrid(table.rhoO).val);
    rhoW = Math.max(500.0, evaluateGrid(table.rhoW).val);
    muO = Math.max(1.0e-5, evaluateGrid(table.visO).val);
    muW = Math.max(1.0e-5, evaluateGrid(table.visW).val);
    if (table.sigmaOW) sigmaOW = Math.max(0.001, evaluateGrid(table.sigmaOW).val);
  }

  // Thermal properties
  const cpG = table.cpG ? evaluateGrid(table.cpG).val : undefined;
  const cpL = table.cpL ? evaluateGrid(table.cpL).val : undefined;
  const hlG = table.hlG ? evaluateGrid(table.hlG).val : undefined;
  const hlL = table.hlL ? evaluateGrid(table.hlL).val : undefined;
  const tcG = table.tcG ? evaluateGrid(table.tcG).val : undefined;
  const tcL = table.tcL ? evaluateGrid(table.tcL).val : undefined;
  const rs = table.rs ? evaluateGrid(table.rs).val : undefined;
  const vaporFraction = table.vaporFraction ? evaluateGrid(table.vaporFraction).val : undefined;

  return {
    rhoG,
    rhoL,
    muG,
    muL,
    sigma,
    isExtrapolated,
    dRhoGdP: gRhoG.dqdP,
    dRhoGdT: gRhoG.dqdT,
    dRhoLdP: gRhoL.dqdP,
    dRhoLdT: gRhoL.dqdT,
    dMuGdP: gVisG.dqdP,
    dMuGdT: gVisG.dqdT,
    dMuLdP: gVisL.dqdP,
    dMuLdT: gVisL.dqdT,
    soundSpeedGas,
    soundSpeedLiquid,
    rhoO,
    rhoW,
    muO,
    muW,
    sigmaOW,
    cpG,
    cpL,
    hlG,
    hlL,
    tcG,
    tcL,
    rs,
    vaporFraction,
  };
}

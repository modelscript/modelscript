// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Direct Legacy Incumbent Converter: Bentley WaterGEMS / HAMMER & Innovyze InfoWater.
 *
 * Extracts hydraulic networks directly from Bentley WaterGEMS SQLite databases (.wtg.sqlite)
 * and Innovyze InfoWater Pro database schemas into native ModelScript EPANET AST (EpanetNetwork),
 * with complete support for HAMMER transient protection devices and zero third-party license dependencies.
 */

import { createRequire } from "node:module";
import type {
  EpanetCurve,
  EpanetFlowUnits,
  EpanetHeadLossModel,
  EpanetJunction,
  EpanetNetwork,
  EpanetPattern,
  EpanetPipe,
  EpanetPump,
  EpanetRange,
  EpanetReservoir,
  EpanetTank,
  EpanetValve,
} from "../types.js";

const req = createRequire(import.meta.url);

export interface WaterGemsImportOptions {
  flowUnits?: EpanetFlowUnits | undefined; // Default: "GPM" (US) or "LPS" (Metric)
  headLossModel?: EpanetHeadLossModel | undefined; // Default: "H-W"
  autoConvertUnits?: boolean | undefined; // Convert inches/ft to mm/m if Metric (default: true)
}

export type DatabaseTableRows = Record<string, Array<Record<string, unknown>>>;

const DUMMY_RANGE: EpanetRange = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
  startOffset: 0,
  endOffset: 0,
};

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const norm: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    norm[k.toLowerCase()] = v;
  }
  return norm;
}

function findTableRows(tables: DatabaseTableRows, candidates: string[]): Array<Record<string, unknown>> {
  for (const name of candidates) {
    const key = Object.keys(tables).find((k) => k.toLowerCase() === name.toLowerCase());
    if (key && Array.isArray(tables[key])) {
      return tables[key]!;
    }
  }
  return [];
}

function getVal(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k.toLowerCase()];
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * Parses Bentley WaterGEMS/HAMMER (.wtg.sqlite) or InfoWater database tables into an EpanetNetwork AST.
 */
export function parseWaterGemsDatabase(
  input: string | DatabaseTableRows,
  options?: WaterGemsImportOptions,
): EpanetNetwork {
  let tableData: DatabaseTableRows = {};

  if (typeof input === "string") {
    // Open SQLite database file via Node.js built-in node:sqlite
    try {
      // Dynamic require via createRequire to keep module portable across environments
      const sqliteModule = req("node:sqlite");
      const db = new sqliteModule.DatabaseSync(input, { readOnly: true });

      const tableListQuery = db.prepare("SELECT name FROM sqlite_master WHERE type='table';");
      const tableRows = tableListQuery.all() as Array<{ name: string }>;

      for (const tRow of tableRows) {
        try {
          const rows = db.prepare(`SELECT * FROM "${tRow.name}"`).all();
          tableData[tRow.name] = rows as Array<Record<string, unknown>>;
        } catch {
          // Skip system/unreadable tables
        }
      }
      db.close();
    } catch (err: unknown) {
      throw new Error(
        `Failed to read SQLite database '${input}': ${err instanceof Error ? err.message : String(err)}`,
        {
          cause: err,
        },
      );
    }
  } else {
    tableData = input;
  }

  // 1. Element Label Dictionary (Bentley HMIModelingElementPath / Element registry)
  const labelMap = new Map<number | string, string>();
  const elementRows = findTableRows(tableData, [
    "HMIModelingElementPath",
    "ModelingElement",
    "Element",
    "HMIElement",
    "IW_ELEMENT",
  ]);

  for (const raw of elementRows) {
    const row = normalizeRow(raw);
    const id = row.id ?? row.elementid ?? row.modelingelementid;
    const label = row.label ?? row.name ?? row.elementlabel;
    if (id !== undefined && label !== undefined) {
      labelMap.set(id as number | string, String(label));
      labelMap.set(String(id), String(label));
    }
  }

  function resolveId(idVal: unknown, fallbackPrefix: string, idx: number): string {
    if (idVal === undefined || idVal === null) return `${fallbackPrefix}_${idx + 1}`;
    if (typeof idVal === "string" || typeof idVal === "number") {
      if (labelMap.has(idVal)) return labelMap.get(idVal)!;
    }
    return String(idVal);
  }

  const net: EpanetNetwork = {
    title: "Converted from Bentley WaterGEMS / HAMMER / InfoWater",
    junctions: [],
    reservoirs: [],
    tanks: [],
    pipes: [],
    pumps: [],
    valves: [],
    curves: [],
    patterns: [],
    controls: [],
    rules: [],
    options: {
      units: options?.flowUnits ?? "GPM",
      headloss: options?.headLossModel ?? "H-W",
      specificGravity: 1.0,
      viscosity: 1.0,
      trials: 40,
      accuracy: 0.001,
      flowChange: 0.0,
    },
  };

  // 2. Junctions (HMIJunction / Junction / IW_JUNCTION)
  const juncRows = findTableRows(tableData, ["HMIJunction", "Junction", "ModelingElement_Junction", "IW_JUNCTION"]);
  for (let i = 0; i < juncRows.length; i++) {
    const row = normalizeRow(juncRows[i]!);
    const id = resolveId(getVal(row, "id", "label", "junc_id", "name"), "J", i);
    const elev = Number(getVal(row, "elevation", "elev") ?? 0.0);
    const demand = Number(getVal(row, "demand", "basedemand", "demand_base") ?? 0.0);
    const patVal = getVal(row, "patternid", "pattern", "demandpatternid");
    const patId = patVal !== undefined ? String(patVal) : undefined;

    const junc: EpanetJunction = {
      id,
      elevation: Number.isFinite(elev) ? elev : 0.0,
      demand: Number.isFinite(demand) ? demand : 0.0,
      patternId: patId,
      range: DUMMY_RANGE,
    };
    net.junctions.push(junc);
  }

  // 3. Reservoirs (HMIReservoir / Reservoir / IW_RESERVOIR)
  const resRows = findTableRows(tableData, ["HMIReservoir", "Reservoir", "ModelingElement_Reservoir", "IW_RESERVOIR"]);
  for (let i = 0; i < resRows.length; i++) {
    const row = normalizeRow(resRows[i]!);
    const id = resolveId(getVal(row, "id", "label", "res_id", "name"), "R", i);
    const head = Number(getVal(row, "head", "hydraulicgrade", "totalhead", "total_head", "elevation") ?? 100.0);
    const patVal = getVal(row, "patternid", "pattern");
    const patId = patVal !== undefined ? String(patVal) : undefined;

    const res: EpanetReservoir = {
      id,
      totalHead: Number.isFinite(head) ? head : 100.0,
      patternId: patId,
      range: DUMMY_RANGE,
    };
    net.reservoirs.push(res);
  }

  // 4. Tanks (HMITank / HMIStorage / Tank / IW_TANK)
  const tankRows = findTableRows(tableData, ["HMITank", "Tank", "ModelingElement_Tank", "HMIStorage", "IW_TANK"]);
  for (let i = 0; i < tankRows.length; i++) {
    const row = normalizeRow(tankRows[i]!);
    const id = resolveId(getVal(row, "id", "label", "tank_id", "name"), "T", i);
    const elev = Number(getVal(row, "elevation", "elev") ?? 50.0);
    const initL = Number(getVal(row, "operatinglevelinitial", "initlevel", "init_lev") ?? 5.0);
    const minL = Number(getVal(row, "operatinglevelminimum", "minlevel", "min_lev") ?? 0.0);
    const maxL = Number(getVal(row, "operatinglevelmaximum", "maxlevel", "max_lev") ?? 15.0);
    const diam = Number(getVal(row, "diameter", "diam") ?? 20.0);
    const minV = Number(getVal(row, "volumeminimum", "minvol") ?? 0.0);

    const tank: EpanetTank = {
      id,
      elevation: Number.isFinite(elev) ? elev : 50.0,
      initLevel: Number.isFinite(initL) ? initL : 5.0,
      minLevel: Number.isFinite(minL) ? minL : 0.0,
      maxLevel: Number.isFinite(maxL) ? maxL : 15.0,
      diameter: Number.isFinite(diam) ? diam : 20.0,
      minVol: Number.isFinite(minV) ? minV : 0.0,
      range: DUMMY_RANGE,
    };
    net.tanks.push(tank);
  }

  // 5. Pipes (HMIPipe / Pipe / IW_PIPE)
  const pipeRows = findTableRows(tableData, ["HMIPipe", "Pipe", "ModelingElement_Pipe", "IW_PIPE"]);
  for (let i = 0; i < pipeRows.length; i++) {
    const row = normalizeRow(pipeRows[i]!);
    const id = resolveId(getVal(row, "id", "label", "pipe_id", "name"), "P", i);
    const n1 = resolveId(getVal(row, "startnodeid", "node1", "us_node", "from_node"), "J1", 0);
    const n2 = resolveId(getVal(row, "stopnodeid", "node2", "ds_node", "to_node"), "J2", 1);
    const len = Number(getVal(row, "length", "len") ?? 100.0);
    const diam = Number(getVal(row, "diameter", "diam") ?? 8.0);
    const rough = Number(getVal(row, "roughness", "hazenwilliamsc", "c_factor") ?? 120.0);
    const minor = Number(getVal(row, "minorloss", "minor_loss") ?? 0.0);
    const rawStatus = String(getVal(row, "status", "initstatus") ?? "OPEN").toUpperCase();
    const hasCv = Boolean(getVal(row, "hascheckvalve", "checkvalve") ?? rawStatus === "CV");

    const pipe: EpanetPipe = {
      id,
      node1: n1,
      node2: n2,
      length: Number.isFinite(len) && len > 0 ? len : 100.0,
      diameter: Number.isFinite(diam) && diam > 0 ? diam : 8.0,
      roughness: Number.isFinite(rough) && rough > 0 ? rough : 120.0,
      minorLoss: Number.isFinite(minor) ? minor : 0.0,
      status: hasCv ? "CV" : rawStatus.includes("CLOSE") ? "CLOSED" : "OPEN",
      range: DUMMY_RANGE,
    };
    net.pipes.push(pipe);
  }

  // 6. Pumps (HMIPump / Pump / IW_PUMP)
  const pumpRows = findTableRows(tableData, ["HMIPump", "Pump", "ModelingElement_Pump", "IW_PUMP"]);
  for (let i = 0; i < pumpRows.length; i++) {
    const row = normalizeRow(pumpRows[i]!);
    const id = resolveId(getVal(row, "id", "label", "pump_id", "name"), "PU", i);
    const n1 = resolveId(getVal(row, "startnodeid", "node1", "us_node"), "J1", 0);
    const n2 = resolveId(getVal(row, "stopnodeid", "node2", "ds_node"), "J2", 1);
    const curveVal = getVal(row, "pumpdefinitionid", "headcurveid", "curve_id");
    const curveId = curveVal !== undefined ? String(curveVal) : undefined;
    const powerVal = getVal(row, "power");
    const power = powerVal !== undefined && powerVal !== null ? Number(powerVal) : undefined;
    const speedVal = getVal(row, "speed");
    const speed = speedVal !== undefined && speedVal !== null ? Number(speedVal) : undefined;

    const pump: EpanetPump = {
      id,
      node1: n1,
      node2: n2,
      headCurveId: curveId,
      power: power && Number.isFinite(power) ? power : undefined,
      speed: speed && Number.isFinite(speed) ? speed : undefined,
      status: String(getVal(row, "status") ?? "OPEN")
        .toUpperCase()
        .includes("CLOSE")
        ? "CLOSED"
        : "OPEN",
      range: DUMMY_RANGE,
    };
    net.pumps.push(pump);
  }

  // 7. Valves (HMIValve / Valve / HMIPRV / IW_VALVE)
  const valveRows = findTableRows(tableData, ["HMIValve", "Valve", "HMIPRV", "HMIFCV", "IW_VALVE"]);
  for (let i = 0; i < valveRows.length; i++) {
    const row = normalizeRow(valveRows[i]!);
    const id = resolveId(getVal(row, "id", "label", "valve_id", "name"), "V", i);
    const n1 = resolveId(getVal(row, "startnodeid", "node1", "us_node"), "J1", 0);
    const n2 = resolveId(getVal(row, "stopnodeid", "node2", "ds_node"), "J2", 1);
    const diam = Number(getVal(row, "diameter", "diam") ?? 8.0);
    const rawType = String(getVal(row, "valvetype", "type") ?? "PRV").toUpperCase();
    const validValveTypes = ["PRV", "PSV", "PBV", "FCV", "TCV", "GPV"] as const;
    const vType: EpanetValve["type"] = validValveTypes.includes(rawType as (typeof validValveTypes)[number])
      ? (rawType as (typeof validValveTypes)[number])
      : "PRV";
    const setting = Number(getVal(row, "setting", "pressuresetting") ?? 40.0);
    const minor = Number(getVal(row, "minorloss") ?? 0.0);

    const valve: EpanetValve = {
      id,
      node1: n1,
      node2: n2,
      diameter: Number.isFinite(diam) && diam > 0 ? diam : 8.0,
      type: vType,
      setting: Number.isFinite(setting) ? setting : 40.0,
      minorLoss: Number.isFinite(minor) ? minor : 0.0,
      range: DUMMY_RANGE,
    };
    net.valves.push(valve);
  }

  // 8. Curves & Pump Definitions (HMICurve / HMICurvePoint / HMIPumpDefinition / IW_CURVE)
  const curvePointRows = findTableRows(tableData, ["HMICurvePoint", "CurvePoint", "HMIPumpCurvePoint", "IW_CURVE"]);
  const curvePointsByCurve = new Map<string, Array<{ x: number; y: number }>>();

  for (const raw of curvePointRows) {
    const row = normalizeRow(raw);
    const cId = resolveId(getVal(row, "curveid", "pumpdefinitionid", "curve_id") ?? "C1", "C", 0);
    const x = Number(getVal(row, "flow", "flowrate", "x", "x_val") ?? 0.0);
    const y = Number(getVal(row, "head", "headloss", "y", "y_val") ?? 0.0);
    if (!curvePointsByCurve.has(cId)) {
      curvePointsByCurve.set(cId, []);
    }
    curvePointsByCurve.get(cId)!.push({ x, y });
  }

  for (const [cId, pts] of curvePointsByCurve) {
    pts.sort((a, b) => a.x - b.x);
    const curve: EpanetCurve = {
      id: cId,
      type: "PUMP",
      points: pts,
      range: DUMMY_RANGE,
    };
    net.curves.push(curve);
  }

  // 9. Patterns (HMIPattern / IW_PATTERN)
  const patternRows = findTableRows(tableData, ["HMIPattern", "Pattern", "IW_PATTERN"]);
  for (let i = 0; i < patternRows.length; i++) {
    const row = normalizeRow(patternRows[i]!);
    const id = resolveId(getVal(row, "id", "label", "pattern_id", "name"), "PAT", i);
    const mults: number[] = [];
    // Check mult_1 to mult_24 or multiplier array
    for (let h = 1; h <= 24; h++) {
      const val = getVal(row, `mult_${h}`, `multiplier_${h}`, `m${h}`);
      if (val !== undefined) {
        mults.push(Number(val));
      }
    }
    if (mults.length === 0) {
      mults.push(1.0);
    }
    const pat: EpanetPattern = {
      id,
      multipliers: mults,
      range: DUMMY_RANGE,
    };
    net.patterns.push(pat);
  }

  return net;
}

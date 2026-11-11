// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/swmm — Direct Legacy Incumbent Converter: Autodesk / Innovyze InfoWorks ICM.
 *
 * Extracts urban drainage and collection systems directly from InfoWorks ICM database
 * tables (hw_node, hw_conduit, hw_subcatchment, hw_weir, hw_pump) into a native SwmmDeck AST.
 */

import type {
  SwmmConduit,
  SwmmCrossSection,
  SwmmDeck,
  SwmmJunction,
  SwmmOrifice,
  SwmmOutfall,
  SwmmPump,
  SwmmRange,
  SwmmSubcatchment,
  SwmmWeir,
} from "../types.js";

interface SqliteDatabaseSyncInstance {
  prepare(sql: string): { all(): Array<Record<string, unknown>> };
  close(): void;
}

interface SqliteSyncModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => SqliteDatabaseSyncInstance;
}

interface ProcessWithBuiltinModule {
  getBuiltinModule?: (id: string) => unknown;
}

function getSqliteSync(): SqliteSyncModule {
  if (typeof process !== "undefined") {
    const proc = process as unknown as ProcessWithBuiltinModule;
    if (typeof proc.getBuiltinModule === "function") {
      const sqlite = proc.getBuiltinModule("node:sqlite") as SqliteSyncModule | undefined;
      if (sqlite?.DatabaseSync) return sqlite;
      const nm = proc.getBuiltinModule("node:module") as
        | { createRequire?: (url: string) => (id: string) => SqliteSyncModule }
        | undefined;
      if (nm?.createRequire) {
        return nm.createRequire(import.meta.url)("node:sqlite");
      }
    }
  }
  throw new Error("Reading an SQLite database from a file path is not supported in browser environments.");
}

export type InfoWorksTableRows = Record<string, Array<Record<string, unknown>>>;

const DUMMY_SWMM_RANGE: SwmmRange = {
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

function findTable(tables: InfoWorksTableRows, candidates: string[]): Array<Record<string, unknown>> {
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
 * Parses InfoWorks ICM tables into a strongly typed SwmmDeck AST.
 */
export function parseInfoWorksDatabase(input: string | InfoWorksTableRows): SwmmDeck {
  let tableData: InfoWorksTableRows = {};

  if (typeof input === "string") {
    try {
      const sqliteModule = getSqliteSync();
      const db = new sqliteModule.DatabaseSync(input, { readOnly: true });

      const tableListQuery = db.prepare("SELECT name FROM sqlite_master WHERE type='table';");
      const tableRows = tableListQuery.all() as Array<{ name: string }>;

      for (const tRow of tableRows) {
        try {
          const rows = db.prepare(`SELECT * FROM "${tRow.name}"`).all();
          tableData[tRow.name] = rows as Array<Record<string, unknown>>;
        } catch {
          // Skip unreadable tables
        }
      }
      db.close();
    } catch (err: unknown) {
      throw new Error(
        `Failed to read InfoWorks SQLite file '${input}': ${err instanceof Error ? err.message : String(err)}`,
        {
          cause: err,
        },
      );
    }
  } else {
    tableData = input;
  }

  const deck: SwmmDeck = {
    title: "Converted from Innovyze / Autodesk InfoWorks ICM",
    flowUnits: "CMS",
    routingModel: "DYNWAVE",
    options: {
      INFILTRATION: "HORTON",
      FLOW_ROUTING: "DYNWAVE",
      MIN_SLOPE: 0.0001,
      ALLOW_PONDING: "YES",
    },
    junctions: new Map(),
    outfalls: new Map(),
    storage: new Map(),
    conduits: new Map(),
    pumps: new Map(),
    orifices: new Map(),
    weirs: new Map(),
    crossSections: new Map(),
    subcatchments: new Map(),
  };

  // 1. Nodes (hw_node / node / cng_node / manhole)
  const nodeRows = findTable(tableData, ["hw_node", "node", "cng_node", "manhole", "hw_manhole"]);
  for (let i = 0; i < nodeRows.length; i++) {
    const row = normalizeRow(nodeRows[i]!);
    const id = String(getVal(row, "node_id", "id", "node") ?? `N_${i + 1}`);
    const nodeType = String(getVal(row, "node_type", "type") ?? "MANHOLE").toUpperCase();

    const chamberFloor = Number(getVal(row, "chamber_floor", "invert", "elev") ?? 10.0);
    const groundLevel = Number(getVal(row, "ground_level", "cover_level", "rim") ?? chamberFloor + 2.0);
    const maxDepth = Math.max(0.5, groundLevel - chamberFloor);
    const isOutfall = Boolean(getVal(row, "is_outfall"));

    if (nodeType.includes("OUTFALL") || nodeType.includes("DISCHARGE") || isOutfall) {
      const outfall: SwmmOutfall = {
        id,
        elevation: chamberFloor,
        type: "FREE",
        range: DUMMY_SWMM_RANGE,
      };
      deck.outfalls.set(id, outfall);
    } else {
      const initDepthVal = getVal(row, "init_depth");
      const floodAreaVal = getVal(row, "flood_area");
      const junc: SwmmJunction = {
        id,
        elevation: chamberFloor,
        maxDepth,
        initDepth: initDepthVal ? Number(initDepthVal) : 0.0,
        aPond: floodAreaVal ? Number(floodAreaVal) : undefined,
        range: DUMMY_SWMM_RANGE,
      };
      deck.junctions.set(id, junc);
    }
  }

  // 2. Conduits & Pipes (hw_conduit / conduit / cng_conduit / pipe)
  const conduitRows = findTable(tableData, ["hw_conduit", "conduit", "cng_conduit", "pipe", "hw_pipe"]);
  for (let i = 0; i < conduitRows.length; i++) {
    const row = normalizeRow(conduitRows[i]!);
    const id = String(getVal(row, "conduit_id", "id") ?? `C_${i + 1}`);
    const n1 = String(getVal(row, "us_node_id", "from_node", "node1") ?? "N_1");
    const n2 = String(getVal(row, "ds_node_id", "to_node", "node2") ?? "N_2");
    const len = Number(getVal(row, "length", "conduit_length") ?? 50.0);
    const roughness = Number(getVal(row, "roughness", "mannings_n", "n") ?? 0.013);

    const conduit: SwmmConduit = {
      id,
      inletNode: n1,
      outletNode: n2,
      length: Number.isFinite(len) && len > 0 ? len : 50.0,
      roughness: Number.isFinite(roughness) && roughness > 0 ? roughness : 0.013,
      range: DUMMY_SWMM_RANGE,
    };
    deck.conduits.set(id, conduit);

    // Cross-Section
    const rawShape = String(getVal(row, "shape", "conduit_shape") ?? "CIRCULAR").toUpperCase();
    const width = Number(getVal(row, "conduit_width", "width", "diameter") ?? 0.45);
    const height = Number(getVal(row, "conduit_height", "height") ?? width);

    const isRect = rawShape.includes("RECT") || rawShape.includes("BOX");
    const xsec: SwmmCrossSection = {
      linkId: id,
      shape: isRect ? "RECT_CLOSED" : "CIRCULAR",
      geom1: height,
      geom2: isRect ? width : undefined,
      range: DUMMY_SWMM_RANGE,
    };
    deck.crossSections.set(id, xsec);
  }

  // 3. Subcatchments (hw_subcatchment / subcatchment / catchment)
  const subRows = findTable(tableData, ["hw_subcatchment", "subcatchment", "catchment", "hw_catchment"]);
  for (let i = 0; i < subRows.length; i++) {
    const row = normalizeRow(subRows[i]!);
    const id = String(getVal(row, "subcatchment_id", "id") ?? `SC_${i + 1}`);
    const outlet = String(getVal(row, "outlet_node_id", "node_id", "outlet") ?? "N_1");
    const totalAreaHa = Number(getVal(row, "total_area", "area") ?? 1.0);
    const impervPct = Number(getVal(row, "impervious_percent", "imperv") ?? 50.0);
    const width = Number(getVal(row, "catchment_width", "width") ?? 100.0);
    const slope = Number(getVal(row, "catchment_slope", "slope") ?? 1.0);

    const sc: SwmmSubcatchment = {
      id,
      outlet,
      area: Number.isFinite(totalAreaHa) && totalAreaHa > 0 ? totalAreaHa : 1.0,
      impervPct: Math.max(0.0, Math.min(100.0, impervPct)),
      width: Number.isFinite(width) && width > 0 ? width : 100.0,
      slopePct: Number.isFinite(slope) && slope > 0 ? slope : 1.0,
      nImperv: 0.013,
      nPerv: 0.15,
      dstoreImperv: 1.5,
      dstorePerv: 5.0,
      range: DUMMY_SWMM_RANGE,
    };
    deck.subcatchments.set(id, sc);
  }

  // 4. Pumps (hw_pump / pump)
  const pumpRows = findTable(tableData, ["hw_pump", "pump"]);
  for (let i = 0; i < pumpRows.length; i++) {
    const row = normalizeRow(pumpRows[i]!);
    const id = String(getVal(row, "pump_id", "id") ?? `PU_${i + 1}`);
    const n1 = String(getVal(row, "us_node_id", "node1") ?? "N_1");
    const n2 = String(getVal(row, "ds_node_id", "node2") ?? "N_2");

    const pump: SwmmPump = {
      id,
      inletNode: n1,
      outletNode: n2,
      initStatus: "ON",
      range: DUMMY_SWMM_RANGE,
    };
    deck.pumps.set(id, pump);
  }

  // 5. Weirs (hw_weir / weir)
  const weirRows = findTable(tableData, ["hw_weir", "weir"]);
  for (let i = 0; i < weirRows.length; i++) {
    const row = normalizeRow(weirRows[i]!);
    const id = String(getVal(row, "weir_id", "id") ?? `W_${i + 1}`);
    const n1 = String(getVal(row, "us_node_id", "node1") ?? "N_1");
    const n2 = String(getVal(row, "ds_node_id", "node2") ?? "N_2");
    const offset = Number(getVal(row, "crest", "crest_elevation") ?? 0.0);
    const cd = Number(getVal(row, "discharge_coeff") ?? 0.6);

    const weir: SwmmWeir = {
      id,
      inletNode: n1,
      outletNode: n2,
      type: "TRANSVERSE",
      offset,
      dischargeCoeff: cd,
      range: DUMMY_SWMM_RANGE,
    };
    deck.weirs.set(id, weir);
  }

  // 6. Orifices (hw_orifice / orifice)
  const orificeRows = findTable(tableData, ["hw_orifice", "orifice"]);
  for (let i = 0; i < orificeRows.length; i++) {
    const row = normalizeRow(orificeRows[i]!);
    const id = String(getVal(row, "orifice_id", "id") ?? `OR_${i + 1}`);
    const n1 = String(getVal(row, "us_node_id", "node1") ?? "N_1");
    const n2 = String(getVal(row, "ds_node_id", "node2") ?? "N_2");
    const offset = Number(getVal(row, "crest") ?? 0.0);
    const cd = Number(getVal(row, "discharge_coeff") ?? 0.65);

    const orif: SwmmOrifice = {
      id,
      inletNode: n1,
      outletNode: n2,
      type: "SIDE",
      offset,
      dischargeCoeff: cd,
      range: DUMMY_SWMM_RANGE,
    };
    deck.orifices.set(id, orif);
  }

  return deck;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Declarative `table` CSV & JSON Data Binding (`read table` / `write table`).
 */

import fs from "node:fs";
import path from "node:path";
import { SetEvaluator, stringifyTuple } from "../instantiator/set-evaluator.js";
import { readSqliteTableRows, writeSqliteTableRows } from "./sqlite-handler.js";
import { readExcelTableRows, writeExcelTableRows } from "./excel-handler.js";
import type {
  AmplData,
  AmplModel,
  AmplSolverResult,
  AmplTableDecl,
  SetElement,
} from "../types.js";

export interface TableIoOptions {
  baseDir?: string | undefined;
  fileContent?: string | undefined;
  writeToDisk?: boolean | undefined;
}

export function createSuffixResolver(
  result?: AmplSolverResult | undefined,
): (targetName: string, suffix: string) => number | undefined {
  return (targetName: string, suffix: string): number | undefined => {
    if (!result) return undefined;
    const s = suffix.toLowerCase();

    // Check variable suffixes
    const vSuf = result.variableSuffixes?.[targetName];
    if (vSuf) {
      if (s === "val") return vSuf.val;
      if (s === "rc") return vSuf.rc;
      if (s === "lb") return vSuf.lb;
      if (s === "ub") return vSuf.ub;
      if (s === "init") return vSuf.init;
      if (s === "relax") return vSuf.relax;
    }
    if (s === "val" && targetName in result.variables) {
      return result.variables[targetName];
    }
    if (s === "rc" && result.reducedCosts && targetName in result.reducedCosts) {
      return result.reducedCosts[targetName];
    }

    // Check constraint suffixes
    const cSuf = result.constraintSuffixes?.[targetName];
    if (cSuf) {
      if (s === "dual" || s === "val") return cSuf.dual;
      if (s === "slack") return cSuf.slack;
      if (s === "body") return cSuf.body;
      if (s === "lb") return cSuf.lb;
      if (s === "ub") return cSuf.ub;
    }
    if ((s === "dual" || s === "val") && result.duals && targetName in result.duals) {
      return result.duals[targetName];
    }
    if (s === "slack" && result.slacks && targetName in result.slacks) {
      return result.slacks[targetName];
    }

    // Check objective name
    if (targetName === result.problemName && s === "val") {
      return result.objectiveValue;
    }

    return undefined;
  };
}

/**
 * Parses CSV text into an array of row records keyed by column header.
 */
export function parseCsvRows(csvText: string): Record<string, string | number>[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) return [];

  const splitCsvLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"' || ch === "'") {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };

  const headers = splitCsvLine(lines[0]!);
  const rows: Record<string, string | number>[] = [];

  for (let r = 1; r < lines.length; r++) {
    const vals = splitCsvLine(lines[r]!);
    const rec: Record<string, string | number> = {};
    for (let c = 0; c < headers.length; c++) {
      const h = headers[c]!;
      const raw = vals[c] ?? "";
      const num = Number(raw);
      rec[h] = raw !== "" && Number.isFinite(num) && !Number.isNaN(num) ? num : raw;
    }
    rows.push(rec);
  }

  return rows;
}

/**
 * Executes `read table <Name>;`, loading set members and parameter values into `data`.
 */
export function readAmplTable(
  tableDecl: AmplTableDecl,
  data: AmplData,
  options?: TableIoOptions,
): void {
  if (tableDecl.mode === "OUT") {
    throw new Error(`Table '${tableDecl.name}' is declared as OUT only and cannot be read.`);
  }

  const driverUpper = tableDecl.driver.toUpperCase();
  const fileLower = tableDecl.filePath.toLowerCase();
  const isSqlite =
    driverUpper === "SQLITE" ||
    fileLower.endsWith(".db") ||
    fileLower.endsWith(".sqlite") ||
    fileLower.endsWith(".sqlite3");
  const isExcel =
    driverUpper === "EXCEL" ||
    driverUpper === "AMPLXL" ||
    fileLower.endsWith(".xlsx") ||
    fileLower.endsWith(".xls");
  const isJson = driverUpper === "JSON" || fileLower.endsWith(".json");

  let rows: Record<string, string | number>[];
  if (isSqlite) {
    rows = readSqliteTableRows(tableDecl.filePath, tableDecl.name, options?.baseDir);
  } else if (isExcel) {
    rows = readExcelTableRows(tableDecl.filePath, options?.baseDir);
  } else {
    let rawText = options?.fileContent;
    if (rawText === undefined) {
      const resolvedPath = options?.baseDir
        ? path.resolve(options.baseDir, tableDecl.filePath)
        : path.resolve(tableDecl.filePath);
      rawText = fs.readFileSync(resolvedPath, "utf-8");
    }
    rows = isJson
      ? (JSON.parse(rawText) as Record<string, string | number>[])
      : parseCsvRows(rawText);
  }

  const setMembers: SetElement[] = [];

  for (const row of rows) {
    const keyParts: (string | number)[] = [];
    for (const kCol of tableDecl.keyColumns) {
      const v = row[kCol] ?? Object.values(row)[0] ?? "";
      keyParts.push(v);
    }
    const tupleElem: SetElement = keyParts.length === 1 ? keyParts[0]! : keyParts;
    setMembers.push(tupleElem);
    const paramKey = stringifyTuple(tupleElem);

    for (const valCol of tableDecl.valueColumns) {
      const paramName =
        valCol.expr?.kind === "identifier"
          ? valCol.expr.name
          : valCol.expr?.kind === "subscript"
            ? valCol.expr.name
            : valCol.name;
      const csvHeader = valCol.alias ?? valCol.name;
      const cellVal = row[csvHeader] ?? row[paramName];
      if (cellVal !== undefined) {
        let pMap = data.params.get(paramName);
        if (!pMap) {
          pMap = new Map();
          data.params.set(paramName, pMap);
        }
        pMap.set(paramKey, cellVal);
      }
    }
  }

  const targetSetName =
    tableDecl.setName ??
    (tableDecl.keyColumns.length === 1 ? tableDecl.keyColumns[0] : undefined);
  if (targetSetName) {
    data.sets.set(targetSetName, setMembers);
  }
}

/**
 * Executes `write table <Name>;`, evaluating parameter and variable/constraint suffix columns
 * and serializing to CSV or JSON.
 */
export function writeAmplTable(
  tableDecl: AmplTableDecl,
  model: AmplModel,
  data: AmplData,
  result?: AmplSolverResult | undefined,
  options?: TableIoOptions,
): { content: string; rows: Record<string, string | number>[] } {
  if (tableDecl.mode === "IN") {
    throw new Error(`Table '${tableDecl.name}' is declared as IN only and cannot be written.`);
  }

  const setEval = new SetEvaluator(model, data, createSuffixResolver(result));

  // Determine the domain set to iterate over
  let setName = tableDecl.setName;
  if (!setName && tableDecl.keyColumns.length === 1) {
    const candidate = tableDecl.keyColumns[0]!;
    if (model.sets.has(candidate) || data.sets.has(candidate)) {
      setName = candidate;
    }
  }
  if (!setName) {
    const firstSet = model.sets.keys().next().value ?? data.sets.keys().next().value;
    setName = firstSet;
  }

  const members = setName ? setEval.getSet(setName) : [];
  const keyHeaders =
    tableDecl.keyColumns.length > 0 ? tableDecl.keyColumns : [setName ?? "index"];
  const valHeaders = tableDecl.valueColumns.map((c) => c.alias ?? c.name);
  const allHeaders = [...keyHeaders, ...valHeaders];

  const rows: Record<string, string | number>[] = [];

  for (const member of members) {
    const env = new Map<string, SetElement>();
    const memberArr = Array.isArray(member) ? member : [member];
    const rowObj: Record<string, string | number> = {};

    for (let k = 0; k < keyHeaders.length; k++) {
      const kName = keyHeaders[k]!;
      const mVal = memberArr[k] ?? memberArr[0]!;
      env.set(kName, mVal);
      rowObj[kName] = mVal;
    }

    for (let c = 0; c < tableDecl.valueColumns.length; c++) {
      const colSpec = tableDecl.valueColumns[c]!;
      const header = valHeaders[c]!;
      let val: string | number = 0;

      if (colSpec.expr) {
        if (colSpec.expr.kind === "identifier" && !colSpec.expr.name.includes("[")) {
          // If it's a bare identifier over a 1D or n-D set, check if it's an indexed var/param
          const base = colSpec.expr.name;
          const subscriptName = `${base}[${stringifyTuple(member)}]`;
          const sufResolver = createSuffixResolver(result);
          const maybeVar = sufResolver(subscriptName, "val");
          if (maybeVar !== undefined) {
            val = maybeVar;
          } else if (data.params.get(base)?.has(stringifyTuple(member))) {
            val = data.params.get(base)!.get(stringifyTuple(member))!;
          } else {
            val = setEval.evalValue(colSpec.expr, env);
          }
        } else if (
          colSpec.expr.kind === "suffix" &&
          colSpec.expr.target.kind === "identifier"
        ) {
          const base = colSpec.expr.target.name;
          const subscriptName = `${base}[${stringifyTuple(member)}]`;
          const sufResolver = createSuffixResolver(result);
          val =
            sufResolver(subscriptName, colSpec.expr.suffix) ??
            sufResolver(base, colSpec.expr.suffix) ??
            0;
        } else {
          val = setEval.evalValue(colSpec.expr, env);
        }
      }
      rowObj[header] = val;
    }

    rows.push(rowObj);
  }

  const driverUpper = tableDecl.driver.toUpperCase();
  const fileLower = tableDecl.filePath.toLowerCase();
  const isSqlite =
    driverUpper === "SQLITE" ||
    fileLower.endsWith(".db") ||
    fileLower.endsWith(".sqlite") ||
    fileLower.endsWith(".sqlite3");
  const isExcel =
    driverUpper === "EXCEL" ||
    driverUpper === "AMPLXL" ||
    fileLower.endsWith(".xlsx") ||
    fileLower.endsWith(".xls");
  const isJson = driverUpper === "JSON" || fileLower.endsWith(".json");

  let content: string;
  if (isSqlite) {
    writeSqliteTableRows(tableDecl.filePath, tableDecl.name, rows, options?.baseDir);
    content = `[SQLite Table: ${tableDecl.name}, ${rows.length} rows]`;
  } else if (isExcel) {
    writeExcelTableRows(tableDecl.filePath, rows, options?.baseDir);
    content = `[Excel Table: ${tableDecl.name}, ${rows.length} rows]`;
  } else if (isJson) {
    content = JSON.stringify(rows, null, 2) + "\n";
    if (options?.writeToDisk !== false && options?.baseDir !== undefined) {
      const outPath = path.resolve(options.baseDir, tableDecl.filePath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, content, "utf-8");
    }
  } else {
    const lines: string[] = [allHeaders.join(",")];
    for (const r of rows) {
      lines.push(allHeaders.map((h) => String(r[h] ?? "")).join(","));
    }
    content = lines.join("\n") + "\n";
    if (options?.writeToDisk !== false && options?.baseDir !== undefined) {
      const outPath = path.resolve(options.baseDir, tableDecl.filePath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, content, "utf-8");
    }
  }

  return { content, rows };
}

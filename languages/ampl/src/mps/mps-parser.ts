// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — MPS (Mathematical Programming System) Format Parser.
 *
 * Ingests standard Free and Fixed MPS files into flat InstantiatedProblem representations
 * for solving via CLP, CBC, IPOPT, Couenne, or lowering to WebAssembly DAE arenas.
 */

import type {
  AmplObjectiveDirection,
  AmplVarType,
  FlatAffineTerm,
  InstantiatedConstraint,
  InstantiatedObjective,
  InstantiatedProblem,
  InstantiatedVar,
  ProblemClass,
} from "../types.js";

export interface MpsParseOptions {
  /** Override the problem name if not present in NAME card. */
  defaultName?: string | undefined;
}

interface RawRow {
  name: string;
  type: "N" | "L" | "G" | "E";
  rhs: number;
  range?: number | undefined;
}

interface RawColTerm {
  rowName: string;
  coeff: number;
}

export function parseMpsProblem(mpsText: string, options?: MpsParseOptions): InstantiatedProblem {
  const lines = mpsText.split(/\r?\n/);

  let problemName = options?.defaultName || "MPS_MODEL";
  let objSense: AmplObjectiveDirection = "minimize";
  let objRowName: string | undefined;

  let currentSection = "";

  const rowsMap = new Map<string, RawRow>();
  const rowsList: string[] = [];

  const colTermsMap = new Map<string, RawColTerm[]>();
  const colOrder: string[] = [];
  const colTypeMap = new Map<string, AmplVarType>();
  const colBoundsMap = new Map<
    string,
    { lb?: number | undefined; ub?: number | undefined; isFixed?: boolean; isFree?: boolean }
  >();

  let inIntegerBlock = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    // Skip comments
    if (rawLine.startsWith("*")) continue;

    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Check for top-level section header (starts at col 0, or is known section keyword)
    const firstWord = trimmed.split(/\s+/)[0]!.toUpperCase();

    if (
      firstWord === "NAME" ||
      firstWord === "OBJSENSE" ||
      firstWord === "ROWS" ||
      firstWord === "COLUMNS" ||
      firstWord === "RHS" ||
      firstWord === "RANGES" ||
      firstWord === "BOUNDS" ||
      firstWord === "ENDATA"
    ) {
      if (firstWord === "NAME") {
        const parts = trimmed.split(/\s+/);
        if (parts.length > 1) {
          problemName = parts[1]!;
        }
        currentSection = "NAME";
        continue;
      }

      if (firstWord === "OBJSENSE") {
        const parts = trimmed.split(/\s+/);
        if (parts.length > 1) {
          const sense = parts[1]!.toUpperCase();
          if (sense === "MAX" || sense === "MAXIMIZE") objSense = "maximize";
          else objSense = "minimize";
        } else {
          // May be on next line
          currentSection = "OBJSENSE";
        }
        continue;
      }

      if (firstWord === "ENDATA") {
        break;
      }

      currentSection = firstWord;
      continue;
    }

    // Process line within section
    switch (currentSection) {
      case "OBJSENSE": {
        const sense = trimmed.toUpperCase();
        if (sense.startsWith("MAX")) objSense = "maximize";
        else objSense = "minimize";
        break;
      }

      case "ROWS": {
        const tokens = trimmed.split(/\s+/);
        if (tokens.length < 2) continue;
        const rowType = tokens[0]!.toUpperCase() as "N" | "L" | "G" | "E";
        const rowName = tokens[1]!;

        if (rowType === "N" && !objRowName) {
          objRowName = rowName;
        }

        rowsMap.set(rowName, {
          name: rowName,
          type: rowType,
          rhs: 0,
        });
        rowsList.push(rowName);
        break;
      }

      case "COLUMNS": {
        const tokens = trimmed.split(/\s+/);
        if (tokens.length < 3) continue;

        const colName = tokens[0]!;

        // Check for integer markers: col 'MARKER' 'INTORG' / 'INTEND'
        if (tokens.some((t) => t.includes("MARKER"))) {
          if (tokens.some((t) => t.includes("INTORG"))) {
            inIntegerBlock = true;
          } else if (tokens.some((t) => t.includes("INTEND"))) {
            inIntegerBlock = false;
          }
          continue;
        }

        if (!colTermsMap.has(colName)) {
          colTermsMap.set(colName, []);
          colOrder.push(colName);
          if (inIntegerBlock) {
            colTypeMap.set(colName, "integer");
          } else {
            colTypeMap.set(colName, "continuous");
          }
        }

        // Tokens: col row1 val1 [row2 val2]
        for (let i = 1; i + 1 < tokens.length; i += 2) {
          const rName = tokens[i]!;
          const val = Number.parseFloat(tokens[i + 1]!);
          if (!Number.isNaN(val)) {
            colTermsMap.get(colName)!.push({ rowName: rName, coeff: val });
          }
        }
        break;
      }

      case "RHS": {
        const tokens = trimmed.split(/\s+/);
        // Tokens can be: [rhs_name] row1 val1 [row2 val2]
        let startIdx = 0;
        if (tokens.length % 2 === 1) {
          startIdx = 1; // skip rhs vector name
        }

        for (let i = startIdx; i + 1 < tokens.length; i += 2) {
          const rName = tokens[i]!;
          const val = Number.parseFloat(tokens[i + 1]!);
          const row = rowsMap.get(rName);
          if (row && !Number.isNaN(val)) {
            row.rhs = val;
          }
        }
        break;
      }

      case "RANGES": {
        const tokens = trimmed.split(/\s+/);
        let startIdx = 0;
        if (tokens.length % 2 === 1) {
          startIdx = 1; // skip range vector name
        }

        for (let i = startIdx; i + 1 < tokens.length; i += 2) {
          const rName = tokens[i]!;
          const val = Number.parseFloat(tokens[i + 1]!);
          const row = rowsMap.get(rName);
          if (row && !Number.isNaN(val)) {
            row.range = val;
          }
        }
        break;
      }

      case "BOUNDS": {
        const tokens = trimmed.split(/\s+/);
        if (tokens.length < 2) continue;

        const boundType = tokens[0]!.toUpperCase();
        const hasNoVal = boundType === "BV" || boundType === "FR" || boundType === "MI" || boundType === "PL";

        let colName: string;
        let val: number | undefined;

        if (hasNoVal) {
          // e.g. "BV BND1 X1" (3 tokens) or "BV X1" (2 tokens)
          if (tokens.length >= 3) {
            colName = tokens[2]!;
          } else {
            colName = tokens[1]!;
          }
        } else {
          // e.g. "UP BND1 X1 10.0" (4 tokens) or "UP X1 10.0" (3 tokens)
          if (tokens.length >= 4) {
            colName = tokens[2]!;
            val = Number.parseFloat(tokens[3]!);
          } else {
            colName = tokens[1]!;
            val = Number.parseFloat(tokens[2]!);
          }
        }

        if (!colBoundsMap.has(colName)) {
          colBoundsMap.set(colName, {});
        }
        const b = colBoundsMap.get(colName)!;

        switch (boundType) {
          case "UP": // Upper bound
            if (!Number.isNaN(val)) b.ub = val;
            break;
          case "LO": // Lower bound
            if (!Number.isNaN(val)) b.lb = val;
            break;
          case "FX": // Fixed
            if (!Number.isNaN(val)) {
              b.lb = val;
              b.ub = val;
              b.isFixed = true;
            }
            break;
          case "FR": // Free: -inf to +inf
            b.lb = -Infinity;
            b.ub = Infinity;
            b.isFree = true;
            break;
          case "MI": // Minus infinity: -inf <= x <= 0
            b.lb = -Infinity;
            if (b.ub === undefined) b.ub = 0;
            break;
          case "PL": // Plus infinity: 0 <= x < +inf
            if (b.lb === undefined) b.lb = 0;
            b.ub = Infinity;
            break;
          case "BV": // Binary: 0 <= x <= 1, integer
            b.lb = 0;
            b.ub = 1;
            colTypeMap.set(colName, "binary");
            break;
          case "UI": // Upper-bounded integer
            colTypeMap.set(colName, "integer");
            if (!Number.isNaN(val)) b.ub = val;
            break;
          case "LI": // Lower-bounded integer
            colTypeMap.set(colName, "integer");
            if (!Number.isNaN(val)) b.lb = val;
            break;
        }
        break;
      }
    }
  }

  // ── Construct Variables ──
  const variables: InstantiatedVar[] = [];
  const varNameMap = new Map<string, number>();

  let hasDiscrete = false;

  for (let id = 0; id < colOrder.length; id++) {
    const name = colOrder[id]!;
    const type = colTypeMap.get(name) || "continuous";
    if (type === "integer" || type === "binary") hasDiscrete = true;

    const b = colBoundsMap.get(name) || {};
    let lb = 0;
    let ub = Infinity;

    if (type === "binary") {
      lb = b.lb !== undefined ? b.lb : 0;
      ub = b.ub !== undefined ? b.ub : 1;
    } else if (b.isFree) {
      lb = -Infinity;
      ub = Infinity;
    } else if (b.isFixed) {
      lb = b.lb!;
      ub = b.ub!;
    } else {
      lb = b.lb !== undefined ? b.lb : 0;
      ub = b.ub !== undefined ? b.ub : Infinity;
    }

    variables.push({
      id,
      name,
      baseName: name,
      indices: [],
      type,
      lb,
      ub,
      initVal: Number.isFinite(lb) && lb > 0 ? lb : 0,
    });
    varNameMap.set(name, id);
  }

  // ── Construct Objective ──
  const objTerms: FlatAffineTerm[] = [];
  const activeObjRow = objRowName || (rowsList.find((r) => rowsMap.get(r)?.type === "N") ?? "OBJ");

  for (const [colName, terms] of colTermsMap.entries()) {
    const varId = varNameMap.get(colName);
    if (varId === undefined) continue;

    for (const t of terms) {
      if (t.rowName === activeObjRow) {
        objTerms.push({ varId, coeff: t.coeff });
      }
    }
  }

  const objective: InstantiatedObjective = {
    name: activeObjRow,
    direction: objSense,
    expr: {
      constant: 0,
      linearTerms: objTerms,
    },
  };

  // ── Construct Constraints ──
  // Invert colTermsMap: map rowName -> FlatAffineTerm[]
  const rowTermsMap = new Map<string, FlatAffineTerm[]>();
  for (const [colName, terms] of colTermsMap.entries()) {
    const varId = varNameMap.get(colName);
    if (varId === undefined) continue;

    for (const t of terms) {
      if (t.rowName === activeObjRow) continue; // skip objective
      if (!rowTermsMap.has(t.rowName)) {
        rowTermsMap.set(t.rowName, []);
      }
      rowTermsMap.get(t.rowName)!.push({ varId, coeff: t.coeff });
    }
  }

  const constraints: InstantiatedConstraint[] = [];
  let conId = 0;

  for (const rName of rowsList) {
    if (rName === activeObjRow) continue;
    const row = rowsMap.get(rName);
    if (!row || row.type === "N") continue;

    const terms = rowTermsMap.get(rName) || [];
    let lb = -Infinity;
    let ub = Infinity;

    const rhs = row.rhs;
    const range = row.range;

    if (row.type === "E") {
      if (range !== undefined && Math.abs(range) > 1e-12) {
        if (range > 0) {
          lb = rhs;
          ub = rhs + range;
        } else {
          lb = rhs + range;
          ub = rhs;
        }
      } else {
        lb = rhs;
        ub = rhs;
      }
    } else if (row.type === "L") {
      ub = rhs;
      if (range !== undefined && Math.abs(range) > 1e-12) {
        lb = rhs - Math.abs(range);
      }
    } else if (row.type === "G") {
      lb = rhs;
      if (range !== undefined && Math.abs(range) > 1e-12) {
        ub = rhs + Math.abs(range);
      }
    }

    constraints.push({
      id: conId++,
      name: rName,
      expr: {
        constant: 0,
        linearTerms: terms,
      },
      lb,
      ub,
    });
  }

  const problemClass: ProblemClass = hasDiscrete ? "MILP" : "LP";

  return {
    name: problemName,
    problemClass,
    variables,
    varNameMap,
    objective,
    constraints,
  };
}

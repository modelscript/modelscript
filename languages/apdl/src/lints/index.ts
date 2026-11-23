// SPDX-License-Identifier: AGPL-3.0-or-later

import { ApdlErrorCode } from "../errors.js";
import { parseApdl } from "../parser/deck-parser.js";
import { evaluateApdlExpression } from "../solver/macro-expander.js";
import type { ApdlDiagnostic, ApdlParsedDeck, ApdlProcessor } from "../types.js";

const BUILTIN_FUNCTIONS_AND_CONSTS = new Set([
  "PI",
  "SIN",
  "COS",
  "TAN",
  "ASIN",
  "ACOS",
  "ATAN",
  "ATAN2",
  "SQRT",
  "ABS",
  "EXP",
  "LOG",
  "LOG10",
  "NINT",
  "INT",
  "MOD",
  "SIGN",
  "MIN",
  "MAX",
]);

const APDL_KEYWORDS = new Set([
  "ALL",
  "UX",
  "UY",
  "UZ",
  "ROTX",
  "ROTY",
  "ROTZ",
  "FX",
  "FY",
  "FZ",
  "MX",
  "MY",
  "MZ",
  "EX",
  "EY",
  "EZ",
  "PRXY",
  "PRYZ",
  "PRXZ",
  "NUXY",
  "DENS",
  "GXY",
  "ALPX",
  "STATIC",
  "MODAL",
  "BUCKLE",
  "HARMIC",
  "TRANS",
  "SUBSTR",
  "BEAM",
  "SHELL",
  "LINK",
  "RECT",
  "CSOLID",
  "CTUBE",
  "ASEC",
  "I",
  "PRES",
  "CONV",
  "HFLUX",
  "LANB",
  "SUBSP",
  "SI",
  "MPA",
  "BIN",
  "BFT",
  "CGS",
  "ARRAY",
  "TABLE",
  "CHAR",
  "THEN",
  "EQ",
  "NE",
  "LT",
  "GT",
  "LE",
  "GE",
  "ABLT",
  "ABGT",
  "LINK180",
  "LINK8",
  "BEAM188",
  "BEAM189",
  "BEAM3",
  "BEAM4",
  "PLANE182",
  "PLANE183",
  "PLANE42",
  "SHELL181",
  "SHELL63",
  "SOLID185",
  "SOLID186",
  "SOLID187",
  "SOLID45",
  "MASS21",
  "COMBIN14",
  "NODE",
  "ELEM",
  "KP",
  "COUNT",
  "NUM",
  "MAX",
  "MIN",
  "LOC",
  "X",
  "Y",
  "Z",
]);

const PREP7_COMMANDS = new Set([
  "ET",
  "KEYOPT",
  "MP",
  "R",
  "SECTYPE",
  "SECDATA",
  "K",
  "L",
  "A",
  "V",
  "N",
  "E",
  "TYPE",
  "MAT",
  "REAL",
  "SECNUM",
  "ESIZE",
  "LESIZE",
  "LMESH",
  "AMESH",
  "VMESH",
]);

const SOLU_COMMANDS = new Set(["ANTYPE", "SOLVE", "MODOPT", "MXPAND", "NLGEOM", "OUTRES", "NSUBST", "TIME"]);

const POST1_COMMANDS = new Set(["PLNSOL", "PRNSOL", "PLESOL", "PRESOL", "SET", "PRRSOL"]);

/**
 * Extracts identifier tokens from an arithmetic expression string.
 */
function extractIdentifiers(expr: string): string[] {
  const withoutStrings = expr.replace(/'[^']*'|"[^"]*"/g, " ");
  // Avoid matching scientific notation exponents like 210e9 or 1.5E-3
  const withoutSci = withoutStrings.replace(/(?:\d+(?:\.\d*)?|\.\d+)[eEdD][+-]?\d+/g, " 0 ");
  const ids: string[] = [];
  const re = /\b([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutSci)) !== null) {
    ids.push(m[1]!.toUpperCase());
  }
  return ids;
}

/**
 * Runs all APDL semantic, structural, material, and processor-context lint rules (`APDL1001`–`APDL5006`).
 */
export function lintApdl(sourceOrDeck: string | ApdlParsedDeck): ApdlDiagnostic[] {
  const deck = typeof sourceOrDeck === "string" ? parseApdl(sourceOrDeck) : sourceOrDeck;
  const diags: ApdlDiagnostic[] = [];

  const push = (
    def: { code: number; id: string; rule: string; severity: "error" | "warning" | "info" },
    message: string,
    line: number,
    column: number,
  ): void => {
    diags.push({
      code: def.id,
      numericCode: def.code,
      rule: def.rule,
      severity: def.severity,
      message,
      line,
      column,
    });
  };

  // 1. APDL1001: Syntax errors
  for (const err of deck.syntaxErrors) {
    push(ApdlErrorCode.SYNTAX_ERROR, ApdlErrorCode.SYNTAX_ERROR.message(err.message), err.line, err.column);
  }

  // Track control-flow stacks, parameters, entities, and processor state
  const doStack: Array<{ variable: string; line: number; column: number }> = [];
  const ifStack: Array<{ line: number; column: number; hasElse: boolean }> = [];

  const definedParams = new Set<string>();
  const paramValues = new Map<string, number>();
  const definedEt = new Set<number>();
  const definedMat = new Set<number>();
  const definedNodes = new Set<number>();
  let hasMeshedLines = false;
  let elemCount = 0;
  let hasConstraint = false;
  let activeType = 1;
  let activeMat = 1;
  let currentProc: ApdlProcessor = "BEGIN";

  const checkUndefinedParams = (expr: string, line: number, column: number): void => {
    if (!expr.trim()) return;
    for (const id of extractIdentifiers(expr)) {
      if (!definedParams.has(id) && !BUILTIN_FUNCTIONS_AND_CONSTS.has(id) && !APDL_KEYWORDS.has(id)) {
        push(ApdlErrorCode.UNDEFINED_PARAMETER, ApdlErrorCode.UNDEFINED_PARAMETER.message(id), line, column);
      }
    }
  };

  const tryEval = (expr: string | undefined): number | undefined => {
    if (!expr || !expr.trim()) return undefined;
    const ids = extractIdentifiers(expr);
    for (const id of ids) {
      if (!paramValues.has(id) && !BUILTIN_FUNCTIONS_AND_CONSTS.has(id)) {
        return undefined;
      }
    }
    const v = evaluateApdlExpression(expr, paramValues);
    return Number.isFinite(v) ? v : undefined;
  };

  for (const stmt of deck.statements) {
    switch (stmt.kind) {
      case "processor":
        currentProc = stmt.processor;
        break;

      case "set": {
        checkUndefinedParams(stmt.expr, stmt.line, stmt.column);
        if (stmt.indexExpr) checkUndefinedParams(stmt.indexExpr, stmt.line, stmt.column);
        definedParams.add(stmt.name);
        const val = tryEval(stmt.expr);
        if (val !== undefined && !stmt.indexExpr) {
          paramValues.set(stmt.name, val);
        }
        break;
      }

      case "dim": {
        checkUndefinedParams(stmt.imax, stmt.line, stmt.column);
        definedParams.add(stmt.name);
        break;
      }

      case "get": {
        definedParams.add(stmt.param);
        break;
      }

      case "do_start": {
        checkUndefinedParams(stmt.startExpr, stmt.line, stmt.column);
        checkUndefinedParams(stmt.endExpr, stmt.line, stmt.column);
        checkUndefinedParams(stmt.incExpr, stmt.line, stmt.column);
        definedParams.add(stmt.variable);
        const sVal = tryEval(stmt.startExpr);
        const eVal = tryEval(stmt.endExpr);
        const incVal = tryEval(stmt.incExpr);
        if (sVal !== undefined) paramValues.set(stmt.variable, sVal);
        if (incVal !== undefined && incVal === 0) {
          push(
            ApdlErrorCode.EMPTY_DO_LOOP,
            ApdlErrorCode.EMPTY_DO_LOOP.message(stmt.variable, "increment cannot be zero"),
            stmt.line,
            stmt.column,
          );
        } else if (sVal !== undefined && eVal !== undefined && incVal !== undefined) {
          if ((incVal > 0 && sVal > eVal) || (incVal < 0 && sVal < eVal)) {
            push(
              ApdlErrorCode.EMPTY_DO_LOOP,
              ApdlErrorCode.EMPTY_DO_LOOP.message(stmt.variable, "loop bounds produce zero iterations"),
              stmt.line,
              stmt.column,
            );
          }
        }
        doStack.push({ variable: stmt.variable, line: stmt.line, column: stmt.column });
        break;
      }

      case "enddo": {
        if (doStack.length === 0) {
          push(
            ApdlErrorCode.UNMATCHED_DO,
            ApdlErrorCode.UNMATCHED_DO.message("'*ENDDO' without matching '*DO'"),
            stmt.line,
            stmt.column,
          );
        } else {
          doStack.pop();
        }
        break;
      }

      case "if_start": {
        checkUndefinedParams(stmt.lhsExpr, stmt.line, stmt.column);
        checkUndefinedParams(stmt.rhsExpr, stmt.line, stmt.column);
        if (stmt.action === "THEN") {
          ifStack.push({ line: stmt.line, column: stmt.column, hasElse: false });
        }
        break;
      }

      case "elseif": {
        checkUndefinedParams(stmt.lhsExpr, stmt.line, stmt.column);
        checkUndefinedParams(stmt.rhsExpr, stmt.line, stmt.column);
        if (ifStack.length === 0) {
          push(
            ApdlErrorCode.UNMATCHED_IF,
            ApdlErrorCode.UNMATCHED_IF.message("'*ELSEIF' without matching '*IF'"),
            stmt.line,
            stmt.column,
          );
        }
        break;
      }

      case "else": {
        if (ifStack.length === 0) {
          push(
            ApdlErrorCode.UNMATCHED_IF,
            ApdlErrorCode.UNMATCHED_IF.message("'*ELSE' without matching '*IF'"),
            stmt.line,
            stmt.column,
          );
        } else {
          const top = ifStack[ifStack.length - 1]!;
          if (top.hasElse) {
            push(
              ApdlErrorCode.UNMATCHED_IF,
              ApdlErrorCode.UNMATCHED_IF.message("duplicate '*ELSE' in '*IF' block"),
              stmt.line,
              stmt.column,
            );
          }
          top.hasElse = true;
        }
        break;
      }

      case "endif": {
        if (ifStack.length === 0) {
          push(
            ApdlErrorCode.UNMATCHED_IF,
            ApdlErrorCode.UNMATCHED_IF.message("'*ENDIF' without matching '*IF'"),
            stmt.line,
            stmt.column,
          );
        } else {
          ifStack.pop();
        }
        break;
      }

      case "command": {
        const cmd = stmt.command;
        const args = stmt.args;

        // Processor context checks (APDL5001 - APDL5003)
        if (PREP7_COMMANDS.has(cmd) && currentProc !== "PREP7") {
          push(
            ApdlErrorCode.WRONG_PROCESSOR_PREP7,
            ApdlErrorCode.WRONG_PROCESSOR_PREP7.message(cmd, currentProc),
            stmt.line,
            stmt.column,
          );
        } else if (SOLU_COMMANDS.has(cmd) && currentProc !== "SOLU") {
          push(
            ApdlErrorCode.WRONG_PROCESSOR_SOLU,
            ApdlErrorCode.WRONG_PROCESSOR_SOLU.message(cmd, currentProc),
            stmt.line,
            stmt.column,
          );
        } else if (POST1_COMMANDS.has(cmd) && currentProc !== "POST1") {
          push(
            ApdlErrorCode.WRONG_PROCESSOR_POST1,
            ApdlErrorCode.WRONG_PROCESSOR_POST1.message(cmd, currentProc),
            stmt.line,
            stmt.column,
          );
        }

        // Check numeric argument expressions for undefined parameters
        if (cmd === "MP") {
          if (args[1]) checkUndefinedParams(args[1], stmt.line, stmt.column);
          if (args[2]) checkUndefinedParams(args[2], stmt.line, stmt.column);
          const lab = (args[0] ?? "").toUpperCase();
          const matId = Math.round(tryEval(args[1]) ?? 1);
          definedMat.add(matId);
          const val = tryEval(args[2]);
          if (val !== undefined) {
            if (lab === "EX" && val <= 0) {
              push(
                ApdlErrorCode.INVALID_YOUNGS_MODULUS,
                ApdlErrorCode.INVALID_YOUNGS_MODULUS.message(String(matId), String(val)),
                stmt.line,
                stmt.column,
              );
            } else if ((lab === "PRXY" || lab === "NUXY") && (val <= -1 || val >= 0.5)) {
              push(
                ApdlErrorCode.INVALID_POISSONS_RATIO,
                ApdlErrorCode.INVALID_POISSONS_RATIO.message(String(matId), String(val)),
                stmt.line,
                stmt.column,
              );
            } else if (lab === "DENS" && val <= 0) {
              push(
                ApdlErrorCode.INVALID_DENSITY,
                ApdlErrorCode.INVALID_DENSITY.message(String(matId), String(val)),
                stmt.line,
                stmt.column,
              );
            }
          }
        } else if (cmd === "ET") {
          if (args[0]) checkUndefinedParams(args[0], stmt.line, stmt.column);
          const id = Math.round(tryEval(args[0]) ?? 1);
          definedEt.add(id);
        } else if (cmd === "TYPE") {
          if (args[0]) checkUndefinedParams(args[0], stmt.line, stmt.column);
          const id = Math.round(tryEval(args[0]) ?? 1);
          activeType = id;
          if (!definedEt.has(id)) {
            push(
              ApdlErrorCode.UNDEFINED_ELEMENT_TYPE,
              ApdlErrorCode.UNDEFINED_ELEMENT_TYPE.message(String(id)),
              stmt.line,
              stmt.column,
            );
          }
        } else if (cmd === "MAT") {
          if (args[0]) checkUndefinedParams(args[0], stmt.line, stmt.column);
          const id = Math.round(tryEval(args[0]) ?? 1);
          activeMat = id;
          if (!definedMat.has(id)) {
            push(
              ApdlErrorCode.UNDEFINED_MATERIAL,
              ApdlErrorCode.UNDEFINED_MATERIAL.message(String(id)),
              stmt.line,
              stmt.column,
            );
          }
        } else if (cmd === "N") {
          for (const a of args) checkUndefinedParams(a, stmt.line, stmt.column);
          const id = tryEval(args[0]);
          if (id !== undefined && doStack.length === 0) {
            const nid = Math.round(id);
            if (definedNodes.has(nid)) {
              push(
                ApdlErrorCode.DUPLICATE_NODE,
                ApdlErrorCode.DUPLICATE_NODE.message(String(nid)),
                stmt.line,
                stmt.column,
              );
            }
            definedNodes.add(nid);
          } else if (doStack.length > 0) {
            hasMeshedLines = true; // Nodes created dynamically inside *DO loop
          }
        } else if (cmd === "E") {
          elemCount++;
          for (const a of args) checkUndefinedParams(a, stmt.line, stmt.column);
          if (!definedEt.has(activeType)) {
            push(
              ApdlErrorCode.UNDEFINED_ELEMENT_TYPE,
              ApdlErrorCode.UNDEFINED_ELEMENT_TYPE.message(String(activeType)),
              stmt.line,
              stmt.column,
            );
          }
          if (!definedMat.has(activeMat)) {
            push(
              ApdlErrorCode.UNDEFINED_MATERIAL,
              ApdlErrorCode.UNDEFINED_MATERIAL.message(String(activeMat)),
              stmt.line,
              stmt.column,
            );
          }
          const nodeIds: number[] = [];
          for (const a of args) {
            if (!a) continue;
            const nid = tryEval(a);
            if (nid !== undefined) {
              const rounded = Math.round(nid);
              nodeIds.push(rounded);
              if (doStack.length === 0 && !hasMeshedLines && !definedNodes.has(rounded)) {
                push(
                  ApdlErrorCode.UNDEFINED_NODE,
                  ApdlErrorCode.UNDEFINED_NODE.message(String(rounded), String(elemCount)),
                  stmt.line,
                  stmt.column,
                );
              }
            }
          }
          if (nodeIds.length >= 2 && new Set(nodeIds).size < nodeIds.length) {
            push(
              ApdlErrorCode.DEGENERATE_ELEMENT,
              ApdlErrorCode.DEGENERATE_ELEMENT.message(String(elemCount), "contains duplicate node IDs"),
              stmt.line,
              stmt.column,
            );
          }
        } else if (cmd === "LMESH" || cmd === "AMESH" || cmd === "VMESH") {
          hasMeshedLines = true;
          elemCount++;
        } else if (cmd === "D" || cmd === "DK") {
          hasConstraint = true;
          if (args[0] && args[0].toUpperCase() !== "ALL") checkUndefinedParams(args[0], stmt.line, stmt.column);
          if (args[2]) checkUndefinedParams(args[2], stmt.line, stmt.column);
        } else if (cmd === "F" || cmd === "FK") {
          if (args[0] && args[0].toUpperCase() !== "ALL") checkUndefinedParams(args[0], stmt.line, stmt.column);
          if (args[2]) checkUndefinedParams(args[2], stmt.line, stmt.column);
        } else if (cmd === "K" || cmd === "R" || cmd === "SECDATA" || cmd === "ESIZE") {
          for (const a of args) checkUndefinedParams(a, stmt.line, stmt.column);
        } else if (cmd === "SOLVE") {
          if (!hasConstraint) {
            push(ApdlErrorCode.RIGID_BODY_MOTION, ApdlErrorCode.RIGID_BODY_MOTION.message(), stmt.line, stmt.column);
          }
          if (elemCount === 0) {
            push(
              ApdlErrorCode.NO_ELEMENTS_DEFINED,
              ApdlErrorCode.NO_ELEMENTS_DEFINED.message(),
              stmt.line,
              stmt.column,
            );
          }
        }
        break;
      }

      default:
        break;
    }
  }

  // Unclosed *DO / *IF blocks
  for (const unclosedDo of doStack) {
    push(
      ApdlErrorCode.UNMATCHED_DO,
      ApdlErrorCode.UNMATCHED_DO.message(`'*DO' for '${unclosedDo.variable}' is missing matching '*ENDDO'`),
      unclosedDo.line,
      unclosedDo.column,
    );
  }
  for (const unclosedIf of ifStack) {
    push(
      ApdlErrorCode.UNMATCHED_IF,
      ApdlErrorCode.UNMATCHED_IF.message("'*IF' block is missing matching '*ENDIF'"),
      unclosedIf.line,
      unclosedIf.column,
    );
  }

  return diags;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import { error, warning, type LintResult } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { ModelicaErrorCode } from "../errors.js";

interface VariableInfo {
  name: string;
  isInput: boolean;
  isOutput: boolean;
  hasDefault: boolean;
  startByte: number;
  endByte: number;
}

/**
 * Normalizes rule and node type names for case/underscore insensitive comparison.
 */
function normType(t: string): string {
  return (t || "").toLowerCase().replace(/_/g, "");
}

/**
 * Searches for all nodes matching a given type name.
 */
function findNodesByType(root: any, typeName: string): any[] {
  const results: any[] = [];
  const target = normType(typeName);

  function walk(node: any) {
    if (!node) return;
    if (normType(node.type) === target) {
      results.push(node);
    }
    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(root);
  return results;
}

/**
 * Computes set intersection between two Sets.
 */
function intersectSets<T>(a: Set<T>, b: Set<T>): Set<T> {
  const res = new Set<T>();
  for (const item of a) {
    if (b.has(item)) res.add(item);
  }
  return res;
}

interface ParsedStatement {
  kind: "assignment" | "if" | "return" | "break" | "other";
  targetVar?: string;
  valExpr?: string;
  condExpr?: string;
  rawText: string;
  startByte: number;
  endByte: number;
  thenStmts?: ParsedStatement[];
  elseStmts?: ParsedStatement[];
}

/**
 * Parses raw statement strings within an algorithm section.
 */
function parseStatementsFromText(algText: string, algStartByte: number): ParsedStatement[] {
  const statements: ParsedStatement[] = [];

  // Strip 'algorithm' or 'initial algorithm' keyword
  let body = algText;
  const algKwMatch = /^\s*(?:initial\s+)?algorithm\b/.exec(body);
  let offset = 0;
  if (algKwMatch) {
    offset = algKwMatch[0].length;
    body = body.slice(offset);
  }

  // Parse if statements and simple statements
  // Tokenize by statement boundaries taking into account nested 'if ... end if;'
  let i = 0;
  while (i < body.length) {
    // Skip whitespace
    while (i < body.length && /\s/.test(body[i]!)) i++;
    if (i >= body.length) break;

    const remaining = body.slice(i);

    // 1. If statement: if ... then ... [else ...] end if;
    if (/^if\b/.test(remaining)) {
      const ifStart = i;
      let depth = 1;
      let j = i + 2;
      while (j < body.length && depth > 0) {
        if (body.slice(j).startsWith("if") && /\bif\b/.test(body.slice(j, j + 3))) {
          depth++;
          j += 2;
        } else if (body.slice(j).startsWith("end if") && /\bend\s+if\b/.test(body.slice(j, j + 7))) {
          depth--;
          j += 6;
          if (depth === 0) {
            // Include trailing semicolon if present
            while (j < body.length && (body[j] === ";" || /\s/.test(body[j]!))) {
              if (body[j] === ";") {
                j++;
                break;
              }
              j++;
            }
            break;
          }
        } else {
          j++;
        }
      }

      const ifText = body.slice(ifStart, j);
      const startByte = algStartByte + offset + ifStart;
      const endByte = algStartByte + offset + j;

      // Extract then / else branches
      const thenMatch = /^if\b([\s\S]*?)\bthen\b([\s\S]*?)(?:\belse\b([\s\S]*?))?\bend\s+if/i.exec(ifText);
      const condExpr = thenMatch ? thenMatch[1] : "";
      const thenBody = thenMatch ? thenMatch[2] : "";
      const elseBody = thenMatch ? thenMatch[3] : undefined;

      const thenStmts = thenBody ? parseStatementsFromText(thenBody, startByte) : [];
      const elseStmts = elseBody !== undefined ? parseStatementsFromText(elseBody, startByte) : undefined;

      statements.push({
        kind: "if",
        condExpr,
        rawText: ifText,
        startByte,
        endByte,
        thenStmts,
        elseStmts,
      });

      i = j;
      continue;
    }

    // 2. Simple statement up to ';'
    const semiIdx = body.indexOf(";", i);
    if (semiIdx === -1) {
      break;
    }

    const stmtText = body.slice(i, semiIdx).trim();
    const startByte = algStartByte + offset + i;
    const endByte = algStartByte + offset + semiIdx + 1;

    if (stmtText === "return" || stmtText.startsWith("return ") || stmtText.startsWith("return(")) {
      statements.push({ kind: "return", rawText: stmtText, startByte, endByte });
    } else if (stmtText === "break") {
      statements.push({ kind: "break", rawText: stmtText, startByte, endByte });
    } else if (stmtText.includes(":=")) {
      const parts = stmtText.split(":=");
      const targetVar = parts[0]?.trim() || "";
      const valExpr = parts.slice(1).join(":=").trim();
      statements.push({
        kind: "assignment",
        targetVar,
        valExpr,
        rawText: stmtText,
        startByte,
        endByte,
      });
    } else {
      statements.push({
        kind: "other",
        rawText: stmtText,
        startByte,
        endByte,
      });
    }

    i = semiIdx + 1;
  }

  return statements;
}

/**
 * Control Flow Analysis (CFA) implementation for Modelica classes and functions.
 */
export function runModelicaCfaAnalysis(db: QueryDB, self: SymbolEntry, cst: any): LintResult[] {
  const results: LintResult[] = [];
  if (!cst) return results;

  const text: string = cst.text || "";
  const className: string = self.name || "Anonymous";

  // Check if class is a function
  const meta = (self.metadata as any) || (self as any).attributes || {};
  const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
  const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
  const words = cleanKind.split(/\s+/).filter(Boolean);
  let isFunction = words.includes("function");

  if (!isFunction && cst) {
    for (const child of cst.children || []) {
      if (child.type === "class_prefixes") {
        const childText = (child.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
        const childWords = childText.split(/\s+/).filter(Boolean);
        if (childWords.includes("function")) {
          isFunction = true;
          break;
        }
      }
    }
    if (!isFunction) {
      const trimmedText = (cst.text?.trim() ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
      if (/^(?:(?:encapsulated|partial|replaceable|pure|impure)\s+)*(?:operator\s+)?function\b/.test(trimmedText)) {
        isFunction = true;
      }
    }
  }

  if (!isFunction) return results;

  // 1. Extract variables (inputs, outputs, locals)
  const inputs = new Map<string, VariableInfo>();
  const outputs = new Map<string, VariableInfo>();
  const locals = new Map<string, VariableInfo>();

  const compClauses = findNodesByType(cst, "component_clause");
  for (const comp of compClauses) {
    const compText = comp.text || "";
    const isInput = /\binput\b/.test(compText);
    const isOutput = /\boutput\b/.test(compText);

    // Extract identifiers declared in this clause
    // e.g. input Real x; or output Real y, z = 1.0;
    const compStart = comp.startIndex ?? self.startByte;
    const declMatches = compText.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\[[^\]]*\])?(?:\s*=\s*([^,;]+))?/g);

    for (const match of declMatches) {
      const name = match[1];
      if (
        !name ||
        name === "Real" ||
        name === "Integer" ||
        name === "Boolean" ||
        name === "String" ||
        name === "input" ||
        name === "output" ||
        name === "parameter" ||
        name === "constant"
      ) {
        continue;
      }

      const hasDefault = match[2] !== undefined || compText.includes("=");
      const matchIdx = match.index ?? 0;
      const startByte = compStart + matchIdx;
      const endByte = startByte + name.length;

      const info: VariableInfo = {
        name,
        isInput,
        isOutput,
        hasDefault,
        startByte,
        endByte,
      };

      if (isInput) {
        inputs.set(name, info);
      } else if (isOutput) {
        outputs.set(name, info);
      } else {
        locals.set(name, info);
      }
    }
  }

  // 2. Find algorithm section(s)
  const algSections = findNodesByType(cst, "algorithm_section");

  if (isFunction && outputs.size > 0 && algSections.length === 0) {
    // If function has outputs but no algorithm section and not external -> unassigned outputs!
    if (!text.includes("external")) {
      for (const [outName, outInfo] of outputs) {
        results.push(
          error(ModelicaErrorCode.OUTPUT_NOT_DEFINITELY_ASSIGNED.message(outName, className), {
            startByte: outInfo.startByte,
            endByte: outInfo.endByte,
            code: ModelicaErrorCode.OUTPUT_NOT_DEFINITELY_ASSIGNED.code,
          }),
        );
      }
    }
    return results;
  }

  if (algSections.length === 0) return results;

  // Track assigned variables
  const initialAssigned = new Set<string>();
  for (const inName of inputs.keys()) initialAssigned.add(inName);
  for (const [outName, outInfo] of outputs) {
    if (outInfo.hasDefault) initialAssigned.add(outName);
  }
  for (const [locName, locInfo] of locals) {
    if (locInfo.hasDefault) initialAssigned.add(locName);
  }

  // Set of all local & output variables whose reads must be checked for uninitialized access
  const monitoredVars = new Set<string>();
  for (const [name, info] of outputs) {
    if (!info.hasDefault) monitoredVars.add(name);
  }
  for (const [name, info] of locals) {
    if (!info.hasDefault) monitoredVars.add(name);
  }

  // Helper to check uninitialized reads in an expression string
  const checkExprReads = (expr: string, exprStartByte: number, currentAssigned: Set<string>) => {
    const identRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = identRegex.exec(expr)) !== null) {
      const varName = m[1];
      if (monitoredVars.has(varName) && !currentAssigned.has(varName)) {
        const sByte = exprStartByte + m.index;
        const eByte = sByte + varName.length;
        results.push(
          error(ModelicaErrorCode.UNINITIALIZED_VARIABLE_READ.message(varName), {
            startByte: sByte,
            endByte: eByte,
            code: ModelicaErrorCode.UNINITIALIZED_VARIABLE_READ.code,
          }),
        );
      }
    }
  };

  // CFA traversal
  interface StmtAnalysis {
    assigned: Set<string>;
    alwaysReturns: boolean;
  }

  const analyzeStatements = (stmts: ParsedStatement[], inAssigned: Set<string>): StmtAnalysis => {
    let cur = new Set(inAssigned);
    let returned = false;

    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i]!;

      if (returned) {
        // M5022: Unreachable statement
        results.push(
          warning(ModelicaErrorCode.UNREACHABLE_STATEMENT.message(), {
            startByte: stmt.startByte,
            endByte: stmt.endByte,
            code: ModelicaErrorCode.UNREACHABLE_STATEMENT.code,
          }),
        );
        continue;
      }

      if (stmt.kind === "return") {
        // Check if all outputs are assigned at return point
        if (isFunction) {
          for (const [outName] of outputs) {
            if (!cur.has(outName)) {
              results.push(
                error(ModelicaErrorCode.OUTPUT_NOT_DEFINITELY_ASSIGNED.message(outName, className), {
                  startByte: stmt.startByte,
                  endByte: stmt.endByte,
                  code: ModelicaErrorCode.OUTPUT_NOT_DEFINITELY_ASSIGNED.code,
                }),
              );
            }
          }
        }
        returned = true;
      } else if (stmt.kind === "break") {
        returned = true;
      } else if (stmt.kind === "assignment") {
        // Check reads on RHS first
        if (stmt.valExpr) {
          checkExprReads(stmt.valExpr, stmt.startByte + (stmt.rawText.indexOf(":=") + 2), cur);
        }

        // Add LHS to assigned
        if (stmt.targetVar) {
          const baseIdent = stmt.targetVar.split("[")[0]?.trim() || stmt.targetVar.trim();
          cur.add(baseIdent);
        }
      } else if (stmt.kind === "if") {
        if (stmt.condExpr) {
          checkExprReads(stmt.condExpr, stmt.startByte + 2, cur);
        }

        const thenRes = stmt.thenStmts
          ? analyzeStatements(stmt.thenStmts, cur)
          : { assigned: cur, alwaysReturns: false };

        if (stmt.elseStmts !== undefined) {
          const elseRes = analyzeStatements(stmt.elseStmts, cur);

          if (thenRes.alwaysReturns && elseRes.alwaysReturns) {
            returned = true;
          } else if (thenRes.alwaysReturns) {
            cur = elseRes.assigned;
          } else if (elseRes.alwaysReturns) {
            cur = thenRes.assigned;
          } else {
            cur = intersectSets(thenRes.assigned, elseRes.assigned);
          }
        }
      } else {
        // Other statement
        checkExprReads(stmt.rawText, stmt.startByte, cur);
      }
    }

    return { assigned: cur, alwaysReturns: returned };
  };

  for (const alg of algSections) {
    const algText = alg.text || "";
    const algStart = alg.startIndex ?? self.startByte;
    const stmts = parseStatementsFromText(algText, algStart);
    const finalRes = analyzeStatements(stmts, initialAssigned);

    // At the end of function execution: check all outputs
    if (isFunction && !finalRes.alwaysReturns) {
      for (const [outName, outInfo] of outputs) {
        if (!finalRes.assigned.has(outName)) {
          results.push(
            error(ModelicaErrorCode.OUTPUT_NOT_DEFINITELY_ASSIGNED.message(outName, className), {
              startByte: outInfo.startByte,
              endByte: outInfo.endByte,
              code: ModelicaErrorCode.OUTPUT_NOT_DEFINITELY_ASSIGNED.code,
            }),
          );
        }
      }
    }
  }

  return results;
}

export const modelicaCfaLints: Record<string, any> = {};

// SPDX-License-Identifier: AGPL-3.0-or-later

import { error, warning, type LintResult } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { ModelicaErrorCode } from "../errors.js";

interface VariableInfo {
  name: string;
  isInput: boolean;
  isOutput: boolean;
  hasDefault: boolean;
  isArray?: boolean;
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

interface ParsedBranch {
  condExpr?: string;
  condStartByte?: number;
  stmts: ParsedStatement[];
}

interface ParsedStatement {
  kind: "assignment" | "if" | "for" | "while" | "when" | "return" | "break" | "other";
  targetVars?: string[];
  targetVar?: string;
  valExpr?: string;
  valStartByte?: number;
  condExpr?: string;
  condStartByte?: number;
  rawText: string;
  startByte: number;
  endByte: number;
  branches?: ParsedBranch[];
  elseStmts?: ParsedStatement[];
  thenStmts?: ParsedStatement[];
  loopVars?: string[];
  rangeExpr?: string;
  rangeStartByte?: number;
  loopBody?: ParsedStatement[];
  whileBody?: ParsedStatement[];
  whenBody?: ParsedStatement[];
}

/**
 * Extracts parsed statements directly from a CST statement node.
 */
function extractStatementFromNode(stmtNode: any): ParsedStatement {
  const sStart = stmtNode.startIndex ?? 0;
  const sEnd = stmtNode.endIndex ?? sStart + (stmtNode.text?.length ?? 0);
  const rawText = stmtNode.text || "";

  // 1. If statement: if ... then ... [elseif ... then ...]* [else ...]? end if;
  const ifNode =
    normType(stmtNode.type) === "ifstatement"
      ? stmtNode
      : stmtNode.children?.find((c: any) => normType(c.type) === "ifstatement");

  if (ifNode) {
    let currentMode: "init" | "if_cond" | "then" | "elseif_cond" | "elseif_body" | "else_body" = "init";
    const branches: ParsedBranch[] = [];
    let elseStmts: ParsedStatement[] | undefined = undefined;
    let curBranch: ParsedBranch | null = null;

    for (const ch of ifNode.children || []) {
      const t = normType(ch.type);
      const txt = (ch.text || "").trim();
      if (txt === "if") {
        curBranch = { stmts: [] };
        branches.push(curBranch);
        currentMode = "if_cond";
      } else if (txt === "elseif") {
        curBranch = { stmts: [] };
        branches.push(curBranch);
        currentMode = "elseif_cond";
      } else if (txt === "then") {
        currentMode = curBranch === branches[0] ? "then" : "elseif_body";
      } else if (txt === "else") {
        elseStmts = [];
        curBranch = null;
        currentMode = "else_body";
      } else if (txt === "end if" || txt === "endif") {
        break;
      } else if (t === "expression" && (currentMode === "if_cond" || currentMode === "elseif_cond")) {
        if (curBranch) {
          curBranch.condExpr = ch.text || "";
          curBranch.condStartByte = ch.startIndex ?? sStart;
        }
      } else if (t === "statement") {
        const sub = extractStatementFromNode(ch);
        if (currentMode === "else_body") {
          elseStmts?.push(sub);
        } else if (curBranch) {
          curBranch.stmts.push(sub);
        }
      }
    }

    return {
      kind: "if",
      condExpr: branches[0]?.condExpr,
      condStartByte: branches[0]?.condStartByte,
      rawText,
      startByte: sStart,
      endByte: sEnd,
      branches,
      elseStmts,
      thenStmts: branches[0]?.stmts,
    };
  }

  // 2. For statement: for <indices> loop <body> end for;
  const forNode =
    normType(stmtNode.type) === "forstatement"
      ? stmtNode
      : stmtNode.children?.find((c: any) => normType(c.type) === "forstatement");

  if (forNode) {
    const loopVars: string[] = [];
    let rangeExpr: string | undefined;
    let rangeStartByte: number | undefined;
    const loopBody: ParsedStatement[] = [];

    const indicesNode = forNode.children?.find((c: any) => normType(c.type) === "forindices");
    const indexNodes = indicesNode ? findNodesByType(indicesNode, "for_index") : findNodesByType(forNode, "for_index");

    for (const idxNode of indexNodes) {
      const idNode = idxNode.children?.find((c: any) => normType(c.type) === "identifier");
      if (idNode && idNode.text) {
        loopVars.push(idNode.text.trim());
      }
      const exprNode = idxNode.children?.find((c: any) => normType(c.type) === "expression");
      if (exprNode) {
        rangeExpr = exprNode.text || "";
        rangeStartByte = exprNode.startIndex ?? sStart;
      }
    }

    for (const ch of forNode.children || []) {
      if (normType(ch.type) === "statement") {
        loopBody.push(extractStatementFromNode(ch));
      }
    }

    return {
      kind: "for",
      rawText,
      startByte: sStart,
      endByte: sEnd,
      loopVars,
      rangeExpr,
      rangeStartByte,
      loopBody,
    };
  }

  // 3. While statement: while <cond> loop <body> end while;
  const whileNode =
    normType(stmtNode.type) === "whilestatement"
      ? stmtNode
      : stmtNode.children?.find((c: any) => normType(c.type) === "whilestatement");

  if (whileNode) {
    let condExpr: string | undefined;
    let condStartByte: number | undefined;
    const whileBody: ParsedStatement[] = [];

    const exprNode = whileNode.children?.find((c: any) => normType(c.type) === "expression");
    if (exprNode) {
      condExpr = exprNode.text || "";
      condStartByte = exprNode.startIndex ?? sStart;
    }

    for (const ch of whileNode.children || []) {
      if (normType(ch.type) === "statement") {
        whileBody.push(extractStatementFromNode(ch));
      }
    }

    return {
      kind: "while",
      rawText,
      startByte: sStart,
      endByte: sEnd,
      condExpr,
      condStartByte,
      whileBody,
    };
  }

  // 4. When statement: when <cond> then <body> end when;
  const whenNode =
    normType(stmtNode.type) === "whenstatement"
      ? stmtNode
      : stmtNode.children?.find((c: any) => normType(c.type) === "whenstatement");

  if (whenNode) {
    let condExpr: string | undefined;
    let condStartByte: number | undefined;
    const whenBody: ParsedStatement[] = [];

    const exprNode = whenNode.children?.find((c: any) => normType(c.type) === "expression");
    if (exprNode) {
      condExpr = exprNode.text || "";
      condStartByte = exprNode.startIndex ?? sStart;
    }

    for (const ch of whenNode.children || []) {
      if (normType(ch.type) === "statement") {
        whenBody.push(extractStatementFromNode(ch));
      }
    }

    return {
      kind: "when",
      rawText,
      startByte: sStart,
      endByte: sEnd,
      condExpr,
      condStartByte,
      whenBody,
    };
  }

  // 5. Multi-output tuple assignment: (a, b) := f(...)
  const tupleMatch = findNodesByType(stmtNode, "output_expression_list");
  if (tupleMatch.length > 0) {
    const targetVars: string[] = [];
    const outList = tupleMatch[0];
    const exprs = outList.children?.filter((c: any) => normType(c.type) === "expression") ?? [];
    for (const expr of exprs) {
      const varText = (expr.text || "").trim();
      if (varText) {
        const base = varText.split(/[.[]/)[0]?.trim();
        if (base) targetVars.push(base);
      }
    }

    const callNode =
      stmtNode.children?.find((c: any) => normType(c.type) === "functioncall") ||
      findNodesByType(stmtNode, "function_call")[0];
    const valExpr = callNode?.text || rawText.split(":=")[1]?.trim() || "";
    const valStartByte = callNode?.startIndex ?? sStart + Math.max(0, rawText.indexOf(":=") + 2);

    return {
      kind: "assignment",
      targetVars,
      valExpr,
      valStartByte,
      rawText,
      startByte: sStart,
      endByte: sEnd,
    };
  }

  // 6. Assignment statement: target := expr
  const assignNode =
    normType(stmtNode.type) === "assignmentstatement" ? stmtNode : findNodesByType(stmtNode, "assignment_statement")[0];

  if (assignNode) {
    const compRef = assignNode.children?.find((c: any) => normType(c.type) === "componentreference");
    const valNode = assignNode.children?.find((c: any) => normType(c.type) === "expression");
    const targetVar = compRef?.text || rawText.split(":=")[0]?.trim() || "";
    const valExpr = valNode?.text || rawText.split(":=")[1]?.trim() || "";
    const valStartByte = valNode?.startIndex ?? sStart + Math.max(0, rawText.indexOf(":=") + 2);

    const base = targetVar.split(/[.[]/)[0]?.trim();
    return {
      kind: "assignment",
      targetVars: base ? [base] : [],
      targetVar,
      valExpr,
      valStartByte,
      rawText,
      startByte: sStart,
      endByte: sEnd,
    };
  }

  // 7. Check return / break
  const trimmed = rawText.trim();
  if (
    trimmed === "return" ||
    trimmed.startsWith("return ") ||
    trimmed.startsWith("return(") ||
    trimmed.startsWith("return;")
  ) {
    return { kind: "return", rawText, startByte: sStart, endByte: sEnd };
  }
  if (trimmed === "break" || trimmed.startsWith("break;") || trimmed.startsWith("break ")) {
    return { kind: "break", rawText, startByte: sStart, endByte: sEnd };
  }

  // 8. Fallback: check if text has :=
  if (rawText.includes(":=")) {
    const parts = rawText.split(":=");
    const targetVar = parts[0]?.trim() || "";
    const valExpr = parts.slice(1).join(":=").trim();
    const baseVars = targetVar
      .replace(/^\(|\)$/g, "")
      .split(",")
      .map((s) => s.split(/[.[]/)[0]?.trim())
      .filter((s): s is string => Boolean(s));

    return {
      kind: "assignment",
      targetVars: baseVars,
      targetVar,
      valExpr,
      valStartByte: sStart + rawText.indexOf(":=") + 2,
      rawText,
      startByte: sStart,
      endByte: sEnd,
    };
  }

  return {
    kind: "other",
    rawText,
    startByte: sStart,
    endByte: sEnd,
  };
}

/**
 * Extracts statements from an algorithm_section CST node.
 */
function extractStatementsFromCst(algNode: any, defaultStartByte: number): ParsedStatement[] {
  const statements: ParsedStatement[] = [];
  if (!algNode || !algNode.children) {
    return parseStatementsFromText(algNode?.text || "", defaultStartByte);
  }

  for (const child of algNode.children) {
    if (normType(child.type) === "statement") {
      statements.push(extractStatementFromNode(child));
    }
  }

  if (statements.length === 0 && algNode.text) {
    return parseStatementsFromText(algNode.text, defaultStartByte);
  }

  return statements;
}

/**
 * Fallback parser for raw statement strings within an algorithm section.
 */
function parseStatementsFromText(algText: string, algStartByte: number): ParsedStatement[] {
  const statements: ParsedStatement[] = [];

  let body = algText;
  const algKwMatch = /^\s*(?:initial\s+)?algorithm\b/.exec(body);
  let offset = 0;
  if (algKwMatch) {
    offset = algKwMatch[0].length;
    body = body.slice(offset);
  }

  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i]!)) i++;
    if (i >= body.length) break;

    const remaining = body.slice(i);

    // 1. If statement
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

      // Split into if / elseif / else branches
      const branches: ParsedBranch[] = [];
      let elseStmts: ParsedStatement[] | undefined = undefined;

      // Extract parts between if/elseif/else/end if
      const branchTokens = ifText.split(/\b(elseif|else)\b/);
      // branchTokens[0] has 'if ... then ...'
      const firstBranchMatch = /^if\b([\s\S]*?)\bthen\b([\s\S]*)$/.exec(branchTokens[0] || "");
      if (firstBranchMatch) {
        const condExpr = firstBranchMatch[1]?.trim() || "";
        const thenBody = firstBranchMatch[2]?.trim() || "";
        branches.push({
          condExpr,
          condStartByte: startByte + (branchTokens[0]?.indexOf(condExpr) ?? 0),
          stmts: parseStatementsFromText(thenBody, startByte),
        });
      }

      let k = 1;
      while (k < branchTokens.length) {
        const token = branchTokens[k]?.trim();
        const content = branchTokens[k + 1] || "";
        if (token === "elseif") {
          const match = /^\s*([\s\S]*?)\bthen\b([\s\S]*)$/.exec(content);
          if (match) {
            const condExpr = match[1]?.trim() || "";
            const bodyText = match[2]?.trim() || "";
            branches.push({
              condExpr,
              condStartByte: startByte,
              stmts: parseStatementsFromText(bodyText, startByte),
            });
          }
        } else if (token === "else") {
          const elseBody = content.replace(/\bend\s+if[\s\S]*$/, "").trim();
          elseStmts = parseStatementsFromText(elseBody, startByte);
        }
        k += 2;
      }

      statements.push({
        kind: "if",
        condExpr: branches[0]?.condExpr,
        condStartByte: branches[0]?.condStartByte,
        rawText: ifText,
        startByte,
        endByte,
        branches,
        elseStmts,
        thenStmts: branches[0]?.stmts,
      });

      i = j;
      continue;
    }

    // 2. For statement
    if (/^for\b/.test(remaining)) {
      const forStart = i;
      let depth = 1;
      let j = i + 3;
      while (j < body.length && depth > 0) {
        if (body.slice(j).startsWith("for") && /\bfor\b/.test(body.slice(j, j + 4))) {
          depth++;
          j += 3;
        } else if (body.slice(j).startsWith("end for") && /\bend\s+for\b/.test(body.slice(j, j + 8))) {
          depth--;
          j += 7;
          if (depth === 0) {
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

      const forText = body.slice(forStart, j);
      const startByte = algStartByte + offset + forStart;
      const endByte = algStartByte + offset + j;

      const forMatch = /^for\b([\s\S]*?)\bloop\b([\s\S]*?)\bend\s+for/i.exec(forText);
      const header = forMatch ? forMatch[1] || "" : "";
      const forBodyText = forMatch ? forMatch[2] || "" : "";

      const loopVars: string[] = [];
      let rangeExpr: string | undefined;
      const idMatch = header.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)/);
      if (idMatch && idMatch[1]) loopVars.push(idMatch[1]);
      const inMatch = header.match(/\bin\b([\s\S]*)$/);
      if (inMatch && inMatch[1]) rangeExpr = inMatch[1].trim();

      statements.push({
        kind: "for",
        rawText: forText,
        startByte,
        endByte,
        loopVars,
        rangeExpr,
        loopBody: parseStatementsFromText(forBodyText, startByte),
      });

      i = j;
      continue;
    }

    // 3. While statement
    if (/^while\b/.test(remaining)) {
      const whileStart = i;
      let depth = 1;
      let j = i + 5;
      while (j < body.length && depth > 0) {
        if (body.slice(j).startsWith("while") && /\bwhile\b/.test(body.slice(j, j + 6))) {
          depth++;
          j += 5;
        } else if (body.slice(j).startsWith("end while") && /\bend\s+while\b/.test(body.slice(j, j + 10))) {
          depth--;
          j += 9;
          if (depth === 0) {
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

      const whileText = body.slice(whileStart, j);
      const startByte = algStartByte + offset + whileStart;
      const endByte = algStartByte + offset + j;

      const whileMatch = /^while\b([\s\S]*?)\bloop\b([\s\S]*?)\bend\s+while/i.exec(whileText);
      const condExpr = whileMatch ? whileMatch[1]?.trim() || "" : "";
      const whileBodyText = whileMatch ? whileMatch[2]?.trim() || "" : "";

      statements.push({
        kind: "while",
        condExpr,
        rawText: whileText,
        startByte,
        endByte,
        whileBody: parseStatementsFromText(whileBodyText, startByte),
      });

      i = j;
      continue;
    }

    // 4. Simple statement up to ';'
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
      const baseVars = targetVar
        .replace(/^\(|\)$/g, "")
        .split(",")
        .map((s) => s.split(/[.[]/)[0]?.trim())
        .filter((s): s is string => Boolean(s));

      statements.push({
        kind: "assignment",
        targetVars: baseVars,
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
  let isPartial = words.includes("partial");

  if (cst) {
    for (const child of cst.children || []) {
      if (child.type === "class_prefixes") {
        const childText = (child.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
        const childWords = childText.split(/\s+/).filter(Boolean);
        if (childWords.includes("function")) {
          isFunction = true;
        }
        if (childWords.includes("partial")) {
          isPartial = true;
        }
      }
    }
    if (!isFunction) {
      const trimmedText = (cst.text?.trim() ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
      if (/^(?:(?:encapsulated|partial|replaceable|pure|impure)\s+)*(?:operator\s+)?function\b/.test(trimmedText)) {
        isFunction = true;
      }
    }
    if (!isPartial) {
      const trimmedText = (cst.text?.trim() ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
      if (/\bpartial\s+(?:(?:encapsulated|replaceable|pure|impure)\s+)*(?:operator\s+)?function\b/.test(trimmedText)) {
        isPartial = true;
      }
    }
  }

  if (!isFunction || isPartial) return results;

  // 1. Extract variables (inputs, outputs, locals)
  const inputs = new Map<string, VariableInfo>();
  const outputs = new Map<string, VariableInfo>();
  const locals = new Map<string, VariableInfo>();

  const compClauses = findNodesByType(cst, "component_clause");
  for (const comp of compClauses) {
    const compText = comp.text || "";
    const isInput = /\binput\b/.test(compText);
    const isOutput = /\boutput\b/.test(compText);

    // Use CST component_declaration children to extract declared variable names.
    // Each component_declaration has an IDENT for the variable name.
    const compDecls = findNodesByType(comp, "component_declaration");
    const compStart = comp.startIndex ?? self.startByte;

    if (compDecls.length > 0) {
      // CST-based extraction: reliable
      for (const decl of compDecls) {
        const declText = decl.text || "";
        // Find the first IDENT in the component_declaration
        let name: string | null = null;
        let nameStartByte = 0;
        let nameEndByte = 0;
        for (const child of decl.children || []) {
          const childType = normType(child.type);
          if (childType === "ident" || childType === "identifier") {
            name = child.text;
            nameStartByte = child.startIndex ?? compStart + (decl.startIndex ?? 0);
            nameEndByte = nameStartByte + (name?.length ?? 0);
            break;
          }
        }
        // Fallback: extract first identifier from declaration text
        if (!name) {
          const m = declText.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
          if (m && m[1]) {
            name = m[1];
            nameStartByte = decl.startIndex ?? compStart;
            nameEndByte = nameStartByte + name.length;
          }
        }

        if (!name) continue;

        // Check for default binding: must be a top-level `=` (not inside parentheses),
        // OR a class modification `(field = value, ...)` which also initializes the variable.
        // e.g., `result = fill(1.0, n)` has a default via binding.
        // e.g., `o(r1 = r, r2 = 1.0)` has a default via class modification.
        let hasDefault = false;
        let parenDepth = 0;
        for (let i = 0; i < declText.length; i++) {
          const ch = declText[i];
          if (ch === "(") parenDepth++;
          else if (ch === ")") parenDepth--;
          else if (
            ch === "=" &&
            parenDepth === 0 &&
            declText[i - 1] !== ":" &&
            declText[i - 1] !== "<" &&
            declText[i - 1] !== ">" &&
            declText[i - 1] !== "!"
          ) {
            hasDefault = true;
            break;
          }
        }
        // Also treat parenthesized modifiers as initialization (for record outputs)
        if (!hasDefault && declText.includes("(") && declText.includes("=")) {
          hasDefault = true;
        }

        const isArray = declText.includes("[") || compText.includes("[");
        const info: VariableInfo = {
          name,
          isInput,
          isOutput,
          hasDefault,
          isArray,
          startByte: nameStartByte,
          endByte: nameEndByte,
        };

        if (isInput) {
          inputs.set(name, info);
        } else if (isOutput) {
          outputs.set(name, info);
        } else {
          locals.set(name, info);
        }
      }
    } else {
      // Fallback: regex-based extraction for when CST nodes aren't available.
      // Skip the type specifier by finding the first identifier after prefixes and type name.
      const declMatches = compText.matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\[[^\]]*\])?(?:\s*=\s*([^,;]+))?/g);
      let seenTypeSpec = false;

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

        // The first non-keyword identifier is the type specifier — skip it
        if (!seenTypeSpec) {
          seenTypeSpec = true;
          continue;
        }

        const hasDefault = match[2] !== undefined || compText.includes("=");
        const matchIdx = match.index ?? 0;
        const startByte = compStart + matchIdx;
        const endByte = startByte + name.length;
        const isArray = match[0].includes("[") || compText.includes("[");

        const info: VariableInfo = {
          name,
          isInput,
          isOutput,
          hasDefault,
          isArray,
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
  }

  // 2. Find algorithm section(s)
  const algSections = findNodesByType(cst, "algorithm_section");

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
  const checkExprReads = (
    expr: string,
    exprStartByte: number,
    currentAssigned: Set<string>,
    activeLoopVars: Set<string> = new Set(),
  ) => {
    const identRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let m: RegExpExecArray | null;
    while ((m = identRegex.exec(expr)) !== null) {
      const varName = m[1];
      if (activeLoopVars.has(varName)) continue;
      if (monitoredVars.has(varName) && !currentAssigned.has(varName)) {
        const sByte = exprStartByte + m.index;
        const eByte = sByte + varName.length;
        results.push(
          warning(ModelicaErrorCode.UNINITIALIZED_VARIABLE_READ.message(varName), {
            startByte: sByte,
            endByte: eByte,
            code: ModelicaErrorCode.UNINITIALIZED_VARIABLE_READ.code,
          }),
        );
      }
    }
  };

  const allAssignedEver = new Set<string>();

  // CFA traversal
  interface StmtAnalysis {
    assigned: Set<string>;
    alwaysReturns: boolean;
  }

  const analyzeStatements = (
    stmts: ParsedStatement[],
    inAssigned: Set<string>,
    activeLoopVars: Set<string> = new Set(),
  ): StmtAnalysis => {
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
          for (const [outName, outInfo] of outputs) {
            const isAssigned = cur.has(outName) || (outInfo.isArray && allAssignedEver.has(outName));
            if (!isAssigned) {
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
          checkExprReads(
            stmt.valExpr,
            stmt.valStartByte ?? stmt.startByte + Math.max(0, stmt.rawText.indexOf(":=") + 2),
            cur,
            activeLoopVars,
          );
        }

        // Add targets to assigned
        if (stmt.targetVars && stmt.targetVars.length > 0) {
          for (const v of stmt.targetVars) {
            if (v) {
              cur.add(v);
              allAssignedEver.add(v);
            }
          }
        } else if (stmt.targetVar) {
          const baseIdent = stmt.targetVar.split(/[.[]/)[0]?.trim() || stmt.targetVar.trim();
          if (baseIdent) {
            cur.add(baseIdent);
            allAssignedEver.add(baseIdent);
          }
        }
      } else if (stmt.kind === "if") {
        const branches =
          stmt.branches && stmt.branches.length > 0
            ? stmt.branches
            : stmt.thenStmts
              ? [
                  {
                    condExpr: stmt.condExpr,
                    condStartByte: stmt.condStartByte ?? stmt.startByte,
                    stmts: stmt.thenStmts,
                  },
                ]
              : [];
        const elseStmts = stmt.elseStmts;

        const branchResults: StmtAnalysis[] = [];
        let hasStaticallyTrueBranch = false;

        for (const branch of branches) {
          if (branch.condExpr) {
            checkExprReads(branch.condExpr, branch.condStartByte ?? stmt.startByte, cur, activeLoopVars);
            if (branch.condExpr.trim() === "true") {
              hasStaticallyTrueBranch = true;
            }
          }
          const bRes = analyzeStatements(branch.stmts, cur, activeLoopVars);
          branchResults.push(bRes);
          if (hasStaticallyTrueBranch) break;
        }

        const hasElse = elseStmts !== undefined || hasStaticallyTrueBranch;
        let elseRes: StmtAnalysis | undefined;
        if (elseStmts !== undefined && !hasStaticallyTrueBranch) {
          elseRes = analyzeStatements(elseStmts, cur, activeLoopVars);
        }

        const allBranchResults = [...branchResults];
        if (elseRes) allBranchResults.push(elseRes);

        if (hasElse && allBranchResults.length > 0) {
          const allReturn = allBranchResults.every((r) => r.alwaysReturns);
          if (allReturn) {
            returned = true;
          } else {
            const nonReturning = allBranchResults.filter((r) => !r.alwaysReturns);
            if (nonReturning.length > 0) {
              let intersected = new Set(nonReturning[0]!.assigned);
              for (let k = 1; k < nonReturning.length; k++) {
                intersected = intersectSets(intersected, nonReturning[k]!.assigned);
              }
              cur = intersected;
            }
          }
        }
      } else if (stmt.kind === "for") {
        if (stmt.rangeExpr) {
          checkExprReads(stmt.rangeExpr, stmt.rangeStartByte ?? stmt.startByte, cur, activeLoopVars);
        }
        const loopVars = new Set(activeLoopVars);
        if (stmt.loopVars) {
          for (const lv of stmt.loopVars) loopVars.add(lv);
        }
        const loopRes = analyzeStatements(stmt.loopBody || [], cur, loopVars);
        for (const a of loopRes.assigned) {
          if (!loopVars.has(a)) {
            cur.add(a);
            allAssignedEver.add(a);
          }
        }
      } else if (stmt.kind === "while") {
        if (stmt.condExpr) {
          checkExprReads(stmt.condExpr, stmt.condStartByte ?? stmt.startByte, cur, activeLoopVars);
        }
        const whileRes = analyzeStatements(stmt.whileBody || [], cur, activeLoopVars);
        for (const a of whileRes.assigned) {
          cur.add(a);
          allAssignedEver.add(a);
        }
        if (stmt.condExpr?.trim() === "true" && whileRes.alwaysReturns) {
          returned = true;
        }
      } else if (stmt.kind === "when") {
        if (stmt.condExpr) {
          checkExprReads(stmt.condExpr, stmt.condStartByte ?? stmt.startByte, cur, activeLoopVars);
        }
        const whenRes = analyzeStatements(stmt.whenBody || [], cur, activeLoopVars);
        for (const a of whenRes.assigned) {
          cur.add(a);
          allAssignedEver.add(a);
        }
      } else {
        // Other statement
        checkExprReads(stmt.rawText, stmt.startByte, cur, activeLoopVars);
      }
    }

    return { assigned: cur, alwaysReturns: returned };
  };

  for (const alg of algSections) {
    const algStart = alg.startIndex ?? self.startByte;
    const stmts = extractStatementsFromCst(alg, algStart);
    const finalRes = analyzeStatements(stmts, initialAssigned);

    // At the end of function execution: check all outputs
    if (isFunction && !finalRes.alwaysReturns) {
      for (const [outName, outInfo] of outputs) {
        const isAssigned = finalRes.assigned.has(outName) || (outInfo.isArray && allAssignedEver.has(outName));
        if (!isAssigned) {
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

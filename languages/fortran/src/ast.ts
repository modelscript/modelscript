// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fortran Procedural AST, Lexer, and Parser.
 *
 * Translates procedural Fortran statements (IF/THEN/ELSE, assignments,
 * state machine storage, and intrinsic math) into a typed AST.
 */

export type FortranSubscript =
  | { kind: "index"; expr: FortranExpr }
  | {
      kind: "slice";
      start?: FortranExpr | undefined;
      end?: FortranExpr | undefined;
      stride?: FortranExpr | undefined;
    };

export interface FortranArraySpec {
  name: string;
  rank: number;
  allocatable: boolean;
  dims: { lower: number; upper: number }[];
}

export type FortranStmt =
  | {
      kind: "assign";
      target:
        | { type: "var"; name: string }
        | { type: "port"; portName: string }
        | { type: "state"; array: "storf" | "stori"; indexExpr: FortranExpr }
        | { type: "array"; name: string; subscripts: FortranSubscript[] };
      expr: FortranExpr;
      line?: number | undefined;
    }
  | {
      kind: "if";
      condition: FortranExpr;
      thenBody: FortranStmt[];
      elseBody?: FortranStmt[] | undefined;
      line?: number | undefined;
    }
  | {
      kind: "do";
      loopVar: string;
      startExpr: FortranExpr;
      endExpr: FortranExpr;
      stepExpr?: FortranExpr | undefined;
      body: FortranStmt[];
      line?: number | undefined;
    }
  | {
      kind: "call";
      subroutine: string;
      args: FortranExpr[];
      line?: number | undefined;
    }
  | {
      kind: "allocate";
      items: { name: string; dims: { lower?: FortranExpr | undefined; upper: FortranExpr }[] }[];
      line?: number | undefined;
    }
  | {
      kind: "deallocate";
      names: string[];
      line?: number | undefined;
    }
  | {
      kind: "stateAdvance";
      array: "storf" | "stori";
      delta: number;
      line?: number | undefined;
    };

export type FortranExpr =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "var"; name: string }
  | { kind: "port"; portName: string }
  | { kind: "special"; name: "TIME" | "DELT" | "FIRSTSTEP" }
  | { kind: "state"; array: "storf" | "stori"; indexExpr: FortranExpr }
  | { kind: "arrayAccess"; name: string; subscripts: FortranSubscript[] }
  | { kind: "arrayConstructor"; elements: FortranExpr[] }
  | {
      kind: "binary";
      op: "+" | "-" | "*" | "/" | "^" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "&&" | "||";
      left: FortranExpr;
      right: FortranExpr;
    }
  | { kind: "unary"; op: "!" | "-"; expr: FortranExpr }
  | { kind: "math"; func: string; args: FortranExpr[] };

export interface FortranRoutineSignature {
  name: string;
  kind: "subroutine" | "function" | "program" | "module" | "script";
  returnVar?: string | undefined;
  args: string[];
  inputs: string[];
  outputs: string[];
  locals: string[];
  constants: Record<string, number>;
  arrays: Record<string, FortranArraySpec>;
  usedModules?: string[] | undefined;
}

export interface FortranUnitAst {
  name: string;
  kind: "subroutine" | "function" | "program" | "module" | "script";
  returnVar?: string | undefined;
  signature: FortranRoutineSignature;
  stmts: FortranStmt[];
  calledRoutines: string[];
  usedModules: string[];
  startLine: number;
  endLine: number;
}

export interface FortranModuleAst {
  units: Map<string, FortranUnitAst>;
  moduleConstants: Record<string, number>;
  entryUnit: FortranUnitAst;
  callGraph: Map<string, string[]>;
}

function parseDimensionSpecString(
  dimStr: string,
  constants: Record<string, number>,
): { dims: { lower: number; upper: number }[]; deferred: boolean } {
  const parts = dimStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let deferred = false;
  const dims: { lower: number; upper: number }[] = [];

  const evalBound = (raw: string): number => {
    const t = raw.trim();
    const num = Number(t);
    if (!Number.isNaN(num)) return Math.trunc(num);
    const c = constants[t] ?? constants[t.toLowerCase()] ?? constants[t.toUpperCase()];
    if (c !== undefined) return Math.trunc(c);
    return 1;
  };

  for (const part of parts) {
    if (part === ":" || part === "*") {
      deferred = true;
    } else if (part.includes(":")) {
      const [loStr, hiStr] = part.split(":");
      if (!hiStr || hiStr.trim() === "") {
        deferred = true;
      } else {
        dims.push({
          lower: loStr && loStr.trim() !== "" ? evalBound(loStr) : 1,
          upper: evalBound(hiStr),
        });
      }
    } else {
      dims.push({ lower: 1, upper: evalBound(part) });
    }
  }
  return { dims, deferred };
}

/**
 * Extracts subroutine/function header, intent(in)/intent(out) ports, local variables,
 * constant initializers, and array dimension specifications from a Fortran source segment.
 */
export function extractFortranSignature(
  source: string,
  inheritedConstants: Record<string, number> = {},
): FortranRoutineSignature {
  let name = "main";
  let kind: FortranRoutineSignature["kind"] = "script";
  let returnVar: string | undefined;
  const args: string[] = [];
  const inputs = new Set<string>();
  const outputs = new Set<string>();
  const locals = new Set<string>();
  const constants: Record<string, number> = { ...inheritedConstants };
  const arrays: Record<string, FortranArraySpec> = {};
  const usedModules = new Set<string>();

  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    const bangIdx = rawLine.indexOf("!");
    const clean = (bangIdx !== -1 ? rawLine.slice(0, bangIdx) : rawLine).trim();
    if (!clean || clean.startsWith("#")) continue;

    const useMatch = /^use\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(clean);
    if (useMatch) {
      usedModules.add(useMatch[1]!);
      continue;
    }

    const subMatch =
      /^(?:(?:pure|elemental|recursive|real(?:\([^)]*\))?|integer(?:\([^)]*\))?|double\s+precision|logical)\s+)*(subroutine|function)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]*)\))?(?:\s+result\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\))?/i.exec(
        clean,
      );
    if (subMatch && args.length === 0 && name === "main") {
      kind = subMatch[1]!.toLowerCase() === "function" ? "function" : "subroutine";
      name = subMatch[2]!;
      if (subMatch[3]) {
        for (const a of subMatch[3]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)) {
          args.push(a);
        }
      }
      if (kind === "function") {
        returnVar = subMatch[4] ?? name;
        outputs.add(returnVar);
      }
      continue;
    }

    const progMatch = /^(program|module)\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(clean);
    if (progMatch && name === "main") {
      kind = progMatch[1]!.toLowerCase() === "module" ? "module" : "program";
      name = progMatch[2]!;
      continue;
    }

    const paramStmtMatch = /^parameter\s*\((.+)\)$/i.exec(clean);
    if (paramStmtMatch) {
      for (const pair of paramStmtMatch[1]!.split(",")) {
        const eqIdx = pair.indexOf("=");
        if (eqIdx !== -1) {
          const k = pair.slice(0, eqIdx).trim();
          const v = pair.slice(eqIdx + 1).trim();
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
            const num = Number(v.replace(/[dD]/g, "e"));
            if (!Number.isNaN(num)) {
              constants[k] = num;
            }
          }
        }
      }
      continue;
    }

    if (/^dimension\b/i.test(clean)) {
      const dimContent = clean.slice(9).trim();
      const items: string[] = [];
      let depth = 0;
      let cur = "";
      for (const ch of dimContent) {
        if (ch === "(") depth++;
        else if (ch === ")") depth = Math.max(0, depth - 1);
        if (ch === "," && depth === 0) {
          items.push(cur.trim());
          cur = "";
        } else {
          cur += ch;
        }
      }
      if (cur.trim()) items.push(cur.trim());
      for (const item of items) {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)$/.exec(item);
        if (m) {
          const vName = m[1]!;
          const parsed = parseDimensionSpecString(m[2]!, constants);
          arrays[vName] = {
            name: vName,
            rank: Math.max(1, m[2]!.split(",").length),
            allocatable: parsed.deferred,
            dims: parsed.dims,
          };
        }
      }
      continue;
    }

    const typeMatch = /^(?:real|integer|double\s+precision|logical|complex|character)(?:\s*\([^)]*\)|\*\d+|\b)/i.exec(
      clean,
    );
    if (typeMatch) {
      let afterType = clean.slice(typeMatch[0].length).trim();
      let attrs = "";
      let varPart = afterType;
      if (afterType.startsWith(",")) {
        const dcolIdx = afterType.indexOf("::");
        if (dcolIdx !== -1) {
          attrs = afterType.slice(0, dcolIdx);
          varPart = afterType.slice(dcolIdx + 2).trim();
        } else {
          attrs = afterType;
          varPart = "";
        }
      } else if (afterType.startsWith("::")) {
        varPart = afterType.slice(2).trim();
      }

      const intentMatch = /\bintent\s*\(\s*(in\s*out|inout|in|out)\s*\)/i.exec(attrs);
      const intent = intentMatch ? intentMatch[1]!.replace(/\s+/g, "").toLowerCase() : null;
      const isAllocatableAttr = /\ballocatable\b/i.test(attrs);
      const dimAttrMatch = /\bdimension\s*\(([^)]*)\)/i.exec(attrs);
      const attrDimSpec = dimAttrMatch ? parseDimensionSpecString(dimAttrMatch[1]!, constants) : null;

      // Split top-level comma items
      const items: string[] = [];
      let depth = 0;
      let cur = "";
      for (const ch of varPart) {
        if (ch === "(") depth++;
        else if (ch === ")") depth = Math.max(0, depth - 1);
        if (ch === "," && depth === 0) {
          items.push(cur.trim());
          cur = "";
        } else {
          cur += ch;
        }
      }
      if (cur.trim()) items.push(cur.trim());

      for (const item of items) {
        const eqIdx = item.indexOf("=");
        const nameAndDim = eqIdx !== -1 ? item.slice(0, eqIdx).trim() : item;
        const initStr = eqIdx !== -1 ? item.slice(eqIdx + 1).trim() : undefined;
        const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(([^)]*)\))?$/.exec(nameAndDim);
        if (!m) continue;
        const vName = m[1]!;
        const itemDimStr = m[2];
        if (intent === "in") {
          inputs.add(vName);
        } else if (intent === "out") {
          outputs.add(vName);
        } else if (intent === "inout") {
          inputs.add(vName);
          outputs.add(vName);
        } else {
          locals.add(vName);
        }
        if (initStr !== undefined) {
          const num = Number(initStr.replace(/[dD]/g, "e"));
          if (!Number.isNaN(num)) {
            constants[vName] = num;
          }
        }
        if (itemDimStr !== undefined) {
          const parsed = parseDimensionSpecString(itemDimStr, constants);
          arrays[vName] = {
            name: vName,
            rank: Math.max(1, itemDimStr.split(",").length),
            allocatable: isAllocatableAttr || parsed.deferred,
            dims: parsed.dims,
          };
        } else if (attrDimSpec) {
          arrays[vName] = {
            name: vName,
            rank: Math.max(1, dimAttrMatch![1]!.split(",").length),
            allocatable: isAllocatableAttr || attrDimSpec.deferred,
            dims: attrDimSpec.dims.map((d) => ({ ...d })),
          };
        } else if (isAllocatableAttr) {
          arrays[vName] = {
            name: vName,
            rank: 1,
            allocatable: true,
            dims: [],
          };
        }
      }
    }
  }

  return {
    name,
    kind,
    returnVar,
    args,
    inputs: Array.from(inputs),
    outputs: Array.from(outputs),
    locals: Array.from(locals),
    constants,
    arrays,
    usedModules: Array.from(usedModules),
  };
}

// =============================================================================
// Tokenizer
// =============================================================================

type TokenType =
  | "KEYWORD"
  | "IDENT"
  | "STRING"
  | "PORT"
  | "NUMBER"
  | "OP"
  | "LPAREN"
  | "RPAREN"
  | "LBRACK"
  | "RBRACK"
  | "COLON"
  | "COMMA"
  | "ASSIGN";

export interface Token {
  type: TokenType;
  value: string;
  line?: number | undefined;
}

const FORTRAN_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elseif",
  "endif",
  "do",
  "enddo",
  "end",
  "call",
  "subroutine",
  "function",
  "program",
  "module",
  "contains",
  "use",
  "allocate",
  "deallocate",
  "implicit",
  "none",
  "return",
  "continue",
  "parameter",
  "true",
  "false",
]);

const FORTRAN_MATH_FUNCS = new Set([
  "sqrt",
  "abs",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "exp",
  "log",
  "log10",
  "min",
  "max",
  "mod",
  "sign",
  "sum",
  "maxval",
  "minval",
  "size",
  "dot_product",
  "matmul",
]);

export function tokenizeFortran(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const n = text.length;

  while (i < n) {
    const ch = text[i]!;

    if (ch === "\n") {
      line++;
      i++;
      continue;
    }

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Inline Fortran comment '!' (when not '!=')
    if (ch === "!" && text[i + 1] !== "=") {
      while (i < n && text[i] !== "\n") {
        i++;
      }
      continue;
    }

    // Fortran 90 array constructor (/ ... /)
    if (ch === "(" && text[i + 1] === "/") {
      tokens.push({ type: "LBRACK", value: "(/", line });
      i += 2;
      continue;
    }
    if (ch === "/" && text[i + 1] === ")") {
      tokens.push({ type: "RBRACK", value: "/)", line });
      i += 2;
      continue;
    }

    if (ch === "[") {
      tokens.push({ type: "LBRACK", value: "[", line });
      i++;
      continue;
    }
    if (ch === "]") {
      tokens.push({ type: "RBRACK", value: "]", line });
      i++;
      continue;
    }

    if (ch === ":") {
      if (text[i + 1] === ":") {
        i += 2; // Skip '::' declaration separator
      } else {
        tokens.push({ type: "COLON", value: ":", line });
        i++;
      }
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "LPAREN", value: "(", line });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "RPAREN", value: ")", line });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "COMMA", value: ",", line });
      i++;
      continue;
    }

    // String literals ("..." or '...')
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let strVal = "";
      while (i < n && text[i] !== quote) {
        if (text[i] === "\n") line++;
        strVal += text[i]!;
        i++;
      }
      if (i < n && text[i] === quote) {
        i++;
      }
      tokens.push({ type: "STRING", value: strVal, line });
      continue;
    }

    // Port references starting with '$'
    if (ch === "$") {
      i++;
      let portName = "";
      while (i < n && /[A-Za-z0-9_]/.test(text[i]!)) {
        portName += text[i]!;
        i++;
      }
      tokens.push({ type: "PORT", value: portName, line });
      continue;
    }

    // Assignment or equality
    if (ch === "=") {
      if (text[i + 1] === "=") {
        tokens.push({ type: "OP", value: "==", line });
        i += 2;
      } else {
        tokens.push({ type: "ASSIGN", value: "=", line });
        i++;
      }
      continue;
    }

    // Multi-char operators: <=, >=, !=, /=, &&, ||, **
    const two = text.slice(i, i + 2);
    if (["<=", ">=", "!=", "/=", "&&", "||", "**"].includes(two)) {
      const opVal = two === "**" ? "^" : two === "/=" ? "!=" : two;
      tokens.push({ type: "OP", value: opVal, line });
      i += 2;
      continue;
    }

    // Single-character operators: +, -, *, /, <, >, !
    if ("+-*/<>!".includes(ch)) {
      tokens.push({ type: "OP", value: ch, line });
      i++;
      continue;
    }

    // Fortran dot operators e.g. .AND., .OR., .NOT., .EQ., .NE., .GT., .GE., .LT., .LE.
    if (ch === ".") {
      const dotMatch = /^\.([A-Za-z]+)\./i.exec(text.slice(i));
      if (dotMatch) {
        const dotOp = dotMatch[1]!.toUpperCase();
        let mapped = "";
        switch (dotOp) {
          case "AND":
            mapped = "&&";
            break;
          case "OR":
            mapped = "||";
            break;
          case "NOT":
            mapped = "!";
            break;
          case "EQ":
            mapped = "==";
            break;
          case "NE":
            mapped = "!=";
            break;
          case "GT":
            mapped = ">";
            break;
          case "GE":
            mapped = ">=";
            break;
          case "LT":
            mapped = "<";
            break;
          case "LE":
            mapped = "<=";
            break;
          case "TRUE":
            tokens.push({ type: "KEYWORD", value: "true", line });
            i += dotMatch[0].length;
            continue;
          case "FALSE":
            tokens.push({ type: "KEYWORD", value: "false", line });
            i += dotMatch[0].length;
            continue;
        }
        if (mapped) {
          tokens.push({ type: "OP", value: mapped, line });
          i += dotMatch[0].length;
          continue;
        }
      }
    }

    // Numbers (integers, floats, scientific notation 1e-3, 1.0E6, 1.0D6)
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(text[i + 1] ?? ""))) {
      let numStr = "";
      while (i < n && /[0-9.eEdD+-]/.test(text[i]!)) {
        if ((text[i] === "+" || text[i] === "-") && !/[eEdD]/.test(numStr.slice(-1))) {
          break;
        }
        numStr += text[i]!;
        i++;
      }
      // Skip optional Fortran kind suffix like _8 or _dp
      if (i < n && text[i] === "_") {
        i++;
        while (i < n && /[A-Za-z0-9_]/.test(text[i]!)) i++;
      }
      tokens.push({ type: "NUMBER", value: numStr.replace(/[dD]/g, "e"), line });
      continue;
    }

    // Identifiers & Keywords
    if (/[A-Za-z_]/.test(ch)) {
      let ident = "";
      while (i < n && /[A-Za-z0-9_]/.test(text[i]!)) {
        ident += text[i]!;
        i++;
      }
      const lower = ident.toLowerCase();
      if (FORTRAN_KEYWORDS.has(lower)) {
        tokens.push({ type: "KEYWORD", value: lower, line });
      } else {
        tokens.push({ type: "IDENT", value: ident, line });
      }
      continue;
    }

    // Skip unhandled characters
    i++;
  }

  return tokens;
}

// =============================================================================
// AST Parser
// =============================================================================

export class FortranAstParser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  public parseProgram(): FortranStmt[] {
    const stmts: FortranStmt[] = [];
    while (this.pos < this.tokens.length) {
      const stmt = this.parseStatement();
      if (stmt) {
        stmts.push(stmt);
      }
    }
    return stmts;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++]!;
  }

  private checkKeyword(val: string): boolean {
    const tok = this.peek();
    return tok?.type === "KEYWORD" && tok.value.toLowerCase() === val.toLowerCase();
  }

  private isEndIf(): boolean {
    if (this.checkKeyword("endif")) return true;
    if (
      this.checkKeyword("end") &&
      this.tokens[this.pos + 1]?.type === "KEYWORD" &&
      this.tokens[this.pos + 1]?.value === "if"
    ) {
      return true;
    }
    return false;
  }

  private consumeEndIf(): void {
    if (this.checkKeyword("endif")) {
      this.consume();
    } else if (this.checkKeyword("end")) {
      this.consume();
      if (this.checkKeyword("if")) this.consume();
    }
  }

  private isElseIf(): boolean {
    if (this.checkKeyword("elseif")) return true;
    if (
      this.checkKeyword("else") &&
      this.tokens[this.pos + 1]?.type === "KEYWORD" &&
      this.tokens[this.pos + 1]?.value === "if"
    ) {
      return true;
    }
    return false;
  }

  private consumeElseIf(): void {
    if (this.checkKeyword("elseif")) {
      this.consume();
    } else if (this.checkKeyword("else")) {
      this.consume();
      if (this.checkKeyword("if")) this.consume();
    }
  }

  private isEndDo(): boolean {
    if (this.checkKeyword("enddo")) return true;
    if (
      this.checkKeyword("end") &&
      this.tokens[this.pos + 1]?.type === "KEYWORD" &&
      this.tokens[this.pos + 1]?.value === "do"
    ) {
      return true;
    }
    return false;
  }

  private consumeEndDo(): void {
    if (this.checkKeyword("enddo")) {
      this.consume();
    } else if (this.checkKeyword("end")) {
      this.consume();
      if (this.checkKeyword("do")) this.consume();
    }
  }

  private parseSubscriptList(): FortranSubscript[] {
    const subs: FortranSubscript[] = [];
    while (this.pos < this.tokens.length && this.peek()?.type !== "RPAREN") {
      if (this.peek()?.type === "COLON") {
        this.consume(); // eat ':'
        let end: FortranExpr | undefined;
        let stride: FortranExpr | undefined;
        if (this.peek()?.type !== "COMMA" && this.peek()?.type !== "RPAREN" && this.peek()?.type !== "COLON") {
          end = this.parseExpr();
        }
        if (this.peek()?.type === "COLON") {
          this.consume();
          if (this.peek()?.type !== "COMMA" && this.peek()?.type !== "RPAREN") {
            stride = this.parseExpr();
          }
        }
        subs.push({ kind: "slice", end, stride });
      } else {
        const first = this.parseExpr();
        if (this.peek()?.type === "COLON") {
          this.consume(); // eat ':'
          let end: FortranExpr | undefined;
          let stride: FortranExpr | undefined;
          if (this.peek()?.type !== "COMMA" && this.peek()?.type !== "RPAREN" && this.peek()?.type !== "COLON") {
            end = this.parseExpr();
          }
          if (this.peek()?.type === "COLON") {
            this.consume();
            if (this.peek()?.type !== "COMMA" && this.peek()?.type !== "RPAREN") {
              stride = this.parseExpr();
            }
          }
          subs.push({ kind: "slice", start: first, end, stride });
        } else {
          subs.push({ kind: "index", expr: first });
        }
      }
      if (this.peek()?.type === "COMMA") {
        this.consume();
      } else {
        break;
      }
    }
    return subs;
  }

  private parseStatement(): FortranStmt | null {
    const tok = this.peek();
    if (!tok) return null;
    const stmtLine = tok.line;

    // 0. Skip SUBROUTINE / FUNCTION / PROGRAM / MODULE headers and END SUBROUTINE / IMPLICIT NONE / USE / CONTAINS
    if (
      this.checkKeyword("subroutine") ||
      this.checkKeyword("function") ||
      this.checkKeyword("program") ||
      this.checkKeyword("module")
    ) {
      this.consume();
      if (this.peek()?.type === "IDENT") this.consume();
      if (this.peek()?.type === "LPAREN") {
        let depth = 0;
        while (this.pos < this.tokens.length) {
          const t = this.consume();
          if (t.type === "LPAREN") depth++;
          else if (t.type === "RPAREN") {
            depth--;
            if (depth <= 0) break;
          }
        }
      }
      // Optional RESULT(var)
      if (this.peek()?.type === "IDENT" && this.peek()?.value.toLowerCase() === "result") {
        this.consume();
        if (this.peek()?.type === "LPAREN") {
          this.consume();
          if (this.peek()?.type === "IDENT") this.consume();
          if (this.peek()?.type === "RPAREN") this.consume();
        }
      }
      return null;
    }

    if (this.checkKeyword("use")) {
      this.consume();
      if (this.peek()?.type === "IDENT") this.consume();
      return null;
    }

    if (this.checkKeyword("contains")) {
      this.consume();
      return null;
    }

    if (this.checkKeyword("implicit")) {
      this.consume();
      if (this.checkKeyword("none")) this.consume();
      return null;
    }

    if (this.checkKeyword("return") || this.checkKeyword("continue")) {
      this.consume();
      return null;
    }

    if (this.checkKeyword("end")) {
      this.consume();
      if (
        this.checkKeyword("subroutine") ||
        this.checkKeyword("function") ||
        this.checkKeyword("program") ||
        this.checkKeyword("module")
      ) {
        this.consume();
        if (this.peek()?.type === "IDENT" && this.peek()?.line === stmtLine) {
          this.consume();
        }
      }
      return null;
    }

    // ALLOCATE(A(n, m), B(k))
    if (this.checkKeyword("allocate")) {
      this.consume(); // eat 'allocate'
      const items: { name: string; dims: { lower?: FortranExpr | undefined; upper: FortranExpr }[] }[] = [];
      if (this.peek()?.type === "LPAREN") {
        this.consume();
        while (this.pos < this.tokens.length && this.peek()?.type !== "RPAREN") {
          if (this.peek()?.type === "IDENT") {
            const arrName = this.consume().value;
            const dims: { lower?: FortranExpr | undefined; upper: FortranExpr }[] = [];
            if (this.peek()?.type === "LPAREN") {
              this.consume();
              const subs = this.parseSubscriptList();
              for (const s of subs) {
                if (s.kind === "index") {
                  dims.push({ upper: s.expr });
                } else {
                  dims.push({
                    lower: s.start,
                    upper: s.end ?? { kind: "number", value: 1 },
                  });
                }
              }
              if (this.peek()?.type === "RPAREN") this.consume();
            }
            items.push({ name: arrName, dims });
          } else {
            this.consume();
          }
          if (this.peek()?.type === "COMMA") this.consume();
        }
        if (this.peek()?.type === "RPAREN") this.consume();
      }
      return { kind: "allocate", items, line: stmtLine };
    }

    // DEALLOCATE(A, B)
    if (this.checkKeyword("deallocate")) {
      this.consume(); // eat 'deallocate'
      const names: string[] = [];
      if (this.peek()?.type === "LPAREN") {
        this.consume();
        while (this.pos < this.tokens.length && this.peek()?.type !== "RPAREN") {
          if (this.peek()?.type === "IDENT") {
            names.push(this.consume().value);
          } else {
            this.consume();
          }
          if (this.peek()?.type === "COMMA") this.consume();
        }
        if (this.peek()?.type === "RPAREN") this.consume();
      }
      return { kind: "deallocate", names, line: stmtLine };
    }

    // PARAMETER (NAME = EXPR, ...)
    if (this.checkKeyword("parameter")) {
      this.consume();
      if (this.peek()?.type === "LPAREN") {
        this.consume();
        if (this.peek()?.type === "IDENT" && this.tokens[this.pos + 1]?.type === "ASSIGN") {
          const name = this.consume().value;
          this.consume(); // '='
          const expr = this.parseExpr();
          while (this.pos < this.tokens.length && this.peek()?.type !== "RPAREN") {
            this.consume();
          }
          if (this.peek()?.type === "RPAREN") this.consume();
          return { kind: "assign", target: { type: "var", name }, expr, line: stmtLine };
        }
      }
      return null;
    }

    // 1. IF Statement: IF (cond) THEN ... ELSE ... ENDIF or single-line IF (cond) stmt
    if (this.checkKeyword("if")) {
      this.consume(); // eat 'if'
      if (this.peek()?.type !== "LPAREN") return null;
      this.consume(); // eat '('
      const condition = this.parseExpr();
      if (this.peek()?.type === "RPAREN") {
        this.consume(); // eat ')'
      }

      // Check for block IF: 'THEN'
      if (this.checkKeyword("then")) {
        this.consume(); // eat 'then'
        const thenBody: FortranStmt[] = [];
        const elseBody: FortranStmt[] = [];
        let inElse = false;

        while (this.pos < this.tokens.length) {
          if (this.isEndIf()) {
            this.consumeEndIf();
            break;
          } else if (this.isElseIf()) {
            const elseIfLine = this.peek()?.line;
            this.consumeElseIf();
            if (this.peek()?.type === "LPAREN") this.consume();
            const elseIfCond = this.parseExpr();
            if (this.peek()?.type === "RPAREN") this.consume();
            if (this.checkKeyword("then")) this.consume();
            const nested = this.parseBlockUntilEndif();
            elseBody.push({
              kind: "if",
              condition: elseIfCond,
              thenBody: nested.thenBody,
              elseBody: nested.elseBody,
              line: elseIfLine,
            });
            break;
          } else if (this.checkKeyword("else")) {
            this.consume();
            inElse = true;
          } else {
            const innerStmt = this.parseStatement();
            if (innerStmt) {
              if (inElse) elseBody.push(innerStmt);
              else thenBody.push(innerStmt);
            }
          }
        }

        return {
          kind: "if",
          condition,
          thenBody,
          elseBody: elseBody.length > 0 ? elseBody : undefined,
          line: stmtLine,
        };
      } else {
        // Single-line IF: IF (cond) assignment/call
        const singleStmt = this.parseStatement();
        return {
          kind: "if",
          condition,
          thenBody: singleStmt ? [singleStmt] : [],
          line: stmtLine,
        };
      }
    }

    // 1b. DO Statement: DO var = start, end [, step] ... END DO
    if (this.checkKeyword("do")) {
      this.consume(); // eat 'do'
      if (this.peek()?.type === "NUMBER") {
        this.consume();
      }
      if (this.peek()?.type === "IDENT" && this.tokens[this.pos + 1]?.type === "ASSIGN") {
        const loopVar = this.consume().value;
        this.consume(); // eat '='
        const startExpr = this.parseExpr();
        if (this.peek()?.type === "COMMA") this.consume();
        const endExpr = this.parseExpr();
        let stepExpr: FortranExpr | undefined;
        if (this.peek()?.type === "COMMA") {
          this.consume();
          stepExpr = this.parseExpr();
        }
        const body: FortranStmt[] = [];
        while (this.pos < this.tokens.length) {
          if (this.isEndDo()) {
            this.consumeEndDo();
            break;
          }
          const inner = this.parseStatement();
          if (inner) body.push(inner);
        }
        return {
          kind: "do",
          loopVar,
          startExpr,
          endExpr,
          stepExpr,
          body,
          line: stmtLine,
        };
      }
      return null;
    }

    // 2. CALL Statement: CALL Subroutine(args)
    if (this.checkKeyword("call")) {
      this.consume(); // eat 'call'
      const subName = this.consume().value;
      const args: FortranExpr[] = [];
      if (this.peek()?.type === "LPAREN") {
        this.consume();
        while (this.pos < this.tokens.length && this.peek()?.type !== "RPAREN") {
          args.push(this.parseExpr());
          if (this.peek()?.type === "COMMA") {
            this.consume();
          }
        }
        if (this.peek()?.type === "RPAREN") this.consume();
      }
      return { kind: "call", subroutine: subName, args, line: stmtLine };
    }

    // 3. Assignment Statement: target = expr
    if (tok.type === "PORT") {
      this.consume();
      if (this.peek()?.type === "ASSIGN") {
        this.consume();
        const expr = this.parseExpr();
        return { kind: "assign", target: { type: "port", portName: tok.value }, expr, line: stmtLine };
      }
      return null;
    } else if (tok.type === "IDENT") {
      const name = tok.value;
      const upper = name.toUpperCase();

      // Check state pointer advance: NSTORF = NSTORF + 1 or NSTORI = NSTORI + 1
      if ((upper === "NSTORF" || upper === "NSTORI") && this.tokens[this.pos + 1]?.type === "ASSIGN") {
        this.consume(); // eat name
        this.consume(); // eat '='
        this.parseExpr();
        const array = upper === "NSTORF" ? ("storf" as const) : ("stori" as const);
        return { kind: "stateAdvance", array, delta: 1, line: stmtLine };
      }

      // Check state array assignment: STORF(idx) = ... or STORI(idx) = ... or SD(idx) = ...
      if (upper === "STORF" || upper === "STORI" || upper === "SD" || upper === "S") {
        if (this.tokens[this.pos + 1]?.type === "LPAREN") {
          this.consume();
          this.consume(); // eat '('
          const indexExpr = this.parseExpr();
          if (this.peek()?.type === "RPAREN") this.consume();
          if (this.peek()?.type === "ASSIGN") {
            this.consume();
            const expr = this.parseExpr();
            const array = upper === "STORI" ? ("stori" as const) : ("storf" as const);
            return { kind: "assign", target: { type: "state", array, indexExpr }, expr, line: stmtLine };
          }
          return null;
        }
      }

      // Skip type keywords like REAL(8), INTENT(IN), INTEGER, DOUBLE PRECISION, etc.
      if (
        [
          "REAL",
          "INTEGER",
          "DOUBLE",
          "PRECISION",
          "LOGICAL",
          "COMPLEX",
          "CHARACTER",
          "INTENT",
          "DIMENSION",
          "SAVE",
          "ALLOCATABLE",
          "OPTIONAL",
          "VALUE",
          "PURE",
          "ELEMENTAL",
          "RECURSIVE",
        ].includes(upper)
      ) {
        this.consume();
        if (this.peek()?.type === "LPAREN") {
          let depth = 0;
          while (this.pos < this.tokens.length) {
            const t = this.consume();
            if (t.type === "LPAREN") depth++;
            else if (t.type === "RPAREN") {
              depth--;
              if (depth <= 0) break;
            }
          }
        }
        return null;
      }

      // Check general array / slice assignment: A(i, j) = expr or A(1:3) = expr
      this.consume(); // eat identifier
      if (this.peek()?.type === "LPAREN") {
        this.consume(); // eat '('
        const subscripts = this.parseSubscriptList();
        if (this.peek()?.type === "RPAREN") this.consume();
        if (this.peek()?.type === "ASSIGN") {
          this.consume(); // eat '='
          const expr = this.parseExpr();
          return {
            kind: "assign",
            target: { type: "array", name, subscripts },
            expr,
            line: stmtLine,
          };
        }
        return null;
      }

      // Standard variable assignment: Var = Expr
      if (this.peek()?.type === "ASSIGN") {
        this.consume();
        const expr = this.parseExpr();
        return { kind: "assign", target: { type: "var", name }, expr, line: stmtLine };
      }
      return null;
    }

    // Skip stray token
    this.consume();
    return null;
  }

  private parseBlockUntilEndif(): { thenBody: FortranStmt[]; elseBody?: FortranStmt[] | undefined } {
    const thenBody: FortranStmt[] = [];
    const elseBody: FortranStmt[] = [];
    let inElse = false;

    while (this.pos < this.tokens.length) {
      if (this.isEndIf()) {
        this.consumeEndIf();
        break;
      } else if (this.isElseIf()) {
        const elseIfLine = this.peek()?.line;
        this.consumeElseIf();
        if (this.peek()?.type === "LPAREN") this.consume();
        const elseIfCond = this.parseExpr();
        if (this.peek()?.type === "RPAREN") this.consume();
        if (this.checkKeyword("then")) this.consume();
        const nested = this.parseBlockUntilEndif();
        elseBody.push({
          kind: "if",
          condition: elseIfCond,
          thenBody: nested.thenBody,
          elseBody: nested.elseBody,
          line: elseIfLine,
        });
        break;
      } else if (this.checkKeyword("else")) {
        this.consume();
        inElse = true;
      } else {
        const stmt = this.parseStatement();
        if (stmt) {
          if (inElse) elseBody.push(stmt);
          else thenBody.push(stmt);
        }
      }
    }

    return { thenBody, elseBody: elseBody.length > 0 ? elseBody : undefined };
  }

  // ===========================================================================
  // Expression Parser (Precedence Climbing)
  // ===========================================================================

  public parseExpr(): FortranExpr {
    return this.parseLogicalOr();
  }

  private parseLogicalOr(): FortranExpr {
    let left = this.parseLogicalAnd();
    while (this.peek()?.type === "OP" && this.peek()?.value === "||") {
      this.consume();
      const right = this.parseLogicalAnd();
      left = { kind: "binary", op: "||", left, right };
    }
    return left;
  }

  private parseLogicalAnd(): FortranExpr {
    let left = this.parseEquality();
    while (this.peek()?.type === "OP" && this.peek()?.value === "&&") {
      this.consume();
      const right = this.parseEquality();
      left = { kind: "binary", op: "&&", left, right };
    }
    return left;
  }

  private parseEquality(): FortranExpr {
    let left = this.parseRelational();
    while (this.peek()?.type === "OP" && (this.peek()?.value === "==" || this.peek()?.value === "!=")) {
      const op = this.consume().value as "==" | "!=";
      const right = this.parseRelational();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseRelational(): FortranExpr {
    let left = this.parseAdditive();
    while (this.peek()?.type === "OP" && ["<", "<=", ">", ">="].includes(this.peek()?.value ?? "")) {
      const op = this.consume().value as "<" | "<=" | ">" | ">=";
      const right = this.parseAdditive();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseAdditive(): FortranExpr {
    let left = this.parseMultiplicative();
    while (this.peek()?.type === "OP" && (this.peek()?.value === "+" || this.peek()?.value === "-")) {
      const op = this.consume().value as "+" | "-";
      const right = this.parseMultiplicative();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMultiplicative(): FortranExpr {
    let left = this.parsePower();
    while (this.peek()?.type === "OP" && (this.peek()?.value === "*" || this.peek()?.value === "/")) {
      const op = this.consume().value as "*" | "/";
      const right = this.parsePower();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parsePower(): FortranExpr {
    let left = this.parseUnary();
    while (this.peek()?.type === "OP" && this.peek()?.value === "^") {
      this.consume();
      const right = this.parseUnary();
      left = { kind: "binary", op: "^", left, right };
    }
    return left;
  }

  private parseUnary(): FortranExpr {
    const tok = this.peek();
    if (tok?.type === "OP" && (tok.value === "!" || tok.value === "-")) {
      const op = this.consume().value as "!" | "-";
      return { kind: "unary", op, expr: this.parseUnary() };
    }
    if (tok?.type === "OP" && tok.value === "+") {
      this.consume();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FortranExpr {
    const tok = this.consume();
    if (!tok) return { kind: "number", value: 0 };

    if (tok.type === "LPAREN") {
      const inner = this.parseExpr();
      if (this.peek()?.type === "RPAREN") {
        this.consume();
      }
      return inner;
    }

    // Array constructor: [1.0, 2.0, 3.0] or (/ 1.0, 2.0, 3.0 /)
    if (tok.type === "LBRACK") {
      const elements: FortranExpr[] = [];
      while (this.pos < this.tokens.length && this.peek()?.type !== "RBRACK") {
        elements.push(this.parseExpr());
        if (this.peek()?.type === "COMMA") this.consume();
      }
      if (this.peek()?.type === "RBRACK") this.consume();
      return { kind: "arrayConstructor", elements };
    }

    if (tok.type === "NUMBER") {
      return { kind: "number", value: parseFloat(tok.value) || 0 };
    }

    if (tok.type === "STRING") {
      return { kind: "string", value: tok.value };
    }

    if (tok.type === "KEYWORD") {
      if (tok.value === "true") return { kind: "boolean", value: true };
      if (tok.value === "false") return { kind: "boolean", value: false };
    }

    if (tok.type === "PORT") {
      return { kind: "port", portName: tok.value };
    }

    if (tok.type === "IDENT") {
      const upper = tok.value.toUpperCase();
      const lower = tok.value.toLowerCase();

      // Special EMTDC runtime identifiers
      if (upper === "TIME" || upper === "DELT" || upper === "FIRSTSTEP") {
        return { kind: "special", name: upper };
      }

      // State register reads: STORF(idx), STORI(idx), S(idx), SD(idx)
      if (upper === "STORF" || upper === "STORI" || upper === "S" || upper === "SD") {
        if (this.peek()?.type === "LPAREN") {
          this.consume();
          const indexExpr = this.parseExpr();
          if (this.peek()?.type === "RPAREN") this.consume();
          return {
            kind: "state",
            array: upper === "STORI" ? "stori" : "storf",
            indexExpr,
          };
        }
      }

      // Math & array intrinsic functions: e.g. sqrt(x), abs(x), sum(A), dot_product(u, v)
      if (FORTRAN_MATH_FUNCS.has(lower)) {
        if (this.peek()?.type === "LPAREN") {
          this.consume();
          const args: FortranExpr[] = [];
          while (this.pos < this.tokens.length && this.peek()?.type !== "RPAREN") {
            args.push(this.parseExpr());
            if (this.peek()?.type === "COMMA") this.consume();
          }
          if (this.peek()?.type === "RPAREN") this.consume();
          return { kind: "math", func: lower, args };
        }
      }

      // General array access A(i, j), array slice A(1:3), or user-defined function call f(x, y)
      if (this.peek()?.type === "LPAREN") {
        this.consume(); // eat '('
        const subscripts = this.parseSubscriptList();
        if (this.peek()?.type === "RPAREN") this.consume();
        return { kind: "arrayAccess", name: tok.value, subscripts };
      }

      return { kind: "var", name: tok.value };
    }

    return { kind: "number", value: 0 };
  }
}

export function parseFortranScript(code: string): FortranStmt[] {
  const tokens = tokenizeFortran(code);
  const parser = new FortranAstParser(tokens);
  return parser.parseProgram();
}

function collectCallsFromExpr(expr: FortranExpr, out: Set<string>, arrayNames: Set<string>): void {
  switch (expr.kind) {
    case "binary":
      collectCallsFromExpr(expr.left, out, arrayNames);
      collectCallsFromExpr(expr.right, out, arrayNames);
      break;
    case "unary":
      collectCallsFromExpr(expr.expr, out, arrayNames);
      break;
    case "math":
      for (const a of expr.args) collectCallsFromExpr(a, out, arrayNames);
      break;
    case "arrayConstructor":
      for (const e of expr.elements) collectCallsFromExpr(e, out, arrayNames);
      break;
    case "arrayAccess": {
      const u = expr.name.toUpperCase();
      if (!arrayNames.has(u)) {
        out.add(u);
      }
      for (const s of expr.subscripts) {
        if (s.kind === "index") collectCallsFromExpr(s.expr, out, arrayNames);
        else {
          if (s.start) collectCallsFromExpr(s.start, out, arrayNames);
          if (s.end) collectCallsFromExpr(s.end, out, arrayNames);
          if (s.stride) collectCallsFromExpr(s.stride, out, arrayNames);
        }
      }
      break;
    }
    default:
      break;
  }
}

function collectCallsFromStmts(stmts: FortranStmt[], out: Set<string>, arrayNames: Set<string>): void {
  for (const s of stmts) {
    if (s.kind === "call") {
      out.add(s.subroutine.toUpperCase());
      for (const a of s.args) collectCallsFromExpr(a, out, arrayNames);
    } else if (s.kind === "assign") {
      collectCallsFromExpr(s.expr, out, arrayNames);
    } else if (s.kind === "if") {
      collectCallsFromExpr(s.condition, out, arrayNames);
      collectCallsFromStmts(s.thenBody, out, arrayNames);
      if (s.elseBody) collectCallsFromStmts(s.elseBody, out, arrayNames);
    } else if (s.kind === "do") {
      collectCallsFromExpr(s.startExpr, out, arrayNames);
      collectCallsFromExpr(s.endExpr, out, arrayNames);
      if (s.stepExpr) collectCallsFromExpr(s.stepExpr, out, arrayNames);
      collectCallsFromStmts(s.body, out, arrayNames);
    }
  }
}

/**
 * Parses a Fortran file containing one or more `MODULE`, `PROGRAM`, `SUBROUTINE`, or `FUNCTION`
 * units (including `CONTAINS` subprograms) into a structured `FortranModuleAst` with call graph.
 */
export function parseFortranModule(source: string): FortranModuleAst {
  const lines = source.split(/\r?\n/);
  const units = new Map<string, FortranUnitAst>();
  const moduleConstants: Record<string, number> = {};

  interface UnitSpan {
    name: string;
    kind: "subroutine" | "function" | "program" | "module";
    startLine: number;
    endLine: number;
  }

  const spans: UnitSpan[] = [];
  let activeSubOrFunc: UnitSpan | null = null;
  let activeProg: UnitSpan | null = null;
  let inModuleHeader = false;

  for (let idx = 0; idx < lines.length; idx++) {
    const bangIdx = lines[idx]!.indexOf("!");
    const clean = (bangIdx !== -1 ? lines[idx]!.slice(0, bangIdx) : lines[idx]!).trim();
    if (!clean || clean.startsWith("#")) continue;

    if (/^module\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.test(clean) && !/^module\s+procedure\b/i.test(clean)) {
      inModuleHeader = true;
      continue;
    }
    if (/^contains\b/i.test(clean)) {
      inModuleHeader = false;
      if (activeProg) {
        activeProg.endLine = idx; // End executable body of program before CONTAINS
        spans.push(activeProg);
        activeProg = null;
      }
      continue;
    }
    if (inModuleHeader) {
      // Extract module-level constants
      const sig = extractFortranSignature(clean, moduleConstants);
      Object.assign(moduleConstants, sig.constants);
    }

    const subMatch =
      /^(?:(?:pure|elemental|recursive|real(?:\s*\([^)]*\))?|integer(?:\s*\([^)]*\))?|double\s+precision|logical)\s+)*(subroutine|function)\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(
        clean,
      );
    if (subMatch) {
      if (activeSubOrFunc) {
        activeSubOrFunc.endLine = idx;
        spans.push(activeSubOrFunc);
      }
      activeSubOrFunc = {
        name: subMatch[2]!,
        kind: subMatch[1]!.toLowerCase() === "function" ? "function" : "subroutine",
        startLine: idx + 1,
        endLine: lines.length,
      };
      continue;
    }

    const progMatch = /^program\s+([A-Za-z_][A-Za-z0-9_]*)\b/i.exec(clean);
    if (progMatch) {
      activeProg = {
        name: progMatch[1]!,
        kind: "program",
        startLine: idx + 1,
        endLine: lines.length,
      };
      continue;
    }

    if (/^end\s+(?:subroutine|function)\b/i.test(clean)) {
      if (activeSubOrFunc) {
        activeSubOrFunc.endLine = idx + 1;
        spans.push(activeSubOrFunc);
        activeSubOrFunc = null;
      }
      continue;
    }

    if (/^end\s+program\b/i.test(clean)) {
      if (activeProg) {
        activeProg.endLine = idx + 1;
        spans.push(activeProg);
        activeProg = null;
      }
      continue;
    }

    if (/^end\s*$/i.test(clean)) {
      if (activeSubOrFunc) {
        activeSubOrFunc.endLine = idx + 1;
        spans.push(activeSubOrFunc);
        activeSubOrFunc = null;
      } else if (activeProg) {
        activeProg.endLine = idx + 1;
        spans.push(activeProg);
        activeProg = null;
      }
    }
  }

  if (activeSubOrFunc) spans.push(activeSubOrFunc);
  if (activeProg) spans.push(activeProg);

  const callGraph = new Map<string, string[]>();

  if (spans.length === 0) {
    const sig = extractFortranSignature(source, moduleConstants);
    const stmts = parseFortranScript(source);
    const arrayNames = new Set(Object.keys(sig.arrays).map((k) => k.toUpperCase()));
    const calledSet = new Set<string>();
    collectCallsFromStmts(stmts, calledSet, arrayNames);
    const unit: FortranUnitAst = {
      name: sig.name,
      kind: sig.kind,
      returnVar: sig.returnVar,
      signature: sig,
      stmts,
      calledRoutines: Array.from(calledSet),
      usedModules: sig.usedModules ?? [],
      startLine: 1,
      endLine: lines.length,
    };
    units.set(unit.name.toUpperCase(), unit);
    callGraph.set(unit.name.toUpperCase(), unit.calledRoutines);
    return {
      units,
      moduleConstants,
      entryUnit: unit,
      callGraph,
    };
  }

  let entryUnit: FortranUnitAst | undefined;
  for (const span of spans) {
    const paddedSource = "\n".repeat(span.startLine - 1) + lines.slice(span.startLine - 1, span.endLine).join("\n");
    const sig = extractFortranSignature(paddedSource, moduleConstants);
    const stmts = parseFortranScript(paddedSource);
    const arrayNames = new Set(Object.keys(sig.arrays).map((k) => k.toUpperCase()));
    const calledSet = new Set<string>();
    collectCallsFromStmts(stmts, calledSet, arrayNames);

    const unit: FortranUnitAst = {
      name: span.name,
      kind: span.kind,
      returnVar: sig.returnVar,
      signature: sig,
      stmts,
      calledRoutines: Array.from(calledSet),
      usedModules: sig.usedModules ?? [],
      startLine: span.startLine,
      endLine: span.endLine,
    };
    units.set(unit.name.toUpperCase(), unit);
    callGraph.set(unit.name.toUpperCase(), unit.calledRoutines);

    if (unit.kind === "program" || !entryUnit) {
      entryUnit = unit;
    }
  }

  // If no explicit PROGRAM, prefer a subroutine that calls other subroutines in the module, or the first subroutine
  if (entryUnit && entryUnit.kind !== "program" && spans.length > 1) {
    for (const u of units.values()) {
      if (u.kind === "subroutine" && u.calledRoutines.some((c) => units.has(c))) {
        entryUnit = u;
        break;
      }
    }
  }

  return {
    units,
    moduleConstants,
    entryUnit: entryUnit!,
    callGraph,
  };
}

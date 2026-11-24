// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Recursive-descent parser for 20-sim SIDOPS / SIDOPS+ model & equation blocks.
 */

import type {
  BondGraphElementKind,
  SidopsEquation,
  SidopsExpr,
  TwentySimConnection,
  TwentySimParameter,
  TwentySimParseIssue,
  TwentySimPort,
  TwentySimSubmodel,
  TwentySimVariable,
} from "../types.js";

interface Token {
  kind: "ident" | "number" | "string" | "op" | "punct" | "eof";
  text: string;
  start: number;
  end: number;
  line: number;
  col: number;
}

const SECTION_KEYWORDS = new Set([
  "parameters",
  "constants",
  "variables",
  "ports",
  "interface",
  "implementation",
  "submodels",
  "connections",
  "initialequations",
  "equations",
  "code",
  "end",
]);

function tokenizeSidops(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = source.length;

  const advance = (count = 1): void => {
    for (let k = 0; k < count && i < n; k++) {
      if (source[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };

  while (i < n) {
    const ch = source[i]!;

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    // Line comment //
    if (ch === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") advance();
      continue;
    }

    // Block comment /* ... */
    if (ch === "/" && source[i + 1] === "*") {
      advance(2);
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) advance();
      if (i < n) advance(2);
      continue;
    }

    // String literal
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      const startLine = line;
      const startCol = col;
      advance();
      let value = "";
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < n) {
          advance();
          value += source[i]!;
          advance();
        } else {
          value += source[i]!;
          advance();
        }
      }
      if (i < n) advance();
      tokens.push({ kind: "string", text: value, start, end: i, line: startLine, col: startCol });
      continue;
    }

    // Number literal
    if ((ch >= "0" && ch <= "9") || (ch === "." && i + 1 < n && source[i + 1]! >= "0" && source[i + 1]! <= "9")) {
      const start = i;
      const startLine = line;
      const startCol = col;
      while (i < n && source[i]! >= "0" && source[i]! <= "9") advance();
      if (i < n && source[i] === "." && source[i + 1] !== ".") {
        advance();
        while (i < n && source[i]! >= "0" && source[i]! <= "9") advance();
      }
      if (i < n && (source[i] === "e" || source[i] === "E")) {
        advance();
        if (i < n && (source[i] === "+" || source[i] === "-")) advance();
        while (i < n && source[i]! >= "0" && source[i]! <= "9") advance();
      }
      tokens.push({ kind: "number", text: source.slice(start, i), start, end: i, line: startLine, col: startCol });
      continue;
    }

    // Identifier or keyword
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      const start = i;
      const startLine = line;
      const startCol = col;
      while (
        i < n &&
        ((source[i]! >= "a" && source[i]! <= "z") ||
          (source[i]! >= "A" && source[i]! <= "Z") ||
          (source[i]! >= "0" && source[i]! <= "9") ||
          source[i] === "_")
      ) {
        advance();
      }
      tokens.push({ kind: "ident", text: source.slice(start, i), start, end: i, line: startLine, col: startCol });
      continue;
    }

    // Multi-char operators
    const two = source.slice(i, i + 2);
    if (
      two === "=>" ||
      two === "->" ||
      two === "==" ||
      two === "<>" ||
      two === "!=" ||
      two === "<=" ||
      two === ">=" ||
      two === ":=" ||
      two === "**"
    ) {
      const start = i;
      const startLine = line;
      const startCol = col;
      advance(2);
      tokens.push({ kind: "op", text: two, start, end: i, line: startLine, col: startCol });
      continue;
    }

    // Single-char operators & punctuation
    const start = i;
    const startLine = line;
    const startCol = col;
    advance();
    if ("+-*/^=<>".includes(ch)) {
      tokens.push({ kind: "op", text: ch, start, end: i, line: startLine, col: startCol });
    } else {
      tokens.push({ kind: "punct", text: ch, start, end: i, line: startLine, col: startCol });
    }
  }

  tokens.push({ kind: "eof", text: "", start: n, end: n, line, col });
  return tokens;
}

export function inferBondGraphElementKind(typeName: string | undefined, name?: string): BondGraphElementKind {
  const raw = (typeName || name || "").trim();
  const norm = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (raw === "0" || norm === "0" || norm === "zerojunction" || norm === "0junction" || norm === "junction0")
    return "0";
  if (raw === "1" || norm === "1" || norm === "onejunction" || norm === "1junction" || norm === "junction1") return "1";
  if (norm === "r" || norm === "resistor" || norm === "resistance" || norm === "damper") return "R";
  if (norm === "c" || norm === "capacitor" || norm === "capacitance" || norm === "spring") return "C";
  if (norm === "i" || norm === "inductor" || norm === "inertia" || norm === "mass") return "I";
  if (norm === "se" || norm === "effortsource" || norm === "sourceeffort") return "Se";
  if (norm === "sf" || norm === "flowsource" || norm === "sourceflow") return "Sf";
  if (norm === "mse" || norm === "modulatedeffortsource") return "MSe";
  if (norm === "msf" || norm === "modulatedflowsource") return "MSf";
  if (norm === "tf" || norm === "transformer") return "TF";
  if (norm === "gy" || norm === "gyrator") return "GY";
  if (norm === "mtf" || norm === "modulatedtransformer") return "MTF";
  if (norm === "mgy" || norm === "modulatedgyrator") return "MGY";
  if (norm === "signal" || norm === "gain" || norm === "sum" || norm === "integrate" || norm === "constant")
    return "Signal";
  return "Submodel";
}

class SidopsRecursiveParser {
  private readonly tokens: Token[];
  private readonly source: string;
  private pos = 0;
  public readonly issues: TwentySimParseIssue[] = [];

  constructor(source: string) {
    this.source = source;
    this.tokens = tokenizeSidops(source);
  }

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private match(text: string): boolean {
    if (this.peek().text.toLowerCase() === text.toLowerCase()) {
      this.next();
      return true;
    }
    return false;
  }

  private isSectionHeader(): boolean {
    const tok = this.peek();
    if (tok.kind !== "ident") return false;
    const low = tok.text.toLowerCase();
    if (!SECTION_KEYWORDS.has(low)) return false;
    // Ensure it's not used as a variable in an assignment like `code = 1;`
    const after = this.peek(1);
    if (after.text === "=" || after.text === ":=" || after.text === ".") return false;
    return true;
  }

  private skipUnitAnnotation(): string | undefined {
    if (this.peek().text !== "{") return undefined;
    this.next();
    const parts: string[] = [];
    while (this.peek().kind !== "eof" && this.peek().text !== "}") {
      parts.push(this.next().text);
    }
    if (this.peek().text === "}") this.next();
    return parts.join("").trim() || undefined;
  }

  public parseSubmodel(defaultName = "Main"): TwentySimSubmodel {
    let name = defaultName;
    const ports: TwentySimPort[] = [];
    const parameters: TwentySimParameter[] = [];
    const variables: TwentySimVariable[] = [];
    const initialEquations: SidopsEquation[] = [];
    const equations: SidopsEquation[] = [];
    const submodels: TwentySimSubmodel[] = [];
    const connections: TwentySimConnection[] = [];

    // Optional `model Name` or `submodel Name` header
    if (
      this.peek().kind === "ident" &&
      (this.peek().text.toLowerCase() === "model" || this.peek().text.toLowerCase() === "submodel")
    ) {
      this.next();
      if (this.peek().kind === "ident") {
        name = this.next().text;
      }
      if (this.peek().text === ";") this.next();
    }

    let currentSection: string = "equations";
    let connCounter = 0;

    while (this.peek().kind !== "eof") {
      const tok = this.peek();

      // Check section header
      if (this.isSectionHeader()) {
        const kw = this.next().text.toLowerCase();
        if (kw === "end") {
          // Optional trailing identifier and semicolon
          if (this.peek().kind === "ident" && !this.isSectionHeader()) this.next();
          if (this.peek().text === ";") this.next();
          break;
        }
        if (this.peek().text === ":") this.next();
        currentSection = kw;
        continue;
      }

      if (tok.text === ";") {
        this.next();
        continue;
      }

      switch (currentSection) {
        case "parameters":
        case "constants":
          this.parseParamOrVarDecl(parameters, variables, currentSection === "constants", true);
          break;
        case "variables":
          this.parseParamOrVarDecl(parameters, variables, false, false);
          break;
        case "ports":
        case "interface":
          this.parsePortDecl(ports);
          break;
        case "submodels":
          this.parseSubmodelInstance(submodels);
          break;
        case "connections":
          this.parseConnection(connections, () => `conn_${++connCounter}`);
          break;
        case "initialequations": {
          const eq = this.parseEquation(true);
          if (eq) initialEquations.push(eq);
          break;
        }
        case "equations":
        case "code":
        case "implementation": {
          const eq = this.parseEquation(false);
          if (eq) equations.push(eq);
          break;
        }
        default:
          this.next();
          break;
      }
    }

    return {
      name,
      elementKind: inferBondGraphElementKind(undefined, name),
      ports,
      parameters,
      variables,
      initialEquations,
      equations,
      submodels,
      connections,
      rawSidops: this.source,
    };
  }

  private parseParamOrVarDecl(
    parameters: TwentySimParameter[],
    variables: TwentySimVariable[],
    isConstant: boolean,
    isParamSection: boolean,
  ): void {
    const startTok = this.peek();
    let varType: "real" | "integer" | "boolean" | "string" = "real";
    let qualifier: TwentySimVariable["qualifier"] = "local";

    // Parse leading type and qualifiers (e.g., `real global x = 1.0 {m};`)
    while (this.peek().kind === "ident") {
      const low = this.peek().text.toLowerCase();
      if (low === "real" || low === "integer" || low === "boolean" || low === "string") {
        varType = low;
        this.next();
      } else if (low === "global" || low === "hidden" || low === "interesting") {
        qualifier = low;
        this.next();
      } else if (low === "parameter" || low === "constant") {
        this.next();
      } else {
        break;
      }
    }

    if (this.peek().kind !== "ident") {
      this.recoverToSemicolon();
      return;
    }

    // Comma-separated declarations
    while (this.peek().kind === "ident") {
      const nameTok = this.next();
      let expr: SidopsExpr | undefined;
      let numericVal: number | boolean | string | undefined;

      // Optional array dimensions `[n]`
      if (this.peek().text === "[") {
        while (this.peek().kind !== "eof" && this.peek().text !== "]") this.next();
        if (this.peek().text === "]") this.next();
      }

      if (this.peek().text === "=" || this.peek().text === ":=") {
        this.next();
        expr = this.parseExpr();
        numericVal = evalLiteralValue(expr);
      }

      const unit = this.skipUnitAnnotation();

      if (isParamSection || isConstant) {
        parameters.push({
          name: nameTok.text,
          type: varType,
          value: numericVal,
          expr,
          unit,
          isConstant,
          line: nameTok.line,
          startOffset: startTok.start,
          endOffset: this.peek().start,
        });
      } else {
        variables.push({
          name: nameTok.text,
          type: varType,
          qualifier,
          initialValue: typeof numericVal === "number" ? numericVal : undefined,
          unit,
          line: nameTok.line,
          startOffset: startTok.start,
          endOffset: this.peek().start,
        });
      }

      if (this.peek().text === ",") {
        this.next();
      } else {
        break;
      }
    }

    if (this.peek().text === ";") this.next();
  }

  private parsePortDecl(ports: TwentySimPort[]): void {
    const startTok = this.peek();
    let kind: TwentySimPort["kind"] = "power";
    let direction: TwentySimPort["direction"] = "inout";
    let restriction: TwentySimPort["restriction"] = "none";

    // Handle `port p (effort = e, flow = f);` or `power p;` or `real in u;` or `real out y;`
    while (this.peek().kind === "ident") {
      const low = this.peek().text.toLowerCase();
      if (low === "power" || low === "bond" || low === "port") {
        kind = "power";
        this.next();
      } else if (low === "signal") {
        kind = "signal";
        this.next();
      } else if (low === "real" || low === "integer" || low === "boolean") {
        kind = "signal";
        this.next();
      } else if (low === "in" || low === "input") {
        kind = "signal";
        direction = "in";
        this.next();
      } else if (low === "out" || low === "output") {
        kind = "signal";
        direction = "out";
        this.next();
      } else if (low === "effort") {
        restriction = "effort";
        this.next();
      } else if (low === "flow") {
        restriction = "flow";
        this.next();
      } else {
        break;
      }
    }

    if (this.peek().kind !== "ident") {
      this.recoverToSemicolon();
      return;
    }

    const nameTok = this.next();
    let effortVar: string | undefined;
    let flowVar: string | undefined;

    // Optional `(effort = e, flow = f)`
    if (this.peek().text === "(") {
      this.next();
      while (this.peek().kind !== "eof" && this.peek().text !== ")") {
        const key = this.next().text.toLowerCase();
        if (this.peek().text === "=") this.next();
        const val = this.peek().kind === "ident" ? this.next().text : "";
        if (key === "effort" || key === "e") effortVar = val;
        if (key === "flow" || key === "f") flowVar = val;
        if (this.peek().text === ",") this.next();
      }
      if (this.peek().text === ")") this.next();
    }

    this.skipUnitAnnotation();
    if (this.peek().text === ";") this.next();

    ports.push({
      name: nameTok.text,
      kind,
      direction,
      effortVar: effortVar ?? (kind === "power" ? `${nameTok.text}.e` : undefined),
      flowVar: flowVar ?? (kind === "power" ? `${nameTok.text}.f` : undefined),
      restriction,
      line: nameTok.line,
      startOffset: startTok.start,
      endOffset: this.peek().start,
    });
  }

  private parseSubmodelInstance(submodels: TwentySimSubmodel[]): void {
    const startTok = this.peek();
    if (this.peek().kind !== "ident" && this.peek().kind !== "number") {
      this.recoverToSemicolon();
      return;
    }
    const typeTok = this.next();
    let nameTok = typeTok;
    if (this.peek().kind === "ident") {
      nameTok = this.next();
    }

    const parameters: TwentySimParameter[] = [];
    if (this.peek().text === "(") {
      this.next();
      while (this.peek().kind !== "eof" && this.peek().text !== ")") {
        if (this.peek().kind === "ident") {
          const pName = this.next();
          if (this.peek().text === "=" || this.peek().text === ":=") this.next();
          const expr = this.parseExpr();
          parameters.push({
            name: pName.text,
            type: "real",
            value: evalLiteralValue(expr),
            expr,
            line: pName.line,
          });
        } else {
          this.next();
        }
        if (this.peek().text === ",") this.next();
      }
      if (this.peek().text === ")") this.next();
    }

    if (this.peek().text === ";") this.next();

    const elementKind = inferBondGraphElementKind(typeTok.text, nameTok.text);
    submodels.push({
      name: nameTok.text,
      elementKind,
      typeName: typeTok.text,
      ports: defaultPortsForElement(elementKind),
      parameters,
      variables: [],
      initialEquations: [],
      equations: [],
      submodels: [],
      connections: [],
      line: startTok.line,
      startOffset: startTok.start,
      endOffset: this.peek().start,
    });
  }

  private parseConnection(connections: TwentySimConnection[], nextId: () => string): void {
    const startTok = this.peek();
    if (this.peek().kind !== "ident") {
      this.recoverToSemicolon();
      return;
    }
    const fromSub = this.next().text;
    let fromPort = "p";
    if (this.peek().text === ".") {
      this.next();
      if (this.peek().kind === "ident" || this.peek().kind === "number") {
        fromPort = this.next().text;
      }
    }

    const opTok = this.peek();
    let kind: "bond" | "signal" = "bond";
    if (opTok.text === "=>" || opTok.text === "->" || opTok.text === "=") {
      this.next();
      kind = opTok.text === "->" ? "signal" : "bond";
    } else {
      this.issues.push({
        message: `Expected connection operator '=>' or '->' after '${fromSub}.${fromPort}'`,
        line: opTok.line,
        column: opTok.col,
        startOffset: opTok.start,
        endOffset: opTok.end,
      });
      this.recoverToSemicolon();
      return;
    }

    if (this.peek().kind !== "ident") {
      this.recoverToSemicolon();
      return;
    }
    const toSub = this.next().text;
    let toPort = "p";
    if (this.peek().text === ".") {
      this.next();
      if (this.peek().kind === "ident" || this.peek().kind === "number") {
        toPort = this.next().text;
      }
    }

    if (this.peek().text === ";") this.next();

    connections.push({
      id: nextId(),
      kind,
      fromSubmodel: fromSub,
      fromPort,
      toSubmodel: toSub,
      toPort,
      line: startTok.line,
      startOffset: startTok.start,
      endOffset: this.peek().start,
    });
  }

  private parseEquation(isInitial: boolean): SidopsEquation | null {
    const startTok = this.peek();
    const lhs = this.parseExpr();

    if (this.peek().text === "=" || this.peek().text === ":=") {
      this.next();
      const rhs = this.parseExpr();
      const endOffset = this.peek().start;
      if (this.peek().text === ";") this.next();
      return {
        lhs,
        rhs,
        isInitial,
        rawText: this.source.slice(startTok.start, endOffset).trim(),
        line: startTok.line,
        startOffset: startTok.start,
        endOffset,
      };
    }

    this.issues.push({
      message: `Expected '=' in SIDOPS equation near '${this.peek().text || "EOF"}'`,
      line: this.peek().line,
      column: this.peek().col,
      startOffset: this.peek().start,
      endOffset: this.peek().end,
    });
    this.recoverToSemicolon();
    return null;
  }

  private recoverToSemicolon(): void {
    while (this.peek().kind !== "eof" && this.peek().text !== ";" && !this.isSectionHeader()) {
      this.next();
    }
    if (this.peek().text === ";") this.next();
  }

  private parseExpr(): SidopsExpr {
    if (this.peek().kind === "ident" && this.peek().text.toLowerCase() === "if") {
      this.next();
      const condition = this.parseOr();
      this.match("then");
      const thenExpr = this.parseExpr();
      this.match("else");
      const elseExpr = this.parseExpr();
      return { kind: "if", condition, thenExpr, elseExpr };
    }
    return this.parseOr();
  }

  private parseOr(): SidopsExpr {
    let left = this.parseAnd();
    while (this.peek().kind === "ident" && this.peek().text.toLowerCase() === "or") {
      this.next();
      const right = this.parseAnd();
      left = { kind: "binary", op: "or", left, right };
    }
    return left;
  }

  private parseAnd(): SidopsExpr {
    let left = this.parseComparison();
    while (this.peek().kind === "ident" && this.peek().text.toLowerCase() === "and") {
      this.next();
      const right = this.parseComparison();
      left = { kind: "binary", op: "and", left, right };
    }
    return left;
  }

  private parseComparison(): SidopsExpr {
    let left = this.parseAddSub();
    while (
      this.peek().text === "==" ||
      this.peek().text === "<>" ||
      this.peek().text === "!=" ||
      this.peek().text === "<" ||
      this.peek().text === "<=" ||
      this.peek().text === ">" ||
      this.peek().text === ">="
    ) {
      const rawOp = this.next().text;
      const op = rawOp === "!=" ? "<>" : (rawOp as "==" | "<>" | "<" | "<=" | ">" | ">=");
      const right = this.parseAddSub();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseAddSub(): SidopsExpr {
    let left = this.parseMulDiv();
    while (this.peek().text === "+" || this.peek().text === "-") {
      const op = this.next().text as "+" | "-";
      const right = this.parseMulDiv();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMulDiv(): SidopsExpr {
    let left = this.parsePow();
    while (this.peek().text === "*" || this.peek().text === "/") {
      const op = this.next().text as "*" | "/";
      const right = this.parsePow();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parsePow(): SidopsExpr {
    let left = this.parseUnary();
    if (this.peek().text === "^" || this.peek().text === "**") {
      this.next();
      const right = this.parsePow();
      left = { kind: "binary", op: "^", left, right };
    }
    return left;
  }

  private parseUnary(): SidopsExpr {
    if (this.peek().text === "+" || this.peek().text === "-") {
      const op = this.next().text as "+" | "-";
      return { kind: "unary", op, operand: this.parseUnary() };
    }
    if (this.peek().kind === "ident" && this.peek().text.toLowerCase() === "not") {
      this.next();
      return { kind: "unary", op: "not", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): SidopsExpr {
    const tok = this.peek();

    if (tok.kind === "number") {
      this.next();
      return { kind: "number", value: Number(tok.text) };
    }

    if (tok.kind === "string") {
      this.next();
      return { kind: "string", value: tok.text };
    }

    if (tok.text === "(") {
      this.next();
      const inner = this.parseExpr();
      if (this.peek().text === ")") this.next();
      return inner;
    }

    if (tok.kind === "ident") {
      this.next();
      const low = tok.text.toLowerCase();
      if (low === "true") return { kind: "boolean", value: true };
      if (low === "false") return { kind: "boolean", value: false };

      // Function call
      if (this.peek().text === "(") {
        this.next();
        const args: SidopsExpr[] = [];
        while (this.peek().kind !== "eof" && this.peek().text !== ")") {
          args.push(this.parseExpr());
          if (this.peek().text === ",") this.next();
          else break;
        }
        if (this.peek().text === ")") this.next();
        return { kind: "call", callee: tok.text, args };
      }

      // Member access e.g. `p.e` or `p1.f`
      if (this.peek().text === ".") {
        this.next();
        if (this.peek().kind === "ident") {
          const field = this.next().text;
          return { kind: "member", object: tok.text, field };
        }
      }

      return { kind: "ident", name: tok.text };
    }

    // Fallback for unexpected token
    this.next();
    return { kind: "number", value: 0 };
  }
}

export function evalLiteralValue(expr: SidopsExpr | undefined): number | boolean | string | undefined {
  if (!expr) return undefined;
  switch (expr.kind) {
    case "number":
      return expr.value;
    case "boolean":
      return expr.value;
    case "string":
      return expr.value;
    case "unary": {
      const inner = evalLiteralValue(expr.operand);
      if (typeof inner === "number") {
        if (expr.op === "-") return -inner;
        if (expr.op === "+") return inner;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

export function defaultPortsForElement(kind: BondGraphElementKind): TwentySimPort[] {
  switch (kind) {
    case "R":
    case "C":
    case "I":
    case "Se":
    case "Sf":
      return [
        {
          name: "p",
          kind: "power",
          direction: "inout",
          effortVar: "p.e",
          flowVar: "p.f",
          restriction: kind === "Se" ? "effort" : kind === "Sf" ? "flow" : "none",
        },
      ];
    case "MSe":
    case "MSf":
      return [
        {
          name: "p",
          kind: "power",
          direction: "inout",
          effortVar: "p.e",
          flowVar: "p.f",
          restriction: kind === "MSe" ? "effort" : "flow",
        },
        {
          name: "effort",
          kind: "signal",
          direction: "in",
        },
      ];
    case "TF":
    case "GY":
      return [
        { name: "p1", kind: "power", direction: "inout", effortVar: "p1.e", flowVar: "p1.f" },
        { name: "p2", kind: "power", direction: "inout", effortVar: "p2.e", flowVar: "p2.f" },
      ];
    case "MTF":
    case "MGY":
      return [
        { name: "p1", kind: "power", direction: "inout", effortVar: "p1.e", flowVar: "p1.f" },
        { name: "p2", kind: "power", direction: "inout", effortVar: "p2.e", flowVar: "p2.f" },
        { name: "r", kind: "signal", direction: "in" },
      ];
    case "0":
    case "1":
      return [{ name: "p", kind: "power", direction: "inout", effortVar: "p.e", flowVar: "p.f" }];
    default:
      return [];
  }
}

/**
 * Parse a standalone SIDOPS / SIDOPS+ model or embedded SpecificationCode block.
 */
export function parseSidops(
  source: string,
  defaultName = "Main",
): { submodel: TwentySimSubmodel; issues: TwentySimParseIssue[] } {
  const parser = new SidopsRecursiveParser(source);
  const submodel = parser.parseSubmodel(defaultName);
  return { submodel, issues: parser.issues };
}

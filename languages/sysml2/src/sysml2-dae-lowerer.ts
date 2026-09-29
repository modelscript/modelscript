// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Direct Lowering of SysML v2 Calculations and Action Scripts
 * into the linear-memory DAEBuilder arena.
 *
 * Compiles SysML v2 imperative behaviors (action assignments, while loops, if-else,
 * calculations) directly into `DAEBuilder` integer IDs (ExprId, StmtId), enabling:
 *   1. Zero-GC execution via `executeArenaStatements`.
 *   2. Seamless integration into the continuous/discrete hybrid simulation pipeline.
 *   3. Expression autodiff tape construction.
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  executeArenaStatements,
  initBltWasm,
  StmtKind,
  UnaryOp,
  VarAttrKind,
  Variability,
  VarType,
} from "@modelscript/runtime";

export interface LoweredActionDae {
  arena: DAEBuilder;
  name: string;
  inputs: string[];
  outputs: string[];
  locals: string[];
  startStmtIdx: number;
  stmtCount: number;
}

export interface LoweredConstraintDae {
  arena: DAEBuilder;
  name: string;
  parameters: string[];
  states: string[];
  derivatives: string[];
  eqCount: number;
}

export interface SysML2Token {
  type: "num" | "ident" | "op" | "paren" | "semi" | "kw";
  val: string;
}

/**
 * Tokenizes simple SysML v2 calculation expressions and statements.
 */
export function tokenizeSysml(input: string): SysML2Token[] {
  const tokens: SysML2Token[] = [];
  const regex =
    /\s*(?:(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_.]*)|(==|!=|<=|>=|:=|&&|\|\||\*\*|\^|[+\-*/%=<>!])|([();{},]))/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(input)) !== null) {
    if (m[1] !== undefined) {
      tokens.push({ type: "num", val: m[1] });
    } else if (m[2] !== undefined) {
      const v = m[2];
      if (
        [
          "action",
          "calc",
          "def",
          "in",
          "out",
          "item",
          "attribute",
          "assign",
          "return",
          "if",
          "else",
          "while",
          "loop",
          "true",
          "false",
          "and",
          "or",
          "not",
        ].includes(v)
      ) {
        tokens.push({ type: "kw", val: v });
      } else {
        tokens.push({ type: "ident", val: v });
      }
    } else if (m[3] !== undefined) {
      tokens.push({ type: "op", val: m[3] });
    } else if (m[4] !== undefined) {
      tokens.push({ type: m[4] === ";" ? "semi" : "paren", val: m[4] });
    }
  }
  return tokens;
}

/**
 * Expression parser generating DAE arena ExprIds.
 */
class SysmlExprParser {
  private pos = 0;

  constructor(
    private tokens: SysML2Token[],
    private arena: DAEBuilder,
  ) {}

  public parse(): number {
    return this.parseLogicalOr();
  }

  private peek(): SysML2Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): SysML2Token {
    return this.tokens[this.pos++]!;
  }

  private matchOp(...ops: string[]): string | null {
    const t = this.peek();
    if (t && (t.type === "op" || (t.type === "kw" && (t.val === "and" || t.val === "or"))) && ops.includes(t.val)) {
      this.pos++;
      return t.val;
    }
    return null;
  }

  private parseLogicalOr(): number {
    let left = this.parseLogicalAnd();
    while (this.matchOp("||", "or")) {
      const right = this.parseLogicalAnd();
      left = this.arena.addBinaryExpr(BinOp.Or, left, right);
    }
    return left;
  }

  private parseLogicalAnd(): number {
    let left = this.parseEquality();
    while (this.matchOp("&&", "and")) {
      const right = this.parseEquality();
      left = this.arena.addBinaryExpr(BinOp.And, left, right);
    }
    return left;
  }

  private parseEquality(): number {
    let left = this.parseRelational();
    let op: string | null;
    while ((op = this.matchOp("==", "!="))) {
      const right = this.parseRelational();
      left = this.arena.addBinaryExpr(op === "==" ? BinOp.Eq : BinOp.Neq, left, right);
    }
    return left;
  }

  private parseRelational(): number {
    let left = this.parseAdditive();
    let op: string | null;
    while ((op = this.matchOp("<", "<=", ">", ">="))) {
      const right = this.parseAdditive();
      const binOp = op === "<" ? BinOp.Lt : op === "<=" ? BinOp.Lte : op === ">" ? BinOp.Gt : BinOp.Gte;
      left = this.arena.addBinaryExpr(binOp, left, right);
    }
    return left;
  }

  private parseAdditive(): number {
    let left = this.parseMultiplicative();
    let op: string | null;
    while ((op = this.matchOp("+", "-"))) {
      const right = this.parseMultiplicative();
      left = this.arena.addBinaryExpr(op === "+" ? BinOp.Add : BinOp.Sub, left, right);
    }
    return left;
  }

  private parseMultiplicative(): number {
    let left = this.parsePower();
    let op: string | null;
    while ((op = this.matchOp("*", "/", "%"))) {
      const right = this.parsePower();
      left = this.arena.addBinaryExpr(op === "*" ? BinOp.Mul : BinOp.Div, left, right);
    }
    return left;
  }

  private parsePower(): number {
    let left = this.parseUnary();
    let op: string | null;
    while ((op = this.matchOp("^", "**"))) {
      const right = this.parseUnary();
      left = this.arena.addBinaryExpr(BinOp.Pow, left, right);
    }
    return left;
  }

  private parseUnary(): number {
    const t = this.peek();
    if (t && (t.type === "op" || t.type === "kw") && (t.val === "-" || t.val === "!" || t.val === "not")) {
      this.pos++;
      const operand = this.parseUnary();
      if (t.val === "-") {
        return this.arena.addUnaryExpr(UnaryOp.Negate, operand);
      } else {
        return this.arena.addUnaryExpr(UnaryOp.Not, operand);
      }
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const t = this.next();
    if (!t) return this.arena.addRealLiteral(0);

    if (t.type === "num") {
      const val = parseFloat(t.val);
      return this.arena.addRealLiteral(val);
    }
    if (t.type === "kw") {
      if (t.val === "true") return this.arena.addBoolLiteral(true);
      if (t.val === "false") return this.arena.addBoolLiteral(false);
    }
    if (t.type === "ident") {
      if (this.peek() && this.peek()!.type === "paren" && this.peek()!.val === "(") {
        this.next(); // consume '('
        const args: number[] = [];
        if (!(this.peek() && this.peek()!.type === "paren" && this.peek()!.val === ")")) {
          while (true) {
            args.push(this.parse());
            if (this.peek() && this.peek()!.val === ",") {
              this.next(); // consume ','
              continue;
            }
            break;
          }
        }
        if (this.peek() && this.peek()!.type === "paren" && this.peek()!.val === ")") {
          this.next(); // consume ')'
        }
        if (t.val === "der" && args.length === 1) {
          return this.arena.addDerExpr(args[0]!);
        }
        return this.arena.addCallExpr(t.val, args);
      }
      const nameId = this.arena.interner.intern(t.val);
      return this.arena.addName(nameId);
    }
    if (t.type === "paren" && t.val === "(") {
      const expr = this.parse();
      if (this.peek() && this.peek()!.val === ")") {
        this.next();
      }
      return expr;
    }

    return this.arena.addRealLiteral(0);
  }
}

type ParsedAstStmt =
  | { kind: "assign"; target: string; expr: string }
  | { kind: "while"; cond: string; body: ParsedAstStmt[] }
  | { kind: "if"; cond: string; thenBody: ParsedAstStmt[]; elseBody?: ParsedAstStmt[] }
  | { kind: "return"; expr?: string };

export class SysML2DaeLowerer {
  /**
   * Lowers an expression string into an arena ExprId.
   */
  public static lowerExpression(exprText: string, arena: DAEBuilder): number {
    const tokens = tokenizeSysml(exprText);
    const parser = new SysmlExprParser(tokens, arena);
    return parser.parse();
  }

  /**
   * Lowers a complete SysML v2 Action or Calculation definition into a DAEBuilder.
   */
  public static async lowerAction(sysmlSource: string, existingArena?: DAEBuilder): Promise<LoweredActionDae> {
    try {
      await initBltWasm();
    } catch {}

    const arena = existingArena ?? new DAEBuilder();

    // Extract name
    const nameMatch = /(?:action|calc)\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(sysmlSource);
    const name = nameMatch ? nameMatch[1]! : "AnonymousAction";

    const inputs: string[] = [];
    const outputs: string[] = [];
    const locals: string[] = [];

    // 1. Extract pins / parameters
    const pinRegex = /\b(in|out)\s+(?:item\s+|attribute\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z0-9_.]+))?/g;
    let pm: RegExpExecArray | null;
    while ((pm = pinRegex.exec(sysmlSource)) !== null) {
      const dir = pm[1];
      const pName = pm[2]!;
      const isInput = dir === "in";

      if (isInput) {
        inputs.push(pName);
        arena.addVariable(pName, VarType.Real, Variability.Continuous, Causality.Input);
      } else {
        outputs.push(pName);
        arena.addVariable(pName, VarType.Real, Variability.Continuous, Causality.Output);
      }
    }

    // Return parameter in calc def: return [name] : [type];
    const retParamMatch = /\breturn\s+(?:item\s+|attribute\s+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(sysmlSource);
    if (retParamMatch && !outputs.includes(retParamMatch[1]!)) {
      outputs.push(retParamMatch[1]!);
      arena.addVariable(retParamMatch[1]!, VarType.Real, Variability.Continuous, Causality.Output);
    }

    // 2. Extract action body
    const openBrace = sysmlSource.indexOf("{");
    const closeBrace = sysmlSource.lastIndexOf("}");
    const bodyText =
      openBrace !== -1 && closeBrace > openBrace ? sysmlSource.slice(openBrace + 1, closeBrace) : sysmlSource;

    const startStmtIdx = arena.stmtCount;

    // 3. Parse statements into structured AST
    const ast = this.parseStatementsToAst(bodyText);

    // 4. Lower AST to arena
    this.emitAstStatements(ast, arena, locals, outputs);

    const stmtCount = arena.stmtCount - startStmtIdx;

    return {
      arena,
      name,
      inputs,
      outputs,
      locals,
      startStmtIdx,
      stmtCount,
    };
  }

  private static parseStatementsToAst(bodyText: string): ParsedAstStmt[] {
    const stmts: ParsedAstStmt[] = [];
    let pos = 0;

    while (pos < bodyText.length) {
      while (pos < bodyText.length && /\s/.test(bodyText[pos]!)) pos++;
      if (pos >= bodyText.length) break;

      const remaining = bodyText.slice(pos);

      // 1. While loop: while (...) { ... }
      if (/^while\b/.test(remaining)) {
        const condMatch = /^while\s*\(([^)]+)\)\s*\{/.exec(remaining);
        if (condMatch) {
          const cond = condMatch[1]!.trim();
          const openBrace = pos + condMatch[0].length - 1;
          const { body, endPos } = this.extractBraceBlock(bodyText, openBrace);
          const bodyAst = this.parseStatementsToAst(body);
          stmts.push({ kind: "while", cond, body: bodyAst });
          pos = endPos;
          continue;
        }
      }

      // 2. If statement: if (...) { ... } [else { ... }]
      if (/^if\b/.test(remaining)) {
        const condMatch = /^if\s*\(([^)]+)\)\s*\{/.exec(remaining);
        if (condMatch) {
          const cond = condMatch[1]!.trim();
          const openBrace = pos + condMatch[0].length - 1;
          const { body: thenBody, endPos: thenEnd } = this.extractBraceBlock(bodyText, openBrace);
          const thenAst = this.parseStatementsToAst(thenBody);

          let elseAst: ParsedAstStmt[] | undefined;
          let nextPos = thenEnd;
          const afterThen = bodyText.slice(thenEnd).trimStart();
          if (afterThen.startsWith("else")) {
            const elseOpen = bodyText.indexOf("{", thenEnd);
            if (elseOpen !== -1) {
              const { body: elseBody, endPos: elseEnd } = this.extractBraceBlock(bodyText, elseOpen);
              elseAst = this.parseStatementsToAst(elseBody);
              nextPos = elseEnd;
            }
          }

          stmts.push({ kind: "if", cond, thenBody: thenAst, elseBody: elseAst });
          pos = nextPos;
          continue;
        }
      }

      // 3. Return statement: return expr;
      if (/^return\b/.test(remaining)) {
        const semi = remaining.indexOf(";");
        if (semi !== -1) {
          const expr = remaining.slice(6, semi).trim();
          stmts.push({ kind: "return", expr });
          pos += semi + 1;
          continue;
        }
      }

      // 4. Assignments: assign x := expr; or x := expr; or x = expr;
      const assignMatch = /^(?:assign\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::=|=)\s*([^;\r\n]+);/.exec(remaining);
      if (assignMatch) {
        stmts.push({
          kind: "assign",
          target: assignMatch[1]!,
          expr: assignMatch[2]!.trim(),
        });
        pos += assignMatch[0].length;
        continue;
      }

      const nextSemi = remaining.indexOf(";");
      if (nextSemi !== -1) {
        pos += nextSemi + 1;
      } else {
        break;
      }
    }

    return stmts;
  }

  private static countAstSlots(stmts: ParsedAstStmt[]): number {
    let count = 0;
    for (const s of stmts) {
      if (s.kind === "assign" || s.kind === "return") {
        count += 1;
      } else if (s.kind === "while") {
        count += 1 + this.countAstSlots(s.body);
      } else if (s.kind === "if") {
        count += 1 + this.countAstSlots(s.thenBody);
        if (s.elseBody && s.elseBody.length > 0) {
          count += 1 + this.countAstSlots(s.elseBody);
        }
      }
    }
    return count;
  }

  private static emitAstStatements(
    stmts: ParsedAstStmt[],
    arena: DAEBuilder,
    locals: string[],
    outputs: string[],
  ): void {
    for (const stmt of stmts) {
      if (stmt.kind === "assign") {
        const target = stmt.target;
        if (!locals.includes(target) && !outputs.includes(target)) {
          locals.push(target);
          arena.addVariable(target, VarType.Real, Variability.Continuous, Causality.Local);
        }

        const targetNameId = arena.interner.intern(target);
        const targetExprId = arena.addName(targetNameId);
        const srcExprId = this.lowerExpression(stmt.expr, arena);
        arena.addAssignmentStmt(targetExprId, srcExprId);
      } else if (stmt.kind === "while") {
        const condId = this.lowerExpression(stmt.cond, arena);
        const bodySlots = this.countAstSlots(stmt.body);
        arena.addStatement(StmtKind.While, condId, bodySlots);
        this.emitAstStatements(stmt.body, arena, locals, outputs);
      } else if (stmt.kind === "if") {
        const condId = this.lowerExpression(stmt.cond, arena);
        const thenSlots = this.countAstSlots(stmt.thenBody);
        const hasElse = Boolean(stmt.elseBody && stmt.elseBody.length > 0);
        const branchCount = hasElse ? 1 : 0;

        arena.addStatement(StmtKind.If, condId, thenSlots, branchCount);
        this.emitAstStatements(stmt.thenBody, arena, locals, outputs);

        if (hasElse && stmt.elseBody) {
          const elseSlots = this.countAstSlots(stmt.elseBody);
          arena.addStatement(StmtKind.Block, -1, elseSlots);
          this.emitAstStatements(stmt.elseBody, arena, locals, outputs);
        }
      } else if (stmt.kind === "return") {
        arena.addReturnStmt();
      }
    }
  }

  private static extractBraceBlock(str: string, openBracePos: number): { body: string; endPos: number } {
    let depth = 1;
    let i = openBracePos + 1;
    while (i < str.length && depth > 0) {
      if (str[i] === "{") depth++;
      else if (str[i] === "}") depth--;
      i++;
    }
    return {
      body: str.slice(openBracePos + 1, i - 1),
      endPos: i,
    };
  }

  /**
   * Executes a lowered SysML v2 Action/Calculation via the WebAssembly statement executor.
   */
  public static execute(lowered: LoweredActionDae, inputValues: Record<string, number>): Record<string, number> {
    const { arena, startStmtIdx, stmtCount, outputs } = lowered;

    // Allocate dense environment vector
    const envSize = Math.max(256, arena.interner.size + 32);
    const denseEnv = new Float64Array(envSize);

    // Initialize inputs in dense vector
    for (const [inName, val] of Object.entries(inputValues)) {
      const nameId = arena.interner.intern(inName);
      denseEnv[nameId] = val;
    }

    // Execute statements
    executeArenaStatements(arena, startStmtIdx, stmtCount, denseEnv);

    // Gather outputs
    const result: Record<string, number> = {};
    for (const outName of outputs) {
      const nameId = arena.interner.intern(outName);
      result[outName] = denseEnv[nameId] ?? 0;
    }

    return result;
  }

  /**
   * Helper to prefix local variable and port identifiers in an equation or expression string.
   */
  public static prefixExpression(exprText: string, prefix: string, localNames: Set<string>): string {
    if (!prefix || localNames.size === 0) return exprText;
    const tokens = tokenizeSysml(exprText);
    const result: string[] = [];
    for (const t of tokens) {
      if (t.type === "ident") {
        const root = t.val.split(".")[0]!;
        if (localNames.has(root)) {
          result.push(prefix + t.val);
        } else {
          result.push(t.val);
        }
      } else {
        result.push(t.val);
      }
    }
    return result.join(" ");
  }

  /**
   * Lowers a physical SysML v2 Constraint or Part definition with differential and algebraic equations into a DAEBuilder.
   */
  public static async lowerConstraint(sysmlSource: string, existingArena?: DAEBuilder): Promise<LoweredConstraintDae> {
    try {
      await initBltWasm();
    } catch {}

    const arena = existingArena ?? new DAEBuilder();

    // 1. Strip comments (linear scan without polynomial backtracking)
    let strippedComments = "";
    let commentIdx = 0;
    while (commentIdx < sysmlSource.length) {
      const bStart = sysmlSource.indexOf("/*", commentIdx);
      if (bStart === -1) {
        strippedComments += sysmlSource.slice(commentIdx);
        break;
      }
      strippedComments += sysmlSource.slice(commentIdx, bStart);
      const bEnd = sysmlSource.indexOf("*/", bStart + 2);
      if (bEnd === -1) break;
      commentIdx = bEnd + 2;
    }
    const cleanSource = strippedComments.replace(/\/\/[^\r\n]*/g, "");

    // 2. Extract experiment configurations (if any)
    const startMatch = /\bstartTime\s*=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (startMatch) arena.experiment.startTime = parseFloat(startMatch[1]!);
    const stopMatch = /\bstopTime\s*=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (stopMatch) arena.experiment.stopTime = parseFloat(stopMatch[1]!);
    const intervalMatch = /\b(?:interval|step)\s*=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (intervalMatch) arena.experiment.interval = parseFloat(intervalMatch[1]!);
    const tolMatch = /\btolerance\s*=\s*([0-9.eE+-]+)/.exec(cleanSource);
    if (tolMatch) arena.experiment.tolerance = parseFloat(tolMatch[1]!);

    // 3. Extract port definitions: port def Pin { attribute v : Real; flow attribute i : Real; }
    interface PortDef {
      name: string;
      potentialAttrs: string[];
      flowAttrs: string[];
    }
    const portDefs = new Map<string, PortDef>();
    const portDefRegex = /\bport\s+def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
    let pdm: RegExpExecArray | null;
    while ((pdm = portDefRegex.exec(cleanSource)) !== null) {
      const portName = pdm[1]!;
      const openBrace = cleanSource.indexOf("{", pdm.index);
      const { body } = this.extractBraceBlock(cleanSource, openBrace);
      const potentialAttrs: string[] = [];
      const flowAttrs: string[] = [];

      const attrLineRegex =
        /\b(?:(in|out|inout)\s+)?(?:(flow)\s+)?attribute\s+(?:item\s+)?(?:(flow)\s+)?([A-Za-z_][A-Za-z0-9_]*)/g;
      let am: RegExpExecArray | null;
      while ((am = attrLineRegex.exec(body)) !== null) {
        const isFlow = Boolean(am[2] || am[3] || /\bflow\b/.test(am[0]));
        const attrName = am[4]!;
        if (isFlow) {
          flowAttrs.push(attrName);
        } else {
          potentialAttrs.push(attrName);
        }
      }
      portDefs.set(portName, { name: portName, potentialAttrs, flowAttrs });
    }

    // 4. Extract component templates (part def, constraint def)
    interface CompDef {
      name: string;
      bodyText: string;
    }
    const compDefs = new Map<string, CompDef>();
    const compRegex = /\b(part|constraint|model|package)\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
    let cdm: RegExpExecArray | null;
    while ((cdm = compRegex.exec(cleanSource)) !== null) {
      const cName = cdm[2]!;
      const openBrace = cleanSource.indexOf("{", cdm.index);
      const { body } = this.extractBraceBlock(cleanSource, openBrace);
      compDefs.set(cName, { name: cName, bodyText: body });
    }

    // Determine root component name
    let rootCompName = "SysmlModel";
    const nameMatch = /(?:constraint|part|package|model)\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(cleanSource);
    if (nameMatch) rootCompName = nameMatch[1]!;

    // If multiple compDefs, find the one that is not instantiated as a subpart in others
    if (compDefs.size > 1) {
      const referenced = new Set<string>();
      for (const comp of compDefs.values()) {
        const subpartMatch = /\bpart\s+[A-Za-z_][A-Za-z0-9_]*\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/g;
        let sm: RegExpExecArray | null;
        while ((sm = subpartMatch.exec(comp.bodyText)) !== null) {
          referenced.add(sm[1]!);
        }
      }
      for (const name of compDefs.keys()) {
        if (!referenced.has(name)) {
          rootCompName = name;
        }
      }
    }

    const parameters: string[] = [];
    const states: string[] = [];
    const derivatives: string[] = [];
    const initialEqCount = arena.eqCount;

    interface ActivePort {
      fullName: string;
      portType: string;
      potentialAttrs: string[];
      flowAttrs: string[];
    }
    const activePorts = new Map<string, ActivePort>();
    const allConnects: { p1: string; p2: string }[] = [];

    // Helper to instantiate a component definition
    const instantiateComponent = (
      compName: string,
      compBody: string,
      prefix: string,
      overrides: Record<string, number>,
    ) => {
      const localNames = new Set<string>();

      // 4a. Extract ports
      const portInstRegex =
        /\b(?:(in|out|inout)\s+)?port\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/g;
      let pm: RegExpExecArray | null;
      while ((pm = portInstRegex.exec(compBody)) !== null) {
        const portInstName = pm[2]!;
        const portTypeName = pm[3]!;
        const portFullName = prefix + portInstName;
        localNames.add(portInstName);

        const pDef = portDefs.get(portTypeName) ?? {
          name: portTypeName,
          potentialAttrs: ["v"],
          flowAttrs: ["i"],
        };

        for (const pot of pDef.potentialAttrs) {
          const varName = `${portFullName}.${pot}`;
          arena.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        }
        for (const fl of pDef.flowAttrs) {
          const varName = `${portFullName}.${fl}`;
          arena.addVariable(varName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        }

        activePorts.set(portFullName, {
          fullName: portFullName,
          portType: portTypeName,
          potentialAttrs: pDef.potentialAttrs,
          flowAttrs: pDef.flowAttrs,
        });
      }

      // 4b. Extract subparts
      let scrubbedBody = compBody;
      const subpartRegex = /\bpart\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/g;
      let spm: RegExpExecArray | null;
      while ((spm = subpartRegex.exec(compBody)) !== null) {
        const subName = spm[1]!;
        const subTypeName = spm[2]!;
        localNames.add(subName);

        let overrideText = "";
        let nextPos = spm.index + spm[0].length;
        while (nextPos < compBody.length && /\s/.test(compBody[nextPos]!)) nextPos++;
        let endSubPos = nextPos;
        if (nextPos < compBody.length && compBody[nextPos] === "{") {
          const { body: obody, endPos } = this.extractBraceBlock(compBody, nextPos);
          overrideText = obody;
          endSubPos = endPos;
          subpartRegex.lastIndex = endPos;
        } else if (nextPos < compBody.length && compBody[nextPos] === ";") {
          endSubPos = nextPos + 1;
          subpartRegex.lastIndex = nextPos + 1;
        }

        scrubbedBody = scrubbedBody.replace(compBody.slice(spm.index, endSubPos), "/* subpart */");

        const subOverrides: Record<string, number> = {};
        const ovRegex = /(?:attribute\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([0-9.eE+-]+)/g;
        let om: RegExpExecArray | null;
        while ((om = ovRegex.exec(overrideText)) !== null) {
          subOverrides[om[1]!] = parseFloat(om[2]!);
        }

        const childComp = compDefs.get(subTypeName);
        if (childComp) {
          instantiateComponent(childComp.name, childComp.bodyText, `${prefix}${subName}.`, subOverrides);
        }
      }

      // 4c. Extract attributes
      const attrRegex =
        /\b(?:(in|out|inout)\s+)?attribute\s+(?:item\s+)?([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*([A-Za-z0-9_.:]+))?(?:\s*=\s*([^;]+))?\s*;/g;
      let am: RegExpExecArray | null;
      while ((am = attrRegex.exec(compBody)) !== null) {
        const dir = am[1];
        const pName = am[2]!;
        localNames.add(pName);

        const fullName = prefix + pName;
        const defaultValStr = am[4]?.trim();
        let defaultVal = defaultValStr ? parseFloat(defaultValStr) : 0.0;
        if (overrides[pName] !== undefined) {
          defaultVal = overrides[pName]!;
        }

        let causality = Causality.Local;
        if (dir === "in") causality = Causality.Input;
        else if (dir === "out") causality = Causality.Output;

        const isState = new RegExp(`\\bder\\s*\\(\\s*${pName}\\s*\\)`).test(compBody);
        const isParam = !isState && (dir === "in" || defaultValStr !== undefined || overrides[pName] !== undefined);
        const variability = isParam ? Variability.Parameter : Variability.Continuous;

        if (isParam) {
          parameters.push(fullName);
        } else {
          states.push(fullName);
        }

        const varIdx = arena.addVariable(
          fullName,
          VarType.Real,
          variability,
          causality,
          isNaN(defaultVal) ? 0.0 : defaultVal,
        );
        if (isState) {
          const startExpr = arena.addRealLiteral(isNaN(defaultVal) ? 0.0 : defaultVal);
          arena.setVarAttrExpr(varIdx, VarAttrKind.Start, startExpr);
          const fixedExpr = arena.addBoolLiteral(true);
          arena.setVarAttrExpr(varIdx, VarAttrKind.Fixed, fixedExpr);
          arena.setVarFixed(varIdx, true);
        }
      }

      // 4d. Extract when-clauses: when cond { actions }
      const whenRegex = /\bwhen\s+(?:\(([^)]+)\)|([^{]+))\s*\{/g;
      let wm: RegExpExecArray | null;
      while ((wm = whenRegex.exec(compBody)) !== null) {
        const rawCond = (wm[1] || wm[2])!.trim();
        const openBrace = compBody.indexOf("{", wm.index);
        const { body: whenBody, endPos } = this.extractBraceBlock(compBody, openBrace);
        scrubbedBody = scrubbedBody.replace(compBody.slice(wm.index, endPos), "/* when */");

        const prefixedCond = this.prefixExpression(rawCond, prefix, localNames);
        const condExprId = this.lowerExpression(prefixedCond, arena);
        const whenIdx = arena.addWhenEquation(condExprId);

        // Parse assignments in when body
        const assignRegex = /(?:assign\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*(?::=|=)\s*([^;]+);/g;
        let asm: RegExpExecArray | null;
        while ((asm = assignRegex.exec(whenBody)) !== null) {
          const target = this.prefixExpression(asm[1]!.trim(), prefix, localNames);
          const expr = this.prefixExpression(asm[2]!.trim(), prefix, localNames);

          const targetNameId = arena.interner.intern(target);
          const targetExprId = arena.addName(targetNameId);
          const rhsExprId = this.lowerExpression(expr, arena);
          arena.addWhenBodyEquation(whenIdx, EqKind.Simple, targetExprId, rhsExprId);

          if (!states.includes(target) && !parameters.includes(target)) {
            states.push(target);
          }
        }
      }

      // 4e. Extract equations
      const statements = scrubbedBody
        .split(";")
        .map((s) => s.replace(/^[\s{}]+/, "").trim())
        .filter((s) => s.length > 0);

      for (const stmt of statements) {
        if (
          /^\b(?:(?:in|out|inout|private|protected|public)\s+)?(?:attribute|item|part|port|action|calc|constraint|def|import|package|alias|metadata)\b/.test(
            stmt,
          )
        ) {
          continue;
        }
        if (/^(?:startTime|stopTime|interval|step|tolerance)\s*=/i.test(stmt)) {
          continue;
        }
        if (/^\bconnect\b/.test(stmt)) {
          continue;
        }

        let eqSplitIndex = -1;
        let eqOpLen = 0;

        const dblEqIdx = stmt.indexOf("==");
        if (dblEqIdx !== -1) {
          eqSplitIndex = dblEqIdx;
          eqOpLen = 2;
        } else {
          const singleEqMatch = /(?<![:<>!])=(?!=)/.exec(stmt);
          if (singleEqMatch && singleEqMatch.index !== undefined) {
            eqSplitIndex = singleEqMatch.index;
            eqOpLen = 1;
          }
        }

        if (eqSplitIndex !== -1) {
          let lhsText = stmt.slice(0, eqSplitIndex).trim();
          lhsText = lhsText.replace(/^(?:assert\s+constraint\s*\{?\s*|\{\s*)/, "").trim();
          const rhsText = stmt
            .slice(eqSplitIndex + eqOpLen)
            .trim()
            .replace(/\}$/, "")
            .trim();

          if (lhsText && rhsText) {
            const prefixedLhs = this.prefixExpression(lhsText, prefix, localNames);
            const prefixedRhs = this.prefixExpression(rhsText, prefix, localNames);
            const lhsExprId = this.lowerExpression(prefixedLhs, arena);
            const rhsExprId = this.lowerExpression(prefixedRhs, arena);
            arena.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
          }
        }
      }

      // 4f. Extract connects
      const connectRegex = /\bconnect\s+([A-Za-z0-9_.]+)\s+to\s+([A-Za-z0-9_.]+)\s*;/g;
      let cm: RegExpExecArray | null;
      while ((cm = connectRegex.exec(compBody)) !== null) {
        const p1 = this.prefixExpression(cm[1]!, prefix, localNames);
        const p2 = this.prefixExpression(cm[2]!, prefix, localNames);
        allConnects.push({ p1, p2 });
      }
    };

    // Instantiate root component (or whole source if flat)
    const rootDef = compDefs.get(rootCompName);
    if (rootDef) {
      instantiateComponent(rootDef.name, rootDef.bodyText, "", {});
    } else {
      instantiateComponent(rootCompName, cleanSource, "", {});
    }

    // 5. Connect Port Conservation & Kirchhoff Balancing
    const flowJunctions = new Map<string, string[]>(); // flowAttrName -> [pin1, pin2, ...]
    const unionMap = new Map<string, string>();
    const findRoot = (x: string): string => {
      let curr = x;
      while (unionMap.has(curr)) curr = unionMap.get(curr)!;
      return curr;
    };
    const union = (a: string, b: string) => {
      const ra = findRoot(a);
      const rb = findRoot(b);
      if (ra !== rb) unionMap.set(rb, ra);
    };

    for (const conn of allConnects) {
      const portA = activePorts.get(conn.p1);
      const portB = activePorts.get(conn.p2);

      if (portA && portB) {
        // Potential variables: across equality (vA == vB)
        for (const pot of portA.potentialAttrs) {
          if (portB.potentialAttrs.includes(pot)) {
            const lhsExprId = this.lowerExpression(`${conn.p1}.${pot}`, arena);
            const rhsExprId = this.lowerExpression(`${conn.p2}.${pot}`, arena);
            arena.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
          }
        }

        // Flow variables: Kirchhoff flow conservation (sum-to-zero)
        for (const fl of portA.flowAttrs) {
          if (portB.flowAttrs.includes(fl)) {
            union(`${conn.p1}.${fl}`, `${conn.p2}.${fl}`);
          }
        }
      } else {
        // Simple direct connection: equality
        const lhsExprId = this.lowerExpression(conn.p1, arena);
        const rhsExprId = this.lowerExpression(conn.p2, arena);
        arena.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
      }
    }

    // Group flow pins by junction root
    const junctionGroups = new Map<string, string[]>();
    for (const port of activePorts.values()) {
      for (const fl of port.flowAttrs) {
        const pinName = `${port.fullName}.${fl}`;
        const root = findRoot(pinName);
        if (!junctionGroups.has(root)) junctionGroups.set(root, []);
        junctionGroups.get(root)!.push(pinName);
      }
    }

    // Emit Kirchhoff sum-to-zero equations for flow junctions with multiple pins
    for (const pins of junctionGroups.values()) {
      if (pins.length >= 2) {
        let sumExprId = this.lowerExpression(pins[0]!, arena);
        for (let i = 1; i < pins.length; i++) {
          const nextPinId = this.lowerExpression(pins[i]!, arena);
          sumExprId = arena.addBinaryExpr(BinOp.Add, sumExprId, nextPinId);
        }
        const zeroExprId = arena.addRealLiteral(0.0);
        arena.addEquation(EqKind.Simple, sumExprId, zeroExprId);
      }
    }

    // 6. Collect derivatives
    for (const st of states) {
      const derName = `der(${st})`;
      if (cleanSource.includes(derName) || cleanSource.includes(`der(${st.replace(/^[^.]+\./, "")})`)) {
        if (!derivatives.includes(derName)) {
          derivatives.push(derName);
        }
      }
    }

    const eqCount = arena.eqCount - initialEqCount;

    return {
      arena,
      name: rootCompName,
      parameters,
      states,
      derivatives,
      eqCount,
    };
  }

  /**
   * Universal entry point: lowers any SysML v2 source (Action, Calculation, Constraint, or Part) into a DAEBuilder.
   */
  public static async lowerSystem(sysmlSource: string, existingArena?: DAEBuilder): Promise<DAEBuilder> {
    if (
      /\b(?:constraint|assert\s+constraint|when)\b/.test(sysmlSource) ||
      /==/.test(sysmlSource) ||
      /\bder\s*\(/.test(sysmlSource) ||
      /\bport\s+def\b/.test(sysmlSource) ||
      /\bpart\s+def\b/.test(sysmlSource)
    ) {
      const res = await this.lowerConstraint(sysmlSource, existingArena);
      return res.arena;
    } else {
      const res = await this.lowerAction(sysmlSource, existingArena);
      return res.arena;
    }
  }

  /**
   * Simulates a SysML v2 specification directly using the arena-native numerical solver.
   */
  public static async simulate(
    sysmlSource: string,
    options: import("@modelscript/simulate").ArenaSimulateOptions = {},
  ): Promise<import("@modelscript/simulate").ArenaSimulationResult> {
    const { simulateArena } = await import("@modelscript/simulate");
    const arena = await this.lowerSystem(sysmlSource);
    return simulateArena(arena, options);
  }
}

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
  executeArenaStatements,
  initBltWasm,
  StmtKind,
  UnaryOp,
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
      const assignMatch = /^(?:assign\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::=|=)\s*([^;]+);/.exec(remaining);
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
}

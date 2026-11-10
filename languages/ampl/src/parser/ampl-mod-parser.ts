// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Recursive-Descent / Precedence-Climbing Parser for AMPL (.mod, .run) files.
 */

import type {
  AmplArcDecl,
  AmplArcEndpoint,
  AmplBinaryOp,
  AmplCheckDecl,
  AmplConstraintComplement,
  AmplConstraintDecl,
  AmplConstraintRelOp,
  AmplExpr,
  AmplFunctionDecl,
  AmplIndexing,
  AmplIterator,
  AmplModel,
  AmplNodeDecl,
  AmplObjectiveDecl,
  AmplParamDecl,
  AmplParamType,
  AmplProblemDecl,
  AmplReductionKind,
  AmplSetDecl,
  AmplStmt,
  AmplSuffixDecl,
  AmplTableColumnSpec,
  AmplTableDecl,
  AmplUnaryOp,
  AmplVarColumnSpec,
  AmplVarDecl,
  AmplVarType,
} from "../types.js";
import { AmplLexer, type Token } from "./ampl-lexer.js";

export class AmplModParser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokensOrInput: Token[] | string) {
    if (typeof tokensOrInput === "string") {
      this.tokens = new AmplLexer(tokensOrInput).tokenize();
    } else {
      this.tokens = tokensOrInput;
    }
  }

  public parse(): AmplModel {
    const model: AmplModel = {
      sets: new Map(),
      params: new Map(),
      vars: new Map(),
      objectives: new Map(),
      constraints: new Map(),
      tables: new Map(),
      checks: [],
      statements: [],
      nodes: new Map(),
      arcs: new Map(),
      functions: new Map(),
      problems: new Map(),
      suffixes: new Map(),
    };

    while (!this.isAtEnd()) {
      if (this.matchKeyword("set")) {
        this.parseSetDecl(model);
      } else if (this.matchKeyword("param")) {
        this.parseParamDecl(model);
      } else if (this.matchKeyword("var")) {
        this.parseVarDecl(model);
      } else if (this.matchKeyword("minimize") || this.matchKeyword("maximize")) {
        this.parseObjectiveDecl(model);
      } else if (this.matchKeyword("subject") || this.matchKeyword("s.t.")) {
        if (this.previous().value.toLowerCase() === "subject") {
          this.consumeKeyword("to", "Expected 'to' after 'subject'");
        }
        this.parseConstraintDecl(model);
      } else if (this.matchKeyword("node")) {
        this.parseNodeDecl(model);
      } else if (this.matchKeyword("arc")) {
        this.parseArcDecl(model);
      } else if (this.matchKeyword("function")) {
        this.parseFunctionDecl(model);
      } else if (this.matchKeyword("suffix")) {
        this.parseSuffixDecl(model);
      } else if (this.matchKeyword("problem")) {
        const next1 = this.peekNext();
        if (next1 && (next1.value === ":" || next1.value === "{")) {
          this.parseProblemDecl(model);
        } else {
          const startRange = this.previous().range;
          let name = "";
          if (this.isNameToken(this.peek())) {
            name = this.advance().value;
          }
          this.consumePunctuation(";", "Expected ';' after problem statement");
          model.statements!.push({ kind: "problem_cmd", name, range: startRange });
        }
      } else if (this.matchKeyword("table")) {
        this.parseTableDecl(model);
      } else if (this.matchKeyword("check")) {
        this.parseCheckDecl(model);
      } else if (this.isCommandStart()) {
        const stmt = this.parseStatement(model);
        if (stmt) {
          model.statements!.push(stmt);
        }
      } else if (this.peek().type === "PUNCTUATION" && this.peek().value === ";") {
        this.advance();
      } else {
        // If an identifier is followed by colon or indexing then colon, it is an unnamed-keyword constraint
        if (
          this.isNameToken(this.peek()) &&
          (this.peekNext().value === ":" || this.peekNext().value === "{")
        ) {
          this.parseConstraintDecl(model);
        } else {
          this.advance();
        }
      }
    }

    return model;
  }

  // ── Declarations ──

  private parseSetDecl(model: AmplModel): void {
    const startRange = this.previous().range;
    const nameToken = this.consumeName("Expected set name");
    const name = nameToken.value;

    let indexing: AmplIndexing | undefined;
    if (this.checkPunctuation("{")) {
      indexing = this.parseIndexing();
    }

    let dimen = 1;
    let ordered = false;
    let circular = false;
    let within: AmplExpr | undefined;
    let defaultExpr: AmplExpr | undefined;
    let assignExpr: AmplExpr | undefined;

    while (!this.checkPunctuation(";") && !this.isAtEnd()) {
      if (this.matchPunctuation(",")) {
        continue;
      } else if (this.matchKeyword("dimen")) {
        const dimToken = this.consume("NUMBER", "Expected dimension number");
        dimen = Math.round(dimToken.numValue ?? 1);
      } else if (this.matchKeyword("ordered")) {
        ordered = true;
      } else if (this.matchKeyword("circular")) {
        circular = true;
        ordered = true;
      } else if (this.matchKeyword("within") || this.matchKeyword("in")) {
        within = this.parseSetExpression();
      } else if (this.matchKeyword("default")) {
        defaultExpr = this.parseSetExpression();
      } else if (this.matchOperator(":=") || this.matchOperator("=")) {
        assignExpr = this.parseSetExpression();
      } else {
        this.advance();
      }
    }
    this.consumePunctuation(";", "Expected ';' after set declaration");

    const endRange = this.previous().range;
    const decl: AmplSetDecl = {
      name,
      dimen,
      ordered: ordered || undefined,
      circular: circular || undefined,
      indexing,
      within,
      default: defaultExpr,
      assignExpr,
      range: { start: startRange.start, end: endRange.end },
    };
    model.sets.set(name, decl);
  }

  private parseParamDecl(model: AmplModel): void {
    const startRange = this.previous().range;
    const nameToken = this.consumeName("Expected parameter name");
    const name = nameToken.value;

    let indexing: AmplIndexing | undefined;
    if (this.checkPunctuation("{")) {
      indexing = this.parseIndexing();
    }

    let paramType: AmplParamType = "real";
    let lowerBound: AmplExpr | undefined;
    let upperBound: AmplExpr | undefined;
    let defaultExpr: AmplExpr | undefined;
    let assignExpr: AmplExpr | undefined;

    while (!this.checkPunctuation(";") && !this.isAtEnd()) {
      if (this.matchPunctuation(",")) {
        continue;
      } else if (this.matchKeyword("binary")) {
        paramType = "binary";
      } else if (this.matchKeyword("integer")) {
        paramType = "integer";
      } else if (this.matchKeyword("symbolic")) {
        paramType = "symbolic";
      } else if (this.matchOperator(">=")) {
        lowerBound = this.parseUnary();
      } else if (this.matchOperator(">")) {
        lowerBound = this.parseUnary();
      } else if (this.matchOperator("<=")) {
        upperBound = this.parseUnary();
      } else if (this.matchOperator("<")) {
        upperBound = this.parseUnary();
      } else if (this.matchKeyword("default")) {
        defaultExpr = this.parseExpression();
      } else if (this.matchOperator(":=") || this.matchOperator("=")) {
        assignExpr = this.parseExpression();
      } else {
        this.advance();
      }
    }
    this.consumePunctuation(";", "Expected ';' after parameter declaration");

    const endRange = this.previous().range;
    const decl: AmplParamDecl = {
      name,
      type: paramType,
      indexing,
      lowerBound,
      upperBound,
      default: defaultExpr,
      assignExpr,
      range: { start: startRange.start, end: endRange.end },
    };
    model.params.set(name, decl);
  }

  private parseVarDecl(model: AmplModel): void {
    const startRange = this.previous().range;
    const nameToken = this.consumeName("Expected variable name");
    const name = nameToken.value;

    let indexing: AmplIndexing | undefined;
    if (this.checkPunctuation("{")) {
      indexing = this.parseIndexing();
    }

    let varType: AmplVarType = "continuous";
    let lowerBound: AmplExpr | undefined;
    let upperBound: AmplExpr | undefined;
    let semiLowerBound: AmplExpr | undefined;
    let initial: AmplExpr | undefined;
    let definedExpr: AmplExpr | undefined;
    let sosno: AmplExpr | undefined;
    let ref: AmplExpr | undefined;
    let columnSpec: AmplVarColumnSpec | undefined;

    while (!this.checkPunctuation(";") && !this.isAtEnd()) {
      if (this.matchPunctuation(",")) {
        continue;
      } else if (this.matchKeyword("binary")) {
        varType = "binary";
      } else if (this.matchKeyword("integer")) {
        if (varType === "semicont") {
          varType = "semiint";
        } else {
          varType = "integer";
        }
      } else if (this.matchKeyword("semicont")) {
        varType = varType === "integer" ? "semiint" : "semicont";
        if (
          !this.checkPunctuation(",") &&
          !this.checkPunctuation(";") &&
          !this.checkOperator(">=") &&
          !this.checkOperator("<=") &&
          !this.checkOperator(":=") &&
          !this.checkOperator("=") &&
          this.peek().type !== "KEYWORD"
        ) {
          semiLowerBound = this.parseUnary();
        }
      } else if (this.matchKeyword("semiint")) {
        varType = "semiint";
        if (
          !this.checkPunctuation(",") &&
          !this.checkPunctuation(";") &&
          !this.checkOperator(">=") &&
          !this.checkOperator("<=") &&
          !this.checkOperator(":=") &&
          !this.checkOperator("=") &&
          this.peek().type !== "KEYWORD"
        ) {
          semiLowerBound = this.parseUnary();
        }
      } else if (this.matchContextualKeyword("sosno")) {
        sosno = this.parseUnary();
      } else if (this.matchContextualKeyword("ref")) {
        ref = this.parseUnary();
      } else if (this.matchKeyword("obj")) {
        if (!columnSpec) columnSpec = { objClauses: [], coeffClauses: [] };
        let objName = "";
        if (this.isNameToken(this.peek()) && !this.checkPunctuation(";") && !this.checkPunctuation(",")) {
          const nextTok = this.peekNext();
          if (nextTok && nextTok.type !== "PUNCTUATION" && nextTok.value !== ";") {
            objName = this.advance().value;
          }
        }
        const coeffExpr = this.parseUnary();
        columnSpec.objClauses.push({ objName, coeffExpr });
      } else if (this.matchKeyword("coeff")) {
        if (!columnSpec) columnSpec = { objClauses: [], coeffClauses: [] };
        let coeffIndexing: AmplIndexing | undefined;
        if (this.checkPunctuation("{")) {
          coeffIndexing = this.parseIndexing();
        }
        const conName = this.consumeName("Expected constraint name in coeff clause").value;
        let conIndices: AmplExpr[] | undefined;
        if (this.checkPunctuation("[")) {
          conIndices = this.parseBracketIndices();
        }
        let coeff: AmplExpr;
        if (!this.checkPunctuation(";") && !this.checkPunctuation(",") && !this.checkKeyword("coeff") && !this.checkKeyword("obj")) {
          coeff = this.parseUnary();
        } else {
          coeff = { kind: "number", value: 1 };
        }
        columnSpec.coeffClauses.push({
          indexing: coeffIndexing,
          targetConstraint: conName,
          constraintIndices: conIndices,
          coeffExpr: coeff,
        });
      } else if (this.matchOperator(">=")) {
        lowerBound = this.parseUnary();
      } else if (this.matchOperator("<=")) {
        upperBound = this.parseUnary();
      } else if (this.matchOperator(":=")) {
        initial = this.parseExpression();
      } else if (this.matchOperator("=")) {
        const expr = this.parseExpression();
        if (expr.kind === "number") {
          lowerBound = expr;
          upperBound = expr;
          initial = expr;
        } else {
          definedExpr = expr;
        }
      } else {
        this.advance();
      }
    }
    this.consumePunctuation(";", "Expected ';' after variable declaration");

    if ((varType === "semicont" || varType === "semiint") && !semiLowerBound && lowerBound) {
      semiLowerBound = lowerBound;
      lowerBound = { kind: "number", value: 0 };
    }

    const endRange = this.previous().range;
    const decl: AmplVarDecl = {
      name,
      type: varType,
      indexing,
      lowerBound,
      upperBound,
      semiLowerBound,
      initial,
      definedExpr,
      sosno,
      ref,
      columnSpec,
      range: { start: startRange.start, end: endRange.end },
    };
    model.vars.set(name, decl);
  }

  private parseObjectiveDecl(model: AmplModel): void {
    const dirToken = this.previous();
    const direction = dirToken.value.toLowerCase() as "minimize" | "maximize";
    const startRange = dirToken.range;

    const nameToken = this.consumeName("Expected objective name");
    const name = nameToken.value;

    let indexing: AmplIndexing | undefined;
    if (this.checkPunctuation("{")) {
      indexing = this.parseIndexing();
    }

    let expr: AmplExpr;
    if (this.matchPunctuation(":")) {
      expr = this.parseExpression();
    } else {
      expr = { kind: "number", value: 0 };
    }
    this.consumePunctuation(";", "Expected ';' after objective expression");

    const endRange = this.previous().range;
    const decl: AmplObjectiveDecl = {
      name,
      direction,
      indexing,
      expr,
      range: { start: startRange.start, end: endRange.end },
    };
    model.objectives.set(name, decl);
  }

  private parseConstraintDecl(model: AmplModel): void {
    const startRange = this.previous().range;
    let name = "unnamed";
    if (this.isNameToken(this.peek())) {
      name = this.advance().value;
    }

    let indexing: AmplIndexing | undefined;
    if (this.checkPunctuation("{")) {
      indexing = this.parseIndexing();
    }

    this.consumePunctuation(":", "Expected ':' after constraint name");

    // Check for alldiff / atleast / atmost / exactly CP constraint or logical implication
    if (
      this.matchContextualKeyword("alldiff") ||
      this.matchContextualKeyword("atleast") ||
      this.matchContextualKeyword("atmost") ||
      this.matchContextualKeyword("exactly")
    ) {
      const cpKind = this.previous().value.toLowerCase();
      const args: AmplExpr[] = [];
      if (cpKind !== "alldiff") {
        // e.g. atleast k {i in I} (cond)
        args.push(this.parseUnary());
      }
      let cpIndexing: AmplIndexing | undefined;
      if (this.checkPunctuation("{")) {
        cpIndexing = this.parseIndexing();
      }
      const bodyExpr = this.parseExpression();
      if (cpIndexing) {
        args.push({
          kind: "reduction",
          reduction: "count",
          iterators: cpIndexing.iterators,
          expr: bodyExpr,
        });
      } else {
        args.push(bodyExpr);
      }
      this.consumePunctuation(";", "Expected ';' after logical constraint");
      model.constraints.set(name, {
        name,
        indexing,
        lhs: { kind: "call", fn: cpKind, args },
        operator: "=",
        rhs: { kind: "number", value: 1 },
        isLogical: true,
        range: { start: startRange.start, end: this.previous().range.end },
      });
      return;
    }

    const part1 = this.parseRelationalSide();

    // Check for MPEC `complements`
    let complements: AmplConstraintComplement | undefined;
    if (this.matchKeyword("complements")) {
      const part2 = this.parseRelationalSide();
      complements = {
        lhs: part2.lhs,
        operator: part2.operator,
        rhs: part2.rhs,
        rhsUpper: part2.rhsUpper,
      };
    }

    this.consumePunctuation(";", "Expected ';' after constraint definition");

    const endRange = this.previous().range;
    const decl: AmplConstraintDecl = {
      name,
      indexing,
      lhs: part1.lhs,
      operator: part1.operator,
      rhs: part1.rhs,
      rhsUpper: part1.rhsUpper,
      complements,
      isLogical: part1.isLogical,
      range: { start: startRange.start, end: endRange.end },
    };
    model.constraints.set(name, decl);
  }

  private parseRelationalSide(): {
    lhs: AmplExpr;
    operator: AmplConstraintRelOp;
    rhs: AmplExpr;
    rhsUpper?: AmplExpr | undefined;
    isLogical?: boolean | undefined;
  } {
    const firstExpr = this.parseExpression(4);

    // Check if next operator is logical implication ==> or <==> or or/and
    if (
      this.peek().value === "==>" ||
      this.peek().value === "<==>" ||
      this.peek().value.toLowerCase() === "or" ||
      this.peek().value.toLowerCase() === "and"
    ) {
      let leftExpr: AmplExpr = firstExpr;
      if (this.matchRelOp()) {
        const op = this.previous().value as AmplBinaryOp;
        const r = this.parseExpression(4);
        leftExpr = { kind: "binary", op, left: firstExpr, right: r };
      }
      while (
        this.peek().value === "==>" ||
        this.peek().value === "<==>" ||
        this.peek().value.toLowerCase() === "or" ||
        this.peek().value.toLowerCase() === "and"
      ) {
        const logicOp = this.advance().value.toLowerCase() as AmplBinaryOp;
        let rightSide = this.parseExpression(4);
        if (this.matchRelOp()) {
          const rOp = this.previous().value as AmplBinaryOp;
          const rVal = this.parseExpression(4);
          rightSide = { kind: "binary", op: rOp, left: rightSide, right: rVal };
        }
        leftExpr = { kind: "binary", op: logicOp, left: leftExpr, right: rightSide };
      }
      return {
        lhs: leftExpr,
        operator: "=",
        rhs: { kind: "number", value: 1 },
        isLogical: true,
      };
    }

    let relOp: AmplConstraintRelOp = "=";
    let rhs: AmplExpr = { kind: "number", value: 0 };
    let rhsUpper: AmplExpr | undefined;

    if (this.matchRelOp()) {
      const firstOp = this.previous().value as AmplConstraintRelOp;
      relOp = firstOp;
      rhs = this.parseExpression(4);

      // Check if logical operator follows a relational expression: e.g. `y[i] = 1 ==> x[i] <= 10`
      if (
        this.peek().value === "==>" ||
        this.peek().value === "<==>" ||
        this.peek().value.toLowerCase() === "or" ||
        this.peek().value.toLowerCase() === "and"
      ) {
        let leftExpr: AmplExpr = {
          kind: "binary",
          op: firstOp as AmplBinaryOp,
          left: firstExpr,
          right: rhs,
        };
        while (
          this.peek().value === "==>" ||
          this.peek().value === "<==>" ||
          this.peek().value.toLowerCase() === "or" ||
          this.peek().value.toLowerCase() === "and"
        ) {
          const logicOp = this.advance().value.toLowerCase() as AmplBinaryOp;
          let rightSide = this.parseExpression(4);
          if (this.matchRelOp()) {
            const rOp = this.previous().value as AmplBinaryOp;
            const rVal = this.parseExpression(4);
            rightSide = { kind: "binary", op: rOp, left: rightSide, right: rVal };
          }
          leftExpr = { kind: "binary", op: logicOp, left: leftExpr, right: rightSide };
        }
        return {
          lhs: leftExpr,
          operator: "=",
          rhs: { kind: "number", value: 1 },
          isLogical: true,
        };
      }

      if (this.matchRelOp()) {
        // Double-sided constraint: firstExpr <= middleExpr <= upperExpr
        rhsUpper = this.parseExpression(4);
        return {
          lhs: rhs,
          operator: ">=",
          rhs: firstExpr,
          rhsUpper,
        };
      }
    }

    return { lhs: firstExpr, operator: relOp, rhs, rhsUpper };
  }

  private parseTableDecl(model: AmplModel): void {
    const startRange = this.previous().range;
    const name = this.consumeName("Expected table name").value;

    let indexing: AmplIndexing | undefined;
    if (this.checkPunctuation("{")) {
      indexing = this.parseIndexing();
    }

    let mode: "IN" | "OUT" | "INOUT" = "INOUT";
    if (this.matchContextualKeyword("in")) mode = "IN";
    else if (this.matchContextualKeyword("out")) mode = "OUT";
    else if (this.matchContextualKeyword("inout")) mode = "INOUT";

    const strings: string[] = [];
    while (this.peek().type === "STRING") {
      strings.push(this.advance().value);
    }

    let driver = "CSV";
    let filePath = `${name}.csv`;
    if (strings.length >= 2) {
      driver = strings[0]!.toUpperCase();
      filePath = strings[1]!;
    } else if (strings.length === 1) {
      filePath = strings[0]!;
      const lower = filePath.toLowerCase();
      if (lower.endsWith(".json")) driver = "JSON";
      else if (lower.endsWith(".db") || lower.endsWith(".sqlite") || lower.endsWith(".sqlite3")) driver = "SQLITE";
      else if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) driver = "EXCEL";
      else driver = "CSV";
    }

    this.consumePunctuation(":", "Expected ':' in table declaration");

    let setName: string | undefined;
    const keyColumns: string[] = [];
    const valueColumns: AmplTableColumnSpec[] = [];

    // Check for `SETNAME <- [k1, k2]` or `[k1, k2] -> SETNAME` or `[i in SETNAME]` or `[k1, k2]`
    if (this.isNameToken(this.peek()) && (this.peekNext().value === "<-" || this.peekNext().value === "<->")) {
      setName = this.advance().value;
      this.advance(); // consume <- or <->
    }

    if (this.matchPunctuation("[")) {
      while (!this.checkPunctuation("]") && !this.isAtEnd()) {
        if (this.isNameToken(this.peek())) {
          const tok1 = this.advance().value;
          if (this.matchKeyword("in")) {
            const sName = this.consumeName("Expected set name in table key").value;
            if (!setName) setName = sName;
            keyColumns.push(tok1);
          } else if (this.matchOperator("~")) {
            const alias = this.consumeName("Expected alias").value;
            keyColumns.push(alias);
          } else {
            keyColumns.push(tok1);
          }
        } else {
          this.advance();
        }
        if (this.matchPunctuation(",")) continue;
      }
      this.consumePunctuation("]", "Expected ']' after table key columns");
    }

    if (this.matchOperator("->") || this.matchOperator("<->")) {
      if (this.isNameToken(this.peek())) {
        setName = this.advance().value;
      }
    }

    this.matchPunctuation(",");

    while (!this.checkPunctuation(";") && !this.isAtEnd()) {
      if (this.matchPunctuation(",")) continue;
      const expr = this.parseExpression();
      let alias: string | undefined;
      if (this.matchOperator("~")) {
        alias = this.consumeName("Expected column alias after '~'").value;
      }
      let colName = alias ?? "";
      if (!colName) {
        if (expr.kind === "identifier") colName = expr.name;
        else if (expr.kind === "subscript") colName = expr.name;
        else if (expr.kind === "suffix") {
          const base = expr.target.kind === "identifier" ? expr.target.name : (expr.target.kind === "subscript" ? expr.target.name : "col");
          colName = expr.suffix === "val" ? base : `${base}.${expr.suffix}`;
        } else {
          colName = `col_${valueColumns.length + 1}`;
        }
      }
      valueColumns.push({ name: colName, alias, expr });
    }

    this.consumePunctuation(";", "Expected ';' after table declaration");

    const decl: AmplTableDecl = {
      name,
      indexing,
      mode,
      driver,
      filePath,
      setName,
      keyColumns,
      valueColumns,
      range: { start: startRange.start, end: this.previous().range.end },
    };
    model.tables!.set(name, decl);
  }

  private parseCheckDecl(model: AmplModel): void {
    const startRange = this.previous().range;
    let indexing: AmplIndexing | undefined;
    if (this.checkPunctuation("{")) {
      indexing = this.parseIndexing();
    }
    this.matchPunctuation(":");
    const condition = this.parseExpression();
    this.consumePunctuation(";", "Expected ';' after check condition");
    const checkDecl: AmplCheckDecl = {
      indexing,
      condition,
      range: { start: startRange.start, end: this.previous().range.end },
    };
    model.checks!.push(checkDecl);
  }

  private parseBracketIndices(): AmplExpr[] {
    this.consumePunctuation("[", "Expected '['");
    const indices: AmplExpr[] = [];
    do {
      if (this.matchOperator("*")) {
        indices.push({ kind: "wildcard", range: this.previous().range });
      } else {
        indices.push(this.parseExpression());
      }
    } while (this.matchPunctuation(","));
    this.consumePunctuation("]", "Expected ']' after bracket indices");
    return indices;
  }

  private parseNodeDecl(model: AmplModel): void {
    const startRange = this.previous().range;
    const nameToken = this.consumeName("Expected node name");
    const name = nameToken.value;

    let indexing: AmplIndexing | undefined;
    if (this.checkPunctuation("{")) {
      indexing = this.parseIndexing();
    }

    let netDirection: "net_out" | "net_in" = "net_out";
    let operator: AmplConstraintRelOp = "=";
    let rhs: AmplExpr | undefined;

    // Optional colon followed by net_in / net_out
    if (this.matchPunctuation(":")) {
      while (!this.checkOperator("=") && !this.checkOperator("<=") && !this.checkOperator(">=") && !this.checkPunctuation(";") && !this.isAtEnd()) {
        if (this.matchKeyword("net_in")) {
          netDirection = "net_in";
        } else if (this.matchKeyword("net_out")) {
          netDirection = "net_out";
        } else {
          this.advance();
        }
      }
    }

    while (!this.checkPunctuation(";") && !this.isAtEnd()) {
      if (this.matchPunctuation(",")) {
        continue;
      } else if (this.matchOperator("=")) {
        operator = "=";
        rhs = this.parseExpression();
      } else if (this.matchOperator(">=")) {
        operator = ">=";
        rhs = this.parseExpression();
      } else if (this.matchOperator("<=")) {
        operator = "<=";
        rhs = this.parseExpression();
      } else if (this.matchKeyword("net_in")) {
        netDirection = "net_in";
      } else if (this.matchKeyword("net_out")) {
        netDirection = "net_out";
      } else {
        this.advance();
      }
    }
    this.consumePunctuation(";", "Expected ';' after node declaration");

    const endRange = this.previous().range;
    const decl: AmplNodeDecl = {
      name,
      indexing,
      operator,
      rhs: rhs ?? { kind: "number", value: 0 },
      netDirection,
      range: { start: startRange.start, end: endRange.end },
    };
    model.nodes!.set(name, decl);
  }

  private parseArcDecl(model: AmplModel): void {
    const startRange = this.previous().range;
    const nameToken = this.consumeName("Expected arc name");
    const name = nameToken.value;

    let indexing: AmplIndexing | undefined;
    if (this.checkPunctuation("{")) {
      indexing = this.parseIndexing();
    }

    let lowerBound: AmplExpr | undefined;
    let upperBound: AmplExpr | undefined;
    let from: AmplArcEndpoint | undefined;
    let to: AmplArcEndpoint | undefined;
    let objClause: { objName: string; cost: AmplExpr } | undefined;

    while (!this.checkPunctuation(";") && !this.isAtEnd()) {
      if (this.matchPunctuation(",")) {
        continue;
      } else if (this.matchOperator(">=")) {
        lowerBound = this.parseUnary();
      } else if (this.matchOperator("<=")) {
        upperBound = this.parseUnary();
      } else if (this.matchKeyword("from")) {
        const nodeName = this.consumeName("Expected node name after 'from'").value;
        let nodeIndices: AmplExpr[] | undefined;
        if (this.checkPunctuation("[")) {
          nodeIndices = this.parseBracketIndices();
        }
        let gain: AmplExpr | undefined;
        if (this.matchKeyword("gain") || this.matchContextualKeyword("gain")) {
          gain = this.parseUnary();
        }
        from = { nodeName, nodeIndices, gain };
      } else if (this.matchKeyword("to")) {
        const nodeName = this.consumeName("Expected node name after 'to'").value;
        let nodeIndices: AmplExpr[] | undefined;
        if (this.checkPunctuation("[")) {
          nodeIndices = this.parseBracketIndices();
        }
        let gain: AmplExpr | undefined;
        if (this.matchKeyword("gain") || this.matchContextualKeyword("gain")) {
          gain = this.parseUnary();
        }
        to = { nodeName, nodeIndices, gain };
      } else if (this.matchKeyword("obj")) {
        let objName = "";
        if (this.isNameToken(this.peek()) && !this.checkPunctuation(";") && !this.checkPunctuation(",")) {
          const nextTok = this.peekNext();
          if (nextTok && nextTok.type !== "PUNCTUATION" && nextTok.value !== ";") {
            objName = this.advance().value;
          }
        }
        const cost = this.parseUnary();
        objClause = { objName, cost };
      } else {
        this.advance();
      }
    }
    this.consumePunctuation(";", "Expected ';' after arc declaration");

    const endRange = this.previous().range;
    const decl: AmplArcDecl = {
      name,
      indexing,
      lowerBound,
      upperBound,
      from,
      to,
      objClause,
      range: { start: startRange.start, end: endRange.end },
    };
    model.arcs!.set(name, decl);
  }

  private parseFunctionDecl(model: AmplModel): void {
    const startRange = this.previous().range;
    const nameToken = this.consumeName("Expected function name");
    const name = nameToken.value;

    const params: string[] = [];
    if (this.matchPunctuation("(")) {
      if (!this.checkPunctuation(")")) {
        do {
          params.push(this.consumeName("Expected argument name").value);
        } while (this.matchPunctuation(","));
      }
      this.consumePunctuation(")", "Expected ')' after function arguments");
    }

    let isExternal = false;
    let body: AmplExpr | undefined;

    while (!this.checkPunctuation(";") && !this.isAtEnd()) {
      if (this.matchKeyword("symbolic") || this.matchKeyword("external")) {
        isExternal = true;
      } else if (this.matchOperator(":=") || this.matchOperator("=")) {
        body = this.parseExpression();
      } else {
        this.advance();
      }
    }
    this.consumePunctuation(";", "Expected ';' after function declaration");

    const endRange = this.previous().range;
    const decl: AmplFunctionDecl = {
      name,
      params,
      body: body ?? { kind: "number", value: 0 },
      isExternal: isExternal || !body,
      range: { start: startRange.start, end: endRange.end },
    };
    model.functions!.set(name, decl);
  }

  private parseProblemDecl(model: AmplModel): void {
    const startRange = this.previous().range;
    const nameToken = this.consumeName("Expected problem name");
    const name = nameToken.value;

    let indexing: AmplIndexing | undefined;
    if (this.checkPunctuation("{")) {
      indexing = this.parseIndexing();
    }

    this.consumePunctuation(":", "Expected ':' after problem name");
    const elements: string[] = [];
    while (!this.checkPunctuation(";") && !this.isAtEnd()) {
      if (this.isNameToken(this.peek())) {
        elements.push(this.advance().value);
      } else if (this.matchPunctuation(",")) {
        continue;
      } else {
        this.advance();
      }
    }
    this.consumePunctuation(";", "Expected ';' after problem declaration");

    const endRange = this.previous().range;
    const decl: AmplProblemDecl = {
      name,
      indexing,
      elements,
      range: { start: startRange.start, end: endRange.end },
    };
    model.problems!.set(name, decl);
  }

  private parseSuffixDecl(model: AmplModel): void {
    const startRange = this.previous().range;
    const nameToken = this.consumeName("Expected suffix name");
    const name = nameToken.value;

    let direction: "IN" | "OUT" | "INOUT" = "INOUT";
    let datatype: "real" | "integer" | "binary" | "symbolic" = "real";

    while (!this.checkPunctuation(";") && !this.isAtEnd()) {
      if (this.matchPunctuation(",")) {
        continue;
      } else if (this.matchKeyword("in") || (this.peek().type === "IDENTIFIER" && this.peek().value.toUpperCase() === "IN")) {
        direction = "IN";
        if (this.peek().type === "IDENTIFIER") this.advance();
      } else if (this.peek().type === "IDENTIFIER" && this.peek().value.toUpperCase() === "OUT") {
        direction = "OUT";
        this.advance();
      } else if (this.peek().type === "IDENTIFIER" && this.peek().value.toUpperCase() === "INOUT") {
        direction = "INOUT";
        this.advance();
      } else if (this.matchKeyword("integer")) {
        datatype = "integer";
      } else if (this.matchKeyword("binary")) {
        datatype = "binary";
      } else if (this.matchKeyword("symbolic")) {
        datatype = "symbolic";
      } else {
        this.advance();
      }
    }
    this.consumePunctuation(";", "Expected ';' after suffix declaration");

    const endRange = this.previous().range;
    const decl: AmplSuffixDecl = {
      name,
      direction,
      datatype,
      range: { start: startRange.start, end: endRange.end },
    };
    model.suffixes!.set(name, decl);
  }

  // ── Imperative Scripting Statements (.run) ──

  private isCommandStart(): boolean {
    const tok = this.peek();
    if (tok.type !== "KEYWORD" && tok.type !== "IDENTIFIER") return false;
    const v = tok.value.toLowerCase();
    return (
      v === "model" ||
      v === "data" ||
      v === "include" ||
      v === "option" ||
      v === "solve" ||
      v === "let" ||
      v === "fix" ||
      v === "unfix" ||
      v === "drop" ||
      v === "restore" ||
      v === "objective" ||
      v === "reset" ||
      v === "read" ||
      v === "write" ||
      v === "display" ||
      v === "printf" ||
      v === "for" ||
      v === "repeat" ||
      v === "if" ||
      v === "break" ||
      v === "continue" ||
      (v === "problem" && this.peekNext()?.value !== ":" && this.peekNext()?.value !== "{")
    );
  }

  private parseStatement(model?: AmplModel): AmplStmt | undefined {
    const startRange = this.peek().range;

    if (this.matchKeyword("solve")) {
      this.consumePunctuation(";", "Expected ';' after solve");
      return { kind: "solve_cmd", range: startRange };
    }

    if (this.matchKeyword("problem")) {
      let name = "";
      if (this.isNameToken(this.peek())) {
        name = this.advance().value;
      }
      this.consumePunctuation(";", "Expected ';' after problem statement");
      return { kind: "problem_cmd", name, range: startRange };
    }

    if (this.matchKeyword("model") || this.matchKeyword("data") || this.matchKeyword("include")) {
      const cmd = this.previous().value.toLowerCase() as "model" | "data" | "include";
      if (this.matchPunctuation(";")) {
        // Bare `data;` or `model;` mode switch
        return undefined;
      }
      const pathParts: string[] = [];
      while (!this.checkPunctuation(";") && !this.isAtEnd()) {
        pathParts.push(this.advance().value);
      }
      this.consumePunctuation(";", `Expected ';' after ${cmd} command`);
      const filePath = pathParts.join("");
      if (cmd === "model") return { kind: "model_cmd", filePath, range: startRange };
      if (cmd === "data") return { kind: "data_cmd", filePath, range: startRange };
      return { kind: "include_cmd", filePath, range: startRange };
    }

    if (this.matchKeyword("option")) {
      const name = this.consumeName("Expected option name").value;
      let val: string | number = "";
      if (this.peek().type === "NUMBER") {
        val = this.advance().numValue!;
      } else if (this.peek().type === "STRING") {
        val = this.advance().value;
      } else {
        const parts: string[] = [];
        while (!this.checkPunctuation(";") && !this.isAtEnd()) {
          parts.push(this.advance().value);
        }
        val = parts.join(" ");
      }
      this.consumePunctuation(";", "Expected ';' after option command");
      return { kind: "option_cmd", name, value: val, range: startRange };
    }

    if (this.matchKeyword("let")) {
      let indexing: AmplIndexing | undefined;
      if (this.checkPunctuation("{")) {
        indexing = this.parseIndexing();
      }
      const target = this.parseUnary();
      if (!this.matchOperator(":=") && !this.matchOperator("=")) {
        throw new Error(`Expected ':=' in let statement at line ${this.peek().range.start.line}`);
      }
      const value = this.parseExpression();
      this.consumePunctuation(";", "Expected ';' after let statement");
      return { kind: "let_cmd", indexing, target, value, range: startRange };
    }

    if (this.matchKeyword("fix")) {
      let indexing: AmplIndexing | undefined;
      if (this.checkPunctuation("{")) {
        indexing = this.parseIndexing();
      }
      const target = this.parseUnary();
      let value: AmplExpr | undefined;
      if (this.matchOperator(":=") || this.matchOperator("=")) {
        value = this.parseExpression();
      }
      this.consumePunctuation(";", "Expected ';' after fix statement");
      return { kind: "fix_cmd", indexing, target, value, range: startRange };
    }

    if (this.matchKeyword("unfix")) {
      let indexing: AmplIndexing | undefined;
      if (this.checkPunctuation("{")) {
        indexing = this.parseIndexing();
      }
      const target = this.parseUnary();
      this.consumePunctuation(";", "Expected ';' after unfix statement");
      return { kind: "unfix_cmd", indexing, target, range: startRange };
    }

    if (this.matchKeyword("drop")) {
      let indexing: AmplIndexing | undefined;
      if (this.checkPunctuation("{")) {
        indexing = this.parseIndexing();
      }
      const target = this.parseUnary();
      this.consumePunctuation(";", "Expected ';' after drop statement");
      return { kind: "drop_cmd", indexing, target, range: startRange };
    }

    if (this.matchKeyword("restore")) {
      let indexing: AmplIndexing | undefined;
      if (this.checkPunctuation("{")) {
        indexing = this.parseIndexing();
      }
      const target = this.parseUnary();
      this.consumePunctuation(";", "Expected ';' after restore statement");
      return { kind: "restore_cmd", indexing, target, range: startRange };
    }

    if (this.matchKeyword("objective")) {
      const name = this.consumeName("Expected objective name").value;
      this.consumePunctuation(";", "Expected ';' after objective command");
      return { kind: "objective_cmd", name, range: startRange };
    }

    if (this.matchKeyword("reset")) {
      let mode: "all" | "data" = "all";
      const targets: string[] = [];
      if (this.matchKeyword("data")) {
        mode = "data";
        while (!this.checkPunctuation(";") && !this.isAtEnd()) {
          if (this.matchPunctuation(",")) continue;
          if (this.isNameToken(this.peek())) {
            targets.push(this.advance().value);
          } else {
            this.advance();
          }
        }
      }
      this.consumePunctuation(";", "Expected ';' after reset command");
      return {
        kind: "reset_cmd",
        mode,
        targets: targets.length > 0 ? targets : undefined,
        range: startRange,
      };
    }

    if (this.matchContextualKeyword("read")) {
      this.consumeKeyword("table", "Expected 'table' after 'read'");
      const name = this.consumeName("Expected table name").value;
      this.consumePunctuation(";", "Expected ';' after read table");
      return { kind: "read_table_cmd", name, range: startRange };
    }

    if (this.matchContextualKeyword("write")) {
      if (this.matchKeyword("table")) {
        const name = this.consumeName("Expected table name").value;
        this.consumePunctuation(";", "Expected ';' after write table");
        return { kind: "write_table_cmd", name, range: startRange };
      }
      while (!this.checkPunctuation(";") && !this.isAtEnd()) this.advance();
      this.matchPunctuation(";");
      return undefined;
    }

    if (this.matchKeyword("display")) {
      let indexing: AmplIndexing | undefined;
      if (this.checkPunctuation("{")) {
        indexing = this.parseIndexing();
      }
      this.matchPunctuation(":");
      const exprs: AmplExpr[] = [];
      while (!this.checkPunctuation(";") && !this.isAtEnd()) {
        exprs.push(this.parseExpression());
        if (!this.matchPunctuation(",")) break;
      }
      this.consumePunctuation(";", "Expected ';' after display statement");
      return { kind: "display_cmd", indexing, exprs, range: startRange };
    }

    if (this.matchKeyword("printf")) {
      let indexing: AmplIndexing | undefined;
      if (this.checkPunctuation("{")) {
        indexing = this.parseIndexing();
      }
      this.matchPunctuation(":");
      const fmtTok = this.consume("STRING", "Expected format string in printf");
      const args: AmplExpr[] = [];
      while (this.matchPunctuation(",")) {
        if (this.checkPunctuation(";")) break;
        args.push(this.parseExpression());
      }
      this.consumePunctuation(";", "Expected ';' after printf statement");
      return { kind: "printf_cmd", indexing, format: fmtTok.value, args, range: startRange };
    }

    if (this.matchKeyword("for")) {
      const indexing = this.parseIndexing();
      const body = this.parseStatementBlock(model);
      return { kind: "for_cmd", indexing, body, range: startRange };
    }

    if (this.matchKeyword("repeat")) {
      let condition: AmplExpr | undefined;
      let isUntil = false;
      if (this.matchKeyword("while")) {
        condition = this.parseExpression();
      } else if (this.matchKeyword("until")) {
        condition = this.parseExpression();
        isUntil = true;
      }
      const body = this.parseStatementBlock(model);
      if (!condition) {
        if (this.matchKeyword("until")) {
          condition = this.parseExpression();
          isUntil = true;
        } else if (this.matchKeyword("while")) {
          condition = this.parseExpression();
        }
      }
      this.matchPunctuation(";");
      return { kind: "repeat_cmd", condition, isUntil, body, range: startRange };
    }

    if (this.matchKeyword("if")) {
      const condition = this.parseExpression();
      this.consumeKeyword("then", "Expected 'then' after if condition");
      const thenBody = this.parseStatementBlock(model);
      let elseBody: AmplStmt[] | undefined;
      if (this.matchKeyword("else")) {
        elseBody = this.parseStatementBlock(model);
      }
      return { kind: "if_cmd", condition, thenBody, elseBody, range: startRange };
    }

    if (this.matchKeyword("break")) {
      this.consumePunctuation(";", "Expected ';' after break");
      return { kind: "break_cmd", range: startRange };
    }

    if (this.matchKeyword("continue")) {
      this.consumePunctuation(";", "Expected ';' after continue");
      return { kind: "continue_cmd", range: startRange };
    }

    this.advance();
    return undefined;
  }

  private parseStatementBlock(model?: AmplModel): AmplStmt[] {
    const stmts: AmplStmt[] = [];
    if (this.matchPunctuation("{")) {
      while (!this.checkPunctuation("}") && !this.isAtEnd()) {
        if (this.matchPunctuation(";")) continue;
        const s = this.parseStatement(model);
        if (s) stmts.push(s);
      }
      this.consumePunctuation("}", "Expected '}' after statement block");
    } else {
      const s = this.parseStatement(model);
      if (s) stmts.push(s);
    }
    return stmts;
  }

  // ── Indexing Specifications ──

  private parseIndexing(): AmplIndexing {
    this.consumePunctuation("{", "Expected '{'");
    const iterators: AmplIterator[] = [];

    while (!this.checkPunctuation("}") && !this.isAtEnd()) {
      iterators.push(this.parseSingleIterator());
      if (this.matchPunctuation(",")) continue;
      else break;
    }

    this.consumePunctuation("}", "Expected '}'");
    return { iterators };
  }

  private parseSingleIterator(): AmplIterator {
    let vars: string[] = [];
    if (this.checkPunctuation("(")) {
      this.advance();
      while (!this.checkPunctuation(")") && !this.isAtEnd()) {
        vars.push(this.consumeName("Expected variable identifier in tuple").value);
        if (this.matchPunctuation(",")) continue;
        else break;
      }
      this.consumePunctuation(")", "Expected ')'");
    } else if (
      this.isNameToken(this.peek()) &&
      (this.peekNext().value.toLowerCase() === "in" || this.peekNext().value.toLowerCase() === "within")
    ) {
      vars.push(this.advance().value);
    }

    let setExpr: AmplExpr;
    if (this.matchKeyword("in") || this.matchKeyword("within")) {
      setExpr = this.parseSetExpression();
    } else {
      setExpr = this.parseSetExpression();
      if (vars.length === 0 && setExpr.kind === "identifier") {
        vars = ["_elem_" + setExpr.name];
      }
    }

    let condition: AmplExpr | undefined;
    if (this.matchPunctuation(":")) {
      condition = this.parseExpression();
    }

    return { variables: vars, setExpr, condition };
  }

  private parseSetExpression(): AmplExpr {
    const left = this.parseExpression(3);
    if (this.matchOperator("..")) {
      const right = this.parseExpression(3);
      let step: AmplExpr | undefined;
      if (this.matchKeyword("by")) {
        step = this.parseExpression(3);
      }
      return { kind: "range", start: left, end: right, step };
    }
    return left;
  }

  // ── Expressions ──

  public parseExpression(minPrecedence = 0): AmplExpr {
    let left = this.parseUnary();

    while (true) {
      const opToken = this.peek();
      const prec = this.getPrecedence(opToken);
      if (prec < minPrecedence) break;

      this.advance();
      const op = opToken.value.toLowerCase() as AmplBinaryOp;
      const right = this.parseExpression(prec + (this.isRightAssociative(op) ? 0 : 1));

      if (op === ".." as any) {
        let step: AmplExpr | undefined;
        if (this.matchKeyword("by")) {
          step = this.parseExpression(4);
        }
        left = {
          kind: "range",
          start: left,
          end: right,
          step,
          range: { start: left.range?.start ?? opToken.range.start, end: right.range?.end ?? opToken.range.end },
        };
      } else {
        left = {
          kind: "binary",
          op,
          left,
          right,
          range: { start: left.range?.start ?? opToken.range.start, end: right.range?.end ?? opToken.range.end },
        };
      }
    }

    return left;
  }

  private parseUnary(): AmplExpr {
    if (
      this.matchOperator("+") ||
      this.matchOperator("-") ||
      this.matchOperator("!") ||
      this.matchKeyword("not")
    ) {
      const opToken = this.previous();
      const operand = this.parseUnary();
      return {
        kind: "unary",
        op: opToken.value.toLowerCase() as AmplUnaryOp,
        expr: operand,
        range: { start: opToken.range.start, end: operand.range?.end ?? opToken.range.end },
      };
    }

    // Piecewise-linear expression: <<b1, b2, ...; s1, s2, ...>> arg
    if (this.matchOperator("<<")) {
      const startRange = this.previous().range;
      const breakpoints: AmplExpr[] = [];
      while (!this.checkPunctuation(";") && !this.isAtEnd()) {
        breakpoints.push(this.parseExpression());
        if (!this.matchPunctuation(",")) break;
      }
      this.consumePunctuation(";", "Expected ';' separating breakpoints and slopes in piecewise-linear term");
      const slopes: AmplExpr[] = [];
      while (!this.checkOperator(">>") && !this.isAtEnd()) {
        slopes.push(this.parseExpression());
        if (!this.matchPunctuation(",")) break;
      }
      this.consumeOperator(">>", "Expected '>>' closing piecewise-linear term");

      let argument: AmplExpr;
      let zeroPoint: AmplExpr | undefined;
      if (this.matchPunctuation("(")) {
        argument = this.parseExpression();
        if (this.matchPunctuation(",")) {
          zeroPoint = this.parseExpression();
        }
        this.consumePunctuation(")", "Expected ')' after piecewise-linear argument");
      } else {
        argument = this.parseUnary();
      }

      return {
        kind: "piecewise",
        breakpoints,
        slopes,
        argument,
        zeroPoint,
        range: { start: startRange.start, end: argument.range?.end ?? startRange.end },
      };
    }

    return this.parsePostfix();
  }

  private parsePostfix(): AmplExpr {
    let expr = this.parsePrimary();

    // Postfix suffix access: expr.val, expr.dual, expr.rc, expr.slack, expr.body, expr.lb, expr.ub, expr.sosno, expr.ref
    while (this.peek().value === ".") {
      this.advance(); // consume '.'
      const sufTok = this.consumeName("Expected suffix name after '.'");
      expr = {
        kind: "suffix",
        target: expr,
        suffix: sufTok.value,
        range: { start: expr.range?.start ?? sufTok.range.start, end: sufTok.range.end },
      };
    }

    return expr;
  }

  private parsePrimary(): AmplExpr {
    const token = this.peek();

    // Reductions: sum {i in I} expr, prod {i in I} expr, min {i in I} expr, max {i in I} expr, count {i in I} (cond), forall {i in I} (cond)
    if (
      (token.type === "KEYWORD" || token.type === "IDENTIFIER") &&
      (token.value.toLowerCase() === "sum" ||
        token.value.toLowerCase() === "prod" ||
        token.value.toLowerCase() === "min" ||
        token.value.toLowerCase() === "max" ||
        token.value.toLowerCase() === "forall" ||
        token.value.toLowerCase() === "exists" ||
        token.value.toLowerCase() === "count") &&
      this.peekNext().value === "{"
    ) {
      this.advance();
      const kind = token.value.toLowerCase() as AmplReductionKind;
      const indexing = this.parseIndexing();
      let expr: AmplExpr;
      if (this.matchPunctuation(":")) {
        expr = this.parseExpression();
      } else {
        expr = this.parseExpression(this.getPrecedence({ type: "OPERATOR", value: "+", range: token.range }));
      }
      return {
        kind: "reduction",
        reduction: kind,
        iterators: indexing.iterators,
        expr,
        range: { start: token.range.start, end: expr.range?.end ?? token.range.end },
      };
    }

    // `numberof val in ({i in I} expr)`
    if (this.matchKeyword("numberof")) {
      const targetVal = this.parseExpression(4);
      this.consumeKeyword("in", "Expected 'in' after numberof value");
      this.consumePunctuation("(", "Expected '(' after 'in' in numberof");
      const indexing = this.parseIndexing();
      const bodyExpr = this.parseExpression();
      this.consumePunctuation(")", "Expected ')' closing numberof");
      return {
        kind: "reduction",
        reduction: "count",
        iterators: indexing.iterators,
        expr: {
          kind: "binary",
          op: "==",
          left: bodyExpr,
          right: targetVal,
        },
        range: { start: token.range.start, end: this.previous().range.end },
      };
    }

    if (this.matchKeyword("if")) {
      const condition = this.parseExpression();
      this.consumeKeyword("then", "Expected 'then' after if condition");
      const thenExpr = this.parseExpression();
      let elseExpr: AmplExpr = { kind: "number", value: 0 };
      if (this.matchKeyword("else")) {
        elseExpr = this.parseExpression();
      }
      return {
        kind: "if_then_else",
        condition,
        thenExpr,
        elseExpr,
        range: { start: token.range.start, end: elseExpr.range?.end ?? token.range.end },
      };
    }

    if (this.match("NUMBER")) {
      return {
        kind: "number",
        value: token.numValue ?? Number.parseFloat(token.value),
        range: token.range,
      };
    }

    if (this.match("STRING")) {
      return {
        kind: "string",
        value: token.value,
        range: token.range,
      };
    }

    if (this.matchKeyword("infinity") || this.matchKeyword("Infinity")) {
      return {
        kind: "number",
        value: Number.POSITIVE_INFINITY,
        range: token.range,
      };
    }

    if (this.matchKeyword("to_come")) {
      return {
        kind: "number",
        value: 0,
        range: token.range,
      };
    }

    if (this.matchOperator("*")) {
      return {
        kind: "wildcard",
        range: token.range,
      };
    }

    if (this.isNameToken(token)) {
      this.advance();
      const name = token.value;

      // Function call: fn(args...)
      if (this.checkPunctuation("(")) {
        this.advance();
        const args: AmplExpr[] = [];
        if (!this.checkPunctuation(")")) {
          do {
            args.push(this.parseExpression());
          } while (this.matchPunctuation(","));
        }
        this.consumePunctuation(")", "Expected ')' after function arguments");
        return {
          kind: "call",
          fn: name,
          args,
          range: { start: token.range.start, end: this.previous().range.end },
        };
      }

      // Subscript: var[i, j] or param[i, *]
      if (this.checkPunctuation("[")) {
        this.advance();
        const indices: AmplExpr[] = [];
        do {
          if (this.matchOperator("*")) {
            indices.push({ kind: "wildcard", range: this.previous().range });
          } else {
            indices.push(this.parseExpression());
          }
        } while (this.matchPunctuation(","));
        this.consumePunctuation("]", "Expected ']' after subscripts");
        return {
          kind: "subscript",
          name,
          indices,
          range: { start: token.range.start, end: this.previous().range.end },
        };
      }

      return {
        kind: "identifier",
        name,
        range: token.range,
      };
    }

    if (this.matchPunctuation("(")) {
      const expr = this.parseExpression();
      this.consumePunctuation(")", "Expected ')'");
      return expr;
    }

    if (this.matchPunctuation("{")) {
      const elements: AmplExpr[] = [];
      if (!this.checkPunctuation("}")) {
        do {
          elements.push(this.parseExpression());
        } while (this.matchPunctuation(","));
      }
      this.consumePunctuation("}", "Expected '}'");
      return {
        kind: "set_literal",
        elements,
        range: { start: token.range.start, end: this.previous().range.end },
      };
    }

    throw new Error(`Unexpected token '${token.value}' at line ${token.range.start.line}, column ${token.range.start.column}`);
  }

  // ── Precedence ──

  private getPrecedence(token: Token): number {
    if (token.type === "KEYWORD") {
      const v = token.value.toLowerCase();
      if (v === "or") return 1;
      if (v === "and") return 2;
      if (v === "union" || v === "diff" || v === "symdiff") return 4;
      if (v === "inter" || v === "cross") return 5;
      if (v === "mod" || v === "div") return 5;
    }
    if (token.type === "OPERATOR") {
      switch (token.value) {
        case "<==>":
          return 0;
        case "==>":
          return 1;
        case "==":
        case "=":
        case "!=":
        case "<>":
        case "<":
        case "<=":
        case ">":
        case ">=":
          return 3;
        case "..":
          return 3;
        case "+":
        case "-":
          return 4;
        case "*":
        case "/":
        case "mod":
        case "div":
          return 5;
        case "^":
        case "**":
          return 6;
      }
    }
    return -1;
  }

  private isRightAssociative(op: string): boolean {
    return op === "^" || op === "**" || op === "==>";
  }

  private matchRelOp(): boolean {
    const val = this.peek().value;
    if (val === "<=" || val === ">=" || val === "==" || val === "=" || val === "!=" || val === "<>" || val === "<" || val === ">") {
      this.advance();
      return true;
    }
    return false;
  }

  // ── Helper methods ──

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: "EOF", value: "", range: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } };
  }

  private peekNext(): Token {
    return this.tokens[this.pos + 1] ?? { type: "EOF", value: "", range: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } } };
  }

  private previous(): Token {
    return this.tokens[this.pos - 1]!;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.pos++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === "EOF";
  }

  private isNameToken(tok: Token): boolean {
    return tok.type === "IDENTIFIER" || tok.type === "KEYWORD";
  }

  private consumeName(message: string): Token {
    if (this.isNameToken(this.peek())) return this.advance();
    throw new Error(`${message}. Found '${this.peek().value}' at line ${this.peek().range.start.line}, column ${this.peek().range.start.column}`);
  }

  private match(type: Token["type"]): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchKeyword(val: string): boolean {
    if (this.peek().type === "KEYWORD" && this.peek().value.toLowerCase() === val.toLowerCase()) {
      this.advance();
      return true;
    }
    return false;
  }

  private checkKeyword(val: string): boolean {
    if (this.isAtEnd()) return false;
    return (
      (this.peek().type === "KEYWORD" || this.peek().type === "IDENTIFIER") &&
      this.peek().value.toLowerCase() === val.toLowerCase()
    );
  }

  private matchContextualKeyword(val: string): boolean {
    if (
      (this.peek().type === "KEYWORD" || this.peek().type === "IDENTIFIER") &&
      this.peek().value.toLowerCase() === val.toLowerCase()
    ) {
      this.advance();
      return true;
    }
    return false;
  }

  private matchOperator(val: string): boolean {
    if (this.peek().type === "OPERATOR" && this.peek().value === val) {
      this.advance();
      return true;
    }
    return false;
  }

  private checkOperator(val: string): boolean {
    return this.peek().type === "OPERATOR" && this.peek().value === val;
  }

  private matchPunctuation(val: string): boolean {
    if (this.peek().type === "PUNCTUATION" && this.peek().value === val) {
      this.advance();
      return true;
    }
    return false;
  }

  private check(type: Token["type"]): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private checkPunctuation(val: string): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === "PUNCTUATION" && this.peek().value === val;
  }

  private consume(type: Token["type"], message: string): Token {
    if (this.check(type)) return this.advance();
    throw new Error(`${message}. Found '${this.peek().value}' at line ${this.peek().range.start.line}, column ${this.peek().range.start.column}`);
  }

  private consumeKeyword(val: string, message: string): Token {
    if (
      (this.peek().type === "KEYWORD" || this.peek().type === "IDENTIFIER") &&
      this.peek().value.toLowerCase() === val.toLowerCase()
    ) {
      return this.advance();
    }
    throw new Error(`${message}. Found '${this.peek().value}' at line ${this.peek().range.start.line}, column ${this.peek().range.start.column}`);
  }

  private consumeOperator(val: string, message: string): Token {
    if (this.checkOperator(val)) return this.advance();
    throw new Error(`${message}. Found '${this.peek().value}' at line ${this.peek().range.start.line}, column ${this.peek().range.start.column}`);
  }

  private consumePunctuation(val: string, message: string): Token {
    if (this.checkPunctuation(val)) return this.advance();
    throw new Error(`${message}. Found '${this.peek().value}' at line ${this.peek().range.start.line}, column ${this.peek().range.start.column}`);
  }
}

export function parseAmplModel(input: string): AmplModel {
  return new AmplModParser(input).parse();
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  VhdlArchitecture,
  VhdlComponentDecl,
  VhdlConcStmt,
  VhdlConstantDecl,
  VhdlDesignFile,
  VhdlEntity,
  VhdlExpr,
  VhdlGenericDecl,
  VhdlPackage,
  VhdlPackageBody,
  VhdlParseError,
  VhdlPortDecl,
  VhdlPortDirection,
  VhdlRange,
  VhdlSeqStmt,
  VhdlSignalDecl,
  VhdlSpan,
  VhdlTarget,
  VhdlTypeDecl,
  VhdlTypeRef,
  VhdlVariableDecl,
} from "../types.js";
import { tokenizeVhdl, type VhdlToken } from "./lexer.js";

const UNRESOLVED_TYPES = new Set([
  "std_ulogic",
  "std_ulogic_vector",
  "bit",
  "bit_vector",
  "boolean",
  "integer",
  "natural",
  "positive",
]);

const RESOLVED_TYPES = new Set(["std_logic", "std_logic_vector", "unsigned", "signed"]);

function evalStaticInt(expr: VhdlExpr): number | undefined {
  if (expr.kind === "intLiteral") return expr.value;
  if (expr.kind === "unary" && expr.op === "-") {
    const v = evalStaticInt(expr.operand);
    return v !== undefined ? -v : undefined;
  }
  if (expr.kind === "binary") {
    const l = evalStaticInt(expr.left);
    const r = evalStaticInt(expr.right);
    if (l === undefined || r === undefined) return undefined;
    if (expr.op === "+") return l + r;
    if (expr.op === "-") return l - r;
    if (expr.op === "*") return l * r;
  }
  return undefined;
}

export function computeRangeWidth(range: VhdlRange | undefined): number | undefined {
  if (!range) return undefined;
  const l = evalStaticInt(range.left);
  const r = evalStaticInt(range.right);
  if (l === undefined || r === undefined) return undefined;
  return range.direction === "downto" ? Math.max(0, l - r + 1) : Math.max(0, r - l + 1);
}

function mergeSpan(a: VhdlSpan, b: VhdlSpan): VhdlSpan {
  return {
    line: a.line,
    column: a.column,
    endLine: b.endLine,
    endColumn: b.endColumn,
    startOffset: a.startOffset,
    endOffset: b.endOffset,
  };
}

class VhdlRecursiveParser {
  private readonly tokens: VhdlToken[];
  private pos = 0;
  readonly errors: VhdlParseError[] = [];

  constructor(tokens: VhdlToken[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): VhdlToken {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]!;
  }

  private advance(): VhdlToken {
    const tok = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  private isEof(): boolean {
    return this.peek().kind === "eof";
  }

  private checkKw(kw: string): boolean {
    const t = this.peek();
    return t.kind === "ident" && t.lower === kw;
  }

  private matchKw(kw: string): VhdlToken | undefined {
    if (this.checkKw(kw)) return this.advance();
    return undefined;
  }

  private checkSym(sym: string): boolean {
    const t = this.peek();
    return t.kind === "symbol" && t.value === sym;
  }

  private matchSym(sym: string): VhdlToken | undefined {
    if (this.checkSym(sym)) return this.advance();
    return undefined;
  }

  private expectSym(sym: string): VhdlToken {
    if (this.checkSym(sym)) return this.advance();
    const t = this.peek();
    this.errors.push({ message: `Expected '${sym}', found '${t.value || "EOF"}'`, span: t.span });
    return t;
  }

  private expectKw(kw: string): VhdlToken {
    if (this.checkKw(kw)) return this.advance();
    const t = this.peek();
    this.errors.push({ message: `Expected keyword '${kw}', found '${t.value || "EOF"}'`, span: t.span });
    return t;
  }

  private expectIdent(): VhdlToken {
    const t = this.peek();
    if (t.kind === "ident") return this.advance();
    this.errors.push({ message: `Expected identifier, found '${t.value || "EOF"}'`, span: t.span });
    return t;
  }

  private syncToSemicolon(): void {
    while (!this.isEof() && !this.checkSym(";")) {
      this.advance();
    }
    this.matchSym(";");
  }

  parseDesignFile(): VhdlDesignFile {
    const file: VhdlDesignFile = {
      libraries: [],
      uses: [],
      entities: [],
      architectures: [],
      packages: [],
      packageBodies: [],
      parseErrors: this.errors,
    };

    while (!this.isEof()) {
      if (this.checkKw("library")) {
        file.libraries.push(this.parseLibraryClause());
      } else if (this.checkKw("use")) {
        file.uses.push(this.parseUseClause());
      } else if (this.checkKw("entity")) {
        file.entities.push(this.parseEntity());
      } else if (this.checkKw("architecture")) {
        file.architectures.push(this.parseArchitecture());
      } else if (this.checkKw("package")) {
        if (this.peek(1).kind === "ident" && this.peek(1).lower === "body") {
          file.packageBodies.push(this.parsePackageBody());
        } else {
          file.packages.push(this.parsePackage());
        }
      } else {
        const bad = this.advance();
        this.errors.push({
          message: `Unexpected token '${bad.value}' at top level`,
          span: bad.span,
        });
      }
    }

    return file;
  }

  private parseLibraryClause() {
    const start = this.expectKw("library");
    const libraries: string[] = [];
    libraries.push(this.expectIdent().value);
    while (this.matchSym(",")) {
      libraries.push(this.expectIdent().value);
    }
    const end = this.expectSym(";");
    return { libraries, span: mergeSpan(start.span, end.span) };
  }

  private parseUseClause() {
    const start = this.expectKw("use");
    const items: string[] = [];
    const readSelectedName = (): string => {
      let name = this.expectIdent().value;
      while (this.matchSym(".")) {
        name += "." + this.expectIdent().value;
      }
      return name;
    };
    items.push(readSelectedName());
    while (this.matchSym(",")) {
      items.push(readSelectedName());
    }
    const end = this.expectSym(";");
    return { items, span: mergeSpan(start.span, end.span) };
  }

  private parseEntity(): VhdlEntity {
    const start = this.expectKw("entity");
    const nameTok = this.expectIdent();
    this.expectKw("is");

    const generics: VhdlGenericDecl[] = [];
    const ports: VhdlPortDecl[] = [];

    while (!this.isEof() && !this.checkKw("end")) {
      if (this.checkKw("generic")) {
        generics.push(...this.parseGenericClause());
      } else if (this.checkKw("port")) {
        ports.push(...this.parsePortClause());
      } else {
        const bad = this.advance();
        this.errors.push({ message: `Unexpected token '${bad.value}' in entity '${nameTok.value}'`, span: bad.span });
      }
    }

    this.expectKw("end");
    this.matchKw("entity");
    let endName: string | undefined;
    if (this.peek().kind === "ident") {
      endName = this.advance().value;
    }
    const endTok = this.expectSym(";");

    return {
      name: nameTok.value,
      endName,
      generics,
      ports,
      span: mergeSpan(start.span, endTok.span),
    };
  }

  private parseGenericClause(): VhdlGenericDecl[] {
    this.expectKw("generic");
    this.expectSym("(");
    const generics: VhdlGenericDecl[] = [];

    while (!this.isEof() && !this.checkSym(")")) {
      this.matchKw("constant");
      const names: VhdlToken[] = [this.expectIdent()];
      while (this.matchSym(",")) {
        names.push(this.expectIdent());
      }
      this.expectSym(":");
      const type = this.parseTypeRef();
      let defaultValue: VhdlExpr | undefined;
      if (this.matchSym(":=")) {
        defaultValue = this.parseExpr();
      }
      for (const n of names) {
        generics.push({ name: n.value, type, defaultValue, span: n.span });
      }
      if (!this.matchSym(";")) break;
    }

    this.expectSym(")");
    this.expectSym(";");
    return generics;
  }

  private parsePortClause(): VhdlPortDecl[] {
    this.expectKw("port");
    this.expectSym("(");
    const ports: VhdlPortDecl[] = [];

    while (!this.isEof() && !this.checkSym(")")) {
      this.matchKw("signal");
      const names: VhdlToken[] = [this.expectIdent()];
      while (this.matchSym(",")) {
        names.push(this.expectIdent());
      }
      this.expectSym(":");

      let direction: VhdlPortDirection = "in";
      const dirTok = this.peek();
      if (
        dirTok.kind === "ident" &&
        (dirTok.lower === "in" ||
          dirTok.lower === "out" ||
          dirTok.lower === "inout" ||
          dirTok.lower === "buffer" ||
          dirTok.lower === "linkage")
      ) {
        direction = this.advance().lower as VhdlPortDirection;
      }

      const type = this.parseTypeRef();
      let defaultValue: VhdlExpr | undefined;
      if (this.matchSym(":=")) {
        defaultValue = this.parseExpr();
      }
      for (const n of names) {
        ports.push({ name: n.value, direction, type, defaultValue, span: n.span });
      }
      if (!this.matchSym(";")) break;
    }

    this.expectSym(")");
    this.expectSym(";");
    return ports;
  }

  private parseTypeRef(): VhdlTypeRef {
    const baseTok = this.expectIdent();
    const baseLower = baseTok.lower;
    let range: VhdlRange | undefined;

    if (this.matchSym("(")) {
      range = this.parseRange();
      this.expectSym(")");
    } else if (this.matchKw("range")) {
      range = this.parseRange();
    }

    let width: number | undefined = computeRangeWidth(range);
    if (
      width === undefined &&
      (baseLower === "std_logic" || baseLower === "std_ulogic" || baseLower === "bit" || baseLower === "boolean")
    ) {
      width = 1;
    }

    const resolved = RESOLVED_TYPES.has(baseLower) ? true : UNRESOLVED_TYPES.has(baseLower) ? false : undefined;

    return { name: baseTok.value, range, width, resolved };
  }

  private parseRange(): VhdlRange {
    const left = this.parseAddExpr();
    let direction: "downto" | "to" = "downto";
    if (this.matchKw("downto")) {
      direction = "downto";
    } else if (this.matchKw("to")) {
      direction = "to";
    } else {
      const t = this.peek();
      this.errors.push({ message: `Expected 'downto' or 'to' in range, found '${t.value}'`, span: t.span });
    }
    const right = this.parseAddExpr();
    return { left, direction, right };
  }

  private parseArchitecture(): VhdlArchitecture {
    const start = this.expectKw("architecture");
    const nameTok = this.expectIdent();
    this.expectKw("of");
    const entityTok = this.expectIdent();
    this.expectKw("is");

    const signals: VhdlSignalDecl[] = [];
    const constants: VhdlConstantDecl[] = [];
    const types: VhdlTypeDecl[] = [];
    const components: VhdlComponentDecl[] = [];

    while (!this.isEof() && !this.checkKw("begin") && !this.checkKw("end")) {
      if (this.checkKw("signal")) {
        signals.push(...this.parseSignalDecl());
      } else if (this.checkKw("constant")) {
        constants.push(...this.parseConstantDecl());
      } else if (this.checkKw("type") || this.checkKw("subtype")) {
        types.push(this.parseTypeDecl());
      } else if (this.checkKw("component")) {
        components.push(this.parseComponentDecl());
      } else {
        const bad = this.advance();
        this.errors.push({
          message: `Unexpected token '${bad.value}' in architecture declarative part`,
          span: bad.span,
        });
        this.syncToSemicolon();
      }
    }

    this.expectKw("begin");

    const statements: VhdlConcStmt[] = [];
    while (!this.isEof() && !this.checkKw("end")) {
      const stmt = this.parseConcurrentStmt();
      if (stmt) statements.push(stmt);
    }

    this.expectKw("end");
    this.matchKw("architecture");
    let endName: string | undefined;
    if (this.peek().kind === "ident") {
      endName = this.advance().value;
    }
    const endTok = this.expectSym(";");

    return {
      name: nameTok.value,
      entityName: entityTok.value,
      endName,
      signals,
      constants,
      types,
      components,
      statements,
      span: mergeSpan(start.span, endTok.span),
    };
  }

  private parsePackage(): VhdlPackage {
    const start = this.expectKw("package");
    const nameTok = this.expectIdent();
    this.expectKw("is");

    const constants: VhdlConstantDecl[] = [];
    const types: VhdlTypeDecl[] = [];
    const components: VhdlComponentDecl[] = [];

    while (!this.isEof() && !this.checkKw("end")) {
      if (this.checkKw("constant")) {
        constants.push(...this.parseConstantDecl());
      } else if (this.checkKw("type") || this.checkKw("subtype")) {
        types.push(this.parseTypeDecl());
      } else if (this.checkKw("component")) {
        components.push(this.parseComponentDecl());
      } else if (this.checkKw("function") || this.checkKw("procedure")) {
        this.syncToSemicolon();
      } else {
        this.advance();
      }
    }

    this.expectKw("end");
    this.matchKw("package");
    let endName: string | undefined;
    if (this.peek().kind === "ident") {
      endName = this.advance().value;
    }
    const endTok = this.expectSym(";");

    return {
      name: nameTok.value,
      endName,
      constants,
      types,
      components,
      span: mergeSpan(start.span, endTok.span),
    };
  }

  private parsePackageBody(): VhdlPackageBody {
    const start = this.expectKw("package");
    this.expectKw("body");
    const nameTok = this.expectIdent();
    this.expectKw("is");

    const constants: VhdlConstantDecl[] = [];
    const types: VhdlTypeDecl[] = [];

    while (!this.isEof()) {
      if (this.checkKw("end")) {
        const next = this.peek(1);
        if (
          (next.kind === "symbol" && next.value === ";") ||
          (next.kind === "ident" && (next.lower === "package" || next.lower === nameTok.lower))
        ) {
          break;
        }
      }
      if (this.checkKw("constant")) {
        constants.push(...this.parseConstantDecl());
      } else if (this.checkKw("type") || this.checkKw("subtype")) {
        types.push(this.parseTypeDecl());
      } else {
        this.advance();
      }
    }

    this.expectKw("end");
    if (this.matchKw("package")) {
      this.matchKw("body");
    }
    let endName: string | undefined;
    if (this.peek().kind === "ident") {
      endName = this.advance().value;
    }
    const endTok = this.expectSym(";");

    return {
      name: nameTok.value,
      endName,
      constants,
      types,
      span: mergeSpan(start.span, endTok.span),
    };
  }

  private parseSignalDecl(): VhdlSignalDecl[] {
    this.expectKw("signal");
    const names: VhdlToken[] = [this.expectIdent()];
    while (this.matchSym(",")) {
      names.push(this.expectIdent());
    }
    this.expectSym(":");
    const type = this.parseTypeRef();
    let defaultValue: VhdlExpr | undefined;
    if (this.matchSym(":=")) {
      defaultValue = this.parseExpr();
    }
    this.expectSym(";");
    return names.map((n) => ({ name: n.value, type, defaultValue, span: n.span }));
  }

  private parseVariableDecl(): VhdlVariableDecl[] {
    this.expectKw("variable");
    const names: VhdlToken[] = [this.expectIdent()];
    while (this.matchSym(",")) {
      names.push(this.expectIdent());
    }
    this.expectSym(":");
    const type = this.parseTypeRef();
    let defaultValue: VhdlExpr | undefined;
    if (this.matchSym(":=")) {
      defaultValue = this.parseExpr();
    }
    this.expectSym(";");
    return names.map((n) => ({ name: n.value, type, defaultValue, span: n.span }));
  }

  private parseConstantDecl(): VhdlConstantDecl[] {
    this.expectKw("constant");
    const names: VhdlToken[] = [this.expectIdent()];
    while (this.matchSym(",")) {
      names.push(this.expectIdent());
    }
    this.expectSym(":");
    const type = this.parseTypeRef();
    this.expectSym(":=");
    const value = this.parseExpr();
    this.expectSym(";");
    return names.map((n) => ({ name: n.value, type, value, span: n.span }));
  }

  private parseTypeDecl(): VhdlTypeDecl {
    const isSubtype = this.checkKw("subtype");
    const start = this.advance();
    const nameTok = this.expectIdent();
    this.expectKw("is");

    if (isSubtype) {
      const baseType = this.parseTypeRef();
      const end = this.expectSym(";");
      return { name: nameTok.value, kind: "subtype", baseType, span: mergeSpan(start.span, end.span) };
    }

    if (this.matchSym("(")) {
      const enumLiterals: string[] = [];
      while (!this.isEof() && !this.checkSym(")")) {
        const tok = this.advance();
        enumLiterals.push(tok.value);
        if (!this.matchSym(",")) break;
      }
      this.expectSym(")");
      const end = this.expectSym(";");
      return { name: nameTok.value, kind: "enum", enumLiterals, span: mergeSpan(start.span, end.span) };
    }

    if (this.checkKw("array")) {
      this.syncToSemicolon();
      return { name: nameTok.value, kind: "array", span: mergeSpan(start.span, this.peek().span) };
    }

    this.syncToSemicolon();
    return { name: nameTok.value, kind: "range", span: mergeSpan(start.span, this.peek().span) };
  }

  private parseComponentDecl(): VhdlComponentDecl {
    const start = this.expectKw("component");
    const nameTok = this.expectIdent();
    this.matchKw("is");

    const generics: VhdlGenericDecl[] = [];
    const ports: VhdlPortDecl[] = [];
    while (!this.isEof() && !this.checkKw("end")) {
      if (this.checkKw("generic")) {
        generics.push(...this.parseGenericClause());
      } else if (this.checkKw("port")) {
        ports.push(...this.parsePortClause());
      } else {
        this.advance();
      }
    }

    this.expectKw("end");
    this.expectKw("component");
    if (this.peek().kind === "ident") this.advance();
    const end = this.expectSym(";");

    return { name: nameTok.value, generics, ports, span: mergeSpan(start.span, end.span) };
  }

  private parseConcurrentStmt(): VhdlConcStmt | undefined {
    let label: string | undefined;
    const startTok = this.peek();

    // Optional label: `label : ...`
    if (this.peek().kind === "ident" && this.peek(1).kind === "symbol" && this.peek(1).value === ":") {
      label = this.advance().value;
      this.advance(); // ':'
    }

    if (this.checkKw("process")) {
      return this.parseProcessStmt(label, startTok.span);
    }

    if (this.checkKw("with")) {
      return this.parseSelectedSignalAssign(label, startTok.span);
    }

    // Component instantiation: `u1 : [entity work.]comp_name [generic map (...)] [port map (...)];`
    if (
      label !== undefined &&
      (this.checkKw("component") ||
        this.checkKw("entity") ||
        (this.peek().kind === "ident" && (this.peek(1).lower === "port" || this.peek(1).lower === "generic")))
    ) {
      return this.parseComponentInst(label, startTok.span);
    }

    // Concurrent signal assignment (including conditional `when ... else`)
    if (this.peek().kind === "ident") {
      return this.parseCondSignalAssign(label, startTok.span);
    }

    const bad = this.advance();
    this.errors.push({ message: `Unexpected token '${bad.value}' in architecture body`, span: bad.span });
    this.syncToSemicolon();
    return undefined;
  }

  private parseProcessStmt(label: string | undefined, startSpan: VhdlSpan): VhdlConcStmt {
    this.expectKw("process");
    const sensitivity: string[] = [];

    if (this.matchSym("(")) {
      while (!this.isEof() && !this.checkSym(")")) {
        sensitivity.push(this.expectIdent().value);
        if (!this.matchSym(",")) break;
      }
      this.expectSym(")");
    }

    this.matchKw("is");

    const variables: VhdlVariableDecl[] = [];
    const constants: VhdlConstantDecl[] = [];

    while (!this.isEof() && !this.checkKw("begin") && !this.checkKw("end")) {
      if (this.checkKw("variable")) {
        variables.push(...this.parseVariableDecl());
      } else if (this.checkKw("constant")) {
        constants.push(...this.parseConstantDecl());
      } else {
        this.advance();
      }
    }

    this.expectKw("begin");
    const body = this.parseSeqStmtList(["end"]);
    this.expectKw("end");
    this.expectKw("process");
    if (this.peek().kind === "ident") this.advance();
    const end = this.expectSym(";");

    return {
      kind: "process",
      label,
      sensitivity,
      variables,
      constants,
      body,
      span: mergeSpan(startSpan, end.span),
    };
  }

  private parseSelectedSignalAssign(label: string | undefined, startSpan: VhdlSpan): VhdlConcStmt {
    this.expectKw("with");
    const selector = this.parseExpr();
    this.expectKw("select");
    const target = this.parseTarget();
    this.expectSym("<=");

    const alternatives: Array<{ value: VhdlExpr; choice: string }> = [];
    while (!this.isEof()) {
      const value = this.parseExpr();
      this.expectKw("when");
      const choiceTok = this.advance();
      const choice =
        choiceTok.kind === "char"
          ? `'${choiceTok.value}'`
          : choiceTok.kind === "string"
            ? `"${choiceTok.value}"`
            : choiceTok.value;
      alternatives.push({ value, choice });
      if (!this.matchSym(",")) break;
    }

    const end = this.expectSym(";");
    return {
      kind: "selectedSignalAssign",
      label,
      selector,
      target,
      alternatives,
      span: mergeSpan(startSpan, end.span),
    };
  }

  private parseCondSignalAssign(label: string | undefined, startSpan: VhdlSpan): VhdlConcStmt {
    const target = this.parseTarget();
    this.expectSym("<=");

    const branches: Array<{ value: VhdlExpr; condition?: VhdlExpr | undefined }> = [];
    while (!this.isEof()) {
      const value = this.parseExpr();
      if (this.matchKw("after")) {
        this.parseExpr();
        if (this.peek().kind === "ident") this.advance(); // time unit e.g. ns
      }
      if (this.matchKw("when")) {
        const condition = this.parseExpr();
        branches.push({ value, condition });
        if (this.matchKw("else")) continue;
        break;
      } else {
        branches.push({ value });
        break;
      }
    }

    const end = this.expectSym(";");
    return {
      kind: "condSignalAssign",
      label,
      target,
      branches,
      span: mergeSpan(startSpan, end.span),
    };
  }

  private parseComponentInst(label: string, startSpan: VhdlSpan): VhdlConcStmt {
    this.matchKw("component");
    if (this.matchKw("entity")) {
      // Optional `work.entity_name`
      const first = this.expectIdent();
      if (this.matchSym(".")) {
        // use entity name after dot
      } else {
        // backtrack not needed; handled below
        this.pos--;
        void first;
      }
    }
    const compTok = this.expectIdent();

    const genericMap: Array<{ formal?: string | undefined; actual: VhdlExpr }> = [];
    const portMap: Array<{ formal?: string | undefined; actual: VhdlExpr }> = [];

    if (this.checkKw("generic") && this.peek(1).lower === "map") {
      this.advance();
      this.advance();
      genericMap.push(...this.parseAssociationList());
    }

    if (this.checkKw("port") && this.peek(1).lower === "map") {
      this.advance();
      this.advance();
      portMap.push(...this.parseAssociationList());
    }

    const end = this.expectSym(";");
    return {
      kind: "componentInst",
      label,
      componentName: compTok.value,
      genericMap,
      portMap,
      span: mergeSpan(startSpan, end.span),
    };
  }

  private parseAssociationList(): Array<{ formal?: string | undefined; actual: VhdlExpr }> {
    this.expectSym("(");
    const list: Array<{ formal?: string | undefined; actual: VhdlExpr }> = [];
    while (!this.isEof() && !this.checkSym(")")) {
      if (this.peek().kind === "ident" && this.peek(1).kind === "symbol" && this.peek(1).value === "=>") {
        const formal = this.advance().value;
        this.advance(); // =>
        const actual = this.parseExpr();
        list.push({ formal, actual });
      } else {
        const actual = this.parseExpr();
        list.push({ actual });
      }
      if (!this.matchSym(",")) break;
    }
    this.expectSym(")");
    return list;
  }

  private parseSeqStmtList(stopKeywords: string[]): VhdlSeqStmt[] {
    const stmts: VhdlSeqStmt[] = [];
    while (!this.isEof()) {
      const cur = this.peek();
      if (cur.kind === "ident" && stopKeywords.includes(cur.lower)) break;
      const stmt = this.parseSeqStmt();
      if (stmt) stmts.push(stmt);
    }
    return stmts;
  }

  private parseSeqStmt(): VhdlSeqStmt | undefined {
    const start = this.peek();

    if (this.checkKw("if")) {
      return this.parseIfStmt();
    }
    if (this.checkKw("case")) {
      return this.parseCaseStmt();
    }
    if (this.checkKw("for")) {
      return this.parseForLoopStmt(undefined, start.span);
    }
    if (this.checkKw("null")) {
      this.advance();
      const end = this.expectSym(";");
      return { kind: "null", span: mergeSpan(start.span, end.span) };
    }
    if (this.checkKw("wait")) {
      this.advance();
      const sensitivity: string[] = [];
      let forNs: number | undefined;
      if (this.matchKw("on")) {
        sensitivity.push(this.expectIdent().value);
        while (this.matchSym(",")) sensitivity.push(this.expectIdent().value);
      }
      if (this.matchKw("for")) {
        const val = this.parseExpr();
        if (this.peek().kind === "ident") this.advance(); // ns/ps/us
        if (val.kind === "intLiteral" || val.kind === "realLiteral") forNs = val.value;
      }
      const end = this.expectSym(";");
      return { kind: "wait", sensitivity, forNs, span: mergeSpan(start.span, end.span) };
    }

    // Labeled for loop
    if (this.peek().kind === "ident" && this.peek(1).value === ":" && this.peek(2).lower === "for") {
      const label = this.advance().value;
      this.advance(); // ':'
      return this.parseForLoopStmt(label, start.span);
    }

    // Signal or variable assignment
    if (this.peek().kind === "ident") {
      const target = this.parseTarget();
      if (this.matchSym("<=")) {
        const value = this.parseExpr();
        let afterNs: number | undefined;
        if (this.matchKw("after")) {
          const delay = this.parseExpr();
          if (this.peek().kind === "ident") this.advance();
          if (delay.kind === "intLiteral" || delay.kind === "realLiteral") afterNs = delay.value;
        }
        const end = this.expectSym(";");
        return { kind: "signalAssign", target, value, afterNs, span: mergeSpan(start.span, end.span) };
      }
      if (this.matchSym(":=")) {
        const value = this.parseExpr();
        const end = this.expectSym(";");
        return { kind: "varAssign", target, value, span: mergeSpan(start.span, end.span) };
      }
    }

    const bad = this.advance();
    this.errors.push({ message: `Unexpected token '${bad.value}' in sequential statement`, span: bad.span });
    this.syncToSemicolon();
    return undefined;
  }

  private parseIfStmt(): VhdlSeqStmt {
    const start = this.expectKw("if");
    const condition = this.parseExpr();
    this.expectKw("then");
    const thenBranch = this.parseSeqStmtList(["elsif", "else", "end"]);

    const elsifs: Array<{ condition: VhdlExpr; body: VhdlSeqStmt[] }> = [];
    while (this.matchKw("elsif")) {
      const cond = this.parseExpr();
      this.expectKw("then");
      const body = this.parseSeqStmtList(["elsif", "else", "end"]);
      elsifs.push({ condition: cond, body });
    }

    let elseBranch: VhdlSeqStmt[] | undefined;
    if (this.matchKw("else")) {
      elseBranch = this.parseSeqStmtList(["end"]);
    }

    this.expectKw("end");
    this.expectKw("if");
    const end = this.expectSym(";");
    return {
      kind: "if",
      condition,
      thenBranch,
      elsifs,
      elseBranch,
      span: mergeSpan(start.span, end.span),
    };
  }

  private parseCaseStmt(): VhdlSeqStmt {
    const start = this.expectKw("case");
    const expr = this.parseExpr();
    this.expectKw("is");

    const alternatives: Array<{ choices: string[]; body: VhdlSeqStmt[] }> = [];
    while (this.matchKw("when")) {
      const choices: string[] = [];
      const readChoice = (): string => {
        const tok = this.advance();
        if (tok.kind === "char") return `'${tok.value}'`;
        if (tok.kind === "string") return `"${tok.value}"`;
        return tok.value;
      };
      choices.push(readChoice());
      while (this.matchSym("|")) {
        choices.push(readChoice());
      }
      this.expectSym("=>");
      const body = this.parseSeqStmtList(["when", "end"]);
      alternatives.push({ choices, body });
    }

    this.expectKw("end");
    this.expectKw("case");
    const end = this.expectSym(";");
    return {
      kind: "case",
      expr,
      alternatives,
      span: mergeSpan(start.span, end.span),
    };
  }

  private parseForLoopStmt(label: string | undefined, startSpan: VhdlSpan): VhdlSeqStmt {
    this.expectKw("for");
    const iterator = this.expectIdent().value;
    this.expectKw("in");
    const range = this.parseRange();
    this.expectKw("loop");
    const body = this.parseSeqStmtList(["end"]);
    this.expectKw("end");
    this.expectKw("loop");
    if (this.peek().kind === "ident") this.advance();
    const end = this.expectSym(";");
    return {
      kind: "forLoop",
      label,
      iterator,
      range,
      body,
      span: mergeSpan(startSpan, end.span),
    };
  }

  private parseTarget(): VhdlTarget {
    const nameTok = this.expectIdent();
    if (this.matchSym("(")) {
      const first = this.parseAddExpr();
      if (this.checkKw("downto") || this.checkKw("to")) {
        const dir = this.advance().lower as "downto" | "to";
        const right = this.parseAddExpr();
        this.expectSym(")");
        return { name: nameTok.value, slice: { left: first, direction: dir, right }, span: nameTok.span };
      }
      this.expectSym(")");
      return { name: nameTok.value, index: first, span: nameTok.span };
    }
    return { name: nameTok.value, span: nameTok.span };
  }

  // --- Expressions ---

  private parseExpr(): VhdlExpr {
    return this.parseLogicalExpr();
  }

  private parseLogicalExpr(): VhdlExpr {
    let left = this.parseRelExpr();
    while (
      this.peek().kind === "ident" &&
      (this.peek().lower === "and" ||
        this.peek().lower === "or" ||
        this.peek().lower === "nand" ||
        this.peek().lower === "nor" ||
        this.peek().lower === "xor" ||
        this.peek().lower === "xnor")
    ) {
      const op = this.advance().lower as "and" | "or" | "nand" | "nor" | "xor" | "xnor";
      const right = this.parseRelExpr();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseRelExpr(): VhdlExpr {
    let left = this.parseShiftExpr();
    const t = this.peek();
    if (
      t.kind === "symbol" &&
      (t.value === "=" ||
        t.value === "/=" ||
        t.value === "<" ||
        t.value === "<=" ||
        t.value === ">" ||
        t.value === ">=")
    ) {
      const op = this.advance().value as "=" | "/=" | "<" | "<=" | ">" | ">=";
      const right = this.parseShiftExpr();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseShiftExpr(): VhdlExpr {
    let left = this.parseAddExpr();
    while (this.peek().kind === "ident" && (this.peek().lower === "sll" || this.peek().lower === "srl")) {
      const op = this.advance().lower as "sll" | "srl";
      const right = this.parseAddExpr();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseAddExpr(): VhdlExpr {
    let left = this.parseMulExpr();
    while (
      this.peek().kind === "symbol" &&
      (this.peek().value === "+" || this.peek().value === "-" || this.peek().value === "&")
    ) {
      const op = this.advance().value as "+" | "-" | "&";
      const right = this.parseMulExpr();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseMulExpr(): VhdlExpr {
    let left = this.parseUnaryExpr();
    while (
      (this.peek().kind === "symbol" &&
        (this.peek().value === "*" || this.peek().value === "/" || this.peek().value === "**")) ||
      (this.peek().kind === "ident" && (this.peek().lower === "mod" || this.peek().lower === "rem"))
    ) {
      const op = this.advance().lower as "*" | "/" | "**" | "mod" | "rem";
      const right = this.parseUnaryExpr();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parseUnaryExpr(): VhdlExpr {
    if (this.checkKw("not")) {
      const tok = this.advance();
      return { kind: "unary", op: "not", operand: this.parseUnaryExpr(), span: tok.span };
    }
    if (this.checkKw("abs")) {
      const tok = this.advance();
      return { kind: "unary", op: "abs", operand: this.parseUnaryExpr(), span: tok.span };
    }
    if (this.checkSym("-") || this.checkSym("+")) {
      const tok = this.advance();
      return { kind: "unary", op: tok.value as "-" | "+", operand: this.parseUnaryExpr(), span: tok.span };
    }
    return this.parsePrimaryExpr();
  }

  private parsePrimaryExpr(): VhdlExpr {
    const tok = this.peek();

    if (tok.kind === "char") {
      this.advance();
      return { kind: "charLiteral", value: tok.value, span: tok.span };
    }

    if (tok.kind === "bitString") {
      this.advance();
      const base = tok.value[0]!.toUpperCase() as "B" | "O" | "X";
      const body = tok.value.slice(2, -1);
      return { kind: "bitString", value: body, base, span: tok.span };
    }

    if (tok.kind === "string") {
      this.advance();
      // In VHDL, strings of 0/1/U/X/Z/W/L/H/- are bit-vector literals
      if (/^[01UXZWLH\-_]*$/i.test(tok.value)) {
        return { kind: "bitString", value: tok.value.replace(/_/g, ""), base: "B", span: tok.span };
      }
      return { kind: "stringLiteral", value: tok.value, span: tok.span };
    }

    if (tok.kind === "number") {
      this.advance();
      const cleaned = tok.value.replace(/_/g, "");
      if (cleaned.includes(".") || /[eE]/.test(cleaned)) {
        return { kind: "realLiteral", value: Number.parseFloat(cleaned), raw: tok.value, span: tok.span };
      }
      return { kind: "intLiteral", value: Number.parseInt(cleaned, 10), raw: tok.value, span: tok.span };
    }

    if (this.matchSym("(")) {
      if (this.checkKw("others") && this.peek(1).value === "=>") {
        this.advance(); // others
        this.advance(); // =>
        const value = this.parseExpr();
        this.expectSym(")");
        return { kind: "others", value, span: tok.span };
      }
      const expr = this.parseExpr();
      if (this.matchSym(",")) {
        // Positional aggregate `(a, b, ...)`
        const elements: Array<{ choice?: string | undefined; value: VhdlExpr }> = [{ value: expr }];
        while (!this.isEof() && !this.checkSym(")")) {
          if (this.checkKw("others") && this.peek(1).value === "=>") {
            this.advance();
            this.advance();
            elements.push({ choice: "others", value: this.parseExpr() });
          } else {
            elements.push({ value: this.parseExpr() });
          }
          if (!this.matchSym(",")) break;
        }
        this.expectSym(")");
        return { kind: "aggregate", elements, span: tok.span };
      }
      this.expectSym(")");
      return expr;
    }

    if (tok.kind === "ident") {
      this.advance();
      if (tok.lower === "true") return { kind: "boolLiteral", value: true, span: tok.span };
      if (tok.lower === "false") return { kind: "boolLiteral", value: false, span: tok.span };

      // Attribute: `clk'event`
      if (this.matchSym("'")) {
        const attr = this.expectIdent().value;
        return { kind: "attribute", target: tok.value, attr, span: tok.span };
      }

      // Function call, index, or slice: `name(...)`
      if (this.matchSym("(")) {
        if (this.matchSym(")")) {
          return { kind: "call", name: tok.value, args: [], span: tok.span };
        }
        const first = this.parseExpr();
        if (this.checkKw("downto") || this.checkKw("to")) {
          const dir = this.advance().lower as "downto" | "to";
          const right = this.parseExpr();
          this.expectSym(")");
          return { kind: "slice", target: tok.value, range: { left: first, direction: dir, right }, span: tok.span };
        }
        if (this.matchSym(",")) {
          const args: VhdlExpr[] = [first];
          while (!this.isEof() && !this.checkSym(")")) {
            args.push(this.parseExpr());
            if (!this.matchSym(",")) break;
          }
          this.expectSym(")");
          return { kind: "call", name: tok.value, args, span: tok.span };
        }
        this.expectSym(")");
        // Known built-in / conversion calls vs array indexing
        const lower = tok.lower;
        if (
          lower === "rising_edge" ||
          lower === "falling_edge" ||
          lower === "unsigned" ||
          lower === "signed" ||
          lower === "std_logic_vector" ||
          lower === "to_integer" ||
          lower === "to_unsigned" ||
          lower === "to_signed" ||
          lower === "to_bit" ||
          lower === "to_stdlogicvector" ||
          lower === "conv_integer" ||
          lower === "conv_std_logic_vector" ||
          lower === "resize"
        ) {
          return { kind: "call", name: tok.value, args: [first], span: tok.span };
        }
        return { kind: "index", target: tok.value, index: first, span: tok.span };
      }

      return { kind: "ident", name: tok.value, span: tok.span };
    }

    this.errors.push({ message: `Unexpected token '${tok.value || "EOF"}' in expression`, span: tok.span });
    if (!this.isEof()) this.advance();
    return { kind: "intLiteral", value: 0, raw: "0", span: tok.span };
  }
}

/**
 * Parses VHDL-87/93 source code into a structured `VhdlDesignFile`.
 */
export function parseVhdl(source: string): VhdlDesignFile {
  const tokens = tokenizeVhdl(source);
  const parser = new VhdlRecursiveParser(tokens);
  return parser.parseDesignFile();
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Recursive-Descent Parser for GAMS (.gms, .gams, .inc).
 */

import type {
  GamsAliasDecl,
  GamsAssignmentStmt,
  GamsDisplayStmt,
  GamsDomainBinding,
  GamsEqDecl,
  GamsEqDef,
  GamsEqRelation,
  GamsExpr,
  GamsModel,
  GamsModelDecl,
  GamsOptSense,
  GamsParamDecl,
  GamsSetDecl,
  GamsSolveStmt,
  GamsSyntaxError,
  GamsVarDecl,
  GamsVarKind,
  SourceSpan,
} from "../types.js";
import { lexGams, type GamsToken } from "./gams-lexer.js";

const SECTION_KEYWORDS = new Set([
  "set",
  "sets",
  "alias",
  "parameter",
  "parameters",
  "scalar",
  "scalars",
  "table",
  "tables",
  "variable",
  "variables",
  "positive",
  "negative",
  "free",
  "binary",
  "integer",
  "equation",
  "equations",
  "model",
  "models",
  "solve",
  "display",
  "option",
  "options",
]);

const INDEXED_OPS = new Set(["sum", "prod", "smin", "smax"]);

function makeSpan(start: GamsToken, end: GamsToken): SourceSpan {
  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column + Math.max(1, end.text.length),
    startOffset: start.offset,
    endOffset: end.endOffset,
  };
}

/**
 * Expands GAMS shorthand range labels such as `i1*i5` into `["i1", "i2", "i3", "i4", "i5"]`.
 */
function expandRangeLabel(raw: string): string[] {
  const m = raw.match(/^([A-Za-z_][A-Za-z0-9_-]*?)(\d+)\*([A-Za-z_][A-Za-z0-9_-]*?)(\d+)$/);
  if (m && m[1]!.toLowerCase() === m[3]!.toLowerCase()) {
    const prefix = m[1]!;
    const start = parseInt(m[2]!, 10);
    const end = parseInt(m[4]!, 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 10000) {
      const width = m[2]!.length;
      const padded = m[2]!.startsWith("0") && width > 1;
      const out: string[] = [];
      for (let i = start; i <= end; i++) {
        out.push(prefix + (padded ? String(i).padStart(width, "0") : String(i)));
      }
      return out;
    }
  }
  return [raw];
}

class GamsParser {
  private readonly tokens: GamsToken[];
  private pos = 0;
  readonly model: GamsModel;

  constructor(tokens: GamsToken[], title?: string) {
    this.tokens = tokens;
    this.model = {
      title,
      sets: [],
      aliases: [],
      parameters: [],
      variables: [],
      equationDecls: [],
      equationDefs: [],
      assignments: [],
      models: [],
      solves: [],
      displays: [],
      syntaxErrors: [],
    };
  }

  private peek(offset = 0): GamsToken {
    const idx = Math.min(this.pos + offset, this.tokens.length - 1);
    return this.tokens[idx]!;
  }

  private skipNewlines(): void {
    while (this.peek().kind === "newline") {
      this.pos++;
    }
  }

  private peekSig(offset = 0): GamsToken {
    let idx = this.pos;
    let seen = 0;
    while (idx < this.tokens.length - 1) {
      const t = this.tokens[idx]!;
      if (t.kind !== "newline") {
        if (seen === offset) return t;
        seen++;
      }
      idx++;
    }
    return this.tokens[this.tokens.length - 1]!;
  }

  private advance(): GamsToken {
    const t = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return t;
  }

  private nextSig(): GamsToken {
    this.skipNewlines();
    return this.advance();
  }

  private isEof(): boolean {
    this.skipNewlines();
    return this.peek().kind === "eof";
  }

  private addError(message: string, tok?: GamsToken): void {
    const t = tok ?? this.peek();
    const err: GamsSyntaxError = {
      message,
      line: t.line,
      column: t.column,
      offset: t.offset,
    };
    this.model.syntaxErrors.push(err);
  }

  private syncToSemicolon(): void {
    while (this.peek().kind !== "eof") {
      const t = this.advance();
      if (t.kind === "op" && t.text === ";") return;
    }
  }

  private consumeOptionalSemicolon(): void {
    this.skipNewlines();
    if (this.peek().kind === "op" && this.peek().text === ";") {
      this.advance();
    }
  }

  /**
   * Parses a hyphenated or simple GAMS label (e.g. `san-diego`, `new-york`, `'seattle'`, `i1*i5`).
   */
  private parseLabelToken(): string {
    const t = this.peek();
    if (t.kind === "string") {
      this.advance();
      return t.text;
    }
    let label = "";
    if (t.kind === "ident" || t.kind === "number") {
      label += this.advance().text;
      // Join contiguous `-`, `*`, `_`, ident, number without whitespace (same line, adjacent offsets)
      while (true) {
        const next = this.peek();
        const prevEnd = this.tokens[this.pos - 1]!.endOffset;
        if (next.offset !== prevEnd) break;
        if (
          next.kind === "ident" ||
          next.kind === "number" ||
          (next.kind === "op" && (next.text === "-" || next.text === "*"))
        ) {
          label += this.advance().text;
        } else {
          break;
        }
      }
    }
    return label;
  }

  /**
   * Parses optional domain `(i, j)` returning list of set names.
   */
  private parseOptionalDomain(): string[] {
    if (this.peek().kind === "op" && this.peek().text === "(") {
      this.advance();
      const domain: string[] = [];
      while (this.peek().kind !== "eof") {
        this.skipNewlines();
        if (this.peek().kind === "op" && this.peek().text === ")") {
          this.advance();
          break;
        }
        const tok = this.peek();
        if (tok.kind === "ident" || tok.kind === "string" || (tok.kind === "op" && tok.text === "*")) {
          domain.push(this.advance().text);
        } else {
          this.advance();
        }
        this.skipNewlines();
        if (this.peek().kind === "op" && this.peek().text === ",") {
          this.advance();
        }
      }
      return domain;
    }
    return [];
  }

  /**
   * Parses unquoted explanatory text until newline, `/`, `;`, `,`, or `..`.
   */
  private parseOptionalDescription(): string | undefined {
    const parts: string[] = [];
    while (this.peek().kind !== "eof" && this.peek().kind !== "newline") {
      const t = this.peek();
      if (t.kind === "slash" || t.kind === "dotdot" || (t.kind === "op" && (t.text === ";" || t.text === ","))) {
        break;
      }
      parts.push(this.advance().text);
    }
    return parts.length > 0 ? parts.join(" ") : undefined;
  }

  parseProgram(): GamsModel {
    while (!this.isEof()) {
      const t = this.peek();
      if (t.kind === "op" && t.text === ";") {
        this.advance();
        continue;
      }

      if (t.kind === "ident") {
        const kw = t.text.toLowerCase();
        if (kw === "set" || kw === "sets") {
          this.parseSetsSection();
          continue;
        }
        if (kw === "alias") {
          this.parseAliasStmt();
          continue;
        }
        if (kw === "parameter" || kw === "parameters") {
          this.parseParametersSection("parameter");
          continue;
        }
        if (kw === "scalar" || kw === "scalars") {
          this.parseParametersSection("scalar");
          continue;
        }
        if (kw === "table" || kw === "tables") {
          this.parseTableSection();
          continue;
        }
        if (
          kw === "variable" ||
          kw === "variables" ||
          kw === "positive" ||
          kw === "negative" ||
          kw === "free" ||
          kw === "binary" ||
          kw === "integer"
        ) {
          this.parseVariablesSection();
          continue;
        }
        if (kw === "equation" || kw === "equations") {
          this.parseEquationsSection();
          continue;
        }
        if (kw === "model" || kw === "models") {
          this.parseModelStmt();
          continue;
        }
        if (kw === "solve") {
          this.parseSolveStmt();
          continue;
        }
        if (kw === "display") {
          this.parseDisplayStmt();
          continue;
        }
        if (kw === "option" || kw === "options") {
          this.syncToSemicolon();
          continue;
        }

        // Otherwise: either an equation definition (`eqName(...)..`) or an assignment (`x(...) = ...`)
        if (this.looksLikeEquationDef()) {
          this.parseEquationDef();
          continue;
        }
        if (this.looksLikeAssignment()) {
          this.parseAssignmentStmt();
          continue;
        }
      }

      this.addError(`Unexpected token '${t.text}'`, t);
      this.syncToSemicolon();
    }
    return this.model;
  }

  private looksLikeEquationDef(): boolean {
    let idx = this.pos;
    let depth = 0;
    while (idx < this.tokens.length) {
      const t = this.tokens[idx]!;
      if (t.kind === "eof") return false;
      if (t.kind === "op" && t.text === ";") return false;
      if (t.kind === "op" && t.text === "(") depth++;
      else if (t.kind === "op" && t.text === ")") depth = Math.max(0, depth - 1);
      else if (t.kind === "dotdot" && depth === 0) return true;
      else if (t.kind === "op" && t.text === "=" && depth === 0) return false;
      idx++;
    }
    return false;
  }

  private looksLikeAssignment(): boolean {
    let idx = this.pos;
    let depth = 0;
    while (idx < this.tokens.length) {
      const t = this.tokens[idx]!;
      if (t.kind === "eof") return false;
      if (t.kind === "op" && t.text === ";") return false;
      if (t.kind === "op" && t.text === "(") depth++;
      else if (t.kind === "op" && t.text === ")") depth = Math.max(0, depth - 1);
      else if (t.kind === "op" && t.text === "=" && depth === 0) return true;
      else if (t.kind === "dotdot" && depth === 0) return false;
      idx++;
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // Sets / Alias
  // --------------------------------------------------------------------------

  private parseSetsSection(): void {
    this.advance(); // consume Set/Sets
    while (!this.isEof()) {
      const t = this.peek();
      if (t.kind === "op" && t.text === ";") {
        this.advance();
        break;
      }
      if (t.kind === "op" && t.text === ",") {
        this.advance();
        continue;
      }
      if (t.kind !== "ident") {
        this.addError(`Expected set name, got '${t.text}'`, t);
        this.syncToSemicolon();
        break;
      }
      const startTok = this.advance();
      const name = startTok.text;
      const domain = this.parseOptionalDomain();
      const description = this.parseOptionalDescription();

      const elements: string[] = [];
      this.skipNewlines();
      if (this.peek().kind === "slash") {
        this.advance(); // opening /
        while (!this.isEof()) {
          if (this.peek().kind === "slash") {
            this.advance(); // closing /
            break;
          }
          if (this.peek().kind === "op" && this.peek().text === ",") {
            this.advance();
            continue;
          }
          const label = this.parseLabelToken();
          if (label.length > 0) {
            for (const expanded of expandRangeLabel(label)) {
              elements.push(expanded);
            }
            // Skip any inline element description until comma, slash, or newline
            while (
              this.peek().kind !== "eof" &&
              this.peek().kind !== "newline" &&
              this.peek().kind !== "slash" &&
              !(this.peek().kind === "op" && this.peek().text === ",")
            ) {
              this.advance();
            }
          } else {
            this.advance();
          }
        }
      }

      const endTok = this.tokens[Math.max(0, this.pos - 1)]!;
      const decl: GamsSetDecl = {
        name,
        domain,
        description,
        elements,
        span: makeSpan(startTok, endTok),
      };
      this.model.sets.push(decl);
    }
  }

  private parseAliasStmt(): void {
    const startTok = this.advance(); // Alias
    this.skipNewlines();
    const names: string[] = [];
    if (this.peek().kind === "op" && this.peek().text === "(") {
      this.advance();
      while (!this.isEof()) {
        if (this.peek().kind === "op" && this.peek().text === ")") {
          this.advance();
          break;
        }
        if (this.peek().kind === "op" && this.peek().text === ",") {
          this.advance();
          continue;
        }
        if (this.peek().kind === "ident") {
          names.push(this.advance().text);
        } else {
          this.advance();
        }
      }
    }
    this.consumeOptionalSemicolon();
    const endTok = this.tokens[Math.max(0, this.pos - 1)]!;
    const decl: GamsAliasDecl = { names, span: makeSpan(startTok, endTok) };
    this.model.aliases.push(decl);
  }

  // --------------------------------------------------------------------------
  // Parameters / Scalars
  // --------------------------------------------------------------------------

  private parseParametersSection(kind: "parameter" | "scalar"): void {
    this.advance(); // consume Parameter(s) / Scalar(s)
    while (!this.isEof()) {
      const t = this.peek();
      if (t.kind === "op" && t.text === ";") {
        this.advance();
        break;
      }
      if (t.kind === "op" && t.text === ",") {
        this.advance();
        continue;
      }
      if (t.kind !== "ident") {
        this.addError(`Expected ${kind} name, got '${t.text}'`, t);
        this.syncToSemicolon();
        break;
      }
      const startTok = this.advance();
      const name = startTok.text;
      const domain = this.parseOptionalDomain();
      const description = this.parseOptionalDescription();
      const values: Record<string, number> = {};

      this.skipNewlines();
      if (this.peek().kind === "slash") {
        this.advance(); // opening /
        if (kind === "scalar" || domain.length === 0) {
          this.skipNewlines();
          const val = this.parseSignedNumber();
          if (val !== null) {
            values[""] = val;
          }
          while (this.peek().kind !== "eof" && this.peek().kind !== "slash") {
            this.advance();
          }
          if (this.peek().kind === "slash") this.advance();
        } else {
          // Indexed parameter key-value pairs inside / ... /
          while (!this.isEof()) {
            if (this.peek().kind === "slash") {
              this.advance();
              break;
            }
            if (this.peek().kind === "op" && this.peek().text === ",") {
              this.advance();
              continue;
            }
            // Parse tuple key: lbl1.lbl2...
            const keyParts: string[] = [];
            const first = this.parseLabelToken();
            if (first.length === 0) {
              this.advance();
              continue;
            }
            keyParts.push(first.toLowerCase());
            while (this.peek().kind === "op" && this.peek().text === ".") {
              this.advance();
              const nextPart = this.parseLabelToken();
              if (nextPart.length > 0) keyParts.push(nextPart.toLowerCase());
            }
            // Optional `=` before value
            if (this.peek().kind === "op" && this.peek().text === "=") {
              this.advance();
            }
            const val = this.parseSignedNumber();
            if (val !== null) {
              values[keyParts.join(".")] = val;
            }
          }
        }
      }

      const endTok = this.tokens[Math.max(0, this.pos - 1)]!;
      const decl: GamsParamDecl = {
        name,
        domain,
        description,
        values,
        kind,
        span: makeSpan(startTok, endTok),
      };
      this.model.parameters.push(decl);
    }
  }

  private parseSignedNumber(): number | null {
    let sign = 1;
    if (this.peek().kind === "op" && this.peek().text === "-") {
      sign = -1;
      this.advance();
    } else if (this.peek().kind === "op" && this.peek().text === "+") {
      this.advance();
    }
    if (this.peek().kind === "number") {
      const num = parseFloat(this.advance().text);
      return Number.isFinite(num) ? sign * num : null;
    }
    return null;
  }

  // --------------------------------------------------------------------------
  // Tables (2D column-aligned GAMS tables)
  // --------------------------------------------------------------------------

  private parseTableSection(): void {
    this.advance(); // consume Table/Tables
    this.skipNewlines();
    const startTok = this.peek();
    if (startTok.kind !== "ident") {
      this.addError(`Expected table name, got '${startTok.text}'`, startTok);
      this.syncToSemicolon();
      return;
    }
    this.advance();
    const name = startTok.text;
    const domain = this.parseOptionalDomain();
    const description = this.parseOptionalDescription();
    const values: Record<string, number> = {};

    // Move past header newline
    this.skipNewlines();

    // First non-empty line is column headers
    const colHeaders: Array<{ label: string; col: number }> = [];
    if (this.peek().kind !== "eof" && !(this.peek().kind === "op" && this.peek().text === ";")) {
      const headerLine = this.peek().line;
      while (
        this.peek().kind !== "eof" &&
        this.peek().kind !== "newline" &&
        this.peek().line === headerLine &&
        !(this.peek().kind === "op" && this.peek().text === ";")
      ) {
        const colPos = this.peek().column;
        const lbl = this.parseLabelToken();
        if (lbl.length > 0) {
          colHeaders.push({ label: lbl.toLowerCase(), col: colPos });
        } else {
          this.advance();
        }
      }
    }

    // Subsequent lines until `;` are data rows: rowLabel val1 val2 ...
    while (!this.isEof()) {
      if (this.peek().kind === "op" && this.peek().text === ";") {
        this.advance();
        break;
      }
      // Stop if a new top-level keyword appears without `;`
      if (
        this.peek().kind === "ident" &&
        SECTION_KEYWORDS.has(this.peek().text.toLowerCase()) &&
        this.peek().column === 1
      ) {
        break;
      }
      const rowLine = this.peek().line;
      const rowLabel = this.parseLabelToken();
      if (rowLabel.length === 0) {
        this.advance();
        continue;
      }
      const rowKey = rowLabel.toLowerCase();
      const rowValues: Array<{ val: number; col: number }> = [];
      while (
        this.peek().kind !== "eof" &&
        this.peek().kind !== "newline" &&
        this.peek().line === rowLine &&
        !(this.peek().kind === "op" && this.peek().text === ";")
      ) {
        const valCol = this.peek().column;
        const num = this.parseSignedNumber();
        if (num !== null) {
          rowValues.push({ val: num, col: valCol });
        } else {
          this.advance();
        }
      }

      // Map values to columns: if count matches colHeaders, assign positionally;
      // otherwise align by nearest column offset.
      if (rowValues.length === colHeaders.length) {
        for (let c = 0; c < colHeaders.length; c++) {
          values[`${rowKey}.${colHeaders[c]!.label}`] = rowValues[c]!.val;
        }
      } else {
        for (const rv of rowValues) {
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let c = 0; c < colHeaders.length; c++) {
            const dist = Math.abs(rv.col - colHeaders[c]!.col);
            if (dist < bestDist) {
              bestDist = dist;
              bestIdx = c;
            }
          }
          if (colHeaders[bestIdx]) {
            values[`${rowKey}.${colHeaders[bestIdx]!.label}`] = rv.val;
          }
        }
      }
    }

    const endTok = this.tokens[Math.max(0, this.pos - 1)]!;
    const decl: GamsParamDecl = {
      name,
      domain,
      description,
      values,
      kind: "table",
      span: makeSpan(startTok, endTok),
    };
    this.model.parameters.push(decl);
  }

  // --------------------------------------------------------------------------
  // Variables
  // --------------------------------------------------------------------------

  private parseVariablesSection(): void {
    let varKind: GamsVarKind = "free";
    const first = this.advance().text.toLowerCase();
    if (first === "positive" || first === "negative" || first === "free" || first === "binary" || first === "integer") {
      varKind = first;
      this.skipNewlines();
      const next = this.peek();
      if (
        next.kind === "ident" &&
        (next.text.toLowerCase() === "variable" || next.text.toLowerCase() === "variables")
      ) {
        this.advance();
      }
    }

    while (!this.isEof()) {
      const t = this.peek();
      if (t.kind === "op" && t.text === ";") {
        this.advance();
        break;
      }
      if (t.kind === "op" && t.text === ",") {
        this.advance();
        continue;
      }
      if (t.kind !== "ident") {
        this.addError(`Expected variable name, got '${t.text}'`, t);
        this.syncToSemicolon();
        break;
      }
      const startTok = this.advance();
      const name = startTok.text;
      const domain = this.parseOptionalDomain();
      const description = this.parseOptionalDescription();
      const endTok = this.tokens[Math.max(0, this.pos - 1)]!;

      // In GAMS, `Positive Variable x;` can refine an earlier `Variables x(i,j), z;`
      const existing = this.model.variables.find((v) => v.name.toLowerCase() === name.toLowerCase());
      if (existing && existing.varKind === "free" && varKind !== "free") {
        existing.varKind = varKind;
        if (domain.length > 0 && existing.domain.length === 0) {
          existing.domain = domain;
        }
      } else {
        const decl: GamsVarDecl = {
          name,
          domain,
          varKind,
          description,
          span: makeSpan(startTok, endTok),
        };
        this.model.variables.push(decl);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Equations (Declarations & Definitions)
  // --------------------------------------------------------------------------

  private parseEquationsSection(): void {
    this.advance(); // consume Equation(s)
    while (!this.isEof()) {
      const t = this.peek();
      if (t.kind === "op" && t.text === ";") {
        this.advance();
        break;
      }
      if (t.kind === "op" && t.text === ",") {
        this.advance();
        continue;
      }
      if (t.kind !== "ident") {
        this.addError(`Expected equation name, got '${t.text}'`, t);
        this.syncToSemicolon();
        break;
      }
      const startTok = this.advance();
      const name = startTok.text;
      const domain = this.parseOptionalDomain();
      const description = this.parseOptionalDescription();
      const endTok = this.tokens[Math.max(0, this.pos - 1)]!;
      const decl: GamsEqDecl = {
        name,
        domain,
        description,
        span: makeSpan(startTok, endTok),
      };
      this.model.equationDecls.push(decl);
    }
  }

  private parseEquationDef(): void {
    const startTok = this.nextSig();
    const name = startTok.text;
    const domain = this.parseOptionalDomain();
    let condition: GamsExpr | undefined;

    this.skipNewlines();
    if (this.peek().kind === "op" && this.peek().text === "$") {
      this.advance();
      condition = this.parsePrimaryExpr();
    }

    this.skipNewlines();
    if (this.peek().kind === "dotdot") {
      this.advance();
    } else {
      this.addError(`Expected '..' in equation definition '${name}'`);
      this.syncToSemicolon();
      return;
    }

    const lhs = this.parseExpr();
    this.skipNewlines();
    const relTok = this.peek();
    if (relTok.kind !== "relop") {
      this.addError(
        `Expected GAMS relational operator (=e=, =l=, =g=) in equation '${name}', got '${relTok.text}'`,
        relTok,
      );
      this.syncToSemicolon();
      return;
    }
    this.advance();
    const relation = relTok.text.toLowerCase() as GamsEqRelation;
    const rhs = this.parseExpr();
    this.consumeOptionalSemicolon();
    const endTok = this.tokens[Math.max(0, this.pos - 1)]!;

    const def: GamsEqDef = {
      name,
      domain,
      condition,
      lhs,
      relation,
      rhs,
      span: makeSpan(startTok, endTok),
    };
    this.model.equationDefs.push(def);
  }

  // --------------------------------------------------------------------------
  // Assignments (`c(i,j) = f * d(i,j) / 1000;`, `x.up(i) = 10;`)
  // --------------------------------------------------------------------------

  private parseAssignmentStmt(): void {
    const startTok = this.nextSig();
    const target = startTok.text;
    let suffix: string | undefined;
    let indices: GamsExpr[] = [];
    let condition: GamsExpr | undefined;

    if (this.peek().kind === "op" && this.peek().text === ".") {
      this.advance();
      if (this.peek().kind === "ident") {
        suffix = this.advance().text.toLowerCase();
      }
    }

    if (this.peek().kind === "op" && this.peek().text === "(") {
      indices = this.parseCallArgs();
    }

    if (this.peek().kind === "op" && this.peek().text === ".") {
      this.advance();
      if (this.peek().kind === "ident") {
        suffix = this.advance().text.toLowerCase();
      }
    }

    this.skipNewlines();
    if (this.peek().kind === "op" && this.peek().text === "$") {
      this.advance();
      condition = this.parsePrimaryExpr();
    }

    this.skipNewlines();
    if (this.peek().kind === "op" && this.peek().text === "=") {
      this.advance();
    } else {
      this.addError(`Expected '=' in assignment to '${target}'`);
      this.syncToSemicolon();
      return;
    }

    const value = this.parseExpr();
    this.consumeOptionalSemicolon();
    const endTok = this.tokens[Math.max(0, this.pos - 1)]!;

    const stmt: GamsAssignmentStmt = {
      target,
      indices,
      suffix,
      condition,
      value,
      span: makeSpan(startTok, endTok),
    };
    this.model.assignments.push(stmt);
  }

  // --------------------------------------------------------------------------
  // Model / Solve / Display
  // --------------------------------------------------------------------------

  private parseModelStmt(): void {
    const startTok = this.advance(); // Model(s)
    this.skipNewlines();
    const nameTok = this.peek();
    if (nameTok.kind !== "ident") {
      this.addError(`Expected model name, got '${nameTok.text}'`, nameTok);
      this.syncToSemicolon();
      return;
    }
    this.advance();
    const name = nameTok.text;
    const description = this.parseOptionalDescription();

    let allEquations = false;
    const equations: string[] = [];

    this.skipNewlines();
    if (this.peek().kind === "slash") {
      this.advance();
      while (!this.isEof()) {
        if (this.peek().kind === "slash") {
          this.advance();
          break;
        }
        if (this.peek().kind === "op" && this.peek().text === ",") {
          this.advance();
          continue;
        }
        if (this.peek().kind === "ident") {
          const eq = this.advance().text;
          if (eq.toLowerCase() === "all") {
            allEquations = true;
          } else {
            equations.push(eq);
          }
        } else {
          this.advance();
        }
      }
    }

    this.consumeOptionalSemicolon();
    const endTok = this.tokens[Math.max(0, this.pos - 1)]!;
    const decl: GamsModelDecl = {
      name,
      description,
      allEquations,
      equations,
      span: makeSpan(startTok, endTok),
    };
    this.model.models.push(decl);
  }

  private parseSolveStmt(): void {
    const startTok = this.advance(); // Solve
    this.skipNewlines();
    const modelTok = this.peek();
    if (modelTok.kind !== "ident") {
      this.addError(`Expected model name after Solve, got '${modelTok.text}'`, modelTok);
      this.syncToSemicolon();
      return;
    }
    this.advance();
    const modelName = modelTok.text;

    let solverType = "";
    let sense: GamsOptSense = "minimizing";
    let objectiveVar = "";

    while (!this.isEof()) {
      const t = this.peek();
      if (t.kind === "op" && t.text === ";") {
        this.advance();
        break;
      }
      if (t.kind === "ident") {
        const kw = t.text.toLowerCase();
        if (kw === "using") {
          this.advance();
          this.skipNewlines();
          if (this.peek().kind === "ident") {
            solverType = this.advance().text.toLowerCase();
          }
          continue;
        }
        if (kw === "minimizing" || kw === "min") {
          this.advance();
          sense = "minimizing";
          this.skipNewlines();
          if (this.peek().kind === "ident" && this.peek().text.toLowerCase() !== "using") {
            objectiveVar = this.advance().text;
          }
          continue;
        }
        if (kw === "maximizing" || kw === "max") {
          this.advance();
          sense = "maximizing";
          this.skipNewlines();
          if (this.peek().kind === "ident" && this.peek().text.toLowerCase() !== "using") {
            objectiveVar = this.advance().text;
          }
          continue;
        }
      }
      this.advance();
    }

    const endTok = this.tokens[Math.max(0, this.pos - 1)]!;
    const stmt: GamsSolveStmt = {
      modelName,
      solverType,
      sense,
      objectiveVar,
      span: makeSpan(startTok, endTok),
    };
    this.model.solves.push(stmt);
  }

  private parseDisplayStmt(): void {
    const startTok = this.advance(); // Display
    const items: Array<{ name: string; suffix?: string | undefined }> = [];
    while (!this.isEof()) {
      const t = this.peek();
      if (t.kind === "op" && t.text === ";") {
        this.advance();
        break;
      }
      if (t.kind === "op" && t.text === ",") {
        this.advance();
        continue;
      }
      if (t.kind === "ident") {
        const name = this.advance().text;
        let suffix: string | undefined;
        if (this.peek().kind === "op" && this.peek().text === ".") {
          this.advance();
          if (this.peek().kind === "ident") suffix = this.advance().text.toLowerCase();
        }
        items.push({ name, suffix });
      } else {
        this.advance();
      }
    }
    const endTok = this.tokens[Math.max(0, this.pos - 1)]!;
    const stmt: GamsDisplayStmt = { items, span: makeSpan(startTok, endTok) };
    this.model.displays.push(stmt);
  }

  // --------------------------------------------------------------------------
  // Expression Parser
  // --------------------------------------------------------------------------

  private parseExpr(): GamsExpr {
    return this.parseOrExpr();
  }

  private parseOrExpr(): GamsExpr {
    let left = this.parseAndExpr();
    while (true) {
      const t = this.peekSig();
      if (t.kind === "ident" && (t.text.toLowerCase() === "or" || t.text.toLowerCase() === "xor")) {
        const op = this.nextSig().text.toLowerCase() as "or" | "xor";
        const right = this.parseAndExpr();
        left = { kind: "binary", op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseAndExpr(): GamsExpr {
    let left = this.parseCompExpr();
    while (true) {
      const t = this.peekSig();
      if (t.kind === "ident" && t.text.toLowerCase() === "and") {
        this.nextSig();
        const right = this.parseCompExpr();
        left = { kind: "binary", op: "and", left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseCompExpr(): GamsExpr {
    let left = this.parseDollarExpr();
    while (true) {
      const t = this.peekSig();
      if (
        (t.kind === "op" &&
          (t.text === "<" ||
            t.text === "<=" ||
            t.text === ">" ||
            t.text === ">=" ||
            t.text === "<>" ||
            t.text === "!=" ||
            t.text === "==")) ||
        (t.kind === "ident" && ["lt", "le", "gt", "ge", "eq", "ne"].includes(t.text.toLowerCase()))
      ) {
        const op = this.nextSig().text.toLowerCase() as
          "<" | "<=" | ">" | ">=" | "<>" | "!=" | "==" | "lt" | "le" | "gt" | "ge" | "eq" | "ne";
        const right = this.parseDollarExpr();
        left = { kind: "binary", op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseDollarExpr(): GamsExpr {
    let expr = this.parseAddExpr();
    while (this.peekSig().kind === "op" && this.peekSig().text === "$") {
      this.nextSig();
      const condition = this.parseAddExpr();
      expr = { kind: "dollar", expr, condition };
    }
    return expr;
  }

  private parseAddExpr(): GamsExpr {
    let left = this.parseMulExpr();
    while (true) {
      const t = this.peekSig();
      if (t.kind === "op" && (t.text === "+" || t.text === "-")) {
        const op = this.nextSig().text as "+" | "-";
        const right = this.parseMulExpr();
        left = { kind: "binary", op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseMulExpr(): GamsExpr {
    let left = this.parseUnaryExpr();
    while (true) {
      const t = this.peekSig();
      if ((t.kind === "op" && t.text === "*") || t.kind === "slash") {
        const op = this.nextSig().text as "*" | "/";
        const right = this.parseUnaryExpr();
        left = { kind: "binary", op, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  private parseUnaryExpr(): GamsExpr {
    const t = this.peekSig();
    if (t.kind === "op" && (t.text === "+" || t.text === "-")) {
      const op = this.nextSig().text as "+" | "-";
      return { kind: "unary", op, operand: this.parseUnaryExpr() };
    }
    if (t.kind === "ident" && t.text.toLowerCase() === "not") {
      this.nextSig();
      return { kind: "unary", op: "not", operand: this.parseUnaryExpr() };
    }
    return this.parsePowExpr();
  }

  private parsePowExpr(): GamsExpr {
    let left = this.parsePrimaryExpr();
    const t = this.peekSig();
    if (t.kind === "op" && (t.text === "**" || t.text === "^")) {
      const op = this.nextSig().text as "**" | "^";
      const right = this.parseUnaryExpr();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private parsePrimaryExpr(): GamsExpr {
    this.skipNewlines();
    const t = this.peek();

    if (t.kind === "number") {
      this.advance();
      return { kind: "number", value: parseFloat(t.text), span: makeSpan(t, t) };
    }

    if (t.kind === "string") {
      this.advance();
      return { kind: "string", value: t.text, span: makeSpan(t, t) };
    }

    if (t.kind === "op" && (t.text === "(" || t.text === "[")) {
      const closeChar = t.text === "(" ? ")" : "]";
      this.advance();
      const inner = this.parseExpr();
      this.skipNewlines();
      if (this.peek().kind === "op" && this.peek().text === closeChar) {
        this.advance();
      }
      return inner;
    }

    if (t.kind === "ident") {
      const startTok = this.advance();
      const lower = startTok.text.toLowerCase();

      // Indexed operator: sum(i, expr), sum((i,j), expr), sum(i$(cond), expr)
      if (INDEXED_OPS.has(lower) && this.peekSig().kind === "op" && this.peekSig().text === "(") {
        return this.parseIndexedOp(lower as "sum" | "prod" | "smin" | "smax", startTok);
      }

      // Suffix before parens: x.l(i,j) or x.lo
      let suffix: string | undefined;
      if (this.peek().kind === "op" && this.peek().text === ".") {
        this.advance();
        if (this.peek().kind === "ident") {
          suffix = this.advance().text.toLowerCase();
        }
      }

      // Function call or indexed reference: name(arg1, arg2)
      if (this.peek().kind === "op" && this.peek().text === "(") {
        const args = this.parseCallArgs();
        // Check for suffix after parens: x(i,j).l
        if (!suffix && this.peek().kind === "op" && this.peek().text === ".") {
          this.advance();
          if (this.peek().kind === "ident") {
            suffix = this.advance().text.toLowerCase();
          }
        }
        const endTok = this.tokens[Math.max(0, this.pos - 1)]!;
        if (!suffix && isBuiltinFunction(lower)) {
          return { kind: "call", name: lower, args, span: makeSpan(startTok, endTok) };
        }
        return { kind: "ref", name: startTok.text, indices: args, suffix, span: makeSpan(startTok, endTok) };
      }

      const endTok = this.tokens[Math.max(0, this.pos - 1)]!;
      return { kind: "ref", name: startTok.text, indices: [], suffix, span: makeSpan(startTok, endTok) };
    }

    this.addError(`Unexpected token '${t.text}' in expression`, t);
    this.advance();
    return { kind: "number", value: 0 };
  }

  private parseCallArgs(): GamsExpr[] {
    this.advance(); // consume '('
    const args: GamsExpr[] = [];
    while (!this.isEof()) {
      if (this.peek().kind === "op" && this.peek().text === ")") {
        this.advance();
        break;
      }
      args.push(this.parseExpr());
      this.skipNewlines();
      if (this.peek().kind === "op" && this.peek().text === ",") {
        this.advance();
      }
    }
    return args;
  }

  private parseIndexedOp(op: "sum" | "prod" | "smin" | "smax", startTok: GamsToken): GamsExpr {
    this.nextSig(); // consume '('
    this.skipNewlines();

    const domains: GamsDomainBinding[] = [];
    let condition: GamsExpr | undefined;

    if (this.peek().kind === "op" && this.peek().text === "(") {
      // Multi-index tuple: sum((i,j), ...) or sum((i,j)$(cond), ...)
      this.advance();
      while (!this.isEof()) {
        if (this.peek().kind === "op" && this.peek().text === ")") {
          this.advance();
          break;
        }
        if (this.peek().kind === "ident") {
          const idx = this.advance().text;
          domains.push({ index: idx });
        } else {
          this.advance();
        }
        this.skipNewlines();
        if (this.peek().kind === "op" && this.peek().text === ",") {
          this.advance();
        }
      }
    } else if (this.peek().kind === "ident") {
      const idx = this.advance().text;
      domains.push({ index: idx });
    }

    // Optional domain dollar condition: sum(i$(cond), ...) or sum((i,j)$(cond), ...)
    this.skipNewlines();
    if (this.peek().kind === "op" && this.peek().text === "$") {
      this.advance();
      condition = this.parsePrimaryExpr();
    }

    this.skipNewlines();
    if (this.peek().kind === "op" && this.peek().text === ",") {
      this.advance();
    }

    const body = this.parseExpr();
    this.skipNewlines();
    if (this.peek().kind === "op" && this.peek().text === ")") {
      this.advance();
    }
    const endTok = this.tokens[Math.max(0, this.pos - 1)]!;
    return {
      kind: "indexedOp",
      op,
      domains,
      condition,
      body,
      span: makeSpan(startTok, endTok),
    };
  }
}

const BUILTIN_FUNCTIONS = new Set([
  "ord",
  "card",
  "sameas",
  "abs",
  "sqrt",
  "sqr",
  "exp",
  "log",
  "log10",
  "log2",
  "sin",
  "cos",
  "tan",
  "arcsin",
  "arccos",
  "arctan",
  "power",
  "min",
  "max",
  "mod",
  "floor",
  "ceil",
  "round",
  "sign",
]);

function isBuiltinFunction(name: string): boolean {
  return BUILTIN_FUNCTIONS.has(name.toLowerCase());
}

/**
 * Parses a GAMS source string into a structured `GamsModel` AST.
 */
export function parseGams(source: string): GamsModel {
  const { tokens, title } = lexGams(source);
  const parser = new GamsParser(tokens, title);
  return parser.parseProgram();
}

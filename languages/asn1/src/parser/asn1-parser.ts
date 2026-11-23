// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Recursive-descent parser for ISO/ITU-T X.208 / X.680 ASN.1 modules (.asn, .asn1, .mib).
 */

import type {
  Asn1Constraint,
  Asn1Field,
  Asn1Import,
  Asn1Module,
  Asn1NamedNumber,
  Asn1ParseError,
  Asn1PrimitiveKind,
  Asn1Span,
  Asn1Tag,
  Asn1TagClass,
  Asn1TagMode,
  Asn1TypeAssignment,
  Asn1TypeExpr,
  Asn1ValueAssignment,
} from "../types.js";

type TokenKind =
  | "IDENT"
  | "NUMBER"
  | "STRING"
  | "ASSIGN" // ::=
  | "RANGE" // ..
  | "ELLIPSIS" // ...
  | "LBRACE" // {
  | "RBRACE" // }
  | "LBRACKET" // [
  | "RBRACKET" // ]
  | "LPAREN" // (
  | "RPAREN" // )
  | "COMMA" // ,
  | "SEMI" // ;
  | "EOF";

interface Token {
  kind: TokenKind;
  text: string;
  line: number;
  column: number;
  offset: number;
  endOffset: number;
}

const SINGLE_WORD_PRIMITIVES = new Map<string, Asn1PrimitiveKind>([
  ["BOOLEAN", "BOOLEAN"],
  ["INTEGER", "INTEGER"],
  ["REAL", "REAL"],
  ["NULL", "NULL"],
  ["UTF8String", "UTF8String"],
  ["IA5String", "IA5String"],
  ["PrintableString", "PrintableString"],
  ["VisibleString", "VisibleString"],
  ["NumericString", "NumericString"],
  ["UTCTime", "UTCTime"],
  ["GeneralizedTime", "GeneralizedTime"],
]);

function makeSpan(start: Token, end: Token): Asn1Span {
  return {
    startLine: start.line,
    startColumn: start.column,
    endLine: end.line,
    endColumn: end.column + Math.max(1, end.endOffset - end.offset),
    startOffset: start.offset,
    endOffset: end.endOffset,
  };
}

function tokenizeAsn1(source: string): { tokens: Token[]; comments: string[] } {
  const tokens: Token[] = [];
  const comments: string[] = [];
  let i = 0;
  let line = 1;
  let column = 1;
  const n = source.length;

  const advance = (): string => {
    const ch = source[i++]!;
    if (ch === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
    return ch;
  };

  while (i < n) {
    const ch = source[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    // ASN.1 -- comment (ends at newline or another --)
    if (ch === "-" && source[i + 1] === "-") {
      const start = i;
      advance();
      advance();
      while (i < n) {
        if (source[i] === "\n") {
          break;
        }
        if (source[i] === "-" && source[i + 1] === "-") {
          advance();
          advance();
          break;
        }
        advance();
      }
      comments.push(source.slice(start, i));
      continue;
    }

    // Block comment /* ... */
    if (ch === "/" && source[i + 1] === "*") {
      const start = i;
      advance();
      advance();
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        advance();
      }
      if (i < n) {
        advance();
        advance();
      }
      comments.push(source.slice(start, i));
      continue;
    }

    const tokLine = line;
    const tokCol = column;
    const tokOff = i;

    if (ch === ":" && source[i + 1] === ":" && source[i + 2] === "=") {
      advance();
      advance();
      advance();
      tokens.push({ kind: "ASSIGN", text: "::=", line: tokLine, column: tokCol, offset: tokOff, endOffset: i });
      continue;
    }

    if (ch === "." && source[i + 1] === "." && source[i + 2] === ".") {
      advance();
      advance();
      advance();
      tokens.push({ kind: "ELLIPSIS", text: "...", line: tokLine, column: tokCol, offset: tokOff, endOffset: i });
      continue;
    }

    if (ch === "." && source[i + 1] === ".") {
      advance();
      advance();
      tokens.push({ kind: "RANGE", text: "..", line: tokLine, column: tokCol, offset: tokOff, endOffset: i });
      continue;
    }

    const singleMap: Record<string, TokenKind> = {
      "{": "LBRACE",
      "}": "RBRACE",
      "[": "LBRACKET",
      "]": "RBRACKET",
      "(": "LPAREN",
      ")": "RPAREN",
      ",": "COMMA",
      ";": "SEMI",
    };
    const singleKind = singleMap[ch];
    if (singleKind) {
      advance();
      tokens.push({ kind: singleKind, text: ch, line: tokLine, column: tokCol, offset: tokOff, endOffset: i });
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = advance();
      while (i < n && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < n) advance();
        advance();
      }
      if (i < n) advance();
      // Optional H or B suffix on ASN.1 hex/bit strings ('0101'B, 'FF'H)
      if (quote === "'" && i < n && (source[i] === "B" || source[i] === "H")) {
        advance();
      }
      tokens.push({
        kind: "STRING",
        text: source.slice(tokOff, i),
        line: tokLine,
        column: tokCol,
        offset: tokOff,
        endOffset: i,
      });
      continue;
    }

    // Signed or unsigned number
    if ((ch >= "0" && ch <= "9") || (ch === "-" && i + 1 < n && source[i + 1]! >= "0" && source[i + 1]! <= "9")) {
      if (ch === "-") advance();
      while (i < n && source[i]! >= "0" && source[i]! <= "9") {
        advance();
      }
      if (i < n && source[i] === "." && source[i + 1] !== ".") {
        advance();
        while (i < n && source[i]! >= "0" && source[i]! <= "9") {
          advance();
        }
      }
      tokens.push({
        kind: "NUMBER",
        text: source.slice(tokOff, i),
        line: tokLine,
        column: tokCol,
        offset: tokOff,
        endOffset: i,
      });
      continue;
    }

    // ASN.1 identifier (letters, digits, hyphens — note: double hyphen starts comment)
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
      while (i < n) {
        const c = source[i]!;
        if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "_") {
          advance();
        } else if (c === "-" && source[i + 1] !== "-") {
          advance();
        } else {
          break;
        }
      }
      tokens.push({
        kind: "IDENT",
        text: source.slice(tokOff, i),
        line: tokLine,
        column: tokCol,
        offset: tokOff,
        endOffset: i,
      });
      continue;
    }

    // Unknown character: skip safely
    advance();
  }

  tokens.push({ kind: "EOF", text: "", line, column, offset: n, endOffset: n });
  return { tokens, comments };
}

class Asn1Parser {
  private readonly tokens: Token[];
  private pos = 0;
  readonly errors: Asn1ParseError[] = [];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token {
    const idx = Math.min(this.pos + offset, this.tokens.length - 1);
    return this.tokens[idx]!;
  }

  private next(): Token {
    const tok = this.peek();
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  private isIdent(text: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === "IDENT" && t.text === text;
  }

  private match(kind: TokenKind): Token | null {
    if (this.peek().kind === kind) return this.next();
    return null;
  }

  private matchIdent(text: string): Token | null {
    if (this.isIdent(text)) return this.next();
    return null;
  }

  private recordError(message: string, tok?: Token): void {
    const t = tok ?? this.peek();
    this.errors.push({ message, span: makeSpan(t, t) });
  }

  parseModule(sourceLength: number, comments: string[]): Asn1Module {
    const firstTok = this.peek();
    let name = "UnnamedModule";
    let oidArcs: number[] | undefined;
    let tagDefault: Asn1TagMode = "EXPLICIT";
    let exportsAll = true;
    const exports: string[] = [];
    const imports: Asn1Import[] = [];
    const types: Asn1TypeAssignment[] = [];
    const values: Asn1ValueAssignment[] = [];
    let hasBegin = false;
    let hasEnd = false;

    if (this.peek().kind === "IDENT") {
      name = this.next().text;
    } else if (this.peek().kind !== "EOF") {
      this.recordError(`Expected module name identifier, found '${this.peek().text}'`);
    }

    // Optional module OID: { iso(1) member-body(2) ... }
    if (this.peek().kind === "LBRACE") {
      oidArcs = this.parseOidBraceValue().arcs;
    }

    // DEFINITIONS [AUTOMATIC|EXPLICIT|IMPLICIT TAGS] [EXTENSIBILITY IMPLIED] ::= BEGIN
    if (this.matchIdent("DEFINITIONS")) {
      if (this.matchIdent("AUTOMATIC")) {
        tagDefault = "AUTOMATIC";
        this.matchIdent("TAGS");
      } else if (this.matchIdent("IMPLICIT")) {
        tagDefault = "IMPLICIT";
        this.matchIdent("TAGS");
      } else if (this.matchIdent("EXPLICIT")) {
        tagDefault = "EXPLICIT";
        this.matchIdent("TAGS");
      }
      if (this.matchIdent("EXTENSIBILITY")) {
        this.matchIdent("IMPLIED");
      }
      if (!this.match("ASSIGN")) {
        this.recordError("Expected '::=' after DEFINITIONS header");
      }
    } else if (this.peek().kind !== "EOF") {
      this.recordError("Expected 'DEFINITIONS' keyword in ASN.1 module header");
    }

    if (this.matchIdent("BEGIN")) {
      hasBegin = true;
    }

    // Optional EXPORTS
    if (this.matchIdent("EXPORTS")) {
      if (this.matchIdent("ALL")) {
        exportsAll = true;
      } else {
        exportsAll = false;
        while (this.peek().kind !== "SEMI" && this.peek().kind !== "EOF") {
          if (this.peek().kind === "IDENT") {
            exports.push(this.next().text);
          } else {
            this.next();
          }
          this.match("COMMA");
        }
      }
      this.match("SEMI");
    }

    // Optional IMPORTS
    if (this.matchIdent("IMPORTS")) {
      while (this.peek().kind !== "SEMI" && this.peek().kind !== "EOF") {
        const startTok = this.peek();
        const symbols: string[] = [];
        while (this.peek().kind !== "EOF" && this.peek().kind !== "SEMI" && !this.isIdent("FROM")) {
          if (this.peek().kind === "IDENT") {
            symbols.push(this.next().text);
          } else {
            this.next();
          }
          this.match("COMMA");
        }
        if (this.matchIdent("FROM")) {
          const modTok = this.peek().kind === "IDENT" ? this.next() : this.peek();
          if (this.peek().kind === "LBRACE") {
            this.parseOidBraceValue();
          }
          imports.push({
            symbols,
            fromModule: modTok.text || "UnknownModule",
            span: makeSpan(startTok, modTok),
          });
        } else {
          break;
        }
      }
      this.match("SEMI");
    }

    // Assignments until END or EOF
    while (this.peek().kind !== "EOF") {
      if (this.matchIdent("END")) {
        hasEnd = true;
        break;
      }

      if (this.peek().kind !== "IDENT") {
        this.recordError(`Unexpected token '${this.peek().text}' at module top level`);
        this.next();
        continue;
      }

      const lhsTok = this.next();
      if (this.peek().kind === "ASSIGN") {
        // Type assignment: TypeName ::= TypeExpr
        this.next();
        const typeExpr = this.parseTypeExpr();
        types.push({
          name: lhsTok.text,
          type: typeExpr,
          span: {
            startLine: lhsTok.line,
            startColumn: lhsTok.column,
            endLine: typeExpr.span.endLine,
            endColumn: typeExpr.span.endColumn,
            startOffset: lhsTok.offset,
            endOffset: typeExpr.span.endOffset,
          },
        });
      } else {
        // Value assignment: valName TypeExpr ::= Value
        const valType = this.parseTypeExpr();
        if (!this.match("ASSIGN")) {
          this.recordError(`Expected '::=' in assignment for '${lhsTok.text}'`);
          continue;
        }
        const valStart = this.peek();
        let rawValue = "";
        let parsedOidArcs: number[] | undefined;
        let endTok = valStart;

        if (this.peek().kind === "LBRACE") {
          const oidRes = this.parseOidBraceValue();
          rawValue = oidRes.raw;
          parsedOidArcs = oidRes.arcs;
          endTok = oidRes.endTok;
        } else if (this.peek().kind === "NUMBER" || this.peek().kind === "STRING" || this.peek().kind === "IDENT") {
          endTok = this.next();
          rawValue = endTok.text;
        } else {
          this.recordError(`Expected value expression for '${lhsTok.text}'`);
        }

        values.push({
          name: lhsTok.text,
          type: valType,
          rawValue,
          oidArcs: parsedOidArcs,
          span: makeSpan(lhsTok, endTok),
        });
      }
    }

    const lastTok = this.tokens[this.tokens.length - 1] ?? firstTok;
    return {
      name,
      oidArcs,
      tagDefault,
      exportsAll,
      exports,
      imports,
      types,
      values,
      comments,
      parseErrors: this.errors,
      hasBegin,
      hasEnd,
      span: {
        startLine: firstTok.line,
        startColumn: firstTok.column,
        endLine: lastTok.line,
        endColumn: lastTok.column,
        startOffset: 0,
        endOffset: sourceLength,
      },
    };
  }

  private parseOidBraceValue(): { raw: string; arcs: number[]; endTok: Token } {
    const start = this.next(); // '{'
    const parts: string[] = ["{"];
    const arcs: number[] = [];
    let endTok = start;
    while (this.peek().kind !== "RBRACE" && this.peek().kind !== "EOF") {
      const t = this.next();
      endTok = t;
      parts.push(t.text);
      if (t.kind === "NUMBER") {
        arcs.push(Number(t.text));
      } else if (t.kind === "IDENT" && this.peek().kind === "LPAREN") {
        // namedNumber form: iso(1)
        this.next(); // '('
        const numTok = this.peek();
        if (numTok.kind === "NUMBER") {
          this.next();
          arcs.push(Number(numTok.text));
          parts.push(`(${numTok.text})`);
        }
        this.match("RPAREN");
      }
    }
    if (this.peek().kind === "RBRACE") {
      endTok = this.next();
      parts.push("}");
    }
    return { raw: parts.join(" "), arcs, endTok };
  }

  private parseTag(): Asn1Tag {
    const start = this.next(); // '['
    let tagClass: Asn1TagClass = "CONTEXT";
    if (this.matchIdent("UNIVERSAL")) {
      tagClass = "UNIVERSAL";
    } else if (this.matchIdent("APPLICATION")) {
      tagClass = "APPLICATION";
    } else if (this.matchIdent("PRIVATE")) {
      tagClass = "PRIVATE";
    }
    let num = 0;
    if (this.peek().kind === "NUMBER") {
      num = Number(this.next().text);
    } else {
      this.recordError(`Expected numeric tag inside '[...]', found '${this.peek().text}'`);
    }
    const end = this.match("RBRACKET") ?? this.peek();
    let mode: "EXPLICIT" | "IMPLICIT" | undefined;
    if (this.matchIdent("EXPLICIT")) {
      mode = "EXPLICIT";
    } else if (this.matchIdent("IMPLICIT")) {
      mode = "IMPLICIT";
    }
    return { tagClass, number: num, mode, span: makeSpan(start, end) };
  }

  private parseConstraint(): Asn1Constraint | undefined {
    if (this.peek().kind !== "LPAREN") return undefined;
    const start = this.next(); // '('
    let kind: "size" | "range" | "singleValue" = "singleValue";
    let min: number | undefined;
    let max: number | undefined;
    let exact: number | undefined;
    let minUnbounded = false;
    let maxUnbounded = false;

    if (this.matchIdent("SIZE")) {
      kind = "size";
      const hasInnerParen = this.match("LPAREN") !== null;
      const bounds = this.parseBoundExpr();
      min = bounds.min;
      max = bounds.max;
      exact = bounds.exact;
      minUnbounded = bounds.minUnbounded;
      maxUnbounded = bounds.maxUnbounded;
      if (hasInnerParen) this.match("RPAREN");
    } else {
      const bounds = this.parseBoundExpr();
      min = bounds.min;
      max = bounds.max;
      exact = bounds.exact;
      minUnbounded = bounds.minUnbounded;
      maxUnbounded = bounds.maxUnbounded;
      kind = bounds.isRange ? "range" : "singleValue";
    }

    // Consume any remaining tokens inside outer parens
    let depth = 1;
    let endTok = start;
    while (depth > 0 && this.peek().kind !== "EOF") {
      if (this.peek().kind === "LPAREN") {
        depth++;
        endTok = this.next();
      } else if (this.peek().kind === "RPAREN") {
        depth--;
        endTok = this.next();
      } else {
        endTok = this.next();
      }
    }

    return {
      kind,
      min,
      max,
      exact,
      minUnbounded: minUnbounded || undefined,
      maxUnbounded: maxUnbounded || undefined,
      span: makeSpan(start, endTok),
    };
  }

  private parseBoundExpr(): {
    isRange: boolean;
    min?: number | undefined;
    max?: number | undefined;
    exact?: number | undefined;
    minUnbounded: boolean;
    maxUnbounded: boolean;
  } {
    let minVal: number | undefined;
    let minUnbounded = false;
    if (this.matchIdent("MIN")) {
      minUnbounded = true;
    } else if (this.peek().kind === "NUMBER") {
      minVal = Number(this.next().text);
    }

    if (this.match("RANGE")) {
      let maxVal: number | undefined;
      let maxUnbounded = false;
      if (this.matchIdent("MAX")) {
        maxUnbounded = true;
      } else if (this.peek().kind === "NUMBER") {
        maxVal = Number(this.next().text);
      }
      return { isRange: true, min: minVal, max: maxVal, minUnbounded, maxUnbounded };
    }

    return { isRange: false, exact: minVal, min: minVal, max: minVal, minUnbounded, maxUnbounded: false };
  }

  private parseNamedNumberList(): { items: Asn1NamedNumber[]; extensible: boolean; endTok: Token } {
    const start = this.next(); // '{'
    const items: Asn1NamedNumber[] = [];
    let extensible = false;
    let nextAutoValue = 0;
    let endTok = start;

    while (this.peek().kind !== "RBRACE" && this.peek().kind !== "EOF") {
      if (this.match("ELLIPSIS")) {
        extensible = true;
        this.match("COMMA");
        continue;
      }
      if (this.peek().kind !== "IDENT") {
        this.recordError(`Expected enumeration/named-number identifier, found '${this.peek().text}'`);
        this.next();
        continue;
      }
      const nameTok = this.next();
      let val = nextAutoValue;
      let itemEnd = nameTok;
      if (this.match("LPAREN")) {
        if (this.peek().kind === "NUMBER") {
          const numTok = this.next();
          val = Number(numTok.text);
          nextAutoValue = val + 1;
        }
        itemEnd = this.match("RPAREN") ?? nameTok;
      } else {
        nextAutoValue++;
      }
      items.push({ name: nameTok.text, value: val, span: makeSpan(nameTok, itemEnd) });
      this.match("COMMA");
    }
    if (this.peek().kind === "RBRACE") {
      endTok = this.next();
    } else {
      this.recordError("Unterminated '{ ... }' enumeration list");
    }
    return { items, extensible, endTok };
  }

  private parseFieldList(): { fields: Asn1Field[]; extensible: boolean; endTok: Token } {
    const start = this.next(); // '{'
    const fields: Asn1Field[] = [];
    let extensible = false;
    let endTok = start;

    while (this.peek().kind !== "RBRACE" && this.peek().kind !== "EOF") {
      if (this.match("ELLIPSIS")) {
        extensible = true;
        this.match("COMMA");
        continue;
      }
      if (this.peek().kind !== "IDENT") {
        this.recordError(`Expected field name inside SEQUENCE/SET/CHOICE, found '${this.peek().text}'`);
        this.next();
        continue;
      }
      const nameTok = this.next();
      let tag: Asn1Tag | undefined;
      if (this.peek().kind === "LBRACKET") {
        tag = this.parseTag();
      }
      const fieldType = this.parseTypeExpr();
      let optional = false;
      let defaultValue: string | undefined;
      let fieldEndSpan = fieldType.span;

      if (this.matchIdent("OPTIONAL")) {
        optional = true;
      } else if (this.matchIdent("DEFAULT")) {
        optional = true;
        if (this.peek().kind === "LBRACE") {
          const braceVal = this.parseOidBraceValue();
          defaultValue = braceVal.raw;
          fieldEndSpan = makeSpan(nameTok, braceVal.endTok);
        } else if (this.peek().kind !== "COMMA" && this.peek().kind !== "RBRACE" && this.peek().kind !== "EOF") {
          const defTok = this.next();
          defaultValue = defTok.text;
          fieldEndSpan = makeSpan(nameTok, defTok);
        }
      }

      fields.push({
        name: nameTok.text,
        type: fieldType,
        tag,
        optional,
        defaultValue,
        span: {
          startLine: nameTok.line,
          startColumn: nameTok.column,
          endLine: fieldEndSpan.endLine,
          endColumn: fieldEndSpan.endColumn,
          startOffset: nameTok.offset,
          endOffset: fieldEndSpan.endOffset,
        },
      });
      this.match("COMMA");
    }

    if (this.peek().kind === "RBRACE") {
      endTok = this.next();
    } else {
      this.recordError("Unterminated '{ ... }' field list");
    }
    return { fields, extensible, endTok };
  }

  private parseTypeExpr(): Asn1TypeExpr {
    const start = this.peek();

    // Tagged type: [0] EXPLICIT Type
    if (start.kind === "LBRACKET") {
      const tag = this.parseTag();
      const inner = this.parseTypeExpr();
      return {
        kind: "tagged",
        tag,
        inner,
        span: {
          startLine: tag.span.startLine,
          startColumn: tag.span.startColumn,
          endLine: inner.span.endLine,
          endColumn: inner.span.endColumn,
          startOffset: tag.span.startOffset,
          endOffset: inner.span.endOffset,
        },
      };
    }

    // SEQUENCE / SEQUENCE (SIZE(...)) OF Type / SEQUENCE { ... }
    if (this.matchIdent("SEQUENCE")) {
      let sizeConstraint: Asn1Constraint | undefined;
      if (this.peek().kind === "LPAREN") {
        sizeConstraint = this.parseConstraint();
      }
      if (this.matchIdent("OF")) {
        const elementType = this.parseTypeExpr();
        return {
          kind: "sequenceOf",
          elementType,
          constraint: sizeConstraint,
          span: {
            startLine: start.line,
            startColumn: start.column,
            endLine: elementType.span.endLine,
            endColumn: elementType.span.endColumn,
            startOffset: start.offset,
            endOffset: elementType.span.endOffset,
          },
        };
      }
      if (this.peek().kind === "LBRACE") {
        const { fields, extensible, endTok } = this.parseFieldList();
        return { kind: "sequence", fields, extensible: extensible || undefined, span: makeSpan(start, endTok) };
      }
      return { kind: "sequence", fields: [], span: makeSpan(start, start) };
    }

    // SET / SET (SIZE(...)) OF Type / SET { ... }
    if (this.matchIdent("SET")) {
      let sizeConstraint: Asn1Constraint | undefined;
      if (this.peek().kind === "LPAREN") {
        sizeConstraint = this.parseConstraint();
      }
      if (this.matchIdent("OF")) {
        const elementType = this.parseTypeExpr();
        return {
          kind: "setOf",
          elementType,
          constraint: sizeConstraint,
          span: {
            startLine: start.line,
            startColumn: start.column,
            endLine: elementType.span.endLine,
            endColumn: elementType.span.endColumn,
            startOffset: start.offset,
            endOffset: elementType.span.endOffset,
          },
        };
      }
      if (this.peek().kind === "LBRACE") {
        const { fields, extensible, endTok } = this.parseFieldList();
        return { kind: "set", fields, extensible: extensible || undefined, span: makeSpan(start, endTok) };
      }
      return { kind: "set", fields: [], span: makeSpan(start, start) };
    }

    // CHOICE { ... }
    if (this.matchIdent("CHOICE")) {
      if (this.peek().kind === "LBRACE") {
        const { fields, extensible, endTok } = this.parseFieldList();
        return {
          kind: "choice",
          alternatives: fields,
          extensible: extensible || undefined,
          span: makeSpan(start, endTok),
        };
      }
      this.recordError("Expected '{' after CHOICE");
      return { kind: "choice", alternatives: [], span: makeSpan(start, start) };
    }

    // ENUMERATED { ... }
    if (this.matchIdent("ENUMERATED")) {
      if (this.peek().kind === "LBRACE") {
        const { items, extensible, endTok } = this.parseNamedNumberList();
        return { kind: "enumerated", items, extensible: extensible || undefined, span: makeSpan(start, endTok) };
      }
      this.recordError("Expected '{' after ENUMERATED");
      return { kind: "enumerated", items: [], span: makeSpan(start, start) };
    }

    // Multi-word primitives: OCTET STRING, BIT STRING, OBJECT IDENTIFIER
    if (this.isIdent("OCTET") && this.isIdent("STRING", 1)) {
      this.next();
      const endWord = this.next();
      const constraint = this.parseConstraint();
      return {
        kind: "primitive",
        primitive: "OCTET STRING",
        constraint,
        span: constraint
          ? { ...makeSpan(start, endWord), endOffset: constraint.span.endOffset }
          : makeSpan(start, endWord),
      };
    }

    if (this.isIdent("BIT") && this.isIdent("STRING", 1)) {
      this.next();
      const endWord = this.next();
      let namedNumbers: Asn1NamedNumber[] | undefined;
      if (this.peek().kind === "LBRACE") {
        namedNumbers = this.parseNamedNumberList().items;
      }
      const constraint = this.parseConstraint();
      return {
        kind: "primitive",
        primitive: "BIT STRING",
        constraint,
        namedNumbers,
        span: constraint
          ? { ...makeSpan(start, endWord), endOffset: constraint.span.endOffset }
          : makeSpan(start, endWord),
      };
    }

    if (this.isIdent("OBJECT") && this.isIdent("IDENTIFIER", 1)) {
      this.next();
      const endWord = this.next();
      return { kind: "primitive", primitive: "OBJECT IDENTIFIER", span: makeSpan(start, endWord) };
    }

    // Single-word primitives
    if (start.kind === "IDENT") {
      const prim = SINGLE_WORD_PRIMITIVES.get(start.text);
      if (prim) {
        this.next();
        let namedNumbers: Asn1NamedNumber[] | undefined;
        if (prim === "INTEGER" && this.peek().kind === "LBRACE") {
          namedNumbers = this.parseNamedNumberList().items;
        }
        const constraint = this.parseConstraint();
        return {
          kind: "primitive",
          primitive: prim,
          constraint,
          namedNumbers,
          span: constraint
            ? { ...makeSpan(start, start), endOffset: constraint.span.endOffset }
            : makeSpan(start, start),
        };
      }

      // User-defined type reference
      const refTok = this.next();
      const constraint = this.parseConstraint();
      return {
        kind: "reference",
        name: refTok.text,
        constraint,
        span: constraint
          ? { ...makeSpan(refTok, refTok), endOffset: constraint.span.endOffset }
          : makeSpan(refTok, refTok),
      };
    }

    this.recordError(`Expected ASN.1 type expression, found '${start.text}'`);
    if (start.kind !== "EOF") this.next();
    return { kind: "primitive", primitive: "NULL", span: makeSpan(start, start) };
  }
}

/**
 * Parses an ISO/ITU-T X.208 / X.680 ASN.1 module source string into an `Asn1Module`.
 */
export function parseAsn1(source: string): Asn1Module {
  const { tokens, comments } = tokenizeAsn1(source);
  const parser = new Asn1Parser(tokens);
  return parser.parseModule(source.length, comments);
}

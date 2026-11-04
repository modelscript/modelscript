// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gproms — Zero-Regex Character-by-Character Lexer, Parser & Serializer
 * for gPROMS Process Modeling Language (.gproms, .pml).
 *
 * Supports:
 *   - DECLARE TYPE ... = default : lower : upper UNIT = "..." END
 *   - MODEL ... PARAMETER ... DISTRIBUTION_DOMAIN ... VARIABLE ... BOUNDARY ... EQUATION ... END
 *   - Time derivatives ($x) and spatial partial derivatives (PARTIAL(C, Axial))
 *   - PROCESS ... UNIT ... SET ... ASSIGN ... INITIAL ... SOLUTIONPARAMETERS ... END
 */

import type {
  GpromsDiscretizationMethod,
  GpromsDocument,
  GpromsDuplicateDeclaration,
  GpromsEquation,
  GpromsModel,
  GpromsParameter,
  GpromsParameterDataType,
  GpromsPartialDerivative,
  GpromsProcess,
  GpromsProcessAssignment,
  GpromsRange,
  GpromsVariableType,
} from "../types.js";

export type GpromsTokenType =
  | "IDENT"
  | "NUMBER"
  | "STRING"
  | "DOLLAR"
  | "ASSIGN_OP"
  | "EQUALS"
  | "COLON"
  | "SEMICOLON"
  | "COMMA"
  | "DOT"
  | "LPAREN"
  | "RPAREN"
  | "LBRACKET"
  | "RBRACKET"
  | "OP"
  | "EOF";

export interface GpromsToken {
  type: GpromsTokenType;
  value: string;
  upper: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

const BUILTIN_FUNCTIONS_AND_CONSTANTS = new Set<string>([
  "PARTIAL",
  "INTEGRAL",
  "EXP",
  "LOG",
  "LN",
  "LOG10",
  "SIN",
  "COS",
  "TAN",
  "ASIN",
  "ACOS",
  "ATAN",
  "SINH",
  "COSH",
  "TANH",
  "SQRT",
  "ABS",
  "MIN",
  "MAX",
  "SIGN",
  "TIME",
  "PI",
  "TRUE",
  "FALSE",
]);

const MODEL_SECTION_KEYWORDS = new Set<string>([
  "PARAMETER",
  "DISTRIBUTION_DOMAIN",
  "VARIABLE",
  "BOUNDARY",
  "EQUATION",
  "INITIAL",
  "SET",
  "ASSIGN",
  "END",
]);

const PROCESS_SECTION_KEYWORDS = new Set<string>([
  "UNIT",
  "SET",
  "ASSIGN",
  "INITIAL",
  "SOLUTIONPARAMETERS",
  "SCHEDULE",
  "END",
]);

function isAsciiDigit(ch: string): boolean {
  if (ch.length === 0) return false;
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function isAsciiAlpha(ch: string): boolean {
  if (ch.length === 0) return false;
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isIdentStart(ch: string): boolean {
  return isAsciiAlpha(ch) || ch === "_";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isAsciiDigit(ch);
}

function isHorizontalWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\f";
}

export class GpromsLexer {
  private pos = 0;
  private line = 1;
  private col = 1;
  private readonly len: number;

  constructor(private readonly source: string) {
    this.len = source.length;
  }

  public tokenize(): GpromsToken[] {
    const tokens: GpromsToken[] = [];

    while (this.pos < this.len) {
      const ch = this.source[this.pos] ?? "";
      const next = this.source[this.pos + 1] ?? "";

      // Newline
      if (ch === "\n") {
        this.pos++;
        this.line++;
        this.col = 1;
        continue;
      }

      // Horizontal whitespace
      if (isHorizontalWhitespace(ch)) {
        this.advance();
        continue;
      }

      // Single-line hash or double-slash comments
      if (ch === "#" || (ch === "/" && next === "/")) {
        this.skipLine();
        continue;
      }

      // Block comments with braces
      if (ch === "{") {
        this.skipBraceComment();
        continue;
      }

      // Block comments with slash-star
      if (ch === "/" && next === "*") {
        this.skipSlashStarComment();
        continue;
      }

      // Multi-character operators
      if (ch === ":" && next === "=") {
        tokens.push(this.makeTwoCharToken("ASSIGN_OP", ":="));
        continue;
      }
      if (ch === "*" && next === "*") {
        tokens.push(this.makeTwoCharToken("OP", "^"));
        continue;
      }
      if (
        (ch === "<" && next === "=") ||
        (ch === ">" && next === "=") ||
        (ch === "<" && next === ">") ||
        (ch === "=" && next === "=")
      ) {
        tokens.push(this.makeTwoCharToken("OP", ch + next));
        continue;
      }
      // gPROMS interior domain bounds '0|+' or 'L|-'
      if (ch === "|" && (next === "+" || next === "-")) {
        this.advance();
        this.advance();
        continue;
      }

      // Single-character delimiters & operators
      if (ch === "$") {
        tokens.push(this.makeSingleCharToken("DOLLAR", "$"));
        continue;
      }
      if (ch === "=") {
        tokens.push(this.makeSingleCharToken("EQUALS", "="));
        continue;
      }
      if (ch === ":") {
        tokens.push(this.makeSingleCharToken("COLON", ":"));
        continue;
      }
      if (ch === ";") {
        tokens.push(this.makeSingleCharToken("SEMICOLON", ";"));
        continue;
      }
      if (ch === ",") {
        tokens.push(this.makeSingleCharToken("COMMA", ","));
        continue;
      }
      if (ch === ".") {
        if (isAsciiDigit(next)) {
          tokens.push(this.lexNumber());
        } else {
          tokens.push(this.makeSingleCharToken("DOT", "."));
        }
        continue;
      }
      if (ch === "(") {
        tokens.push(this.makeSingleCharToken("LPAREN", "("));
        continue;
      }
      if (ch === ")") {
        tokens.push(this.makeSingleCharToken("RPAREN", ")"));
        continue;
      }
      if (ch === "[") {
        tokens.push(this.makeSingleCharToken("LBRACKET", "["));
        continue;
      }
      if (ch === "]") {
        tokens.push(this.makeSingleCharToken("RBRACKET", "]"));
        continue;
      }
      if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^" || ch === "<" || ch === ">") {
        tokens.push(this.makeSingleCharToken("OP", ch));
        continue;
      }

      // String literal
      if (ch === '"' || ch === "'") {
        tokens.push(this.lexString(ch));
        continue;
      }

      // Number literal
      if (isAsciiDigit(ch)) {
        tokens.push(this.lexNumber());
        continue;
      }

      // Identifier or keyword
      if (isIdentStart(ch)) {
        tokens.push(this.lexIdent());
        continue;
      }

      // Unrecognized character
      this.advance();
    }

    tokens.push({
      type: "EOF",
      value: "",
      upper: "",
      startLine: this.line,
      startColumn: this.col,
      endLine: this.line,
      endColumn: this.col,
      startOffset: this.pos,
      endOffset: this.pos,
    });

    return tokens;
  }

  private advance(): string {
    const ch = this.source[this.pos] ?? "";
    this.pos++;
    this.col++;
    return ch;
  }

  private skipLine(): void {
    while (this.pos < this.len && this.source[this.pos] !== "\n") {
      this.pos++;
      this.col++;
    }
  }

  private skipBraceComment(): void {
    this.advance(); // '{'
    while (this.pos < this.len && this.source[this.pos] !== "}") {
      if (this.source[this.pos] === "\n") {
        this.pos++;
        this.line++;
        this.col = 1;
      } else {
        this.advance();
      }
    }
    if (this.pos < this.len && this.source[this.pos] === "}") {
      this.advance();
    }
  }

  private skipSlashStarComment(): void {
    this.advance(); // '/'
    this.advance(); // '*'
    while (this.pos < this.len) {
      if (this.source[this.pos] === "*" && this.source[this.pos + 1] === "/") {
        this.advance();
        this.advance();
        break;
      }
      if (this.source[this.pos] === "\n") {
        this.pos++;
        this.line++;
        this.col = 1;
      } else {
        this.advance();
      }
    }
  }

  private makeSingleCharToken(type: GpromsTokenType, value: string): GpromsToken {
    const startOffset = this.pos;
    const startLine = this.line;
    const startCol = this.col;
    this.advance();
    return {
      type,
      value,
      upper: value.toUpperCase(),
      startLine,
      startColumn: startCol,
      endLine: startLine,
      endColumn: this.col,
      startOffset,
      endOffset: this.pos,
    };
  }

  private makeTwoCharToken(type: GpromsTokenType, value: string): GpromsToken {
    const startOffset = this.pos;
    const startLine = this.line;
    const startCol = this.col;
    this.advance();
    this.advance();
    return {
      type,
      value,
      upper: value.toUpperCase(),
      startLine,
      startColumn: startCol,
      endLine: startLine,
      endColumn: this.col,
      startOffset,
      endOffset: this.pos,
    };
  }

  private lexString(quote: string): GpromsToken {
    const startOffset = this.pos;
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // opening quote
    let value = "";
    while (this.pos < this.len && this.source[this.pos] !== quote && this.source[this.pos] !== "\n") {
      value += this.source[this.pos] ?? "";
      this.advance();
    }
    if (this.pos < this.len && this.source[this.pos] === quote) {
      this.advance(); // closing quote
    }
    return {
      type: "STRING",
      value,
      upper: value.toUpperCase(),
      startLine,
      startColumn: startCol,
      endLine: this.line,
      endColumn: this.col,
      startOffset,
      endOffset: this.pos,
    };
  }

  private lexNumber(): GpromsToken {
    const startOffset = this.pos;
    const startLine = this.line;
    const startCol = this.col;
    let numStr = "";

    while (this.pos < this.len && isAsciiDigit(this.source[this.pos] ?? "")) {
      numStr += this.advance();
    }

    if (this.pos < this.len && this.source[this.pos] === ".") {
      numStr += this.advance();
      while (this.pos < this.len && isAsciiDigit(this.source[this.pos] ?? "")) {
        numStr += this.advance();
      }
    }

    const expChar = this.source[this.pos] ?? "";
    if (expChar === "e" || expChar === "E") {
      const next = this.source[this.pos + 1] ?? "";
      const afterNext = this.source[this.pos + 2] ?? "";
      if (isAsciiDigit(next) || ((next === "+" || next === "-") && isAsciiDigit(afterNext))) {
        numStr += this.advance(); // exponent marker
        if (next === "+" || next === "-") {
          numStr += this.advance(); // exponent sign
        }
        while (this.pos < this.len && isAsciiDigit(this.source[this.pos] ?? "")) {
          numStr += this.advance();
        }
      }
    }

    return {
      type: "NUMBER",
      value: numStr,
      upper: numStr.toUpperCase(),
      startLine,
      startColumn: startCol,
      endLine: this.line,
      endColumn: this.col,
      startOffset,
      endOffset: this.pos,
    };
  }

  private lexIdent(): GpromsToken {
    const startOffset = this.pos;
    const startLine = this.line;
    const startCol = this.col;
    let id = "";
    while (this.pos < this.len && isIdentPart(this.source[this.pos] ?? "")) {
      id += this.advance();
    }
    return {
      type: "IDENT",
      value: id,
      upper: id.toUpperCase(),
      startLine,
      startColumn: startCol,
      endLine: this.line,
      endColumn: this.col,
      startOffset,
      endOffset: this.pos,
    };
  }
}

function tokenRange(startTok: GpromsToken, endTok: GpromsToken): GpromsRange {
  return {
    startLine: startTok.startLine,
    startColumn: startTok.startColumn,
    endLine: endTok.endLine,
    endColumn: endTok.endColumn,
    startOffset: startTok.startOffset,
    endOffset: endTok.endOffset,
  };
}

export function parseGproms(source: string, sourceFile?: string): GpromsDocument {
  const lexer = new GpromsLexer(source);
  const tokens = lexer.tokenize();
  let idx = 0;

  const variableTypes = new Map<string, GpromsVariableType>();
  const models = new Map<string, GpromsModel>();
  const processes = new Map<string, GpromsProcess>();
  const duplicateDeclarations: GpromsDuplicateDeclaration[] = [];

  const peek = (offset = 0): GpromsToken => {
    return tokens[idx + offset] ?? tokens[tokens.length - 1]!;
  };

  const consume = (): GpromsToken => {
    const tok = peek();
    if (idx < tokens.length - 1) idx++;
    return tok;
  };

  const skipOptionalSemicolons = (): void => {
    while (peek().type === "SEMICOLON") {
      consume();
    }
  };

  const parseSignedNumber = (paramMap?: Map<string, GpromsParameter>): number => {
    let sign = 1;
    if (peek().type === "OP" && (peek().value === "-" || peek().value === "+")) {
      const op = consume().value;
      if (op === "-") sign = -1;
    }
    const tok = peek();
    if (tok.type === "NUMBER") {
      consume();
      const parsed = Number(tok.value);
      return Number.isNaN(parsed) ? 0 : sign * parsed;
    }
    if (tok.type === "IDENT" && paramMap) {
      consume();
      const param = paramMap.get(tok.value);
      return sign * (param?.defaultValue ?? 1.0);
    }
    return 0;
  };

  const parseDeclareTypeSection = (): void => {
    while (peek().type !== "EOF" && peek().upper !== "END") {
      skipOptionalSemicolons();
      if (peek().upper === "END" || peek().type === "EOF") break;
      if (peek().upper === "TYPE") {
        consume();
        continue;
      }

      if (peek().type !== "IDENT") {
        consume();
        continue;
      }

      const nameTok = consume();
      const typeName = nameTok.value;
      let defaultVal = 0.0;
      let lowerBound = -1e10;
      let upperBound = 1e10;
      let unit: string | undefined;
      let lastTok = nameTok;

      if (peek().type === "EQUALS" || peek().type === "ASSIGN_OP") {
        consume();
        defaultVal = parseSignedNumber();
        lastTok = peek(-1);
        if (peek().type === "COLON") {
          consume();
          lowerBound = parseSignedNumber();
          lastTok = peek(-1);
        }
        if (peek().type === "COLON") {
          consume();
          upperBound = parseSignedNumber();
          lastTok = peek(-1);
        }
      }

      if (peek().upper === "UNIT") {
        consume();
        if (peek().type === "EQUALS" || peek().type === "ASSIGN_OP") {
          consume();
        }
        if (peek().type === "STRING" || peek().type === "IDENT") {
          const unitTok = consume();
          unit = unitTok.value;
          lastTok = unitTok;
        }
      }

      skipOptionalSemicolons();
      const range = tokenRange(nameTok, lastTok);

      if (variableTypes.has(typeName)) {
        duplicateDeclarations.push({
          kind: "TYPE",
          name: typeName,
          scope: "DECLARE TYPE",
          range,
        });
      }

      variableTypes.set(typeName, {
        name: typeName,
        defaultValue: defaultVal,
        lowerBound,
        upperBound,
        unit,
        range,
      });
    }

    if (peek().upper === "END") {
      consume(); // END of TYPE
    }
    if (peek().upper === "END") {
      consume(); // Optional outer END of DECLARE
    }
    skipOptionalSemicolons();
  };

  const parseParameterSection = (model: GpromsModel): void => {
    while (peek().type !== "EOF" && !MODEL_SECTION_KEYWORDS.has(peek().upper)) {
      skipOptionalSemicolons();
      if (peek().type === "EOF" || MODEL_SECTION_KEYWORDS.has(peek().upper)) break;

      if (peek().type !== "IDENT") {
        consume();
        continue;
      }

      const paramNames: GpromsToken[] = [consume()];
      while (peek().type === "COMMA") {
        consume();
        if (peek().type === "IDENT") {
          paramNames.push(consume());
        }
      }

      // Optional array dimension e.g. (N)
      if (peek().type === "LPAREN") {
        while (peek().type !== "EOF" && peek().type !== "RPAREN") {
          consume();
        }
        if (peek().type === "RPAREN") consume();
      }

      let dataType: GpromsParameterDataType = "REAL";
      let defaultValue: number | undefined;
      let unit: string | undefined;
      let lastTok = paramNames[paramNames.length - 1]!;

      if (peek().upper === "AS") {
        consume();
        if (peek().type === "IDENT") {
          const dtTok = consume();
          lastTok = dtTok;
          if (dtTok.upper === "INTEGER" || dtTok.upper === "INT") {
            dataType = "INTEGER";
          } else if (dtTok.upper === "LOGICAL" || dtTok.upper === "BOOLEAN") {
            dataType = "LOGICAL";
          } else {
            dataType = "REAL";
          }
        }
      }

      // Optional array dimension after type e.g. AS ARRAY(2) OF REAL
      if (peek().type === "LPAREN") {
        while (peek().type !== "EOF" && peek().type !== "RPAREN") {
          consume();
        }
        if (peek().type === "RPAREN") consume();
        if (peek().upper === "OF" && peek(1).type === "IDENT") {
          consume();
          lastTok = consume();
        }
      }

      if (peek().upper === "DEFAULT" || peek().type === "EQUALS" || peek().type === "ASSIGN_OP") {
        consume();
        defaultValue = parseSignedNumber(model.parameters);
        lastTok = peek(-1);
      }

      if (peek().upper === "UNIT") {
        consume();
        if (peek().type === "EQUALS" || peek().type === "ASSIGN_OP") consume();
        if (peek().type === "STRING" || peek().type === "IDENT") {
          const uTok = consume();
          unit = uTok.value;
          lastTok = uTok;
        }
      }

      skipOptionalSemicolons();

      for (const pTok of paramNames) {
        const range = tokenRange(pTok, lastTok);
        if (model.parameters.has(pTok.value)) {
          duplicateDeclarations.push({
            kind: "PARAMETER",
            name: pTok.value,
            scope: model.name,
            range,
          });
        }
        model.parameters.set(pTok.value, {
          name: pTok.value,
          dataType,
          defaultValue,
          unit,
          range,
        });
      }
    }
  };

  const parseDistributionDomainSection = (model: GpromsModel): void => {
    while (peek().type !== "EOF" && !MODEL_SECTION_KEYWORDS.has(peek().upper)) {
      skipOptionalSemicolons();
      if (peek().type === "EOF" || MODEL_SECTION_KEYWORDS.has(peek().upper)) break;

      if (peek().type !== "IDENT") {
        consume();
        continue;
      }

      const nameTok = consume();
      const domainName = nameTok.value;
      let lowerBound = 0.0;
      let upperBound = 1.0;
      let gridPoints = 10;
      let discretizationMethod: GpromsDiscretizationMethod | undefined;
      let lastTok = nameTok;

      if (peek().upper === "AS") {
        consume();
      }

      if (peek().type === "LBRACKET" || peek().type === "LPAREN") {
        const openType = consume().type;
        const closeType = openType === "LBRACKET" ? "RBRACKET" : "RPAREN";
        lowerBound = parseSignedNumber(model.parameters);
        if (peek().type === "COLON" || peek().type === "COMMA") {
          consume();
          upperBound = parseSignedNumber(model.parameters);
        }
        if (peek().type === "COLON" || peek().type === "COMMA") {
          consume();
          gridPoints = Math.round(parseSignedNumber(model.parameters));
        }
        if (peek().type === closeType) {
          lastTok = consume();
        }
      }

      // Optional trailing grid point / discretization specifiers: N = 20, NODES = 20, CFDM, BFDM, FFDM, OCFEM
      while (peek().type === "IDENT" && !MODEL_SECTION_KEYWORDS.has(peek().upper) && peek(1).upper !== "AS") {
        const specTok = consume();
        lastTok = specTok;
        if (specTok.upper === "N" || specTok.upper === "NODES" || specTok.upper === "GRID") {
          if (peek().type === "EQUALS" || peek().type === "ASSIGN_OP") consume();
          gridPoints = Math.round(parseSignedNumber(model.parameters));
          lastTok = peek(-1);
        } else if (
          specTok.upper === "CFDM" ||
          specTok.upper === "BFDM" ||
          specTok.upper === "FFDM" ||
          specTok.upper === "OCFEM"
        ) {
          discretizationMethod = specTok.upper as GpromsDiscretizationMethod;
        }
      }

      skipOptionalSemicolons();
      const range = tokenRange(nameTok, lastTok);

      if (model.domains.has(domainName)) {
        duplicateDeclarations.push({
          kind: "DISTRIBUTION_DOMAIN",
          name: domainName,
          scope: model.name,
          range,
        });
      }

      model.domains.set(domainName, {
        name: domainName,
        lowerBound,
        upperBound,
        gridPoints,
        discretizationMethod,
        range,
      });
    }
  };

  const parseVariableSection = (model: GpromsModel): void => {
    while (peek().type !== "EOF" && !MODEL_SECTION_KEYWORDS.has(peek().upper)) {
      skipOptionalSemicolons();
      if (peek().type === "EOF" || MODEL_SECTION_KEYWORDS.has(peek().upper)) break;

      if (peek().type !== "IDENT") {
        consume();
        continue;
      }

      const varNames: GpromsToken[] = [consume()];
      while (peek().type === "COMMA") {
        consume();
        if (peek().type === "IDENT") {
          varNames.push(consume());
        }
      }

      if (peek().upper === "AS") {
        consume();
      }

      const domains: string[] = [];
      if (peek().upper === "DISTRIBUTION" || peek().upper === "ARRAY") {
        consume();
        if (peek().type === "LPAREN") {
          consume();
          while (peek().type !== "EOF" && peek().type !== "RPAREN") {
            if (peek().type === "IDENT") {
              domains.push(consume().value);
            } else {
              consume();
            }
          }
          if (peek().type === "RPAREN") consume();
        }
        if (peek().upper === "OF") {
          consume();
        }
      }

      let typeName = "UnknownType";
      let lastTok = varNames[varNames.length - 1]!;
      if (peek().type === "IDENT") {
        const tTok = consume();
        typeName = tTok.value;
        lastTok = tTok;
      }

      skipOptionalSemicolons();

      for (const vTok of varNames) {
        const range = tokenRange(vTok, lastTok);
        if (model.variables.has(vTok.value)) {
          duplicateDeclarations.push({
            kind: "VARIABLE",
            name: vTok.value,
            scope: model.name,
            range,
          });
        }
        model.variables.set(vTok.value, {
          name: vTok.value,
          typeName,
          domains: [...domains],
          range,
        });
      }
    }
  };

  const formatTokensToExpr = (exprTokens: GpromsToken[]): string => {
    let out = "";
    for (let i = 0; i < exprTokens.length; i++) {
      const t = exprTokens[i]!;
      const prev = i > 0 ? exprTokens[i - 1] : undefined;
      if (i > 0) {
        const noSpaceBefore =
          t.type === "LPAREN" ||
          t.type === "RPAREN" ||
          t.type === "COMMA" ||
          t.type === "DOT" ||
          prev?.type === "DOLLAR" ||
          prev?.type === "LPAREN" ||
          prev?.type === "DOT";
        if (!noSpaceBefore) {
          out += " ";
        }
      }
      out += t.value;
    }
    return out.trim();
  };

  const isStartOfNewEquationOnNewLine = (posOffset: number, currentLine: number): boolean => {
    const t0 = peek(posOffset);
    if (t0.startLine <= currentLine) return false;
    if (MODEL_SECTION_KEYWORDS.has(t0.upper) || t0.upper === "FOR") return true;

    // Look ahead on t0's line to see if there is an '=' before a newline or semicolon
    let k = posOffset;
    if (peek(k).type === "DOLLAR") k++;
    if (peek(k).type !== "IDENT") return false;
    k++;
    if (peek(k).type === "LPAREN") {
      let depth = 1;
      k++;
      while (peek(k).type !== "EOF" && depth > 0) {
        if (peek(k).type === "LPAREN") depth++;
        else if (peek(k).type === "RPAREN") depth--;
        k++;
      }
    }
    return peek(k).type === "EQUALS";
  };

  const analyzeEquationTokens = (
    lhsTokens: GpromsToken[],
    rhsTokens: GpromsToken[],
    iteratorVars: Set<string>,
  ): {
    differentialVariables: string[];
    partials: GpromsPartialDerivative[];
    identifiers: string[];
  } => {
    const allTokens = [...lhsTokens, ...rhsTokens];
    const diffSet = new Set<string>();
    const partials: GpromsPartialDerivative[] = [];
    const identSet = new Set<string>();

    for (let i = 0; i < allTokens.length; i++) {
      const tok = allTokens[i]!;

      // Check $x differential variable
      if (tok.type === "DOLLAR" && allTokens[i + 1]?.type === "IDENT") {
        diffSet.add(allTokens[i + 1]!.value);
      }

      // Check PARTIAL(...)
      if (tok.upper === "PARTIAL" && allTokens[i + 1]?.type === "LPAREN") {
        // Check if nested PARTIAL(PARTIAL(var, dom), dom)
        if (allTokens[i + 2]?.upper === "PARTIAL" && allTokens[i + 3]?.type === "LPAREN") {
          const varTok = allTokens[i + 4];
          // Skip optional (z) after varTok
          let cursor = i + 5;
          if (allTokens[cursor]?.type === "LPAREN") {
            while (cursor < allTokens.length && allTokens[cursor]?.type !== "RPAREN") cursor++;
            cursor++;
          }
          if (allTokens[cursor]?.type === "COMMA" && allTokens[cursor + 1]?.type === "IDENT") {
            const domTok = allTokens[cursor + 1]!;
            if (varTok?.type === "IDENT") {
              partials.push({
                variable: varTok.value,
                domain: domTok.value,
                order: 2,
              });
            }
          }
          i = cursor + 2;
          continue;
        } else if (allTokens[i + 2]?.type === "IDENT") {
          const varTok = allTokens[i + 2]!;
          let cursor = i + 3;
          if (allTokens[cursor]?.type === "LPAREN") {
            while (cursor < allTokens.length && allTokens[cursor]?.type !== "RPAREN") cursor++;
            cursor++;
          }
          if (allTokens[cursor]?.type === "COMMA" && allTokens[cursor + 1]?.type === "IDENT") {
            const domTok = allTokens[cursor + 1]!;
            let order = 1;
            if (allTokens[cursor + 2]?.type === "COMMA" && allTokens[cursor + 3]?.type === "NUMBER") {
              order = Math.max(1, Math.round(Number(allTokens[cursor + 3]!.value)));
            }
            partials.push({
              variable: varTok.value,
              domain: domTok.value,
              order,
            });
          }
        }
      }

      if (tok.type === "IDENT") {
        if (!BUILTIN_FUNCTIONS_AND_CONSTANTS.has(tok.upper) && !iteratorVars.has(tok.value)) {
          identSet.add(tok.value);
        }
      }
    }

    return {
      differentialVariables: Array.from(diffSet),
      partials,
      identifiers: Array.from(identSet),
    };
  };

  const parseEquationSection = (model: GpromsModel, isBoundarySection: boolean): void => {
    const iteratorVars = new Set<string>();
    let forLoopDepth = 0;
    let activeDomainName: string | undefined;

    while (peek().type !== "EOF") {
      skipOptionalSemicolons();
      if (peek().type === "EOF") break;

      const curUpper = peek().upper;
      if (curUpper === "END") {
        if (forLoopDepth > 0) {
          consume(); // END of FOR loop
          forLoopDepth--;
          skipOptionalSemicolons();
          continue;
        }
        break;
      }

      if (MODEL_SECTION_KEYWORDS.has(curUpper)) {
        break;
      }

      // Handle FOR z := 0 TO L DO ...
      if (curUpper === "FOR") {
        consume(); // FOR
        if (peek().type === "IDENT") {
          const iterTok = consume();
          iteratorVars.add(iterTok.value);
          if (model.domains.has(iterTok.value)) {
            activeDomainName = iterTok.value;
          }
        }
        while (peek().type !== "EOF" && peek().upper !== "DO") {
          if (peek().type === "IDENT" && model.domains.has(peek().value)) {
            activeDomainName = peek().value;
          }
          consume();
        }
        if (peek().upper === "DO") {
          consume();
          forLoopDepth++;
        }
        continue;
      }

      // Collect LHS tokens up to '='
      const lhsTokens: GpromsToken[] = [];
      while (
        peek().type !== "EOF" &&
        peek().type !== "EQUALS" &&
        peek().type !== "SEMICOLON" &&
        !MODEL_SECTION_KEYWORDS.has(peek().upper)
      ) {
        lhsTokens.push(consume());
      }

      if (peek().type !== "EQUALS" || lhsTokens.length === 0) {
        if (peek().type === "SEMICOLON") consume();
        else if (peek().type !== "EOF" && !MODEL_SECTION_KEYWORDS.has(peek().upper)) consume();
        continue;
      }

      consume(); // '='

      // Collect RHS tokens up to ';' or start of next equation on a new line
      const rhsTokens: GpromsToken[] = [];
      let parenDepth = 0;
      while (peek().type !== "EOF" && peek().type !== "SEMICOLON") {
        if (parenDepth === 0) {
          if (MODEL_SECTION_KEYWORDS.has(peek().upper)) break;
          const prevLine = rhsTokens.length > 0 ? rhsTokens[rhsTokens.length - 1]!.endLine : lhsTokens[0]!.startLine;
          if (rhsTokens.length > 0 && isStartOfNewEquationOnNewLine(0, prevLine)) {
            break;
          }
        }
        const tok = consume();
        if (tok.type === "LPAREN" || tok.type === "LBRACKET") parenDepth++;
        else if (tok.type === "RPAREN" || tok.type === "RBRACKET") parenDepth = Math.max(0, parenDepth - 1);
        rhsTokens.push(tok);
      }

      skipOptionalSemicolons();
      if (rhsTokens.length === 0) continue;

      const lhs = formatTokensToExpr(lhsTokens);
      const rhs = formatTokensToExpr(rhsTokens);
      const raw = `${lhs} = ${rhs}`;
      const startTok = lhsTokens[0]!;
      const endTok = rhsTokens[rhsTokens.length - 1]!;
      const { differentialVariables, partials, identifiers } = analyzeEquationTokens(
        lhsTokens,
        rhsTokens,
        iteratorVars,
      );

      // Detect if LHS is a boundary evaluation e.g. C(0) = C_in or C(0.0) = C_in
      let isBoundary = isBoundarySection;
      if (
        !isBoundary &&
        lhsTokens.length >= 4 &&
        lhsTokens[0]?.type === "IDENT" &&
        lhsTokens[1]?.type === "LPAREN" &&
        lhsTokens[2]?.type === "NUMBER" &&
        model.variables.get(lhsTokens[0].value)?.domains.length
      ) {
        isBoundary = true;
      }

      const eq: GpromsEquation = {
        lhs,
        rhs,
        raw,
        isBoundary,
        domainName: activeDomainName ?? partials[0]?.domain,
        differentialVariables,
        partials,
        identifiers,
        range: tokenRange(startTok, endTok),
      };

      if (isBoundary) {
        model.boundaryEquations.push(eq);
      } else {
        model.equations.push(eq);
      }
    }
  };

  const parseModelBlock = (): void => {
    const modelKwTok = consume(); // MODEL
    const nameTok = peek().type === "IDENT" ? consume() : modelKwTok;
    const modelName = nameTok.value;

    const model: GpromsModel = {
      name: modelName,
      parameters: new Map(),
      domains: new Map(),
      variables: new Map(),
      boundaryEquations: [],
      equations: [],
    };

    while (peek().type !== "EOF" && peek().upper !== "END") {
      const secUpper = peek().upper;
      if (secUpper === "PARAMETER") {
        consume();
        parseParameterSection(model);
      } else if (secUpper === "DISTRIBUTION_DOMAIN") {
        consume();
        parseDistributionDomainSection(model);
      } else if (secUpper === "VARIABLE") {
        consume();
        parseVariableSection(model);
      } else if (secUpper === "BOUNDARY") {
        consume();
        parseEquationSection(model, true);
      } else if (secUpper === "EQUATION") {
        consume();
        parseEquationSection(model, false);
      } else {
        consume();
      }
    }

    const endTok = peek().upper === "END" ? consume() : peek(-1);
    skipOptionalSemicolons();
    model.range = tokenRange(modelKwTok, endTok);

    if (models.has(modelName)) {
      duplicateDeclarations.push({
        kind: "MODEL",
        name: modelName,
        scope: "Document",
        range: model.range,
      });
    }
    models.set(modelName, model);
  };

  const parseProcessAssignments = (
    targetMap: Map<string, number>,
    entriesList: GpromsProcessAssignment[] | undefined,
  ): void => {
    while (peek().type !== "EOF" && !PROCESS_SECTION_KEYWORDS.has(peek().upper)) {
      skipOptionalSemicolons();
      if (peek().type === "EOF" || PROCESS_SECTION_KEYWORDS.has(peek().upper)) break;

      if (peek().upper === "WITHIN") {
        consume();
        if (peek().type === "IDENT") consume();
        if (peek().upper === "DO") consume();
        continue;
      }

      if (peek().type !== "IDENT") {
        consume();
        continue;
      }

      const firstTok = consume();
      let unitName: string | undefined;
      let entityName = firstTok.value;
      let target = firstTok.value;

      if (peek().type === "DOT" && peek(1).type === "IDENT") {
        consume(); // '.'
        const secondTok = consume();
        unitName = firstTok.value;
        entityName = secondTok.value;
        target = `${unitName}.${entityName}`;
      }

      // Skip optional array/domain index e.g. C(0) or C(z)
      if (peek().type === "LPAREN") {
        while (peek().type !== "EOF" && peek().type !== "RPAREN") {
          consume();
        }
        if (peek().type === "RPAREN") consume();
      }

      if (peek().type === "ASSIGN_OP" || peek().type === "EQUALS") {
        consume();
        const val = parseSignedNumber();
        const endTok = peek(-1);
        const range = tokenRange(firstTok, endTok);
        targetMap.set(entityName, val);
        targetMap.set(target, val);
        if (entriesList) {
          entriesList.push({
            target,
            unitName,
            entityName,
            value: val,
            range,
          });
        }
      }
      skipOptionalSemicolons();
    }
  };

  const parseProcessBlock = (): void => {
    const procKwTok = consume(); // PROCESS
    const nameTok = peek().type === "IDENT" ? consume() : procKwTok;
    const procName = nameTok.value;

    const proc: GpromsProcess = {
      name: procName,
      units: new Map(),
      sets: new Map(),
      setEntries: [],
      assigns: new Map(),
      assignEntries: [],
      initials: new Map(),
      initialEntries: [],
      solutionParameters: new Map(),
    };

    while (peek().type !== "EOF" && peek().upper !== "END") {
      const secUpper = peek().upper;
      if (secUpper === "UNIT") {
        consume();
        while (peek().type !== "EOF" && !PROCESS_SECTION_KEYWORDS.has(peek().upper)) {
          skipOptionalSemicolons();
          if (peek().type === "EOF" || PROCESS_SECTION_KEYWORDS.has(peek().upper)) break;
          if (peek().type !== "IDENT") {
            consume();
            continue;
          }
          const uTok = consume();
          if (peek().upper === "AS") consume();
          const mTok = peek().type === "IDENT" ? consume() : uTok;
          skipOptionalSemicolons();
          const range = tokenRange(uTok, mTok);
          if (proc.units.has(uTok.value)) {
            duplicateDeclarations.push({
              kind: "UNIT",
              name: uTok.value,
              scope: procName,
              range,
            });
          }
          proc.units.set(uTok.value, mTok.value);
        }
      } else if (secUpper === "SET") {
        consume();
        parseProcessAssignments(proc.sets, proc.setEntries);
      } else if (secUpper === "ASSIGN") {
        consume();
        parseProcessAssignments(proc.assigns, proc.assignEntries);
      } else if (secUpper === "INITIAL") {
        consume();
        parseProcessAssignments(proc.initials, proc.initialEntries);
      } else if (secUpper === "SOLUTIONPARAMETERS") {
        consume();
        parseProcessAssignments(proc.solutionParameters, undefined);
      } else if (secUpper === "SCHEDULE") {
        consume();
        while (peek().type !== "EOF" && peek().upper !== "END") {
          consume();
        }
      } else {
        consume();
      }
    }

    const endTok = peek().upper === "END" ? consume() : peek(-1);
    skipOptionalSemicolons();
    proc.range = tokenRange(procKwTok, endTok);

    if (processes.has(procName)) {
      duplicateDeclarations.push({
        kind: "PROCESS",
        name: procName,
        scope: "Document",
        range: proc.range,
      });
    }
    processes.set(procName, proc);
  };

  while (peek().type !== "EOF") {
    const upper = peek().upper;
    if (upper === "DECLARE") {
      consume();
      if (peek().upper === "TYPE") {
        consume();
      }
      parseDeclareTypeSection();
    } else if (upper === "TYPE") {
      consume();
      parseDeclareTypeSection();
    } else if (upper === "MODEL") {
      parseModelBlock();
    } else if (upper === "PROCESS") {
      parseProcessBlock();
    } else {
      consume();
    }
  }

  return {
    variableTypes,
    models,
    processes,
    duplicateDeclarations,
    sourceFile,
  };
}

export function serializeGproms(doc: GpromsDocument): string {
  const lines: string[] = [];

  if (doc.variableTypes.size > 0) {
    lines.push("DECLARE");
    lines.push("  TYPE");
    for (const vt of doc.variableTypes.values()) {
      const unitPart = vt.unit ? ` UNIT = "${vt.unit}"` : "";
      lines.push(`    ${vt.name} = ${vt.defaultValue} : ${vt.lowerBound} : ${vt.upperBound}${unitPart}`);
    }
    lines.push("  END");
    lines.push("END");
    lines.push("");
  }

  for (const model of doc.models.values()) {
    lines.push(`MODEL ${model.name}`);

    if (model.parameters.size > 0) {
      lines.push("  PARAMETER");
      for (const p of model.parameters.values()) {
        const defPart = p.defaultValue !== undefined ? ` DEFAULT ${p.defaultValue}` : "";
        lines.push(`    ${p.name} AS ${p.dataType}${defPart}`);
      }
    }

    if (model.domains.size > 0) {
      lines.push("  DISTRIBUTION_DOMAIN");
      for (const d of model.domains.values()) {
        lines.push(`    ${d.name} AS [ ${d.lowerBound} : ${d.upperBound} ] N = ${d.gridPoints}`);
      }
    }

    if (model.variables.size > 0) {
      lines.push("  VARIABLE");
      for (const v of model.variables.values()) {
        if (v.domains.length > 0) {
          lines.push(`    ${v.name} AS DISTRIBUTION(${v.domains.join(", ")}) OF ${v.typeName}`);
        } else {
          lines.push(`    ${v.name} AS ${v.typeName}`);
        }
      }
    }

    if (model.boundaryEquations.length > 0) {
      lines.push("  BOUNDARY");
      for (const eq of model.boundaryEquations) {
        lines.push(`    ${eq.lhs} = ${eq.rhs} ;`);
      }
    }

    if (model.equations.length > 0) {
      lines.push("  EQUATION");
      for (const eq of model.equations) {
        lines.push(`    ${eq.lhs} = ${eq.rhs} ;`);
      }
    }

    lines.push("END");
    lines.push("");
  }

  for (const proc of doc.processes.values()) {
    lines.push(`PROCESS ${proc.name}`);

    if (proc.units.size > 0) {
      lines.push("  UNIT");
      for (const [uName, mName] of proc.units) {
        lines.push(`    ${uName} AS ${mName}`);
      }
    }

    if (proc.setEntries.length > 0) {
      lines.push("  SET");
      for (const entry of proc.setEntries) {
        lines.push(`    ${entry.target} := ${entry.value} ;`);
      }
    }

    if (proc.assignEntries.length > 0) {
      lines.push("  ASSIGN");
      for (const entry of proc.assignEntries) {
        lines.push(`    ${entry.target} := ${entry.value} ;`);
      }
    }

    if (proc.initialEntries.length > 0) {
      lines.push("  INITIAL");
      for (const entry of proc.initialEntries) {
        lines.push(`    ${entry.target} := ${entry.value} ;`);
      }
    }

    if (proc.solutionParameters.size > 0) {
      lines.push("  SOLUTIONPARAMETERS");
      for (const [k, v] of proc.solutionParameters) {
        if (!k.includes(".")) {
          lines.push(`    ${k} := ${v} ;`);
        }
      }
    }

    lines.push("END");
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

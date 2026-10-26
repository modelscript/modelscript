// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/aspen — High-Performance Zero-Regex Character Scanner & Parser for Aspen Plus Input Decks (.in, .inp, .bkp).
 *
 * Preserves exact 1-indexed source line, column, and character offsets for AST nodes.
 */

import type { AspenBlock, AspenBlockType, AspenComponent, AspenDeck, AspenStream, SourceLocation } from "../types.js";

export interface AspenToken {
  type: "IDENT" | "NUMBER" | "STRING" | "EQUALS" | "SLASH" | "COLON" | "NEWLINE" | "EOF";
  value: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export class AspenLexer {
  private pos = 0;
  private line = 1;
  private col = 1;
  private len: number;

  constructor(private source: string) {
    this.len = source.length;
  }

  public tokenize(): AspenToken[] {
    const tokens: AspenToken[] = [];

    while (this.pos < this.len) {
      const ch = this.source[this.pos]!;

      // Handle comments: ';', '*', '#' or 'C ' at line start
      if (
        ch === ";" ||
        ch === "#" ||
        (ch === "*" && (this.col === 1 || this.isWhitespace(this.source[this.pos - 1]!))) ||
        ((ch === "C" || ch === "c") && this.col === 1 && this.pos + 1 < this.len && this.source[this.pos + 1] === " ")
      ) {
        this.skipLine();
        continue;
      }

      // Handle newlines
      if (ch === "\n" || (ch === "\r" && this.pos + 1 < this.len && this.source[this.pos + 1] === "\n")) {
        const startOffset = this.pos;
        const startLine = this.line;
        const startCol = this.col;
        if (ch === "\r") this.advance();
        this.advance();
        this.line++;
        this.col = 1;
        // Avoid consecutive duplicate NEWLINE tokens
        if (tokens.length > 0 && tokens[tokens.length - 1]!.type !== "NEWLINE") {
          tokens.push({
            type: "NEWLINE",
            value: "\n",
            startLine,
            startColumn: startCol,
            endLine: startLine,
            endColumn: startCol + 1,
            startOffset,
            endOffset: this.pos,
          });
        }
        continue;
      }

      // Whitespace
      if (this.isWhitespace(ch)) {
        this.advance();
        continue;
      }

      // Delimiters
      if (ch === "=") {
        tokens.push(this.makeSingleCharToken("EQUALS", "="));
        continue;
      }
      if (ch === "/") {
        tokens.push(this.makeSingleCharToken("SLASH", "/"));
        continue;
      }
      if (ch === ":") {
        tokens.push(this.makeSingleCharToken("COLON", ":"));
        continue;
      }

      // String literals: '...' or "..."
      if (ch === "'" || ch === '"') {
        tokens.push(this.lexString(ch));
        continue;
      }

      // Numbers or signed numbers (if followed by digit or period)
      if (
        this.isDigit(ch) ||
        ((ch === "-" || ch === "+" || ch === ".") &&
          this.pos + 1 < this.len &&
          (this.isDigit(this.source[this.pos + 1]!) || (ch !== "." && this.source[this.pos + 1] === ".")))
      ) {
        tokens.push(this.lexNumber());
        continue;
      }

      // Identifiers / keywords (support hyphenated keywords e.g. IN-UNITS, P-SPEC, D:F)
      if (this.isIdentStart(ch)) {
        tokens.push(this.lexIdent());
        continue;
      }

      // If unknown char, advance
      this.advance();
    }

    tokens.push({
      type: "EOF",
      value: "",
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
    const ch = this.source[this.pos]!;
    this.pos++;
    this.col++;
    return ch;
  }

  private isWhitespace(ch: string): boolean {
    return ch === " " || ch === "\t" || ch === "\f";
  }

  private isDigit(ch: string): boolean {
    const code = ch.charCodeAt(0);
    return code >= 48 && code <= 57;
  }

  private isIdentStart(ch: string): boolean {
    const code = ch.charCodeAt(0);
    return (
      (code >= 65 && code <= 90) || // A-Z
      (code >= 97 && code <= 122) || // a-z
      ch === "_"
    );
  }

  private isIdentPart(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch) || ch === "-" || ch === ":" || ch === ".";
  }

  private skipLine(): void {
    while (this.pos < this.len && this.source[this.pos] !== "\n") {
      this.pos++;
    }
  }

  private makeSingleCharToken(type: AspenToken["type"], value: string): AspenToken {
    const startOffset = this.pos;
    const startLine = this.line;
    const startCol = this.col;
    this.advance();
    return {
      type,
      value,
      startLine,
      startColumn: startCol,
      endLine: startLine,
      endColumn: startCol + 1,
      startOffset,
      endOffset: this.pos,
    };
  }

  private lexString(quote: string): AspenToken {
    const startOffset = this.pos;
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // skip quote
    let str = "";

    while (this.pos < this.len && this.source[this.pos] !== quote && this.source[this.pos] !== "\n") {
      str += this.source[this.pos];
      this.advance();
    }

    if (this.pos < this.len && this.source[this.pos] === quote) {
      this.advance(); // skip closing quote
    }

    return {
      type: "STRING",
      value: str,
      startLine,
      startColumn: startCol,
      endLine: this.line,
      endColumn: this.col,
      startOffset,
      endOffset: this.pos,
    };
  }

  private lexNumber(): AspenToken {
    const startOffset = this.pos;
    const startLine = this.line;
    const startCol = this.col;
    let numStr = "";

    if (this.source[this.pos] === "-" || this.source[this.pos] === "+") {
      numStr += this.advance();
    }

    while (this.pos < this.len && this.isDigit(this.source[this.pos]!)) {
      numStr += this.advance();
    }

    if (this.pos < this.len && this.source[this.pos] === ".") {
      numStr += this.advance();
      while (this.pos < this.len && this.isDigit(this.source[this.pos]!)) {
        numStr += this.advance();
      }
    }

    // Exponent e/E
    if (this.pos < this.len && (this.source[this.pos] === "e" || this.source[this.pos] === "E")) {
      numStr += this.advance();
      if (this.pos < this.len && (this.source[this.pos] === "+" || this.source[this.pos] === "-")) {
        numStr += this.advance();
      }
      while (this.pos < this.len && this.isDigit(this.source[this.pos]!)) {
        numStr += this.advance();
      }
    }

    return {
      type: "NUMBER",
      value: numStr,
      startLine,
      startColumn: startCol,
      endLine: this.line,
      endColumn: this.col,
      startOffset,
      endOffset: this.pos,
    };
  }

  private lexIdent(): AspenToken {
    const startOffset = this.pos;
    const startLine = this.line;
    const startCol = this.col;
    let id = "";

    while (this.pos < this.len && this.isIdentPart(this.source[this.pos]!)) {
      id += this.advance();
    }

    return {
      type: "IDENT",
      value: id,
      startLine,
      startColumn: startCol,
      endLine: this.line,
      endColumn: this.col,
      startOffset,
      endOffset: this.pos,
    };
  }
}

export class AspenParser {
  private idx = 0;
  private tokens: AspenToken[];

  constructor(tokens: AspenToken[]) {
    this.tokens = tokens;
  }

  public parse(): AspenDeck {
    const deck: AspenDeck = {
      components: new Map(),
      flowsheet: [],
      streams: new Map(),
      blocks: new Map(),
    };

    while (!this.isAtEnd()) {
      this.skipNewlines();
      if (this.isAtEnd()) break;

      const tok = this.peek();
      const upper = tok.value.toUpperCase();

      if (upper === "TITLE") {
        this.advance();
        deck.title = this.consumeRestOfLineAsString();
      } else if (upper === "IN-UNITS") {
        this.advance();
        if (this.peek().type === "IDENT" || this.peek().type === "STRING") {
          deck.units = this.advance().value.toUpperCase();
        }
        this.skipToNextLine();
      } else if (upper === "DEF-STREAMS") {
        this.skipToNextLine();
      } else if (upper === "COMPONENTS") {
        this.advance();
        this.parseComponents(deck);
      } else if (upper === "FLOWSHEET") {
        this.advance();
        this.parseFlowsheet(deck);
      } else if (upper === "PROPERTIES") {
        this.advance();
        if (this.peek().type === "IDENT" || this.peek().type === "STRING") {
          deck.propertyMethod = this.advance().value.toUpperCase();
        }
        this.skipToNextLine();
      } else if (upper === "STREAM") {
        this.advance();
        this.parseStream(deck);
      } else if (upper === "BLOCK") {
        this.advance();
        this.parseBlock(deck);
      } else {
        // Unknown or unhandled section keyword, skip line
        this.skipToNextLine();
      }
    }

    if (this.tokens.length > 0) {
      deck.loc = {
        startLine: this.tokens[0]!.startLine,
        startColumn: this.tokens[0]!.startColumn,
        endLine: this.tokens[this.tokens.length - 1]!.endLine,
        endColumn: this.tokens[this.tokens.length - 1]!.endColumn,
        startOffset: this.tokens[0]!.startOffset,
        endOffset: this.tokens[this.tokens.length - 1]!.endOffset,
      };
    }

    return deck;
  }

  private parseComponents(deck: AspenDeck): void {
    this.skipNewlines();
    while (!this.isAtEnd() && !this.isSectionKeyword(this.peek().value)) {
      if (this.peek().type === "NEWLINE") {
        this.advance();
        continue;
      }
      const idTok = this.advance();
      const id = idTok.value.toUpperCase();
      let formula: string | undefined;
      const startLoc = this.makeLocation(idTok, idTok);

      if (this.peek().type === "IDENT" || this.peek().type === "STRING") {
        formula = this.advance().value;
      }

      const comp: AspenComponent = {
        id,
        formula,
        loc: startLoc,
      };
      deck.components.set(id, comp);
      this.skipToNextLine();
    }
  }

  private parseFlowsheet(deck: AspenDeck): void {
    this.skipNewlines();
    while (!this.isAtEnd()) {
      if (this.peek().type === "NEWLINE") {
        this.advance();
        continue;
      }
      const val = this.peek().value.toUpperCase();
      if (this.isSectionKeyword(val) && val !== "BLOCK") {
        break;
      }
      if (val === "BLOCK") {
        const nextNextTok = this.peek(2);
        const nextNextUpper = nextNextTok?.value.toUpperCase();
        if (
          nextNextUpper &&
          (nextNextUpper === "IN" || nextNextUpper === "IN=" || nextNextUpper === "OUT" || nextNextUpper === "OUT=")
        ) {
          const blockTok = this.advance();
          const blockIdTok = this.advance();
          const blockId = blockIdTok.value.toUpperCase();
          const inlets: string[] = [];
          const outlets: string[] = [];

          while (!this.isAtEnd() && this.peek().type !== "NEWLINE") {
            const upperVal = this.peek().value.toUpperCase();
            if (upperVal === "IN" || upperVal === "IN=") {
              this.advance();
              if (this.peek().type === "EQUALS") this.advance();
              while (
                !this.isAtEnd() &&
                this.peek().type !== "NEWLINE" &&
                this.peek().value.toUpperCase() !== "OUT" &&
                this.peek().value.toUpperCase() !== "OUT="
              ) {
                inlets.push(this.advance().value.toUpperCase());
              }
            } else if (upperVal === "OUT" || upperVal === "OUT=") {
              this.advance();
              if (this.peek().type === "EQUALS") this.advance();
              while (
                !this.isAtEnd() &&
                this.peek().type !== "NEWLINE" &&
                this.peek().value.toUpperCase() !== "IN" &&
                this.peek().value.toUpperCase() !== "IN="
              ) {
                outlets.push(this.advance().value.toUpperCase());
              }
            } else {
              this.advance();
            }
          }

          deck.flowsheet.push({
            blockId,
            inlets,
            outlets,
            loc: this.makeLocation(blockTok, this.peek(-1) ?? blockIdTok),
          });
          continue;
        } else {
          // Block definition begins
          break;
        }
      } else {
        break;
      }
    }
  }

  private parseStream(deck: AspenDeck): void {
    if (this.isAtEnd() || this.peek().type === "NEWLINE") return;
    const idTok = this.advance();
    const streamId = idTok.value.toUpperCase();
    const startTok = idTok;

    const stream: AspenStream = {
      id: streamId,
      moleFractions: new Map(),
      loc: this.makeLocation(startTok, idTok),
    };

    this.skipNewlines();

    while (!this.isAtEnd() && !this.isSectionKeyword(this.peek().value)) {
      if (this.peek().type === "NEWLINE") {
        this.advance();
        continue;
      }
      const tokVal = this.peek().value.toUpperCase();

      if (tokVal === "SUBSTREAM") {
        this.advance(); // SUBSTREAM
        if (this.peek().type === "IDENT") this.advance(); // MIXED
        while (!this.isAtEnd() && this.peek().type !== "NEWLINE") {
          const paramName = this.peek().value.toUpperCase();
          this.advance();
          if (this.peek().type === "EQUALS") this.advance();
          if (this.peek().type === "NUMBER") {
            const num = parseFloat(this.advance().value);
            if (paramName.startsWith("TEMP")) stream.temperature = num;
            else if (paramName.startsWith("PRES")) stream.pressure = num;
            else if (paramName.startsWith("MOLE-FLOW") || paramName.startsWith("FLOW")) stream.moleFlow = num;
            else if (paramName.startsWith("MASS-FLOW")) stream.massFlow = num;
          }
        }
      } else if (tokVal === "MOLE-FRAC" || tokVal === "MASS-FRAC" || tokVal === "MOLE-FLOW") {
        this.advance();
        while (!this.isAtEnd() && this.peek().type !== "NEWLINE") {
          if (this.peek().type === "SLASH" || this.peek().type === "EQUALS") {
            this.advance();
            continue;
          }
          if (this.peek().type === "IDENT") {
            const compId = this.advance().value.toUpperCase();
            if (this.peek().type === "EQUALS") this.advance();
            if (this.peek().type === "NUMBER") {
              const val = parseFloat(this.advance().value);
              stream.moleFractions.set(compId, val);
            }
          } else {
            this.advance();
          }
        }
      } else {
        this.skipToNextLine();
      }
    }

    stream.loc = this.makeLocation(startTok, this.peek(-1) ?? idTok);
    deck.streams.set(streamId, stream);
  }

  private parseBlock(deck: AspenDeck): void {
    if (this.isAtEnd() || this.peek().type === "NEWLINE") return;
    const idTok = this.advance();
    const blockId = idTok.value.toUpperCase();
    let blockType: AspenBlockType = "CUSTOM";

    if (this.peek().type === "IDENT") {
      const typeStr = this.advance().value.toUpperCase();
      if (this.isValidBlockType(typeStr)) {
        blockType = typeStr as AspenBlockType;
      }
    }

    const block: AspenBlock = {
      id: blockId,
      type: blockType,
      params: {},
      loc: this.makeLocation(idTok, idTok),
    };

    this.skipNewlines();

    while (!this.isAtEnd() && !this.isSectionKeyword(this.peek().value)) {
      if (this.peek().type === "NEWLINE") {
        this.advance();
        continue;
      }
      const tokVal = this.peek().value.toUpperCase();

      if (tokVal === "PARAM") {
        this.advance();
        while (!this.isAtEnd() && this.peek().type !== "NEWLINE") {
          const key = this.peek().value.toUpperCase();
          this.advance();
          if (this.peek().type === "EQUALS") this.advance();
          if (this.peek().type === "NUMBER") {
            const num = parseFloat(this.advance().value);
            block.params[key] = num;
            if (key === "NSTAGE" || key === "STAGES") block.nStages = num;
          } else if (this.peek().type === "IDENT" || this.peek().type === "STRING") {
            block.params[key] = this.advance().value;
          }
        }
      } else if (tokVal === "FEED") {
        this.advance();
        block.feedStages = block.feedStages ?? [];
        while (!this.isAtEnd() && this.peek().type !== "NEWLINE") {
          if (this.peek().type === "IDENT") {
            const stream = this.advance().value.toUpperCase();
            if (this.peek().type === "NUMBER") {
              const stage = parseInt(this.advance().value, 10);
              block.feedStages.push({ stream, stage });
            }
          } else {
            this.advance();
          }
        }
      } else if (tokVal === "PRODUCTS") {
        this.advance();
        block.products = block.products ?? [];
        while (!this.isAtEnd() && this.peek().type !== "NEWLINE") {
          if (this.peek().type === "SLASH") {
            this.advance();
            continue;
          }
          if (this.peek().type === "IDENT") {
            const stream = this.advance().value.toUpperCase();
            let stage = 1;
            let phase: "L" | "V" = "L";
            if (this.peek().type === "NUMBER") {
              stage = parseInt(this.advance().value, 10);
            }
            if (this.peek().type === "IDENT") {
              const ph = this.advance().value.toUpperCase();
              if (ph === "V" || ph === "VAP") phase = "V";
            }
            block.products.push({ stream, stage, phase });
          } else {
            this.advance();
          }
        }
      } else if (tokVal === "COL-SPECS") {
        this.advance();
        block.colSpecs = block.colSpecs ?? {};
        while (!this.isAtEnd() && this.peek().type !== "NEWLINE") {
          const specKey = this.peek().value.toUpperCase();
          this.advance();
          if (this.peek().type === "EQUALS") this.advance();
          if (this.peek().type === "NUMBER") {
            block.colSpecs[specKey] = parseFloat(this.advance().value);
          }
        }
      } else {
        this.skipToNextLine();
      }
    }

    block.loc = this.makeLocation(idTok, this.peek(-1) ?? idTok);
    deck.blocks.set(blockId, block);
  }

  private isValidBlockType(type: string): boolean {
    return [
      "FLASH2",
      "FLASH3",
      "RADFRAC",
      "HEATX",
      "HEATER",
      "PUMP",
      "COMPR",
      "VALVE",
      "RCSTR",
      "RSTOIC",
      "MIXER",
      "FSPLIT",
      "CUSTOM",
    ].includes(type);
  }

  private isSectionKeyword(val: string): boolean {
    const upper = val.toUpperCase();
    return (
      upper === "TITLE" ||
      upper === "IN-UNITS" ||
      upper === "COMPONENTS" ||
      upper === "FLOWSHEET" ||
      upper === "PROPERTIES" ||
      upper === "STREAM" ||
      upper === "BLOCK" ||
      upper === "DEF-STREAMS"
    );
  }

  private skipNewlines(): void {
    while (!this.isAtEnd() && this.peek().type === "NEWLINE") {
      this.advance();
    }
  }

  private skipToNextLine(): void {
    while (!this.isAtEnd() && this.peek().type !== "NEWLINE") {
      this.advance();
    }
    if (!this.isAtEnd() && this.peek().type === "NEWLINE") {
      this.advance();
    }
  }

  private consumeRestOfLineAsString(): string {
    let result = "";
    while (!this.isAtEnd() && this.peek().type !== "NEWLINE") {
      if (result.length > 0) result += " ";
      result += this.advance().value;
    }
    this.skipNewlines();
    return result;
  }

  private peek(offset = 0): AspenToken {
    const idx = this.idx + offset;
    if (idx < 0) return this.tokens[0]!;
    if (idx >= this.tokens.length) return this.tokens[this.tokens.length - 1]!;
    return this.tokens[idx]!;
  }

  private advance(): AspenToken {
    const tok = this.peek();
    if (!this.isAtEnd()) this.idx++;
    return tok;
  }

  private isAtEnd(): boolean {
    return this.idx >= this.tokens.length || this.tokens[this.idx]!.type === "EOF";
  }

  private makeLocation(startTok: AspenToken, endTok: AspenToken): SourceLocation {
    return {
      startLine: startTok.startLine,
      startColumn: startTok.startColumn,
      endLine: endTok.endLine,
      endColumn: endTok.endColumn,
      startOffset: startTok.startOffset,
      endOffset: endTok.endOffset,
    };
  }
}

export function parseAspen(sourceText: string): AspenDeck {
  const lexer = new AspenLexer(sourceText);
  const tokens = lexer.tokenize();
  const parser = new AspenParser(tokens);
  return parser.parse();
}

export function serializeAspen(deck: AspenDeck): string {
  const lines: string[] = [];

  if (deck.title) {
    lines.push(`TITLE '${deck.title}'`);
  }
  if (deck.units) {
    lines.push(`IN-UNITS ${deck.units}`);
  }
  lines.push("DEF-STREAMS CONV ALL\n");

  if (deck.components.size > 0) {
    lines.push("COMPONENTS");
    for (const [id, comp] of deck.components) {
      lines.push(`    ${id.padEnd(10, " ")} ${comp.formula ?? id}`);
    }
    lines.push("");
  }

  if (deck.flowsheet.length > 0) {
    lines.push("FLOWSHEET");
    for (const entry of deck.flowsheet) {
      let line = `    BLOCK ${entry.blockId.padEnd(8, " ")}`;
      if (entry.inlets.length > 0) line += ` IN=${entry.inlets.join(" ")}`;
      if (entry.outlets.length > 0) line += ` OUT=${entry.outlets.join(" ")}`;
      lines.push(line);
    }
    lines.push("");
  }

  if (deck.propertyMethod) {
    lines.push(`PROPERTIES ${deck.propertyMethod}\n`);
  }

  for (const [id, stream] of deck.streams) {
    lines.push(`STREAM ${id}`);
    const substreamParts: string[] = ["SUBSTREAM MIXED"];
    if (stream.temperature != null) substreamParts.push(`TEMP=${stream.temperature}`);
    if (stream.pressure != null) substreamParts.push(`PRES=${stream.pressure}`);
    if (stream.moleFlow != null) substreamParts.push(`MOLE-FLOW=${stream.moleFlow}`);
    else if (stream.massFlow != null) substreamParts.push(`MASS-FLOW=${stream.massFlow}`);
    lines.push(`    ${substreamParts.join(" ")}`);

    if (stream.moleFractions.size > 0) {
      const fracParts: string[] = [];
      for (const [cId, frac] of stream.moleFractions) {
        fracParts.push(`${cId} ${frac}`);
      }
      lines.push(`    MOLE-FRAC ${fracParts.join(" / ")}`);
    }
    lines.push("");
  }

  for (const [id, block] of deck.blocks) {
    lines.push(`BLOCK ${id} ${block.type}`);
    const paramEntries = Object.entries(block.params);
    if (paramEntries.length > 0) {
      const pStr = paramEntries.map(([k, v]) => `${k}=${v}`).join(" ");
      lines.push(`    PARAM ${pStr}`);
    }
    if (block.feedStages && block.feedStages.length > 0) {
      const fStr = block.feedStages.map((f) => `${f.stream} ${f.stage}`).join(" ");
      lines.push(`    FEED ${fStr}`);
    }
    if (block.products && block.products.length > 0) {
      const pStr = block.products.map((p) => `${p.stream} ${p.stage} ${p.phase}`).join(" / ");
      lines.push(`    PRODUCTS ${pStr}`);
    }
    if (block.colSpecs) {
      const cStr = Object.entries(block.colSpecs)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      lines.push(`    COL-SPECS ${cStr}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Lexer for GAMS (.gms, .gams, .inc) source files.
 *
 * Handles column-1 `*` comments, `$ontext`/`$offtext` block comments, `$title` directives,
 * GAMS relational operators (`=e=`, `=l=`, `=g=`, `=n=`), `..`, `$` dollar conditionals,
 * strings, numbers, and identifiers.
 */

export type GamsTokenKind =
  | "ident"
  | "number"
  | "string"
  | "relop" // =e= =l= =g= =n=
  | "dotdot" // ..
  | "op" // + - * / ** ^ = < <= > >= <> != $ . , ; : ( ) [ ]
  | "slash" // /
  | "newline"
  | "eof";

export interface GamsToken {
  kind: GamsTokenKind;
  text: string;
  line: number; // 1-indexed
  column: number; // 1-indexed
  offset: number;
  endOffset: number;
}

export interface GamsLexResult {
  tokens: GamsToken[];
  title?: string | undefined;
}

/**
 * Tokenizes GAMS source text while preserving line/column coordinates for diagnostics and table parsing.
 */
export function lexGams(source: string): GamsLexResult {
  const tokens: GamsToken[] = [];
  let title: string | undefined;
  let pos = 0;
  let line = 1;
  let col = 1;
  const len = source.length;
  let inOnText = false;
  let eolComment: string | null = null;

  const advance = (): string => {
    const ch = source[pos++] ?? "";
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  };

  while (pos < len) {
    // Handle $ontext ... $offtext block comments
    if (inOnText) {
      if (col === 1 && source.slice(pos, pos + 8).toLowerCase() === "$offtext") {
        while (pos < len && source[pos] !== "\n") advance();
        inOnText = false;
        continue;
      }
      advance();
      continue;
    }

    // Column-1 `*` line comment
    if (col === 1 && source[pos] === "*") {
      while (pos < len && source[pos] !== "\n") advance();
      continue;
    }

    // Column-1 `$` compiler directives ($ontext, $title, $eolcom, etc.)
    if (col === 1 && source[pos] === "$") {
      const rest = source.slice(pos);
      const lineEndIdx = rest.indexOf("\n");
      const directiveLine = lineEndIdx >= 0 ? rest.slice(0, lineEndIdx) : rest;
      const lowerDir = directiveLine.trim().toLowerCase();
      if (lowerDir.startsWith("$ontext")) {
        inOnText = true;
      } else if (lowerDir.startsWith("$title")) {
        title = directiveLine
          .trim()
          .slice(6)
          .trim()
          .replace(/^["']|["']$/g, "");
      } else if (lowerDir.startsWith("$eolcom")) {
        const sym = directiveLine.trim().slice(7).trim();
        if (sym.length > 0) eolComment = sym;
      }
      while (pos < len && source[pos] !== "\n") advance();
      continue;
    }

    // Optional $eolcom end-of-line comment
    if (eolComment && source.startsWith(eolComment, pos)) {
      while (pos < len && source[pos] !== "\n") advance();
      continue;
    }

    const ch = source[pos]!;

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r") {
      advance();
      continue;
    }

    // Newline (significant for table parsing and unquoted descriptions)
    if (ch === "\n") {
      const startLine = line;
      const startCol = col;
      const startOff = pos;
      advance();
      tokens.push({
        kind: "newline",
        text: "\n",
        line: startLine,
        column: startCol,
        offset: startOff,
        endOffset: pos,
      });
      continue;
    }

    const startLine = line;
    const startCol = col;
    const startOff = pos;

    // String literals ('...' or "...")
    if (ch === "'" || ch === '"') {
      const quote = ch;
      advance();
      let val = "";
      while (pos < len) {
        const c = source[pos]!;
        if (c === quote) {
          advance();
          // Doubled quote escape
          if (pos < len && source[pos] === quote) {
            val += quote;
            advance();
          } else {
            break;
          }
        } else if (c === "\n") {
          break;
        } else {
          val += c;
          advance();
        }
      }
      tokens.push({
        kind: "string",
        text: val,
        line: startLine,
        column: startCol,
        offset: startOff,
        endOffset: pos,
      });
      continue;
    }

    // Numbers (integer, decimal, scientific notation)
    if (
      (ch >= "0" && ch <= "9") ||
      (ch === "." && pos + 1 < len && source[pos + 1]! >= "0" && source[pos + 1]! <= "9")
    ) {
      let numText = "";
      while (pos < len && source[pos]! >= "0" && source[pos]! <= "9") {
        numText += advance();
      }
      if (pos < len && source[pos] === "." && source[pos + 1] !== ".") {
        numText += advance();
        while (pos < len && source[pos]! >= "0" && source[pos]! <= "9") {
          numText += advance();
        }
      }
      if (pos < len && (source[pos] === "e" || source[pos] === "E")) {
        const nextCh = source[pos + 1];
        const nextNext = source[pos + 2];
        if (
          (nextCh && nextCh >= "0" && nextCh <= "9") ||
          ((nextCh === "+" || nextCh === "-") && nextNext && nextNext >= "0" && nextNext <= "9")
        ) {
          numText += advance();
          if (source[pos] === "+" || source[pos] === "-") numText += advance();
          while (pos < len && source[pos]! >= "0" && source[pos]! <= "9") {
            numText += advance();
          }
        }
      }
      tokens.push({
        kind: "number",
        text: numText,
        line: startLine,
        column: startCol,
        offset: startOff,
        endOffset: pos,
      });
      continue;
    }

    // GAMS equation relational operators: =e=, =l=, =g=, =n=
    if (ch === "=" && pos + 2 < len && source[pos + 2] === "=") {
      const mid = source[pos + 1]!.toLowerCase();
      if (mid === "e" || mid === "l" || mid === "g" || mid === "n") {
        const text = `=${mid}=`;
        advance();
        advance();
        advance();
        tokens.push({
          kind: "relop",
          text,
          line: startLine,
          column: startCol,
          offset: startOff,
          endOffset: pos,
        });
        continue;
      }
    }

    // Double-dot `..`
    if (ch === "." && pos + 1 < len && source[pos + 1] === ".") {
      advance();
      advance();
      tokens.push({
        kind: "dotdot",
        text: "..",
        line: startLine,
        column: startCol,
        offset: startOff,
        endOffset: pos,
      });
      continue;
    }

    // Two-char operators: **, <=, >=, <>, !=, ==
    if (pos + 1 < len) {
      const two = source.slice(pos, pos + 2);
      if (two === "**" || two === "<=" || two === ">=" || two === "<>" || two === "!=" || two === "==") {
        advance();
        advance();
        tokens.push({
          kind: "op",
          text: two,
          line: startLine,
          column: startCol,
          offset: startOff,
          endOffset: pos,
        });
        continue;
      }
    }

    // Slash `/`
    if (ch === "/") {
      advance();
      tokens.push({
        kind: "slash",
        text: "/",
        line: startLine,
        column: startCol,
        offset: startOff,
        endOffset: pos,
      });
      continue;
    }

    // Identifiers (including letters, digits, underscores)
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      let id = "";
      while (
        pos < len &&
        ((source[pos]! >= "a" && source[pos]! <= "z") ||
          (source[pos]! >= "A" && source[pos]! <= "Z") ||
          (source[pos]! >= "0" && source[pos]! <= "9") ||
          source[pos] === "_")
      ) {
        id += advance();
      }
      tokens.push({
        kind: "ident",
        text: id,
        line: startLine,
        column: startCol,
        offset: startOff,
        endOffset: pos,
      });
      continue;
    }

    // Single-character operators and punctuation
    advance();
    tokens.push({
      kind: "op",
      text: ch,
      line: startLine,
      column: startCol,
      offset: startOff,
      endOffset: pos,
    });
  }

  tokens.push({
    kind: "eof",
    text: "",
    line,
    column: col,
    offset: pos,
    endOffset: pos,
  });

  return { tokens, title };
}

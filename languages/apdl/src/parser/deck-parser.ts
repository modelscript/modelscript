// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ApdlParsedDeck, ApdlProcessor, ApdlStatement, ApdlSyntaxError } from "../types.js";

/**
 * Strips trailing `!` comments outside of single/double-quoted strings.
 */
function stripApdlComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === "!" && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Splits a comment-stripped APDL line on `$` command separators outside of quotes and parentheses.
 */
function splitDollarCommands(line: string): Array<{ text: string; colOffset: number }> {
  const parts: Array<{ text: string; colOffset: number }> = [];
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  let start = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === "(") depth++;
      else if (ch === ")" && depth > 0) depth--;
      else if (ch === "$" && depth === 0) {
        parts.push({ text: line.slice(start, i), colOffset: start });
        start = i + 1;
      }
    }
  }
  parts.push({ text: line.slice(start), colOffset: start });
  return parts;
}

/**
 * Splits comma-separated APDL fields while respecting parentheses and quotes.
 */
export function splitApdlFields(text: string): string[] {
  const fields: string[] = [];
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === "(") depth++;
      else if (ch === ")" && depth > 0) depth--;
      else if (ch === "," && depth === 0) {
        fields.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  fields.push(text.slice(start).trim());
  return fields;
}

function checkBalancedDelimiters(text: string, line: number, col: number, errors: ApdlSyntaxError[]): void {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth < 0) {
          errors.push({
            line,
            column: col + i,
            endLine: line,
            endColumn: col + i + 1,
            message: "Unexpected closing parenthesis ')'",
          });
          return;
        }
      }
    }
  }
  if (inSingle || inDouble) {
    errors.push({
      line,
      column: col,
      endLine: line,
      endColumn: col + text.length,
      message: "Unterminated string literal",
    });
  } else if (depth !== 0) {
    errors.push({
      line,
      column: col,
      endLine: line,
      endColumn: col + text.length,
      message: "Unbalanced parentheses in APDL statement",
    });
  }
}

const PROCESSOR_MAP: Record<string, ApdlProcessor> = {
  "/PREP7": "PREP7",
  "/SOLU": "SOLU",
  "/POST1": "POST1",
  "/POST26": "POST26",
  FINISH: "BEGIN",
  FINI: "BEGIN",
};

/**
 * Parses an ANSYS APDL script into a structured `ApdlParsedDeck`.
 */
export function parseApdl(source: string): ApdlParsedDeck {
  const lines = source.split(/\r?\n/);
  const statements: ApdlStatement[] = [];
  const syntaxErrors: ApdlSyntaxError[] = [];
  let title = "Untitled APDL Model";
  let units = "SI";

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const rawLine = lines[idx] ?? "";
    const noComment = stripApdlComment(rawLine);
    if (!noComment.trim()) continue;

    const segments = splitDollarCommands(noComment);
    for (const seg of segments) {
      const trimmed = seg.text.trim();
      if (!trimmed) continue;

      const leadingWs = seg.text.length - seg.text.trimStart().length;
      const col = seg.colOffset + leadingWs + 1;

      checkBalancedDelimiters(trimmed, lineNum, col, syntaxErrors);

      // Handle /TITLE specially so commas in the title text are preserved
      if (/^\/TITLE\b/i.test(trimmed)) {
        const commaIdx = trimmed.indexOf(",");
        const titleText = commaIdx >= 0 ? trimmed.slice(commaIdx + 1).trim() : trimmed.slice(6).trim();
        title = titleText || title;
        statements.push({
          kind: "title",
          title,
          line: lineNum,
          column: col,
          raw: trimmed,
        });
        continue;
      }

      // Check for assignment: `name = expr` or `arr(i) = expr` (must not start with `/` or `*`)
      if (!trimmed.startsWith("/") && !trimmed.startsWith("*")) {
        const assignMatch = /^([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]+)\))?\s*=\s*(.*)$/.exec(trimmed);
        if (assignMatch) {
          const name = (assignMatch[1] ?? "").toUpperCase();
          const indexExpr = assignMatch[2]?.trim();
          const expr = (assignMatch[3] ?? "").trim();
          if (!expr) {
            syntaxErrors.push({
              line: lineNum,
              column: col,
              endLine: lineNum,
              endColumn: col + trimmed.length,
              message: `Missing right-hand side expression in assignment to '${name}'`,
            });
          } else {
            statements.push({
              kind: "set",
              name,
              indexExpr,
              expr,
              line: lineNum,
              column: col,
              raw: trimmed,
            });
          }
          continue;
        }
      }

      const fields = splitApdlFields(trimmed);
      const head = (fields[0] ?? "").toUpperCase();
      const args = fields.slice(1);

      if (!head || !/^([/*]?[A-Za-z_][A-Za-z0-9_]*)$/.test(head)) {
        syntaxErrors.push({
          line: lineNum,
          column: col,
          endLine: lineNum,
          endColumn: col + trimmed.length,
          message: `Invalid APDL command token '${fields[0] ?? trimmed}'`,
        });
        continue;
      }

      // Processor switch commands
      const mappedProc = PROCESSOR_MAP[head];
      if (mappedProc) {
        statements.push({
          kind: "processor",
          processor: mappedProc,
          command: head,
          args,
          line: lineNum,
          column: col,
          raw: trimmed,
        });
        continue;
      }

      if (head === "/UNITS") {
        units = (args[0] ?? "SI").toUpperCase();
        statements.push({
          kind: "units",
          system: units,
          line: lineNum,
          column: col,
          raw: trimmed,
        });
        continue;
      }

      // Macro commands
      if (head === "*SET") {
        const rawTarget = (args[0] ?? "").trim();
        const expr = (args[1] ?? "").trim();
        const targetMatch = /^([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]+)\))?$/.exec(rawTarget);
        if (!targetMatch || !expr) {
          syntaxErrors.push({
            line: lineNum,
            column: col,
            endLine: lineNum,
            endColumn: col + trimmed.length,
            message: "Malformed '*SET' command; expected '*SET, name, value'",
          });
        } else {
          statements.push({
            kind: "set",
            name: (targetMatch[1] ?? "").toUpperCase(),
            indexExpr: targetMatch[2]?.trim(),
            expr,
            line: lineNum,
            column: col,
            raw: trimmed,
          });
        }
        continue;
      }

      if (head === "*DIM") {
        const name = (args[0] ?? "").toUpperCase();
        const arrayType = (args[1] ?? "ARRAY").toUpperCase();
        const imax = args[2] ?? "1";
        if (!name) {
          syntaxErrors.push({
            line: lineNum,
            column: col,
            endLine: lineNum,
            endColumn: col + trimmed.length,
            message: "Malformed '*DIM' command; missing array name",
          });
        } else {
          statements.push({
            kind: "dim",
            name,
            arrayType,
            imax,
            jmax: args[3] || undefined,
            kmax: args[4] || undefined,
            line: lineNum,
            column: col,
            raw: trimmed,
          });
        }
        continue;
      }

      if (head === "*DO") {
        const variable = (args[0] ?? "").toUpperCase();
        const startExpr = args[1] ?? "";
        const endExpr = args[2] ?? "";
        const incExpr = args[3] || "1";
        if (!variable || !startExpr || !endExpr) {
          syntaxErrors.push({
            line: lineNum,
            column: col,
            endLine: lineNum,
            endColumn: col + trimmed.length,
            message: "Malformed '*DO' command; expected '*DO, var, start, end[, inc]'",
          });
        } else {
          statements.push({
            kind: "do_start",
            variable,
            startExpr,
            endExpr,
            incExpr,
            line: lineNum,
            column: col,
            raw: trimmed,
          });
        }
        continue;
      }

      if (head === "*ENDDO") {
        statements.push({ kind: "enddo", line: lineNum, column: col, raw: trimmed });
        continue;
      }

      if (head === "*IF") {
        const lhsExpr = args[0] ?? "";
        const operator = (args[1] ?? "").toUpperCase();
        const rhsExpr = args[2] ?? "";
        const action = (args[3] ?? "").toUpperCase();
        const inlineCommand = action !== "THEN" && args.length >= 4 ? args.slice(3).join(", ") : undefined;
        if (!lhsExpr || !operator || !rhsExpr || !action) {
          syntaxErrors.push({
            line: lineNum,
            column: col,
            endLine: lineNum,
            endColumn: col + trimmed.length,
            message: "Malformed '*IF' command; expected '*IF, lhs, op, rhs, THEN'",
          });
        } else {
          statements.push({
            kind: "if_start",
            lhsExpr,
            operator,
            rhsExpr,
            action,
            inlineCommand,
            line: lineNum,
            column: col,
            raw: trimmed,
          });
        }
        continue;
      }

      if (head === "*ELSEIF") {
        const lhsExpr = args[0] ?? "";
        const operator = (args[1] ?? "").toUpperCase();
        const rhsExpr = args[2] ?? "";
        statements.push({
          kind: "elseif",
          lhsExpr,
          operator,
          rhsExpr,
          line: lineNum,
          column: col,
          raw: trimmed,
        });
        continue;
      }

      if (head === "*ELSE") {
        statements.push({ kind: "else", line: lineNum, column: col, raw: trimmed });
        continue;
      }

      if (head === "*ENDIF") {
        statements.push({ kind: "endif", line: lineNum, column: col, raw: trimmed });
        continue;
      }

      if (head === "*GET") {
        statements.push({
          kind: "get",
          param: (args[0] ?? "").toUpperCase(),
          entity: (args[1] ?? "").toUpperCase(),
          entnum: args[2] ?? "0",
          item1: (args[3] ?? "").toUpperCase(),
          it1num: (args[4] ?? "").toUpperCase(),
          item2: args[5]?.toUpperCase() || undefined,
          it2num: args[6]?.toUpperCase() || undefined,
          line: lineNum,
          column: col,
          raw: trimmed,
        });
        continue;
      }

      // General APDL command
      statements.push({
        kind: "command",
        command: head,
        args,
        line: lineNum,
        column: col,
        raw: trimmed,
      });
    }
  }

  return {
    title,
    units,
    statements,
    syntaxErrors,
    rawText: source,
  };
}

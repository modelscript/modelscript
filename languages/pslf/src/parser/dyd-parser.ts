// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * GE PSLF Dynamic Data (.dyd) Parser.
 */

import type { PslfDydCase, PslfDynamicModel } from "../types.js";

/**
 * Parses a GE PSLF .dyd dynamic model data file.
 */
export function parsePslfDyd(content: string): PslfDydCase {
  const models: PslfDynamicModel[] = [];
  const lines = content.split(/\r?\n/);

  let currentBlock = "";
  let currentComment: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!.trim();
    if (rawLine.length === 0) continue;

    // Comment line
    if (rawLine.startsWith("#") || rawLine.startsWith("//") || rawLine.startsWith("c ")) {
      currentComment = rawLine.replace(/^[#//c\s]+/, "").trim();
      continue;
    }

    // Check if line continues previous statement
    if (currentBlock.length > 0) {
      currentBlock += " " + rawLine;
    } else {
      currentBlock = rawLine;
    }

    // Check if complete statement: has colon ':' and parameters
    // In DYD, statements usually end with a newline unless they have a trailing backslash or continuation
    // But parameters may span multiple lines if counts don't match.
    // Check if next non-empty line starts with a new model keyword (lowercase letters at start of line)
    let nextIsNewModel = false;
    for (let nextIdx = i + 1; nextIdx < lines.length; nextIdx++) {
      const nextLine = lines[nextIdx]!.trim();
      if (nextLine.length === 0 || nextLine.startsWith("#") || nextLine.startsWith("//")) continue;
      // If line contains ':' or begins with a known model name pattern
      if (/^[a-zA-Z][a-zA-Z0-9_]*\s+\d+/.test(nextLine)) {
        nextIsNewModel = true;
      }
      break;
    }

    if (nextIsNewModel) {
      // Parse statement
      const parsedModel = parseDydStatement(currentBlock, currentComment);
      if (parsedModel) {
        models.push(parsedModel);
      }
      currentBlock = "";
      currentComment = undefined;
    }
  }

  // Flush any trailing statement
  if (currentBlock.trim().length > 0) {
    const parsedModel = parseDydStatement(currentBlock, currentComment);
    if (parsedModel) {
      models.push(parsedModel);
    }
  }

  return { models };
}

/**
 * Parses a single complete DYD statement.
 * Example: `gencls 101 "1" 13.80 : #9 0.0 5.0 0.0 0.20 0.0 0.0 0.0 0.0`
 */
function parseDydStatement(statement: string, comment?: string): PslfDynamicModel | null {
  const colonIdx = statement.indexOf(":");
  if (colonIdx < 0) return null;

  const headerPart = statement.slice(0, colonIdx).trim();
  const paramPart = statement.slice(colonIdx + 1).trim();

  // Parse header: <modelType> <busNumber> ["<id>"] [<baseKv>]
  const headerTokens = headerPart.split(/\s+/);
  if (headerTokens.length < 2) return null;

  const modelType = headerTokens[0]!.toLowerCase();
  const busNumber = parseInt(headerTokens[1]!, 10);
  let id = "1";
  let baseKv = 0.0;

  for (let idx = 2; idx < headerTokens.length; idx++) {
    const t = headerTokens[idx]!;
    if (t.startsWith('"') || t.startsWith("'")) {
      id = t.replace(/['"]/g, "");
    } else if (!isNaN(parseFloat(t))) {
      baseKv = parseFloat(t);
    }
  }

  // Parse params after colon
  const rawParams = paramPart.split(/\s+/);
  const params: number[] = [];

  for (const token of rawParams) {
    if (token.startsWith("#") || token.trim().length === 0) {
      // Skip parameter count prefix e.g. #9 or #12
      continue;
    }
    const val = parseFloat(token);
    if (!isNaN(val)) {
      params.push(val);
    }
  }

  return {
    modelType,
    busNumber,
    id,
    baseKv,
    params,
    comment,
  };
}

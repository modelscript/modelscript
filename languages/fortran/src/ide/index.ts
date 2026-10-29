// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fortran — IDE, Monaco Editor & TextMate Grammar Services.
 *
 * Provides:
 * - TextMate grammar definition (`.tmLanguage.json`) for VS Code and text editor highlighters.
 * - Monaco Monarch tokens provider for browser-based IDEs and playgrounds.
 * - Language configuration (bracket matching, auto-closing pairs, comment tokens, folding markers).
 */

import { generateTextMate } from "@modelscript/dsl";
import { fortranLanguage } from "../language.js";

/**
 * Returns the generated TextMate grammar object (plus raw `tm` and `monarch` JSON strings) for Fortran.
 */
export function getFortranTextMateGrammar(): {
  scopeName: string;
  name: string;
  patterns: unknown[];
  repository: Record<string, unknown>;
  tm: string;
  monarch: string;
} {
  const { tm, monarch } = generateTextMate(fortranLanguage);
  const parsed = JSON.parse(tm) as {
    scopeName: string;
    name: string;
    patterns: unknown[];
    repository: Record<string, unknown>;
  };
  return {
    ...parsed,
    tm,
    monarch,
  };
}

/**
 * Returns the parsed Monaco Monarch tokenizer object for Fortran.
 */
export function getFortranMonarchDefinition(): Record<string, unknown> {
  const { monarch } = generateTextMate(fortranLanguage);
  return JSON.parse(monarch) as Record<string, unknown>;
}

/**
 * Returns the standard VS Code / Monaco language configuration for Fortran source files.
 */
export function getFortranLanguageConfiguration(): Record<string, unknown> {
  return {
    comments: {
      lineComment: "!",
    },
    brackets: [
      ["(", ")"],
      ["[", "]"],
    ],
    autoClosingPairs: [
      { open: "(", close: ")" },
      { open: "[", close: "]" },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "'", close: "'", notIn: ["string", "comment"] },
    ],
    surroundingPairs: [
      ["(", ")"],
      ["[", "]"],
      ['"', '"'],
      ["'", "'"],
    ],
    folding: {
      markers: {
        start: "^\\s*(?:subroutine|function|program|module|if\\b.*\\bthen|do)\\b",
        end: "^\\s*end(?:\\s+(?:subroutine|function|program|module|if|do))?\\b",
      },
    },
    wordPattern: /(-?\d*\.\d\w*)|([^`~!@#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g,
    indentationRules: {
      increaseIndentPattern: /^\s*(?:subroutine|function|program|module|if\b.*\bthen|else|elseif|do)\b/i,
      decreaseIndentPattern:
        /^\s*(?:end(?:\s+(?:subroutine|function|program|module|if|do))?|else|elseif|endif|enddo)\b/i,
    },
  };
}

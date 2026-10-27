// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/c — IDE, Monaco Editor & TextMate Grammar Services.
 *
 * Provides:
 * - TextMate grammar definition (`.tmLanguage.json`) for VS Code and text editor highlighters.
 * - Monaco Monarch tokens provider for browser-based IDEs and playgrounds.
 * - Language configuration (bracket matching, auto-closing pairs, comment tokens, folding markers).
 */

import { generateTextMate } from "@modelscript/dsl";
import { cLanguage } from "../language.js";

/**
 * Returns the generated TextMate JSON grammar string and Monaco Monarch specification for C99 / ANSI C.
 */
export function getCTextMateGrammar(): { tm: string; monarch: string } {
  return generateTextMate(cLanguage);
}

/**
 * Returns the parsed Monaco Monarch tokenizer object for C.
 */
export function getCMonarchDefinition(): Record<string, unknown> {
  const { monarch } = getCTextMateGrammar();
  return JSON.parse(monarch) as Record<string, unknown>;
}

/**
 * Returns the standard VS Code / Monaco language configuration for C source files and headers.
 */
export function getCLanguageConfiguration(): Record<string, unknown> {
  return {
    comments: {
      lineComment: "//",
      blockComment: ["/*", "*/"],
    },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] },
      { open: "'", close: "'", notIn: ["string", "comment"] },
    ],
    surroundingPairs: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
      ['"', '"'],
      ["'", "'"],
    ],
    folding: {
      markers: {
        start: "^\\s*(?:#pragma\\s+region|//\\s*#?region)\\b",
        end: "^\\s*(?:#pragma\\s+endregion|//\\s*#?endregion)\\b",
      },
    },
    wordPattern: /(-?\d*\.\d\w*)|([^`~!@#%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g,
    indentationRules: {
      increaseIndentPattern: /^.*\{[^}"']*$/,
      decreaseIndentPattern: /^(.*\*\/)?\s*\}[;\s]*$/,
    },
  };
}

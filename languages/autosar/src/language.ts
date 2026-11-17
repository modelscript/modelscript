// SPDX-License-Identifier: AGPL-3.0-or-later

import { language, xmlRules } from "@modelscript/dsl";
import { indexAutosarDocument } from "./indexing.js";
import { autosarPolyglotConfig } from "./tgg/index.js";

/**
 * DSL language specification for AUTOSAR Classic and Adaptive XML files (.arxml).
 */
export const autosarLanguage = language({
  polyglot: autosarPolyglotConfig,
  name: "autosar",
  fileExtensions: [".arxml"],
  maturity: "experimental",
  indexing: {
    indexFile: indexAutosarDocument,
  },
  lsp: {
    fileExtensions: [".arxml"],
    folding: ["Element", { rule: "COMMENT", kind: "comment", defaultCollapsed: true }],
    outline: ["Element"],
  },
  extras: ($) => [/[ \t\r\n]+/, $["COMMENT"]!, $["PROCESSING_INSTRUCTION"]!],
  rules: xmlRules,
});

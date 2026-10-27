// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, language, repeat, seq } from "@modelscript/dsl";

/**
 * DSL language specification for AUTOSAR Classic and Adaptive XML files (.arxml).
 */
export const autosarLanguage = language({
  name: "autosar",
  fileExtensions: [".arxml"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".arxml"],
  },

  rules: {
    Document: ($) => repeat(choice($.XmlElement, $.Comment)),

    XmlElement: ($) =>
      seq(
        "<",
        $.TagName,
        repeat($.Attribute),
        choice("/>", seq(">", repeat(choice($.XmlElement, $.TextContent, $.Comment)), "</", $.TagName, ">")),
      ),

    Attribute: ($) => seq($.AttributeName, "=", $.StringLiteral),

    TagName: () => /[A-Za-z_][A-Za-z0-9_-]*/,
    AttributeName: () => /[A-Za-z_][A-Za-z0-9_:-]*/,
    TextContent: () => /[^<]+/,
    StringLiteral: () => /"[^"]*"|'[^']*'/,
    Comment: () => /<!--[\s\S]*?-->/,
  },
});

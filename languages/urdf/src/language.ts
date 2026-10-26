// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, language, repeat, seq } from "@modelscript/dsl";

/**
 * DSL language specification for ROS URDF, SDFormat, and Xacro files (.urdf, .sdf, .xacro).
 */
export const urdfLanguage = language({
  name: "urdf",
  fileExtensions: [".urdf", ".sdf", ".xacro"],
  lsp: {
    fileExtensions: [".urdf", ".sdf", ".xacro"],
  },

  rules: {
    Document: ($) => repeat(choice($.Element, $.Comment)),

    Element: ($) =>
      seq(
        "<",
        $.TagIdentifier,
        repeat($.Attribute),
        choice("/>", seq(">", repeat(choice($.Element, $.TextContent, $.Comment)), "</", $.TagIdentifier, ">")),
      ),

    Attribute: ($) => seq($.AttrIdentifier, "=", $.StringLiteral),

    TagIdentifier: () => /[A-Za-z_:][A-Za-z0-9_:-]*/,
    AttrIdentifier: () => /[A-Za-z_:][A-Za-z0-9_:-]*/,
    StringLiteral: () => /"[^"]*"|'[^']*'/,
    TextContent: () => /[^<]+/,
    Comment: () => /<!--[\s\S]*?-->/,
  },
});

export default urdfLanguage;

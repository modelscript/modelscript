// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, repeat, seq } from "@modelscript/dsl";

/**
 * DSL language specification for MATLAB Simulink models (.slx, .mdl).
 */
export const simulinkLanguage = language({
  name: "simulink",
  fileExtensions: [".slx", ".mdl"],
  lsp: {
    fileExtensions: [".slx", ".mdl"],
  },

  rules: {
    Model: ($) => repeat(choice($.BlockStatement, $.LineStatement, $.SystemStatement, $.Comment)),

    SystemStatement: ($) =>
      seq(choice("System", "system"), "{", repeat(choice($.BlockStatement, $.LineStatement, $.PropertyAssign)), "}"),

    BlockStatement: ($) =>
      seq(choice("Block", "block"), "{", repeat(choice($.PropertyAssign, $.BlockStatement, $.LineStatement)), "}"),

    LineStatement: ($) => seq(choice("Line", "line"), "{", repeat(choice($.PropertyAssign, $.BranchStatement)), "}"),

    BranchStatement: ($) => seq(choice("Branch", "branch"), "{", repeat($.PropertyAssign), "}"),

    PropertyAssign: ($) =>
      seq(field("key", $.Identifier), field("value", choice($.StringLiteral, $.NumberLiteral, $.Identifier))),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"/,
    NumberLiteral: () => /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
    Comment: () => choice(/\/\/[^\n]*/, /#[^\n]*/),
  },
});

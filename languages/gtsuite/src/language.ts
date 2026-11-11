// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, optional, repeat, seq } from "@modelscript/dsl";
import { GtSuiteErrorCode } from "./lints/index.js";
import { parseGtmModel } from "./parser/gtm-parser.js";

/**
 * DSL language specification for Gamma Technologies GT-SUITE (.gtm, .gtd, .gtx, .gt).
 */
export const gtsuiteLanguage = language({
  name: "gtsuite",
  fileExtensions: [".gtm", ".gtd", ".gtx", ".gt"],
  maturity: "experimental",
  lsp: {
    fileExtensions: [".gtm", ".gtd", ".gtx", ".gt"],
  },
  indexing: {
    indexFile(ctx) {
      const model = parseGtmModel(ctx.text);
      ctx.setParsedModel(model);

      const modelRootId = ctx.addSymbol(model.name, "Package", null, 0, ctx.text.length, undefined, {
        ruleName: "component",
        namePath: "name",
      });

      for (const comp of model.components) {
        const label = `${comp.id} [${comp.kind}]`;
        ctx.addSymbol(
          label,
          "Class",
          modelRootId,
          0,
          0,
          { id: comp.id, kind: comp.kind },
          {
            ruleName: "component",
            namePath: "name",
            aliases: [comp.id],
          },
        );
      }
    },
  },

  errorCodes: GtSuiteErrorCode,

  rules: {
    Model: ($) =>
      seq(
        optional($.ModelHeader),
        repeat(choice($.ComponentsSection, $.ConnectionsSection, $.MapSection, $.SimulationSection, $.Comment)),
      ),

    ModelHeader: ($) =>
      choice(
        seq(choice("MODEL", "NAME"), ":", field("name", $.Identifier)),
        seq("SPEED", ":", field("speed", $.NumberLiteral)),
        seq("LAMBDA", ":", field("lambda", $.NumberLiteral)),
      ),

    ComponentsSection: ($) =>
      seq(choice("COMPONENTS:", "COMPONENTS"), repeat(choice($.ComponentDeclaration, $.Comment))),

    ComponentDeclaration: ($) =>
      seq(
        field("id", $.Identifier),
        "=",
        field("kind", $.Identifier),
        optional(seq("(", repeat(choice($.AttributeAssignment, ",")), ")")),
      ),

    AttributeAssignment: ($) =>
      seq(field("key", $.Identifier), "=", field("value", choice($.NumberLiteral, $.StringLiteral, $.Identifier))),

    ConnectionsSection: ($) =>
      seq(choice("CONNECTIONS:", "CONNECTIONS"), repeat(choice($.ConnectionStatement, $.Comment))),

    ConnectionStatement: ($) =>
      seq(
        field("fromComponent", $.Identifier),
        ".",
        field("fromPort", $.Identifier),
        choice("->", "=>", "TO"),
        field("toComponent", $.Identifier),
        ".",
        field("toPort", $.Identifier),
      ),

    MapSection: ($) =>
      seq(
        choice("MAP:", "TABLE:"),
        field("mapId", $.Identifier),
        repeat(choice($.NumberLiteral, $.Identifier, $.Comment)),
        choice("ENDMAP", "END"),
      ),

    SimulationSection: ($) => seq(choice("SIMULATION:", "SETTINGS:"), repeat($.AttributeAssignment)),

    Identifier: () => /[A-Za-z_][A-Za-z0-9_]*/,
    NumberLiteral: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    StringLiteral: () => /"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'/,
    Comment: () => /(?:\/\/.*|\/\*[\s\S]*?\*\/|#.*)/,
  },
});

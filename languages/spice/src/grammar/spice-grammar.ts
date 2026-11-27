// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Formal DSL Grammar Specification.
 *
 * Declarative SPICE netlist grammar defined via @modelscript/dsl's language combinators,
 * enabling compilation into native WebAssembly GLR parse tables and linear-memory CST.
 */

import { choice, field, language, optional, repeat, semanticToken, seq } from "@modelscript/dsl";

export const spiceNetlistGrammar = language({
  name: "SpiceNetlist",
  word: ($) => $.Identifier,
  lsp: {
    folding: ["SubcktDef", { rule: "CommentLine", kind: "comment", defaultCollapsed: true }],
    outline: ["SubcktDef", "Component", "Directive"],
  },
  rules: {
    Circuit: ($) => repeat(choice($.Component, $.Directive, $.CommentLine)),

    Component: ($) =>
      choice($.TwoTerminalComponent, $.SourceComponent, $.BjtComponent, $.MosfetComponent, $.SubcircuitCall),

    TwoTerminalComponent: ($) =>
      seq(
        field("name", $.TwoTerminalId),
        field("positiveNode", $.Node),
        field("negativeNode", $.Node),
        field("value", $.Value),
      ),

    SourceComponent: ($) =>
      seq(
        field("name", $.SourceId),
        field("positiveNode", $.Node),
        field("negativeNode", $.Node),
        optional(field("type", semanticToken("function", choice("DC", "AC", "PULSE", "SINE")))),
        optional(field("value", $.Value)),
      ),

    BjtComponent: ($) =>
      seq(
        field("name", $.BjtId),
        field("collectorNode", $.Node),
        field("baseNode", $.Node),
        field("emitterNode", $.Node),
        semanticToken("type", field("model", $.Identifier)),
      ),

    MosfetComponent: ($) =>
      seq(
        field("name", $.MosfetId),
        field("drainNode", $.Node),
        field("gateNode", $.Node),
        field("sourceNode", $.Node),
        field("substrateNode", $.Node),
        semanticToken("type", field("model", $.Identifier)),
      ),

    SubcircuitCall: ($) =>
      seq(
        field("name", $.SubcktCallId),
        repeat(field("node", $.Node)),
        semanticToken("class", field("subcircuitName", $.Identifier)),
      ),

    Directive: ($) =>
      choice(
        $.TranDirective,
        $.AcDirective,
        $.DcDirective,
        $.OpDirective,
        $.ModelDirective,
        $.ParamDirective,
        $.SubcktDef,
      ),

    TranDirective: ($) => seq(semanticToken("function", ".TRAN"), field("step", $.Value), field("stop", $.Value)),

    AcDirective: ($) =>
      seq(
        semanticToken("function", ".AC"),
        field("sweepType", semanticToken("keyword", choice("DEC", "OCT", "LIN"))),
        field("points", $.Number),
        field("startFreq", $.Value),
        field("stopFreq", $.Value),
      ),

    DcDirective: ($) =>
      seq(
        semanticToken("function", ".DC"),
        field("source", $.Identifier),
        field("start", $.Value),
        field("stop", $.Value),
        field("step", $.Value),
      ),

    OpDirective: () => semanticToken("function", ".OP"),

    ModelDirective: ($) =>
      seq(
        semanticToken("keyword", ".MODEL"),
        semanticToken("class", field("name", $.Identifier), ["declaration"]),
        semanticToken("type", field("kind", $.Identifier)),
        optional(seq("(", repeat($.ParamAssignment), ")")),
      ),

    ParamAssignment: ($) => seq(semanticToken("parameter", field("param", $.Identifier)), "=", field("val", $.Value)),

    ParamDirective: ($) =>
      seq(
        semanticToken("keyword", ".PARAM"),
        semanticToken("parameter", field("param", $.Identifier), ["declaration"]),
        "=",
        field("expr", choice($.Value, $.BraceExpr)),
      ),

    SubcktDef: ($) =>
      seq(
        semanticToken("keyword", ".SUBCKT"),
        semanticToken("class", field("name", $.Identifier), ["declaration"]),
        repeat(semanticToken("parameter", field("port", $.Node), ["declaration"])),
        repeat(choice($.Component, $.Directive, $.CommentLine)),
        semanticToken("keyword", ".ENDS"),
        optional(semanticToken("class", field("endName", $.Identifier))),
      ),

    BraceExpr: ($) => seq("{", field("inner", $.Identifier), "}"),

    Node: ($) => choice($.Number, $.Identifier, "0", "GND", "gnd"),

    Value: ($) => choice($.EngineeringNumber, $.Number),

    TwoTerminalId: () => semanticToken("variable", /[rRcCldDL][a-zA-Z0-9_]*/),
    SourceId: () => semanticToken("variable", /[vViI][a-zA-Z0-9_]*/),
    BjtId: () => semanticToken("variable", /[qQ][a-zA-Z0-9_]*/),
    MosfetId: () => semanticToken("variable", /[mM][a-zA-Z0-9_]*/),
    SubcktCallId: () => semanticToken("variable", /[xX][a-zA-Z0-9_]*/),

    EngineeringNumber: () => semanticToken("number", /[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?[a-zA-Z]+/),
    Number: () => semanticToken("number", /[0-9]+(?:\.[0-9]+)?/),
    Identifier: () => semanticToken("variable", /[a-zA-Z_][a-zA-Z0-9_]*/),
    CommentLine: () => semanticToken("comment", choice(/\*[^\n]*/, /;[^\n]*/)),
  },
  extras: () => [/[ \t\r\n]+/],
});

import { choice, field, language, prec, repeat, seq, token } from "../../../src/index.js";

export const calcLanguage = language({
  name: "Calc",

  primitives: {
    nestedComment: { open: "/*", close: "*/" },
  },

  rules: {
    program: ($) => repeat($.statement),

    statement: ($) => choice($.assignment, $.expression_statement),

    assignment: ($) => seq(field("left", $.identifier), "=", field("right", $.expression), ";"),

    expression_statement: ($) => seq($.expression, ";"),

    expression: ($) => choice($.binary_expression, $.parenthesized_expression, $.number, $.identifier),

    binary_expression: ($) =>
      choice(
        prec.left(1, seq(field("left", $.expression), choice("+", "-"), field("right", $.expression))),
        prec.left(2, seq(field("left", $.expression), choice("*", "/"), field("right", $.expression))),
      ),

    parenthesized_expression: ($) => seq("(", $.expression, ")"),

    number: () => token(/\d+(?:\.\d+)?/),
    identifier: () => token(/[a-zA-Z_]\w*/),
  },

  extras: () => [/\s+/, /\/\/.*/],
});

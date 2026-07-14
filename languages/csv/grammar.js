module.exports = grammar({
  name: "csv",
  rules: {
    SourceFile: ($) => seq(field("rows", $.Row), repeat(seq($._newline, field("rows", $.Row))), optional($._newline)),
    Row: ($) =>
      choice(
        seq(field("cells", $.Cell), repeat(seq($._delimiter, optional(field("cells", $.Cell))))),
        seq($._delimiter, repeat(seq($._delimiter, optional(field("cells", $.Cell))))),
      ),
    Cell: ($) => choice($._quoted_cell, $._unquoted_cell),
    _quoted_cell: ($) => /"([^"]|"")*"/,
    _unquoted_cell: ($) => /[^,\r\n\t;"]+/,
    _delimiter: ($) => choice(",", ";", "\t"),
    _newline: ($) => choice("\r\n", "\n", "\r"),
    CSVVirtualComponent: ($) => "CSVVirtualComponent",
  },
});

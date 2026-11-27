// SPDX-License-Identifier: AGPL-3.0-or-later
import { choice, field, language, repeat, seq } from "../index.js";

/**
 * Lossless XML grammar used as the concrete-syntax layer for XML-based engineering formats
 * (PSCAD `.pscx`/`.pslx`/`.pswx`, and later SSP/SSD).
 *
 * The grammar is deliberately format-agnostic. Whitespace, comments and processing
 * instructions are `extras`: they never appear in the tree, but every node carries exact
 * source offsets, so the original bytes between nodes are always recoverable and edits can
 * be expressed as minimal text splices.
 */
export const xmlGrammar = language({
  name: "xml-cst",
  fileExtensions: [".xml-cst"],
  lsp: { fileExtensions: [".xml-cst"] },

  extras: ($) => [/\s/, $["COMMENT"]!, $["PROCESSING_INSTRUCTION"]!],

  rules: {
    Document: ($) => field("root", $["Element"]!),

    Element: ($) =>
      choice(
        field("open", $["EmptyTag"]!),
        seq(
          field("open", $["StartTag"]!),
          repeat(field("children", choice($["Element"]!, $["CData"]!, $["Text"]!))),
          field("endName", $["CloseTag"]!),
        ),
      ),

    TagHead: ($) => seq("<", field("name", $["XmlName"]!), repeat(field("attr", $["Attribute"]!))),

    EmptyTag: ($) => seq($["TagHead"]!, "/>"),

    StartTag: ($) => seq($["TagHead"]!, ">"),

    CloseTag: ($) => seq("</", field("name", $["XmlName"]!), ">"),

    Attribute: ($) => seq(field("name", $["XmlName"]!), "=", field("value", $["AttrValue"]!)),

    XmlName: () => /[A-Za-z_:][A-Za-z0-9_.:-]*/,

    AttrValue: () => /"[^"<]*"|'[^'<]*'/,

    TextChunk: () => /[^<>"'=/\s]+/,

    Text: ($) => choice($["TextChunk"]!, $["XmlName"]!, $["AttrValue"]!, "=", ">", "/>", "/", '"', "'"),

    CData: () => /<!\[CDATA\[([^\]]|\][^\]]|\]\][^>])*\]\]>/,

    COMMENT: () => /<!--[^-]*(-[^-]+)*-->/,

    PROCESSING_INSTRUCTION: () => /<\?([^?]|\?[^>])*\?>/,
  },
});

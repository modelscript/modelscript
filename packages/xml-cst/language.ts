// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, repeat, seq } from "@modelscript/dsl";

/**
 * Lossless XML grammar used as the concrete-syntax layer for XML-based engineering formats
 * (PSCAD `.pscx`/`.pslx`/`.pswx`, and later SSP/SSD).
 *
 * The grammar is deliberately format-agnostic. Whitespace, comments and processing
 * instructions are `extras`: they never appear in the tree, but every node carries exact
 * source offsets, so the original bytes between nodes are always recoverable and edits can
 * be expressed as minimal text splices.
 */
export const xmlLanguage = language({
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

    // Whole tags are single tokens (attributes are re-scanned by the reader, offsets stay exact).
    EmptyTag: () =>
      /<[A-Za-z_:][A-Za-z0-9_.:-]*([ \t\r\n]+[A-Za-z_:][A-Za-z0-9_.:-]*[ \t\r\n]*=[ \t\r\n]*("[^"]*"|'[^']*'))*[ \t\r\n]*\/>/,

    StartTag: () =>
      /<[A-Za-z_:][A-Za-z0-9_.:-]*([ \t\r\n]+[A-Za-z_:][A-Za-z0-9_.:-]*[ \t\r\n]*=[ \t\r\n]*("[^"]*"|'[^']*'))*[ \t\r\n]*>/,

    CloseTag: () => /<\/[A-Za-z_:][A-Za-z0-9_.:-]*[ \t\r\n]*>/,

    Text: () => /[^<\s][^<]*/,

    CData: () => /<!\[CDATA\[([^\]]|\][^\]]|\]\][^>])*\]\]>/,

    COMMENT: () => /<!--[^-]*(-[^-]+)*-->/,

    PROCESSING_INSTRUCTION: () => /<\?([^?]|\?[^>])*\?>/,
  },
});

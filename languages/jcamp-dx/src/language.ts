// SPDX-License-Identifier: AGPL-3.0-or-later

import { choice, field, language, repeat, seq } from "@modelscript/dsl";
import { registerBuiltInJcampDxLibrarySync } from "./catalog/library-package-adapter.js";
import { JcampDxErrorCode } from "./errors.js";
import { jcampDxIndexing } from "./indexing.js";

/**
 * DSL language specification for IUPAC JCAMP-DX Analytical Spectroscopy Exchange Format
 * (`.jdx`, `.dx`, `.jcamp`).
 */
export const jcampDxLanguage = language({
  name: "jcamp-dx",
  fileExtensions: [".jdx", ".dx", ".jcamp"],
  maturity: "beta",
  indexing: jcampDxIndexing,
  lsp: {
    fileExtensions: [".jdx", ".dx", ".jcamp"],
  },
  ui: {
    panels: [
      {
        id: "jcampDxViewer",
        viewType: "modelscript.jcampDxViewer",
        title: "JCAMP-DX Analytical Spectrum Viewer & Editor",
        shortTitle: "JCAMP-DX",
        selector: ["*.jdx", "*.dx", "*.jcamp"],
        priority: "option",
        targets: ["vscode", "morsel", "artifact"],
        entry: "./src/ui/JcampDxPanel.tsx",
        artifactViewTypes: ["jcamp-dx", "jdx", "jcamp"],
      },
    ],
  },

  errorCodes: JcampDxErrorCode,

  rules: {
    Document: ($) =>
      repeat(
        choice(
          $["TitleRecord"]!,
          $["VersionRecord"]!,
          $["DataTypeRecord"]!,
          $["OriginRecord"]!,
          $["OwnerRecord"]!,
          $["XUnitsRecord"]!,
          $["YUnitsRecord"]!,
          $["FirstXRecord"]!,
          $["LastXRecord"]!,
          $["NPointsRecord"]!,
          $["XFactorRecord"]!,
          $["YFactorRecord"]!,
          $["XyDataRecord"]!,
          $["PeakTableRecord"]!,
          $["EndRecord"]!,
          $["GenericLdrRecord"]!,
          $["DataLine"]!,
          $["Comment"]!,
        ),
      ),

    TitleRecord: ($) => seq("##TITLE=", field("value", $["LdrText"]!)),
    VersionRecord: ($) => seq("##JCAMP-DX=", field("value", $["LdrText"]!)),
    DataTypeRecord: ($) => seq("##DATA TYPE=", field("value", $["LdrText"]!)),
    OriginRecord: ($) => seq("##ORIGIN=", field("value", $["LdrText"]!)),
    OwnerRecord: ($) => seq("##OWNER=", field("value", $["LdrText"]!)),
    XUnitsRecord: ($) => seq("##XUNITS=", field("value", $["LdrText"]!)),
    YUnitsRecord: ($) => seq("##YUNITS=", field("value", $["LdrText"]!)),
    FirstXRecord: ($) => seq("##FIRSTX=", field("value", $["NumberToken"]!)),
    LastXRecord: ($) => seq("##LASTX=", field("value", $["NumberToken"]!)),
    NPointsRecord: ($) => seq("##NPOINTS=", field("value", $["NumberToken"]!)),
    XFactorRecord: ($) => seq("##XFACTOR=", field("value", $["NumberToken"]!)),
    YFactorRecord: ($) => seq("##YFACTOR=", field("value", $["NumberToken"]!)),
    XyDataRecord: ($) => seq("##XYDATA=", field("format", $["LdrText"]!)),
    PeakTableRecord: ($) => seq("##PEAK TABLE=", field("format", $["LdrText"]!)),
    EndRecord: () => "##END=",

    GenericLdrRecord: ($) => seq(field("label", $["LdrHeader"]!), field("value", $["LdrText"]!)),

    DataLine: ($) => seq(field("x", $["NumberToken"]!), repeat(choice($["AsdfToken"]!, $["NumberToken"]!, ",", ";"))),

    LdrHeader: () => /##[A-Za-z0-9 .$_\-/]+=/,
    NumberToken: () => /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/,
    AsdfToken: () => /[@%A-Za-s][0-9.]*/,
    LdrText: () => /[^\r\n$]+/,
    Comment: () => /\$\$[^\r\n]*/,
  },
});

// Auto-register cleanroom standard library in globalLibraryRegistry (zero-I/O).
registerBuiltInJcampDxLibrarySync();

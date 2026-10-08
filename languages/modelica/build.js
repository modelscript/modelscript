// SPDX-License-Identifier: AGPL-3.0-or-later

import { runLanguageParserBuild } from "../../scripts/build-language-parser.js";

runLanguageParserBuild({
  langName: "modelica",
  dir: import.meta.dirname,
  languageModule: "./src/language.js",
  languageExportName: "modelicaLanguage",
  extraWatchFiles: ["assembly/flattener.ts", "src/lints"],
});

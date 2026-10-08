// SPDX-License-Identifier: AGPL-3.0-or-later

import { runLanguageParserBuild } from "../../scripts/build-language-parser.js";

runLanguageParserBuild({
  langName: "csv",
  dir: import.meta.dirname,
  languageModule: "./language.js",
  languageExportName: "csvLanguage",
});

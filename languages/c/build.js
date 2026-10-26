// SPDX-License-Identifier: AGPL-3.0-or-later

import { runLanguageParserBuild } from "../../scripts/build-language-parser.js";

runLanguageParserBuild({
  langName: "c",
  dir: import.meta.dirname,
  languageModule: "./src/language.js",
  languageExportName: "cLanguage",
});

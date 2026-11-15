// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggDefaultVal, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const csvTggRules = [
  tggRule({
    name: "CsvDocumentToModelicaPackage",
    sourceLang: "csv",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["SourceFile"]?.({ rows: v("docName") }),
    target: ($, v) => $["ClassDefinition"]?.({ name: v("docName"), classKind: "package" }),
    where: (v) => [
      tggEq(v("docName"), v("docName")),
      tggDefaultVal(v("isAbstract"), false),
      tggComplement(["rows", "headers"]),
    ],
  }),
  tggRule({
    name: "CsvVirtualComponentToModelicaComponent",
    sourceLang: "csv",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["CSVVirtualComponent"]?.({ name: v("varName"), typeSpecifier: v("typeName") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("varName"), typeSpecifier: v("typeName") }),
    where: (v) => [
      tggEq(v("varName"), v("varName")),
      tggEq(v("typeName"), v("typeName")),
      tggDefaultVal(v("causality"), "local"),
      tggDefaultVal(v("variability"), "constant"),
    ],
  }),
];

export const csvPolyglotConfig: PolyglotConfig = {
  languages: ["modelica"],
  rules: csvTggRules,
};

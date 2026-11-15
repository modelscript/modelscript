// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggDefaultVal, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const sspTggRules = [
  tggRule({
    name: "SspSystemToModelicaModel",
    sourceLang: "ssp",
    targetLang: "modelica",
    source: ($, v) => $["System"]?.({ name: v("sysName") }),
    target: ($, v) => $["ClassDefinition"]?.({ name: v("sysName"), classKind: "model" }),
    where: (v) => [
      tggEq(v("sysName"), v("sysName")),
      tggDefaultVal(v("isAbstract"), false),
      tggComplement(["version", "description"]),
    ],
  }),
  tggRule({
    name: "SspComponentToModelicaComponent",
    sourceLang: "ssp",
    targetLang: "modelica",
    priority: 20,
    source: ($, v) => $["Component"]?.({ name: v("compName"), source: v("sourceFile") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("compName"), typeSpecifier: v("sourceFile") }),
    where: (v) => [
      tggEq(v("compName"), v("compName")),
      tggEq(v("sourceFile"), v("sourceFile")),
      tggComplement(["type", "connectors"]),
    ],
  }),
  tggRule({
    name: "SspConnectorToModelicaConnector",
    sourceLang: "ssp",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["Connector"]?.({ name: v("connName"), type: v("typeName") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("connName"), typeSpecifier: v("typeName") }),
    where: (v) => [
      tggEq(v("connName"), v("connName")),
      tggEq(v("typeName"), v("typeName")),
      tggComplement(["kind", "unit"]),
    ],
  }),
  tggRule({
    name: "SspConnectionToModelicaConnect",
    sourceLang: "ssp",
    targetLang: "modelica",
    source: ($, v) => $["Connection"]?.({ startElement: v("fromEl"), endElement: v("toEl") }),
    target: ($, v) => $["ConnectClause"]?.({ connector1: v("fromEl"), connector2: v("toEl") }),
    where: (v) => [
      tggEq(v("fromEl"), v("fromEl")),
      tggEq(v("toEl"), v("toEl")),
      tggComplement(["startConnector", "endConnector"]),
    ],
  }),
];

export const sspPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  typeMaps: {
    sspToModelica: {
      Real: "Real",
      Integer: "Integer",
      Boolean: "Boolean",
      String: "String",
      Enumeration: "Integer",
    },
  },
  rules: sspTggRules,
};

// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const modelscriptTggRules = [
  tggRule({
    name: "ModelScriptStructToModelicaRecord",
    sourceLang: "modelscript",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["StructDeclaration"]?.({ name: v("name") }),
    target: ($, v) => $["ClassDefinition"]?.({ name: v("name"), classKind: "record" }),
    where: (v) => [tggEq(v("name"), v("name")), tggComplement(["fields"])],
  }),
  tggRule({
    name: "ModelScriptParamToModelicaMod",
    sourceLang: "modelscript",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["VariableDeclaration"]?.({ name: v("paramName"), value: v("paramVal") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("paramName"), modification: v("paramVal") }),
    where: (v) => [tggEq(v("paramName"), v("paramName")), tggEq(v("paramVal"), v("paramVal"))],
  }),
];

export const modelscriptPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  typeMaps: {
    modelica: {
      i32: "Integer",
      u32: "Integer",
      i64: "Integer",
      u64: "Integer",
      usize: "Integer",
      f32: "Real",
      f64: "Real",
      bool: "Boolean",
      string: "String",
    },
    sysml2: {
      i32: "KerML::Integer",
      u32: "KerML::Integer",
      i64: "KerML::Integer",
      u64: "KerML::Integer",
      usize: "KerML::Integer",
      f32: "ISQ::Real",
      f64: "ISQ::Real",
      bool: "KerML::Boolean",
      string: "KerML::String",
    },
  },
  rules: modelscriptTggRules,
};

// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const cTggRules = [
  tggRule({
    name: "CFunctionToModelicaFunction",
    sourceLang: "c",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["FunctionDefinition"]?.({ name: v("fnName") }),
    target: ($, v) => $["FunctionDefinition"]?.({ declaredName: v("fnName") }),
    where: (v) => [tggEq(v("fnName"), v("fnName")), tggComplement(["returnType", "parameters"])],
  }),
  tggRule({
    name: "CStructToModelicaRecord",
    sourceLang: "c",
    targetLang: "modelica",
    priority: 8,
    source: ($, v) => $["StructSpecifier"]?.({ name: v("structName") }),
    target: ($, v) => $["RecordDefinition"]?.({ declaredName: v("structName") }),
    where: (v) => [tggEq(v("structName"), v("structName")), tggComplement(["fields"])],
  }),
];

export const cPolyglotConfig: PolyglotConfig = {
  languages: ["modelica"],
  rules: cTggRules,
};

// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const fortranTggRules = [
  tggRule({
    name: "FortranSubroutineToModelicaFunction",
    sourceLang: "fortran",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["SubroutineDeclaration"]?.({ name: v("subName") }),
    target: ($, v) => $["FunctionDefinition"]?.({ declaredName: v("subName") }),
    where: (v) => [tggEq(v("subName"), v("subName")), tggComplement(["arguments"])],
  }),
  tggRule({
    name: "FortranAssignToModelicaEquation",
    sourceLang: "fortran",
    targetLang: "modelica",
    priority: 5,
    source: ($, v) => $["AssignmentStatement"]?.({ target: v("lhs"), value: v("rhs") }),
    target: ($, v) => $["EqualityEquation"]?.({ left: v("lhs"), right: v("rhs") }),
    where: (v) => [tggEq(v("lhs"), v("lhs")), tggEq(v("rhs"), v("rhs"))],
  }),
];

export const fortranPolyglotConfig: PolyglotConfig = {
  languages: ["modelica"],
  rules: fortranTggRules,
};

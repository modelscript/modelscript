// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const feaTggRules = [
  tggRule({
    name: "FeaStressMassToModelicaParam",
    sourceLang: "fea",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["KeywordCard"]?.({ name: "MASS", parameter: v("massVal") }),
    target: ($, v) => $["ComponentClause"]?.({ name: "m", defaultValue: v("massVal") }),
    where: (v) => [
      tggEq(v("massVal"), v("massVal")),
      tggReconcilePhysics(v("massVal"), v("massVal"), { min: 1e-4, max: 1e7 }),
      tggComplement(["elset", "material"]),
    ],
  }),
  tggRule({
    name: "FeaStressMassToSysmlAttribute",
    sourceLang: "fea",
    targetLang: "sysml2",
    priority: 15,
    source: ($, v) => $["KeywordCard"]?.({ name: "MASS", parameter: v("massVal") }),
    target: ($, v) => $["AttributeUsage"]?.({ declaredName: "totalMass", defaultValue: v("massVal") }),
    where: (v) => [
      tggEq(v("massVal"), v("massVal")),
      tggReconcilePhysics(v("massVal"), v("massVal"), { min: 1e-4, max: 1e7 }),
      tggComplement(["elset", "material"]),
    ],
  }),
  tggRule({
    name: "FeaMaterialToSysmlAttribute",
    sourceLang: "fea",
    targetLang: "sysml2",
    priority: 5,
    source: ($, v) => $["KeywordCard"]?.({ name: "MATERIAL", parameter: v("modulus") }),
    target: ($, v) => $["AttributeUsage"]?.({ declaredName: "material", defaultValue: v("modulus") }),
    where: (v) => [
      tggEq(v("modulus"), v("modulus")),
      tggReconcilePhysics(v("modulus"), v("modulus"), { min: 1e3, max: 1e13 }),
      tggComplement(["nu", "rho", "yieldStrength"]),
    ],
  }),
  tggRule({
    name: "FeaBoundaryFixToModelicaFixed",
    sourceLang: "fea",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["KeywordCard"]?.({ name: "BOUNDARY", parameter: v("nodeId") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: "fixedBoundary",
        typeSpecifier: "Modelica.Mechanics.Translational.Components.Fixed",
        parameter: v("nodeId"),
      }),
    where: (v) => [tggEq(v("nodeId"), v("nodeId")), tggComplement(["dofs"])],
  }),
  tggRule({
    name: "FeaSpringToModelicaSpring",
    sourceLang: "fea",
    targetLang: "modelica",
    priority: 9,
    source: ($, v) => $["KeywordCard"]?.({ name: "SPRING", parameter: v("stiffness") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: "springComponent",
        typeSpecifier: "Modelica.Mechanics.Translational.Components.Spring",
        c: v("stiffness"),
      }),
    where: (v) => [tggEq(v("stiffness"), v("stiffness")), tggComplement(["damping"])],
  }),
];

export const feaPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: feaTggRules,
};

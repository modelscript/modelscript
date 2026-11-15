// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const olgaTggRules = [
  tggRule({
    name: "OlgaFlowpathToSysmlPart",
    sourceLang: "olga",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["FlowpathElement"]?.({ name: v("fpName"), diameter: v("diam") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("fpName"), declaredType: "FlowlineRiserSystem", diameter: v("diam") }),
    where: (v) => [
      tggEq(v("fpName"), v("fpName")),
      tggEq(v("diam"), v("diam")),
      tggReconcilePhysics(v("diam"), v("diam"), { min: 0.01, max: 5.0 }),
      tggComplement(["roughness", "wallThickness"]),
    ],
  }),
  tggRule({
    name: "OlgaValveToSysmlPart",
    sourceLang: "olga",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ValveElement"]?.({ name: v("vName"), cd: v("cd") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("vName"), declaredType: "ChokeValve", cd: v("cd") }),
    where: (v) => [
      tggEq(v("vName"), v("vName")),
      tggEq(v("cd"), v("cd")),
      tggReconcilePhysics(v("cd"), v("cd"), { min: 0.01, max: 1.0 }),
      tggComplement(["opening", "diameter"]),
    ],
  }),
  tggRule({
    name: "OlgaNodeToModelicaFluidPort",
    sourceLang: "olga",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["NodeElement"]?.({ name: v("nName"), pressure: v("p") }),
    target: ($, v) => $["FluidPort"]?.({ name: v("nName"), p_start: v("p") }),
    where: (v) => [
      tggEq(v("nName"), v("nName")),
      tggEq(v("p"), v("p")),
      tggReconcilePhysics(v("p"), v("p"), { min: 1e3, max: 1e8 }),
      tggComplement(["temperature", "nodeType"]),
    ],
  }),
];

export const olgaPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: olgaTggRules,
};

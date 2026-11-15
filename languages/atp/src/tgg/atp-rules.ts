// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const atpTggRules = [
  tggRule({
    name: "AtpBranchToModelicaRlc",
    sourceLang: "atp",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["BranchCard"]?.({ name: v("brName"), rOhm: v("rVal") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("brName"),
        typeSpecifier: "Modelica.Electrical.Analog.Basic.Resistor",
        R: v("rVal"),
      }),
    where: (v) => [
      tggEq(v("brName"), v("brName")),
      tggEq(v("rVal"), v("rVal")),
      tggReconcilePhysics(v("rVal"), v("rVal"), { min: 0.0, max: 1e7 }),
      tggComplement(["lMh", "cUf", "busA", "busB"]),
    ],
  }),
  tggRule({
    name: "AtpSwitchToModelicaSwitch",
    sourceLang: "atp",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["SwitchCard"]?.({ name: v("swName"), tClose: v("tVal") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("swName"),
        typeSpecifier: "Modelica.Electrical.Analog.Ideal.IdealClosingSwitch",
        tClose: v("tVal"),
      }),
    where: (v) => [
      tggEq(v("swName"), v("swName")),
      tggEq(v("tVal"), v("tVal")),
      tggReconcilePhysics(v("tVal"), v("tVal"), { min: 0.0, max: 100.0 }),
      tggComplement(["tOpen", "iMargin"]),
    ],
  }),
  tggRule({
    name: "AtpControlToSysmlRequirement",
    sourceLang: "atp",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["SimulationControl"]?.({ name: v("ctlName"), deltaT: v("dt") }),
    target: ($, v) => $["RequirementUsage"]?.({ declaredName: v("ctlName"), timeStep: v("dt") }),
    where: (v) => [
      tggEq(v("ctlName"), v("ctlName")),
      tggEq(v("dt"), v("dt")),
      tggReconcilePhysics(v("dt"), v("dt"), { min: 1e-9, max: 1.0 }),
      tggComplement(["tMax"]),
    ],
  }),
];

export const atpPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: atpTggRules,
};

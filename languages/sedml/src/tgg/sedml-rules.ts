// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const sedmlTggRules = [
  tggRule({
    name: "SedmlSimulationToSysmlRequirement",
    sourceLang: "sedml",
    targetLang: "sysml2",
    priority: 15,
    source: ($, v) => $["UniformTimeCourse"]?.({ name: v("simId"), outputEndTime: v("tEnd") }),
    target: ($, v) => $["RequirementUsage"]?.({ declaredName: v("simId"), stopTime: v("tEnd") }),
    where: (v) => [
      tggEq(v("simId"), v("simId")),
      tggEq(v("tEnd"), v("tEnd")),
      tggReconcilePhysics(v("tEnd"), v("tEnd"), { min: 1e-6, max: 1e8 }),
      tggComplement(["initialTime", "numberOfSteps", "kisaoId"]),
    ],
  }),
  tggRule({
    name: "SedmlModelToModelicaModel",
    sourceLang: "sedml",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["SedModelRef"]?.({ name: v("modId"), languageUri: v("langUri") }),
    target: ($, v) => $["ClassDefinition"]?.({ name: v("modId"), classKind: "model", sourceUri: v("langUri") }),
    where: (v) => [tggEq(v("modId"), v("modId")), tggEq(v("langUri"), v("langUri")), tggComplement(["sourcePath"])],
  }),
];

export const sedmlPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: sedmlTggRules,
};

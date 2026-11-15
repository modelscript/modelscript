// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const aspenTggRules = [
  tggRule({
    name: "AspenStreamToModelicaFluidPort",
    sourceLang: "aspen",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["MaterialStream"]?.({ name: v("streamName"), tempK: v("temp") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("streamName"),
        typeSpecifier: "Modelica.Fluid.Interfaces.FluidPort_a",
        T_start: v("temp"),
      }),
    where: (v) => [
      tggEq(v("streamName"), v("streamName")),
      tggEq(v("temp"), v("temp")),
      tggReconcilePhysics(v("temp"), v("temp"), { min: 1.0, max: 5000.0 }),
      tggComplement(["pressurePa", "molarFlow", "composition"]),
    ],
  }),
  tggRule({
    name: "AspenBlockToSysmlPart",
    sourceLang: "aspen",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["UnitOpBlock"]?.({ name: v("blkName"), modelType: v("opType") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("blkName"), declaredType: v("opType") }),
    where: (v) => [
      tggEq(v("blkName"), v("blkName")),
      tggEq(v("opType"), v("opType")),
      tggComplement(["dutyKw", "efficiency"]),
    ],
  }),
];

export const aspenPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: aspenTggRules,
};

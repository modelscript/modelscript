// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const ocppTggRules = [
  tggRule({
    name: "OcppEvseToSysmlPart",
    sourceLang: "ocpp",
    targetLang: "sysml2",
    priority: 15,
    source: ($, v) => $["EvseUnit"]?.({ name: v("evseId"), maxPowerKw: v("kw") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("evseId"), declaredType: "EvseCharger", maxPowerKw: v("kw") }),
    where: (v) => [
      tggEq(v("evseId"), v("evseId")),
      tggEq(v("kw"), v("kw")),
      tggReconcilePhysics(v("kw"), v("kw"), { min: 1.0, max: 1000.0 }),
      tggComplement(["connectorType", "protocolVersion"]),
    ],
  }),
  tggRule({
    name: "OcppChargingProfileToModelicaInput",
    sourceLang: "ocpp",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["ChargingProfile"]?.({ name: v("profName"), limitAmps: v("amps") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("profName"),
        typeSpecifier: "Modelica.Blocks.Sources.RealExpression",
        I_limit: v("amps"),
      }),
    where: (v) => [
      tggEq(v("profName"), v("profName")),
      tggEq(v("amps"), v("amps")),
      tggReconcilePhysics(v("amps"), v("amps"), { min: 0.0, max: 2000.0 }),
      tggComplement(["stackLevel", "purpose"]),
    ],
  }),
];

export const ocppPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: ocppTggRules,
};

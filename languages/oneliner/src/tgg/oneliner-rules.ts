// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const onelinerTggRules = [
  tggRule({
    name: "OnelinerRelayToModelicaRelay",
    sourceLang: "oneliner",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["OvercurrentRelay"]?.({ name: v("relayName"), pickupAmps: v("pickup") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("relayName"),
        typeSpecifier: "Modelica.Electrical.PowerSystems.Protection.OvercurrentRelay",
        I_pickup: v("pickup"),
      }),
    where: (v) => [
      tggEq(v("relayName"), v("relayName")),
      tggEq(v("pickup"), v("pickup")),
      tggReconcilePhysics(v("pickup"), v("pickup"), { min: 0.1, max: 50000.0 }),
      tggComplement(["curveType", "timeDial"]),
    ],
  }),
  tggRule({
    name: "OnelinerBusToModelicaBus",
    sourceLang: "oneliner",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["BusElement"]?.({ name: v("busName"), kv: v("kvVal") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("busName"),
        typeSpecifier: "OpenIPSL.Electrical.Buses.Bus",
        V_b: v("kvVal"),
      }),
    where: (v) => [
      tggEq(v("busName"), v("busName")),
      tggEq(v("kvVal"), v("kvVal")),
      tggReconcilePhysics(v("kvVal"), v("kvVal"), { min: 0.1, max: 1200.0 }),
      tggComplement(["busType"]),
    ],
  }),
  tggRule({
    name: "OnelinerBreakerToSysmlPart",
    sourceLang: "oneliner",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["BreakerElement"]?.({ name: v("brkName"), interruptingKa: v("ka") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("brkName"), declaredType: "CircuitBreaker", ratingKa: v("ka") }),
    where: (v) => [
      tggEq(v("brkName"), v("brkName")),
      tggEq(v("ka"), v("ka")),
      tggReconcilePhysics(v("ka"), v("ka"), { min: 1.0, max: 200.0 }),
      tggComplement(["cycles"]),
    ],
  }),
];

export const onelinerPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: onelinerTggRules,
};

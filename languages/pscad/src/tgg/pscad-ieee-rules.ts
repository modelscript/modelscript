// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Bidirectional Triple Graph Grammar (TGG) Rules for PSCAD <-> IEEE 2800-2022.
 *
 * Establishes a rigorous Semantic Envelope between PSCAD electromagnetic transient (EMT)
 * Inverter-Based Resource (IBR) circuit parameters and IEEE 2800-2022 Clause 5.3.2 / 5.4.1 / 7.2.2
 * interconnection verification envelopes using invertible control laws (`tggInvertible`),
 * physical feasibility bounds (`tggReconcilePhysics`), and shadow complements (`tggComplement`).
 */

import {
  tggComplement,
  tggEq,
  tggInvertible,
  tggReconcile,
  tggReconcilePhysics,
  tggRule,
  tggTypeMap,
  type PolyglotConfig,
} from "@modelscript/dsl";

export const pscadIeeeTggRules = [
  // 1. PSCAD Project <-> IEEE 2800-2022 Verification Report Header
  tggRule({
    name: "PscadProjectToIeee2800ReportHeader",
    sourceLang: "pscad",
    targetLang: "ieee2800",
    source: ($, v) =>
      $.PscadProject({
        name: v("projName"),
      }),
    target: ($, v) =>
      $.Ieee2800VerificationHeader({
        projectName: v("projName"),
      }),
    where: (v) => [
      tggEq(v("projName"), v("projName")),
      tggReconcile(v("projName"), v("projName"), "target-wins"),
      tggComplement(["version", "frequency", "busesXml", "rlcBranchesXml", "faultsXml"]),
    ],
  }),

  // 2. PSCAD IBR LVRT Mode <-> IEEE 2800 Clause 5.3.2 Low-Voltage Ride-Through Envelope
  tggRule({
    name: "PscadIbrLvrtModeToClause532Envelope",
    sourceLang: "pscad",
    targetLang: "ieee2800",
    source: ($, v) =>
      $.PscadIbrComponent({
        LVRT_mode: v("lvrtMode"),
      }),
    target: ($, v) =>
      $.Ieee2800Clause532({
        lvrtBehavior: v("lvrtBehavior"),
      }),
    where: (v) => [
      tggTypeMap(v("lvrtMode"), v("lvrtBehavior"), "ieee2800"),
      tggReconcile(v("lvrtMode"), v("lvrtBehavior"), "target-wins"),
      tggComplement(["id", "defn", "V_nom", "P_rated"]),
    ],
  }),

  // 3. PSCAD IBR Proportional Gain (Kp_v) <-> IEEE 2800 Clause 5.4.1 Reactive Current Step Response (T_step)
  tggRule({
    name: "PscadIbrGainToClause541StepResponse",
    sourceLang: "pscad",
    targetLang: "ieee2800",
    source: ($, v) =>
      $.PscadIbrVoltageLoop({
        Kp_v: v("Kp_v"),
      }),
    target: ($, v) =>
      $.Ieee2800Clause541({
        stepResponseMs: v("stepResponseMs"),
      }),
    where: (v) => [
      tggInvertible("stepResponseMs = 45 / Kp_v", "Kp_v = 45 / stepResponseMs"),
      tggReconcile(v("Kp_v"), v("Kp_v"), "target-wins"),
      tggReconcilePhysics(v("Kp_v"), v("Kp_v"), { min: 0.9, max: 20.0 }),
      tggComplement(["tauStepSec", "limitMs"]),
    ],
  }),

  // 4. PSCAD IBR Integral Gain (Ki_v) <-> IEEE 2800 Clause 7.2.2.3.5 Active Power Recovery (%)
  tggRule({
    name: "PscadIbrIntegralGainToClause722Recovery",
    sourceLang: "pscad",
    targetLang: "ieee2800",
    source: ($, v) =>
      $.PscadIbrCurrentLoop({
        Ki_v: v("Ki_v"),
      }),
    target: ($, v) =>
      $.Ieee2800Clause722({
        recoveryPct: v("recoveryPct"),
      }),
    where: (v) => [
      tggInvertible("recoveryPct = 90 + 0.25 * Ki_v", "Ki_v = (recoveryPct - 90) * 4"),
      tggReconcile(v("Ki_v"), v("Ki_v"), "target-wins"),
      tggReconcilePhysics(v("Ki_v"), v("Ki_v"), { min: 0.0, max: 40.0 }),
      tggComplement(["tClearSec", "limitPct"]),
    ],
  }),
];

export const pscadIeeePolyglotConfig: PolyglotConfig = {
  languages: ["pscad", "ieee2800"],
  typeMaps: {
    ieee2800: {
      IEEE2800_Standard: "No trip or cessation",
      Legacy_Trip: "Trip or momentary cessation",
    },
  },
  rules: pscadIeeeTggRules,
};

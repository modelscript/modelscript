// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Declarative Bidirectional Triple Graph Grammar (TGG) Rules.
 *
 * Maps SPICE netlist elements (R, C, L, V) and circuit blocks to Modelica
 * Electrical.Analog components and SysML v2 part definitions with physical
 * feasibility envelopes verified via `verifyRuleLosslessness`.
 */

import { tggComplement, tggEq, tggReconcile, tggReconcilePhysics, tggRule } from "@modelscript/dsl";

export const spiceTggRules = [
  tggRule({
    name: "SpiceResistorToModelicaResistor",
    sourceLang: "spice",
    targetLang: "modelica",
    source: ($, v) =>
      $.SpiceComponent({
        kind: "R",
        name: v("name"),
        value: v("resistance"),
      }),
    target: ($, v) =>
      $.ModelicaComponent({
        type: "Modelica.Electrical.Analog.Basic.Resistor",
        name: v("name"),
        R: v("resistance"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("resistance"), v("resistance")),
      tggReconcilePhysics(v("resistance"), v("resistance"), { min: 1e-9, max: 1e12 }),
      tggComplement(["nodes", "model", "params", "rawValueExpr", "span"]),
    ],
  }),

  tggRule({
    name: "SpiceCapacitorToModelicaCapacitor",
    sourceLang: "spice",
    targetLang: "modelica",
    source: ($, v) =>
      $.SpiceComponent({
        kind: "C",
        name: v("name"),
        value: v("capacitance"),
      }),
    target: ($, v) =>
      $.ModelicaComponent({
        type: "Modelica.Electrical.Analog.Basic.Capacitor",
        name: v("name"),
        C: v("capacitance"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("capacitance"), v("capacitance")),
      tggReconcilePhysics(v("capacitance"), v("capacitance"), { min: 1e-18, max: 1e3 }),
      tggComplement(["nodes", "model", "params", "rawValueExpr", "span"]),
    ],
  }),

  tggRule({
    name: "SpiceInductorToModelicaInductor",
    sourceLang: "spice",
    targetLang: "modelica",
    source: ($, v) =>
      $.SpiceComponent({
        kind: "L",
        name: v("name"),
        value: v("inductance"),
      }),
    target: ($, v) =>
      $.ModelicaComponent({
        type: "Modelica.Electrical.Analog.Basic.Inductor",
        name: v("name"),
        L: v("inductance"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("inductance"), v("inductance")),
      tggReconcilePhysics(v("inductance"), v("inductance"), { min: 1e-15, max: 1e6 }),
      tggComplement(["nodes", "model", "params", "rawValueExpr", "span"]),
    ],
  }),

  tggRule({
    name: "SpiceVoltageSourceToModelicaVoltage",
    sourceLang: "spice",
    targetLang: "modelica",
    source: ($, v) =>
      $.SpiceComponent({
        kind: "V",
        name: v("name"),
        value: v("voltage"),
      }),
    target: ($, v) =>
      $.ModelicaComponent({
        type: "Modelica.Electrical.Analog.Sources.ConstantVoltage",
        name: v("name"),
        V: v("voltage"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("voltage"), v("voltage")),
      tggReconcile(v("voltage"), v("voltage"), "target-wins"),
      tggComplement(["nodes", "sourceSpec", "params", "rawValueExpr", "span"]),
    ],
  }),

  tggRule({
    name: "SpiceCircuitToSysmlPartDef",
    sourceLang: "spice",
    targetLang: "sysml2",
    source: ($, v) =>
      $.SpiceCircuit({
        title: v("circuitName"),
      }),
    target: ($, v) =>
      $.PartDefinition({
        name: v("circuitName"),
      }),
    where: (v) => [
      tggEq(v("circuitName"), v("circuitName")),
      tggReconcile(v("circuitName"), v("circuitName"), "source-wins"),
      tggComplement(["components", "directives", "subcircuits", "models", "comments"]),
    ],
  }),
];

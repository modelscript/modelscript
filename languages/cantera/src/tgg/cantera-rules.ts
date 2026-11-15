// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cantera — Declarative Bidirectional Triple Graph Grammar (TGG) Rules.
 *
 * Maps Cantera chemical mechanisms (phases, species, Arrhenius reactions, reactors)
 * to Modelica ThermoPower/Fluid components and SysML v2 part definitions.
 */

import { tggComplement, tggEq, tggReconcilePhysics, tggRule } from "@modelscript/dsl";

export const canteraTggRules = [
  tggRule({
    name: "CanteraPhaseToModelicaMedium",
    sourceLang: "cantera",
    targetLang: "modelica",
    source: ($, v) =>
      $["CanteraPhase"]?.({
        name: v("name"),
        temperature: v("T"),
        pressure: v("P"),
      }),
    target: ($, v) =>
      $["ModelicaComponent"]?.({
        type: "Modelica.Media.IdealGases.MixtureGases.FlueGas",
        name: v("name"),
        T_default: v("T"),
        p_default: v("P"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("T"), v("T")),
      tggEq(v("P"), v("P")),
      tggReconcilePhysics(v("T"), v("T"), { min: 1.0, max: 20000.0 }),
      tggReconcilePhysics(v("P"), v("P"), { min: 1e-3, max: 1e10 }),
      tggComplement(["thermo", "kinetics", "transport", "species", "composition", "elements"]),
    ],
  }),

  tggRule({
    name: "CanteraReactionToArrheniusRate",
    sourceLang: "cantera",
    targetLang: "modelica",
    source: ($, v) =>
      $["CanteraReaction"]?.({
        equation: v("equation"),
        A: v("A"),
        b: v("b"),
        Ea: v("Ea"),
      }),
    target: ($, v) =>
      $["ModelicaRecord"]?.({
        type: "Modelica.Fluid.Reactions.ArrheniusKinetics",
        equation: v("equation"),
        A: v("A"),
        b: v("b"),
        E_a: v("Ea"),
      }),
    where: (v) => [
      tggEq(v("equation"), v("equation")),
      tggEq(v("A"), v("A")),
      tggEq(v("b"), v("b")),
      tggEq(v("Ea"), v("Ea")),
      tggReconcilePhysics(v("A"), v("A"), { min: 0.0, max: 1e30 }),
      tggComplement(["type", "reversible", "orders", "efficiencies", "duplicate", "units"]),
    ],
  }),

  tggRule({
    name: "CanteraPhaseToSysmlPartDef",
    sourceLang: "cantera",
    targetLang: "sysml2",
    source: ($, v) =>
      $["CanteraPhase"]?.({
        name: v("name"),
        temperature: v("T"),
        pressure: v("P"),
      }),
    target: ($, v) =>
      $["SysMLPartDefinition"]?.({
        name: v("name"),
        temperature_K: v("T"),
        pressure_Pa: v("P"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("T"), v("T")),
      tggEq(v("P"), v("P")),
      tggComplement(["thermo", "kinetics", "transport", "species", "composition", "elements"]),
    ],
  }),
];

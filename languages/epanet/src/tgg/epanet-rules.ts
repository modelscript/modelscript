// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Declarative Bidirectional Triple Graph Grammar (TGG) Rules.
 *
 * Maps EPANET hydraulic network elements (Junction, Pipe, Pump) to
 * Modelica.Fluid components and SysML v2 part definitions.
 */

import { tggComplement, tggEq, tggReconcilePhysics, tggRule } from "@modelscript/dsl";

export const epanetTggRules = [
  tggRule({
    name: "EpanetJunctionToModelicaNode",
    sourceLang: "epanet",
    targetLang: "modelica",
    source: ($, v) =>
      $["EpanetJunction"]?.({
        id: v("name"),
        elevation: v("elevation"),
        demand: v("demand"),
      }),
    target: ($, v) =>
      $["ModelicaComponent"]?.({
        type: "Modelica.Fluid.Fittings.TeeJunctionVolume",
        name: v("name"),
        height: v("elevation"),
        m_flow_nominal: v("demand"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("elevation"), v("elevation")),
      tggEq(v("demand"), v("demand")),
      tggComplement(["pattern", "quality", "emitterCoeff"]),
    ],
  }),

  tggRule({
    name: "EpanetPipeToModelicaPipe",
    sourceLang: "epanet",
    targetLang: "modelica",
    source: ($, v) =>
      $["EpanetPipe"]?.({
        id: v("name"),
        length: v("length"),
        diameter: v("diameter"),
        roughness: v("roughness"),
      }),
    target: ($, v) =>
      $["ModelicaComponent"]?.({
        type: "Modelica.Fluid.Pipes.DynamicPipe",
        name: v("name"),
        length: v("length"),
        diameter: v("diameter"),
        roughness: v("roughness"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("length"), v("length")),
      tggEq(v("diameter"), v("diameter")),
      tggEq(v("roughness"), v("roughness")),
      tggReconcilePhysics(v("length"), v("length"), { min: 0.001, max: 1e6 }),
      tggReconcilePhysics(v("diameter"), v("diameter"), { min: 0.001, max: 100 }),
      tggComplement(["node1", "node2", "minorLoss", "status", "bulkCoeff", "wallCoeff"]),
    ],
  }),

  tggRule({
    name: "EpanetPipeToSysmlPartDef",
    sourceLang: "epanet",
    targetLang: "sysml2",
    source: ($, v) =>
      $["EpanetPipe"]?.({
        id: v("name"),
        length: v("length"),
        diameter: v("diameter"),
      }),
    target: ($, v) =>
      $["SysMLPartDefinition"]?.({
        name: v("name"),
        length: v("length"),
        diameter: v("diameter"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("length"), v("length")),
      tggEq(v("diameter"), v("diameter")),
      tggComplement(["node1", "node2", "roughness", "minorLoss", "status"]),
    ],
  }),
];

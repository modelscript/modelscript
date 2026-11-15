// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/swmm — Declarative Bidirectional Triple Graph Grammar (TGG) Rules.
 *
 * Maps EPA SWMM stormwater elements (Subcatchment, Conduit, Junction) to
 * Modelica.Fluid open-channel components and SysML v2 part definitions.
 */

import { tggComplement, tggEq, tggReconcilePhysics, tggRule } from "@modelscript/dsl";

export const swmmTggRules = [
  tggRule({
    name: "SwmmConduitToModelicaChannel",
    sourceLang: "swmm",
    targetLang: "modelica",
    source: ($, v) =>
      $["SwmmConduit"]?.({
        name: v("name"),
        length: v("length"),
        roughness: v("roughness"),
      }),
    target: ($, v) =>
      $["ModelicaComponent"]?.({
        type: "Modelica.Fluid.Pipes.StaticPipe",
        name: v("name"),
        length: v("length"),
        roughness: v("roughness"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("length"), v("length")),
      tggEq(v("roughness"), v("roughness")),
      tggReconcilePhysics(v("length"), v("length"), { min: 0.01, max: 1e6 }),
      tggComplement(["fromNode", "toNode", "inOffset", "outOffset", "initFlow", "maxFlow"]),
    ],
  }),

  tggRule({
    name: "SwmmSubcatchmentToSysmlPartDef",
    sourceLang: "swmm",
    targetLang: "sysml2",
    source: ($, v) =>
      $["SwmmSubcatchment"]?.({
        name: v("name"),
        area: v("area"),
        width: v("width"),
        slope: v("slope"),
        imperv: v("imperv"),
      }),
    target: ($, v) =>
      $["SysMLPartDefinition"]?.({
        name: v("name"),
        area: v("area"),
        width: v("width"),
        slope: v("slope"),
        imperv: v("imperv"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("area"), v("area")),
      tggEq(v("width"), v("width")),
      tggEq(v("slope"), v("slope")),
      tggEq(v("imperv"), v("imperv")),
      tggReconcilePhysics(v("area"), v("area"), { min: 0.0001, max: 1e7 }),
      tggReconcilePhysics(v("imperv"), v("imperv"), { min: 0, max: 100 }),
      tggComplement(["rainGage", "outlet", "curbLength", "snowPack"]),
    ],
  }),
];

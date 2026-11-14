// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/powerfactory — Declarative Bidirectional Triple Graph Grammar (TGG) Rules.
 *
 * Maps PowerFactory grid objects (ElmTerm, ElmSym, ElmLne, ElmLod, ElmTr2) to
 * PSS/E RAW entities and OpenIPSL Modelica components with physical feasibility bounds.
 */

import { tggComplement, tggEq, tggReconcilePhysics, tggRule } from "@modelscript/dsl";

export const powerFactoryTggRules = [
  tggRule({
    name: "PowerFactoryTermToPsseBus",
    sourceLang: "powerfactory",
    targetLang: "psse",
    source: ($, v) =>
      $.ElmTerm({
        loc_name: v("name"),
        uknom: v("basekV"),
      }),
    target: ($, v) =>
      $.PsseBus({
        name: v("name"),
        basekV: v("basekV"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("basekV"), v("basekV")),
      tggReconcilePhysics(v("basekV"), v("basekV"), { min: 0.1, max: 1500 }),
      tggComplement(["id", "fnom", "substatId", "bayId", "iPhtech", "x", "y"]),
    ],
  }),

  tggRule({
    name: "PowerFactorySymToModelicaGen",
    sourceLang: "powerfactory",
    targetLang: "modelica",
    source: ($, v) =>
      $.ElmSym({
        loc_name: v("name"),
        pgini: v("pMW"),
        qgini: v("qMvar"),
        usetp: v("vSetPu"),
      }),
    target: ($, v) =>
      $.ModelicaComponent({
        type: "OpenIPSL.Electrical.Machines.PSSE.GENROU",
        name: v("name"),
        P_0: v("pMW"),
        Q_0: v("qMvar"),
        V_0: v("vSetPu"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("pMW"), v("pMW")),
      tggEq(v("qMvar"), v("qMvar")),
      tggEq(v("vSetPu"), v("vSetPu")),
      tggReconcilePhysics(v("vSetPu"), v("vSetPu"), { min: 0.5, max: 1.5 }),
      tggComplement(["id", "bus1Id", "sgini", "typId", "mode", "qmax", "qmin", "outserv"]),
    ],
  }),

  tggRule({
    name: "PowerFactoryLineToPsseBranch",
    sourceLang: "powerfactory",
    targetLang: "psse",
    source: ($, v) =>
      $.ElmLne({
        loc_name: v("name"),
        dline: v("lengthKm"),
        r1: v("r1"),
        x1: v("x1"),
      }),
    target: ($, v) =>
      $.PsseBranch({
        id: v("name"),
        r: v("r1"),
        x: v("x1"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("r1"), v("r1")),
      tggEq(v("x1"), v("x1")),
      tggReconcilePhysics(v("lengthKm"), v("lengthKm"), { min: 0.001, max: 10000 }),
      tggComplement(["id", "bus1Id", "bus2Id", "typId", "b1", "r0", "x0", "b0", "inom", "outserv"]),
    ],
  }),

  tggRule({
    name: "PowerFactoryLoadToModelicaLoad",
    sourceLang: "powerfactory",
    targetLang: "modelica",
    source: ($, v) =>
      $.ElmLod({
        loc_name: v("name"),
        plini: v("pMW"),
        qlini: v("qMvar"),
      }),
    target: ($, v) =>
      $.ModelicaComponent({
        type: "OpenIPSL.Electrical.Loads.PSSE.Load",
        name: v("name"),
        P_0: v("pMW"),
        Q_0: v("qMvar"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("pMW"), v("pMW")),
      tggEq(v("qMvar"), v("qMvar")),
      tggComplement(["id", "bus1Id", "slini", "cosphi", "mode", "outserv"]),
    ],
  }),

  tggRule({
    name: "PowerFactoryTrafo2ToPsseTransformer",
    sourceLang: "powerfactory",
    targetLang: "psse",
    source: ($, v) =>
      $.ElmTr2({
        loc_name: v("name"),
        strn: v("ratingMVA"),
        nntap: v("tapPos"),
      }),
    target: ($, v) =>
      $.PsseTransformer({
        name: v("name"),
        sbase1_2: v("ratingMVA"),
        windv1: v("tapPos"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("ratingMVA"), v("ratingMVA")),
      tggEq(v("tapPos"), v("tapPos")),
      tggReconcilePhysics(v("ratingMVA"), v("ratingMVA"), { min: 0.01, max: 5000 }),
      tggComplement(["id", "bushvId", "buslvId", "typId", "ntpmn", "ntpmx", "dutap", "outserv"]),
    ],
  }),
];

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/matpower — Declarative Bidirectional Triple Graph Grammar (TGG) Rules.
 *
 * Maps MATPOWER case entities (bus, gen, branch) to PSS/E RAW and OpenIPSL
 * Modelica components with physical feasibility bounds.
 */

import { tggComplement, tggEq, tggReconcilePhysics, tggRule } from "@modelscript/dsl";

export const matpowerTggRules = [
  tggRule({
    name: "MatpowerBusToPsseBus",
    sourceLang: "matpower",
    targetLang: "psse",
    source: ($, v) =>
      $.MatpowerBus({
        bus_i: v("busId"),
        baseKV: v("baseKV"),
        vm: v("vm"),
        va: v("va"),
      }),
    target: ($, v) =>
      $.PsseBus({
        i: v("busId"),
        basekV: v("baseKV"),
        vm: v("vm"),
        va: v("va"),
      }),
    where: (v) => [
      tggEq(v("busId"), v("busId")),
      tggEq(v("baseKV"), v("baseKV")),
      tggEq(v("vm"), v("vm")),
      tggEq(v("va"), v("va")),
      tggReconcilePhysics(v("baseKV"), v("baseKV"), { min: 0.1, max: 1500 }),
      tggReconcilePhysics(v("vm"), v("vm"), { min: 0.5, max: 1.5 }),
      tggComplement(["type", "pd", "qd", "gs", "bs", "area", "vmax", "vmin", "zone"]),
    ],
  }),

  tggRule({
    name: "MatpowerGenToModelicaGen",
    sourceLang: "matpower",
    targetLang: "modelica",
    source: ($, v) =>
      $.MatpowerGen({
        bus: v("busId"),
        pg: v("pg"),
        qg: v("qg"),
        vg: v("vg"),
      }),
    target: ($, v) =>
      $.ModelicaComponent({
        type: "OpenIPSL.Electrical.Machines.PSSE.GENROU",
        bus: v("busId"),
        P_0: v("pg"),
        Q_0: v("qg"),
        V_0: v("vg"),
      }),
    where: (v) => [
      tggEq(v("busId"), v("busId")),
      tggEq(v("pg"), v("pg")),
      tggEq(v("qg"), v("qg")),
      tggEq(v("vg"), v("vg")),
      tggReconcilePhysics(v("vg"), v("vg"), { min: 0.5, max: 1.5 }),
      tggComplement(["qmax", "qmin", "mbase", "status", "pmax", "pmin"]),
    ],
  }),

  tggRule({
    name: "MatpowerBranchToPsseBranch",
    sourceLang: "matpower",
    targetLang: "psse",
    source: ($, v) =>
      $.MatpowerBranch({
        fbus: v("fromBus"),
        tbus: v("toBus"),
        r: v("r"),
        x: v("x"),
        b: v("b"),
      }),
    target: ($, v) =>
      $.PsseBranch({
        i: v("fromBus"),
        j: v("toBus"),
        r: v("r"),
        x: v("x"),
        b: v("b"),
      }),
    where: (v) => [
      tggEq(v("fromBus"), v("fromBus")),
      tggEq(v("toBus"), v("toBus")),
      tggEq(v("r"), v("r")),
      tggEq(v("x"), v("x")),
      tggEq(v("b"), v("b")),
      tggComplement(["rateA", "rateB", "rateC", "ratio", "angle", "status", "angmin", "angmax"]),
    ],
  }),
];

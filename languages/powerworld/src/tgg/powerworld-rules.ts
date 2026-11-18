// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const powerworldTggRules = [
  tggRule({
    name: "PowerWorldBusToPsseBus",
    sourceLang: "powerworld",
    targetLang: "psse",
    priority: 15,
    source: ($, v) => $["DataRow"]?.({ BusNum: v("num"), BusNomVolt: v("kv") }),
    target: ($, v) => $["BusRecord"]?.({ busNumber: v("num"), baseKv: v("kv") }),
    where: (v) => [
      tggEq(v("num"), v("num")),
      tggEq(v("kv"), v("kv")),
      tggReconcilePhysics(v("kv"), v("kv"), { min: 0.1, max: 1200.0 }),
      tggComplement(["BusName", "BusPUVolt", "BusAngle", "BusSlack"]),
    ],
  }),
];

export const powerworldPolyglotConfig: PolyglotConfig = {
  languages: ["psse", "pslf"],
  rules: powerworldTggRules,
};

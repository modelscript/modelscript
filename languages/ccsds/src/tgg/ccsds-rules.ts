// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const ccsdsTggRules = [
  tggRule({
    name: "CcsdsOemToModelicaTrajectory",
    sourceLang: "ccsds",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["OrbitStateVector"]?.({ name: v("satName"), semiMajorAxisKm: v("sma") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("satName"),
        typeSpecifier: "Modelica.Mechanics.MultiBody.Parts.Body",
        a_km: v("sma"),
      }),
    where: (v) => [
      tggEq(v("satName"), v("satName")),
      tggEq(v("sma"), v("sma")),
      tggReconcilePhysics(v("sma"), v("sma"), { min: 6400.0, max: 1e9 }),
      tggComplement(["eccentricity", "inclinationDeg", "epoch"]),
    ],
  }),
  tggRule({
    name: "CcsdsPacketToSysmlInterface",
    sourceLang: "ccsds",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["SpacePacket"]?.({ name: v("pktName"), apid: v("apid") }),
    target: ($, v) =>
      $["PortUsage"]?.({ declaredName: v("pktName"), declaredType: "SpacePacketPort", apid: v("apid") }),
    where: (v) => [
      tggEq(v("pktName"), v("pktName")),
      tggEq(v("apid"), v("apid")),
      tggComplement(["packetType", "secHeaderFlag"]),
    ],
  }),
];

export const ccsdsPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: ccsdsTggRules,
};

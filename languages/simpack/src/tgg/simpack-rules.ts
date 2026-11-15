// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const simpackTggRules = [
  tggRule({
    name: "SimpackBodyToModelicaBody",
    sourceLang: "simpack",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["RigidBody"]?.({ name: v("bodyName"), massKg: v("mass") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("bodyName"),
        typeSpecifier: "Modelica.Mechanics.MultiBody.Parts.Body",
        m: v("mass"),
      }),
    where: (v) => [
      tggEq(v("bodyName"), v("bodyName")),
      tggEq(v("mass"), v("mass")),
      tggReconcilePhysics(v("mass"), v("mass"), { min: 1e-4, max: 1e7 }),
      tggComplement(["ixx", "iyy", "izz"]),
    ],
  }),
  tggRule({
    name: "SimpackJointToSysmlConnection",
    sourceLang: "simpack",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["KinematicJoint"]?.({ name: v("jName"), jointType: v("jType") }),
    target: ($, v) => $["ConnectionUsage"]?.({ declaredName: v("jName"), jointType: v("jType") }),
    where: (v) => [tggEq(v("jName"), v("jName")), tggEq(v("jType"), v("jType")), tggComplement(["dofs"])],
  }),
];

export const simpackPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: simpackTggRules,
};

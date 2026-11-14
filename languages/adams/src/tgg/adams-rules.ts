// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/adams — Declarative Bidirectional Triple Graph Grammar (TGG) Rules.
 *
 * Maps MSC Adams multibody elements (Part, Joint, Force) to URDF links/joints
 * and Modelica.Mechanics.MultiBody components.
 */

import { tggComplement, tggEq, tggReconcilePhysics, tggRule } from "@modelscript/dsl";

export const adamsTggRules = [
  tggRule({
    name: "AdamsPartToUrdfLink",
    sourceLang: "adams",
    targetLang: "urdf",
    source: ($, v) =>
      $.AdamsPart({
        name: v("name"),
        mass: v("mass"),
      }),
    target: ($, v) =>
      $.UrdfLink({
        name: v("name"),
        mass: v("mass"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("mass"), v("mass")),
      tggReconcilePhysics(v("mass"), v("mass"), { min: 0.0, max: 1e9 }),
      tggComplement(["ixx", "iyy", "izz", "cm", "orientation", "markers"]),
    ],
  }),

  tggRule({
    name: "AdamsPartToModelicaBody",
    sourceLang: "adams",
    targetLang: "modelica",
    source: ($, v) =>
      $.AdamsPart({
        name: v("name"),
        mass: v("mass"),
      }),
    target: ($, v) =>
      $.ModelicaComponent({
        type: "Modelica.Mechanics.MultiBody.Parts.Body",
        name: v("name"),
        m: v("mass"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("mass"), v("mass")),
      tggReconcilePhysics(v("mass"), v("mass"), { min: 0.0, max: 1e9 }),
      tggComplement(["ixx", "iyy", "izz", "cm", "orientation", "markers"]),
    ],
  }),

  tggRule({
    name: "AdamsJointToUrdfJoint",
    sourceLang: "adams",
    targetLang: "urdf",
    source: ($, v) =>
      $.AdamsJoint({
        name: v("name"),
        type: v("jointType"),
      }),
    target: ($, v) =>
      $.UrdfJoint({
        name: v("name"),
        type: v("jointType"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("jointType"), v("jointType")),
      tggComplement(["iMarker", "jMarker", "friction", "limits"]),
    ],
  }),
];

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Bidirectional Triple Graph Grammar (TGG) Rules.
 *
 * Establishes declarative bijective and symmetric transformation rules mapping
 * ROS URDF / SDFormat robot links, inertial tensors, and kinematic joints to
 * Modelica.Mechanics.MultiBody parts, joints, and frame connect(...) equations.
 */

import {
  tggComplement,
  tggEq,
  tggReconcile,
  tggReconcilePhysics,
  tggRule,
  type PolyglotConfig,
} from "@modelscript/dsl";

export const urdfTggRules = [
  // 1. URDF Robot <-> Modelica Model Definition
  tggRule({
    name: "UrdfRobotToModelicaModel",
    sourceLang: "urdf",
    targetLang: "modelica",
    source: ($, v) => $.Robot({ name: v("robotName") }),
    target: ($, v) => $.ModelDefinition({ name: v("robotName") }),
    where: (v) => [
      tggEq(v("robotName"), v("robotName")),
      tggComplement(["materials"]),
    ],
  }),

  // 2. URDF Link Inertial <-> Modelica.Mechanics.MultiBody.Parts.Body
  tggRule({
    name: "UrdfLinkToMultiBodyBody",
    sourceLang: "urdf",
    targetLang: "modelica",
    source: ($, v) =>
      $.Link({
        name: v("linkName"),
        mass: v("m"),
        ixx: v("i11"),
        iyy: v("i22"),
        izz: v("i33"),
      }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("linkName"),
        typeSpecifier: "Parts.Body",
        m: v("m"),
        I_11: v("i11"),
        I_22: v("i22"),
        I_33: v("i33"),
      }),
    where: (v) => [
      tggEq(v("linkName"), v("linkName")),
      tggEq(v("m"), v("m")),
      tggEq(v("i11"), v("i11")),
      tggEq(v("i22"), v("i22")),
      tggEq(v("i33"), v("i33")),
      tggReconcile(v("m"), v("m"), "target-wins"),
      tggReconcilePhysics(v("m"), v("m"), { min: 0.001, max: 10000.0 }),
      tggReconcile(v("i11"), v("i11"), "target-wins"),
      tggReconcilePhysics(v("i11"), v("i11"), { min: 0.0, max: 10000.0 }),
      tggReconcile(v("i22"), v("i22"), "target-wins"),
      tggReconcilePhysics(v("i22"), v("i22"), { min: 0.0, max: 10000.0 }),
      tggReconcile(v("i33"), v("i33"), "target-wins"),
      tggReconcilePhysics(v("i33"), v("i33"), { min: 0.0, max: 10000.0 }),
      tggComplement(["ixy", "ixz", "iyz", "origin", "visuals", "collisions"]),
    ],
  }),

  // 3. URDF Revolute Joint <-> Modelica.Mechanics.MultiBody.Joints.Revolute
  tggRule({
    name: "UrdfRevoluteJointToModelicaRevolute",
    sourceLang: "urdf",
    targetLang: "modelica",
    source: ($, v) =>
      $.Joint({
        type: "revolute",
        name: v("jointName"),
        axis: v("axisVec"),
      }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("jointName"),
        typeSpecifier: "Joints.Revolute",
        n: v("axisVec"),
      }),
    where: (v) => [
      tggEq(v("jointName"), v("jointName")),
      tggEq(v("axisVec"), v("axisVec")),
      tggReconcile(v("axisVec"), v("axisVec"), "target-wins"),
      tggComplement(["parentLink", "childLink", "limits", "dynamics", "origin", "mimic"]),
    ],
  }),

  // 4. URDF Prismatic Joint <-> Modelica.Mechanics.MultiBody.Joints.Prismatic
  tggRule({
    name: "UrdfPrismaticJointToModelicaPrismatic",
    sourceLang: "urdf",
    targetLang: "modelica",
    source: ($, v) =>
      $.Joint({
        type: "prismatic",
        name: v("jointName"),
        axis: v("axisVec"),
      }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("jointName"),
        typeSpecifier: "Joints.Prismatic",
        e: v("axisVec"),
      }),
    where: (v) => [
      tggEq(v("jointName"), v("jointName")),
      tggEq(v("axisVec"), v("axisVec")),
      tggReconcile(v("axisVec"), v("axisVec"), "target-wins"),
      tggComplement(["parentLink", "childLink", "limits", "dynamics", "origin", "mimic"]),
    ],
  }),

  // 5. URDF Fixed Joint <-> Modelica.Mechanics.MultiBody.Joints.Fixed
  tggRule({
    name: "UrdfFixedJointToModelicaFixed",
    sourceLang: "urdf",
    targetLang: "modelica",
    source: ($, v) =>
      $.Joint({
        type: "fixed",
        name: v("jointName"),
      }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("jointName"),
        typeSpecifier: "Joints.Fixed",
      }),
    where: (v) => [
      tggEq(v("jointName"), v("jointName")),
      tggComplement(["parentLink", "childLink", "origin"]),
    ],
  }),

  // 6. URDF Parent/Child Joint Topology <-> MultiBody Frame Connect Equations
  tggRule({
    name: "UrdfJointToModelicaConnect",
    sourceLang: "urdf",
    targetLang: "modelica",
    source: ($, v) =>
      $.JointTopology({
        parentLink: v("parent"),
        jointName: v("joint"),
        childLink: v("child"),
      }),
    target: ($, v) =>
      $.ConnectChain({
        parentFrame: v("parent"),
        joint: v("joint"),
        childFrame: v("child"),
      }),
    where: (v) => [
      tggEq(v("parent"), v("parent")),
      tggEq(v("joint"), v("joint")),
      tggEq(v("child"), v("child")),
    ],
  }),

  // 7. URDF Frame Origin Offset (<origin xyz="..."/>) <-> MultiBody Parts.FixedTranslation
  tggRule({
    name: "UrdfOriginToFixedTranslation",
    sourceLang: "urdf",
    targetLang: "modelica",
    source: ($, v) =>
      $.Origin({
        name: v("originName"),
        xyz: v("rVec"),
      }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("originName"),
        typeSpecifier: "Parts.FixedTranslation",
        r: v("rVec"),
      }),
    where: (v) => [
      tggEq(v("originName"), v("originName")),
      tggEq(v("rVec"), v("rVec")),
      tggReconcile(v("rVec"), v("rVec"), "target-wins"),
      tggReconcilePhysics(v("rVec"), v("rVec"), { min: -100.0, max: 100.0 }),
      tggComplement(["rpy", "parentFrame", "childFrame"]),
    ],
  }),
];

export const urdfPolyglotConfig: PolyglotConfig = {
  languages: ["urdf", "modelica"],
  typeMaps: {
    modelica: {
      double: "Real",
      int: "Integer",
      bool: "Boolean",
      string: "String",
    },
  },
  rules: urdfTggRules,
};

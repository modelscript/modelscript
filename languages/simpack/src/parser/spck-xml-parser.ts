// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type {
  JointType,
  SimpackBody,
  SimpackForceElement,
  SimpackJoint,
  SimpackMarker,
  SimpackModel,
} from "../types.js";

import { evaluateMathExpr } from "./expr-eval.js";

function getAttr(el: XmlElement, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const a of el.attributes) {
    if (a.name.toLowerCase() === lower) {
      return a.value;
    }
  }
  return undefined;
}

function parseNum(val: string | undefined, defaultVal: number): number {
  return evaluateMathExpr(val, undefined, defaultVal);
}

/**
 * Pure AST XML Parser for SIMPACK models (.spck) using @modelscript/dsl/xml.
 * Eliminates all regular expressions and handles nested body, marker, joint, and force elements.
 */
export function parseSpckXml(xmlContent: string, defaultName: string = "SimpackModel"): SimpackModel {
  const doc = parseXml(xmlContent);
  const root = doc.root;

  const model: SimpackModel = {
    name: (root ? getAttr(root, "name") : undefined) ?? defaultName,
    bodies: new Map<string, SimpackBody>(),
    markers: new Map<string, SimpackMarker>(),
    joints: new Map<string, SimpackJoint>(),
    forces: new Map<string, SimpackForceElement>(),
  };

  if (!root) {
    return model;
  }

  function walk(el: XmlElement, currentBodyId: string = "$inertial") {
    const tag = el.name.toLowerCase();

    if (tag === "body") {
      const id = getAttr(el, "id") ?? getAttr(el, "name") ?? `body_${model.bodies.size + 1}`;
      const name = getAttr(el, "name") ?? id;
      const mass = parseNum(getAttr(el, "mass"), 1.0);
      const ixx = parseNum(getAttr(el, "ixx"), mass * 0.1);
      const iyy = parseNum(getAttr(el, "iyy"), mass * 0.1);
      const izz = parseNum(getAttr(el, "izz"), mass * 0.1);

      model.bodies.set(id, {
        id,
        name,
        mass,
        inertia: { ixx, iyy, izz },
        markerId: `m_${id}`,
      });

      // Recurse children with currentBodyId set to this body
      for (const child of el.children) {
        walk(child, id);
      }
      return;
    }

    if (tag === "marker") {
      const id = getAttr(el, "id") ?? getAttr(el, "name") ?? `marker_${model.markers.size + 1}`;
      const name = getAttr(el, "name") ?? id;
      const bodyId = getAttr(el, "body") ?? currentBodyId;
      const x = parseNum(getAttr(el, "x"), 0);
      const y = parseNum(getAttr(el, "y"), 0);
      const z = parseNum(getAttr(el, "z"), 0);

      model.markers.set(id, {
        id,
        name,
        bodyId,
        position: { x, y, z },
        orientation: { x: 0, y: 0, z: 0 },
      });
    } else if (tag === "joint") {
      const id = getAttr(el, "id") ?? `joint_${model.joints.size + 1}`;
      const name = getAttr(el, "name") ?? id;
      const type = (getAttr(el, "type")?.toLowerCase() ?? "revolute") as JointType;
      const fromMarker = getAttr(el, "from") ?? "";
      const toMarker = getAttr(el, "to") ?? "";

      model.joints.set(id, {
        id,
        name,
        type,
        fromMarker,
        toMarker,
        dofCount: type === "revolute" || type === "prismatic" ? 1 : type === "spherical" ? 3 : 6,
      });
    } else if (tag === "force" || tag === "spring" || tag === "bushing") {
      const id = getAttr(el, "id") ?? `force_${model.forces.size + 1}`;
      const name = getAttr(el, "name") ?? id;
      const markerA = getAttr(el, "from") ?? getAttr(el, "marker_a") ?? "";
      const markerB = getAttr(el, "to") ?? getAttr(el, "marker_b") ?? "";
      const kx = parseNum(getAttr(el, "kx"), 0);
      const ky = parseNum(getAttr(el, "ky"), 0);
      const kz = parseNum(getAttr(el, "kz"), 0);
      const cx = parseNum(getAttr(el, "cx"), 0);
      const cy = parseNum(getAttr(el, "cy"), 0);
      const cz = parseNum(getAttr(el, "cz"), 0);

      model.forces.set(id, {
        id,
        name,
        type: "spring_damper",
        markerA,
        markerB,
        stiffness: { x: kx, y: ky, z: kz },
        damping: { x: cx, y: cy, z: cz },
      });
    }

    // Traverse other child elements
    for (const child of el.children) {
      walk(child, currentBodyId);
    }
  }

  walk(root);
  return model;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Bidirectional TGG Round-Trip Synchronizer.
 *
 * Executes declarative TGG rules via `PolyglotTransformer` (`evaluateRuleForward` /
 * `evaluateRuleBackward`), `parseModelicaCst`, and `@modelscript/dsl` lossless XML CST
 * splicing (`xml.parseXml`, `setAttributeSplice`, `appendChildSplice`, `applySplices`)
 * to round-trip ROS URDF <-> Modelica.Mechanics.MultiBody while preserving shadow
 * complements (joint limits, off-diagonal inertia, visual/collision meshes, comments).
 */

import { xml } from "@modelscript/dsl";
import type { Splice, XmlElement } from "@modelscript/dsl/xml";
import { PolyglotTransformer, parseModelicaCst } from "@modelscript/runtime";
import { parseUrdf } from "../parser/urdf-parser.js";
import { urdfToModelica } from "../projections/modelica.js";
import type { UrdfJoint, UrdfRobot } from "../types.js";
import { urdfPolyglotConfig } from "./urdf-rules.js";

export type ConflictResolution = ReturnType<PolyglotTransformer["getConflicts"]>[number];

export interface UrdfSyncChange {
  target: "link" | "joint" | "connection";
  elementId: string;
  property?: string;
  sourceOldVal?: unknown;
  targetNewVal?: unknown;
  reconciledVal: unknown;
  strategy: string;
}

export interface UrdfSyncOptions {
  strategy?: "source-wins" | "target-wins" | "physics-simplex";
  compactSnippet?: boolean;
}

export interface UrdfSyncResult {
  updatedText: string;
  changes: UrdfSyncChange[];
  conflicts: ReturnType<PolyglotTransformer["getConflicts"]>;
  transformer: PolyglotTransformer;
}

function findXmlElements(el: XmlElement | null | undefined, tagName: string, out: XmlElement[] = []): XmlElement[] {
  if (!el) return out;
  if (el.name.toLowerCase() === tagName.toLowerCase()) out.push(el);
  for (const c of el.children) findXmlElements(c, tagName, out);
  return out;
}

function parseVector3Literal(raw: string | undefined): [number, number, number] | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^[{[]|[}\]]$/g, "");
  const parts = trimmed.split(",").map((s) => parseFloat(s.trim()));
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    return [parts[0]!, parts[1]!, parts[2]!];
  }
  return null;
}

function fmtMass(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

/**
 * Executes forward TGG projection (ROS URDF -> Modelica.Mechanics.MultiBody)
 * while recording correspondence threads and shadow complements via `evaluateRuleForward`.
 */
export function projectUrdfViaTgg(
  urdfXmlOrRobot: string | UrdfRobot,
  options?: { compactSnippet?: boolean; transformer?: PolyglotTransformer },
): { modelicaText: string; transformer: PolyglotTransformer; robot: UrdfRobot } {
  const robot = typeof urdfXmlOrRobot === "string" ? parseUrdf(urdfXmlOrRobot) : urdfXmlOrRobot;
  const transformer = options?.transformer ?? new PolyglotTransformer(urdfPolyglotConfig);

  transformer.evaluateRuleForward(
    {
      kind: "Robot",
      name: robot.name,
      materials: robot.materials,
      properties: { name: robot.name, materials: robot.materials },
    },
    "modelica",
    robot.name,
  );

  let linkIdx = 0;
  for (const link of robot.links.values()) {
    const m = link.inertial?.mass ?? 1.0;
    const i11 = link.inertial?.ixx ?? m * 0.1;
    const i22 = link.inertial?.iyy ?? m * 0.1;
    const i33 = link.inertial?.izz ?? m * 0.1;

    const linkProps = {
      name: link.name,
      mass: m,
      ixx: i11,
      iyy: i22,
      izz: i33,
      ixy: link.inertial?.ixy ?? 0,
      ixz: link.inertial?.ixz ?? 0,
      iyz: link.inertial?.iyz ?? 0,
      origin: link.inertial?.origin,
      visuals: link.visuals,
      collisions: link.collisions,
    };

    transformer.evaluateRuleForward(
      {
        kind: "Link",
        ...linkProps,
        properties: linkProps,
      },
      "modelica",
      `link:${link.name}`,
    );
    const comp = transformer.getComplement(`link:${link.name}`) ?? {};
    transformer.storeComplement(`pos:link:${linkIdx++}`, comp);
  }

  let jointIdx = 0;
  for (const joint of robot.joints.values()) {
    const axisStr = `${joint.axis.x} ${joint.axis.y} ${joint.axis.z}`;
    const jointProps = {
      name: joint.name,
      type: joint.type === "continuous" ? "revolute" : joint.type,
      axis: axisStr,
      parentLink: joint.parentLink,
      childLink: joint.childLink,
      limits: joint.limits,
      dynamics: joint.dynamics,
      origin: joint.origin,
      mimic: joint.mimic,
    };

    transformer.evaluateRuleForward(
      {
        kind: "Joint",
        ...jointProps,
        properties: jointProps,
      },
      "modelica",
      `joint:${joint.name}`,
    );
    const comp = transformer.getComplement(`joint:${joint.name}`) ?? {};
    transformer.storeComplement(`pos:joint:${jointIdx++}`, comp);

    transformer.evaluateRuleForward(
      {
        kind: "JointTopology",
        name: `topo:${joint.name}`,
        parentLink: joint.parentLink,
        jointName: joint.name,
        childLink: joint.childLink,
        properties: {
          parentLink: joint.parentLink,
          jointName: joint.name,
          childLink: joint.childLink,
        },
      },
      "modelica",
      `topo:${joint.name}`,
    );

    if (joint.origin) {
      const originName = `${joint.name}_trans`;
      const xyzStr = `${joint.origin.xyz.x} ${joint.origin.xyz.y} ${joint.origin.xyz.z}`;
      transformer.evaluateRuleForward(
        {
          kind: "Origin",
          name: originName,
          originName,
          xyz: xyzStr,
          rpy: joint.origin.rpy,
          parentFrame: joint.parentLink,
          childFrame: joint.childLink,
          properties: {
            originName,
            xyz: xyzStr,
            rpy: joint.origin.rpy,
            parentFrame: joint.parentLink,
            childFrame: joint.childLink,
          },
        },
        "modelica",
        `origin:${originName}`,
      );
    }
  }

  const compact = options?.compactSnippet ?? false;
  transformer.registerEmitter("modelica", () => {
    const fullMo = urdfToModelica(robot).replace(/\n\s*annotation\(Placement\([^;]*;/g, ";");
    if (!compact) {
      return fullMo.trim();
    }
    return fullMo
      .split("\n")
      .filter(
        (line) =>
          !line.startsWith("model ") &&
          !line.startsWith('  "Synthesized') &&
          !line.startsWith("  import ") &&
          !line.startsWith("  MultiBody.World ") &&
          !line.startsWith("end "),
      )
      .filter((line, idx, arr) => !(line.trim() === "" && (idx === 0 || arr[idx - 1]?.trim() === "")))
      .join("\n")
      .replace(/^\n+|\n+$/g, "");
  });

  const modelicaText = transformer.transform(
    { kind: "UrdfRobot", name: robot.name || "Robot", properties: {} },
    "modelica",
  );
  return { modelicaText, transformer, robot };
}

/**
 * Synchronizes modified Modelica.Mechanics.MultiBody code back into ROS URDF XML
 * using `parseModelicaCst`, declarative TGG backward evaluation (`evaluateRuleBackward`),
 * and `@modelscript/dsl` lossless XML CST splicing.
 */
export function synchronizeModelicaToUrdf(
  originalUrdfXml: string,
  modifiedModelicaText: string,
  options?: UrdfSyncOptions,
): UrdfSyncResult {
  const { transformer, robot } = projectUrdfViaTgg(originalUrdfXml);
  const strategy = options?.strategy ?? "target-wins";
  const changes: UrdfSyncChange[] = [];

  const moCst = parseModelicaCst(modifiedModelicaText);
  const bodyComps = moCst.components.filter((c) => c.typeSpecifier.endsWith("Parts.Body") || c.typeSpecifier === "Body");
  if (bodyComps.length === 0) {
    throw new Error("Expected at least one 'Parts.Body <name>(m = ..., I_11 = ..., I_22 = ..., I_33 = ...);' declaration.");
  }

  const origLinks = Array.from(robot.links.values());

  // 1. Reconcile Parts.Body components via declarative TGG rule #2
  for (let idx = 0; idx < bodyComps.length; idx++) {
    const bComp = bodyComps[idx]!;
    const newM = parseFloat(bComp.modifications["m"] ?? "1.0");
    const newI11 = parseFloat(bComp.modifications["I_11"] ?? "0.1");
    const newI22 = parseFloat(bComp.modifications["I_22"] ?? "0.1");
    const newI33 = parseFloat(bComp.modifications["I_33"] ?? "0.1");

    const existingLink =
      robot.links.get(bComp.name) ??
      (bodyComps.length === origLinks.length ? origLinks[idx] : undefined);
    const threadKey = existingLink ? `link:${existingLink.name}` : `link:${bComp.name}`;

    const backRes = transformer.evaluateRuleBackward(
      {
        kind: "ComponentDeclaration",
        name: bComp.name,
        typeSpecifier: "Parts.Body",
        m: newM,
        I_11: newI11,
        I_22: newI22,
        I_33: newI33,
        properties: {
          name: bComp.name,
          typeSpecifier: "Parts.Body",
          m: newM,
          I_11: newI11,
          I_22: newI22,
          I_33: newI33,
        },
      },
      "urdf",
      {
        strategy,
        threadId: threadKey,
        fallbackThreadId: `pos:link:${idx}`,
      },
    );

    const resolvedM = Number(backRes?.sourceNode["properties"]?.["mass"] ?? newM);
    const resolvedI11 = Number(backRes?.sourceNode["properties"]?.["ixx"] ?? newI11);
    const resolvedI22 = Number(backRes?.sourceNode["properties"]?.["iyy"] ?? newI22);
    const resolvedI33 = Number(backRes?.sourceNode["properties"]?.["izz"] ?? newI33);

    if (existingLink && existingLink.inertial) {
      const inert = existingLink.inertial;
      if (existingLink.name !== bComp.name) {
        robot.links.delete(existingLink.name);
        existingLink.name = bComp.name;
        robot.links.set(bComp.name, existingLink);
      }
      if (inert.mass !== newM) {
        changes.push({
          target: "link",
          elementId: bComp.name,
          property: "mass",
          sourceOldVal: inert.mass,
          targetNewVal: newM,
          reconciledVal: resolvedM,
          strategy,
        });
        inert.mass = resolvedM;
      }
      if (inert.ixx !== newI11) {
        inert.ixx = resolvedI11;
        changes.push({
          target: "link",
          elementId: bComp.name,
          property: "ixx",
          reconciledVal: resolvedI11,
          strategy,
        });
      }
      if (inert.iyy !== newI22) {
        inert.iyy = resolvedI22;
        changes.push({
          target: "link",
          elementId: bComp.name,
          property: "iyy",
          reconciledVal: resolvedI22,
          strategy,
        });
      }
      if (inert.izz !== newI33) {
        inert.izz = resolvedI33;
        changes.push({
          target: "link",
          elementId: bComp.name,
          property: "izz",
          reconciledVal: resolvedI33,
          strategy,
        });
      }
    } else {
      robot.links.set(bComp.name, {
        name: bComp.name,
        inertial: {
          mass: resolvedM,
          ixx: resolvedI11,
          ixy: 0,
          ixz: 0,
          iyy: resolvedI22,
          iyz: 0,
          izz: resolvedI33,
        },
        visuals: [],
        collisions: [],
      });
      changes.push({
        target: "link",
        elementId: bComp.name,
        reconciledVal: resolvedM,
        strategy,
      });
    }
  }

  // 2. Reconcile Joints.Revolute, Joints.Prismatic, Joints.Fixed, and FixedTranslation origins
  const jointComps = moCst.components.filter(
    (c) =>
      c.typeSpecifier.endsWith("Joints.Revolute") ||
      c.typeSpecifier.endsWith("Joints.Prismatic") ||
      c.typeSpecifier.endsWith("Joints.Fixed"),
  );
  const origJoints = Array.from(robot.joints.values());

  for (let idx = 0; idx < jointComps.length; idx++) {
    const jComp = jointComps[idx]!;
    const jKind: UrdfJoint["type"] = jComp.typeSpecifier.endsWith("Prismatic")
      ? "prismatic"
      : jComp.typeSpecifier.endsWith("Fixed")
        ? "fixed"
        : "revolute";
    const rawVec = parseVector3Literal(jComp.modifications["n"] ?? jComp.modifications["e"]) ?? [0, 0, 1];
    const axisStr = `${rawVec[0]} ${rawVec[1]} ${rawVec[2]}`;

    const existingJoint =
      robot.joints.get(jComp.name) ??
      (jointComps.length === origJoints.length ? origJoints[idx] : undefined);
    const threadKey = existingJoint ? `joint:${existingJoint.name}` : `joint:${jComp.name}`;

    const targetTypeSpec =
      jKind === "prismatic"
        ? "Joints.Prismatic"
        : jKind === "fixed"
          ? "Joints.Fixed"
          : "Joints.Revolute";

    const backRes = transformer.evaluateRuleBackward(
      {
        kind: "ComponentDeclaration",
        name: jComp.name,
        typeSpecifier: targetTypeSpec,
        ...(jKind === "prismatic" ? { e: axisStr } : jKind === "revolute" ? { n: axisStr } : {}),
        properties: {
          name: jComp.name,
          typeSpecifier: targetTypeSpec,
          ...(jKind === "prismatic" ? { e: axisStr } : jKind === "revolute" ? { n: axisStr } : {}),
        },
      },
      "urdf",
      {
        strategy,
        threadId: threadKey,
        fallbackThreadId: `pos:joint:${idx}`,
      },
    );

    const resolvedAxisStr = String(backRes?.sourceNode["properties"]?.["axis"] ?? axisStr);
    const [ax = rawVec[0], ay = rawVec[1], az = rawVec[2]] = resolvedAxisStr.split(/\s+/).map(Number);

    if (existingJoint) {
      if (existingJoint.name !== jComp.name) {
        robot.joints.delete(existingJoint.name);
        existingJoint.name = jComp.name;
        robot.joints.set(jComp.name, existingJoint);
      }
      if (existingJoint.axis.x !== ax || existingJoint.axis.y !== ay || existingJoint.axis.z !== az) {
        existingJoint.axis = { x: ax, y: ay, z: az };
        changes.push({
          target: "joint",
          elementId: jComp.name,
          property: "axis",
          reconciledVal: `${ax} ${ay} ${az}`,
          strategy,
        });
      }
      existingJoint.type = jKind;
    } else {
      const linkNames = Array.from(robot.links.keys());
      robot.joints.set(jComp.name, {
        name: jComp.name,
        type: jKind,
        parentLink: linkNames[0] ?? "base_link",
        childLink: linkNames[1] ?? "shoulder_link",
        axis: { x: ax, y: ay, z: az },
      });
    }
  }

  // Reconcile FixedTranslation `r = {x, y, z}` into joint `<origin xyz="x y z"/>` via Rule #7
  const transComps = moCst.components.filter((c) => c.typeSpecifier.endsWith("FixedTranslation"));
  for (const tc of transComps) {
    const rVec = parseVector3Literal(tc.modifications["r"]);
    if (!rVec) continue;
    const rStr = `${rVec[0]} ${rVec[1]} ${rVec[2]}`;
    const originBack = transformer.evaluateRuleBackward(
      {
        kind: "ComponentDeclaration",
        name: tc.name,
        originName: tc.name,
        typeSpecifier: "Parts.FixedTranslation",
        r: rStr,
        properties: {
          originName: tc.name,
          typeSpecifier: "Parts.FixedTranslation",
          r: rStr,
        },
      },
      "urdf",
      {
        strategy,
        threadId: `origin:${tc.name}`,
      },
    );
    const resolvedXyzStr = String(originBack?.sourceNode["properties"]?.["xyz"] ?? rStr);
    const [rx = rVec[0], ry = rVec[1], rz = rVec[2]] = resolvedXyzStr.split(/\s+/).map(Number);
    const jName = tc.name.replace(/_(?:trans|origin)$/, "");
    const joint = robot.joints.get(jName);
    if (joint) {
      const prevXyz = joint.origin?.xyz;
      if (!prevXyz || prevXyz.x !== rx || prevXyz.y !== ry || prevXyz.z !== rz) {
        changes.push({
          target: "joint",
          elementId: jName,
          property: "origin.xyz",
          reconciledVal: `${rx} ${ry} ${rz}`,
          strategy,
        });
      }
      const prevRpy = joint.origin?.rpy;
      const compRpy = (originBack as unknown as { complement?: Record<string, unknown> } | undefined)?.complement?.[
        "rpy"
      ] as { x: number; y: number; z: number } | undefined;
      joint.origin = {
        xyz: { x: rx, y: ry, z: rz },
        rpy: compRpy ?? prevRpy ?? { x: 0, y: 0, z: 0 },
      };
    }
  }

  // 3. Reconcile parent/child connections from `connect(parent.frame_b, joint.frame_a)`
  const parentByJoint = new Map<string, string>();
  const childByJoint = new Map<string, string>();
  for (const conn of moCst.connections) {
    const fromElem = conn.from.split(".")[0]!;
    const toElem = conn.to.split(".")[0]!;
    if (fromElem === "world") continue;
    if (robot.joints.has(toElem)) {
      parentByJoint.set(toElem, fromElem.replace(/_trans$/, ""));
    } else if (robot.joints.has(fromElem)) {
      childByJoint.set(fromElem, toElem);
    }
  }

  for (const joint of robot.joints.values()) {
    const newParent = parentByJoint.get(joint.name);
    const newChild = childByJoint.get(joint.name);
    if (newParent && newParent !== joint.parentLink) {
      joint.parentLink = newParent;
    }
    if (newChild && newChild !== joint.childLink) {
      joint.childLink = newChild;
    }
  }

  const updatedText = patchUrdfXmlViaCst(originalUrdfXml, robot);
  return {
    updatedText,
    changes,
    conflicts: transformer.getConflicts(),
    transformer,
  };
}

/**
 * Applies surgical XML CST splices (`@modelscript/dsl/xml`) to the original URDF XML,
 * preserving XML comments, off-diagonal inertia attributes (`ixy`, `ixz`, `iyz`),
 * `<limit>`, `<visual>`, `<collision>`, and attribute formatting.
 */
function patchUrdfXmlViaCst(originalXml: string, robot: UrdfRobot): string {
  const xmlDoc = xml.parseXml(originalXml);
  if (!xmlDoc.root) {
    return originalXml;
  }

  const splices: Splice[] = [];
  const robotEl = xmlDoc.root.name.toLowerCase() === "robot" ? xmlDoc.root : findXmlElements(xmlDoc.root, "robot")[0];
  const linkEls = findXmlElements(xmlDoc.root, "link");
  const jointEls = findXmlElements(xmlDoc.root, "joint");

  let linkIdx = 0;
  for (const link of robot.links.values()) {
    const linkEl =
      linkEls.find((el) => el.attributes.find((a: any) => a.name === "name")?.value === link.name) ?? linkEls[linkIdx];
    linkIdx++;

    if (linkEl && link.inertial) {
      const nameAttr = linkEl.attributes.find((a: any) => a.name === "name");
      if (nameAttr && nameAttr.value !== link.name) {
        splices.push(xml.setAttributeSplice(linkEl, "name", link.name, originalXml));
      }

      const massEl = findXmlElements(linkEl, "mass")[0];
      const inertiaEl = findXmlElements(linkEl, "inertia")[0];
      const isCompact =
        link.inertial.ixx === link.inertial.iyy &&
        link.inertial.iyy === link.inertial.izz &&
        Number.isInteger(link.inertial.mass);
      const massStr = isCompact ? fmtMass(link.inertial.mass) : String(link.inertial.mass);

      if (massEl) {
        const curMass = massEl.attributes.find((a: any) => a.name === "value")?.value;
        if (curMass !== massStr && Number(curMass) !== link.inertial.mass) {
          splices.push(xml.setAttributeSplice(massEl, "value", massStr, originalXml));
        }
      }
      if (inertiaEl) {
        const updateAttrIfChanged = (attrName: string, numVal: number) => {
          const cur = inertiaEl.attributes.find((a: any) => a.name === attrName)?.value;
          if (cur === undefined || Number(cur) !== numVal) {
            splices.push(xml.setAttributeSplice(inertiaEl, attrName, String(numVal), originalXml));
          }
        };
        updateAttrIfChanged("ixx", link.inertial.ixx);
        updateAttrIfChanged("iyy", link.inertial.iyy);
        updateAttrIfChanged("izz", link.inertial.izz);
      }
    } else if (robotEl && !robotEl.selfClosing && link.inertial) {
      const i = link.inertial;
      const newLinkXml = `<link name="${link.name}">\n    <inertial><mass value="${fmtMass(i.mass)}"/><inertia ixx="${i.ixx}" ixy="${i.ixy}" ixz="${i.ixz}" iyy="${i.iyy}" iyz="${i.iyz}" izz="${i.izz}"/></inertial>\n  </link>`;
      splices.push(xml.appendChildSplice(robotEl, newLinkXml, originalXml));
    }
  }

  let jointIdx = 0;
  for (const joint of robot.joints.values()) {
    const jointEl =
      jointEls.find((el) => el.attributes.find((a: any) => a.name === "name")?.value === joint.name) ?? jointEls[jointIdx];
    jointIdx++;

    if (jointEl) {
      const nameAttr = jointEl.attributes.find((a: any) => a.name === "name");
      if (nameAttr && nameAttr.value !== joint.name) {
        splices.push(xml.setAttributeSplice(jointEl, "name", joint.name, originalXml));
      }
      const typeAttr = jointEl.attributes.find((a: any) => a.name === "type");
      if (typeAttr && typeAttr.value !== joint.type && !(typeAttr.value === "continuous" && joint.type === "revolute")) {
        splices.push(xml.setAttributeSplice(jointEl, "type", joint.type, originalXml));
      }
      const parentEl = findXmlElements(jointEl, "parent")[0];
      if (parentEl && parentEl.attributes.find((a: any) => a.name === "link")?.value !== joint.parentLink) {
        splices.push(xml.setAttributeSplice(parentEl, "link", joint.parentLink, originalXml));
      }
      const childEl = findXmlElements(jointEl, "child")[0];
      if (childEl && childEl.attributes.find((a: any) => a.name === "link")?.value !== joint.childLink) {
        splices.push(xml.setAttributeSplice(childEl, "link", joint.childLink, originalXml));
      }
      const axisEl = findXmlElements(jointEl, "axis")[0];
      const newXyz = `${joint.axis.x} ${joint.axis.y} ${joint.axis.z}`;
      if (axisEl && axisEl.attributes.find((a: any) => a.name === "xyz")?.value !== newXyz) {
        splices.push(xml.setAttributeSplice(axisEl, "xyz", newXyz, originalXml));
      }
      if (joint.origin) {
        const originEl = findXmlElements(jointEl, "origin")[0];
        const origXyz = `${joint.origin.xyz.x} ${joint.origin.xyz.y} ${joint.origin.xyz.z}`;
        if (originEl && originEl.attributes.find((a: any) => a.name === "xyz")?.value !== origXyz) {
          splices.push(xml.setAttributeSplice(originEl, "xyz", origXyz, originalXml));
        }
      }
    } else if (robotEl && !robotEl.selfClosing) {
      const newJointXml = `<joint name="${joint.name}" type="${joint.type}">\n    <parent link="${joint.parentLink}"/>\n    <child link="${joint.childLink}"/>\n    <axis xyz="${joint.axis.x} ${joint.axis.y} ${joint.axis.z}"/>\n  </joint>`;
      splices.push(xml.appendChildSplice(robotEl, newJointXml, originalXml));
    }
  }

  return xml.applySplices(originalXml, splices);
}

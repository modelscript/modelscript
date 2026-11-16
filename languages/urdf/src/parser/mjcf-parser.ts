// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Zero-Dependency MuJoCo MJCF XML Parser.
 *
 * Parses `<mujoco>` XML files into an enriched `UrdfRobot` representation,
 * resolving `<default>` class inheritance hierarchies, `<compiler>` angle units,
 * `<asset>` mesh/material definitions, nested `<body>` kinematic trees with
 * `<freejoint>`, `<inertial>`, `<geom>` contact parameters (`condim`, `friction`,
 * `solref`, `solimp`), `<site>` frames, `<actuator>`, and `<sensor>` declarations.
 */

import type { XmlElement } from "@modelscript/dsl/xml";
import type {
  MjcfActuatorSpec,
  MjcfContactParams,
  MjcfSensorSpec,
  MjcfSiteSpec,
  UrdfCollision,
  UrdfColor,
  UrdfGeometry,
  UrdfInertial,
  UrdfJoint,
  UrdfJointType,
  UrdfLink,
  UrdfMaterial,
  UrdfOrigin,
  UrdfRobot,
  UrdfVisual,
  Vector3D,
} from "../types.js";
import { parseUrdfXmlDocument } from "./wasm-loader.js";

function getAttr(el: XmlElement, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const a of el.attributes) {
    if (a.name.toLowerCase() === lower) return a.value;
  }
  return undefined;
}

function tokenizeNumbers(str?: string): number[] {
  if (!str) return [];
  const nums: number[] = [];
  let start = -1;
  for (let i = 0; i <= str.length; i++) {
    const ch = i < str.length ? str.charCodeAt(i) : 32;
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 44) {
      if (start >= 0) {
        const val = Number.parseFloat(str.slice(start, i));
        if (!Number.isNaN(val)) nums.push(val);
        start = -1;
      }
    } else if (start < 0) {
      start = i;
    }
  }
  return nums;
}

function parseVec3(str?: string, fallback: Vector3D = { x: 0, y: 0, z: 0 }): Vector3D {
  if (!str) return { ...fallback };
  const n = tokenizeNumbers(str);
  return { x: n[0] ?? fallback.x, y: n[1] ?? fallback.y, z: n[2] ?? fallback.z };
}

/** Converts MuJoCo quaternion `[w, x, y, z]` to intrinsic XYZ Euler angles (roll, pitch, yaw) [rad]. */
function quatWxyzToRpy(w: number, x: number, y: number, z: number): Vector3D {
  const norm = Math.hypot(w, x, y, z) || 1;
  const qw = w / norm;
  const qx = x / norm;
  const qy = y / norm;
  const qz = z / norm;

  const sinrCosp = 2 * (qw * qx + qy * qz);
  const cosrCosp = 1 - 2 * (qx * qx + qy * qy);
  const roll = Math.atan2(sinrCosp, cosrCosp);

  const sinp = 2 * (qw * qy - qz * qx);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);

  const sinyCosp = 2 * (qw * qz + qx * qy);
  const cosyCosp = 1 - 2 * (qy * qy + qz * qz);
  const yaw = Math.atan2(sinyCosp, cosyCosp);

  return { x: roll, y: pitch, z: yaw };
}

function parseOrigin(el: XmlElement, angleScale: number): UrdfOrigin {
  const xyz = parseVec3(getAttr(el, "pos"));
  let rpy: Vector3D = { x: 0, y: 0, z: 0 };
  const quatStr = getAttr(el, "quat");
  const eulerStr = getAttr(el, "euler");
  if (quatStr) {
    const q = tokenizeNumbers(quatStr);
    if (q.length >= 4) {
      rpy = quatWxyzToRpy(q[0]!, q[1]!, q[2]!, q[3]!);
    }
  } else if (eulerStr) {
    const e = tokenizeNumbers(eulerStr);
    rpy = {
      x: (e[0] ?? 0) * angleScale,
      y: (e[1] ?? 0) * angleScale,
      z: (e[2] ?? 0) * angleScale,
    };
  }
  return { xyz, rpy };
}

function parseColor(str?: string): UrdfColor | undefined {
  if (!str) return undefined;
  const n = tokenizeNumbers(str);
  if (n.length < 3) return undefined;
  return { r: n[0]!, g: n[1]!, b: n[2]!, a: n[3] ?? 1.0 };
}

interface DefaultClassEntry {
  joint: Record<string, string>;
  geom: Record<string, string>;
  position: Record<string, string>;
  motor: Record<string, string>;
  velocity: Record<string, string>;
}

function emptyDefaultEntry(): DefaultClassEntry {
  return { joint: {}, geom: {}, position: {}, motor: {}, velocity: {} };
}

function copyAttrs(el: XmlElement, target: Record<string, string>): void {
  for (const attr of el.attributes) {
    target[attr.name.toLowerCase()] = attr.value;
  }
}

function collectDefaults(el: XmlElement, parent: DefaultClassEntry, map: Map<string, DefaultClassEntry>): void {
  const className = getAttr(el, "class") ?? "main";
  const current: DefaultClassEntry = {
    joint: { ...parent.joint },
    geom: { ...parent.geom },
    position: { ...parent.position },
    motor: { ...parent.motor },
    velocity: { ...parent.velocity },
  };
  for (const child of el.children) {
    const tag = child.name.toLowerCase();
    if (tag === "joint") copyAttrs(child, current.joint);
    else if (tag === "geom") copyAttrs(child, current.geom);
    else if (tag === "position") copyAttrs(child, current.position);
    else if (tag === "motor") copyAttrs(child, current.motor);
    else if (tag === "velocity") copyAttrs(child, current.velocity);
  }
  map.set(className, current);
  for (const child of el.children) {
    if (child.name.toLowerCase() === "default") {
      collectDefaults(child, current, map);
    }
  }
}

function mergedAttr(el: XmlElement, defaults: Record<string, string> | undefined, name: string): string | undefined {
  return getAttr(el, name) ?? defaults?.[name.toLowerCase()];
}

function parseInertial(el: XmlElement, angleScale: number): UrdfInertial {
  const origin = parseOrigin(el, angleScale);
  const mass = Number.parseFloat(getAttr(el, "mass") ?? "1") || 1;
  const diag = tokenizeNumbers(getAttr(el, "diaginertia"));
  const full = tokenizeNumbers(getAttr(el, "fullinertia"));
  if (full.length >= 6) {
    return {
      origin,
      mass,
      ixx: full[0]!,
      iyy: full[1]!,
      izz: full[2]!,
      ixy: full[3]!,
      ixz: full[4]!,
      iyz: full[5]!,
    };
  }
  return {
    origin,
    mass,
    ixx: diag[0] ?? mass * 0.01,
    iyy: diag[1] ?? mass * 0.01,
    izz: diag[2] ?? mass * 0.01,
    ixy: 0,
    ixz: 0,
    iyz: 0,
  };
}

function parseGeom(
  el: XmlElement,
  defaults: Record<string, string> | undefined,
  meshAssets: Map<string, { file: string; scale?: Vector3D | undefined }>,
  materials: Map<string, UrdfMaterial>,
  angleScale: number,
): { visual?: UrdfVisual | undefined; collision?: UrdfCollision | undefined } {
  const name = getAttr(el, "name");
  const typeAttr = (mergedAttr(el, defaults, "type") ?? "sphere").toLowerCase();
  const sizeNums = tokenizeNumbers(mergedAttr(el, defaults, "size"));
  const origin = parseOrigin(el, angleScale);

  let geometry: UrdfGeometry;
  if (typeAttr === "box") {
    geometry = {
      type: "box",
      size: {
        x: (sizeNums[0] ?? 0.05) * 2,
        y: (sizeNums[1] ?? sizeNums[0] ?? 0.05) * 2,
        z: (sizeNums[2] ?? sizeNums[0] ?? 0.05) * 2,
      },
    };
  } else if (typeAttr === "cylinder" || typeAttr === "capsule") {
    geometry = {
      type: typeAttr,
      radius: sizeNums[0] ?? 0.02,
      length: (sizeNums[1] ?? 0.05) * 2,
    };
  } else if (typeAttr === "plane") {
    geometry = {
      type: "plane",
      size: { x: (sizeNums[0] ?? 10) * 2, y: (sizeNums[1] ?? 10) * 2, z: 0 },
    };
  } else if (typeAttr === "mesh") {
    const meshName = mergedAttr(el, defaults, "mesh") ?? "";
    const asset = meshAssets.get(meshName);
    geometry = {
      type: "mesh",
      filename: asset?.file ?? meshName,
      scale: asset?.scale,
    };
  } else {
    geometry = {
      type: "sphere",
      radius: sizeNums[0] ?? 0.02,
    };
  }

  const contypeStr = mergedAttr(el, defaults, "contype");
  const conaffinityStr = mergedAttr(el, defaults, "conaffinity");
  const contype = contypeStr !== undefined ? Number.parseInt(contypeStr, 10) : 1;
  const conaffinity = conaffinityStr !== undefined ? Number.parseInt(conaffinityStr, 10) : 1;
  const groupStr = mergedAttr(el, defaults, "group");
  const group = groupStr !== undefined ? Number.parseInt(groupStr, 10) : 0;

  const frictionNums = tokenizeNumbers(mergedAttr(el, defaults, "friction"));
  const solrefNums = tokenizeNumbers(mergedAttr(el, defaults, "solref"));
  const solimpNums = tokenizeNumbers(mergedAttr(el, defaults, "solimp"));
  const condimStr = mergedAttr(el, defaults, "condim");
  const marginStr = mergedAttr(el, defaults, "margin");

  const contact: MjcfContactParams = {
    condim: condimStr ? Number.parseInt(condimStr, 10) : 3,
    friction:
      frictionNums.length > 0
        ? [frictionNums[0]!, frictionNums[1] ?? 0.005, frictionNums[2] ?? 0.0001]
        : [1.0, 0.005, 0.0001],
    solref: solrefNums.length >= 2 ? [solrefNums[0]!, solrefNums[1]!] : [0.02, 1.0],
    solimp:
      solimpNums.length >= 3
        ? [solimpNums[0]!, solimpNums[1]!, solimpNums[2]!, solimpNums[3] ?? 0.5, solimpNums[4] ?? 2]
        : [0.9, 0.95, 0.001, 0.5, 2],
    contype,
    conaffinity,
    margin: marginStr ? Number.parseFloat(marginStr) : 0,
  };

  const matName = mergedAttr(el, defaults, "material");
  const rgba = parseColor(mergedAttr(el, defaults, "rgba"));
  const material = matName ? materials.get(matName) : rgba ? { name: name ?? "geom_mat", color: rgba } : undefined;

  const isVisual = group === 0 || group === 1 || group === 2;
  const isCollision = contype !== 0 || conaffinity !== 0;

  return {
    visual: isVisual ? { name, origin, geometry, material } : undefined,
    collision: isCollision ? { name, origin, geometry, contact } : undefined,
  };
}

/** Returns true if the XML string is a MuJoCo `<mujoco>` document. */
export function isMjcfXml(xml: string): boolean {
  return /<mujoco[\s>]/i.test(xml);
}

export interface MjcfParseOptions {
  /** Optional resolver for `<include file="..."/>` tags inside MJCF documents. */
  resolveInclude?: ((file: string) => string | undefined) | undefined;
  cstTree?: { rootNode?: unknown } | null | undefined;
}

function expandMjcfIncludes(
  children: readonly XmlElement[],
  resolveInclude?: (file: string) => string | undefined,
  seen = new Set<string>(),
): XmlElement[] {
  const out: XmlElement[] = [];
  for (const ch of children) {
    if (ch.name.toLowerCase() === "include" && resolveInclude) {
      const file = getAttr(ch, "file");
      if (file && !seen.has(file)) {
        seen.add(file);
        const incXml = resolveInclude(file);
        if (incXml) {
          const { root: incRoot } = parseUrdfXmlDocument(incXml);
          if (incRoot) {
            out.push(...expandMjcfIncludes(incRoot.children, resolveInclude, seen));
          }
        }
      }
    } else {
      out.push(ch);
    }
  }
  return out;
}

/**
 * Parses a MuJoCo MJCF XML document into an enriched `UrdfRobot` model.
 */
export function parseMjcf(xml: string, options?: MjcfParseOptions): UrdfRobot {
  const { root } = parseUrdfXmlDocument(xml, options?.cstTree);
  if (!root || root.name.toLowerCase() !== "mujoco") {
    throw new Error("Invalid MJCF XML: missing <mujoco> root element.");
  }

  const rootChildren = expandMjcfIncludes(root.children, options?.resolveInclude);
  const robotName = getAttr(root, "model") ?? "mjcf_robot";
  const links = new Map<string, UrdfLink>();
  const joints = new Map<string, UrdfJoint>();
  const materials = new Map<string, UrdfMaterial>();
  const meshAssets = new Map<string, { file: string; scale?: Vector3D | undefined }>();
  const sites = new Map<string, MjcfSiteSpec>();
  const actuators: MjcfActuatorSpec[] = [];
  const sensors: MjcfSensorSpec[] = [];
  const defaultsMap = new Map<string, DefaultClassEntry>();
  defaultsMap.set("main", emptyDefaultEntry());

  let angleScale = Math.PI / 180; // MuJoCo default is degree
  let meshDir = "";

  for (const child of rootChildren) {
    const tag = child.name.toLowerCase();
    if (tag === "compiler") {
      const angle = (getAttr(child, "angle") ?? "degree").toLowerCase();
      angleScale = angle === "radian" ? 1 : Math.PI / 180;
      meshDir = getAttr(child, "meshdir") ?? "";
    } else if (tag === "default") {
      collectDefaults(child, emptyDefaultEntry(), defaultsMap);
    } else if (tag === "asset") {
      for (const item of child.children) {
        const itemTag = item.name.toLowerCase();
        if (itemTag === "mesh") {
          const file = getAttr(item, "file") ?? "";
          const name = getAttr(item, "name") ?? file.replace(/\.[^.]+$/, "");
          const fullFile = meshDir && !file.startsWith("/") ? `${meshDir.replace(/\/$/, "")}/${file}` : file;
          const scale = getAttr(item, "scale") ? parseVec3(getAttr(item, "scale"), { x: 1, y: 1, z: 1 }) : undefined;
          meshAssets.set(name, { file: fullFile, scale });
        } else if (itemTag === "material") {
          const name = getAttr(item, "name") ?? "material";
          const color = parseColor(getAttr(item, "rgba"));
          materials.set(name, { name, color });
        }
      }
    }
  }

  // Create world link
  const worldLink: UrdfLink = { name: "world", visuals: [], collisions: [] };
  links.set("world", worldLink);

  let autoBodyIdx = 0;
  let autoJointIdx = 0;

  function walkBody(bodyEl: XmlElement, parentLinkName: string, inheritedClass: string): void {
    const linkName = getAttr(bodyEl, "name") ?? `body_${autoBodyIdx++}`;
    const childClass = getAttr(bodyEl, "childclass") ?? inheritedClass;
    const bodyOrigin = parseOrigin(bodyEl, angleScale);

    const visuals: UrdfVisual[] = [];
    const collisions: UrdfCollision[] = [];
    let inertial: UrdfInertial | undefined;
    const bodyJoints: XmlElement[] = [];
    let hasFreeJoint = false;
    let freeJointName = `${linkName}_freejoint`;

    for (const ch of bodyEl.children) {
      const tag = ch.name.toLowerCase();
      if (tag === "inertial") {
        inertial = parseInertial(ch, angleScale);
      } else if (tag === "geom") {
        const clsName = getAttr(ch, "class") ?? childClass;
        const defs = defaultsMap.get(clsName) ?? defaultsMap.get("main");
        const parsed = parseGeom(ch, defs?.geom, meshAssets, materials, angleScale);
        if (parsed.visual) visuals.push(parsed.visual);
        if (parsed.collision) collisions.push(parsed.collision);
      } else if (tag === "site") {
        const siteName = getAttr(ch, "name") ?? `${linkName}_site`;
        sites.set(siteName, { name: siteName, linkName, origin: parseOrigin(ch, angleScale) });
      } else if (tag === "freejoint") {
        hasFreeJoint = true;
        freeJointName = getAttr(ch, "name") ?? freeJointName;
      } else if (tag === "joint") {
        const jType = (getAttr(ch, "type") ?? "hinge").toLowerCase();
        if (jType === "free") {
          hasFreeJoint = true;
          freeJointName = getAttr(ch, "name") ?? freeJointName;
        } else {
          bodyJoints.push(ch);
        }
      }
    }

    links.set(linkName, { name: linkName, inertial, visuals, collisions });

    if (hasFreeJoint) {
      joints.set(freeJointName, {
        name: freeJointName,
        type: "floating",
        parentLink: parentLinkName,
        childLink: linkName,
        origin: bodyOrigin,
        axis: { x: 0, y: 0, z: 1 },
      });
    } else if (bodyJoints.length === 0) {
      const fixedName = `${parentLinkName}_to_${linkName}_fixed_${autoJointIdx++}`;
      joints.set(fixedName, {
        name: fixedName,
        type: "fixed",
        parentLink: parentLinkName,
        childLink: linkName,
        origin: bodyOrigin,
        axis: { x: 0, y: 0, z: 1 },
      });
    } else {
      const jEl = bodyJoints[0]!;
      const clsName = getAttr(jEl, "class") ?? childClass;
      const defs = (defaultsMap.get(clsName) ?? defaultsMap.get("main"))?.joint;
      const jName = getAttr(jEl, "name") ?? `joint_${autoJointIdx++}`;
      const rawType = (mergedAttr(jEl, defs, "type") ?? "hinge").toLowerCase();
      const rangeNums = tokenizeNumbers(mergedAttr(jEl, defs, "range"));
      const limitedAttr = mergedAttr(jEl, defs, "limited");
      const hasRange = rangeNums.length >= 2 && limitedAttr !== "false";

      let urdfType: UrdfJointType = "continuous";
      if (rawType === "slide") urdfType = "prismatic";
      else if (rawType === "hinge") urdfType = hasRange ? "revolute" : "continuous";

      const axis = parseVec3(mergedAttr(jEl, defs, "axis"), { x: 0, y: 0, z: 1 });
      const jPos = parseVec3(mergedAttr(jEl, defs, "pos"));
      const damping = Number.parseFloat(mergedAttr(jEl, defs, "damping") ?? "0") || 0;
      const friction = Number.parseFloat(mergedAttr(jEl, defs, "frictionloss") ?? "0") || 0;
      const unitScale = urdfType === "prismatic" ? 1 : angleScale;

      joints.set(jName, {
        name: jName,
        type: urdfType,
        parentLink: parentLinkName,
        childLink: linkName,
        origin: {
          xyz: { x: bodyOrigin.xyz.x + jPos.x, y: bodyOrigin.xyz.y + jPos.y, z: bodyOrigin.xyz.z + jPos.z },
          rpy: bodyOrigin.rpy,
        },
        axis,
        limits: hasRange
          ? { lower: rangeNums[0]! * unitScale, upper: rangeNums[1]! * unitScale, effort: 100, velocity: 100 }
          : undefined,
        dynamics: { damping, friction },
      });
    }

    for (const ch of bodyEl.children) {
      if (ch.name.toLowerCase() === "body") {
        walkBody(ch, linkName, childClass);
      }
    }
  }

  for (const child of rootChildren) {
    const tag = child.name.toLowerCase();
    if (tag === "worldbody") {
      for (const wbChild of child.children) {
        const wbTag = wbChild.name.toLowerCase();
        if (wbTag === "body") {
          walkBody(wbChild, "world", "main");
        } else if (wbTag === "geom") {
          const clsName = getAttr(wbChild, "class") ?? "main";
          const defs = defaultsMap.get(clsName) ?? defaultsMap.get("main");
          const parsed = parseGeom(wbChild, defs?.geom, meshAssets, materials, angleScale);
          if (parsed.visual) worldLink.visuals.push(parsed.visual);
          if (parsed.collision) worldLink.collisions.push(parsed.collision);
        } else if (wbTag === "site") {
          const siteName = getAttr(wbChild, "name") ?? "world_site";
          sites.set(siteName, { name: siteName, linkName: "world", origin: parseOrigin(wbChild, angleScale) });
        }
      }
    } else if (tag === "actuator") {
      for (const actEl of child.children) {
        const aTag = actEl.name.toLowerCase();
        if (aTag !== "position" && aTag !== "motor" && aTag !== "velocity") continue;
        const clsName = getAttr(actEl, "class") ?? "main";
        const defs = (defaultsMap.get(clsName) ?? defaultsMap.get("main"))?.[aTag];
        const joint = mergedAttr(actEl, defs, "joint") ?? "";
        const name = getAttr(actEl, "name") ?? `${joint}_${aTag}`;
        const kpStr = mergedAttr(actEl, defs, "kp");
        const kvStr = mergedAttr(actEl, defs, "kv");
        const gearStr = mergedAttr(actEl, defs, "gear");
        const ctrlNums = tokenizeNumbers(mergedAttr(actEl, defs, "ctrlrange"));
        const forceNums = tokenizeNumbers(mergedAttr(actEl, defs, "forcerange"));
        actuators.push({
          name,
          kind: aTag,
          joint,
          kp: kpStr ? Number.parseFloat(kpStr) : undefined,
          kv: kvStr ? Number.parseFloat(kvStr) : undefined,
          gear: gearStr ? Number.parseFloat(gearStr) : undefined,
          ctrlRange: ctrlNums.length >= 2 ? [ctrlNums[0]!, ctrlNums[1]!] : undefined,
          forceRange: forceNums.length >= 2 ? [forceNums[0]!, forceNums[1]!] : undefined,
        });
      }
    } else if (tag === "sensor") {
      for (const sEl of child.children) {
        const sTag = sEl.name.toLowerCase();
        if (
          sTag !== "accelerometer" &&
          sTag !== "gyro" &&
          sTag !== "framequat" &&
          sTag !== "jointpos" &&
          sTag !== "jointvel" &&
          sTag !== "touch"
        ) {
          continue;
        }
        const site = getAttr(sEl, "site");
        const joint = getAttr(sEl, "joint");
        const name = getAttr(sEl, "name") ?? `${sTag}_${sensors.length}`;
        const linkName = site ? sites.get(site)?.linkName : undefined;
        sensors.push({ name, kind: sTag, site, joint, linkName });
      }
    }
  }

  return {
    name: robotName,
    links,
    joints,
    materials,
    actuators: actuators.length > 0 ? actuators : undefined,
    sensors: sensors.length > 0 ? sensors : undefined,
    sites: sites.size > 0 ? sites : undefined,
    meshAssets: meshAssets.size > 0 ? meshAssets : undefined,
  };
}

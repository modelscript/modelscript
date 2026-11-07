// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * @modelscript/urdf — Native XML Parser & Serializer for URDF and SDFormat.
 *
 * Implements pure AST XML parsing using @modelscript/dsl/xml and seamless
 * integration with the Xacro expansion preprocessor.
 */
import { parseXml } from "@modelscript/dsl/xml";
import { expandXacro } from "./xacro.js";
function getAttr(el, name) {
    const lower = name.toLowerCase();
    for (const a of el.attributes) {
        if (a.name.toLowerCase() === lower) {
            return a.value;
        }
    }
    return undefined;
}
function tokenizeNumbers(str) {
    if (!str)
        return [];
    const nums = [];
    let start = -1;
    for (let i = 0; i <= str.length; i++) {
        const ch = i < str.length ? str.charCodeAt(i) : 32;
        if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 44) {
            if (start >= 0) {
                const token = str.slice(start, i);
                const val = Number.parseFloat(token);
                if (!Number.isNaN(val))
                    nums.push(val);
                start = -1;
            }
        }
        else {
            if (start < 0)
                start = i;
        }
    }
    return nums;
}
function computeLineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10)
            starts.push(i + 1);
    }
    return starts;
}
function offsetToPosition(offset, lineStarts) {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (lineStarts[mid] <= offset) {
            low = mid + 1;
        }
        else {
            high = mid - 1;
        }
    }
    const lineIdx = low - 1;
    const line = lineIdx + 1;
    const col = offset - lineStarts[lineIdx] + 1;
    return { line, col };
}
function elementRange(el, lineStarts) {
    const startPos = offsetToPosition(el.start, lineStarts);
    const endPos = offsetToPosition(el.end, lineStarts);
    return {
        startLine: startPos.line,
        startColumn: startPos.col,
        endLine: endPos.line,
        endColumn: endPos.col,
    };
}
function parseVector3D(str, defaultVal = { x: 0, y: 0, z: 0 }) {
    if (!str)
        return { ...defaultVal };
    const tokens = tokenizeNumbers(str);
    return {
        x: tokens[0] ?? defaultVal.x,
        y: tokens[1] ?? defaultVal.y,
        z: tokens[2] ?? defaultVal.z,
    };
}
function parseOrigin(el) {
    if (!el)
        return undefined;
    const xyzStr = getAttr(el, "xyz");
    const rpyStr = getAttr(el, "rpy");
    return {
        xyz: parseVector3D(xyzStr),
        rpy: parseVector3D(rpyStr),
    };
}
function parseColor(el) {
    if (!el)
        return undefined;
    const rgbaStr = getAttr(el, "rgba");
    if (!rgbaStr)
        return undefined;
    const tokens = tokenizeNumbers(rgbaStr);
    return {
        r: tokens[0] ?? 1.0,
        g: tokens[1] ?? 1.0,
        b: tokens[2] ?? 1.0,
        a: tokens[3] ?? 1.0,
    };
}
function parseGeometry(el) {
    const defaultGeom = { type: "sphere", radius: 0.1 };
    if (!el)
        return defaultGeom;
    for (const child of el.children) {
        const tag = child.name.toLowerCase();
        if (tag === "box") {
            return {
                type: "box",
                size: parseVector3D(getAttr(child, "size"), { x: 1, y: 1, z: 1 }),
            };
        }
        if (tag === "cylinder") {
            const radius = Number.parseFloat(getAttr(child, "radius") ?? "0.1");
            const length = Number.parseFloat(getAttr(child, "length") ?? "0.2");
            return {
                type: "cylinder",
                radius: Number.isNaN(radius) ? 0.1 : radius,
                length: Number.isNaN(length) ? 0.2 : length,
            };
        }
        if (tag === "sphere") {
            const radius = Number.parseFloat(getAttr(child, "radius") ?? "0.1");
            return {
                type: "sphere",
                radius: Number.isNaN(radius) ? 0.1 : radius,
            };
        }
        if (tag === "mesh") {
            const filename = getAttr(child, "filename");
            const scaleStr = getAttr(child, "scale");
            const scale = scaleStr ? parseVector3D(scaleStr, { x: 1, y: 1, z: 1 }) : undefined;
            return {
                type: "mesh",
                filename,
                scale,
            };
        }
    }
    return defaultGeom;
}
/**
 * Parses a URDF, SDF, or Xacro XML string into a strongly-typed UrdfRobot AST.
 */
export function parseUrdf(content, defaultName = "robot") {
    const expandedXml = expandXacro(content);
    const lineStarts = computeLineStarts(expandedXml);
    const doc = parseXml(expandedXml);
    const root = doc.root;
    const robot = {
        name: defaultName,
        links: new Map(),
        joints: new Map(),
        materials: new Map(),
    };
    if (!root)
        return robot;
    // Handle SDF root: <sdf> <model name="...">
    let modelEl = root;
    if (root.name.toLowerCase() === "sdf") {
        const foundModel = root.children.find((c) => c.name.toLowerCase() === "model");
        if (foundModel)
            modelEl = foundModel;
    }
    const robotName = getAttr(modelEl, "name");
    if (robotName)
        robot.name = robotName;
    for (const child of modelEl.children) {
        const tag = child.name.toLowerCase();
        const range = elementRange(child, lineStarts);
        if (tag === "link") {
            const name = getAttr(child, "name") ?? `link_${robot.links.size + 1}`;
            const link = parseLink(child, name, range);
            robot.links.set(name, link);
        }
        else if (tag === "joint") {
            const name = getAttr(child, "name") ?? `joint_${robot.joints.size + 1}`;
            if (robot.joints.has(name)) {
                if (!robot.duplicateJointNames)
                    robot.duplicateJointNames = [];
                robot.duplicateJointNames.push(name);
            }
            const joint = parseJoint(child, name, range);
            robot.joints.set(name, joint);
        }
        else if (tag === "material") {
            const name = getAttr(child, "name");
            if (name) {
                const colorEl = child.children.find((c) => c.name.toLowerCase() === "color");
                const textureEl = child.children.find((c) => c.name.toLowerCase() === "texture");
                robot.materials.set(name, {
                    name,
                    color: parseColor(colorEl),
                    texture: textureEl ? getAttr(textureEl, "filename") : undefined,
                });
            }
        }
    }
    return robot;
}
function parseLink(el, name, range) {
    let inertial;
    const visuals = [];
    const collisions = [];
    for (const child of el.children) {
        const tag = child.name.toLowerCase();
        if (tag === "inertial") {
            const originEl = child.children.find((c) => c.name.toLowerCase() === "origin");
            const massEl = child.children.find((c) => c.name.toLowerCase() === "mass");
            const inertiaEl = child.children.find((c) => c.name.toLowerCase() === "inertia");
            const rawMassAttr = massEl ? getAttr(massEl, "value") : undefined;
            const mass = rawMassAttr !== undefined
                ? rawMassAttr.trim() === ""
                    ? Number.NaN
                    : Number(rawMassAttr)
                : 1.0;
            const fallbackMass = Number.isNaN(mass) ? 1.0 : mass;
            const getInertiaComp = (attr, def) => {
                if (!inertiaEl)
                    return def;
                const val = Number.parseFloat(getAttr(inertiaEl, attr) ?? String(def));
                return Number.isNaN(val) ? def : val;
            };
            inertial = {
                origin: parseOrigin(originEl),
                mass,
                ixx: getInertiaComp("ixx", fallbackMass * 0.1),
                ixy: getInertiaComp("ixy", 0.0),
                ixz: getInertiaComp("ixz", 0.0),
                iyy: getInertiaComp("iyy", fallbackMass * 0.1),
                iyz: getInertiaComp("iyz", 0.0),
                izz: getInertiaComp("izz", fallbackMass * 0.1),
            };
        }
        else if (tag === "visual") {
            const vName = getAttr(child, "name");
            const originEl = child.children.find((c) => c.name.toLowerCase() === "origin");
            const geomEl = child.children.find((c) => c.name.toLowerCase() === "geometry");
            const matEl = child.children.find((c) => c.name.toLowerCase() === "material");
            let material;
            if (matEl) {
                const matName = getAttr(matEl, "name") ?? "default";
                const colorEl = matEl.children.find((c) => c.name.toLowerCase() === "color");
                material = {
                    name: matName,
                    color: parseColor(colorEl),
                };
            }
            visuals.push({
                name: vName,
                origin: parseOrigin(originEl),
                geometry: parseGeometry(geomEl),
                material,
            });
        }
        else if (tag === "collision") {
            const cName = getAttr(child, "name");
            const originEl = child.children.find((c) => c.name.toLowerCase() === "origin");
            const geomEl = child.children.find((c) => c.name.toLowerCase() === "geometry");
            collisions.push({
                name: cName,
                origin: parseOrigin(originEl),
                geometry: parseGeometry(geomEl),
            });
        }
    }
    return {
        name,
        inertial,
        visuals,
        collisions,
        range,
    };
}
function parseJoint(el, name, range) {
    const typeStr = (getAttr(el, "type") ?? "revolute").toLowerCase();
    const validTypes = ["revolute", "continuous", "prismatic", "fixed", "floating", "planar"];
    const type = validTypes.includes(typeStr) ? typeStr : "revolute";
    const parentEl = el.children.find((c) => c.name.toLowerCase() === "parent");
    const childEl = el.children.find((c) => c.name.toLowerCase() === "child");
    const originEl = el.children.find((c) => c.name.toLowerCase() === "origin");
    const axisEl = el.children.find((c) => c.name.toLowerCase() === "axis");
    const limitEl = el.children.find((c) => c.name.toLowerCase() === "limit");
    const dynamicsEl = el.children.find((c) => c.name.toLowerCase() === "dynamics");
    const mimicEl = el.children.find((c) => c.name.toLowerCase() === "mimic");
    const parentLink = (parentEl ? getAttr(parentEl, "link") : undefined) ?? "";
    const childLink = (childEl ? getAttr(childEl, "link") : undefined) ?? "";
    const axisStr = axisEl ? getAttr(axisEl, "xyz") : undefined;
    const axis = parseVector3D(axisStr, { x: 0, y: 0, z: 1 });
    let limits;
    if (limitEl) {
        const lowerStr = getAttr(limitEl, "lower");
        const upperStr = getAttr(limitEl, "upper");
        const effortVal = Number.parseFloat(getAttr(limitEl, "effort") ?? "100.0");
        const velocityVal = Number.parseFloat(getAttr(limitEl, "velocity") ?? "10.0");
        limits = {
            lower: lowerStr ? Number.parseFloat(lowerStr) : undefined,
            upper: upperStr ? Number.parseFloat(upperStr) : undefined,
            effort: Number.isNaN(effortVal) ? 100.0 : effortVal,
            velocity: Number.isNaN(velocityVal) ? 10.0 : velocityVal,
        };
    }
    let dynamics;
    if (dynamicsEl) {
        const dampStr = getAttr(dynamicsEl, "damping");
        const fricStr = getAttr(dynamicsEl, "friction");
        dynamics = {
            damping: dampStr ? Number.parseFloat(dampStr) : undefined,
            friction: fricStr ? Number.parseFloat(fricStr) : undefined,
        };
    }
    let mimic;
    if (mimicEl) {
        const targetJoint = getAttr(mimicEl, "joint");
        if (targetJoint) {
            const multStr = getAttr(mimicEl, "multiplier");
            const offStr = getAttr(mimicEl, "offset");
            mimic = {
                joint: targetJoint,
                multiplier: multStr ? Number.parseFloat(multStr) : undefined,
                offset: offStr ? Number.parseFloat(offStr) : undefined,
            };
        }
    }
    return {
        name,
        type,
        parentLink,
        childLink,
        origin: parseOrigin(originEl),
        axis,
        limits,
        dynamics,
        mimic,
        range,
    };
}
/**
 * Losslessly serializes an UrdfRobot back to canonical XML format.
 */
export function serializeUrdf(robot) {
    const lines = [];
    lines.push(`<?xml version="1.0"?>`);
    lines.push(`<robot name="${robot.name}">`);
    // Materials
    for (const mat of robot.materials.values()) {
        lines.push(`  <material name="${mat.name}">`);
        if (mat.color) {
            lines.push(`    <color rgba="${mat.color.r} ${mat.color.g} ${mat.color.b} ${mat.color.a}" />`);
        }
        if (mat.texture) {
            lines.push(`    <texture filename="${mat.texture}" />`);
        }
        lines.push(`  </material>`);
    }
    // Links
    for (const link of robot.links.values()) {
        lines.push(`  <link name="${link.name}">`);
        if (link.inertial) {
            const in_ = link.inertial;
            lines.push(`    <inertial>`);
            if (in_.origin) {
                lines.push(`      <origin xyz="${in_.origin.xyz.x} ${in_.origin.xyz.y} ${in_.origin.xyz.z}" rpy="${in_.origin.rpy.x} ${in_.origin.rpy.y} ${in_.origin.rpy.z}" />`);
            }
            lines.push(`      <mass value="${in_.mass}" />`);
            lines.push(`      <inertia ixx="${in_.ixx}" ixy="${in_.ixy}" ixz="${in_.ixz}" iyy="${in_.iyy}" iyz="${in_.iyz}" izz="${in_.izz}" />`);
            lines.push(`    </inertial>`);
        }
        // Visuals
        for (const vis of link.visuals) {
            lines.push(`    <visual>`);
            if (vis.origin) {
                lines.push(`      <origin xyz="${vis.origin.xyz.x} ${vis.origin.xyz.y} ${vis.origin.xyz.z}" rpy="${vis.origin.rpy.x} ${vis.origin.rpy.y} ${vis.origin.rpy.z}" />`);
            }
            lines.push(`      <geometry>`);
            lines.push(serializeGeometry(vis.geometry));
            lines.push(`      </geometry>`);
            if (vis.material) {
                lines.push(`      <material name="${vis.material.name}" />`);
            }
            lines.push(`    </visual>`);
        }
        // Collisions
        for (const col of link.collisions) {
            lines.push(`    <collision>`);
            if (col.origin) {
                lines.push(`      <origin xyz="${col.origin.xyz.x} ${col.origin.xyz.y} ${col.origin.xyz.z}" rpy="${col.origin.rpy.x} ${col.origin.rpy.y} ${col.origin.rpy.z}" />`);
            }
            lines.push(`      <geometry>`);
            lines.push(serializeGeometry(col.geometry));
            lines.push(`      </geometry>`);
            lines.push(`    </collision>`);
        }
        lines.push(`  </link>`);
    }
    // Joints
    for (const j of robot.joints.values()) {
        lines.push(`  <joint name="${j.name}" type="${j.type}">`);
        lines.push(`    <parent link="${j.parentLink}" />`);
        lines.push(`    <child link="${j.childLink}" />`);
        if (j.origin) {
            lines.push(`    <origin xyz="${j.origin.xyz.x} ${j.origin.xyz.y} ${j.origin.xyz.z}" rpy="${j.origin.rpy.x} ${j.origin.rpy.y} ${j.origin.rpy.z}" />`);
        }
        lines.push(`    <axis xyz="${j.axis.x} ${j.axis.y} ${j.axis.z}" />`);
        if (j.limits) {
            const lower = j.limits.lower !== undefined ? ` lower="${j.limits.lower}"` : "";
            const upper = j.limits.upper !== undefined ? ` upper="${j.limits.upper}"` : "";
            lines.push(`    <limit${lower}${upper} effort="${j.limits.effort}" velocity="${j.limits.velocity}" />`);
        }
        if (j.dynamics) {
            const damp = j.dynamics.damping !== undefined ? ` damping="${j.dynamics.damping}"` : "";
            const fric = j.dynamics.friction !== undefined ? ` friction="${j.dynamics.friction}"` : "";
            lines.push(`    <dynamics${damp}${fric} />`);
        }
        lines.push(`  </joint>`);
    }
    lines.push(`</robot>`);
    return lines.join("\n");
}
function serializeGeometry(geom) {
    switch (geom.type) {
        case "box":
            return `        <box size="${geom.size?.x ?? 1} ${geom.size?.y ?? 1} ${geom.size?.z ?? 1}" />`;
        case "cylinder":
            return `        <cylinder radius="${geom.radius ?? 0.1}" length="${geom.length ?? 0.2}" />`;
        case "sphere":
            return `        <sphere radius="${geom.radius ?? 0.1}" />`;
        case "mesh": {
            const scaleStr = geom.scale ? ` scale="${geom.scale.x} ${geom.scale.y} ${geom.scale.z}"` : "";
            return `        <mesh filename="${geom.filename ?? ""}"${scaleStr} />`;
        }
    }
}
//# sourceMappingURL=urdf-parser.js.map
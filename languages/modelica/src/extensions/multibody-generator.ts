// SPDX-License-Identifier: AGPL-3.0-or-later

export interface MultiBodyAssembly {
  name: string;
  bodies: {
    name: string;
    frameVariable?: string | undefined;
    mass: number;
    inertia: { I_11: number; I_22: number; I_33: number; I_21: number; I_31: number; I_32: number };
    r_CM: number[];
    shapeRef?: string | undefined;
  }[];
  joints: {
    name: string;
    type: string;
    n: number[];
    partA: string;
    partB: string;
  }[];
  fixedTranslations: {
    name: string;
    r: number[];
    partA: string;
    partB: string;
  }[];
}

import { isAsciiIdentContinue } from "../flattener/expressions/cst-utils.js";

function sanitizeIdentifier(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i++) {
    out += isAsciiIdentContinue(name.charCodeAt(i)) ? name[i] : "_";
  }
  return out;
}

function placementAnn(cx: number, cy: number): string {
  return `Placement(transformation(extent={{${cx - 10}, ${cy - 10}}, {${cx + 10}, ${cy + 10}}}))`;
}

function connectLineAnn(a: { x: number; y: number } | undefined, b: { x: number; y: number } | undefined): string {
  const p1 = a ?? { x: 0, y: 0 };
  const p2 = b ?? { x: 40, y: 0 };
  if (p1.x === p2.x || p1.y === p2.y) {
    return `annotation(Line(points={{${p1.x}, ${p1.y}}, {${p2.x}, ${p2.y}}}, color={95, 95, 95}))`;
  }
  const mx = Math.round((p1.x + p2.x) / 2);
  return `annotation(Line(points={{${p1.x}, ${p1.y}}, {${mx}, ${p1.y}}, {${mx}, ${p2.y}}, {${p2.x}, ${p2.y}}}, color={95, 95, 95}))`;
}

export function generateMultiBodyModelica(assembly: MultiBodyAssembly, stepUri: string): string {
  const lines: string[] = [];
  const coords = new Map<string, { x: number; y: number }>();

  const modelName = sanitizeIdentifier(assembly.name);

  lines.push(`model ${modelName} "Auto-generated from ${stepUri}"`);
  lines.push(`  import Modelica.Mechanics.MultiBody.*;`);
  lines.push(``);
  coords.set("world", { x: -80, y: 0 });
  lines.push(
    `  inner World world(gravityType = World.GravityTypes.UniformGravity) annotation(${placementAnn(-80, 0)});`,
  );
  lines.push(``);

  if (assembly.bodies.length > 0) {
    lines.push(`  // ── Bodies ──`);
    for (let i = 0; i < assembly.bodies.length; i++) {
      const body = assembly.bodies[i]!;
      const cx = -20 + i * 80;
      const cy = 40;
      coords.set(body.name, { x: cx, y: cy });
      const frame = body.frameVariable ?? `${body.name}.frame_a`;
      lines.push(`  Parts.Body ${body.name}(`);
      lines.push(`    m = ${body.mass},`);
      lines.push(`    I_11 = ${body.inertia.I_11}, I_22 = ${body.inertia.I_22}, I_33 = ${body.inertia.I_33},`);
      lines.push(`    I_21 = ${body.inertia.I_21}, I_31 = ${body.inertia.I_31}, I_32 = ${body.inertia.I_32},`);
      lines.push(`    r_CM = {${body.r_CM[0]}, ${body.r_CM[1]}, ${body.r_CM[2]}},`);
      lines.push(`    animation = true`);

      // Build CAD annotation with dynamic animation bindings
      const annParts = [`uri = "${stepUri}"`];
      if (body.shapeRef) annParts.push(`feature="${body.shapeRef}"`);
      annParts.push(`dynamicPosition = "{${frame}.r_0[1], ${frame}.r_0[2], ${frame}.r_0[3]}"`);
      annParts.push(`dynamicRotation = "${frame}.R.T"`);

      lines.push(`  ) annotation(${placementAnn(cx, cy)}, CAD(${annParts.join(", ")}));`);
      lines.push(``);
    }
  }

  if (assembly.joints.length > 0) {
    lines.push(`  // ── Joints ──`);
    for (let i = 0; i < assembly.joints.length; i++) {
      const joint = assembly.joints[i]!;
      const cx = 20 + i * 80;
      const cy = -70;
      coords.set(joint.name, { x: cx, y: cy });
      lines.push(`  Joints.${joint.type} ${joint.name}(`);
      lines.push(`    n = {${joint.n[0]}, ${joint.n[1]}, ${joint.n[2]}}`);
      lines.push(`  ) annotation(${placementAnn(cx, cy)});`);
      lines.push(``);
    }
  }

  if (assembly.fixedTranslations.length > 0) {
    lines.push(`  // ── Fixed Offsets ──`);
    for (let i = 0; i < assembly.fixedTranslations.length; i++) {
      const offset = assembly.fixedTranslations[i]!;
      const cx = 20 + i * 80;
      const cy = -20;
      coords.set(offset.name, { x: cx, y: cy });
      lines.push(`  Parts.FixedTranslation ${offset.name}(`);
      lines.push(`    r = {${offset.r[0]}, ${offset.r[1]}, ${offset.r[2]}}`);
      lines.push(`  ) annotation(${placementAnn(cx, cy)});`);
      lines.push(``);
    }
  }

  lines.push(`equation`);

  // Simple sequential chain connection logic
  // Connect root body to world
  const firstBody = assembly.bodies[0];
  if (firstBody) {
    lines.push(
      `  connect(world.frame_b, ${firstBody.name}.frame_a) ${connectLineAnn(coords.get("world"), coords.get(firstBody.name))};`,
    );
  }

  const bodyNames = new Set(assembly.bodies.map((b) => b.name));
  // Parts.Body only declares `frame_a` (lumped rigid-body frame); joints/offsets/world declare `frame_b`.
  const outConnectorOf = (partName: string) =>
    partName === "world" ? "world.frame_b" : bodyNames.has(partName) ? `${partName}.frame_a` : `${partName}.frame_b`;
  const inConnectorOf = (partName: string) => (partName === "world" ? "world.frame_b" : `${partName}.frame_a`);

  for (const offset of assembly.fixedTranslations) {
    lines.push(
      `  connect(${outConnectorOf(offset.partA)}, ${offset.name}.frame_a) ${connectLineAnn(coords.get(offset.partA), coords.get(offset.name))};`,
    );

    // Determine if it connects directly to a part or a joint
    const attachedJoint = assembly.joints.find((j) => j.partB === offset.partB && j.partA === offset.partA);
    if (attachedJoint) {
      lines.push(
        `  connect(${offset.name}.frame_b, ${attachedJoint.name}.frame_a) ${connectLineAnn(coords.get(offset.name), coords.get(attachedJoint.name))};`,
      );
      lines.push(
        `  connect(${attachedJoint.name}.frame_b, ${inConnectorOf(offset.partB)}) ${connectLineAnn(coords.get(attachedJoint.name), coords.get(offset.partB))};`,
      );
    } else {
      lines.push(
        `  connect(${offset.name}.frame_b, ${inConnectorOf(offset.partB)}) ${connectLineAnn(coords.get(offset.name), coords.get(offset.partB))};`,
      );
    }
  }

  // Handle joints without explicit translations
  for (const joint of assembly.joints) {
    const hasOffset = assembly.fixedTranslations.some((o) => o.partA === joint.partA && o.partB === joint.partB);
    if (!hasOffset) {
      lines.push(
        `  connect(${outConnectorOf(joint.partA)}, ${joint.name}.frame_a) ${connectLineAnn(coords.get(joint.partA), coords.get(joint.name))};`,
      );
      lines.push(
        `  connect(${joint.name}.frame_b, ${inConnectorOf(joint.partB)}) ${connectLineAnn(coords.get(joint.name), coords.get(joint.partB))};`,
      );
    }
  }

  lines.push(`end ${modelName};`);

  return lines.join("\n");
}

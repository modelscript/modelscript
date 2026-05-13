import { MultiBodyAssembly } from "../../../../polyglot/src/step-multibody-mapper";

export function generateMultiBodyModelica(assembly: MultiBodyAssembly, stepUri: string): string {
  const lines: string[] = [];

  const modelName = assembly.name.replace(/[^a-zA-Z0-9_]/g, "_");

  lines.push(`model ${modelName} "Auto-generated from ${stepUri}"`);
  lines.push(`  import Modelica.Mechanics.MultiBody.*;`);
  lines.push(``);
  lines.push(`  inner World world(gravityType = World.GravityTypes.UniformGravity);`);
  lines.push(``);

  if (assembly.bodies.length > 0) {
    lines.push(`  // ── Bodies ──`);
    for (const body of assembly.bodies) {
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

      lines.push(`  ) annotation(CAD(${annParts.join(", ")}));`);
      lines.push(``);
    }
  }

  if (assembly.joints.length > 0) {
    lines.push(`  // ── Joints ──`);
    for (const joint of assembly.joints) {
      lines.push(`  Joints.${joint.type} ${joint.name}(`);
      lines.push(`    n = {${joint.n[0]}, ${joint.n[1]}, ${joint.n[2]}}`);
      lines.push(`  );`);
      lines.push(``);
    }
  }

  if (assembly.fixedTranslations.length > 0) {
    lines.push(`  // ── Fixed Offsets ──`);
    for (const offset of assembly.fixedTranslations) {
      lines.push(`  Parts.FixedTranslation ${offset.name}(`);
      lines.push(`    r = {${offset.r[0]}, ${offset.r[1]}, ${offset.r[2]}}`);
      lines.push(`  );`);
      lines.push(``);
    }
  }

  lines.push(`equation`);

  // Simple sequential chain connection logic
  // Connect root body to world
  if (assembly.bodies.length > 0) {
    lines.push(`  connect(world.frame_b, ${assembly.bodies[0].name}.frame_a);`);
  }

  for (const offset of assembly.fixedTranslations) {
    lines.push(`  connect(${offset.partA}.frame_b, ${offset.name}.frame_a);`);

    // Determine if it connects directly to a part or a joint
    const attachedJoint = assembly.joints.find((j) => j.partB === offset.partB && j.partA === offset.partA);
    if (attachedJoint) {
      lines.push(`  connect(${offset.name}.frame_b, ${attachedJoint.name}.frame_a);`);
      lines.push(`  connect(${attachedJoint.name}.frame_b, ${offset.partB}.frame_a);`);
    } else {
      lines.push(`  connect(${offset.name}.frame_b, ${offset.partB}.frame_a);`);
    }
  }

  // Handle joints without explicit translations
  for (const joint of assembly.joints) {
    const hasOffset = assembly.fixedTranslations.some((o) => o.partA === joint.partA && o.partB === joint.partB);
    if (!hasOffset) {
      lines.push(`  connect(${joint.partA}.frame_b, ${joint.name}.frame_a);`);
      lines.push(`  connect(${joint.name}.frame_b, ${joint.partB}.frame_a);`);
    }
  }

  lines.push(`end ${modelName};`);

  return lines.join("\n");
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generate a Modelica wrapper model for multi-FMU co-simulation.
 *
 * Produces a valid `.mo` file containing component declarations for each
 * FMU participant (with `fileName` parameters and `Placement` annotations)
 * and optional `connect()` equations for wiring outputs to inputs.
 */

/** Descriptor for an FMU participant in the wrapper model. */
export interface WrapperFmuDescriptor {
  /** Modelica class name (e.g. "SineWave"). */
  className: string;
  /** Instance name in the wrapper model (e.g. "sineWave"). */
  instanceName: string;
  /** FMU file name (e.g. "SineWave.fmu" or "SineWave.xml"). */
  fileName: string;
}

/** A connection between two FMU ports. */
export interface WrapperConnection {
  /** Qualified source (e.g. "sineWave.y"). */
  source: string;
  /** Qualified target (e.g. "controller.u"). */
  target: string;
}

/**
 * Generate a Modelica wrapper model source string from FMU descriptors.
 *
 * The generated model:
 * - Declares each FMU as a component with a `fileName` parameter
 * - Adds `Placement` annotations to lay out blocks in a horizontal row
 * - Includes `connect()` equations for any specified connections
 *
 * @param modelName  Name of the wrapper model (e.g. "CosimWrapper")
 * @param fmus       List of FMU participants
 * @param connections Optional connections between FMU ports
 * @returns Valid Modelica source text
 */
export function generateMultiModelWrapper(
  modelName: string,
  fmus: WrapperFmuDescriptor[],
  connections: WrapperConnection[] = [],
): string {
  const lines: string[] = [];

  lines.push(`model ${modelName}`);
  lines.push(`  "Multi-FMU co-simulation wrapper model"`);

  // Layout: distribute FMU blocks horizontally with spacing
  const spacing = 120; // Modelica units between block centers
  const blockSize = 40; // half-extent of each block
  const startX = -Math.floor(((fmus.length - 1) * spacing) / 2);

  for (const [i, fmu] of fmus.entries()) {
    const cx = startX + i * spacing;
    const cy = 0;
    const ext1x = cx - blockSize;
    const ext1y = cy - blockSize;
    const ext2x = cx + blockSize;
    const ext2y = cy + blockSize;

    lines.push(`  ${fmu.className} ${fmu.instanceName}(fileName="${fmu.fileName}")`);
    lines.push(
      `    annotation(Placement(transformation(origin={${cx},${cy}}, extent={{${ext1x - cx},${ext1y - cy}},{${ext2x - cx},${ext2y - cy}}})));`,
    );
  }

  if (connections.length > 0) {
    lines.push(`equation`);
    for (const conn of connections) {
      lines.push(`  connect(${conn.source}, ${conn.target});`);
    }
  }

  lines.push(`  annotation(`);
  lines.push(`    Diagram(`);
  lines.push(`      coordinateSystem(`);
  lines.push(`        extent={{-200,-200},{200,200}},`);
  lines.push(`        preserveAspectRatio=true`);
  lines.push(`      )`);
  lines.push(`    )`);
  lines.push(`  );`);
  lines.push(`end ${modelName};`);
  lines.push(``);

  return lines.join("\n");
}

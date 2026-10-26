// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AutosarModel, AutosarSwComponent } from "../types.js";

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function projectAtomicSwc(swc: AutosarSwComponent): string {
  const lines: string[] = [];
  const name = sanitize(swc.shortName);
  lines.push(`  model ${name}`);
  lines.push(`    "AUTOSAR Software Component: ${swc.shortName} (${swc.kind})"`);

  const inPorts: string[] = [];
  const outPorts: string[] = [];

  for (const [portName, port] of swc.ports) {
    const pName = sanitize(portName);
    if (port.direction === "required") {
      lines.push(`    Modelica.Blocks.Interfaces.RealInput ${pName};`);
      inPorts.push(pName);
    } else {
      lines.push(`    Modelica.Blocks.Interfaces.RealOutput ${pName};`);
      outPorts.push(pName);
    }
  }

  lines.push(`  equation`);
  if (inPorts.length > 0 && outPorts.length > 0) {
    for (let i = 0; i < outPorts.length; i++) {
      const outP = outPorts[i]!;
      const inP = inPorts[i % inPorts.length]!;
      lines.push(`    ${outP} = ${inP};`);
    }
  } else if (outPorts.length > 0) {
    for (const outP of outPorts) {
      lines.push(`    ${outP} = 1.0;`);
    }
  }

  lines.push(`  end ${name};`);
  return lines.join("\n");
}

function projectCompositionSwc(swc: AutosarSwComponent): string {
  const lines: string[] = [];
  const name = sanitize(swc.shortName);
  lines.push(`  model ${name}`);
  lines.push(`    "AUTOSAR Composition Component: ${swc.shortName}"`);

  // Subcomponents
  if (swc.subComponents) {
    for (const [subName, subProto] of swc.subComponents) {
      const typeName = sanitize(subProto.typeRef.split("/").pop() ?? subProto.typeRef);
      lines.push(`    ${typeName} ${sanitize(subName)};`);
    }
  }

  lines.push(`  equation`);
  if (swc.connectors) {
    for (const conn of swc.connectors) {
      if (
        conn.kind === "ASSEMBLY-SW-CONNECTOR" &&
        conn.provider?.component &&
        conn.provider?.port &&
        conn.requirer?.component &&
        conn.requirer?.port
      ) {
        const prov = `${sanitize(conn.provider.component)}.${sanitize(conn.provider.port)}`;
        const req = `${sanitize(conn.requirer.component)}.${sanitize(conn.requirer.port)}`;
        lines.push(`    connect(${prov}, ${req});`);
      }
    }
  }

  lines.push(`  end ${name};`);
  return lines.join("\n");
}

/**
 * Projects an AUTOSAR model to Modelica 3.x block diagram architecture.
 */
export function autosarToModelica(model: AutosarModel, rootPackageName: string = "AutosarSystem"): string {
  const lines: string[] = [];
  lines.push(`package ${sanitize(rootPackageName)}`);

  // 1. Project all atomic components
  for (const swc of model.components.values()) {
    if (swc.kind !== "COMPOSITION-SW-COMPONENT-TYPE") {
      lines.push(projectAtomicSwc(swc));
    }
  }

  // 2. Project all compositions
  for (const swc of model.components.values()) {
    if (swc.kind === "COMPOSITION-SW-COMPONENT-TYPE") {
      lines.push(projectCompositionSwc(swc));
    }
  }

  lines.push(`end ${sanitize(rootPackageName)};`);
  return lines.join("\n\n");
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import type { AutosarModel, AutosarSwComponent } from "../types.js";

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function projectAtomicToSysml(swc: AutosarSwComponent): string {
  const lines: string[] = [];
  const name = sanitize(swc.shortName);
  lines.push(`  part def ${name} {`);

  for (const [portName, port] of swc.ports) {
    const pName = sanitize(portName);
    const dir = port.direction === "required" ? "in" : "out";
    lines.push(`    ${dir} port ${pName};`);
  }

  lines.push(`  }`);
  return lines.join("\n");
}

function projectCompositionToSysml(swc: AutosarSwComponent): string {
  const lines: string[] = [];
  const name = sanitize(swc.shortName);
  lines.push(`  part def ${name} {`);

  if (swc.subComponents) {
    for (const [subName, subProto] of swc.subComponents) {
      const typeName = sanitize(subProto.typeRef.split("/").pop() ?? subProto.typeRef);
      lines.push(`    part ${sanitize(subName)} : ${typeName};`);
    }
  }

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
        lines.push(`    connect ${prov} to ${req};`);
      }
    }
  }

  lines.push(`  }`);
  return lines.join("\n");
}

/**
 * Projects an AUTOSAR model to SysML v2 part definitions and port connectors.
 */
export function autosarToSysml(model: AutosarModel, rootPackageName: string = "AutosarArchitecture"): string {
  const lines: string[] = [];
  lines.push(`package ${sanitize(rootPackageName)} {`);

  for (const swc of model.components.values()) {
    if (swc.kind !== "COMPOSITION-SW-COMPONENT-TYPE") {
      lines.push(projectAtomicToSysml(swc));
    }
  }

  for (const swc of model.components.values()) {
    if (swc.kind === "COMPOSITION-SW-COMPONENT-TYPE") {
      lines.push(projectCompositionToSysml(swc));
    }
  }

  lines.push(`}`);
  return lines.join("\n\n");
}

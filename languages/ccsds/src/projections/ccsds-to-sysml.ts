// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ccsds — Projections to SysML v2 Mission Architecture & Telemetry.
 *
 * Translates OMG XTCE dictionaries and CCSDS navigation data into SysML v2
 * packages, telemetry port definitions, and command actions.
 */

import type { CcsdsDocument } from "../types.js";

export function ccsdsToSysml(doc: CcsdsDocument): string {
  const pkgName = (doc.format === "XTCE" ? doc.name : doc.metadata.objectName).replace(/[^a-zA-Z0-9_]/g, "_");
  const lines: string[] = [];

  lines.push(`package ${pkgName} {`);
  lines.push(`  doc /* Auto-generated SysML v2 model from @modelscript/ccsds */`);
  lines.push("");

  if (doc.format === "XTCE") {
    // 1. Telemetry Port Definition
    lines.push("  port def TelemetryPort {");
    for (const p of doc.parameters) {
      let sysmlType = "Real";
      if (p.paramType === "integer") sysmlType = "Integer";
      else if (p.paramType === "boolean") sysmlType = "Boolean";
      else if (p.paramType === "string") sysmlType = "String";

      lines.push(`    out item ${p.name} : ScalarValues::${sysmlType};`);
    }
    lines.push("  }");
    lines.push("");

    // 2. Telemetry Subsystem Part Definition
    lines.push("  part def TelemetrySubsystem {");
    lines.push("    port tmPort : TelemetryPort;");
    lines.push("  }");
    lines.push("");

    // 3. Command Handler Action Definition
    lines.push("  action def TelecommandHandler {");
    for (const cmd of doc.commands) {
      lines.push(`    action ${cmd.name} {`);
      for (const arg of cmd.arguments) {
        lines.push(`      in item ${arg.name} : ScalarValues::Integer;`);
      }
      lines.push("    }");
    }
    lines.push("  }");
  } else {
    // Navigation message (OEM, OPM, OMM)
    lines.push("  part def SpacecraftOrbit {");
    lines.push(`    attribute objectName : ScalarValues::String = "${doc.metadata.objectName}";`);
    lines.push(`    attribute refFrame : ScalarValues::String = "${doc.metadata.refFrame}";`);
    lines.push(`    attribute timeSystem : ScalarValues::String = "${doc.metadata.timeSystem}";`);
    lines.push("    attribute positionX : ScalarValues::Real;");
    lines.push("    attribute positionY : ScalarValues::Real;");
    lines.push("    attribute positionZ : ScalarValues::Real;");
    lines.push("    attribute velocityX : ScalarValues::Real;");
    lines.push("    attribute velocityY : ScalarValues::Real;");
    lines.push("    attribute velocityZ : ScalarValues::Real;");
    lines.push("  }");
  }

  lines.push("}");
  return lines.join("\n");
}

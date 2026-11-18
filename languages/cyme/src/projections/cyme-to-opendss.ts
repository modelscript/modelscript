// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cyme — Project CYME Network to EPRI OpenDSS (.dss).
 */

import type { CymeNetwork } from "../types.js";

export function projectCymeToOpenDss(net: CymeNetwork): string {
  const lines: string[] = ["Clear"];
  const src = net.sources[0];
  lines.push(
    `New Circuit.${net.networkId} bus1=${src?.nodeId ?? "SourceBus"} basekv=${src?.nominalKv ?? 12.47} pu=${src ? (src.operatingKv / src.nominalKv).toFixed(4) : "1.00"} phases=3`,
  );

  for (const sec of net.sections) {
    if (sec.deviceType === "Transformer") {
      lines.push(
        `New Transformer.${sec.sectionId} phases=3 windings=2 buses=[${sec.fromNodeId}, ${sec.toNodeId}] kvs=[${sec.primaryKv ?? 12.47}, ${sec.secondaryKv ?? 0.48}] kvas=[${sec.ratingKva ?? 500}, ${sec.ratingKva ?? 500}]`,
      );
    } else {
      lines.push(
        `New Line.${sec.sectionId} bus1=${sec.fromNodeId} bus2=${sec.toNodeId} phases=${sec.phase.length || 3} length=${(sec.lengthMeters / 1000).toFixed(4)} units=km r1=${sec.rOhmPerKm ?? 0.25} x1=${sec.xOhmPerKm ?? 0.4}`,
      );
    }
  }

  for (const load of net.loads) {
    lines.push(
      `New Load.${load.loadId} bus1=${load.nodeId} phases=${load.phase.length || 3} kw=${load.kw} kvar=${load.kvar}`,
    );
  }

  lines.push("CalcVoltageBases");
  lines.push("Solve");
  return lines.join("\n");
}

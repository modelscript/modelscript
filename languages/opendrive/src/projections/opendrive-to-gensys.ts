// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendrive — Bidirectional Projections to GENSYS Rail Dynamics Track (.geo / .trc).
 *
 * Translates OpenDRIVE 3D roadway trajectories and superelevation profiles into
 * standard multi-column GENSYS railway/roadway track geometry decks.
 */

import { sampleRoadTrack } from "../geometry/clothoid.js";
import type { OpenDriveDocument, OpenDriveRoad } from "../types.js";

export function opendriveToGensys(target: OpenDriveRoad | OpenDriveDocument, sampleStep = 1.0): string {
  const roads: OpenDriveRoad[] = "roads" in target ? target.roads : [target];
  const lines: string[] = [];

  lines.push("! GENSYS Track / Road Geometry Deck");
  lines.push("! Converted by ModelScript @modelscript/opendrive from ASAM OpenDRIVE");
  lines.push("!");
  lines.push("! Columns: s [m], x [m], y [m], z [m], hdg [rad], curvature [1/m], cant/roll [rad]");
  lines.push("");

  for (const road of roads) {
    const roadName = road.name ?? `Road_${road.id}`;
    lines.push(`! --- Begin Road: ${roadName} (ID: ${road.id}, Length: ${road.length}m) ---`);
    lines.push("track_data =");

    const points = sampleRoadTrack(road, sampleStep);
    for (const p of points) {
      lines.push(
        `  ${p.s.toFixed(3)}  ${p.x.toFixed(4)}  ${p.y.toFixed(4)}  ${p.z.toFixed(4)}  ${p.hdg.toFixed(5)}  ${p.curvature.toFixed(6)}  ${p.roll.toFixed(5)}`,
      );
    }

    lines.push("! --- End Road ---");
    lines.push("");
  }

  return lines.join("\n");
}

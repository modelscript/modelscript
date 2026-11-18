// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gridlabd — Project GridLAB-D (.glm) Distribution Model to OpenDSS (.dss).
 */

import { parseGlmLengthMiles, parseGlmPowerW, parseGlmVoltageV } from "../parser/gridlabd-parser.js";
import type { GlmModel } from "../types.js";

export function projectGridlabdToOpenDss(model: GlmModel, circuitName = "GridLABD_Feeder"): string {
  const lines: string[] = ["Clear"];
  const swing = model.allObjects.find((o) => o.properties["bustype"]?.toUpperCase().includes("SWING"));
  const baseKv = swing ? ((parseGlmVoltageV(swing.properties["nominal_voltage"]) ?? 7200) * Math.sqrt(3)) / 1e3 : 12.47;

  lines.push(
    `New Circuit.${circuitName} bus1=${swing?.name ?? "SourceBus"} basekv=${baseKv.toFixed(3)} pu=1.00 phases=3`,
  );

  for (const obj of model.allObjects) {
    if (obj.className === "overhead_line" || obj.className === "underground_line" || obj.className === "triplex_line") {
      const from = obj.properties["from"];
      const to = obj.properties["to"];
      if (!from || !to) continue;
      const miles = parseGlmLengthMiles(obj.properties["length"]) ?? 0.1;
      lines.push(`New Line.${obj.name ?? "L"} bus1=${from} bus2=${to} phases=3 length=${miles.toFixed(4)} units=mi`);
    } else if (obj.className === "transformer") {
      const from = obj.properties["from"];
      const to = obj.properties["to"];
      if (!from || !to) continue;
      lines.push(
        `New Transformer.${obj.name ?? "T"} phases=3 windings=2 buses=[${from}, ${to}] kvs=[${baseKv.toFixed(2)}, 0.48] kvas=[500, 500]`,
      );
    } else if (obj.className === "load" || obj.className === "triplex_load") {
      const bus = obj.name ?? obj.parent;
      if (!bus) continue;
      let kw = 0;
      let kvar = 0;
      for (const k of [
        "constant_power_A",
        "constant_power_B",
        "constant_power_C",
        "constant_power_1",
        "constant_power_2",
        "constant_power_12",
      ]) {
        const p = parseGlmPowerW(obj.properties[k]);
        if (p) {
          kw += p.pWatts / 1e3;
          kvar += p.qVAr / 1e3;
        }
      }
      if (kw !== 0 || kvar !== 0) {
        lines.push(`New Load.${obj.name ?? "LD"} bus1=${bus} phases=3 kw=${kw.toFixed(2)} kvar=${kvar.toFixed(2)}`);
      }
    }
  }

  lines.push("CalcVoltageBases");
  lines.push("Solve");
  return lines.join("\n");
}

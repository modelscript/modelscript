// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for Planet / TIA-329 (*.pat, *.msi) antenna radiation pattern files.
 */

import type { AntennaCut, AntennaPatternDeck, AntennaPatternPoint, AntennaPolarization } from "../types.js";
import { computeFrontToBackRatio, computeHalfPowerBeamwidth } from "./nsma-parser.js";

export function parsePlanetPat(content: string, filename = "antenna.pat"): AntennaPatternDeck {
  const lines = content.split(/\r?\n/);

  let name = "";
  let gainDbi = 0.0;
  let frequencyMhz = 0;
  let polarization: AntennaPolarization = "V";
  let tiltDeg = 0.0;

  const horizontalPoints: AntennaPatternPoint[] = [];
  const verticalPoints: AntennaPatternPoint[] = [];

  let currentSection: "header" | "horizontal" | "vertical" = "header";

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]?.trim();
    if (!rawLine || rawLine.startsWith("#") || rawLine.startsWith(";")) continue;

    const upper = rawLine.toUpperCase();
    if (upper.startsWith("HORIZONTAL")) {
      currentSection = "horizontal";
      continue;
    } else if (upper.startsWith("VERTICAL")) {
      currentSection = "vertical";
      continue;
    }

    if (currentSection === "header") {
      const parts = rawLine.split(/\s+/);
      const key = parts[0]?.toUpperCase();
      const val = parts.slice(1).join(" ");

      switch (key) {
        case "NAME":
          name = val;
          break;
        case "GAIN":
          gainDbi = parseFloat(val) || 0.0;
          break;
        case "FREQUENCY":
          frequencyMhz = parseFloat(val) || 0;
          break;
        case "TILT":
          tiltDeg = parseFloat(val) || 0.0;
          break;
        case "POLARIZATION":
          if (val.toUpperCase().startsWith("H")) polarization = "H";
          else if (val.toUpperCase().startsWith("D") || val.toUpperCase().includes("CROSS")) polarization = "Dual";
          else polarization = "V";
          break;
      }
      continue;
    }

    // Parse cut point: "<angle> <loss>"
    const tokens = rawLine
      .split(/[\s,]+/)
      .map((t) => parseFloat(t))
      .filter((n) => !isNaN(n));
    if (tokens.length >= 2) {
      const angle = tokens[0] ?? 0;
      const rawLoss = tokens[1] ?? 0;
      const pt: AntennaPatternPoint = { angleDeg: angle, attenuationDb: Math.abs(rawLoss) };

      if (currentSection === "horizontal") {
        horizontalPoints.push(pt);
      } else if (currentSection === "vertical") {
        verticalPoints.push(pt);
      }
    }
  }

  const horizontalCut: AntennaCut | undefined =
    horizontalPoints.length > 0 ? { cutType: "horizontal", points: horizontalPoints } : undefined;
  const verticalCut: AntennaCut | undefined =
    verticalPoints.length > 0 ? { cutType: "vertical", points: verticalPoints } : undefined;

  const hBw = horizontalCut ? computeHalfPowerBeamwidth(horizontalCut) : undefined;
  const vBw = verticalCut ? computeHalfPowerBeamwidth(verticalCut) : undefined;
  const f2b = horizontalCut ? computeFrontToBackRatio(horizontalCut) : undefined;

  return {
    name: name || filename.replace(/\.[^/.]+$/, ""),
    description: `Planet pattern: ${name}`,
    manufacturer: "Generic",
    model: name || "Antenna",
    peakGainDbi: gainDbi,
    frequencyRangeMhz: [frequencyMhz, frequencyMhz],
    nominalFrequencyMhz: frequencyMhz,
    polarization,
    electricalDowntiltDeg: tiltDeg,
    mechanicalTiltDeg: 0.0,
    horizontalCut,
    verticalCut,
    horizontalBeamwidthDeg: hBw,
    verticalBeamwidthDeg: vBw,
    frontToBackRatioDb: f2b,
  };
}

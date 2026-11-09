// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for NSMA WG16.99.050 (*.adf, *.nsma) antenna radiation pattern files.
 */

import type { AntennaCut, AntennaPatternDeck, AntennaPatternPoint, AntennaPolarization } from "../types.js";

export function parseNsmaAdf(content: string, filename = "antenna.adf"): AntennaPatternDeck {
  const lines = content.split(/\r?\n/);

  let description = "";
  let manufacturer = "";
  let model = "";
  let peakGainDbi = 0.0;
  let freqMinMhz = 0;
  let freqMaxMhz = 0;
  let polarization: AntennaPolarization = "V";
  let electricalDowntilt = 0.0;
  let mechanicalTilt = 0.0;

  const horizontalPoints: AntennaPatternPoint[] = [];
  const verticalPoints: AntennaPatternPoint[] = [];

  let currentCut: "horizontal" | "vertical" | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]?.trim();
    if (!rawLine || rawLine.startsWith("!")) continue;

    const colonIdx = rawLine.indexOf(":");
    if (colonIdx > 0 && colonIdx <= 8) {
      const key = rawLine.substring(0, colonIdx).trim().toUpperCase();
      const val = rawLine.substring(colonIdx + 1).trim();

      switch (key) {
        case "DESCR1":
        case "DESCR2":
          description = description ? `${description} ${val}` : val;
          break;
        case "MANUF":
          manufacturer = val;
          break;
        case "MODEL":
          model = val;
          break;
        case "GAIN":
          peakGainDbi = parseFloat(val) || 0.0;
          break;
        case "FRQREC": {
          const parts = val
            .split(/\s+/)
            .map((p) => parseFloat(p))
            .filter((n) => !isNaN(n));
          if (parts.length >= 2) {
            freqMinMhz = parts[0] ?? 0;
            freqMaxMhz = parts[1] ?? 0;
          } else if (parts.length === 1) {
            freqMinMhz = parts[0] ?? 0;
            freqMaxMhz = parts[0] ?? 0;
          }
          break;
        }
        case "POLARZ": {
          const p = val.toUpperCase();
          if (p.startsWith("H")) polarization = "H";
          else if (p.startsWith("D")) polarization = "Dual";
          else if (p.startsWith("C")) polarization = "Circular";
          else polarization = "V";
          break;
        }
        case "DTILTE":
          electricalDowntilt = parseFloat(val) || 0.0;
          break;
        case "DTILTM":
          mechanicalTilt = parseFloat(val) || 0.0;
          break;
        case "PATTYP": {
          const pt = val.toUpperCase();
          if (pt.startsWith("H")) currentCut = "horizontal";
          else if (pt.startsWith("E") || pt.startsWith("V")) currentCut = "vertical";
          break;
        }
        case "NOAVAL":
          currentCut = "horizontal";
          break;
        case "NOEVAL":
          currentCut = "vertical";
          break;
      }
      continue;
    }

    // Numerical data line: "angle loss_dB"
    const tokens = rawLine
      .split(/[\s,]+/)
      .map((t) => parseFloat(t))
      .filter((n) => !isNaN(n));
    if (tokens.length >= 2) {
      const angle = tokens[0] ?? 0;
      const rawLoss = tokens[1] ?? 0;
      const attenuationDb = Math.abs(rawLoss); // Loss is non-negative attenuation from peak

      const pt: AntennaPatternPoint = { angleDeg: angle, attenuationDb };
      if (currentCut === "vertical") {
        verticalPoints.push(pt);
      } else {
        // Default to horizontal if not specified
        horizontalPoints.push(pt);
      }
    }
  }

  // Calculate beamwidths and front-to-back ratios
  const horizontalCut: AntennaCut | undefined =
    horizontalPoints.length > 0 ? { cutType: "horizontal", points: horizontalPoints } : undefined;
  const verticalCut: AntennaCut | undefined =
    verticalPoints.length > 0 ? { cutType: "vertical", points: verticalPoints } : undefined;

  const hBw = horizontalCut ? computeHalfPowerBeamwidth(horizontalCut) : undefined;
  const vBw = verticalCut ? computeHalfPowerBeamwidth(verticalCut) : undefined;
  const f2b = horizontalCut ? computeFrontToBackRatio(horizontalCut) : undefined;

  return {
    name: model || filename.replace(/\.[^/.]+$/, ""),
    description,
    manufacturer,
    model,
    peakGainDbi,
    frequencyRangeMhz: [freqMinMhz, freqMaxMhz],
    polarization,
    electricalDowntiltDeg: electricalDowntilt,
    mechanicalTiltDeg: mechanicalTilt,
    horizontalCut,
    verticalCut,
    horizontalBeamwidthDeg: hBw,
    verticalBeamwidthDeg: vBw,
    frontToBackRatioDb: f2b,
  };
}

export function computeHalfPowerBeamwidth(cut: AntennaCut): number {
  // Finds the angular width where attenuation <= 3.0 dB on either side of 0 deg
  if (cut.points.length === 0) return 0;

  let leftAngle = 0;
  let rightAngle = 0;

  for (const pt of cut.points) {
    if (pt.angleDeg > 180 && pt.attenuationDb <= 3.0) {
      leftAngle = Math.max(leftAngle, 360 - pt.angleDeg);
    } else if (pt.angleDeg <= 180 && pt.attenuationDb <= 3.0) {
      rightAngle = Math.max(rightAngle, pt.angleDeg);
    }
  }

  return leftAngle + rightAngle;
}

export function computeFrontToBackRatio(cut: AntennaCut): number {
  // Attenuation around 180 deg (+/- 30 deg sector)
  let backLossSum = 0;
  let backCount = 0;

  for (const pt of cut.points) {
    if (pt.angleDeg >= 150 && pt.angleDeg <= 210) {
      backLossSum += pt.attenuationDb;
      backCount++;
    }
  }

  return backCount > 0 ? backLossSum / backCount : 25.0;
}

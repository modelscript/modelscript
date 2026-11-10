// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  BoundaryCondition,
  BoundaryType,
  HecRasCrossSection,
  HecRasFlow,
  HecRasGeometry,
  HecRasInlineStructure,
  HecRasReach,
  StationElevation,
} from "../types.js";

export function parseGeometry(text: string): HecRasGeometry {
  const lines = text.split(/\r?\n/);
  const reaches: HecRasReach[] = [];
  const crossSections: HecRasCrossSection[] = [];
  const inlineStructures: HecRasInlineStructure[] = [];

  let title: string | undefined;
  let version: string | undefined;

  let currentRiver = "River1";
  let currentReach = "Reach1";

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("Geom Title=")) {
      title = line.substring("Geom Title=".length).trim();
      continue;
    }
    if (line.startsWith("Program Version=")) {
      version = line.substring("Program Version=".length).trim();
      continue;
    }

    if (line.startsWith("River Reach=")) {
      const parts = line.substring("River Reach=".length).split(",");
      currentRiver = parts[0]?.trim() || "River1";
      currentReach = parts[1]?.trim() || "Reach1";

      const coords: { x: number; y: number }[] = [];
      let j = i + 1;
      let reachLineCount = 0;
      if (j < lines.length && lines[j]!.trim().startsWith("Reach XY=")) {
        const count = parseInt(lines[j]!.trim().substring("Reach XY=".length), 10) || 0;
        j++;
        while (j < lines.length && coords.length < count) {
          const l = lines[j]!.trim();
          if (l.includes("=") || l.startsWith("Type RM")) break;
          const xy = l.split(/[\s,]+/).filter(Boolean).map(Number);
          for (let k = 0; k < xy.length - 1; k += 2) {
            coords.push({ x: xy[k]!, y: xy[k + 1]! });
          }
          j++;
        }
        reachLineCount = j - (i + 1);
      }

      reaches.push({
        river: currentRiver,
        reach: currentReach,
        coords,
        line: i + 1,
      });
      i += reachLineCount;
      continue;
    }

    // Cross-Section or Inline Structure header
    if (line.startsWith("Type RM CEM CS=")) {
      const csParts = line.substring("Type RM CEM CS=".length).split(",");
      const typeCode = parseInt(csParts[0]?.trim() || "1", 10);
      const station = parseFloat(csParts[1]?.trim() || "0");
      const startLine = i + 1;

      let desc: string | undefined;
      const stationElevations: StationElevation[] = [];
      let leftOverbankLen = 100;
      let channelLen = 100;
      let rightOverbankLen = 100;
      let nLeft = 0.04;
      let nChannel = 0.035;
      let nRight = 0.04;
      let leftBank = 0;
      let rightBank = 0;
      let contrCoeff = 0.1;
      let expCoeff = 0.3;

      let isInline = typeCode === 2;
      let weirCrest = 0;
      let weirLen = 0;
      let weirCoef = 1.44; // standard SI weir discharge coefficient

      let j = i + 1;
      while (j < lines.length) {
        const sub = lines[j]!.trim();
        if (sub.startsWith("Type RM CEM CS=") || sub.startsWith("River Reach=")) {
          break;
        }

        if (sub.startsWith("DESCRIPTION=")) {
          desc = sub.substring("DESCRIPTION=".length).trim();
        } else if (sub.includes("Inline Structure")) {
          isInline = true;
        } else if (sub.startsWith("Weir Data=")) {
          const parts = sub.substring("Weir Data=".length).split(/[\s,]+/).filter(Boolean).map(Number);
          if (parts.length >= 2) {
            weirCrest = parts[0]!;
            weirLen = parts[1]!;
            if (parts[2]) weirCoef = parts[2];
          }
        } else if (sub.startsWith("Station Elevation Data=")) {
          const count = parseInt(sub.substring("Station Elevation Data=".length), 10) || 0;
          j++;
          while (j < lines.length && stationElevations.length < count) {
            const l = lines[j]!.trim();
            if (l.includes("=")) break;
            const vals = l.split(/[\s,]+/).filter(Boolean).map(Number);
            for (let k = 0; k < vals.length - 1; k += 2) {
              stationElevations.push({ station: vals[k]!, elevation: vals[k + 1]! });
            }
            j++;
          }
          continue; // j already incremented
        } else if (sub.startsWith("Cross Section Reach Lengths and Manning Values=") || sub.startsWith("Reach Lengths=")) {
          j++;
          if (j < lines.length) {
            const vals = lines[j]!.trim().split(/[\s,]+/).filter(Boolean).map(Number);
            if (vals.length >= 3) {
              leftOverbankLen = vals[0]!;
              channelLen = vals[1]!;
              rightOverbankLen = vals[2]!;
            }
            if (vals.length >= 7) {
              nLeft = vals[4]!;
              nChannel = vals[5]!;
              nRight = vals[6]!;
            }
          }
        } else if (sub.startsWith("Bank Sta=")) {
          const b = sub.substring("Bank Sta=".length).split(/[\s,]+/).filter(Boolean).map(Number);
          if (b.length >= 2) {
            leftBank = b[0]!;
            rightBank = b[1]!;
          }
        } else if (sub.startsWith("Exp/Contr=") || sub.startsWith("Contraction and Expansion=")) {
          const c = sub.split(/[\s,=]+/).filter(Boolean).map(Number).filter((n) => !isNaN(n));
          if (c.length >= 2) {
            contrCoeff = c[0]!;
            expCoeff = c[1]!;
          }
        }
        j++;
      }

      if (isInline) {
        inlineStructures.push({
          river: currentRiver,
          reach: currentReach,
          station,
          weirCrestElevation: weirCrest || (stationElevations[0]?.elevation ?? 100),
          weirLength: weirLen || (rightBank - leftBank || 50),
          dischargeCoefficient: weirCoef,
          line: startLine,
        });
      } else {
        if (leftBank === 0 && rightBank === 0 && stationElevations.length >= 2) {
          leftBank = stationElevations[0]!.station;
          rightBank = stationElevations[stationElevations.length - 1]!.station;
        }

        crossSections.push({
          river: currentRiver,
          reach: currentReach,
          station,
          description: desc,
          stationElevations,
          reachLengths: {
            leftOverbank: leftOverbankLen,
            channel: channelLen,
            rightOverbank: rightOverbankLen,
          },
          manning: {
            leftOverbank: nLeft,
            channel: nChannel,
            rightOverbank: nRight,
          },
          bankStations: {
            left: leftBank,
            right: rightBank,
          },
          contractionCoefficient: contrCoeff,
          expansionCoefficient: expCoeff,
          line: startLine,
        });
      }

      i = j - 1;
    }
  }

  return {
    title,
    version,
    reaches,
    crossSections,
    inlineStructures,
  };
}

export function parseFlow(text: string): HecRasFlow {
  const lines = text.split(/\r?\n/);
  const boundaryConditions: BoundaryCondition[] = [];
  let title: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    if (line.startsWith("Flow Title=")) {
      title = line.substring("Flow Title=".length).trim();
      continue;
    }

    if (line.startsWith("Boundary for River Reach & Node=")) {
      const parts = line.substring("Boundary for River Reach & Node=".length).split(",");
      const river = parts[0]?.trim() || "River1";
      const reach = parts[1]?.trim() || "Reach1";
      const station = parseFloat(parts[2]?.trim() || "0");
      const startLine = i + 1;

      let bType: BoundaryType = "Normal Depth";
      let frictionSlope = 0.001;
      let knownStage: number | undefined;
      const hydrograph: { timeHours: number; flowOrStage: number }[] = [];

      let j = i + 1;
      while (j < lines.length) {
        const sub = lines[j]!.trim();
        if (sub.startsWith("Boundary for River Reach & Node=")) break;

        if (sub.startsWith("Boundary Type=")) {
          const t = sub.substring("Boundary Type=".length).trim();
          if (
            t === "Flow Hydrograph" ||
            t === "Stage Hydrograph" ||
            t === "Normal Depth" ||
            t === "Rating Curve" ||
            t === "Known WS"
          ) {
            bType = t;
          }
        } else if (sub.startsWith("Friction Slope=")) {
          frictionSlope = parseFloat(sub.substring("Friction Slope=".length).trim()) || 0.001;
        } else if (sub.startsWith("Known WS=")) {
          knownStage = parseFloat(sub.substring("Known WS=".length).trim());
        } else if (sub.startsWith("Hydrograph Data=")) {
          j++;
          while (j < lines.length) {
            const l = lines[j]!.trim();
            if (l.includes("=")) break;
            const vals = l.split(/[\s,]+/).filter(Boolean).map(Number);
            for (let k = 0; k < vals.length - 1; k += 2) {
              hydrograph.push({ timeHours: vals[k]!, flowOrStage: vals[k + 1]! });
            }
            j++;
          }
          continue;
        }
        j++;
      }

      boundaryConditions.push({
        river,
        reach,
        station,
        type: bType,
        frictionSlope,
        knownStage,
        hydrograph: hydrograph.length > 0 ? hydrograph : undefined,
        line: startLine,
      });

      i = j - 1;
    }
  }

  return {
    title,
    boundaryConditions,
  };
}

export function parseHecRas(text: string): { geometry?: HecRasGeometry | undefined; flow?: HecRasFlow | undefined } {
  const isGeom =
    text.includes("Type RM CEM CS=") ||
    text.includes("River Reach=") ||
    text.includes("Station Elevation Data=") ||
    text.includes("Geom Title=");
  const isFlow =
    text.includes("Boundary for River Reach & Node=") ||
    text.includes("Flow Title=") ||
    text.includes("Boundary Type=");

  return {
    geometry: isGeom ? parseGeometry(text) : undefined,
    flow: isFlow ? parseFlow(text) : undefined,
  };
}

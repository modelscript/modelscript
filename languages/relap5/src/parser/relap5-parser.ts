// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/relap5 — Zero-Regex RELAP5-3D / TRACE Card Deck Parser & Serializer.
 *
 * Implements 80-column character-level parsing for nuclear reactor safety decks (100 - 600 series cards).
 */

import type {
  ComponentType,
  Relap5Card,
  Relap5Deck,
  Relap5HeatStructure,
  Relap5Junction,
  Relap5Kinetics,
  Relap5Range,
  Relap5TimeStepControl,
  Relap5Trip,
  Relap5Volume,
  TripOperator,
} from "../types.js";

function splitTokens(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === " " || ch === "\t" || ch === ",") {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

export function parseRelap5(source: string, filename?: string): Relap5Deck {
  const lines = source.split("\n");
  const rawCards: Relap5Card[] = [];

  let lineOffset = 0;
  for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
    const rawLine = lines[lineNum - 1]!;
    const trimmed = rawLine.trim();

    // Check for comment or blank line
    if (trimmed.length === 0 || trimmed.startsWith("*") || trimmed.startsWith("/")) {
      lineOffset += rawLine.length + 1;
      continue;
    }

    // Stop at terminal marker
    if (trimmed === "." || trimmed.toLowerCase() === "end" || trimmed === "/") {
      break;
    }

    const tokens = splitTokens(trimmed);
    if (tokens.length === 0) {
      lineOffset += rawLine.length + 1;
      continue;
    }

    const firstTok = tokens[0]!;
    const cardNum = parseInt(firstTok, 10);
    if (!isNaN(cardNum)) {
      const words = tokens.slice(1);
      const range: Relap5Range = {
        startLine: lineNum,
        startColumn: 1,
        endLine: lineNum,
        endColumn: rawLine.length + 1,
        startOffset: lineOffset,
        endOffset: lineOffset + rawLine.length,
      };

      rawCards.push({
        cardNumber: cardNum,
        words,
        rawText: rawLine,
        range,
      });
    }

    lineOffset += rawLine.length + 1;
  }

  // Build Structured Deck
  let title = "RELAP5 Nuclear Reactor Model";
  let problemType: "transnt" | "stdy-st" = "transnt";
  let executionType: "new" | "restart" = "new";
  const timeSteps: Relap5TimeStepControl[] = [];
  const trips = new Map<number, Relap5Trip>();
  const volumes = new Map<number, Relap5Volume>();
  const junctions = new Map<number, Relap5Junction>();
  const heatStructures = new Map<number, Relap5HeatStructure>();
  let kinetics: Relap5Kinetics | undefined;

  for (const card of rawCards) {
    const num = card.cardNumber;
    const words = card.words;

    // 100 Title card
    if (num === 100) {
      title = words.join(" ");
      continue;
    }

    // 101 Problem type card: [new/restart, transnt/stdy-st]
    if (num === 101) {
      if (words[0]?.toLowerCase() === "restart") executionType = "restart";
      if (words[1]?.toLowerCase() === "stdy-st") problemType = "stdy-st";
      continue;
    }

    // 201 Time step control card: [endTime, minDt, maxDt, minorFreq, majorFreq]
    if (num >= 201 && num <= 299) {
      if (words.length >= 3) {
        timeSteps.push({
          endTime: parseFloat(words[0] ?? "10.0"),
          minDt: parseFloat(words[1] ?? "1e-5"),
          maxDt: parseFloat(words[2] ?? "0.01"),
          minorEditFreq: words[3] ? parseInt(words[3], 10) : undefined,
          majorEditFreq: words[4] ? parseInt(words[4], 10) : undefined,
        });
      }
      continue;
    }

    // 2060000 - 2069990 Variable & Logical Trip cards
    if (num >= 2060000 && num <= 2069999) {
      const tripId = num - 2060000;
      if (words.length >= 3) {
        const isLogical = words[1]?.toLowerCase() === "and" || words[1]?.toLowerCase() === "or";
        if (isLogical) {
          const c1 = parseInt(words[0] ?? "0", 10);
          const c2 = parseInt(words[2] ?? "0", 10);
          trips.set(tripId, {
            id: tripId,
            isLogical: true,
            childTripIds: [c1, c2],
            latched: words.some((w) => w.toLowerCase() === "l" || w.toLowerCase() === "latched"),
            range: card.range,
          });
        } else {
          const varName = words[0] ?? "";
          const op = (words[1]?.toLowerCase() ?? "gt") as TripOperator;
          const setpoint = parseFloat(words[2] ?? "0");
          trips.set(tripId, {
            id: tripId,
            isLogical: false,
            variableName: varName,
            operator: op,
            setpoint,
            latched: words.some((w) => w.toLowerCase() === "l" || w.toLowerCase() === "latched"),
            range: card.range,
          });
        }
      }
      continue;
    }

    // 300-400 series Hydrodynamic Components
    // Component Header Card: CCC0000 [Name, Type]
    if (num >= 100000 && num < 6000000 && num % 10000 === 0) {
      const compId = Math.floor(num / 10000);
      const name = words[0] ?? `Comp_${compId}`;
      const type = (words[1]?.toLowerCase() ?? "pipe") as ComponentType;

      if (type === "snglj" || type === "tmdpj" || type === "valve") {
        junctions.set(compId, {
          id: compId,
          fromVolume: 0,
          toVolume: 0,
          area: 0.1,
          forwardLoss: 0.0,
          reverseLoss: 0.0,
          initialLiquidVelocity: 0.0,
          initialVaporVelocity: 0.0,
          chokedFlowModel: true,
          range: card.range,
        });
      } else {
        volumes.set(compId, {
          id: compId,
          name,
          type,
          flowArea: 0.1,
          length: 1.0,
          volume: 0.1,
          elevationChange: 0.0,
          inclinationAngle: 0.0,
          roughness: 1e-5,
          hydraulicDiameter: 0.35,
          initialPressure: 1.55e7, // 15.5 MPa PWR typical
          initialTemperature: 560.0, // 560 K
          initialVoidFraction: 0.0,
          range: card.range,
        });
      }
      continue;
    }

    // Volume geometry sub-cards
    const compId = Math.floor(num / 10000);
    const subCard = num % 10000;

    const vol = volumes.get(compId);
    if (vol) {
      // Area, Length, Volume
      if (subCard === 101 && words.length >= 2) {
        vol.flowArea = parseFloat(words[0] ?? "0.1");
        vol.length = parseFloat(words[1] ?? "1.0");
        vol.volume = words[2] ? parseFloat(words[2]) : vol.flowArea * vol.length;
      }
      // Inclination and elevation change
      if (subCard === 201 && words.length >= 2) {
        vol.inclinationAngle = parseFloat(words[0] ?? "0");
        vol.elevationChange = parseFloat(words[1] ?? "0");
      }
      // Roughness and hydraulic diameter
      if (subCard === 301 && words.length >= 2) {
        vol.roughness = parseFloat(words[0] ?? "1e-5");
        vol.hydraulicDiameter = parseFloat(words[1] ?? "0.35");
      }
      // Initial conditions: P, T / alpha
      if (subCard === 501 && words.length >= 2) {
        vol.initialPressure = parseFloat(words[0] ?? "1.55e7");
        vol.initialTemperature = parseFloat(words[1] ?? "560.0");
        if (words[2]) vol.initialVoidFraction = parseFloat(words[2]);
      }
      continue;
    }

    const junc = junctions.get(compId);
    if (junc) {
      // Junction from-volume, to-volume, area
      if (subCard === 101 && words.length >= 3) {
        junc.fromVolume = parseInt(words[0] ?? "0", 10);
        junc.toVolume = parseInt(words[1] ?? "0", 10);
        junc.area = parseFloat(words[2] ?? "0.1");
      }
      // Junction form loss coefficients
      if (subCard === 102 && words.length >= 2) {
        junc.forwardLoss = parseFloat(words[0] ?? "0.0");
        junc.reverseLoss = parseFloat(words[1] ?? "0.0");
      }
      // Junction velocities
      if (subCard === 201 && words.length >= 2) {
        junc.initialLiquidVelocity = parseFloat(words[0] ?? "0.0");
        junc.initialVaporVelocity = parseFloat(words[1] ?? "0.0");
      }
      continue;
    }

    // 500-series Heat Structures (1CCC0000, 1CCC0101, 1CCC0201)
    if (num >= 10000000 && num < 20000000) {
      const hsId = Math.floor((num - 10000000) / 10000);
      const hsSub = (num - 10000000) % 10000;

      let hs = heatStructures.get(hsId);
      if (!hs) {
        hs = {
          id: hsId,
          meshPoints: 5,
          thermalConductivity: 15.0, // W/m-K (Zircaloy / Stainless Steel)
          volumetricHeatCapacity: 2.1e6, // J/m^3-K
          initialTemperature: 580.0,
          range: card.range,
        };
        heatStructures.set(hsId, hs);
      }

      if (hsSub === 0 && words.length >= 1) {
        hs.meshPoints = parseInt(words[0] ?? "5", 10);
      } else if (hsSub === 101 && words.length >= 2) {
        hs.thermalConductivity = parseFloat(words[0] ?? "15.0");
        hs.volumetricHeatCapacity = parseFloat(words[1] ?? "2.1e6");
      } else if (hsSub === 201 && words.length >= 2) {
        hs.leftVolumeId = parseInt(words[0] ?? "0", 10);
        hs.rightVolumeId = parseInt(words[1] ?? "0", 10);
      }
      continue;
    }

    // 600-series Point Kinetics
    if (num === 6000000) {
      kinetics = {
        promptGenerationTime: parseFloat(words[1] ?? "2.0e-5"), // Lambda (s)
        totalDelayedFraction: parseFloat(words[2] ?? "0.0065"), // beta
        initialPower: words[3] ? parseFloat(words[3]) : 3.0e9, // 3000 MWth PWR
        delayedGroups: [],
        fuelTempReactivityCoeff: -2.5e-5, // -2.5 pcm / K Doppler
        moderatorTempReactivityCoeff: -1.0e-4, // -10 pcm / K MTC
        range: card.range,
      };
      continue;
    }

    if (num >= 6000001 && num <= 6000006 && kinetics) {
      const grpNum = num - 6000000;
      if (words.length >= 2) {
        kinetics.delayedGroups.push({
          group: grpNum,
          decayConstant: parseFloat(words[0] ?? "0.1"),
          fraction: parseFloat(words[1] ?? "0.001"),
        });
      }
      continue;
    }

    if (num === 6000010 && kinetics && words.length >= 2) {
      kinetics.fuelTempReactivityCoeff = parseFloat(words[0] ?? "-2.5e-5");
      kinetics.moderatorTempReactivityCoeff = parseFloat(words[1] ?? "-1.0e-4");
      continue;
    }
  }

  return {
    title,
    problemType,
    executionType,
    timeSteps,
    trips,
    volumes,
    junctions,
    heatStructures,
    kinetics,
    sourceFile: filename,
    rawCards,
  };
}

/**
 * Serializes Relap5Deck back to standard RELAP5-3D formatted card deck.
 */
export function serializeRelap5(deck: Relap5Deck): string {
  const lines: string[] = [];
  lines.push(`* ====================================================================`);
  lines.push(`* US NRC RELAP5-3D Thermal-Hydraulics Model Deck`);
  lines.push(`* ====================================================================`);
  lines.push(`100 ${deck.title}`);
  lines.push(`101 ${deck.executionType} ${deck.problemType}`);

  // Time step control
  if (deck.timeSteps.length > 0) {
    lines.push(`* --------------------------------------------------------------------`);
    lines.push(`* Time Step Control: endTime, minDt, maxDt`);
    for (let i = 0; i < deck.timeSteps.length; i++) {
      const ts = deck.timeSteps[i]!;
      lines.push(`20${i + 1} ${ts.endTime} ${ts.minDt} ${ts.maxDt}`);
    }
  }

  // Trips
  if (deck.trips.size > 0) {
    lines.push(`* --------------------------------------------------------------------`);
    lines.push(`* Trip Cards`);
    for (const trip of deck.trips.values()) {
      const cardNum = 2060000 + trip.id;
      if (trip.isLogical && trip.childTripIds) {
        lines.push(`${cardNum} ${trip.childTripIds[0]} and ${trip.childTripIds[1]} ${trip.latched ? "l" : "u"}`);
      } else {
        lines.push(
          `${cardNum} ${trip.variableName ?? "time"} ${trip.operator ?? "gt"} ${trip.setpoint ?? 0} ${trip.latched ? "l" : "u"}`,
        );
      }
    }
  }

  // Hydrodynamic Volumes
  if (deck.volumes.size > 0) {
    lines.push(`* --------------------------------------------------------------------`);
    lines.push(`* Hydrodynamic Volumes (300-series)`);
    for (const vol of deck.volumes.values()) {
      const base = vol.id * 10000;
      lines.push(`${base} ${vol.name} ${vol.type}`);
      lines.push(`${base + 101} ${vol.flowArea} ${vol.length} ${vol.volume}`);
      lines.push(`${base + 201} ${vol.inclinationAngle} ${vol.elevationChange}`);
      lines.push(`${base + 301} ${vol.roughness} ${vol.hydraulicDiameter}`);
      lines.push(`${base + 501} ${vol.initialPressure} ${vol.initialTemperature} ${vol.initialVoidFraction ?? 0.0}`);
    }
  }

  // Junctions
  if (deck.junctions.size > 0) {
    lines.push(`* --------------------------------------------------------------------`);
    lines.push(`* Hydrodynamic Junctions`);
    for (const junc of deck.junctions.values()) {
      const base = junc.id * 10000;
      lines.push(`${base} Junc_${junc.id} snglj`);
      lines.push(`${base + 101} ${junc.fromVolume} ${junc.toVolume} ${junc.area}`);
      lines.push(`${base + 102} ${junc.forwardLoss} ${junc.reverseLoss}`);
      lines.push(`${base + 201} ${junc.initialLiquidVelocity} ${junc.initialVaporVelocity}`);
    }
  }

  // Heat Structures
  if (deck.heatStructures.size > 0) {
    lines.push(`* --------------------------------------------------------------------`);
    lines.push(`* Heat Structures (500-series)`);
    for (const hs of deck.heatStructures.values()) {
      const base = 10000000 + hs.id * 10000;
      lines.push(`${base} ${hs.meshPoints} 1`);
      lines.push(`${base + 101} ${hs.thermalConductivity} ${hs.volumetricHeatCapacity}`);
      if (hs.leftVolumeId !== undefined && hs.rightVolumeId !== undefined) {
        lines.push(`${base + 201} ${hs.leftVolumeId} ${hs.rightVolumeId}`);
      }
    }
  }

  // Kinetics
  if (deck.kinetics) {
    lines.push(`* --------------------------------------------------------------------`);
    lines.push(`* Reactor Point Kinetics (600-series)`);
    lines.push(
      `6000000 point ${deck.kinetics.promptGenerationTime} ${deck.kinetics.totalDelayedFraction} ${deck.kinetics.initialPower}`,
    );
    for (const grp of deck.kinetics.delayedGroups) {
      lines.push(`${6000000 + grp.group} ${grp.decayConstant} ${grp.fraction}`);
    }
    lines.push(`6000010 ${deck.kinetics.fuelTempReactivityCoeff} ${deck.kinetics.moderatorTempReactivityCoeff}`);
  }

  lines.push(`. end`);
  return lines.join("\n");
}

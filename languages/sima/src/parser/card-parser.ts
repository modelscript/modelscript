// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for classical MARINTEK / SINTEF Ocean card-based input decks:
 * - SIMO: simo.inp, sys.inp (SYS, BODY, MASS, DAMP, WAVE, WIND, CURR)
 * - RIFLEX: _inpmod.inp, _stamod.inp, _dynmod.inp (LINE, SEGM, CRS, ATTACH)
 */

import type {
  EnvironmentalConditions,
  FairleadPoint,
  LineSegment,
  MooringLine,
  SimaModel,
  SimulationConfig,
  Vessel,
} from "../types.js";

export function parseCardDeck(text: string, filePath?: string): SimaModel {
  const lines = text.split(/\r?\n/);
  const rawCards: Record<string, string[]> = {};

  const vessels: Vessel[] = [];
  const mooringLines: MooringLine[] = [];

  const environment: EnvironmentalConditions = {
    waterDepth: 200,
    waterDensity: 1025,
    seabedFriction: 0.5,
    wave: {
      spectrum: "jonswap",
      hs: 6.0,
      tp: 12.0,
      gamma: 3.3,
      direction: 0,
    },
    wind: {
      speed: 15.0,
      direction: 0,
    },
    current: {
      surfaceSpeed: 1.0,
      direction: 0,
    },
  };

  const simulation: SimulationConfig = {
    timeStep: 0.1,
    duration: 3600,
    solver: "catenary_quasi_static",
  };

  let currentVessel: Vessel | null = null;
  let currentLine: MooringLine | null = null;
  let lineSegmentsMap: Record<string, LineSegment> = {};

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!.trim();
    // Skip empty lines and comment lines (comments begin with '!', '*', or '#')
    if (!rawLine || rawLine.startsWith("!") || rawLine.startsWith("*") || rawLine.startsWith("#")) {
      continue;
    }

    const tokens = rawLine.split(/\s+/);
    const card = tokens[0]!.toUpperCase();

    if (!rawCards[card]) {
      rawCards[card] = [];
    }
    rawCards[card]!.push(rawLine);

    switch (card) {
      case "SYS":
      case "SYSTEM": {
        // SYS <depth> <density> <gravity>
        if (tokens.length >= 2 && !isNaN(parseFloat(tokens[1]!))) {
          environment.waterDepth = parseFloat(tokens[1]!);
        }
        if (tokens.length >= 3 && !isNaN(parseFloat(tokens[2]!))) {
          environment.waterDensity = parseFloat(tokens[2]!);
        }
        break;
      }

      case "BODY":
      case "VESSEL": {
        // BODY <id> <name> <mass> <disp> <x_cg> <y_cg> <z_cg> <rxx> <ryy> <rzz> <gmt> <gml>
        const id = tokens[1] ?? `vessel_${vessels.length + 1}`;
        const name = tokens[2] ?? id;
        const mass = tokens.length >= 4 ? parseFloat(tokens[3]!) : 10000000;
        const disp = tokens.length >= 5 ? parseFloat(tokens[4]!) : mass / environment.waterDensity;
        const x_cg = tokens.length >= 6 ? parseFloat(tokens[5]!) : 0;
        const y_cg = tokens.length >= 7 ? parseFloat(tokens[6]!) : 0;
        const z_cg = tokens.length >= 8 ? parseFloat(tokens[7]!) : -5;
        const rxx = tokens.length >= 9 ? parseFloat(tokens[8]!) : 30;
        const ryy = tokens.length >= 10 ? parseFloat(tokens[9]!) : 30;
        const rzz = tokens.length >= 11 ? parseFloat(tokens[10]!) : 35;
        const gmt = tokens.length >= 12 ? parseFloat(tokens[11]!) : 4.5;
        const gml = tokens.length >= 13 ? parseFloat(tokens[12]!) : 5.0;

        currentVessel = {
          id,
          name,
          mass,
          displacement: disp,
          cg: [x_cg, y_cg, z_cg],
          radiiOfGyration: [rxx, ryy, rzz],
          massMatrix: createDiagonalMatrix([mass, mass, mass, mass * rxx * rxx, mass * ryy * ryy, mass * rzz * rzz]),
          hydrostaticMatrix: createHydrostaticMatrix(environment.waterDensity, disp, gmt, gml),
          linearDamping: createDiagonalMatrix([1e5, 1e5, 2e5, 1e7, 1e7, 1e7]),
          quadraticDamping: createDiagonalMatrix([5e4, 5e4, 1e5, 5e6, 5e6, 5e6]),
          gmTransverse: gmt,
          gmLongitudinal: gml,
          fairleads: [],
        };
        vessels.push(currentVessel);
        break;
      }

      case "FAIRLEAD":
      case "ATTACH": {
        // FAIRLEAD <id> <vessel_id> <x> <y> <z>
        const id = tokens[1] ?? `fairlead_${Date.now()}`;
        const vesselId = tokens[2] ?? (currentVessel ? currentVessel.id : "vessel_1");
        const x = tokens.length >= 4 ? parseFloat(tokens[3]!) : 0;
        const y = tokens.length >= 5 ? parseFloat(tokens[4]!) : 0;
        const z = tokens.length >= 6 ? parseFloat(tokens[5]!) : 0;

        const fl: FairleadPoint = {
          id,
          name: id,
          vesselId,
          position: [x, y, z],
        };

        const targetVessel = vessels.find((v) => v.id === vesselId) ?? currentVessel;
        if (targetVessel) {
          targetVessel.fairleads.push(fl);
        }
        break;
      }

      case "CRS":
      case "CROSS_SECTION":
      case "LINETYPE": {
        // CRS <name> <diam> <dry_mass> <sub_weight> <EA> <EI> <MBL> <Cd> <Cm>
        const name = tokens[1] ?? `type_${Object.keys(lineSegmentsMap).length + 1}`;
        const diameter = tokens.length >= 3 ? parseFloat(tokens[2]!) : 0.12;
        const dryMass = tokens.length >= 4 ? parseFloat(tokens[3]!) : 290;
        const subWeight = tokens.length >= 5 ? parseFloat(tokens[4]!) : 2500;
        const ea = tokens.length >= 6 ? parseFloat(tokens[5]!) : 1.0e9;
        const ei = tokens.length >= 7 ? parseFloat(tokens[6]!) : 1.0e5;
        const mbl = tokens.length >= 8 ? parseFloat(tokens[7]!) : 1.5e7;
        const cd = tokens.length >= 9 ? parseFloat(tokens[8]!) : 1.2;
        const cm = tokens.length >= 10 ? parseFloat(tokens[9]!) : 2.0;

        lineSegmentsMap[name] = {
          id: name,
          name,
          length: 0,
          diameter,
          dryMassPerMeter: dryMass,
          submergedWeightPerMeter: subWeight,
          axialStiffnessEA: ea,
          bendingStiffnessEI: ei,
          mbl,
          cd,
          cm,
          lineType: name,
        };
        break;
      }

      case "LINE":
      case "MOORING": {
        // LINE <id> <type> <fairlead_id> <anchor_x> <anchor_y> <anchor_z>
        const id = tokens[1] ?? `line_${mooringLines.length + 1}`;
        const lineType = (tokens[2]?.toLowerCase() ?? "catenary") as MooringLine["type"];
        const fairleadId = tokens[3] ?? "fairlead_1";
        const anc_x = tokens.length >= 5 ? parseFloat(tokens[4]!) : 500;
        const anc_y = tokens.length >= 6 ? parseFloat(tokens[5]!) : 0;
        const anc_z = tokens.length >= 7 ? parseFloat(tokens[6]!) : -environment.waterDepth;

        currentLine = {
          id,
          name: id,
          type: lineType,
          fairleadId,
          anchorPosition: [anc_x, anc_y, anc_z],
          segments: [],
          totalLength: 0,
        };
        mooringLines.push(currentLine);
        break;
      }

      case "SEGM":
      case "SEGMENT": {
        // SEGM <type_ref> <length> [<mbl>] [<mbr>]
        if (!currentLine) break;
        const typeRef = tokens[1] ?? "default_type";
        const len = tokens.length >= 3 ? parseFloat(tokens[2]!) : 500;
        const base = lineSegmentsMap[typeRef] ?? {
          id: typeRef,
          name: typeRef,
          length: len,
          diameter: 0.12,
          dryMassPerMeter: 290,
          submergedWeightPerMeter: 2500,
          axialStiffnessEA: 1e9,
          bendingStiffnessEI: 1e5,
          mbl: 1.5e7,
          cd: 1.2,
          cm: 2.0,
        };

        const segment: LineSegment = {
          ...base,
          id: `${currentLine.id}_seg_${currentLine.segments.length + 1}`,
          length: len,
        };
        if (tokens.length >= 4 && !isNaN(parseFloat(tokens[3]!))) {
          segment.mbl = parseFloat(tokens[3]!);
        }

        currentLine.segments.push(segment);
        currentLine.totalLength += len;
        break;
      }

      case "WAVE": {
        // WAVE <spectrum> <hs> <tp> <gamma> <dir>
        if (tokens.length >= 2) {
          environment.wave.spectrum = tokens[1]!.toLowerCase() as EnvironmentalConditions["wave"]["spectrum"];
        }
        if (tokens.length >= 3 && !isNaN(parseFloat(tokens[2]!))) {
          environment.wave.hs = parseFloat(tokens[2]!);
        }
        if (tokens.length >= 4 && !isNaN(parseFloat(tokens[3]!))) {
          environment.wave.tp = parseFloat(tokens[3]!);
        }
        if (tokens.length >= 5 && !isNaN(parseFloat(tokens[4]!))) {
          environment.wave.gamma = parseFloat(tokens[4]!);
        }
        if (tokens.length >= 6 && !isNaN(parseFloat(tokens[5]!))) {
          environment.wave.direction = parseFloat(tokens[5]!);
        }
        break;
      }

      case "WIND": {
        // WIND <speed> <dir>
        if (tokens.length >= 2 && !isNaN(parseFloat(tokens[1]!))) {
          environment.wind.speed = parseFloat(tokens[1]!);
        }
        if (tokens.length >= 3 && !isNaN(parseFloat(tokens[2]!))) {
          environment.wind.direction = parseFloat(tokens[2]!);
        }
        break;
      }

      case "CURR":
      case "CURRENT": {
        // CURR <speed> <dir>
        if (tokens.length >= 2 && !isNaN(parseFloat(tokens[1]!))) {
          environment.current.surfaceSpeed = parseFloat(tokens[1]!);
        }
        if (tokens.length >= 3 && !isNaN(parseFloat(tokens[2]!))) {
          environment.current.direction = parseFloat(tokens[2]!);
        }
        break;
      }

      case "TIME":
      case "DYNMOD": {
        // TIME <dt> <duration>
        if (tokens.length >= 2 && !isNaN(parseFloat(tokens[1]!))) {
          simulation.timeStep = parseFloat(tokens[1]!);
        }
        if (tokens.length >= 3 && !isNaN(parseFloat(tokens[2]!))) {
          simulation.duration = parseFloat(tokens[2]!);
        }
        break;
      }
    }
  }

  // Populate fairlead coordinates into lines if matched
  for (const line of mooringLines) {
    for (const v of vessels) {
      const fl = v.fairleads.find((f) => f.id === line.fairleadId);
      if (fl) {
        line.fairleadPosition = fl.position;
        break;
      }
    }
  }

  return {
    title: filePath ? filePath.split("/").pop() : "SIMO/RIFLEX Model",
    sourceFile: filePath,
    vessels,
    lines: mooringLines,
    environment,
    simulation,
    rawCards,
  };
}

function createDiagonalMatrix(diag: number[]): number[][] {
  const m: number[][] = [];
  for (let r = 0; r < 6; r++) {
    const row: number[] = [0, 0, 0, 0, 0, 0];
    if (r < diag.length) {
      row[r] = diag[r]!;
    }
    m.push(row);
  }
  return m;
}

function createHydrostaticMatrix(density: number, disp: number, gmt: number, gml: number): number[][] {
  const g = 9.80665;
  const c: number[][] = [];
  for (let r = 0; r < 6; r++) {
    c.push([0, 0, 0, 0, 0, 0]);
  }
  // C33 = rho * g * Aw (approx: disp / draught * rho * g)
  const aw = (disp / 20) * 1.2;
  c[2]![2] = density * g * aw;
  // C44 = disp * rho * g * GMt
  c[3]![3] = disp * density * g * gmt;
  // C55 = disp * rho * g * GMl
  c[4]![4] = disp * density * g * gml;
  return c;
}

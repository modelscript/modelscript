// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for RINEX v2 GNSS Navigation Equations.
 *
 * Lowers the nonlinear 3D pseudorange observation system:
 *   sqrt((X_s,i - rx_x)^2 + (Y_s,i - rx_y)^2 + (Z_s,i - rx_z)^2) + rx_cdt = P_i + c * dt_sv,i
 * directly into `@modelscript/runtime`'s linear-memory `DAEBuilder` without
 * intermediate AST wrapper allocations.
 */

import { BinOp, Causality, DAEBuilder, EqKind, VarType, Variability, type IDaeBuilder } from "@modelscript/runtime";
import { SPEED_OF_LIGHT, computeSatelliteEcef, selectBestEphemeris } from "../solver/index.js";
import type { EcefCoords, RinexDocument, SatellitePseudorange } from "../types.js";

export interface RinexDaeLoweringResult {
  receiverVarIndices: {
    x: number;
    y: number;
    z: number;
    cdt: number;
  };
  equationCount: number;
  variableMap: Map<string, number>;
}

/**
 * Lowers a set of GNSS satellite pseudorange observations directly into `IDaeBuilder`.
 */
export function lowerRinexToDae(
  builder: IDaeBuilder,
  observations: SatellitePseudorange[],
  initialGuess: EcefCoords = { x: 0, y: 0, z: 0 },
): RinexDaeLoweringResult {
  const variableMap = new Map<string, number>();

  const rxX = builder.addVariable("rx_x", VarType.Real, Variability.Continuous, Causality.Local, initialGuess.x);
  const rxY = builder.addVariable("rx_y", VarType.Real, Variability.Continuous, Causality.Local, initialGuess.y);
  const rxZ = builder.addVariable("rx_z", VarType.Real, Variability.Continuous, Causality.Local, initialGuess.z);
  const rxCdt = builder.addVariable("rx_cdt", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

  variableMap.set("rx_x", rxX);
  variableMap.set("rx_y", rxY);
  variableMap.set("rx_z", rxZ);
  variableMap.set("rx_cdt", rxCdt);

  let equationCount = 0;

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i]!;
    const tag = obs.prn.replace(/[^A-Za-z0-9_]/g, "_");
    const correctedPr = obs.pseudorangeM + SPEED_OF_LIGHT * (obs.satClockBiasSec ?? 0);

    const sxVar = builder.addVariable(
      `sat_${tag}_x`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      obs.satPos.x,
    );
    const syVar = builder.addVariable(
      `sat_${tag}_y`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      obs.satPos.y,
    );
    const szVar = builder.addVariable(
      `sat_${tag}_z`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      obs.satPos.z,
    );
    const prVar = builder.addVariable(
      `obs_${tag}_pr`,
      VarType.Real,
      Variability.Parameter,
      Causality.Local,
      correctedPr,
    );

    variableMap.set(`sat_${tag}_x`, sxVar);
    variableMap.set(`sat_${tag}_y`, syVar);
    variableMap.set(`sat_${tag}_z`, szVar);
    variableMap.set(`obs_${tag}_pr`, prVar);

    // dx = sat_x - rx_x
    const dx = builder.addBinaryExpr(BinOp.Sub, builder.addName(sxVar), builder.addName(rxX));
    const dy = builder.addBinaryExpr(BinOp.Sub, builder.addName(syVar), builder.addName(rxY));
    const dz = builder.addBinaryExpr(BinOp.Sub, builder.addName(szVar), builder.addName(rxZ));

    // dx^2 + dy^2 + dz^2
    const dx2 = builder.addBinaryExpr(BinOp.Mul, dx, dx);
    const dy2 = builder.addBinaryExpr(BinOp.Mul, dy, dy);
    const dz2 = builder.addBinaryExpr(BinOp.Mul, dz, dz);
    const sumSq = builder.addBinaryExpr(BinOp.Add, builder.addBinaryExpr(BinOp.Add, dx2, dy2), dz2);

    // (dx^2 + dy^2 + dz^2)^0.5 + rx_cdt = obs_pr
    const rangeExpr = builder.addBinaryExpr(BinOp.Pow, sumSq, builder.addRealLiteral(0.5));
    const lhs = builder.addBinaryExpr(BinOp.Add, rangeExpr, builder.addName(rxCdt));
    const rhs = builder.addName(prVar);

    builder.addEquation(EqKind.Simple, lhs, rhs);
    equationCount++;
  }

  return {
    receiverVarIndices: { x: rxX, y: rxY, z: rxZ, cdt: rxCdt },
    equationCount,
    variableMap,
  };
}

export interface RinexToDaeOptions {
  modelName?: string | undefined;
  epochIndex?: number | undefined;
  navDoc?: RinexDocument | undefined;
  observations?: SatellitePseudorange[] | undefined;
}

/**
 * High-level DAE arena builder wrapper for a RINEX v2 document (or OBS+NAV pair).
 */
export function rinexToDae(doc: RinexDocument, options: RinexToDaeOptions = {}): DAEBuilder {
  const rawName = options.modelName || doc.header.markerName || "RinexGnssFix";
  const modelName = rawName.replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);

  let satObs: SatellitePseudorange[] = options.observations ?? [];

  if (satObs.length === 0 && doc.fileType === "O" && doc.epochs.length > 0) {
    const epoch = doc.epochs[options.epochIndex ?? 0];
    if (epoch) {
      for (let i = 0; i < epoch.satellites.length; i++) {
        const sat = epoch.satellites[i]!;
        const prObj = sat.observations["C1"] ?? sat.observations["P1"] ?? sat.observations["P2"];
        if (!prObj) continue;

        let satPos: EcefCoords = {
          x: 26_560_000 * Math.cos((i * Math.PI) / 3),
          y: 26_560_000 * Math.sin((i * Math.PI) / 3),
          z: 10_000_000 * Math.sin((i * Math.PI) / 4),
        };
        let satClockBiasSec = 0;

        if (options.navDoc) {
          const ephem = selectBestEphemeris(options.navDoc.ephemerides, sat.prn, epoch.timestamp.gpsTow);
          if (ephem) {
            const sv = computeSatelliteEcef(ephem, epoch.timestamp.gpsTow - prObj.value / SPEED_OF_LIGHT);
            satPos = sv.position;
            satClockBiasSec = sv.clockCorrectionSec;
          }
        }

        satObs.push({
          prn: sat.prn,
          satPos,
          pseudorangeM: prObj.value,
          satClockBiasSec,
        });
      }
    }
  } else if (satObs.length === 0 && doc.fileType === "N" && doc.ephemerides.length > 0) {
    // Lower broadcast ephemeris states as synthetic geometric range equations at toe
    const refPos = doc.header.approxPositionXyz ?? { x: 0, y: 0, z: 6_371_000 };
    for (const ephem of doc.ephemerides) {
      const sv = computeSatelliteEcef(ephem, ephem.toe);
      const rho = Math.hypot(sv.position.x - refPos.x, sv.position.y - refPos.y, sv.position.z - refPos.z);
      satObs.push({
        prn: ephem.prn,
        satPos: sv.position,
        pseudorangeM: rho,
        satClockBiasSec: sv.clockCorrectionSec,
      });
    }
  }

  lowerRinexToDae(builder, satObs, doc.header.approxPositionXyz ?? { x: 0, y: 0, z: 0 });
  return builder;
}

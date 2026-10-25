// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lps — Slack Line Open-Channel Gravity Flow Solver.
 *
 * Implements liquid column separation, free-surface gravity drainage via the
 * Manning-Gauckler-Strickler formulation, dynamic void fraction tracking,
 * and slack collapse re-pressurization water hammer surge calculations.
 */

import type { LpsPipe } from "../../types.js";

export interface SlackLineSegmentResult {
  pipeName: string;
  isSlackFlow: boolean;
  slope: number; // Downward gradient (-dz/dx)
  fillingDepthMeters: number; // Liquid depth inside circular pipe
  fillingFraction: number; // y / D (0.0 to 1.0)
  voidFraction: number; // 1.0 - A_flow / A_pipe
  voidVolumeM3: number; // Total vapor/slack void volume along segment
  gravityVelocityMS: number; // Liquid flow velocity in open channel (m/s)
  pressurizedVelocityMS: number; // Velocity if pipe were 100% full (m/s)
  slackCollapseSurgePa: number; // Potential water hammer spike upon void collapse (Pa)
  liquidHoldUpKg: number; // Actual mass of liquid in pipe segment (kg)
}

export class SlackLineSolver {
  /**
   * Checks whether the local hydraulic line pressure has dropped to or below
   * liquid vapor pressure, initiating column separation and slack flow.
   */
  static isSlackLineCondition(pressurePa: number, vaporPressurePa: number, thresholdMarginPa = 1000.0): boolean {
    return pressurePa <= vaporPressurePa + thresholdMarginPa;
  }

  /**
   * Solves circular open-channel filling depth given volumetric flow rate,
   * downward slope, and Manning roughness coefficient using Newton-Raphson.
   */
  static solveOpenChannelDepth(
    diameter: number,
    flowM3s: number,
    slope: number,
    manningN = 0.012,
  ): {
    fillingDepthMeters: number;
    fillingFraction: number;
    wettedAreaM2: number;
    voidFraction: number;
    velocityMS: number;
  } {
    const pipeArea = (Math.PI * Math.pow(diameter, 2)) / 4.0;
    const sClamped = Math.max(1e-6, slope);
    const qTarget = Math.max(1e-5, flowM3s);

    // Initial guess for theta (central angle in radians, 0 to 2*pi)
    let theta = Math.PI; // Half-full initial guess

    // Newton-Raphson iteration to find theta such that Q(theta) = qTarget
    for (let iter = 0; iter < 20; iter++) {
      const a = (Math.pow(diameter, 2) / 8.0) * (theta - Math.sin(theta));
      const p = (diameter * theta) / 2.0;
      const rh = a / Math.max(1e-5, p);
      const qCalc = (1.0 / manningN) * a * Math.pow(rh, 2.0 / 3.0) * Math.sqrt(sClamped);

      const err = qCalc - qTarget;
      if (Math.abs(err) < 1e-5 * qTarget) {
        break;
      }

      // Numerical derivative dQ/dtheta
      const dTheta = 1e-4;
      const thetaPlus = theta + dTheta;
      const aPlus = (Math.pow(diameter, 2) / 8.0) * (thetaPlus - Math.sin(thetaPlus));
      const pPlus = (diameter * thetaPlus) / 2.0;
      const rhPlus = aPlus / Math.max(1e-5, pPlus);
      const qPlus = (1.0 / manningN) * aPlus * Math.pow(rhPlus, 2.0 / 3.0) * Math.sqrt(sClamped);
      const dqdTheta = (qPlus - qCalc) / dTheta;

      const step = err / (Math.abs(dqdTheta) > 1e-6 ? dqdTheta : 1.0);
      theta = Math.max(0.05, Math.min(2.0 * Math.PI - 0.01, theta - step));
    }

    // Geometry results
    const wettedArea = (Math.pow(diameter, 2) / 8.0) * (theta - Math.sin(theta));
    const fillingDepth = (diameter / 2.0) * (1.0 - Math.cos(theta / 2.0));
    const fillingFraction = fillingDepth / diameter;
    const voidFraction = Math.max(0.0, Math.min(1.0, 1.0 - wettedArea / pipeArea));
    const velocityMS = qTarget / Math.max(1e-5, wettedArea);

    return {
      fillingDepthMeters: fillingDepth,
      fillingFraction,
      wettedAreaM2: wettedArea,
      voidFraction,
      velocityMS,
    };
  }

  /**
   * Evaluates a pipeline segment for slack line open-channel conditions,
   * calculating void formation, gravity drainage velocity, and collapse surge.
   */
  static evaluateSegment(
    pipe: LpsPipe,
    inletElevationM: number,
    outletElevationM: number,
    pressurePa: number,
    flowM3s: number,
    liquidProps: { densityKgM3: number; vaporPressurePa: number; bulkModulusPa?: number },
    manningN = 0.012,
  ): SlackLineSegmentResult {
    const deltaZ = outletElevationM - inletElevationM; // Negative when descending
    const downwardSlope = Math.max(0.0, -deltaZ / Math.max(1.0, pipe.length));
    const isSlack = downwardSlope > 0.001 && this.isSlackLineCondition(pressurePa, liquidProps.vaporPressurePa);

    const pipeArea = (Math.PI * Math.pow(pipe.diameter, 2)) / 4.0;
    const fullPipeVelocity = flowM3s / Math.max(1e-5, pipeArea);
    const fullPipeMass = pipeArea * pipe.length * liquidProps.densityKgM3;

    if (!isSlack) {
      return {
        pipeName: pipe.name,
        isSlackFlow: false,
        slope: downwardSlope,
        fillingDepthMeters: pipe.diameter,
        fillingFraction: 1.0,
        voidFraction: 0.0,
        voidVolumeM3: 0.0,
        gravityVelocityMS: fullPipeVelocity,
        pressurizedVelocityMS: fullPipeVelocity,
        slackCollapseSurgePa: 0.0,
        liquidHoldUpKg: fullPipeMass,
      };
    }

    // Solve open-channel gravity parameters
    const oc = this.solveOpenChannelDepth(pipe.diameter, flowM3s, downwardSlope, manningN);
    const voidVolumeM3 = oc.voidFraction * pipeArea * pipe.length;
    const liquidHoldUpKg = (1.0 - oc.voidFraction) * fullPipeMass;

    // Estimate acoustic wave speed in steel pipe for collapse surge
    const kBulk = liquidProps.bulkModulusPa ?? 1.4e9;
    const eSteel = 2.07e11; // Young's modulus of carbon steel (Pa)
    const wt = pipe.wallThickness ?? 0.0127;
    const waveSpeed = Math.sqrt(kBulk / liquidProps.densityKgM3 / (1.0 + (kBulk * pipe.diameter) / (eSteel * wt)));

    // Joukowsky collapse surge when open-channel gravity slug hits stationary/downstream fluid:
    // Delta P = rho * a * (v_gravity - v_downstream)
    const deltaV = Math.max(0.0, oc.velocityMS - fullPipeVelocity);
    const collapseSurgePa = liquidProps.densityKgM3 * waveSpeed * deltaV;

    return {
      pipeName: pipe.name,
      isSlackFlow: true,
      slope: downwardSlope,
      fillingDepthMeters: oc.fillingDepthMeters,
      fillingFraction: oc.fillingFraction,
      voidFraction: oc.voidFraction,
      voidVolumeM3,
      gravityVelocityMS: oc.velocityMS,
      pressurizedVelocityMS: fullPipeVelocity,
      slackCollapseSurgePa: collapseSurgePa,
      liquidHoldUpKg,
    };
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Dynamic Pipeline Pigging & Liquid Sweep Tracker.
 *
 * Simulates mechanical pipeline scraper and batching pigs, computing pig motion
 * ODEs (M * dv/dt = DeltaP * A - F_f - M * g * sin(theta)), bypass leakage,
 * and liquid slug accumulation ahead of the pig into topside slug catchers.
 */

import type { OlgaPig } from "../types.js";

export interface ActivePigState {
  /** Pig identifier tag. */
  name: string;
  /** Current position along flowpath [m]. */
  position: number;
  /** Instantaneous traveling velocity [m/s]. */
  velocity: number;
  /** Whether the pig has been launched into the stream. */
  isLaunched: boolean;
  /** Whether the pig has reached the terminal receiver trap. */
  isReceived: boolean;
  /** Time of arrival at the receiver [s]. */
  arrivalTime?: number | undefined;
  /** Cumulative liquid volume swept ahead of the pig [m^3]. */
  sweptLiquidVolume: number;
  /** Differential drive pressure across the pig seals DeltaP = P_rear - P_front [Pa]. */
  drivePressureDrop: number;
  /** Whether the pig is stuck due to insufficient differential drive pressure. */
  isStuck: boolean;
}

export class PigTracker {
  private pigStates: Map<string, ActivePigState> = new Map();
  private pigConfigs: Map<string, OlgaPig> = new Map();

  constructor(pigs: OlgaPig[] = []) {
    for (const p of pigs) {
      this.pigConfigs.set(p.name, p);
      this.pigStates.set(p.name, {
        name: p.name,
        position: 0,
        velocity: 0,
        isLaunched: false,
        isReceived: false,
        sweptLiquidVolume: 0,
        drivePressureDrop: 0,
        isStuck: false,
      });
    }
  }

  /**
   * Advances pig states across time step dt.
   *
   * @param currentTime     Current simulation time [s]
   * @param dt              Time step [s]
   * @param pipeLength      Total flowpath length [m]
   * @param pipeDiameter    Pipe inner diameter [m]
   * @param spatialHoldup   Liquid holdup array along flowline cells
   * @param cellPositions   Spatial position array along flowline cells [m]
   * @param cellPressures   Spatial pressure array along flowline cells [Pa]
   * @param pipeInclination Average pipe inclination angle [rad]
   */
  public step(
    currentTime: number,
    dt: number,
    pipeLength: number,
    pipeDiameter: number,
    spatialHoldup: number[],
    cellPositions: number[],
    cellPressures: number[],
    pipeInclination = 0.0,
  ): ActivePigState[] {
    const pipeArea = 0.25 * Math.PI * pipeDiameter * pipeDiameter;
    const g = 9.81;

    for (const [name, state] of this.pigStates.entries()) {
      if (state.isReceived) continue;

      const cfg = this.pigConfigs.get(name)!;
      // 1. Launch check
      if (!state.isLaunched) {
        if (currentTime >= cfg.launchTime) {
          state.isLaunched = true;
          state.position = 0.0;
        } else {
          continue; // Not yet launched
        }
      }

      // 2. Sample local differential pressure across pig seals
      const xPig = state.position;
      const idx = this.findCellIndex(xPig, cellPositions);
      const upstreamP = idx > 0 ? cellPressures[idx - 1]! : cellPressures[0]!;
      const downstreamP =
        idx < cellPressures.length - 1 ? cellPressures[idx + 1]! : cellPressures[cellPressures.length - 1]!;
      const deltaP = Math.max(0, upstreamP - downstreamP);
      state.drivePressureDrop = deltaP;

      // 3. Pig dynamics equation
      const mass = cfg.mass ?? 100.0; // kg
      const frictionForce = cfg.frictionForce ?? 2500.0; // N sliding seal resistance
      const driveForce = deltaP * pipeArea;
      const gravityForce = mass * g * Math.sin(pipeInclination);
      const netForce = driveForce - frictionForce - gravityForce;

      if (netForce <= 0 && state.velocity <= 0.05) {
        // Differential pressure is insufficient to overcome static friction -> Pig Stuck!
        state.velocity = 0;
        state.isStuck = true;
      } else {
        state.isStuck = false;
        // Fluid viscous drag damping
        const cVisc = 150.0; // N/(m/s)
        const acceleration = (netForce - cVisc * state.velocity) / mass;
        state.velocity = Math.max(0, state.velocity + acceleration * dt);
        // Cap pig velocity to mixture velocity
        state.velocity = Math.min(15.0, state.velocity);
      }

      // 4. Update position and swept liquid volume
      const dx = state.velocity * dt;
      state.position += dx;

      const localHoldup = spatialHoldup[idx] ?? 0.2;
      const bypass = cfg.bypassFraction ?? 0.02;
      const sweptIncrement = (1.0 - bypass) * localHoldup * pipeArea * dx;
      state.sweptLiquidVolume += sweptIncrement;

      // 5. Check arrival at receiver
      if (state.position >= pipeLength) {
        state.position = pipeLength;
        state.velocity = 0;
        state.isReceived = true;
        state.arrivalTime = currentTime;
      }
    }

    return Array.from(this.pigStates.values());
  }

  private findCellIndex(x: number, positions: number[]): number {
    for (let i = 0; i < positions.length - 1; i++) {
      if (x >= positions[i]! && x <= positions[i + 1]!) {
        return i;
      }
    }
    return Math.max(0, positions.length - 1);
  }

  public getStates(): ActivePigState[] {
    return Array.from(this.pigStates.values());
  }
}

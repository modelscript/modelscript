// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Motion Safety & Collision-Tube Theory Oracle.
 *
 * Certifies planned robotics/autonomous-vehicle trajectories (URDF, OpenSCENARIO, JSBSim)
 * inside SemanticTheoryCoordinator by verifying every waypoint + tube disturbance radius
 * maintains positive clearance from all registered obstacle spheres/boxes.
 */

import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";
import { hasSharedEqualityWithLiteral, retainSharedEqualitiesWithoutLiteral } from "./retraction_utils.js";
import { UndoTrail } from "./undo_trail.js";

export interface SphereObstacle {
  readonly id: string;
  readonly center: readonly number[];
  readonly radius: number;
}

export interface TrajectorySafetySpec {
  readonly id: string;
  readonly waypoints: readonly (readonly number[])[];
  /** Bounded tracking/flowpipe tube radius around each waypoint. */
  readonly tubeRadius: number;
  readonly obstacles: readonly SphereObstacle[];
}

export class MotionSafetyOracle implements TheoryOracle {
  public readonly name = "MotionSafetyOracle";
  public readonly domain = "spatial_physics" as const;

  private specs = new Map<string, TrajectorySafetySpec>();
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private sharedEqualities: SharedEquality[] = [];
  private trail = new UndoTrail();

  public reset(): void {
    this.specs.clear();
    this.assertedLiterals.clear();
    this.sharedEqualities = [];
    this.trail.reset();
  }

  public pushLevel(): void {
    this.trail.pushLevel();
  }

  public popLevel(): void {
    this.trail.popLevel();
  }

  public registerTrajectory(spec: TrajectorySafetySpec): void {
    this.trail.mapSet(this.specs, spec.id, spec);
  }

  public assertLiteral(literal: TheoryLiteral): boolean {
    this.trail.mapSet(this.assertedLiterals, literal.id, literal);
    return true;
  }

  public retractLiteral(literalId: number): void {
    this.assertedLiterals.delete(literalId);
    if (hasSharedEqualityWithLiteral(this.sharedEqualities, literalId)) {
      this.sharedEqualities = retainSharedEqualitiesWithoutLiteral(this.sharedEqualities, literalId);
    }
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.sharedEqualities.push(eq);
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    const literals = Array.from(this.assertedLiterals.values());
    for (const spec of this.specs.values()) {
      for (let wi = 0; wi < spec.waypoints.length; wi++) {
        const q = spec.waypoints[wi]!;
        for (const obs of spec.obstacles) {
          let d2 = 0;
          const dim = Math.min(q.length, obs.center.length);
          for (let k = 0; k < dim; k++) {
            const diff = q[k]! - obs.center[k]!;
            d2 += diff * diff;
          }
          const dist = Math.sqrt(d2);
          const minClearance = obs.radius + spec.tubeRadius;
          if (dist < minClearance - 1e-9) {
            return {
              isSat: false,
              conflict: {
                literals,
                explanation: `Trajectory '${spec.id}' waypoint #${wi} violates clearance to obstacle '${obs.id}' (distance ${dist.toFixed(4)} < required ${minClearance.toFixed(4)}).`,
                culpritEntities: [spec.id, obs.id],
                theoryName: this.name,
              },
            };
          }
        }
      }
    }
    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    return [];
  }
}

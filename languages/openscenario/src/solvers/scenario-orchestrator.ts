// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/openscenario — Scenario Orchestrator & Safety Verification Solver.
 *
 * Implements autonomous driving scenario state machine execution, Time-To-Collision (TTC)
 * monitoring, and Mobileye Responsibility-Sensitive Safety (RSS) formal verification.
 */

import type { OpenScenarioDocument, ScenarioCondition } from "../types.js";

export interface ActorKinematicState {
  name: string;
  x: number;
  y: number;
  speed: number; // m/s
  acceleration: number; // m/s^2
  lane: number;
}

export interface ScenarioStepRecord {
  time: number;
  actors: Record<string, ActorKinematicState>;
  egoName: string;
  egoState?: ActorKinematicState | undefined;
  leadState?: ActorKinematicState | undefined;
  distance?: number | undefined; // meters between ego and lead
  ttc?: number | undefined; // seconds
  rssMinDistance?: number | undefined; // RSS longitudinal safety distance
  activeEvents: string[];
  safetyViolations: string[];
}

export interface SafetyViolation {
  time: number;
  kind: "COLLISION" | "TTC_CRITICAL" | "RSS_VIOLATION" | "EXCESSIVE_DECELERATION";
  description: string;
}

export interface ScenarioSimulationResult {
  totalDuration: number;
  stepsCount: number;
  minTtc: number;
  minDistance: number;
  hasCollision: boolean;
  violations: SafetyViolation[];
  finalStates: Record<string, ActorKinematicState>;
  trajectory: ScenarioStepRecord[];
}

export interface OrchestratorOptions {
  duration?: number | undefined; // default 10.0 s
  stepSize?: number | undefined; // default 0.1 s
  reactionTime?: number | undefined; // rho for RSS, default 0.5 s
  maxBrakingDecel?: number | undefined; // default 6.0 m/s^2
}

interface ActiveActionRuntime {
  entityRef: string;
  eventName: string;
  targetSpeed: number;
  rate: number; // acceleration/deceleration rate (m/s^2)
  targetLane?: number;
  progress: number;
  duration: number;
}

export function simulateScenario(doc: OpenScenarioDocument, options?: OrchestratorOptions): ScenarioSimulationResult {
  const duration = options?.duration ?? 10.0;
  const dt = options?.stepSize ?? 0.1;
  const reactionTime = options?.reactionTime ?? 0.5;
  const maxBrakingDecel = options?.maxBrakingDecel ?? 6.0;

  // Find ego entity
  const egoEntity =
    Array.from(doc.entities.values()).find(
      (e) => e.isEgo || e.name.toLowerCase().includes("ego") || e.name.toLowerCase() === "host",
    ) ?? Array.from(doc.entities.values())[0];
  const egoName = egoEntity ? egoEntity.name : "ego";

  // Initialize actor states
  const actorStates = new Map<string, ActorKinematicState>();
  for (const ent of doc.entities.values()) {
    let x = 0;
    let y = 0;
    let speed = ent.initialSpeed ?? 20; // default 20 m/s
    let lane = 1;

    if (ent.initialPosition?.kind === "world" && ent.initialPosition.world) {
      x = ent.initialPosition.world.x;
      y = ent.initialPosition.world.y;
    } else if (ent.initialPosition?.kind === "lane" && ent.initialPosition.lane) {
      x = ent.initialPosition.lane.s;
      lane = ent.initialPosition.lane.laneId;
    }

    actorStates.set(ent.name, {
      name: ent.name,
      x,
      y,
      speed,
      acceleration: 0,
      lane,
    });
  }

  // Event runtime states: eventName -> "standby" | "running" | "completed"
  const eventStates = new Map<string, "standby" | "running" | "completed">();
  const runningActions: ActiveActionRuntime[] = [];

  for (const story of doc.stories) {
    for (const act of story.acts) {
      for (const mg of act.maneuverGroups) {
        for (const m of mg.maneuvers) {
          for (const ev of m.events) {
            eventStates.set(ev.name, "standby");
          }
        }
      }
    }
  }

  const trajectory: ScenarioStepRecord[] = [];
  const violations: SafetyViolation[] = [];
  let minTtc = Infinity;
  let minDistance = Infinity;
  let hasCollision = false;

  const totalSteps = Math.ceil(duration / dt);

  for (let step = 0; step <= totalSteps; step++) {
    const t = step * dt;

    // 1. Evaluate triggers for standby events
    for (const story of doc.stories) {
      for (const act of story.acts) {
        for (const mg of act.maneuverGroups) {
          for (const m of mg.maneuvers) {
            for (const ev of m.events) {
              if (eventStates.get(ev.name) === "standby") {
                const triggered = evaluateEventTriggers(ev, t, actorStates, egoName);
                if (triggered) {
                  eventStates.set(ev.name, "running");
                  // Spawn actions
                  for (const a of ev.actions) {
                    if (a.kind === "speed" && a.targetSpeed !== undefined) {
                      const currentSpeed = actorStates.get(a.entityRef)?.speed ?? 0;
                      const diff = Math.abs(a.targetSpeed - currentSpeed);
                      const rate =
                        a.speedDynamics?.rate ?? (a.speedDynamics?.duration ? diff / a.speedDynamics.duration : 3.0);
                      const actionDur = rate > 0 ? diff / rate : 0;
                      runningActions.push({
                        entityRef: a.entityRef,
                        eventName: ev.name,
                        targetSpeed: a.targetSpeed,
                        rate: a.targetSpeed < currentSpeed ? -rate : rate,
                        duration: actionDur,
                        progress: 0,
                      });
                    } else if (a.kind === "laneChange" && a.targetLane !== undefined) {
                      const state = actorStates.get(a.entityRef);
                      if (state) state.lane = a.targetLane;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // 2. Advance running actions
    for (let i = runningActions.length - 1; i >= 0; i--) {
      const act = runningActions[i];
      if (!act) continue;
      const state = actorStates.get(act.entityRef);
      if (state) {
        state.acceleration = act.rate;
        state.speed = Math.max(0, state.speed + act.rate * dt);
        act.progress += dt;
        if (
          act.progress >= act.duration ||
          (act.rate > 0 && state.speed >= act.targetSpeed) ||
          (act.rate < 0 && state.speed <= act.targetSpeed)
        ) {
          state.speed = act.targetSpeed;
          state.acceleration = 0;
          runningActions.splice(i, 1);
          eventStates.set(act.eventName, "completed");
        }
      }
    }

    // 3. Advance vehicle kinematics: x = x + v * dt + 0.5 * a * dt^2
    for (const state of actorStates.values()) {
      state.x += state.speed * dt + 0.5 * state.acceleration * dt * dt;
    }

    // 4. Compute Metrics: TTC and RSS safety distance between Ego and other vehicles
    const egoState = actorStates.get(egoName);
    let leadState: ActorKinematicState | undefined;
    let distance: number | undefined;
    let ttc: number | undefined;
    let rssMinDistance: number | undefined;
    const stepViolations: string[] = [];

    if (egoState) {
      // Find closest lead vehicle in same or adjacent lane ahead of ego
      let closestAheadDist = Infinity;
      for (const [name, state] of actorStates.entries()) {
        if (name === egoName) continue;
        const dx = state.x - egoState.x;
        if (dx > 0 && dx < closestAheadDist) {
          closestAheadDist = dx;
          leadState = state;
        }
      }

      if (leadState) {
        distance = leadState.x - egoState.x;
        if (distance < minDistance) minDistance = distance;

        // Collision check (distance <= 4.0 meters front-to-back margin)
        if (distance <= 4.0) {
          hasCollision = true;
          const msg = `Collision detected at t = ${t.toFixed(1)} s between '${egoName}' and '${leadState.name}' (d = ${distance.toFixed(2)} m).`;
          stepViolations.push(msg);
          violations.push({ time: t, kind: "COLLISION", description: msg });
        }

        // Time to Collision (TTC)
        const relSpeed = egoState.speed - leadState.speed;
        if (relSpeed > 0) {
          ttc = distance / relSpeed;
          if (ttc < minTtc) minTtc = ttc;

          if (ttc < 1.5 && distance > 4.0) {
            const msg = `Critical TTC warning at t = ${t.toFixed(1)} s (TTC = ${ttc.toFixed(2)} s < 1.5 s).`;
            stepViolations.push(msg);
            violations.push({ time: t, kind: "TTC_CRITICAL", description: msg });
          }
        }

        // Responsibility-Sensitive Safety (RSS) longitudinal safe distance:
        // d_min = v_ego * rho + (v_ego^2 / (2 * a_brake_max)) - (v_lead^2 / (2 * a_accel_max))
        const aAccelMax = 3.0;
        const egoTerm = egoState.speed * reactionTime + (egoState.speed * egoState.speed) / (2 * maxBrakingDecel);
        const leadTerm = (leadState.speed * leadState.speed) / (2 * aAccelMax);
        rssMinDistance = Math.max(2.0, egoTerm - leadTerm);

        if (distance < rssMinDistance && distance > 4.0) {
          const msg = `RSS safe distance violated at t = ${t.toFixed(1)} s (d = ${distance.toFixed(1)} m < d_safe = ${rssMinDistance.toFixed(1)} m).`;
          stepViolations.push(msg);
          violations.push({ time: t, kind: "RSS_VIOLATION", description: msg });
        }
      }
    }

    const activeEventsList = Array.from(eventStates.entries())
      .filter(([_, st]) => st === "running")
      .map(([name]) => name);

    // Deep clone actor states for record
    const snapshotActors: Record<string, ActorKinematicState> = {};
    for (const [k, v] of actorStates.entries()) {
      snapshotActors[k] = { ...v };
    }

    trajectory.push({
      time: t,
      actors: snapshotActors,
      egoName,
      egoState: egoState ? { ...egoState } : undefined,
      leadState: leadState ? { ...leadState } : undefined,
      distance,
      ttc,
      rssMinDistance,
      activeEvents: activeEventsList,
      safetyViolations: stepViolations,
    });
  }

  const finalStates: Record<string, ActorKinematicState> = {};
  for (const [k, v] of actorStates.entries()) {
    finalStates[k] = { ...v };
  }

  return {
    totalDuration: duration,
    stepsCount: trajectory.length,
    minTtc: isFinite(minTtc) ? minTtc : 999.0,
    minDistance: isFinite(minDistance) ? minDistance : 999.0,
    hasCollision,
    violations,
    finalStates,
    trajectory,
  };
}

function evaluateEventTriggers(
  ev: { triggerConditions: ScenarioCondition[] },
  t: number,
  actorStates: Map<string, ActorKinematicState>,
  egoName: string,
): boolean {
  if (ev.triggerConditions.length === 0) return true;

  for (const cond of ev.triggerConditions) {
    if (cond.kind === "simulationTime") {
      const targetTime = Number(cond.value) + (cond.delay ?? 0);
      if (cond.rule === "greaterOrEqual" && t >= targetTime) return true;
      if (cond.rule === "greaterThan" && t > targetTime) return true;
      if (cond.rule === "equalTo" && Math.abs(t - targetTime) < 0.05) return true;
    } else if (cond.kind === "timeToCollision") {
      const ego = actorStates.get(cond.entityRef ?? egoName);
      const target = actorStates.get(cond.targetEntityRef ?? "");
      if (ego && target) {
        const dx = target.x - ego.x;
        const relSpeed = ego.speed - target.speed;
        if (dx > 0 && relSpeed > 0) {
          const currentTtc = dx / relSpeed;
          if (cond.rule === "lessThan" && currentTtc <= Number(cond.value)) return true;
          if (cond.rule === "lessOrEqual" && currentTtc <= Number(cond.value)) return true;
        }
      }
    } else if (cond.kind === "distance") {
      const ego = actorStates.get(cond.entityRef ?? egoName);
      let targetX = 0;
      if (cond.targetPosition?.kind === "world" && cond.targetPosition.world) {
        targetX = cond.targetPosition.world.x;
      }
      if (ego) {
        const dist = Math.abs(targetX - ego.x);
        if (cond.rule === "lessThan" && dist <= Number(cond.value)) return true;
      }
    }
  }

  return false;
}

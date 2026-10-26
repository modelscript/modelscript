// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/openscenario — Pre-flight Scenario Diagnostics Linter.
 *
 * Implements OpenModelica-style diagnostic codes (M8501 - M8510) for autonomous driving scenarios.
 */

import { type DiagnosticItem, OpenScenarioErrorCode } from "../errors.js";
import type { OpenScenarioDocument, ScenarioObject } from "../types.js";

export function lintOpenScenario(doc: OpenScenarioDocument): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];

  // M8505: missing-ego-entity
  const egoEntity = Array.from(doc.entities.values()).find(
    (e) => e.isEgo || e.name.toLowerCase().includes("ego") || e.name.toLowerCase() === "host",
  );
  if (!egoEntity && doc.entities.size > 0) {
    diagnostics.push({
      code: OpenScenarioErrorCode.MISSING_EGO_ENTITY.code,
      rule: OpenScenarioErrorCode.MISSING_EGO_ENTITY.rule,
      severity: OpenScenarioErrorCode.MISSING_EGO_ENTITY.severity,
      message: OpenScenarioErrorCode.MISSING_EGO_ENTITY.message(),
    });
  }

  // Check initial actions
  for (const act of doc.initActions) {
    // M8501: Dangling entity reference in Init
    if (!doc.entities.has(act.entityRef)) {
      diagnostics.push({
        code: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.code,
        rule: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.rule,
        severity: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.severity,
        message: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.message(act.entityRef, "Init"),
        range: act.range,
      });
    }

    // M8506: Negative speed target
    if (act.kind === "speed" && act.targetSpeed !== undefined && act.targetSpeed < 0) {
      diagnostics.push({
        code: OpenScenarioErrorCode.NEGATIVE_SPEED_TARGET.code,
        rule: OpenScenarioErrorCode.NEGATIVE_SPEED_TARGET.rule,
        severity: OpenScenarioErrorCode.NEGATIVE_SPEED_TARGET.severity,
        message: OpenScenarioErrorCode.NEGATIVE_SPEED_TARGET.message(act.name ?? "InitSpeed", act.targetSpeed),
        range: act.range,
      });
    }

    // M8503: Unreachable road position
    if (act.targetPosition?.kind === "lane" && act.targetPosition.lane) {
      const lane = act.targetPosition.lane;
      if (lane.roadId === "" || lane.roadId === "0" || lane.laneId === 0) {
        diagnostics.push({
          code: OpenScenarioErrorCode.UNREACHABLE_ROAD_POSITION.code,
          rule: OpenScenarioErrorCode.UNREACHABLE_ROAD_POSITION.rule,
          severity: OpenScenarioErrorCode.UNREACHABLE_ROAD_POSITION.severity,
          message: OpenScenarioErrorCode.UNREACHABLE_ROAD_POSITION.message(lane.roadId, lane.laneId),
          range: act.range,
        });
      }
    }
  }

  // Check stories, acts, maneuvers, events
  for (const story of doc.stories) {
    for (const act of story.acts) {
      for (const mg of act.maneuverGroups) {
        // M8509: Empty maneuver group
        if (mg.actors.length === 0 || mg.maneuvers.length === 0) {
          diagnostics.push({
            code: OpenScenarioErrorCode.EMPTY_MANEUVER_GROUP.code,
            rule: OpenScenarioErrorCode.EMPTY_MANEUVER_GROUP.rule,
            severity: OpenScenarioErrorCode.EMPTY_MANEUVER_GROUP.severity,
            message: OpenScenarioErrorCode.EMPTY_MANEUVER_GROUP.message(mg.name),
            range: mg.range,
          });
        }

        // M8501: Actor references
        for (const actor of mg.actors) {
          if (!doc.entities.has(actor)) {
            diagnostics.push({
              code: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.code,
              rule: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.rule,
              severity: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.severity,
              message: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.message(actor, mg.name),
              range: mg.range,
            });
          }
        }

        for (const m of mg.maneuvers) {
          for (const ev of m.events) {
            // Check actions in event
            for (const a of ev.actions) {
              if (a.entityRef && !doc.entities.has(a.entityRef)) {
                diagnostics.push({
                  code: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.code,
                  rule: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.rule,
                  severity: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.severity,
                  message: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.message(a.entityRef, ev.name),
                  range: a.range,
                });
              }

              // M8506: Negative speed target
              if (a.kind === "speed" && a.targetSpeed !== undefined && a.targetSpeed < 0) {
                diagnostics.push({
                  code: OpenScenarioErrorCode.NEGATIVE_SPEED_TARGET.code,
                  rule: OpenScenarioErrorCode.NEGATIVE_SPEED_TARGET.rule,
                  severity: OpenScenarioErrorCode.NEGATIVE_SPEED_TARGET.severity,
                  message: OpenScenarioErrorCode.NEGATIVE_SPEED_TARGET.message(a.name ?? ev.name, a.targetSpeed),
                  range: a.range,
                });
              }

              // M8507: Excessive deceleration
              if (a.kind === "speed" && a.speedDynamics?.rate !== undefined && a.speedDynamics.rate > 0) {
                const targetEntity = doc.entities.get(a.entityRef);
                const maxDecel = targetEntity?.performance?.maxDeceleration ?? 10;
                if (a.speedDynamics.rate > maxDecel) {
                  diagnostics.push({
                    code: OpenScenarioErrorCode.EXCESSIVE_DECELERATION.code,
                    rule: OpenScenarioErrorCode.EXCESSIVE_DECELERATION.rule,
                    severity: OpenScenarioErrorCode.EXCESSIVE_DECELERATION.severity,
                    message: OpenScenarioErrorCode.EXCESSIVE_DECELERATION.message(
                      a.entityRef,
                      a.speedDynamics.rate,
                      maxDecel,
                    ),
                    range: a.range,
                  });
                }
              }
            }

            // Check trigger conditions in event
            for (const c of ev.triggerConditions) {
              // M8510: Invalid condition delay
              if (c.delay < 0) {
                diagnostics.push({
                  code: OpenScenarioErrorCode.INVALID_CONDITION_DELAY.code,
                  rule: OpenScenarioErrorCode.INVALID_CONDITION_DELAY.rule,
                  severity: OpenScenarioErrorCode.INVALID_CONDITION_DELAY.severity,
                  message: OpenScenarioErrorCode.INVALID_CONDITION_DELAY.message(c.name, c.delay),
                  range: c.range,
                });
              }

              // M8501: Dangling entity references in condition
              if (c.entityRef && !doc.entities.has(c.entityRef)) {
                diagnostics.push({
                  code: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.code,
                  rule: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.rule,
                  severity: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.severity,
                  message: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.message(c.entityRef, c.name),
                  range: c.range,
                });
              }
              if (c.targetEntityRef && !doc.entities.has(c.targetEntityRef)) {
                diagnostics.push({
                  code: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.code,
                  rule: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.rule,
                  severity: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.severity,
                  message: OpenScenarioErrorCode.DANGLING_ENTITY_REFERENCE.message(c.targetEntityRef, c.name),
                  range: c.range,
                });
              }

              // M8502: Unsatisfiable trigger
              if (c.kind === "simulationTime" && c.rule === "lessThan" && Number(c.value) <= 0) {
                diagnostics.push({
                  code: OpenScenarioErrorCode.UNSATISFIABLE_TRIGGER.code,
                  rule: OpenScenarioErrorCode.UNSATISFIABLE_TRIGGER.rule,
                  severity: OpenScenarioErrorCode.UNSATISFIABLE_TRIGGER.severity,
                  message: OpenScenarioErrorCode.UNSATISFIABLE_TRIGGER.message(
                    c.name,
                    `simulation time cannot be less than ${c.value} s`,
                  ),
                  range: c.range,
                });
              }
            }
          }
        }
      }
    }
  }

  // M8508: Imminent collision in initial positions
  const entitiesList = Array.from(doc.entities.values());
  for (let i = 0; i < entitiesList.length; i++) {
    for (let j = i + 1; j < entitiesList.length; j++) {
      const eA = entitiesList[i]!;
      const eB = entitiesList[j]!;
      const dist = computeInitialDistance(eA, eB);
      if (dist !== null && dist < 1.0) {
        diagnostics.push({
          code: OpenScenarioErrorCode.IMMINENT_COLLISION_INITIAL_STATE.code,
          rule: OpenScenarioErrorCode.IMMINENT_COLLISION_INITIAL_STATE.rule,
          severity: OpenScenarioErrorCode.IMMINENT_COLLISION_INITIAL_STATE.severity,
          message: OpenScenarioErrorCode.IMMINENT_COLLISION_INITIAL_STATE.message(eA.name, eB.name, dist),
          range: eA.range,
        });
      }
    }
  }

  return diagnostics;
}

function computeInitialDistance(a: ScenarioObject, b: ScenarioObject): number | null {
  if (a.initialPosition?.kind === "world" && b.initialPosition?.kind === "world") {
    const wa = a.initialPosition.world;
    const wb = b.initialPosition.world;
    if (wa && wb) {
      const dx = wa.x - wb.x;
      const dy = wa.y - wb.y;
      return Math.sqrt(dx * dx + dy * dy);
    }
  }
  return null;
}

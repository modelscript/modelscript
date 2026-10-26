// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/openscenario — Pre-flight Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M8501 - M8510).
 */

import type { OpenScenarioRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: OpenScenarioRange | undefined;
}

export const OpenScenarioErrorCode = {
  DANGLING_ENTITY_REFERENCE: {
    code: 8501,
    rule: "dangling-entity-reference",
    severity: "error" as DiagnosticSeverity,
    message: (entityName: string, contextName: string) =>
      `Entity '${entityName}' referenced in '${contextName}' is not defined in Entities catalog.`,
  },
  UNSATISFIABLE_TRIGGER: {
    code: 8502,
    rule: "unsatisfiable-trigger",
    severity: "warning" as DiagnosticSeverity,
    message: (conditionName: string, reason: string) =>
      `Trigger condition '${conditionName}' is unsatisfiable: ${reason}.`,
  },
  UNREACHABLE_ROAD_POSITION: {
    code: 8503,
    rule: "unreachable-road-position",
    severity: "error" as DiagnosticSeverity,
    message: (roadId: string, laneId: number) =>
      `Road position specifies invalid road ID '${roadId}' or lane index '${laneId}'.`,
  },
  CYCLIC_EVENT_TRIGGER: {
    code: 8504,
    rule: "cyclic-event-trigger",
    severity: "error" as DiagnosticSeverity,
    message: (eventA: string, eventB: string) =>
      `Circular trigger condition detected between event '${eventA}' and event '${eventB}'.`,
  },
  MISSING_EGO_ENTITY: {
    code: 8505,
    rule: "missing-ego-entity",
    severity: "error" as DiagnosticSeverity,
    message: () => `Scenario does not define an autonomous vehicle under test ('ego' vehicle).`,
  },
  NEGATIVE_SPEED_TARGET: {
    code: 8506,
    rule: "negative-speed-target",
    severity: "error" as DiagnosticSeverity,
    message: (actionName: string, speed: number) =>
      `Speed action '${actionName}' specifies negative target velocity '${speed}' m/s.`,
  },
  EXCESSIVE_DECELERATION: {
    code: 8507,
    rule: "excessive-deceleration",
    severity: "warning" as DiagnosticSeverity,
    message: (entityName: string, decel: number, limit: number) =>
      `Action demands deceleration '${decel}' m/s² for '${entityName}', exceeding vehicle limit '${limit}' m/s².`,
  },
  IMMINENT_COLLISION_INITIAL_STATE: {
    code: 8508,
    rule: "imminent-collision-initial-state",
    severity: "error" as DiagnosticSeverity,
    message: (entityA: string, entityB: string, distance: number) =>
      `Initial positions for '${entityA}' and '${entityB}' violate collision envelope (distance: ${distance.toFixed(2)} m).`,
  },
  EMPTY_MANEUVER_GROUP: {
    code: 8509,
    rule: "empty-maneuver-group",
    severity: "warning" as DiagnosticSeverity,
    message: (groupName: string) => `Maneuver group '${groupName}' specifies no actors or no maneuvers.`,
  },
  INVALID_CONDITION_DELAY: {
    code: 8510,
    rule: "invalid-condition-delay",
    severity: "error" as DiagnosticSeverity,
    message: (condName: string, delay: number) =>
      `Trigger condition '${condName}' specifies negative activation delay '${delay}' s.`,
  },
} as const;

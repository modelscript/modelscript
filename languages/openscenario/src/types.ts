// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/openscenario — ASAM OpenSCENARIO AST & Data Types.
 *
 * Supports ASAM OpenSCENARIO XML (v1.0 - v1.2, .xosc) and OpenSCENARIO 2.0 DSL (.osc).
 */

export interface OpenScenarioRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

export interface OpenScenarioHeader {
  revMajor: number;
  revMinor: number;
  date: string;
  description: string;
  author: string;
}

export interface ScenarioParameter {
  name: string;
  parameterType: "integer" | "double" | "string" | "boolean";
  value: string;
}

export interface ScenarioBoundingBox {
  center: { x: number; y: number; z: number };
  dimensions: { width: number; length: number; height: number };
}

export interface ScenarioPerformance {
  maxSpeed: number; // m/s
  maxAcceleration: number; // m/s^2
  maxDeceleration: number; // m/s^2
}

export interface ScenarioWorldPosition {
  x: number;
  y: number;
  z: number;
  h?: number | undefined; // heading rad
  p?: number | undefined; // pitch rad
  r?: number | undefined; // roll rad
}

export interface ScenarioLanePosition {
  roadId: string;
  laneId: number;
  s: number;
  offset?: number | undefined;
}

export interface ScenarioPosition {
  kind: "world" | "lane";
  world?: ScenarioWorldPosition | undefined;
  lane?: ScenarioLanePosition | undefined;
}

export interface ScenarioObject {
  name: string;
  objectType: "vehicle" | "pedestrian" | "misc";
  category?: string | undefined;
  isEgo?: boolean | undefined;
  performance?: ScenarioPerformance | undefined;
  boundingBox?: ScenarioBoundingBox | undefined;
  initialPosition?: ScenarioPosition | undefined;
  initialSpeed?: number | undefined; // m/s
  range?: OpenScenarioRange | undefined;
}

export interface SpeedActionDynamics {
  shape: "step" | "linear" | "sinusoidal";
  rate?: number | undefined;
  duration?: number | undefined;
}

export interface ScenarioAction {
  name?: string | undefined;
  kind: "teleport" | "speed" | "laneChange" | "routing";
  entityRef: string;
  targetSpeed?: number | undefined; // m/s
  speedDynamics?: SpeedActionDynamics | undefined;
  targetLane?: number | undefined;
  dynamicsDuration?: number | undefined; // seconds for lane change dynamics
  targetPosition?: ScenarioPosition | undefined;
  range?: OpenScenarioRange | undefined;
}

export type ConditionRule = "equalTo" | "greaterThan" | "lessThan" | "greaterOrEqual" | "lessOrEqual";

export interface ScenarioCondition {
  name: string;
  delay: number; // seconds
  conditionEdge: "rising" | "falling" | "any" | "none";
  kind:
    | "simulationTime"
    | "timeToCollision"
    | "timeHeadway"
    | "distance"
    | "reachPosition"
    | "relativeSpeed"
    | "parameter"
    | "storyboardElementState";
  rule: ConditionRule;
  value: number | string;
  entityRef?: string | undefined;
  targetEntityRef?: string | undefined;
  storyboardElementRef?: string | undefined;
  targetPosition?: ScenarioPosition | undefined;
  freespace?: boolean | undefined;
  alongRoute?: boolean | undefined;
  range?: OpenScenarioRange | undefined;
}

export interface ScenarioEvent {
  name: string;
  priority: "overwrite" | "skip" | "parallel";
  maximumExecutionCount: number;
  triggerConditions: ScenarioCondition[];
  actions: ScenarioAction[];
  range?: OpenScenarioRange | undefined;
}

export interface ScenarioManeuver {
  name: string;
  events: ScenarioEvent[];
  range?: OpenScenarioRange | undefined;
}

export interface ScenarioManeuverGroup {
  name: string;
  maximumExecutionCount: number;
  actors: string[]; // entity names
  maneuvers: ScenarioManeuver[];
  range?: OpenScenarioRange | undefined;
}

export interface ScenarioAct {
  name: string;
  maneuverGroups: ScenarioManeuverGroup[];
  startTriggers: ScenarioCondition[];
  stopTriggers: ScenarioCondition[];
  range?: OpenScenarioRange | undefined;
}

export interface ScenarioStory {
  name: string;
  acts: ScenarioAct[];
  range?: OpenScenarioRange | undefined;
}

export interface OpenScenarioDocument {
  header: OpenScenarioHeader;
  parameters: ScenarioParameter[];
  entities: Map<string, ScenarioObject>;
  initActions: ScenarioAction[];
  stories: ScenarioStory[];
  stopTriggers: ScenarioCondition[];
  sourceFile?: string | undefined;
  rawXml?: string | undefined;
  isOsc2?: boolean | undefined;
}

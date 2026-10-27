// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/openscenario — Zero-Regex ASAM OpenSCENARIO XML and OSC 2.0 Parser.
 *
 * Conforms to ASAM OpenSCENARIO v1.0 - v1.2 schema specifications using @modelscript/dsl/xml.
 */

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type {
  ConditionRule,
  OpenScenarioDocument,
  OpenScenarioHeader,
  OpenScenarioRange,
  ScenarioAct,
  ScenarioAction,
  ScenarioBoundingBox,
  ScenarioCondition,
  ScenarioEvent,
  ScenarioLanePosition,
  ScenarioManeuver,
  ScenarioManeuverGroup,
  ScenarioObject,
  ScenarioParameter,
  ScenarioPerformance,
  ScenarioPosition,
  ScenarioStory,
  ScenarioWorldPosition,
  SpeedActionDynamics,
} from "../types.js";

function getAttr(elem: XmlElement, name: string): string | undefined {
  const a = elem.attributes.find((attr) => attr.name.toLowerCase() === name.toLowerCase());
  return a?.value;
}

function getNumAttr(elem: XmlElement, name: string, defaultValue = 0): number {
  const val = getAttr(elem, name);
  if (val === undefined) return defaultValue;
  const num = parseFloat(val);
  return isNaN(num) ? defaultValue : num;
}

function findChild(elem: XmlElement, name: string): XmlElement | undefined {
  return elem.children.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

function findChildren(elem: XmlElement, name: string): XmlElement[] {
  return elem.children.filter((c) => c.name.toLowerCase() === name.toLowerCase());
}

function computeLineCol(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  const target = Math.min(offset, source.length);
  for (let i = 0; i < target; i++) {
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

function makeRange(source: string, elem: XmlElement): OpenScenarioRange {
  const start = computeLineCol(source, elem.start);
  const end = computeLineCol(source, elem.end);
  return {
    startLine: start.line,
    startColumn: start.col,
    endLine: end.line,
    endColumn: end.col,
    startOffset: elem.start,
    endOffset: elem.end,
  };
}

export function parseOpenScenario(source: string, filename?: string): OpenScenarioDocument {
  const trimmed = source.trim();

  // If OSC 2.0 text DSL is detected
  if (!trimmed.startsWith("<") && (trimmed.includes("scenario ") || trimmed.includes("do serial:"))) {
    return parseOsc2Dsl(source, filename);
  }

  const xmlDoc = parseXml(source);
  const root = xmlDoc.root;
  if (!root || root.name.toLowerCase() !== "openscenario") {
    // Return empty document with default header
    return {
      header: {
        revMajor: 1,
        revMinor: 2,
        date: new Date().toISOString(),
        description: "Empty OpenSCENARIO document",
        author: "ModelScript",
      },
      parameters: [],
      entities: new Map(),
      initActions: [],
      stories: [],
      stopTriggers: [],
      sourceFile: filename,
      rawXml: source,
      isOsc2: false,
    };
  }

  // 1. FileHeader
  const headerElem = findChild(root, "FileHeader");
  const header: OpenScenarioHeader = {
    revMajor: headerElem ? getNumAttr(headerElem, "revMajor", 1) : 1,
    revMinor: headerElem ? getNumAttr(headerElem, "revMinor", 0) : 0,
    date: headerElem ? (getAttr(headerElem, "date") ?? "") : "",
    description: headerElem ? (getAttr(headerElem, "description") ?? "") : "",
    author: headerElem ? (getAttr(headerElem, "author") ?? "") : "",
  };

  // 2. ParameterDeclarations
  const parameters: ScenarioParameter[] = [];
  const paramDecls = findChild(root, "ParameterDeclarations");
  if (paramDecls) {
    for (const p of findChildren(paramDecls, "ParameterDeclaration")) {
      parameters.push({
        name: getAttr(p, "name") ?? "",
        parameterType: (getAttr(p, "parameterType") as ScenarioParameter["parameterType"]) ?? "string",
        value: getAttr(p, "value") ?? "",
      });
    }
  }

  // 3. Entities
  const entities = new Map<string, ScenarioObject>();
  const entitiesElem = findChild(root, "Entities");
  if (entitiesElem) {
    for (const objElem of findChildren(entitiesElem, "ScenarioObject")) {
      const name = getAttr(objElem, "name") ?? "UnnamedObject";
      const vehicleElem = findChild(objElem, "Vehicle");
      const pedElem = findChild(objElem, "Pedestrian");
      const miscElem = findChild(objElem, "MiscObject");

      let objectType: "vehicle" | "pedestrian" | "misc" = "vehicle";
      let category: string | undefined;
      let performance: ScenarioPerformance | undefined;
      let boundingBox: ScenarioBoundingBox | undefined;

      const activeChild = vehicleElem ?? pedElem ?? miscElem;
      if (vehicleElem) {
        objectType = "vehicle";
        category = getAttr(vehicleElem, "vehicleCategory");
        const perfElem = findChild(vehicleElem, "Performance");
        if (perfElem) {
          performance = {
            maxSpeed: getNumAttr(perfElem, "maxSpeed", 50),
            maxAcceleration: getNumAttr(perfElem, "maxAcceleration", 5),
            maxDeceleration: getNumAttr(perfElem, "maxDeceleration", 8),
          };
        }
      } else if (pedElem) {
        objectType = "pedestrian";
        category = getAttr(pedElem, "pedestrianCategory");
      } else if (miscElem) {
        objectType = "misc";
        category = getAttr(miscElem, "miscObjectCategory");
      }

      if (activeChild) {
        const bbElem = findChild(activeChild, "BoundingBox");
        if (bbElem) {
          const centerElem = findChild(bbElem, "Center");
          const dimElem = findChild(bbElem, "Dimensions");
          boundingBox = {
            center: {
              x: centerElem ? getNumAttr(centerElem, "x", 0) : 0,
              y: centerElem ? getNumAttr(centerElem, "y", 0) : 0,
              z: centerElem ? getNumAttr(centerElem, "z", 0) : 0,
            },
            dimensions: {
              width: dimElem ? getNumAttr(dimElem, "width", 2.0) : 2.0,
              length: dimElem ? getNumAttr(dimElem, "length", 4.5) : 4.5,
              height: dimElem ? getNumAttr(dimElem, "height", 1.5) : 1.5,
            },
          };
        }
      }

      const isEgo = name.toLowerCase().includes("ego") || name.toLowerCase() === "host";

      entities.set(name, {
        name,
        objectType,
        category,
        isEgo,
        performance,
        boundingBox,
        range: makeRange(source, objElem),
      });
    }
  }

  // 4. Storyboard
  const initActions: ScenarioAction[] = [];
  const stories: ScenarioStory[] = [];
  const stopTriggers: ScenarioCondition[] = [];

  const storyboardElem = findChild(root, "Storyboard");
  if (storyboardElem) {
    // Init
    const initElem = findChild(storyboardElem, "Init");
    if (initElem) {
      const actionsElem = findChild(initElem, "Actions");
      if (actionsElem) {
        for (const privElem of findChildren(actionsElem, "Private")) {
          const entityRef = getAttr(privElem, "entityRef") ?? "";
          for (const paElem of findChildren(privElem, "PrivateAction")) {
            const parsed = parsePrivateAction(source, paElem, entityRef);
            if (parsed) {
              initActions.push(parsed);
              // Associate initial position/speed with entity if present
              const ent = entities.get(entityRef);
              if (ent) {
                if (parsed.targetPosition) ent.initialPosition = parsed.targetPosition;
                if (parsed.targetSpeed !== undefined) ent.initialSpeed = parsed.targetSpeed;
              }
            }
          }
        }
      }
    }

    // Stories
    for (const storyElem of findChildren(storyboardElem, "Story")) {
      const storyName = getAttr(storyElem, "name") ?? "Story";
      const acts: ScenarioAct[] = [];

      for (const actElem of findChildren(storyElem, "Act")) {
        const actName = getAttr(actElem, "name") ?? "Act";
        const maneuverGroups: ScenarioManeuverGroup[] = [];

        for (const mgElem of findChildren(actElem, "ManeuverGroup")) {
          const mgName = getAttr(mgElem, "name") ?? "ManeuverGroup";
          const maxExec = getNumAttr(mgElem, "maximumExecutionCount", 1);
          const actors: string[] = [];
          const actorsElem = findChild(mgElem, "Actors");
          if (actorsElem) {
            for (const ref of findChildren(actorsElem, "EntityRef")) {
              const entityRef = getAttr(ref, "entityRef");
              if (entityRef) actors.push(entityRef);
            }
          }

          const maneuvers: ScenarioManeuver[] = [];
          for (const mElem of findChildren(mgElem, "Maneuver")) {
            const mName = getAttr(mElem, "name") ?? "Maneuver";
            const events: ScenarioEvent[] = [];

            for (const evElem of findChildren(mElem, "Event")) {
              const evName = getAttr(evElem, "name") ?? "Event";
              const priority = (getAttr(evElem, "priority") as ScenarioEvent["priority"]) ?? "overwrite";
              const evMaxExec = getNumAttr(evElem, "maximumExecutionCount", 1);

              const actions: ScenarioAction[] = [];
              for (const actWrapper of findChildren(evElem, "Action")) {
                const actName = getAttr(actWrapper, "name");
                const privElem = findChild(actWrapper, "PrivateAction");
                if (privElem) {
                  // If actor was specified in ManeuverGroup, default to first actor
                  const defaultActor = actors[0] ?? "";
                  const pa = parsePrivateAction(source, privElem, defaultActor, actName);
                  if (pa) actions.push(pa);
                }
              }

              const triggerConditions: ScenarioCondition[] = [];
              const startTrigElem = findChild(evElem, "StartTrigger");
              if (startTrigElem) {
                triggerConditions.push(...parseTriggerConditions(source, startTrigElem));
              }

              events.push({
                name: evName,
                priority,
                maximumExecutionCount: evMaxExec,
                triggerConditions,
                actions,
                range: makeRange(source, evElem),
              });
            }

            maneuvers.push({
              name: mName,
              events,
              range: makeRange(source, mElem),
            });
          }

          maneuverGroups.push({
            name: mgName,
            maximumExecutionCount: maxExec,
            actors,
            maneuvers,
            range: makeRange(source, mgElem),
          });
        }

        const actStartTrig = findChild(actElem, "StartTrigger");
        const actStopTrig = findChild(actElem, "StopTrigger");

        acts.push({
          name: actName,
          maneuverGroups,
          startTriggers: actStartTrig ? parseTriggerConditions(source, actStartTrig) : [],
          stopTriggers: actStopTrig ? parseTriggerConditions(source, actStopTrig) : [],
          range: makeRange(source, actElem),
        });
      }

      stories.push({
        name: storyName,
        acts,
        range: makeRange(source, storyElem),
      });
    }

    // Storyboard StopTrigger
    const sbStopTrig = findChild(storyboardElem, "StopTrigger");
    if (sbStopTrig) {
      stopTriggers.push(...parseTriggerConditions(source, sbStopTrig));
    }
  }

  return {
    header,
    parameters,
    entities,
    initActions,
    stories,
    stopTriggers,
    sourceFile: filename,
    rawXml: source,
    isOsc2: false,
  };
}

function parsePrivateAction(
  source: string,
  paElem: XmlElement,
  entityRef: string,
  actionName?: string,
): ScenarioAction | undefined {
  // TeleportAction
  const tpElem = findChild(paElem, "TeleportAction");
  if (tpElem) {
    const posElem = findChild(tpElem, "Position");
    const targetPosition = posElem ? parsePosition(posElem) : undefined;
    return {
      name: actionName,
      kind: "teleport",
      entityRef,
      targetPosition,
      range: makeRange(source, paElem),
    };
  }

  // LongitudinalAction -> SpeedAction
  const longElem = findChild(paElem, "LongitudinalAction");
  if (longElem) {
    const speedAction = findChild(longElem, "SpeedAction");
    if (speedAction) {
      const dynElem = findChild(speedAction, "SpeedActionDynamics");
      const targetElem = findChild(speedAction, "SpeedActionTarget");
      let targetSpeed: number | undefined;
      if (targetElem) {
        const absElem = findChild(targetElem, "AbsoluteTargetSpeed");
        if (absElem) {
          targetSpeed = getNumAttr(absElem, "value", 0);
        }
      }

      let speedDynamics: SpeedActionDynamics | undefined;
      if (dynElem) {
        const shape = (getAttr(dynElem, "dynamicsShape") as SpeedActionDynamics["shape"]) ?? "step";
        const val = getNumAttr(dynElem, "value", 0);
        const dim = getAttr(dynElem, "dynamicsDimension");
        speedDynamics = {
          shape,
          rate: dim === "rate" ? val : undefined,
          duration: dim === "time" ? val : undefined,
        };
      }

      return {
        name: actionName,
        kind: "speed",
        entityRef,
        targetSpeed,
        speedDynamics,
        range: makeRange(source, paElem),
      };
    }
  }

  // LateralAction -> LaneChangeAction
  const latElem = findChild(paElem, "LateralAction");
  if (latElem) {
    const lcElem = findChild(latElem, "LaneChangeAction");
    if (lcElem) {
      const targetElem = findChild(lcElem, "LaneChangeTarget");
      let targetLane: number | undefined;
      if (targetElem) {
        const absLane = findChild(targetElem, "AbsoluteTargetLane");
        if (absLane) targetLane = getNumAttr(absLane, "value", 1);
      }
      return {
        name: actionName,
        kind: "laneChange",
        entityRef,
        targetLane,
        range: makeRange(source, paElem),
      };
    }
  }

  return undefined;
}

function parsePosition(posElem: XmlElement): ScenarioPosition | undefined {
  const worldElem = findChild(posElem, "WorldPosition");
  if (worldElem) {
    const world: ScenarioWorldPosition = {
      x: getNumAttr(worldElem, "x", 0),
      y: getNumAttr(worldElem, "y", 0),
      z: getNumAttr(worldElem, "z", 0),
      h: worldElem.attributes.some((a) => a.name.toLowerCase() === "h") ? getNumAttr(worldElem, "h", 0) : undefined,
      p: worldElem.attributes.some((a) => a.name.toLowerCase() === "p") ? getNumAttr(worldElem, "p", 0) : undefined,
      r: worldElem.attributes.some((a) => a.name.toLowerCase() === "r") ? getNumAttr(worldElem, "r", 0) : undefined,
    };
    return { kind: "world", world };
  }

  const laneElem = findChild(posElem, "LanePosition");
  if (laneElem) {
    const lane: ScenarioLanePosition = {
      roadId: getAttr(laneElem, "roadId") ?? "1",
      laneId: getNumAttr(laneElem, "laneId", -1),
      s: getNumAttr(laneElem, "s", 0),
      offset: getNumAttr(laneElem, "offset", 0),
    };
    return { kind: "lane", lane };
  }

  return undefined;
}

function parseTriggerConditions(source: string, triggerElem: XmlElement): ScenarioCondition[] {
  const conditions: ScenarioCondition[] = [];

  for (const cg of findChildren(triggerElem, "ConditionGroup")) {
    for (const c of findChildren(cg, "Condition")) {
      const name = getAttr(c, "name") ?? "Condition";
      const delay = getNumAttr(c, "delay", 0);
      const edge = (getAttr(c, "conditionEdge") as ScenarioCondition["conditionEdge"]) ?? "none";

      const entityCond = findChild(c, "ByEntityCondition");
      const valueCond = findChild(c, "ByValueCondition");

      if (entityCond) {
        const entCondBody = findChild(entityCond, "EntityCondition");
        const trigEntities = findChild(entityCond, "TriggeringEntities");
        let entityRef: string | undefined;
        if (trigEntities) {
          const firstRef = findChild(trigEntities, "EntityRef");
          if (firstRef) entityRef = getAttr(firstRef, "entityRef");
        }

        if (entCondBody) {
          // TimeToCollisionCondition
          const ttcElem = findChild(entCondBody, "TimeToCollisionCondition");
          if (ttcElem) {
            const val = getNumAttr(ttcElem, "value", 2.0);
            const rule = (getAttr(ttcElem, "rule") as ConditionRule) ?? "lessThan";
            const freespace = getAttr(ttcElem, "freespace") === "true";
            const alongRoute = getAttr(ttcElem, "alongRoute") === "true";
            let targetEntityRef: string | undefined;
            const targetElem = findChild(ttcElem, "TimeToCollisionConditionTarget");
            if (targetElem) {
              const ref = findChild(targetElem, "EntityRef");
              if (ref) targetEntityRef = getAttr(ref, "entityRef");
            }
            conditions.push({
              name,
              delay,
              conditionEdge: edge,
              kind: "timeToCollision",
              rule,
              value: val,
              entityRef,
              targetEntityRef,
              freespace,
              alongRoute,
              range: makeRange(source, c),
            });
            continue;
          }

          // DistanceCondition
          const distElem = findChild(entCondBody, "DistanceCondition");
          if (distElem) {
            const val = getNumAttr(distElem, "value", 10.0);
            const rule = (getAttr(distElem, "rule") as ConditionRule) ?? "lessThan";
            const freespace = getAttr(distElem, "freespace") === "true";
            const alongRoute = getAttr(distElem, "alongRoute") === "true";
            const posElem = findChild(distElem, "Position");
            const targetPosition = posElem ? parsePosition(posElem) : undefined;
            conditions.push({
              name,
              delay,
              conditionEdge: edge,
              kind: "distance",
              rule,
              value: val,
              entityRef,
              targetPosition,
              freespace,
              alongRoute,
              range: makeRange(source, c),
            });
            continue;
          }

          // ReachPositionCondition
          const reachElem = findChild(entCondBody, "ReachPositionCondition");
          if (reachElem) {
            const tolerance = getNumAttr(reachElem, "tolerance", 2.0);
            const posElem = findChild(reachElem, "Position");
            const targetPosition = posElem ? parsePosition(posElem) : undefined;
            conditions.push({
              name,
              delay,
              conditionEdge: edge,
              kind: "reachPosition",
              rule: "lessThan",
              value: tolerance,
              entityRef,
              targetPosition,
              range: makeRange(source, c),
            });
            continue;
          }

          // RelativeSpeedCondition
          const relSpeedElem = findChild(entCondBody, "RelativeSpeedCondition");
          if (relSpeedElem) {
            const val = getNumAttr(relSpeedElem, "value", 0);
            const rule = (getAttr(relSpeedElem, "rule") as ConditionRule) ?? "greaterThan";
            const targetRef = getAttr(relSpeedElem, "entityRef");
            conditions.push({
              name,
              delay,
              conditionEdge: edge,
              kind: "relativeSpeed",
              rule,
              value: val,
              entityRef,
              targetEntityRef: targetRef,
              range: makeRange(source, c),
            });
            continue;
          }
        }
      }

      if (valueCond) {
        // SimulationTimeCondition
        const simTimeElem = findChild(valueCond, "SimulationTimeCondition");
        if (simTimeElem) {
          const val = getNumAttr(simTimeElem, "value", 0);
          const rule = (getAttr(simTimeElem, "rule") as ConditionRule) ?? "greaterThan";
          conditions.push({
            name,
            delay,
            conditionEdge: edge,
            kind: "simulationTime",
            rule,
            value: val,
            range: makeRange(source, c),
          });
          continue;
        }

        // ParameterCondition
        const paramCondElem = findChild(valueCond, "ParameterCondition");
        if (paramCondElem) {
          const ref = getAttr(paramCondElem, "parameterRef") ?? "";
          const val = getAttr(paramCondElem, "value") ?? "";
          const rule = (getAttr(paramCondElem, "rule") as ConditionRule) ?? "equalTo";
          conditions.push({
            name,
            delay,
            conditionEdge: edge,
            kind: "parameter",
            rule,
            value: val,
            entityRef: ref,
            range: makeRange(source, c),
          });
          continue;
        }
      }
    }
  }

  return conditions;
}

/**
 * Fallback parser for OpenSCENARIO 2.0 text syntax.
 */
function parseOsc2Dsl(source: string, filename?: string): OpenScenarioDocument {
  const lines = source.split("\n");
  const entities = new Map<string, ScenarioObject>();
  const initActions: ScenarioAction[] = [];
  const stories: ScenarioStory[] = [];
  let scenarioName = "ScenarioOsc2";

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    if (trimmed.startsWith("scenario ")) {
      const parts = trimmed.split(":");
      scenarioName = parts[0]?.replace("scenario", "").trim() ?? "ScenarioOsc2";
    } else if (trimmed.includes(": vehicle") || trimmed.includes(": car")) {
      const actorName = trimmed.split(":")[0]?.trim() ?? "actor";
      const isEgo = actorName.toLowerCase().includes("ego") || actorName.toLowerCase() === "host";
      entities.set(actorName, {
        name: actorName,
        objectType: "vehicle",
        isEgo,
        performance: { maxSpeed: 45, maxAcceleration: 4, maxDeceleration: 7 },
        boundingBox: {
          center: { x: 0, y: 0, z: 0 },
          dimensions: { width: 1.9, length: 4.6, height: 1.4 },
        },
      });
    }
  }

  const defaultEgo = Array.from(entities.values()).find((e) => e.isEgo)?.name ?? "ego";
  stories.push({
    name: "Osc2Story",
    acts: [
      {
        name: "Osc2Act",
        maneuverGroups: [
          {
            name: "Osc2ManeuverGroup",
            maximumExecutionCount: 1,
            actors: Array.from(entities.keys()),
            maneuvers: [
              {
                name: "Osc2Maneuver",
                events: [
                  {
                    name: "Osc2DriveEvent",
                    priority: "overwrite",
                    maximumExecutionCount: 1,
                    triggerConditions: [
                      {
                        name: "StartSim",
                        delay: 0,
                        conditionEdge: "rising",
                        kind: "simulationTime",
                        rule: "greaterOrEqual",
                        value: 0,
                      },
                    ],
                    actions: [
                      {
                        kind: "speed",
                        entityRef: defaultEgo,
                        targetSpeed: 25,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        startTriggers: [],
        stopTriggers: [],
      },
    ],
  });

  return {
    header: {
      revMajor: 2,
      revMinor: 0,
      date: new Date().toISOString(),
      description: `Imported OSC 2.0 scenario: ${scenarioName}`,
      author: "ModelScript",
    },
    parameters: [],
    entities,
    initActions,
    stories,
    stopTriggers: [],
    sourceFile: filename,
    rawXml: source,
    isOsc2: true,
  };
}

/**
 * Serializes OpenScenarioDocument back to valid ASAM OpenSCENARIO XML (.xosc).
 */
export function serializeOpenScenario(doc: OpenScenarioDocument): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<OpenSCENARIO>`);
  lines.push(
    `  <FileHeader revMajor="${doc.header.revMajor}" revMinor="${doc.header.revMinor}" date="${doc.header.date}" description="${escapeXml(doc.header.description)}" author="${escapeXml(doc.header.author)}"/>`,
  );

  // Parameters
  if (doc.parameters.length > 0) {
    lines.push(`  <ParameterDeclarations>`);
    for (const p of doc.parameters) {
      lines.push(
        `    <ParameterDeclaration name="${p.name}" parameterType="${p.parameterType}" value="${escapeXml(p.value)}"/>`,
      );
    }
    lines.push(`  </ParameterDeclarations>`);
  }

  // Entities
  lines.push(`  <Entities>`);
  for (const ent of doc.entities.values()) {
    lines.push(`    <ScenarioObject name="${ent.name}">`);
    if (ent.objectType === "vehicle") {
      lines.push(`      <Vehicle name="${ent.name}" vehicleCategory="${ent.category ?? "car"}">`);
      if (ent.performance) {
        lines.push(
          `        <Performance maxSpeed="${ent.performance.maxSpeed}" maxAcceleration="${ent.performance.maxAcceleration}" maxDeceleration="${ent.performance.maxDeceleration}"/>`,
        );
      }
      if (ent.boundingBox) {
        lines.push(`        <BoundingBox>`);
        lines.push(
          `          <Center x="${ent.boundingBox.center.x}" y="${ent.boundingBox.center.y}" z="${ent.boundingBox.center.z}"/>`,
        );
        lines.push(
          `          <Dimensions width="${ent.boundingBox.dimensions.width}" length="${ent.boundingBox.dimensions.length}" height="${ent.boundingBox.dimensions.height}"/>`,
        );
        lines.push(`        </BoundingBox>`);
      }
      lines.push(`      </Vehicle>`);
    } else if (ent.objectType === "pedestrian") {
      lines.push(`      <Pedestrian name="${ent.name}" pedestrianCategory="${ent.category ?? "pedestrian"}"/>`);
    } else {
      lines.push(`      <MiscObject name="${ent.name}" miscObjectCategory="${ent.category ?? "obstacle"}"/>`);
    }
    lines.push(`    </ScenarioObject>`);
  }
  lines.push(`  </Entities>`);

  // Storyboard
  lines.push(`  <Storyboard>`);
  lines.push(`    <Init>`);
  lines.push(`      <Actions>`);
  for (const act of doc.initActions) {
    lines.push(`        <Private entityRef="${act.entityRef}">`);
    lines.push(`          <PrivateAction>`);
    if (act.kind === "teleport" && act.targetPosition) {
      lines.push(`            <TeleportAction>`);
      lines.push(serializePositionXml(act.targetPosition, "              "));
      lines.push(`            </TeleportAction>`);
    } else if (act.kind === "speed" && act.targetSpeed !== undefined) {
      lines.push(`            <LongitudinalAction>`);
      lines.push(`              <SpeedAction>`);
      lines.push(`                <SpeedActionDynamics dynamicsShape="step" value="0" dynamicsDimension="time"/>`);
      lines.push(`                <SpeedActionTarget>`);
      lines.push(`                  <AbsoluteTargetSpeed value="${act.targetSpeed}"/>`);
      lines.push(`                </SpeedActionTarget>`);
      lines.push(`              </SpeedAction>`);
      lines.push(`            </LongitudinalAction>`);
    }
    lines.push(`          </PrivateAction>`);
    lines.push(`        </Private>`);
  }
  lines.push(`      </Actions>`);
  lines.push(`    </Init>`);

  // Stories
  for (const story of doc.stories) {
    lines.push(`    <Story name="${story.name}">`);
    for (const act of story.acts) {
      lines.push(`      <Act name="${act.name}">`);
      for (const mg of act.maneuverGroups) {
        lines.push(`        <ManeuverGroup maximumExecutionCount="${mg.maximumExecutionCount}" name="${mg.name}">`);
        lines.push(`          <Actors selectTriggeringEntities="false">`);
        for (const actor of mg.actors) {
          lines.push(`            <EntityRef entityRef="${actor}"/>`);
        }
        lines.push(`          </Actors>`);
        for (const m of mg.maneuvers) {
          lines.push(`          <Maneuver name="${m.name}">`);
          for (const ev of m.events) {
            lines.push(
              `            <Event name="${ev.name}" priority="${ev.priority}" maximumExecutionCount="${ev.maximumExecutionCount}">`,
            );
            for (const a of ev.actions) {
              lines.push(`              <Action name="${a.name ?? "Action"}">`);
              lines.push(`                <PrivateAction>`);
              if (a.kind === "speed" && a.targetSpeed !== undefined) {
                lines.push(`                  <LongitudinalAction>`);
                lines.push(`                    <SpeedAction>`);
                lines.push(
                  `                      <SpeedActionDynamics dynamicsShape="${a.speedDynamics?.shape ?? "linear"}" value="${a.speedDynamics?.rate ?? a.speedDynamics?.duration ?? 1.0}" dynamicsDimension="${a.speedDynamics?.rate ? "rate" : "time"}"/>`,
                );
                lines.push(`                      <SpeedActionTarget>`);
                lines.push(`                        <AbsoluteTargetSpeed value="${a.targetSpeed}"/>`);
                lines.push(`                      </SpeedActionTarget>`);
                lines.push(`                    </SpeedAction>`);
                lines.push(`                  </LongitudinalAction>`);
              }
              lines.push(`                </PrivateAction>`);
              lines.push(`              </Action>`);
            }
            if (ev.triggerConditions.length > 0) {
              lines.push(`              <StartTrigger>`);
              lines.push(`                <ConditionGroup>`);
              for (const c of ev.triggerConditions) {
                lines.push(serializeConditionXml(c, "                  "));
              }
              lines.push(`                </ConditionGroup>`);
              lines.push(`              </StartTrigger>`);
            }
            lines.push(`            </Event>`);
          }
          lines.push(`          </Maneuver>`);
        }
        lines.push(`        </ManeuverGroup>`);
      }
      lines.push(`      </Act>`);
    }
    lines.push(`    </Story>`);
  }

  lines.push(`    <StopTrigger/>`);
  lines.push(`  </Storyboard>`);
  lines.push(`</OpenSCENARIO>`);
  return lines.join("\n");
}

function serializePositionXml(pos: ScenarioPosition, indent: string): string {
  if (pos.kind === "world" && pos.world) {
    return `${indent}<Position>\n${indent}  <WorldPosition x="${pos.world.x}" y="${pos.world.y}" z="${pos.world.z}"${pos.world.h !== undefined ? ` h="${pos.world.h}"` : ""}/>\n${indent}</Position>`;
  }
  if (pos.kind === "lane" && pos.lane) {
    return `${indent}<Position>\n${indent}  <LanePosition roadId="${pos.lane.roadId}" laneId="${pos.lane.laneId}" s="${pos.lane.s}" offset="${pos.lane.offset ?? 0}"/>\n${indent}</Position>`;
  }
  return `${indent}<Position/>`;
}

function serializeConditionXml(c: ScenarioCondition, indent: string): string {
  const parts: string[] = [];
  parts.push(`${indent}<Condition name="${c.name}" delay="${c.delay}" conditionEdge="${c.conditionEdge}">`);
  if (c.kind === "simulationTime") {
    parts.push(
      `${indent}  <ByValueCondition>\n${indent}    <SimulationTimeCondition value="${c.value}" rule="${c.rule}"/>\n${indent}  </ByValueCondition>`,
    );
  } else if (c.kind === "timeToCollision") {
    parts.push(`${indent}  <ByEntityCondition>`);
    if (c.entityRef) {
      parts.push(
        `${indent}    <TriggeringEntities rule="any">\n${indent}      <EntityRef entityRef="${c.entityRef}"/>\n${indent}    </TriggeringEntities>`,
      );
    }
    parts.push(
      `${indent}    <EntityCondition>\n${indent}      <TimeToCollisionCondition value="${c.value}" freespace="${c.freespace ?? false}" alongRoute="${c.alongRoute ?? true}" rule="${c.rule}">`,
    );
    if (c.targetEntityRef) {
      parts.push(
        `${indent}        <TimeToCollisionConditionTarget>\n${indent}          <EntityRef entityRef="${c.targetEntityRef}"/>\n${indent}        </TimeToCollisionConditionTarget>`,
      );
    }
    parts.push(`${indent}      </TimeToCollisionCondition>\n${indent}    </EntityCondition>`);
    parts.push(`${indent}  </ByEntityCondition>`);
  }
  parts.push(`${indent}</Condition>`);
  return parts.join("\n");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

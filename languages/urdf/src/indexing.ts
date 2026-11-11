// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { parseUrdf } from "./parser/urdf-parser.js";
import type { UrdfRobot } from "./types.js";

/**
 * Content predicate for disambiguating Gazebo SDFormat XML (`.sdf`) from MDL Structure-Data Files (`.sdf`).
 */
export function canIndexUrdfFile(uri: string, text = ""): boolean {
  if (/\.(?:urdf|xacro)$/i.test(uri)) return true;
  return /<\s*(?:robot|sdf|world|model)\b/i.test(text);
}

/**
 * Declarative `UnifiedWorkspace` file indexer for ROS URDF, SDFormat, and Xacro files (`.urdf`, `.sdf`, `.xacro`).
 */
export function indexUrdfFile(ctx: DslIndexFileContext): void {
  try {
    const robot = parseUrdf(ctx.text, ctx.uri);
    ctx.setParsedModel(robot);

    const robotName = robot.name || "UrdfRobot";
    const rootId = ctx.addSymbol(robotName, "Class", null, 0, ctx.text.length, {
      numLinks: robot.links.size,
      numJoints: robot.joints.size,
      numMaterials: robot.materials.size,
    });

    for (const link of robot.links.values()) {
      ctx.addSymbol(link.name, "Variable", rootId, link.range?.startOffset ?? 0, link.range?.endOffset ?? 0, {
        mass: link.inertial?.mass,
        hasVisuals: link.visuals.length > 0,
        hasCollisions: link.collisions.length > 0,
      });
    }

    for (const joint of robot.joints.values()) {
      ctx.addSymbol(joint.name, "Method", rootId, joint.range?.startOffset ?? 0, joint.range?.endOffset ?? 0, {
        type: joint.type,
        parentLink: joint.parentLink,
        childLink: joint.childLink,
      });
    }

    for (const mat of robot.materials.values()) {
      ctx.addSymbol(mat.name, "Property", rootId, 0, 0, { color: mat.color });
    }
  } catch {
    // Preserve empty symbol table on parse failure
  }
}

/**
 * Retrieves the parsed `UrdfRobot` model for `uri` from `workspace`.
 */
export function getUrdfRobot(workspace: UnifiedWorkspace, uri: string): UrdfRobot | undefined {
  return workspace.getParsedModel<UrdfRobot>(uri);
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseWorkspaceIndex, type SymbolEntry, type SymbolIndex } from "@modelscript/runtime";
import { parseUrdf } from "./parser/urdf-parser.js";
import type { UrdfRobot } from "./types.js";

/**
 * Multi-File Workspace Indexer for ROS URDF, SDFormat, and Xacro files (.urdf, .sdf, .xacro).
 * Resolves links, joints, materials, and transmissions across workspaces.
 */
export class UrdfWorkspaceIndex extends BaseWorkspaceIndex<UrdfRobot> {
  public readonly languageName = "urdf";

  public getRobot(uri: string): UrdfRobot | undefined {
    return this.fileDecks.get(uri);
  }

  public getSymbols(): SymbolIndex {
    return this.toSymbolIndex();
  }

  public findSymbolsByName(name: string): SymbolEntry[] {
    return this.getSymbolsByName(name);
  }

  public indexFile(uri: string, text: string): SymbolIndex {
    const { addSymbol } = this.createIndexContext(uri);

    const robot = parseUrdf(text, uri);
    this.fileDecks.set(uri, robot);

    // Root Robot Symbol
    const robotName = robot.name || "UrdfRobot";
    const rootId = addSymbol(robotName, "Class", null, 0, text.length, {
      numLinks: robot.links.size,
      numJoints: robot.joints.size,
      numMaterials: robot.materials.size,
    });

    const addChild = (name: string, kind: string, meta?: Record<string, unknown>, startOffset = 0, endOffset = 0) => {
      addSymbol(name, kind, rootId, startOffset, endOffset, meta ?? {});
    };

    // Index Links
    for (const link of robot.links.values()) {
      addChild(
        link.name,
        "Variable",
        {
          mass: link.inertial?.mass,
          hasVisuals: link.visuals.length > 0,
          hasCollisions: link.collisions.length > 0,
        },
        link.range?.startOffset ?? 0,
        link.range?.endOffset ?? 0,
      );
    }

    // Index Joints
    for (const joint of robot.joints.values()) {
      addChild(
        joint.name,
        "Method",
        {
          type: joint.type,
          parentLink: joint.parentLink,
          childLink: joint.childLink,
        },
        joint.range?.startOffset ?? 0,
        joint.range?.endOffset ?? 0,
      );
    }

    // Index Materials
    for (const mat of robot.materials.values()) {
      addChild(mat.name, "Property", { color: mat.color });
    }

    return this.getFileIndex(uri)!;
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Pre-Flight Robotics Linter Rules (M7501-M7520).
 *
 * Implements rigorous structural, kinematic, and physical checks for ROS URDF
 * and SDFormat robot definitions matching ROS / MoveIt / Gazebo standards.
 */

import { UrdfErrorCode } from "../errors.js";
import type { SourceRange, UrdfDiagnostic, UrdfRobot } from "../types.js";

const DEFAULT_RANGE: SourceRange = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
};

/**
 * Runs all pre-flight robotics diagnostic rules against an UrdfRobot.
 */
export function lintUrdfRobot(robot: UrdfRobot): UrdfDiagnostic[] {
  const diagnostics: UrdfDiagnostic[] = [];

  // 0. M7514: Duplicate joint names
  if (robot.duplicateJointNames) {
    for (const dupName of robot.duplicateJointNames) {
      const joint = robot.joints.get(dupName);
      diagnostics.push({
        code: UrdfErrorCode.DUPLICATE_JOINT_NAME.code,
        severity: UrdfErrorCode.DUPLICATE_JOINT_NAME.severity,
        message: UrdfErrorCode.DUPLICATE_JOINT_NAME.message(dupName),
        range: joint?.range ?? DEFAULT_RANGE,
      });
    }
  }

  // 1. M7501, M7502 & M7513: Kinematic tree connectivity and closed loop detection
  checkKinematicTree(robot, diagnostics);

  // 2. M7503, M7506, M7509 & M7510: Inertial mass and inertia tensor validity
  checkMassProperties(robot, diagnostics);

  // 3. M7504 & M7508: Joint limits
  checkJointLimits(robot, diagnostics);

  // 4. M7507: Joint axis non-zero norm
  checkJointAxes(robot, diagnostics);

  // 5. M7505 & M7512: Mesh filename and collision envelope checks
  checkMeshResources(robot, diagnostics);

  // 6. M7511: Mimic joint circular dependency checks
  checkMimicJointCycles(robot, diagnostics);

  return diagnostics;
}

function checkKinematicTree(robot: UrdfRobot, diagnostics: UrdfDiagnostic[]): void {
  const parentOf = new Map<string, string>(); // childLink -> parentLink
  const childrenOf = new Map<string, string[]>(); // parentLink -> childLinks[]

  for (const linkName of robot.links.keys()) {
    childrenOf.set(linkName, []);
  }

  for (const joint of robot.joints.values()) {
    if (!robot.links.has(joint.parentLink)) {
      diagnostics.push({
        code: UrdfErrorCode.UNRESOLVED_PARENT_LINK.code,
        severity: UrdfErrorCode.UNRESOLVED_PARENT_LINK.severity,
        message: UrdfErrorCode.UNRESOLVED_PARENT_LINK.message(joint.name, joint.parentLink),
        range: joint.range ?? DEFAULT_RANGE,
      });
    }
    if (!robot.links.has(joint.childLink)) {
      diagnostics.push({
        code: UrdfErrorCode.UNRESOLVED_CHILD_LINK.code,
        severity: UrdfErrorCode.UNRESOLVED_CHILD_LINK.severity,
        message: UrdfErrorCode.UNRESOLVED_CHILD_LINK.message(joint.name, joint.childLink),
        range: joint.range ?? DEFAULT_RANGE,
      });
    }

    if (parentOf.has(joint.childLink)) {
      diagnostics.push({
        code: "M7502",
        severity: "warning",
        message: `Link '${joint.childLink}' has multiple parent joints ('${parentOf.get(joint.childLink)}' and '${joint.name}'). Closed kinematic loops are not standard URDF.`,
        range: joint.range ?? DEFAULT_RANGE,
      });
    } else {
      parentOf.set(joint.childLink, joint.parentLink);
    }

    const cList = childrenOf.get(joint.parentLink) ?? [];
    cList.push(joint.childLink);
    childrenOf.set(joint.parentLink, cList);
  }

  // Find root links (links without a parent joint)
  const rootLinks: string[] = [];
  for (const linkName of robot.links.keys()) {
    if (!parentOf.has(linkName)) {
      rootLinks.push(linkName);
    }
  }

  if (robot.links.size > 1 && rootLinks.length === 0) {
    // Pure cycle across all links
    diagnostics.push({
      code: "M7502",
      severity: "error",
      message: "Directed closed cycle detected in kinematic tree: no root base link exists.",
      range: DEFAULT_RANGE,
    });
  } else if (robot.links.size > 1 && rootLinks.length > 1) {
    // Forest / disconnected components
    for (const root of rootLinks) {
      const link = robot.links.get(root);
      diagnostics.push({
        code: "M7501",
        severity: "warning",
        message: `Kinematic forest detected: link '${root}' is unparented and forms an independent tree root.`,
        range: link?.range ?? DEFAULT_RANGE,
      });
    }
  }

  // Cycle check using DFS
  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(curr: string): boolean {
    visited.add(curr);
    recStack.add(curr);

    const children = childrenOf.get(curr) ?? [];
    for (const child of children) {
      if (!visited.has(child)) {
        if (dfs(child)) return true;
      } else if (recStack.has(child)) {
        diagnostics.push({
          code: "M7502",
          severity: "warning",
          message: `Closed kinematic loop detected involving link '${child}'.`,
          range: robot.links.get(child)?.range ?? DEFAULT_RANGE,
        });
        return true;
      }
    }

    recStack.delete(curr);
    return false;
  }

  for (const root of rootLinks) {
    if (!visited.has(root)) {
      dfs(root);
    }
  }
}

function checkMassProperties(robot: UrdfRobot, diagnostics: UrdfDiagnostic[]): void {
  for (const link of robot.links.values()) {
    if (!link.inertial) {
      diagnostics.push({
        code: UrdfErrorCode.MASSLESS_LINK.code,
        severity: UrdfErrorCode.MASSLESS_LINK.severity,
        message: UrdfErrorCode.MASSLESS_LINK.message(link.name),
        range: link.range ?? DEFAULT_RANGE,
      });
      continue;
    }

    const in_ = link.inertial;
    if (Number.isNaN(in_.mass)) {
      diagnostics.push({
        code: "M7503",
        severity: "error",
        message: `Link '${link.name}' has non-numeric mass value in <mass>.`,
        range: link.range ?? DEFAULT_RANGE,
      });
      continue;
    }
    if (in_.mass < 0) {
      diagnostics.push({
        code: UrdfErrorCode.NEGATIVE_LINK_MASS.code,
        severity: UrdfErrorCode.NEGATIVE_LINK_MASS.severity,
        message: UrdfErrorCode.NEGATIVE_LINK_MASS.message(link.name, in_.mass),
        range: link.range ?? DEFAULT_RANGE,
      });
      diagnostics.push({
        code: "M7503",
        severity: "error",
        message: `Link '${link.name}' has non-positive mass (${in_.mass} kg).`,
        range: link.range ?? DEFAULT_RANGE,
      });
    } else if (in_.mass === 0) {
      diagnostics.push({
        code: UrdfErrorCode.MASSLESS_LINK.code,
        severity: UrdfErrorCode.MASSLESS_LINK.severity,
        message: UrdfErrorCode.MASSLESS_LINK.message(link.name),
        range: link.range ?? DEFAULT_RANGE,
      });
      diagnostics.push({
        code: "M7503",
        severity: "error",
        message: `Link '${link.name}' has non-positive mass (${in_.mass} kg).`,
        range: link.range ?? DEFAULT_RANGE,
      });
    }

    if (in_.ixx <= 0 || in_.iyy <= 0 || in_.izz <= 0) {
      diagnostics.push({
        code: "M7503",
        severity: "error",
        message: `Link '${link.name}' has non-positive principal inertia (ixx=${in_.ixx}, iyy=${in_.iyy}, izz=${in_.izz}).`,
        range: link.range ?? DEFAULT_RANGE,
      });
      continue;
    }

    // Physical rigid body triangle inequality:
    // Ixx + Iyy >= Izz, Iyy + Izz >= Ixx, Izz + Ixx >= Iyy
    const eps = 1e-9;
    if (in_.ixx + in_.iyy + eps < in_.izz || in_.iyy + in_.izz + eps < in_.ixx || in_.izz + in_.ixx + eps < in_.iyy) {
      diagnostics.push({
        code: "M7503",
        severity: "error",
        message: `Inertia tensor for link '${link.name}' violates physical rigid body triangle inequalities (ixx=${in_.ixx}, iyy=${in_.iyy}, izz=${in_.izz}).`,
        range: link.range ?? DEFAULT_RANGE,
      });
      diagnostics.push({
        code: UrdfErrorCode.INERTIA_TRIANGLE_INEQUALITY.code,
        severity: UrdfErrorCode.INERTIA_TRIANGLE_INEQUALITY.severity,
        message: UrdfErrorCode.INERTIA_TRIANGLE_INEQUALITY.message(link.name),
        range: link.range ?? DEFAULT_RANGE,
      });
    }
  }
}

function checkJointLimits(robot: UrdfRobot, diagnostics: UrdfDiagnostic[]): void {
  for (const joint of robot.joints.values()) {
    if (joint.type === "continuous" && joint.limits) {
      if (joint.limits.lower !== undefined || joint.limits.upper !== undefined) {
        diagnostics.push({
          code: UrdfErrorCode.CONTINUOUS_JOINT_LIMITS.code,
          severity: UrdfErrorCode.CONTINUOUS_JOINT_LIMITS.severity,
          message: UrdfErrorCode.CONTINUOUS_JOINT_LIMITS.message(joint.name),
          range: joint.range ?? DEFAULT_RANGE,
        });
      }
    }

    if (joint.type === "revolute" || joint.type === "prismatic") {
      if (!joint.limits) {
        diagnostics.push({
          code: "M7504",
          severity: "error",
          message: `Joint '${joint.name}' of type '${joint.type}' is missing mandatory '<limit>' parameters.`,
          range: joint.range ?? DEFAULT_RANGE,
          quickFix: {
            title: "Add standard joint limits",
            edit: {
              text: `  <limit effort="100.0" velocity="10.0" lower="-3.14159" upper="3.14159" />\n`,
              range: joint.range ?? DEFAULT_RANGE,
            },
          },
        });
        continue;
      }

      if (joint.limits.effort <= 0) {
        diagnostics.push({
          code: "M7504",
          severity: "error",
          message: `Joint '${joint.name}' effort limit must be strictly positive (${joint.limits.effort} N or N*m).`,
          range: joint.range ?? DEFAULT_RANGE,
        });
      }

      if (joint.limits.velocity <= 0) {
        diagnostics.push({
          code: "M7504",
          severity: "error",
          message: `Joint '${joint.name}' velocity limit must be strictly positive (${joint.limits.velocity} rad/s or m/s).`,
          range: joint.range ?? DEFAULT_RANGE,
        });
      }

      if (
        joint.limits.lower !== undefined &&
        joint.limits.upper !== undefined &&
        joint.limits.lower >= joint.limits.upper
      ) {
        diagnostics.push({
          code: UrdfErrorCode.INVALID_JOINT_LIMITS.code,
          severity: UrdfErrorCode.INVALID_JOINT_LIMITS.severity,
          message: UrdfErrorCode.INVALID_JOINT_LIMITS.message(joint.name, joint.limits.lower, joint.limits.upper),
          range: joint.range ?? DEFAULT_RANGE,
        });
        if (joint.limits.lower > joint.limits.upper) {
          diagnostics.push({
            code: "M7508",
            severity: "error",
            message: `Joint '${joint.name}' has inverted limits (lower=${joint.limits.lower} > upper=${joint.limits.upper}).`,
            range: joint.range ?? DEFAULT_RANGE,
          });
        }
      }
    }
  }
}

function checkJointAxes(robot: UrdfRobot, diagnostics: UrdfDiagnostic[]): void {
  for (const joint of robot.joints.values()) {
    if (joint.type === "revolute" || joint.type === "continuous" || joint.type === "prismatic") {
      const a = joint.axis;
      const norm = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      if (norm < 1e-6) {
        diagnostics.push({
          code: UrdfErrorCode.ZERO_NORM_JOINT_AXIS.code,
          severity: UrdfErrorCode.ZERO_NORM_JOINT_AXIS.severity,
          message: UrdfErrorCode.ZERO_NORM_JOINT_AXIS.message(joint.name),
          range: joint.range ?? DEFAULT_RANGE,
        });
      }
    }
  }
}

function checkMeshResources(robot: UrdfRobot, diagnostics: UrdfDiagnostic[]): void {
  for (const link of robot.links.values()) {
    if (link.visuals.length > 0 && link.collisions.length === 0) {
      diagnostics.push({
        code: UrdfErrorCode.MISSING_COLLISION_WITH_VISUAL.code,
        severity: UrdfErrorCode.MISSING_COLLISION_WITH_VISUAL.severity,
        message: UrdfErrorCode.MISSING_COLLISION_WITH_VISUAL.message(link.name),
        range: link.range ?? DEFAULT_RANGE,
      });
    }

    for (const vis of link.visuals) {
      if (vis.geometry.type === "mesh" && !vis.geometry.filename) {
        diagnostics.push({
          code: UrdfErrorCode.MISSING_MESH_RESOURCE.code,
          severity: UrdfErrorCode.MISSING_MESH_RESOURCE.severity,
          message: UrdfErrorCode.MISSING_MESH_RESOURCE.message(link.name, ""),
          range: link.range ?? DEFAULT_RANGE,
        });
      }
    }
    for (const col of link.collisions) {
      if (col.geometry.type === "mesh" && !col.geometry.filename) {
        diagnostics.push({
          code: UrdfErrorCode.MISSING_MESH_RESOURCE.code,
          severity: UrdfErrorCode.MISSING_MESH_RESOURCE.severity,
          message: UrdfErrorCode.MISSING_MESH_RESOURCE.message(link.name, ""),
          range: link.range ?? DEFAULT_RANGE,
        });
      }
    }
  }
}

function checkMimicJointCycles(robot: UrdfRobot, diagnostics: UrdfDiagnostic[]): void {
  for (const joint of robot.joints.values()) {
    if (!joint.mimic?.joint) continue;
    const visited = new Set<string>([joint.name]);
    let currName: string | undefined = joint.mimic.joint;
    while (currName) {
      if (visited.has(currName)) {
        if (currName === joint.name) {
          diagnostics.push({
            code: UrdfErrorCode.MIMIC_JOINT_CYCLE.code,
            severity: UrdfErrorCode.MIMIC_JOINT_CYCLE.severity,
            message: UrdfErrorCode.MIMIC_JOINT_CYCLE.message(joint.name),
            range: joint.range ?? DEFAULT_RANGE,
          });
        }
        break;
      }
      visited.add(currName);
      currName = robot.joints.get(currName)?.mimic?.joint;
    }
  }
}


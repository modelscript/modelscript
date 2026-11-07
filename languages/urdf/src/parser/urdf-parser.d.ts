import type { UrdfRobot } from "../types.js";
/**
 * Parses a URDF, SDF, or Xacro XML string into a strongly-typed UrdfRobot AST.
 */
export declare function parseUrdf(content: string, defaultName?: string): UrdfRobot;
/**
 * Losslessly serializes an UrdfRobot back to canonical XML format.
 */
export declare function serializeUrdf(robot: UrdfRobot): string;
//# sourceMappingURL=urdf-parser.d.ts.map
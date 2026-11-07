export interface Vector3D {
    x: number;
    y: number;
    z: number;
}
export interface SourceRange {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
    startOffset?: number | undefined;
    endOffset?: number | undefined;
}
export interface UrdfOrigin {
    xyz: Vector3D;
    rpy: Vector3D;
}
export interface UrdfInertial {
    origin?: UrdfOrigin | undefined;
    mass: number;
    ixx: number;
    ixy: number;
    ixz: number;
    iyy: number;
    iyz: number;
    izz: number;
}
export type UrdfGeometryType = "box" | "cylinder" | "sphere" | "mesh";
export interface UrdfGeometry {
    type: UrdfGeometryType;
    size?: Vector3D | undefined;
    radius?: number | undefined;
    length?: number | undefined;
    filename?: string | undefined;
    scale?: Vector3D | undefined;
}
export interface UrdfColor {
    r: number;
    g: number;
    b: number;
    a: number;
}
export interface UrdfMaterial {
    name: string;
    color?: UrdfColor | undefined;
    texture?: string | undefined;
}
export interface UrdfVisual {
    name?: string | undefined;
    origin?: UrdfOrigin | undefined;
    geometry: UrdfGeometry;
    material?: UrdfMaterial | undefined;
}
export interface UrdfCollision {
    name?: string | undefined;
    origin?: UrdfOrigin | undefined;
    geometry: UrdfGeometry;
}
export interface UrdfLink {
    name: string;
    inertial?: UrdfInertial | undefined;
    visuals: UrdfVisual[];
    collisions: UrdfCollision[];
    range?: SourceRange | undefined;
}
export type UrdfJointType = "revolute" | "continuous" | "prismatic" | "fixed" | "floating" | "planar";
export interface UrdfJointLimits {
    lower?: number | undefined;
    upper?: number | undefined;
    effort: number;
    velocity: number;
}
export interface UrdfJointDynamics {
    damping?: number | undefined;
    friction?: number | undefined;
}
export interface UrdfJointMimic {
    joint: string;
    multiplier?: number | undefined;
    offset?: number | undefined;
}
export interface UrdfJoint {
    name: string;
    type: UrdfJointType;
    parentLink: string;
    childLink: string;
    origin?: UrdfOrigin | undefined;
    axis: Vector3D;
    limits?: UrdfJointLimits | undefined;
    dynamics?: UrdfJointDynamics | undefined;
    mimic?: UrdfJointMimic | undefined;
    range?: SourceRange | undefined;
}
export interface UrdfRobot {
    name: string;
    links: Map<string, UrdfLink>;
    joints: Map<string, UrdfJoint>;
    materials: Map<string, UrdfMaterial>;
    duplicateJointNames?: string[] | undefined;
}
export interface UrdfDiagnostic {
    code: string;
    severity: "error" | "warning" | "info";
    message: string;
    range: SourceRange;
    quickFix?: {
        title: string;
        edit: {
            text: string;
            range: SourceRange;
        };
    } | undefined;
}
export interface RneaResult {
    jointTorques: Map<string, number>;
}
export interface AbaResult {
    jointAccelerations: Map<string, number>;
}
export interface UrdfTrajectoryData {
    /** Array of simulation time points [seconds]. */
    times: number[];
    /** Map of jointName -> array of coordinate values q(t) at each time point. */
    jointPositions?: Map<string, number[]> | Record<string, number[]> | undefined;
    /** Optional alias for jointPositions used by some external trajectory payloads. */
    joints?: Map<string, number[]> | Record<string, number[]> | undefined;
}
export interface DigitalTwinProgramStep {
    id: string | number;
    machine?: string | undefined;
    label: string;
    description?: string | undefined;
    parallelMachine?: string | undefined;
    parallelLabel?: string | undefined;
    startTime: number;
    endTime: number;
    color?: string | undefined;
    targetCoordinates?: [number, number, number] | undefined;
    status?: "pending" | "active" | "completed" | undefined;
}
export interface DigitalTwinEnvironmentAsset {
    id: string;
    name: string;
    type: "mesh" | "box" | "cylinder" | "table" | "vial_rack" | "workstation_cabinet" | "reactor_mixer" | "wash_cup";
    url?: string | undefined;
    position: [number, number, number];
    rotation?: [number, number, number] | undefined;
    dimensions?: [number, number, number] | undefined;
    color?: string | undefined;
    opacity?: number | undefined;
    isCollisionHull?: boolean | undefined;
}
export interface DigitalTwinToolpathTrace {
    linkName: string;
    label?: string | undefined;
    points: [number, number, number][];
    color?: string | undefined;
}
export interface UrdfVisualPose3D {
    id: string;
    linkName: string;
    visualName?: string | undefined;
    isCollision: boolean;
    geometry: UrdfGeometry;
    position: [number, number, number];
    rotation: [number, number, number, number, number, number, number, number, number];
    color?: string | undefined;
    opacity?: number | undefined;
    materialName?: string | undefined;
}
export interface DigitalTwinClearanceResult {
    minDistanceMm: number;
    nearestLinkName: string;
    nearestObstacleName: string;
    fromPoint: [number, number, number];
    toPoint: [number, number, number];
}
export interface DigitalTwinLiveTelemetry {
    jointVelocitiesRadPerSec: Map<string, number>;
    maxJointSpeedDegPerSec: number;
    rmsJointSpeedDegPerSec: number;
    gripperOpeningMm: number;
    gripperStateLabel: "Open" | "Closed" | "Gripping";
    hasGripper?: boolean | undefined;
    tcpSpeedMmPerSec?: number | undefined;
    clearance: DigitalTwinClearanceResult;
}
export interface UrdfDigitalTwinConfig {
    code?: string | undefined;
    url?: string | undefined;
    title?: string | undefined;
    modelName?: string | undefined;
    robotName?: string | undefined;
    trajectory?: UrdfTrajectoryData | undefined;
    programSteps?: DigitalTwinProgramStep[] | undefined;
    environment?: DigitalTwinEnvironmentAsset[] | undefined;
    toolpaths?: DigitalTwinToolpathTrace[] | undefined;
    telemetryChannels?: Array<{
        name: string;
        unit: string;
        nominal: number;
        variableKey?: string | undefined;
    }> | undefined;
    standalone?: boolean | undefined;
    [key: string]: unknown;
}
//# sourceMappingURL=types.d.ts.map
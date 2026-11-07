import { type ConflictClause, type SharedEquality } from "../../../../../../packages/runtime/src/formal/theory_coordinator.js";
import { ThreadDomain } from "../../../../../../packages/runtime/src/interop/thread_hypergraph.js";
import type { IconName } from "../data/icons";
import { type WorkflowDiagnostic } from "./workflow-highlighter";
export interface CoordinatorPaneSpec {
    index: number;
    id: string;
    formatLabel: string;
    roleLabel: string;
    fileName: string;
    namespaceFqn: string;
    fqnSyntaxNote: string;
    lang: "sysml" | "modelica" | "xml" | "scad" | "fea" | "cfd" | "step";
    threadDomain: ThreadDomain;
    threadDomainName: string;
    oracleName: string;
    accent: string;
    docLink: string;
    defaultCode: string;
}
export interface CoordinatorPreset {
    id: string;
    label: string;
    description: string;
    isFault: boolean;
    /** Edited pane index and code overrides */
    apply: (defaultCodes: [string, string, string, string]) => {
        codes: [string, string, string, string];
        editedPaneIndex: number;
    };
}
export interface CoordinatorScenario {
    id: string;
    title: string;
    shortTitle: string;
    domain: string;
    accent: string;
    icon: IconName;
    description: string;
    command: string;
    panes: [
        CoordinatorPaneSpec,
        CoordinatorPaneSpec,
        CoordinatorPaneSpec,
        CoordinatorPaneSpec
    ];
    presets: CoordinatorPreset[];
    badges: string[];
}
export interface DomainFqnBinding {
    domainLabel: string;
    fqn: string;
    bindingSyntax: string;
    valueText: string;
}
export interface CoordinatedVariableLink {
    symbol: string;
    canonicalFqn: string;
    bindingMechanism: string;
    label: string;
    valueFormatted: string;
    boundsFormatted: string;
    unit: string;
    sourceDomain: string;
    targetDomains: string[];
    domainBindings: DomainFqnBinding[];
    oracleName: string;
    status: "SAT" | "UNSAT";
    marginText: string;
}
export interface HypergraphNodeStatus {
    paneIndex: number;
    formatLabel: string;
    fileName: string;
    namespaceFqn: string;
    domainName: string;
    oracleName: string;
    status: "SYNCED" | "CONFLICT" | "STALE";
    distanceFromEdit: number;
    accent: string;
}
export interface ExplicitDirectiveLink {
    paneIndex: number;
    fileName: string;
    line: number;
    directiveKind: "@twin" | "@mesh_source" | "@port_map" | "annotation(twin)" | "subject" | "*INCLUDE" | "geometry";
    sourceExpr: string;
    direction: "->" | "<-" | "<->";
    targetExpr: string;
    rawText: string;
}
export interface ExplicitPortBinding {
    portName: string;
    cadPortType: string;
    cadNormal: [number, number, number];
    cadFileName: string;
    cadLine: number;
    caeFileName: string;
    caeTargetKind: "CalculiX *BOUNDARY" | "CalculiX *CLOAD" | "OpenFOAM boundaryField";
    caePatchSpec: string;
    caeLine: number;
    isBound: boolean;
}
export interface EvaluatedEquationRecord {
    paneIndex: number;
    fileName: string;
    language: string;
    lhs: string;
    rhsExpression: string;
    evaluatedValue: number;
    unit: string;
}
export interface ParsedScenarioMetadata {
    directiveLinks: ExplicitDirectiveLink[];
    portBindings: ExplicitPortBinding[];
    evaluatedEquations: EvaluatedEquationRecord[];
    meshSourceSummary: string;
}
export interface Visual3DTriangle {
    v0: [number, number, number];
    v1: [number, number, number];
    v2: [number, number, number];
    normal: [number, number, number];
    tag?: string;
    scalar?: number;
}
export interface CsgTreeNodeSummary {
    id: string;
    kind: string;
    label: string;
    detail: string;
    tag?: string;
    depth: number;
}
export interface SysmlBddVisualData {
    kind: "sysml-bdd";
    packageName: string;
    partName: string;
    partAttributes: {
        name: string;
        value: string;
        unit: string;
        sourceHint: string;
    }[];
    requirementId: string;
    subjectName: string;
    subjectType: string;
    constraints: {
        expression: string;
        actualText: string;
        limitText: string;
        isSat: boolean;
    }[];
}
export interface ModelicaDaeVisualData {
    kind: "modelica-dae";
    withinPkg: string;
    modelName: string;
    parameters: {
        name: string;
        value: string;
        unit: string;
        twinFqn?: string;
    }[];
    equations: {
        lhs: string;
        rhs: string;
        resultText: string;
        twinFqn?: string;
    }[];
}
export interface Scad3DVisualData {
    kind: "scad-3d";
    moduleName: string;
    triangles: Visual3DTriangle[];
    bboxMin: [number, number, number];
    bboxMax: [number, number, number];
    volumeMm3: number;
    surfaceAreaMm2: number;
    computedMassKg?: number;
    hydraulicDiaMm?: number;
    flowAreaMm2?: number;
    ports: {
        portName: string;
        portType: string;
        normal: [number, number, number];
        anchor: [number, number, number];
        boundToCae: boolean;
        caeTarget: string;
    }[];
    csgTree: CsgTreeNodeSummary[];
}
export interface Fea3DVisualData {
    kind: "fea-3d";
    materialName: string;
    youngsModulusGpa: number;
    poissonsRatio: number;
    densityKgM3: number;
    meshSourceFile: string;
    numNodes: number;
    numElements: number;
    minJacobian: number;
    appliedLoadN: number;
    maxVonMisesMpa: number;
    allowableVonMisesMpa: number;
    maxDeflectionMm: number;
    allowableDeflectionMm: number;
    undeformedTriangles: Visual3DTriangle[];
    deformedTriangles: Visual3DTriangle[];
    fixedPinCoords: [number, number, number][];
    loadArrowCoords: {
        origin: [number, number, number];
        dir: [number, number, number];
    }[];
    bboxMin: [number, number, number];
    bboxMax: [number, number, number];
}
export interface Cfd3DVisualData {
    kind: "cfd-3d";
    solverName: string;
    meshSourceFile: string;
    nx: number;
    ny: number;
    nz: number;
    channelCount: number;
    hydraulicDiaMm: number;
    inletFlowLpm: number;
    wallHeatLoadW: number;
    maxVelocityMs: number;
    pressureDropKpa: number;
    maxAllowableDpKpa: number;
    maxSurfaceTempK: number;
    maxAllowableTempK: number;
    cells: {
        ix: number;
        iy: number;
        isSolid: boolean;
        velocityMagMs: number;
        pressureKpa: number;
        tempK: number;
    }[];
    patches: {
        name: string;
        openFoamType: string;
        cadPortType: string;
        isBound: boolean;
        summary: string;
    }[];
}
export interface Urdf3DVisualData {
    kind: "urdf-3d";
    robotName: string;
    links: {
        name: string;
        massKg: number;
    }[];
    joints: {
        name: string;
        type: string;
        parent: string;
        child: string;
        lowerRad: number;
        upperRad: number;
        effortLimitNm: number;
        velocityLimitRadS: number;
        actualTorqueNm: number;
    }[];
    payloadMassKg: number;
    linkReachM: number;
}
export interface StepGdtVisualData {
    kind: "step-gdt";
    fileName: string;
    entityCount: number;
    boreEntityId: string;
    boreNominalMm: number;
    boreTolMm: number;
    shaftEntityId: string;
    shaftNominalMm: number;
    shaftTolMm: number;
    envelopeEntityId: string;
    wcMinMm: number;
    wcMaxMm: number;
    rssMinMm: number;
    rssMaxMm: number;
    allowableMinMm: number;
    allowableMaxMm: number;
    isSat: boolean;
    entities: {
        id: string;
        typeName: string;
        summary: string;
    }[];
}
export type PaneVisualData = SysmlBddVisualData | ModelicaDaeVisualData | Scad3DVisualData | Fea3DVisualData | Cfd3DVisualData | Urdf3DVisualData | StepGdtVisualData;
export interface CoordinatorEvaluationResult {
    status: "SAT" | "UNSAT";
    isSat: boolean;
    elapsedMs: number;
    iterations: number;
    parsedSysmlReqCount: number;
    parsedModelicaTwinCount: number;
    updatedCodes: [string, string, string, string];
    sharedEqualities: SharedEquality[];
    variableLinks: CoordinatedVariableLink[];
    hypergraphNodes: HypergraphNodeStatus[];
    conflicts: ConflictClause[];
    paneDiagnostics: [
        WorkflowDiagnostic[],
        WorkflowDiagnostic[],
        WorkflowDiagnostic[],
        WorkflowDiagnostic[]
    ];
    parsedMetadata: ParsedScenarioMetadata;
    paneVisuals: [PaneVisualData, PaneVisualData, PaneVisualData, PaneVisualData];
    summaryText: string;
}
export declare const COORDINATOR_SCENARIOS: CoordinatorScenario[];
/**
 * Evaluates a 4-pane scenario using `SemanticTheoryCoordinator`, canonical FQN
 * requirement parsers (`parseSysmlRequirements`, `extractModelicaTwinAnnotations`),
 * first-party CAD/CAE evaluators (`evaluateScad`, `computeMeshVolumeAndArea`,
 * `InpDialect`, `OpenFoamDialect`, `evaluateCfdExpression`, `scanStepEntities`,
 * `parseUrdf`, `ToleranceStackVerifier`), domain-specific `TheoryOracle`s, and
 * `DigitalThreadHypergraph`.
 */
export declare function evaluateCoordinatorScenario(scenarioId: string, rawCodes: [string, string, string, string], editedPaneIndex?: number): CoordinatorEvaluationResult;
/**
 * Evaluates a 4-file polyglot digital thread directly from file buffers on disk (used by `msx verify --coordinator`).
 * Automatically maps input files (`.sysml`, `.mo`, `.scad`, `.inp`, `.cfd`, `.urdf`, `.step`) to their domain panes.
 */
export declare function evaluatePolyglotDigitalThreadFromFiles(files: {
    fileName: string;
    content: string;
}[], explicitScenarioId?: string): CoordinatorEvaluationResult & {
    scenarioId: string;
    scenarioTitle: string;
};
//# sourceMappingURL=semantic-coordinator-engine.d.ts.map
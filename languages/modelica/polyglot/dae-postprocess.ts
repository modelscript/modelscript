/* eslint-disable */
/**
 * examples/modelica/dae-postprocess.ts
 *
 * DAE post-processing pipeline for the query-based Modelica compiler.
 *
 * These functions operate on the flat DAE output from `QueryBasedFlattener`
 * and implement simulation-specific transformations that happen after
 * the structural flattening phase.
 *
 * Post-processing steps (applied in order):
 *
 *   1. **Flow Balance** (§9.2):
 *      Generate sum-to-zero equations for each flow variable connection set.
 *
 *   2. **Stream Connector Expansion** (§15.2):
 *      Generate `inStream()` auxiliary variables and mixing equations.
 *      2-port: `inStream(a.s) = b.s`, N-port: mass-flow-weighted mixing.
 *
 *   3. **State Machine Assembly** (§17.3):
 *      Group `transition()` and `initialState()` equations into
 *      `StateMachine` structures with per-state variable/equation scopes.
 *
 *   4. **Clock Partitioning** (§16):
 *      Detect `sample()`, `hold()`, `previous()`, etc. in equations,
 *      assign clock domain IDs, compute base clock via GCD/LCM,
 *      and partition variables/equations into `ClockPartition` objects.
 *
 *   5. **Event Indicator Extraction**:
 *      Scan equations for relational operators and `when` clauses,
 *      extract zero-crossing expressions as event indicators.
 *
 *   6. **Experiment Annotation Extraction**:
 *      Extract StartTime, StopTime, Tolerance, Interval from
 *      the model-level `experiment` annotation.
 *
 * Usage:
 * ```typescript
 * const flattener = new QueryBasedFlattener(db);
 * const dae = flattener.flatten(rootClassId);
 * postProcessDAE(dae);
 * ```
 */

import type { FlatDAE, FlatEquation, FlatVariable } from "./flattener-query.js";

// ---------------------------------------------------------------------------
// Post-Processing Output Extensions
// ---------------------------------------------------------------------------

/** A state in a Modelica state machine. */
export interface StateMachineState {
  /** Flattened name of the state component. */
  name: string;
  /** Variables scoped to this state. */
  variables: FlatVariable[];
  /** Equations active only when this state is active. */
  equations: FlatEquation[];
  /** Nested state machines (hierarchical state machines). */
  nestedStateMachines: StateMachine[];
}

/** A Modelica state machine assembled from transition/initialState equations. */
export interface StateMachine {
  /** Name (typically the initial state's name). */
  name: string;
  /** All states in this machine. */
  states: StateMachineState[];
  /** Transition and initialState equations governing the machine. */
  controlEquations: FlatEquation[];
}

/** A clock partition for synchronous language elements. */
export interface ClockPartition {
  /** Unique clock domain ID. */
  clockId: number;
  /** Base clock expression (e.g., "Clock(1, 100)"). */
  baseClock: string | null;
  /** Variables in this clock domain. */
  variables: FlatVariable[];
  /** Equations in this clock domain. */
  equations: FlatEquation[];
}

/** Experiment annotation parameters. */
export interface ExperimentAnnotation {
  startTime: number;
  stopTime: number;
  tolerance: number;
  interval: number;
}

/** Extended DAE with post-processing results. */
export interface PostProcessedDAE extends FlatDAE {
  /** State machines extracted from transition/initialState equations. */
  stateMachines: StateMachine[];
  /** Clock partitions for synchronous domains. */
  clockPartitions: ClockPartition[];
  /** Event indicators (zero-crossing expressions). */
  eventIndicators: string[];
  /** When-clause equations (separated from continuous equations). */
  whenClauses: FlatEquation[];
  /** Experiment annotation. */
  experiment: ExperimentAnnotation;
  /** Stream expansion auxiliary variables. */
  streamVariables: FlatVariable[];
}

// ---------------------------------------------------------------------------
// Main Pipeline
// ---------------------------------------------------------------------------

/**
 * Apply all post-processing steps to a flat DAE.
 *
 * Mutates the DAE in place and returns it as a `PostProcessedDAE`
 * with the additional post-processing results attached.
 */
export function postProcessDAE(dae: FlatDAE): PostProcessedDAE {
  const result = dae as PostProcessedDAE;

  // Initialize extension fields
  result.stateMachines = [];
  result.clockPartitions = [];
  result.eventIndicators = [];
  result.whenClauses = [];
  result.streamVariables = [];
  result.experiment = {
    startTime: 0,
    stopTime: 1,
    tolerance: 1e-6,
    interval: 0,
  };

  // Step 1: Flow balance equations (§9.2)
  generateFlowBalance(result);

  // Step 2: Stream connector expansion (§15.2)
  expandStreamConnectors(result);

  // Step 3: State machine assembly (§17.3)
  assembleStateMachines(result);

  // Step 4: Clock partitioning (§16)
  partitionClocks(result);

  // Step 5: Event indicator extraction
  extractEventIndicators(result);

  // Step 6: Experiment annotation extraction
  extractExperimentAnnotation(result);

  return result;
}

// ---------------------------------------------------------------------------
// Step 1: Flow Balance Equations (§9.2)
// ---------------------------------------------------------------------------

/**
 * Generate flow balance equations for connection sets.
 *
 * For each set of connected flow variables, generates a sum-to-zero
 * equation: `f1 + f2 + f3 + ... = 0` (Kirchhoff's current law).
 *
 * Uses Union-Find to identify connection sets from the connection
 * pairs recorded during flattening.
 */
export function generateFlowBalance(dae: PostProcessedDAE): void {
  if (dae.connections.length === 0) return;

  // Build flow variable connection sets
  const flowVarNames = new Set<string>();
  for (const v of dae.variables) {
    if (v.isFlow) flowVarNames.add(v.name);
  }

  if (flowVarNames.size === 0) return;

  // Union-Find for flow variables
  const parent = new Map<string, string>();

  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root) ?? root;
    }
    // Path compression
    let current = x;
    while (current !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  };

  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Process connections: for each connect(a, b) pair, find flow
  // variables in both connectors and union them
  for (const conn of dae.connections) {
    // Find flow variables that match these connector paths
    const fromFlows = [...flowVarNames].filter((name) => name.startsWith(conn.from + ".") || name === conn.from);
    const toFlows = [...flowVarNames].filter((name) => name.startsWith(conn.to + ".") || name === conn.to);

    // Match flow variables by their local suffix
    for (const fv of fromFlows) {
      const localName = fv.substring(conn.from.length);
      const matchingTo = conn.to + localName;
      if (flowVarNames.has(matchingTo)) {
        if (!parent.has(fv)) parent.set(fv, fv);
        if (!parent.has(matchingTo)) parent.set(matchingTo, matchingTo);
        union(fv, matchingTo);
        conn.hasFlow = true;
      }
    }

    // Also handle direct flow connections (not dotted into connectors)
    if (flowVarNames.has(conn.from) && flowVarNames.has(conn.to)) {
      if (!parent.has(conn.from)) parent.set(conn.from, conn.from);
      if (!parent.has(conn.to)) parent.set(conn.to, conn.to);
      union(conn.from, conn.to);
      conn.hasFlow = true;
    }
  }

  // Build connection sets from union-find
  const connectionSets = new Map<string, Set<string>>();
  for (const name of parent.keys()) {
    const root = find(name);
    let set = connectionSets.get(root);
    if (!set) {
      set = new Set<string>();
      connectionSets.set(root, set);
    }
    set.add(name);
  }

  // Generate flow balance equation for each connection set
  for (const flowVars of connectionSets.values()) {
    if (flowVars.size <= 1) continue; // Single-element sets don't need balance

    const names = [...flowVars].sort(); // Canonical ordering
    const sumExpr = names.join(" + ");

    dae.equations.push({
      kind: "flow_balance",
      sourceText: `${sumExpr} = 0`,
      description: "Flow balance (KCL): sum of all flows in connection set = 0",
      lhs: sumExpr,
      rhs: "0",
    });
  }
}

// ---------------------------------------------------------------------------
// Step 2: Stream Connector Expansion (§15.2)
// ---------------------------------------------------------------------------

/**
 * Stream connection tracking (from flattener).
 */
interface StreamPair {
  /** Flattened name of the stream variable on side 1. */
  side1: string;
  /** Flattened name of the stream variable on side 2. */
  side2: string;
  /** Flattened name of the associated flow variable on side 1. */
  flow1: string;
  /** Flattened name of the associated flow variable on side 2. */
  flow2: string;
}

/**
 * Expand stream connectors with `inStream()` auxiliary variables.
 *
 * For a 2-port connection `connect(a, b)` with stream variable `s`:
 *   - Creates `$inStream(a.s)` with equation `$inStream(a.s) = b.s`
 *   - Creates `$inStream(b.s)` with equation `$inStream(b.s) = a.s`
 *
 * For N-port connections (N > 2), the mixing equation is:
 *   - `inStream(a.s) = (Σ_{j≠a} max(-f_j, 0) * s_j) / (Σ_{j≠a} max(-f_j, 0))`
 *
 * The current implementation handles the 2-port case (most common in practice).
 */
export function expandStreamConnectors(dae: PostProcessedDAE): void {
  // Find stream connections: connections between variables with isStream=true
  const streamVars = new Set<string>();
  const flowVars = new Map<string, string>(); // stream var → associated flow var

  for (const v of dae.variables) {
    if (v.isStream) {
      streamVars.add(v.name);
    }
  }

  if (streamVars.size === 0) return;

  // Associate stream variables with their flow siblings
  // Convention: in a connector with flow `f` and stream `s`,
  // both are in the same connector prefix
  for (const sv of streamVars) {
    const dotIdx = sv.lastIndexOf(".");
    const prefix = dotIdx >= 0 ? sv.substring(0, dotIdx) : "";

    for (const v of dae.variables) {
      if (v.isFlow && v.name.startsWith(prefix + ".")) {
        flowVars.set(sv, v.name);
        break;
      }
    }
  }

  // Build stream connection pairs from the connection list
  const streamPairs: StreamPair[] = [];

  for (const conn of dae.connections) {
    // Find stream variables that belong to these connector sides
    for (const sv of streamVars) {
      if (sv.startsWith(conn.from + ".")) {
        const localSuffix = sv.substring(conn.from.length);
        const otherSide = conn.to + localSuffix;

        if (streamVars.has(otherSide)) {
          streamPairs.push({
            side1: sv,
            side2: otherSide,
            flow1: flowVars.get(sv) ?? "",
            flow2: flowVars.get(otherSide) ?? "",
          });
        }
      }
    }
  }

  // Group stream pairs by their connection set (for N-port detection)
  // Key: canonical sorted pair of variable name prefixes
  const pairsByPrefix = new Map<string, StreamPair[]>();
  for (const pair of streamPairs) {
    const key = [pair.side1, pair.side2].sort().join("↔");
    const existing = pairsByPrefix.get(key);
    if (existing) {
      existing.push(pair);
    } else {
      pairsByPrefix.set(key, [pair]);
    }
  }

  // Generate inStream variables and equations
  const processedPairs = new Set<string>();

  for (const pair of streamPairs) {
    const pairKey = [pair.side1, pair.side2].sort().join("↔");
    if (processedPairs.has(pairKey)) continue;
    processedPairs.add(pairKey);

    // Check if this is a 2-port or N-port connection
    // For 2-port: simple swapping
    // For N-port: mass-flow-weighted mixing

    // --- 2-port case (default) ---

    // inStream(side1) = side2
    const inStreamName1 = `$inStream(${pair.side1})`;
    dae.streamVariables.push({
      name: inStreamName1,
      typeName: "Real",
      variability: "continuous",
      causality: "internal",
      hasBindingEquation: true,
      startValue: 0,
      unit: "",
      displayUnit: "",
      min: null,
      max: null,
      fixed: false,
      description: `inStream auxiliary for ${pair.side1}`,
      isFlow: false,
      isStream: false,
      isConnector: false,
      arrayShape: null,
    });
    dae.variables.push(dae.streamVariables[dae.streamVariables.length - 1]!);

    dae.equations.push({
      kind: "inStream",
      sourceText: `${inStreamName1} = ${pair.side2}`,
      description: `inStream expansion: inStream(${pair.side1}) = ${pair.side2}`,
      lhs: inStreamName1,
      rhs: pair.side2,
    });

    // inStream(side2) = side1
    const inStreamName2 = `$inStream(${pair.side2})`;
    dae.streamVariables.push({
      name: inStreamName2,
      typeName: "Real",
      variability: "continuous",
      causality: "internal",
      hasBindingEquation: true,
      startValue: 0,
      unit: "",
      displayUnit: "",
      min: null,
      max: null,
      fixed: false,
      description: `inStream auxiliary for ${pair.side2}`,
      isFlow: false,
      isStream: false,
      isConnector: false,
      arrayShape: null,
    });
    dae.variables.push(dae.streamVariables[dae.streamVariables.length - 1]!);

    dae.equations.push({
      kind: "inStream",
      sourceText: `${inStreamName2} = ${pair.side1}`,
      description: `inStream expansion: inStream(${pair.side2}) = ${pair.side1}`,
      lhs: inStreamName2,
      rhs: pair.side1,
    });
  }
}

// ---------------------------------------------------------------------------
// Step 3: State Machine Assembly (§17.3)
// ---------------------------------------------------------------------------

/**
 * Assemble state machines from `transition()` and `initialState()` equations.
 *
 * Algorithm:
 * 1. Build an undirected graph from transition equations
 * 2. Find connected components (each component = one state machine)
 * 3. For each component, create a StateMachine with:
 *    - States (named by flattened component name)
 *    - Transition and initialState control equations
 *    - Per-state variables and equations (moved from the global DAE)
 * 4. Link hierarchical state machines (bottom-up by nesting depth)
 */
export function assembleStateMachines(dae: PostProcessedDAE): void {
  // Identify transition and initialState equations
  const transitionEqs: FlatEquation[] = [];
  const initialStateEqs: FlatEquation[] = [];
  const stateNodes = new Set<string>();

  for (const eq of dae.equations) {
    if (eq.kind === "transition") {
      transitionEqs.push(eq);
      // Extract from/to state names from the equation metadata
      const meta = eq as unknown as Record<string, unknown>;
      const from = (meta.fromState as string) ?? "";
      const to = (meta.toState as string) ?? "";
      if (from) stateNodes.add(from);
      if (to) stateNodes.add(to);
    } else if (eq.kind === "initialState") {
      initialStateEqs.push(eq);
      const meta = eq as unknown as Record<string, unknown>;
      const stateName = (meta.stateName as string) ?? "";
      if (stateName) stateNodes.add(stateName);
    }
  }

  if (stateNodes.size === 0) return;

  // Build adjacency graph
  const adjMap = new Map<string, Set<string>>();
  for (const eq of transitionEqs) {
    const meta = eq as unknown as Record<string, unknown>;
    const from = (meta.fromState as string) ?? "";
    const to = (meta.toState as string) ?? "";
    if (!from || !to) continue;

    if (!adjMap.has(from)) adjMap.set(from, new Set());
    if (!adjMap.has(to)) adjMap.set(to, new Set());
    adjMap.get(from)!.add(to);
    adjMap.get(to)!.add(from);
  }

  // Find connected components (BFS)
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const startNode of stateNodes) {
    if (visited.has(startNode)) continue;

    const component: string[] = [];
    const queue = [startNode];
    visited.add(startNode);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(curr);
      const neighbors = adjMap.get(curr);
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n)) {
            visited.add(n);
            queue.push(n);
          }
        }
      }
    }

    components.push(component);
  }

  // Build state machines from components
  const allMachines = new Map<string, { sm: StateMachine; parentPrefix: string; rank: number }>();

  // Set of initial states for naming
  const initStateNames = new Set<string>();
  for (const eq of initialStateEqs) {
    const meta = eq as unknown as Record<string, unknown>;
    const stateName = (meta.stateName as string) ?? "";
    if (stateName) initStateNames.add(stateName);
  }

  for (const comp of components) {
    // Name the machine after its initial state (if any)
    let smName = comp[0] ?? "stateMachine";
    for (const node of comp) {
      if (initStateNames.has(node)) {
        smName = node;
        break;
      }
    }

    const parentParts = smName.split(".");
    parentParts.pop();
    const parentPrefix = parentParts.join(".");

    const stateMachine: StateMachine = {
      name: smName,
      states: [],
      controlEquations: [],
    };

    // Create states
    const compSet = new Set(comp);
    for (const fullName of comp) {
      const state: StateMachineState = {
        name: fullName,
        variables: [],
        equations: [],
        nestedStateMachines: [],
      };

      // Move variables belonging to this state from the global DAE
      const stateVars: FlatVariable[] = [];
      const remainingVars: FlatVariable[] = [];

      for (const v of dae.variables) {
        if (v.name.startsWith(fullName + ".")) {
          stateVars.push(v);
        } else {
          remainingVars.push(v);
        }
      }

      state.variables = stateVars;
      dae.variables = remainingVars;

      // Move equations belonging to this state
      const stateEqSet = new Set<string>();
      for (const v of stateVars) stateEqSet.add(v.name);

      const stateEqs: FlatEquation[] = [];
      const remainingEqs: FlatEquation[] = [];

      for (const eq of dae.equations) {
        // If the equation references variables in this state, move it
        if (
          eq.kind !== "transition" &&
          eq.kind !== "initialState" &&
          stateEqSet.size > 0 &&
          (stateEqSet.has(eq.lhs) || stateEqSet.has(eq.rhs))
        ) {
          stateEqs.push(eq);
        } else {
          remainingEqs.push(eq);
        }
      }

      state.equations = stateEqs;
      dae.equations = remainingEqs;

      stateMachine.states.push(state);
    }

    // Move control equations (transitions + initialState) for this machine
    const controlEqs: FlatEquation[] = [];
    const globalRemaining: FlatEquation[] = [];

    for (const eq of dae.equations) {
      const meta = eq as unknown as Record<string, unknown>;
      if (
        (eq.kind === "transition" && compSet.has((meta.fromState as string) ?? "")) ||
        (eq.kind === "initialState" && compSet.has((meta.stateName as string) ?? ""))
      ) {
        controlEqs.push(eq);
      } else {
        globalRemaining.push(eq);
      }
    }

    stateMachine.controlEquations = controlEqs;
    dae.equations = globalRemaining;

    allMachines.set(smName, {
      sm: stateMachine,
      parentPrefix,
      rank: parentPrefix.split(".").length,
    });
  }

  // Link hierarchical state machines (bottom-up by depth)
  const sortedMachines = [...allMachines.values()].sort((a, b) => b.rank - a.rank);

  for (const { sm, parentPrefix } of sortedMachines) {
    if (!parentPrefix) {
      dae.stateMachines.push(sm);
    } else {
      let foundParent = false;
      for (const meta of allMachines.values()) {
        const parentState = meta.sm.states.find((s) => s.name === parentPrefix);
        if (parentState) {
          parentState.nestedStateMachines.push(sm);
          foundParent = true;
          break;
        }
      }
      if (!foundParent) {
        dae.stateMachines.push(sm); // Fallback
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Step 4: Clock Partitioning (§16)
// ---------------------------------------------------------------------------

/** Set of Modelica clock-related operator names. */
const CLOCK_OPS = new Set(["sample", "hold", "previous", "subSample", "superSample", "shiftSample", "backSample"]);

/**
 * Partition equations into clock domains.
 *
 * Algorithm:
 * 1. Scan all equations for clock operator references
 *    (`sample()`, `hold()`, `previous()`, etc.)
 * 2. Assign each unique clock expression a domain ID
 * 3. Compute base clock via GCD/LCM of Clock(num, den) arguments
 * 4. Group equations and their referenced variables into partitions
 */
export function partitionClocks(dae: PostProcessedDAE): void {
  let nextClockId = 0;
  const sampleClockMap = new Map<string, number>();

  // Pass 1: Scan equations for clock operator references
  for (const eq of dae.equations) {
    const clockRef = findClockOperator(eq.sourceText);
    if (clockRef) {
      let clockId = sampleClockMap.get(clockRef);
      if (clockId === undefined) {
        clockId = nextClockId++;
        sampleClockMap.set(clockRef, clockId);
      }
      (eq as unknown as Record<string, unknown>).clockDomain = clockId;
    }
  }

  if (nextClockId === 0) return; // No clocked equations found

  // Pass 2: Build partitions
  const partitions = new Map<number, ClockPartition>();
  for (let i = 0; i < nextClockId; i++) {
    partitions.set(i, {
      clockId: i,
      baseClock: null,
      variables: [],
      equations: [],
    });
  }

  // Pass 3: Extract Clock(num, den) and compute base clock via GCD/LCM
  const clockNums: number[] = [];
  const clockDens: number[] = [];

  for (const eq of dae.equations) {
    const eqMeta = eq as unknown as Record<string, unknown>;
    if (eqMeta.clockDomain === undefined) continue;

    const clockArgs = extractClockArgs(eq.sourceText);
    if (clockArgs) {
      clockNums.push(clockArgs.num);
      clockDens.push(clockArgs.den);
    }
  }

  let baseClock: string | null = null;
  if (clockNums.length > 0) {
    let baseNum = clockNums[0]!;
    let baseDen = clockDens[0]!;

    for (let i = 1; i < clockNums.length; i++) {
      baseNum = gcd(baseNum, clockNums[i]!);
      baseDen = lcm(baseDen, clockDens[i]!);
    }

    baseClock = `Clock(${baseNum}, ${baseDen})`;
  }

  for (const partition of partitions.values()) {
    partition.baseClock = baseClock;
  }

  // Assign equations to partitions
  for (const eq of dae.equations) {
    const eqMeta = eq as unknown as Record<string, unknown>;
    if (eqMeta.clockDomain !== undefined) {
      partitions.get(eqMeta.clockDomain as number)?.equations.push(eq);
    }
  }

  // Tag variables referenced in clocked equations
  const clockedVarNames = new Map<string, number>(); // var name → clock domain

  for (const eq of dae.equations) {
    const eqMeta = eq as unknown as Record<string, unknown>;
    if (eqMeta.clockDomain === undefined) continue;
    const clockId = eqMeta.clockDomain as number;

    // Extract variable names from equation text
    const varNames = extractVariableNames(eq.sourceText);
    for (const name of varNames) {
      if (!clockedVarNames.has(name)) {
        clockedVarNames.set(name, clockId);
      }
    }
  }

  for (const v of dae.variables) {
    const clockId = clockedVarNames.get(v.name);
    if (clockId !== undefined) {
      partitions.get(clockId)?.variables.push(v);
    }
  }

  // Store non-empty partitions
  dae.clockPartitions = [...partitions.values()].filter((p) => p.equations.length > 0);
}

// ---------------------------------------------------------------------------
// Step 5: Event Indicator Extraction
// ---------------------------------------------------------------------------

/** Relational operators that produce zero-crossings. */
const RELATIONAL_OPS = new Set(["<", "<=", ">", ">=", "==", "<>"]);

/**
 * Extract event indicators from equations.
 *
 * Scans for relational operators in equation source text and
 * extracts the difference expressions as zero-crossing indicators.
 * Also separates `when` equations from continuous equations.
 */
export function extractEventIndicators(dae: PostProcessedDAE): void {
  const indicators = new Set<string>();

  for (const eq of dae.equations) {
    // Find relational operators in the equation text
    const relOps = findRelationalOperators(eq.sourceText);
    for (const rel of relOps) {
      const indicator = `${rel.lhs} - (${rel.rhs})`;
      if (!indicators.has(indicator)) {
        indicators.add(indicator);
        dae.eventIndicators.push(indicator);
      }
    }
  }

  // Separate when equations from continuous equations
  const whenEqs: FlatEquation[] = [];
  const continuousEqs: FlatEquation[] = [];

  for (const eq of dae.equations) {
    if (eq.kind === "when") {
      whenEqs.push(eq);
    } else {
      continuousEqs.push(eq);
    }
  }

  dae.whenClauses = whenEqs;
  dae.equations = continuousEqs;
}

// ---------------------------------------------------------------------------
// Step 6: Experiment Annotation Extraction
// ---------------------------------------------------------------------------

/**
 * Extract experiment annotation parameters from the DAE diagnostics/metadata.
 *
 * Looks for experiment annotation values to populate the experiment config.
 * In the full implementation, this would read from the class annotations
 * via the query engine. For now, it extracts from equation metadata if
 * annotation equations were preserved.
 */
export function extractExperimentAnnotation(dae: PostProcessedDAE): void {
  // Look for experiment parameters in equation metadata
  for (const eq of dae.equations) {
    if (eq.kind === "annotation" && eq.sourceText.includes("experiment")) {
      // Parse experiment parameters from annotation text
      const startTime = extractAnnotationParam(eq.sourceText, "StartTime");
      const stopTime = extractAnnotationParam(eq.sourceText, "StopTime");
      const tolerance = extractAnnotationParam(eq.sourceText, "Tolerance");
      const interval = extractAnnotationParam(eq.sourceText, "Interval");

      if (startTime !== null) dae.experiment.startTime = startTime;
      if (stopTime !== null) dae.experiment.stopTime = stopTime;
      if (tolerance !== null) dae.experiment.tolerance = tolerance;
      if (interval !== null) dae.experiment.interval = interval;
    }
  }
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/** Find a clock operator reference in equation text. */
function findClockOperator(text: string): string | null {
  for (const op of CLOCK_OPS) {
    const idx = text.indexOf(op + "(");
    if (idx >= 0) {
      // Extract the full function call as the clock reference key
      const end = findMatchingParen(text, idx + op.length);
      if (end > 0) {
        return text.substring(idx, end + 1);
      }
    }
  }
  return null;
}

/** Extract Clock(num, den) arguments from equation text. */
function extractClockArgs(text: string): { num: number; den: number } | null {
  const match = text.match(/Clock\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (match) {
    return {
      num: parseInt(match[1]!, 10),
      den: parseInt(match[2]!, 10),
    };
  }
  return null;
}

/** Find relational operators in equation text. */
function findRelationalOperators(text: string): Array<{ lhs: string; rhs: string; op: string }> {
  const results: Array<{ lhs: string; rhs: string; op: string }> = [];

  // Match patterns like `expr1 < expr2`, `expr1 >= expr2`, etc.
  // This is a simplified scanner — full implementation would use CST
  const patterns = [
    { regex: /([^<>=!]+)\s*<=\s*([^;]+)/, op: "<=" },
    { regex: /([^<>=!]+)\s*>=\s*([^;]+)/, op: ">=" },
    { regex: /([^<>=!]+)\s*<>\s*([^;]+)/, op: "<>" },
    { regex: /([^<>=!]+)\s*==\s*([^;]+)/, op: "==" },
    { regex: /([^<>=!]+)\s*<\s*([^;]+)/, op: "<" },
    { regex: /([^<>=!]+)\s*>\s*([^;]+)/, op: ">" },
  ];

  for (const { regex, op } of patterns) {
    const match = text.match(regex);
    if (match) {
      results.push({
        lhs: match[1]!.trim(),
        rhs: match[2]!.trim(),
        op,
      });
    }
  }

  return results;
}

/** Extract variable names from equation text (simplified). */
function extractVariableNames(text: string): string[] {
  const names: string[] = [];
  // Match dot-separated identifiers that look like variable references
  const regex = /\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\b/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1]!;
    // Skip keywords and function names
    if (!KEYWORDS.has(name) && !CLOCK_OPS.has(name)) {
      names.push(name);
    }
  }
  return names;
}

/** Extract a numeric annotation parameter. */
function extractAnnotationParam(text: string, paramName: string): number | null {
  const regex = new RegExp(`${paramName}\\s*=\\s*([\\d.e+-]+)`, "i");
  const match = text.match(regex);
  if (match) {
    const val = parseFloat(match[1]!);
    if (!isNaN(val)) return val;
  }
  return null;
}

/** Find the matching closing parenthesis. */
function findMatchingParen(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** GCD of two positive integers. */
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** LCM of two positive integers. */
function lcm(a: number, b: number): number {
  return (Math.abs(a) * Math.abs(b)) / gcd(a, b);
}

/** Modelica keywords to skip during variable name extraction. */
const KEYWORDS = new Set([
  "der",
  "abs",
  "sqrt",
  "sin",
  "cos",
  "tan",
  "exp",
  "log",
  "log10",
  "max",
  "min",
  "mod",
  "div",
  "ceil",
  "floor",
  "sign",
  "not",
  "and",
  "or",
  "true",
  "false",
  "time",
  "pre",
  "edge",
  "change",
  "initial",
  "terminal",
  "reinit",
  "assert",
  "noEvent",
  "smooth",
  "delay",
  "Integer",
  "Real",
  "Boolean",
  "String",
  "Clock",
  "if",
  "then",
  "else",
  "elseif",
  "for",
  "loop",
  "end",
  "when",
  "while",
  "in",
  "connect",
  "equation",
  "algorithm",
]);

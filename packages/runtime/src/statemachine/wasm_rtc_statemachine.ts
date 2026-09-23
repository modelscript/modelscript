// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-performance Run-to-Completion (RTC) Hierarchical State Machine Stepper.
 *
 * Implements standard OMG UML / SysML v2 State Machine semantics:
 *   - Hierarchical composite states (nested regions, parent-child trees)
 *   - Run-to-Completion (RTC) step cycle with event queue dispatch
 *   - State lifecycle: entry, do, and exit action callbacks
 *   - Least Common Ancestor (LCA) transition path calculation
 *   - Completion transitions and event-triggered transitions with guards & effects
 *   - Reversible step execution (stepForward, stepBack) for interactive IDE debugging
 */

export type StateId = number;
export type TransitionId = number;

export enum StateKind {
  Initial = 0,
  Simple = 1,
  Composite = 2,
  Final = 3,
}

export interface StateNode {
  id: StateId;
  name: string;
  kind: StateKind;
  parentId?: StateId;
  children: StateId[];
  entryAction?: (context: Record<string, any>) => void;
  doAction?: (context: Record<string, any>) => void;
  exitAction?: (context: Record<string, any>) => void;
}

export interface StateTransition {
  id: TransitionId;
  name?: string;
  sourceId: StateId;
  targetId: StateId;
  /** Trigger event name. If undefined/null, this is a completion transition */
  trigger?: string;
  guard?: (context: Record<string, any>, payload?: any) => boolean;
  effect?: (context: Record<string, any>, payload?: any) => void;
}

export interface StateMachineEvent {
  name: string;
  payload?: any;
}

export interface RTCStepRecord {
  stepIndex: number;
  dispatchedEvent?: StateMachineEvent;
  firedTransitionId?: TransitionId;
  exitedStateIds: StateId[];
  enteredStateIds: StateId[];
  preActiveStates: StateId[];
  postActiveStates: StateId[];
  preContext: Record<string, any>;
  postContext: Record<string, any>;
}

export interface RTCStepResult {
  stepIndex: number;
  firedTransitionId?: TransitionId;
  dispatchedEvent?: StateMachineEvent;
  activeStateNames: string[];
  isCompleted: boolean;
}

export class WasmRtcStateMachine {
  private states: Map<StateId, StateNode> = new Map();
  private transitions: Map<TransitionId, StateTransition> = new Map();
  private stateNameToId: Map<string, StateId> = new Map();

  private nextStateId: StateId = 1;
  private nextTransitionId: TransitionId = 1;

  // Active Execution State
  private activeStateIds: Set<StateId> = new Set();
  private eventQueue: StateMachineEvent[] = [];
  private context: Record<string, any> = {};
  private history: RTCStepRecord[] = [];
  private stepCounter = 0;
  private isTerminated = false;

  /**
   * Registers a state in the state machine hierarchy.
   */
  addState(
    name: string,
    kind: StateKind = StateKind.Simple,
    options?: {
      parentId?: StateId;
      entryAction?: (ctx: Record<string, any>) => void;
      doAction?: (ctx: Record<string, any>) => void;
      exitAction?: (ctx: Record<string, any>) => void;
    },
  ): StateId {
    const id = this.nextStateId++;
    const state: StateNode = {
      id,
      name,
      kind,
      parentId: options?.parentId,
      children: [],
      entryAction: options?.entryAction,
      doAction: options?.doAction,
      exitAction: options?.exitAction,
    };

    this.states.set(id, state);
    this.stateNameToId.set(name, id);

    if (options?.parentId) {
      const parent = this.states.get(options.parentId);
      if (parent) {
        parent.children.push(id);
      }
    }

    return id;
  }

  /**
   * Registers a transition between two states.
   */
  addTransition(
    sourceId: StateId,
    targetId: StateId,
    options?: {
      name?: string;
      trigger?: string;
      guard?: (context: Record<string, any>, payload?: any) => boolean;
      effect?: (context: Record<string, any>, payload?: any) => void;
    },
  ): TransitionId {
    if (!this.states.has(sourceId)) throw new Error(`Source state ID ${sourceId} not found`);
    if (!this.states.has(targetId)) throw new Error(`Target state ID ${targetId} not found`);

    const id = this.nextTransitionId++;
    const transition: StateTransition = {
      id,
      name: options?.name,
      sourceId,
      targetId,
      trigger: options?.trigger,
      guard: options?.guard,
      effect: options?.effect,
    };

    this.transitions.set(id, transition);
    return id;
  }

  getStateId(name: string): StateId | undefined {
    return this.stateNameToId.get(name);
  }

  /**
   * Returns all states registered in this state machine.
   */
  getAllStates(): StateNode[] {
    return Array.from(this.states.values());
  }

  /**
   * Returns all transitions registered in this state machine.
   */
  getAllTransitions(): StateTransition[] {
    return Array.from(this.transitions.values());
  }

  /**
   * Posts an event to the state machine's event queue.
   */
  postEvent(name: string, payload?: any): void {
    this.eventQueue.push({ name, payload });
  }

  /**
   * Initializes the state machine and enters the root initial state.
   */
  init(initialContext: Record<string, any> = {}): void {
    this.context = { ...initialContext };
    this.activeStateIds.clear();
    this.eventQueue = [];
    this.history = [];
    this.stepCounter = 0;
    this.isTerminated = false;

    // Find top-level initial state (no parentId)
    const rootInitial = Array.from(this.states.values()).find((s) => s.kind === StateKind.Initial && !s.parentId);

    if (rootInitial) {
      this.enterState(rootInitial.id);
      // Auto-fire initial transition if one exists
      const initTrans = Array.from(this.transitions.values()).find((t) => t.sourceId === rootInitial.id);
      if (initTrans) {
        this.fireTransition(initTrans);
      }
    }
  }

  /**
   * Returns current active state names.
   */
  getActiveStateNames(): string[] {
    return Array.from(this.activeStateIds)
      .map((id) => this.states.get(id)?.name || "")
      .filter(Boolean);
  }

  getContext(): Record<string, any> {
    return { ...this.context };
  }

  isFinished(): boolean {
    if (this.isTerminated) return true;
    for (const id of this.activeStateIds) {
      const state = this.states.get(id);
      if (state && state.kind === StateKind.Final) return true;
    }
    return false;
  }

  /**
   * Executes a single Run-to-Completion (RTC) cycle.
   */
  step(): RTCStepResult {
    if (this.isFinished()) {
      return {
        stepIndex: this.stepCounter,
        activeStateNames: this.getActiveStateNames(),
        isCompleted: true,
      };
    }

    const preActiveStates = Array.from(this.activeStateIds);
    const preContext = { ...this.context };

    // 1. Check for completion transitions (trigger === undefined) from innermost active states
    let chosenTransition: StateTransition | undefined;
    let dispatchedEvent: StateMachineEvent | undefined;

    for (const stateId of this.activeStateIds) {
      const trans = Array.from(this.transitions.values()).find(
        (t) => t.sourceId === stateId && !t.trigger && (!t.guard || t.guard(this.context)),
      );
      if (trans) {
        chosenTransition = trans;
        break;
      }
    }

    // 2. If no completion transition, dequeue next event
    if (!chosenTransition && this.eventQueue.length > 0) {
      dispatchedEvent = this.eventQueue.shift()!;

      // Find matching transition from active states (innermost first)
      for (const stateId of this.activeStateIds) {
        const trans = Array.from(this.transitions.values()).find(
          (t) =>
            t.sourceId === stateId &&
            t.trigger === dispatchedEvent!.name &&
            (!t.guard || t.guard(this.context, dispatchedEvent!.payload)),
        );
        if (trans) {
          chosenTransition = trans;
          break;
        }
      }
    }

    if (!chosenTransition) {
      // No transition fired
      return {
        stepIndex: this.stepCounter,
        activeStateNames: this.getActiveStateNames(),
        isCompleted: this.isFinished(),
      };
    }

    // 3. Fire the chosen transition
    const { exitedStateIds, enteredStateIds } = this.fireTransition(chosenTransition, dispatchedEvent?.payload);

    this.stepCounter++;
    const postActiveStates = Array.from(this.activeStateIds);
    const postContext = { ...this.context };

    this.history.push({
      stepIndex: this.stepCounter,
      dispatchedEvent,
      firedTransitionId: chosenTransition.id,
      exitedStateIds,
      enteredStateIds,
      preActiveStates,
      postActiveStates,
      preContext,
      postContext,
    });

    return {
      stepIndex: this.stepCounter,
      firedTransitionId: chosenTransition.id,
      dispatchedEvent,
      activeStateNames: this.getActiveStateNames(),
      isCompleted: this.isFinished(),
    };
  }

  /**
   * Reversible time-travel step back.
   */
  stepBack(): boolean {
    if (this.history.length === 0) return false;

    const last = this.history.pop()!;
    this.activeStateIds = new Set(last.preActiveStates);
    this.context = { ...last.preContext };
    if (last.dispatchedEvent) {
      this.eventQueue.unshift(last.dispatchedEvent);
    }
    this.stepCounter = last.stepIndex - 1;
    this.isTerminated = false;

    return true;
  }

  /**
   * Runs until event queue is empty and no completion transitions exist (or maxCycles).
   */
  run(maxCycles = 100): number {
    let cycles = 0;
    while (!this.isFinished() && cycles < maxCycles) {
      const hasCompletion = Array.from(this.activeStateIds).some((stateId) =>
        Array.from(this.transitions.values()).some(
          (t) => t.sourceId === stateId && !t.trigger && (!t.guard || t.guard(this.context)),
        ),
      );

      if (!hasCompletion && this.eventQueue.length === 0) break;

      this.step();
      cycles++;
    }
    return cycles;
  }

  /**
   * Fires a transition: computes LCA, calls exit actions, executes effect, calls entry actions.
   */
  private fireTransition(
    transition: StateTransition,
    payload?: any,
  ): { exitedStateIds: StateId[]; enteredStateIds: StateId[] } {
    const exitedStateIds: StateId[] = [];
    const enteredStateIds: StateId[] = [];

    const source = this.states.get(transition.sourceId)!;
    const target = this.states.get(transition.targetId)!;

    const lca = this.findLCA(source.id, target.id);

    // 1. Exit from active states up to LCA
    const toExit: StateId[] = [];
    for (const activeId of this.activeStateIds) {
      let curr: StateId | undefined = activeId;
      while (curr !== undefined && curr !== lca) {
        if (!toExit.includes(curr)) toExit.push(curr);
        curr = this.states.get(curr)?.parentId;
      }
    }

    // Sort toExit by depth descending (innermost child states exit first)
    toExit.sort((a, b) => this.getDepth(b) - this.getDepth(a));

    // Call exit actions (innermost first)
    for (const stateId of toExit) {
      const s = this.states.get(stateId);
      if (s?.exitAction) s.exitAction(this.context);
      this.activeStateIds.delete(stateId);
      exitedStateIds.push(stateId);
    }

    // 2. Execute transition effect
    if (transition.effect) {
      transition.effect(this.context, payload);
    }

    // 3. Enter states from LCA down to target
    const toEnter: StateId[] = [];
    let curr: StateId | undefined = target.id;
    while (curr !== undefined && curr !== lca) {
      toEnter.unshift(curr);
      curr = this.states.get(curr)?.parentId;
    }

    // Sort toEnter by depth ascending (ancestors enter before child sub-states)
    toEnter.sort((a, b) => this.getDepth(a) - this.getDepth(b));

    for (const stateId of toEnter) {
      const s = this.states.get(stateId);
      if (s?.entryAction) s.entryAction(this.context);
      this.activeStateIds.add(stateId);
      enteredStateIds.push(stateId);
      if (s?.doAction) s.doAction(this.context);
    }

    // 4. If target is composite, enter its child initial state
    if (target.kind === StateKind.Composite) {
      const childInitial = target.children
        .map((cid) => this.states.get(cid)!)
        .find((s) => s.kind === StateKind.Initial);

      if (childInitial) {
        this.enterState(childInitial.id);
        enteredStateIds.push(childInitial.id);

        const childInitTrans = Array.from(this.transitions.values()).find((t) => t.sourceId === childInitial.id);
        if (childInitTrans) {
          const nested = this.fireTransition(childInitTrans, payload);
          exitedStateIds.push(...nested.exitedStateIds);
          enteredStateIds.push(...nested.enteredStateIds);
        }
      }
    }

    return { exitedStateIds, enteredStateIds };
  }

  private enterState(stateId: StateId): void {
    const s = this.states.get(stateId);
    if (!s) return;
    if (s.entryAction) s.entryAction(this.context);
    this.activeStateIds.add(stateId);
    if (s.doAction) s.doAction(this.context);
  }

  /**
   * Computes the Least Common Ancestor state ID of two states.
   */
  private findLCA(s1: StateId, s2: StateId): StateId | undefined {
    const ancestors1 = new Set<StateId>();
    let curr: StateId | undefined = s1;
    while (curr !== undefined) {
      curr = this.states.get(curr)?.parentId;
      if (curr !== undefined) ancestors1.add(curr);
    }

    curr = s2;
    while (curr !== undefined) {
      curr = this.states.get(curr)?.parentId;
      if (curr !== undefined && ancestors1.has(curr)) return curr;
    }

    return undefined;
  }

  private getDepth(stateId: StateId): number {
    let depth = 0;
    let curr = this.states.get(stateId)?.parentId;
    while (curr !== undefined) {
      depth++;
      curr = this.states.get(curr)?.parentId;
    }
    return depth;
  }
}

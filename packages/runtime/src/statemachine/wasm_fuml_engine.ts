// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-performance Discrete fUML Token & Activity Stepper Engine.
 *
 * Implements standard OMG fUML (Semantics of a Foundational Subset for Executable UML Models)
 * and KerML / SysML v2 discrete action and activity execution semantics:
 *   - Control & Object Token flows over an integer-indexed activity graph
 *   - Petri-net marking representation (multi-set token placement)
 *   - Structured control nodes (Decision, Merge, Fork, Join, Initial, ActivityFinal, FlowFinal)
 *   - Input / Output Pins with typed object token buffering and data routing
 *   - Reversible step execution (stepForward, stepBack, run, pause) for interactive IDE debugging
 */

export type NodeId = number;
export type EdgeId = number;
export type PinId = number;
export type TokenId = number;

export enum ActivityNodeKind {
  Initial = 0,
  Action = 1,
  Decision = 2,
  Merge = 3,
  Fork = 4,
  Join = 5,
  ActivityFinal = 6,
  FlowFinal = 7,
}

export enum PinDirection {
  Input = 0,
  Output = 1,
}

export enum ActivityEdgeKind {
  Control = 0,
  Object = 1,
}

export interface ActivityPin {
  id: PinId;
  nodeId: NodeId;
  name: string;
  direction: PinDirection;
  type?: string;
}

export interface ActivityNode {
  id: NodeId;
  name: string;
  kind: ActivityNodeKind;
  incomingEdges: EdgeId[];
  outgoingEdges: EdgeId[];
  inputPins: PinId[];
  outputPins: PinId[];
  /** Optional behavior executed when an Action node fires */
  behavior?: (inputs: Record<string, any>, context: Record<string, any>) => Record<string, any> | undefined;
}

export interface ActivityEdge {
  id: EdgeId;
  name?: string;
  kind: ActivityEdgeKind;
  sourceNodeId: NodeId;
  targetNodeId: NodeId;
  sourcePinId?: PinId;
  targetPinId?: PinId;
  /** Optional guard condition for decision routing */
  guard?: (context: Record<string, any>, tokenValue?: any) => boolean;
}

export interface Token {
  id: TokenId;
  kind: "control" | "object";
  value?: any;
}

export interface SerializedMarking {
  edgeTokens: Record<EdgeId, Token[]>;
  pinTokens: Record<PinId, Token[]>;
  nodeTokens: Record<NodeId, Token[]>;
}

export interface StepRecord {
  stepIndex: number;
  firedNodes: { nodeId: NodeId; nodeName: string; kind: ActivityNodeKind }[];
  tokensMoved: {
    tokenId: TokenId;
    kind: "control" | "object";
    value?: any;
    from?: string;
    to?: string;
  }[];
  preMarking: SerializedMarking;
  preVariables: Record<string, any>;
  postVariables: Record<string, any>;
}

export interface StepResult {
  stepIndex: number;
  firedNodeIds: NodeId[];
  isCompleted: boolean;
  isTerminated: boolean;
  activeTokenCount: number;
}

export interface ExecutionSummary {
  totalSteps: number;
  status: "completed" | "terminated" | "suspended" | "max_steps_reached";
  finalVariables: Record<string, any>;
  historyLength: number;
}

export class WasmFumlEngine {
  private nodes: Map<NodeId, ActivityNode> = new Map();
  private edges: Map<EdgeId, ActivityEdge> = new Map();
  private pins: Map<PinId, ActivityPin> = new Map();

  private nodeNameToId: Map<string, NodeId> = new Map();
  private pinNameToId: Map<string, PinId> = new Map();

  private nextNodeId: NodeId = 1;
  private nextEdgeId: EdgeId = 1;
  private nextPinId: PinId = 1;
  private nextTokenId: TokenId = 1;

  // Active Execution State
  private edgeTokens: Map<EdgeId, Token[]> = new Map();
  private pinTokens: Map<PinId, Token[]> = new Map();
  private nodeTokens: Map<NodeId, Token[]> = new Map();

  private variables: Record<string, any> = {};
  private history: StepRecord[] = [];
  private stepCounter = 0;
  private status: "ready" | "running" | "suspended" | "completed" | "terminated" = "ready";

  /**
   * Registers an activity node in the execution graph.
   */
  addNode(
    name: string,
    kind: ActivityNodeKind,
    behavior?: (inputs: Record<string, any>, ctx: Record<string, any>) => Record<string, any> | undefined,
  ): NodeId {
    const id = this.nextNodeId++;
    const node: ActivityNode = {
      id,
      name,
      kind,
      incomingEdges: [],
      outgoingEdges: [],
      inputPins: [],
      outputPins: [],
      behavior,
    };
    this.nodes.set(id, node);
    this.nodeNameToId.set(name, id);
    return id;
  }

  /**
   * Adds an Input or Output Pin to an existing Action node.
   */
  addPin(nodeId: NodeId, name: string, direction: PinDirection, type?: string): PinId {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Node ID ${nodeId} not found`);

    const id = this.nextPinId++;
    const pin: ActivityPin = {
      id,
      nodeId,
      name,
      direction,
      type,
    };
    this.pins.set(id, pin);
    this.pinNameToId.set(`${node.name}.${name}`, id);

    if (direction === PinDirection.Input) {
      node.inputPins.push(id);
    } else {
      node.outputPins.push(id);
    }

    return id;
  }

  /**
   * Connects two nodes or pins with an activity edge (control or object flow).
   */
  addEdge(
    sourceNodeId: NodeId,
    targetNodeId: NodeId,
    kind: ActivityEdgeKind = ActivityEdgeKind.Control,
    options?: {
      name?: string;
      sourcePinId?: PinId;
      targetPinId?: PinId;
      guard?: (context: Record<string, any>, tokenValue?: any) => boolean;
    },
  ): EdgeId {
    const sourceNode = this.nodes.get(sourceNodeId);
    const targetNode = this.nodes.get(targetNodeId);
    if (!sourceNode) throw new Error(`Source Node ID ${sourceNodeId} not found`);
    if (!targetNode) throw new Error(`Target Node ID ${targetNodeId} not found`);

    const id = this.nextEdgeId++;
    const edge: ActivityEdge = {
      id,
      name: options?.name,
      kind,
      sourceNodeId,
      targetNodeId,
      sourcePinId: options?.sourcePinId,
      targetPinId: options?.targetPinId,
      guard: options?.guard,
    };

    this.edges.set(id, edge);
    sourceNode.outgoingEdges.push(id);
    targetNode.incomingEdges.push(id);

    return id;
  }

  /**
   * Convenience lookup by name.
   */
  getNodeId(name: string): NodeId | undefined {
    return this.nodeNameToId.get(name);
  }

  getNode(id: NodeId): ActivityNode | undefined {
    return this.nodes.get(id);
  }

  getEdge(id: EdgeId): ActivityEdge | undefined {
    return this.edges.get(id);
  }

  getPinId(qualifiedName: string): PinId | undefined {
    return this.pinNameToId.get(qualifiedName);
  }

  /**
   * Initializes the engine state and places initial tokens.
   */
  init(initialVariables: Record<string, any> = {}): void {
    this.variables = { ...initialVariables };
    this.edgeTokens.clear();
    this.pinTokens.clear();
    this.nodeTokens.clear();
    this.history = [];
    this.stepCounter = 0;
    this.status = "ready";

    // Place initial control token at every Initial node
    for (const node of this.nodes.values()) {
      if (node.kind === ActivityNodeKind.Initial) {
        const token: Token = {
          id: this.nextTokenId++,
          kind: "control",
        };
        this.nodeTokens.set(node.id, [token]);
      }
    }
  }

  /**
   * Checks if the activity execution has terminated or completed.
   */
  isFinished(): boolean {
    return this.status === "completed" || this.status === "terminated";
  }

  /**
   * Returns current active execution status.
   */
  getStatus(): "ready" | "running" | "suspended" | "completed" | "terminated" {
    return this.status;
  }

  /**
   * Returns all nodes currently enabled to fire.
   */
  getEnabledNodes(): NodeId[] {
    if (this.isFinished()) return [];
    const enabled: NodeId[] = [];

    for (const node of this.nodes.values()) {
      if (this.isNodeEnabled(node)) {
        enabled.push(node.id);
      }
    }

    return enabled;
  }

  /**
   * Executes a single discrete step across all currently enabled nodes.
   */
  step(): StepResult {
    if (this.isFinished()) {
      return {
        stepIndex: this.stepCounter,
        firedNodeIds: [],
        isCompleted: this.status === "completed",
        isTerminated: this.status === "terminated",
        activeTokenCount: this.countActiveTokens(),
      };
    }

    this.status = "running";
    const preMarking = this.serializeMarking();
    const preVariables = { ...this.variables };

    const enabledNodeIds = this.getEnabledNodes();
    if (enabledNodeIds.length === 0) {
      // Deadlock or natural completion
      if (this.countActiveTokens() === 0) {
        this.status = "completed";
      } else {
        this.status = "suspended";
      }

      return {
        stepIndex: this.stepCounter,
        firedNodeIds: [],
        isCompleted: this.status === "completed",
        isTerminated: false,
        activeTokenCount: this.countActiveTokens(),
      };
    }

    const firedNodeIds: NodeId[] = [];
    const firedNodesMeta: { nodeId: NodeId; nodeName: string; kind: ActivityNodeKind }[] = [];
    const tokensMoved: StepRecord["tokensMoved"] = [];

    for (const nodeId of enabledNodeIds) {
      const node = this.nodes.get(nodeId);
      if (!node) continue;

      // Re-verify enabled in case a previous node in the same step consumed shared tokens
      if (!this.isNodeEnabled(node)) continue;

      this.fireNode(node, tokensMoved);
      firedNodeIds.push(node.id);
      firedNodesMeta.push({ nodeId: node.id, nodeName: node.name, kind: node.kind });

      if ((this.status as string) === "completed" || (this.status as string) === "terminated") {
        break;
      }
    }

    this.stepCounter++;
    const postVariables = { ...this.variables };

    this.history.push({
      stepIndex: this.stepCounter,
      firedNodes: firedNodesMeta,
      tokensMoved,
      preMarking,
      preVariables,
      postVariables,
    });

    if (this.countActiveTokens() === 0 && (this.status as string) !== "terminated") {
      this.status = "completed";
    }

    return {
      stepIndex: this.stepCounter,
      firedNodeIds,
      isCompleted: this.status === "completed",
      isTerminated: (this.status as string) === "terminated",
      activeTokenCount: this.countActiveTokens(),
    };
  }

  /**
   * Alias for step() forward.
   */
  stepForward(): StepResult {
    return this.step();
  }

  /**
   * Returns a serialized snapshot of all active tokens in the activity graph.
   */
  getSerializedMarking(): SerializedMarking {
    return this.serializeMarking();
  }

  /**
   * Steps back one discrete step in execution history (interactive time-travel debugging).
   */
  stepBack(): boolean {
    if (this.history.length === 0) return false;

    const lastRecord = this.history.pop()!;
    this.restoreMarking(lastRecord.preMarking);
    this.variables = { ...lastRecord.preVariables };
    this.stepCounter = lastRecord.stepIndex - 1;
    this.status = "suspended";

    return true;
  }

  /**
   * Runs the activity to completion or until maxSteps is reached.
   */
  run(maxSteps = 1000): ExecutionSummary {
    let steps = 0;
    while (!this.isFinished() && steps < maxSteps) {
      const res = this.step();
      if (res.firedNodeIds.length === 0) break;
      steps++;
    }

    return {
      totalSteps: this.stepCounter,
      status:
        this.status === "completed"
          ? "completed"
          : this.status === "terminated"
            ? "terminated"
            : steps >= maxSteps
              ? "max_steps_reached"
              : "suspended",
      finalVariables: { ...this.variables },
      historyLength: this.history.length,
    };
  }

  /**
   * Retrieves current variables context.
   */
  getVariables(): Record<string, any> {
    return { ...this.variables };
  }

  /**
   * Retrieves step history.
   */
  getHistory(): readonly StepRecord[] {
    return this.history;
  }

  /**
   * Checks if an individual node is currently enabled.
   */
  private isNodeEnabled(node: ActivityNode): boolean {
    switch (node.kind) {
      case ActivityNodeKind.Initial: {
        const tokens = this.nodeTokens.get(node.id);
        return Boolean(tokens && tokens.length > 0);
      }

      case ActivityNodeKind.Action: {
        // Control flow: all incoming control edges must have a token (join semantics)
        const controlEdges = node.incomingEdges
          .map((id) => this.edges.get(id)!)
          .filter((e) => e.kind === ActivityEdgeKind.Control);

        for (const edge of controlEdges) {
          const tokens = this.edgeTokens.get(edge.id);
          if (!tokens || tokens.length === 0) return false;
        }

        // Object flow: all input pins with incoming object flows must have a token buffered or available on incoming edge
        for (const pinId of node.inputPins) {
          const pinBuffered = this.pinTokens.get(pinId);
          if (pinBuffered && pinBuffered.length > 0) continue;

          // Check incoming edges connected to this pin
          const pinEdges = node.incomingEdges.map((id) => this.edges.get(id)!).filter((e) => e.targetPinId === pinId);

          if (pinEdges.length > 0) {
            const hasEdgeToken = pinEdges.some((e) => {
              const toks = this.edgeTokens.get(e.id);
              return toks && toks.length > 0;
            });
            if (!hasEdgeToken) return false;
          }
        }

        // If no incoming control edges and no incoming pins, action is not self-starting unless it's the root
        if (controlEdges.length === 0 && node.inputPins.length === 0 && node.incomingEdges.length > 0) {
          return false;
        }

        return true;
      }

      case ActivityNodeKind.Decision: {
        // Enabled if incoming edge has a token, and at least one outgoing guard evaluates to true
        for (const edgeId of node.incomingEdges) {
          const toks = this.edgeTokens.get(edgeId);
          if (toks && toks.length > 0) {
            const token = toks[0];
            const hasPassingGuard = node.outgoingEdges.some((outEdgeId) => {
              const outEdge = this.edges.get(outEdgeId)!;
              return !outEdge.guard || outEdge.guard(this.variables, token.value);
            });
            if (hasPassingGuard) return true;
          }
        }
        return false;
      }

      case ActivityNodeKind.Merge: {
        // Enabled when ANY incoming edge has a token
        return node.incomingEdges.some((edgeId) => {
          const toks = this.edgeTokens.get(edgeId);
          return toks && toks.length > 0;
        });
      }

      case ActivityNodeKind.Fork: {
        // Enabled when incoming edge has a token
        return node.incomingEdges.some((edgeId) => {
          const toks = this.edgeTokens.get(edgeId);
          return toks && toks.length > 0;
        });
      }

      case ActivityNodeKind.Join: {
        // Enabled when ALL incoming edges have at least one token
        if (node.incomingEdges.length === 0) return false;
        return node.incomingEdges.every((edgeId) => {
          const toks = this.edgeTokens.get(edgeId);
          return toks && toks.length > 0;
        });
      }

      case ActivityNodeKind.ActivityFinal:
      case ActivityNodeKind.FlowFinal: {
        return node.incomingEdges.some((edgeId) => {
          const toks = this.edgeTokens.get(edgeId);
          return toks && toks.length > 0;
        });
      }

      default:
        return false;
    }
  }

  /**
   * Fires an enabled node, consuming tokens and emitting outputs.
   */
  private fireNode(node: ActivityNode, tokensMoved: StepRecord["tokensMoved"]): void {
    switch (node.kind) {
      case ActivityNodeKind.Initial: {
        // Consume initial token
        const tokens = this.nodeTokens.get(node.id) || [];
        const token = tokens.shift();
        if (tokens.length === 0) this.nodeTokens.delete(node.id);

        // Emit control token along all outgoing edges
        for (const edgeId of node.outgoingEdges) {
          const outTok: Token = { id: this.nextTokenId++, kind: "control" };
          this.pushEdgeToken(edgeId, outTok);
          tokensMoved.push({
            tokenId: outTok.id,
            kind: "control",
            from: `node:${node.name}`,
            to: `edge:${edgeId}`,
          });
        }
        break;
      }

      case ActivityNodeKind.Action: {
        // 1. Consume control tokens from incoming control edges
        const controlEdges = node.incomingEdges
          .map((id) => this.edges.get(id)!)
          .filter((e) => e.kind === ActivityEdgeKind.Control);

        for (const edge of controlEdges) {
          const toks = this.edgeTokens.get(edge.id);
          if (toks && toks.length > 0) {
            const consumed = toks.shift()!;
            if (toks.length === 0) this.edgeTokens.delete(edge.id);
            tokensMoved.push({
              tokenId: consumed.id,
              kind: consumed.kind,
              from: `edge:${edge.id}`,
              to: `node:${node.name}`,
            });
          }
        }

        // 2. Consume object tokens from input pins
        const inputs: Record<string, any> = {};
        for (const pinId of node.inputPins) {
          const pin = this.pins.get(pinId)!;
          let token: Token | undefined;

          // Check buffer
          const buf = this.pinTokens.get(pinId);
          if (buf && buf.length > 0) {
            token = buf.shift();
            if (buf.length === 0) this.pinTokens.delete(pinId);
          } else {
            // Check incoming edges
            const inEdges = node.incomingEdges.map((id) => this.edges.get(id)!).filter((e) => e.targetPinId === pinId);
            for (const edge of inEdges) {
              const toks = this.edgeTokens.get(edge.id);
              if (toks && toks.length > 0) {
                token = toks.shift();
                if (toks.length === 0) this.edgeTokens.delete(edge.id);
                break;
              }
            }
          }

          if (token) {
            inputs[pin.name] = token.value;
            tokensMoved.push({
              tokenId: token.id,
              kind: "object",
              value: token.value,
              from: `pin:${pin.name}`,
              to: `node:${node.name}`,
            });
          }
        }

        // 3. Execute behavior
        let outputs: Record<string, any> | undefined;
        if (node.behavior) {
          outputs = node.behavior(inputs, this.variables);
        }

        // 4. Emit output tokens on output pins
        if (outputs && typeof outputs === "object") {
          for (const pinId of node.outputPins) {
            const pin = this.pins.get(pinId)!;
            if (pin.name in outputs) {
              const val = outputs[pin.name];
              const outToken: Token = {
                id: this.nextTokenId++,
                kind: "object",
                value: val,
              };

              // Route directly to connected outgoing object edges
              const outEdges = node.outgoingEdges
                .map((id) => this.edges.get(id)!)
                .filter((e) => e.sourcePinId === pinId);

              if (outEdges.length > 0) {
                for (const edge of outEdges) {
                  this.pushEdgeToken(edge.id, outToken);
                  tokensMoved.push({
                    tokenId: outToken.id,
                    kind: "object",
                    value: val,
                    from: `pin:${pin.name}`,
                    to: `edge:${edge.id}`,
                  });
                }
              } else {
                // Buffer at output pin
                this.pushPinToken(pinId, outToken);
              }
            }
          }
        }

        // 5. Emit control token along outgoing control edges
        const outgoingControlEdges = node.outgoingEdges
          .map((id) => this.edges.get(id)!)
          .filter((e) => e.kind === ActivityEdgeKind.Control);

        for (const edge of outgoingControlEdges) {
          const outTok: Token = { id: this.nextTokenId++, kind: "control" };
          this.pushEdgeToken(edge.id, outTok);
          tokensMoved.push({
            tokenId: outTok.id,
            kind: "control",
            from: `node:${node.name}`,
            to: `edge:${edge.id}`,
          });
        }
        break;
      }

      case ActivityNodeKind.Decision: {
        // Consume token from incoming edge
        let token: Token | undefined;
        let incomingEdgeId: EdgeId | undefined;
        for (const edgeId of node.incomingEdges) {
          const toks = this.edgeTokens.get(edgeId);
          if (toks && toks.length > 0) {
            token = toks.shift()!;
            if (toks.length === 0) this.edgeTokens.delete(edgeId);
            incomingEdgeId = edgeId;
            break;
          }
        }

        if (!token) break;
        tokensMoved.push({
          tokenId: token.id,
          kind: token.kind,
          from: `edge:${incomingEdgeId}`,
          to: `node:${node.name}`,
        });

        // Find first outgoing edge with true guard
        let chosenEdgeId: EdgeId | undefined;
        for (const outEdgeId of node.outgoingEdges) {
          const outEdge = this.edges.get(outEdgeId)!;
          if (!outEdge.guard || outEdge.guard(this.variables, token.value)) {
            chosenEdgeId = outEdgeId;
            break;
          }
        }

        if (chosenEdgeId !== undefined) {
          this.pushEdgeToken(chosenEdgeId, token);
          tokensMoved.push({
            tokenId: token.id,
            kind: token.kind,
            value: token.value,
            from: `node:${node.name}`,
            to: `edge:${chosenEdgeId}`,
          });
        }
        break;
      }

      case ActivityNodeKind.Merge: {
        // Consume token from first ready incoming edge and push to outgoing edge
        for (const inEdgeId of node.incomingEdges) {
          const toks = this.edgeTokens.get(inEdgeId);
          if (toks && toks.length > 0) {
            const token = toks.shift()!;
            if (toks.length === 0) this.edgeTokens.delete(inEdgeId);

            for (const outEdgeId of node.outgoingEdges) {
              this.pushEdgeToken(outEdgeId, token);
              tokensMoved.push({
                tokenId: token.id,
                kind: token.kind,
                value: token.value,
                from: `edge:${inEdgeId}`,
                to: `edge:${outEdgeId}`,
              });
            }
            break;
          }
        }
        break;
      }

      case ActivityNodeKind.Fork: {
        // Duplicate token to all outgoing edges
        for (const inEdgeId of node.incomingEdges) {
          const toks = this.edgeTokens.get(inEdgeId);
          if (toks && toks.length > 0) {
            const origToken = toks.shift()!;
            if (toks.length === 0) this.edgeTokens.delete(inEdgeId);

            for (const outEdgeId of node.outgoingEdges) {
              const dupToken: Token = {
                id: this.nextTokenId++,
                kind: origToken.kind,
                value: origToken.value,
              };
              this.pushEdgeToken(outEdgeId, dupToken);
              tokensMoved.push({
                tokenId: dupToken.id,
                kind: dupToken.kind,
                value: dupToken.value,
                from: `node:${node.name}`,
                to: `edge:${outEdgeId}`,
              });
            }
            break;
          }
        }
        break;
      }

      case ActivityNodeKind.Join: {
        // Consume one token from each incoming edge
        for (const inEdgeId of node.incomingEdges) {
          const toks = this.edgeTokens.get(inEdgeId);
          if (toks && toks.length > 0) {
            const tok = toks.shift()!;
            if (toks.length === 0) this.edgeTokens.delete(inEdgeId);
            tokensMoved.push({
              tokenId: tok.id,
              kind: tok.kind,
              from: `edge:${inEdgeId}`,
              to: `node:${node.name}`,
            });
          }
        }

        // Emit single synchronized control token on outgoing edge
        for (const outEdgeId of node.outgoingEdges) {
          const syncToken: Token = { id: this.nextTokenId++, kind: "control" };
          this.pushEdgeToken(outEdgeId, syncToken);
          tokensMoved.push({
            tokenId: syncToken.id,
            kind: "control",
            from: `node:${node.name}`,
            to: `edge:${outEdgeId}`,
          });
        }
        break;
      }

      case ActivityNodeKind.ActivityFinal: {
        // Clear all active tokens everywhere, mark complete
        for (const inEdgeId of node.incomingEdges) {
          const toks = this.edgeTokens.get(inEdgeId);
          if (toks && toks.length > 0) {
            const tok = toks.shift()!;
            tokensMoved.push({
              tokenId: tok.id,
              kind: tok.kind,
              from: `edge:${inEdgeId}`,
              to: `node:${node.name}`,
            });
            break;
          }
        }
        this.edgeTokens.clear();
        this.pinTokens.clear();
        this.nodeTokens.clear();
        this.status = "completed";
        break;
      }

      case ActivityNodeKind.FlowFinal: {
        // Consume token from incoming edge without terminating whole activity
        for (const inEdgeId of node.incomingEdges) {
          const toks = this.edgeTokens.get(inEdgeId);
          if (toks && toks.length > 0) {
            const tok = toks.shift()!;
            if (toks.length === 0) this.edgeTokens.delete(inEdgeId);
            tokensMoved.push({
              tokenId: tok.id,
              kind: tok.kind,
              from: `edge:${inEdgeId}`,
              to: `node:${node.name}`,
            });
            break;
          }
        }
        break;
      }
    }
  }

  private pushEdgeToken(edgeId: EdgeId, token: Token): void {
    let list = this.edgeTokens.get(edgeId);
    if (!list) {
      list = [];
      this.edgeTokens.set(edgeId, list);
    }
    list.push(token);
  }

  private pushPinToken(pinId: PinId, token: Token): void {
    let list = this.pinTokens.get(pinId);
    if (!list) {
      list = [];
      this.pinTokens.set(pinId, list);
    }
    list.push(token);
  }

  private countActiveTokens(): number {
    let count = 0;
    for (const list of this.edgeTokens.values()) count += list.length;
    for (const list of this.pinTokens.values()) count += list.length;
    for (const list of this.nodeTokens.values()) count += list.length;
    return count;
  }

  private serializeMarking(): SerializedMarking {
    const edgeTokens: Record<EdgeId, Token[]> = {};
    for (const [id, toks] of this.edgeTokens.entries()) {
      edgeTokens[id] = toks.map((t) => ({ ...t }));
    }

    const pinTokens: Record<PinId, Token[]> = {};
    for (const [id, toks] of this.pinTokens.entries()) {
      pinTokens[id] = toks.map((t) => ({ ...t }));
    }

    const nodeTokens: Record<NodeId, Token[]> = {};
    for (const [id, toks] of this.nodeTokens.entries()) {
      nodeTokens[id] = toks.map((t) => ({ ...t }));
    }

    return { edgeTokens, pinTokens, nodeTokens };
  }

  private restoreMarking(marking: SerializedMarking): void {
    this.edgeTokens.clear();
    for (const [k, v] of Object.entries(marking.edgeTokens)) {
      this.edgeTokens.set(
        Number(k),
        v.map((t) => ({ ...t })),
      );
    }

    this.pinTokens.clear();
    for (const [k, v] of Object.entries(marking.pinTokens)) {
      this.pinTokens.set(
        Number(k),
        v.map((t) => ({ ...t })),
      );
    }

    this.nodeTokens.clear();
    for (const [k, v] of Object.entries(marking.nodeTokens)) {
      this.nodeTokens.set(
        Number(k),
        v.map((t) => ({ ...t })),
      );
    }
  }
}

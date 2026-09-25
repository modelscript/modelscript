// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Generic Control Flow Graph (CFG) Engine.
 *
 * Universal, language-agnostic CFG representation for abstract interpretation
 * and static analysis across Modelica, SysML v2, and custom DSLs.
 */

export enum CFGEdgeKind {
  Normal = "Normal",
  TrueBranch = "TrueBranch",
  FalseBranch = "FalseBranch",
  Call = "Call",
  Return = "Return",
  Exception = "Exception",
}

export interface CFGInstruction {
  id: number;
  op: string;
  astNodeId?: number;
  startByte?: number;
  endByte?: number;
  operands?: any[];
  targetVar?: string;
  metadata?: Record<string, any>;
}

export interface CFGEdge {
  fromBlockId: number;
  toBlockId: number;
  kind: CFGEdgeKind;
  conditionExpr?: any;
}

export class BasicBlock {
  public instructions: CFGInstruction[] = [];
  public predecessors: number[] = [];
  public successors: number[] = [];

  constructor(
    public readonly id: number,
    public readonly label: string = `bb_${id}`,
  ) {}

  addInstruction(inst: CFGInstruction): void {
    this.instructions.push(inst);
  }

  isEmpty(): boolean {
    return this.instructions.length === 0;
  }
}

export interface NaturalLoop {
  headerBlockId: number;
  backEdgeFromBlockId: number;
  bodyBlockIds: Set<number>;
}

export class GenericCFG {
  public blocks: Map<number, BasicBlock> = new Map();
  public edges: CFGEdge[] = [];
  public entryBlockId: number = 0;
  public exitBlockIds: Set<number> = new Set();
  private nextBlockId: number = 0;
  private nextInstId: number = 0;

  createBlock(label?: string): BasicBlock {
    const id = this.nextBlockId++;
    const block = new BasicBlock(id, label ?? `bb_${id}`);
    this.blocks.set(id, block);
    if (id === 0) {
      this.entryBlockId = 0;
    }
    return block;
  }

  createInstruction(
    op: string,
    targetVar?: string,
    operands?: any[],
    meta?: { astNodeId?: number; startByte?: number; endByte?: number; [key: string]: any },
  ): CFGInstruction {
    return {
      id: this.nextInstId++,
      op,
      targetVar,
      operands,
      astNodeId: meta?.astNodeId,
      startByte: meta?.startByte,
      endByte: meta?.endByte,
      metadata: meta,
    };
  }

  addEdge(fromId: number, toId: number, kind: CFGEdgeKind = CFGEdgeKind.Normal, conditionExpr?: any): void {
    const from = this.blocks.get(fromId);
    const to = this.blocks.get(toId);
    if (!from || !to) {
      throw new Error(`Cannot add edge: Block ${fromId} or ${toId} does not exist in CFG.`);
    }

    if (!from.successors.includes(toId)) {
      from.successors.push(toId);
    }
    if (!to.predecessors.includes(fromId)) {
      to.predecessors.push(fromId);
    }

    this.edges.push({
      fromBlockId: fromId,
      toBlockId: toId,
      kind,
      conditionExpr,
    });
  }

  getBlock(id: number): BasicBlock | undefined {
    return this.blocks.get(id);
  }

  /**
   * Computes the Reverse Post-Order (RPO) traversal of basic blocks.
   * Optimal order for forward dataflow / abstract interpretation worklist analysis.
   */
  computeRPO(): number[] {
    const visited = new Set<number>();
    const postOrder: number[] = [];

    const dfs = (id: number) => {
      visited.add(id);
      const block = this.blocks.get(id);
      if (block) {
        for (const succId of block.successors) {
          if (!visited.has(succId)) {
            dfs(succId);
          }
        }
      }
      postOrder.push(id);
    };

    if (this.blocks.has(this.entryBlockId)) {
      dfs(this.entryBlockId);
    }

    // Include any unreachable blocks at the end
    for (const id of this.blocks.keys()) {
      if (!visited.has(id)) {
        dfs(id);
      }
    }

    return postOrder.reverse();
  }

  /**
   * Computes the immediate dominator (idom) tree using Cooper, Harvey, Kennedy algorithm.
   * Maps blockId -> immediateDominatorBlockId.
   */
  computeDominators(): Map<number, number> {
    const rpo = this.computeRPO();
    const rpoIndex = new Map<number, number>();
    for (let i = 0; i < rpo.length; i++) {
      rpoIndex.set(rpo[i]!, i);
    }

    const idom = new Map<number, number>();
    const entry = this.entryBlockId;
    idom.set(entry, entry);

    const intersect = (b1: number, b2: number): number => {
      let finger1 = b1;
      let finger2 = b2;
      while (finger1 !== finger2) {
        while ((rpoIndex.get(finger1) ?? 0) > (rpoIndex.get(finger2) ?? 0)) {
          finger1 = idom.get(finger1)!;
        }
        while ((rpoIndex.get(finger2) ?? 0) > (rpoIndex.get(finger1) ?? 0)) {
          finger2 = idom.get(finger2)!;
        }
      }
      return finger1;
    };

    let changed = true;
    while (changed) {
      changed = false;
      for (const b of rpo) {
        if (b === entry) continue;
        const block = this.blocks.get(b);
        if (!block || block.predecessors.length === 0) continue;

        let newIdom: number | null = null;
        for (const p of block.predecessors) {
          if (idom.has(p)) {
            newIdom = p;
            break;
          }
        }

        if (newIdom === null) continue;

        for (const p of block.predecessors) {
          if (p !== newIdom && idom.has(p)) {
            newIdom = intersect(p, newIdom);
          }
        }

        if (idom.get(b) !== newIdom) {
          idom.set(b, newIdom);
          changed = true;
        }
      }
    }

    return idom;
  }

  /**
   * Detects all natural loops and back-edges (edges u -> v where v dominates u).
   */
  detectNaturalLoops(): NaturalLoop[] {
    const idom = this.computeDominators();
    const dominates = (a: number, b: number): boolean => {
      let curr = b;
      while (true) {
        if (curr === a) return true;
        const parent = idom.get(curr);
        if (parent === undefined || parent === curr) return false;
        curr = parent;
      }
    };

    const loops: NaturalLoop[] = [];

    for (const edge of this.edges) {
      const u = edge.fromBlockId;
      const v = edge.toBlockId;
      if (dominates(v, u)) {
        // v is header, u -> v is back-edge
        const loopBody = new Set<number>([v, u]);
        const stack: number[] = [u];

        while (stack.length > 0) {
          const curr = stack.pop()!;
          const currBlock = this.blocks.get(curr);
          if (currBlock) {
            for (const pred of currBlock.predecessors) {
              if (!loopBody.has(pred)) {
                loopBody.add(pred);
                stack.push(pred);
              }
            }
          }
        }

        loops.push({
          headerBlockId: v,
          backEdgeFromBlockId: u,
          bodyBlockIds: loopBody,
        });
      }
    }

    return loops;
  }
}

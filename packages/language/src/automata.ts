/* eslint-disable */
import { NormalizedGrammar, Production, SymbolName } from "./grammar.js";

/**
 * Represents a single parsing state context during parser generation.
 * An item is a production with a "dot" indicating how much of the right-hand side has been matched.
 */
export interface LR0Item {
  /** The production rule this item is tracking. */
  production: Production;
  /** The index in the production's RHS indicating the current parsing progress. */
  dot: number;
  /** The set of terminal symbols that can legally follow this item (LALR(1) lookahead). */
  lookahead: Set<SymbolName>; // LALR(1) per-item lookahead
}

/**
 * Represents a discrete state within the LR state machine.
 */
export class LRState {
  /** The set of LR(0) items (the core and closure) that define this state. */
  items: LR0Item[] = [];
  /** The valid GOTO and SHIFT transitions to other states based on the next symbol. */
  transitions = new Map<SymbolName, LRState>();

  /**
   * @param id The unique integer identifier for this state.
   */
  constructor(public id: number) {}
}

/**
 * Constructs the LALR(1) parsing automaton from a normalized grammar.
 * This handles the generation of states, transitions, and the computation
 * of first sets and lookaheads using the DeRemer-Pennello algorithm.
 */
export class LRAutomaton {
  /** All generated states in the state machine. */
  states: LRState[] = [];
  /** The computed FIRST sets for all symbols (terminals and non-terminals). */
  firstSets = new Map<SymbolName, Set<SymbolName>>();

  /** O(1) state lookup by canonical core item signature to prevent duplicate states. */
  private stateIndex = new Map<string, LRState>();

  constructor(public grammar: NormalizedGrammar) {
    this.computeFirstSets();
    this.buildLR0();
    this.computeLALR1Lookaheads();
  }

  /** Canonical key for a set of LR(0) items (ignoring lookaheads) */
  private itemSetKey(items: LR0Item[]): string {
    return items
      .map((i) => `${i.production.id}:${i.dot}`)
      .sort()
      .join(",");
  }

  private computeFirstSets() {
    for (const term of this.grammar.terminals) {
      this.firstSets.set(term, new Set([term]));
    }
    for (const nonTerm of this.grammar.nonTerminals) {
      this.firstSets.set(nonTerm, new Set());
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const prod of this.grammar.productions) {
        const A = prod.left;
        const A_first = this.firstSets.get(A)!;
        const originalSize = A_first.size;

        if (prod.right.length === 0) {
          A_first.add("");
        } else {
          let i = 0;
          let allEmpty = true;
          while (i < prod.right.length) {
            const Y = prod.right[i];
            const Y_first = this.firstSets.get(Y);
            if (!Y_first) {
              i++;
              continue;
            }
            for (const sym of Y_first) {
              if (sym !== "") A_first.add(sym);
            }
            if (!Y_first.has("")) {
              allEmpty = false;
              break;
            }
            i++;
          }
          if (allEmpty) {
            A_first.add("");
          }
        }

        if (A_first.size > originalSize) {
          changed = true;
        }
      }
    }
  }

  private buildLR0() {
    // 1. Initial State
    const startProd = this.grammar.productions.find((p) => p.left === "_START")!;
    const startItem: LR0Item = { production: startProd, dot: 0, lookahead: new Set(["EOF"]) };

    const I0 = new LRState(0);
    I0.items = this.closure([startItem]);
    this.states.push(I0);
    this.stateIndex.set(this.itemSetKey(I0.items), I0);

    // 2. Build states iteratively
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < this.states.length; i++) {
        const state = this.states[i];

        const nextSymbols = new Set<SymbolName>();
        for (const item of state.items) {
          if (item.dot < item.production.right.length) {
            nextSymbols.add(item.production.right[item.dot]);
          }
        }

        for (const sym of nextSymbols) {
          const nextItems: LR0Item[] = [];
          for (const item of state.items) {
            if (item.dot < item.production.right.length && item.production.right[item.dot] === sym) {
              nextItems.push({ production: item.production, dot: item.dot + 1, lookahead: new Set() });
            }
          }

          const closureItems = this.closure(nextItems);
          const key = this.itemSetKey(closureItems);

          // O(1) state lookup by canonical key
          let targetState = this.stateIndex.get(key);
          if (!targetState) {
            targetState = new LRState(this.states.length);
            targetState.items = closureItems;
            this.states.push(targetState);
            this.stateIndex.set(key, targetState);
            changed = true;
          }

          state.transitions.set(sym, targetState);
        }
      }
    }
  }

  /**
   * LALR(1) Lookahead Computation via DeRemer/Pennello.
   *
   * Computes per-item lookahead sets by propagating through:
   * 1. READS: (p, A) reads (q, C) if GOTO(p, A) = r, r has transition on C, C is nullable
   * 2. INCLUDES: (p, A) includes (q, B) if B → β₁Aβ₂, β₂ =>* ε, reading β₁ from q reaches p
   */
  private computeLALR1Lookaheads() {
    interface NTTrans {
      stateId: number;
      symbol: SymbolName;
    }
    const ntKey = (nt: NTTrans) => `${nt.stateId}:${nt.symbol}`;

    // Collect all nonterminal transitions
    const ntTransitions: NTTrans[] = [];
    for (const state of this.states) {
      for (const [sym] of state.transitions) {
        if (this.grammar.nonTerminals.has(sym)) {
          ntTransitions.push({ stateId: state.id, symbol: sym });
        }
      }
    }

    const allKeys = ntTransitions.map(ntKey);

    // DR (Directly Reads): terminals reachable from GOTO(p, A) state
    const drSets = new Map<string, Set<SymbolName>>();
    for (const nt of ntTransitions) {
      const targetState = this.states[nt.stateId].transitions.get(nt.symbol);
      if (!targetState) continue;
      const dr = new Set<SymbolName>();
      for (const [sym] of targetState.transitions) {
        if (!this.grammar.nonTerminals.has(sym)) dr.add(sym);
      }
      drSets.set(ntKey(nt), dr);
    }

    // READS relation
    const reads = new Map<string, string[]>();
    for (const nt of ntTransitions) {
      const r = this.states[nt.stateId].transitions.get(nt.symbol);
      if (!r) continue;
      const readsList: string[] = [];
      for (const [sym] of r.transitions) {
        if (this.grammar.nonTerminals.has(sym) && this.isNullable(sym)) {
          readsList.push(ntKey({ stateId: r.id, symbol: sym }));
        }
      }
      reads.set(ntKey(nt), readsList);
    }

    // INCLUDES relation
    const includes = new Map<string, string[]>();
    for (const k of allKeys) includes.set(k, []);

    // Pre-index productions by which symbols appear on their RHS.
    // This avoids the O(NTs × Prods × RHS) triple-nested scan.
    const prodsByRhsSymbol = new Map<string, { prod: { left: string; right: string[] }; pos: number }[]>();
    for (const prod of this.grammar.productions) {
      for (let i = 0; i < prod.right.length; i++) {
        const sym = prod.right[i];
        if (!prodsByRhsSymbol.has(sym)) prodsByRhsSymbol.set(sym, []);
        prodsByRhsSymbol.get(sym)!.push({ prod, pos: i });
      }
    }

    for (const nt of ntTransitions) {
      const entries = prodsByRhsSymbol.get(nt.symbol);
      if (!entries) continue;

      for (const { prod, pos: i } of entries) {
        // Check suffix β₂ = prod.right[i+1..] is nullable
        let suffixNullable = true;
        for (let j = i + 1; j < prod.right.length; j++) {
          if (!this.isNullable(prod.right[j])) {
            suffixNullable = false;
            break;
          }
        }
        if (!suffixNullable) continue;

        // Trace prefix β₁ = prod.right[0..i-1] from each state
        for (const state of this.states) {
          let cursor: LRState | undefined = state;
          for (let j = 0; j < i; j++) {
            cursor = cursor?.transitions.get(prod.right[j]);
            if (!cursor) break;
          }
          if (!cursor || cursor.id !== nt.stateId) continue;

          const parentKey = ntKey({ stateId: state.id, symbol: prod.left });
          const childKey = ntKey(nt);
          // INCLUDES edge: child's Follow set includes parent's Follow set
          // (directed child → parent for the digraph propagation)
          if (includes.has(childKey)) includes.get(childKey)!.push(parentKey);
        }
      }
    }

    // Digraph propagation: Read = DR ∪ READS*, Follow = Read ∪ INCLUDES*
    const readResult = this.digraphPropagate(allKeys, drSets, reads);
    const followResult = this.digraphPropagate(allKeys, readResult, includes);

    // Assign lookaheads to reduce items
    for (const state of this.states) {
      for (const item of state.items) {
        if (item.dot < item.production.right.length) continue;
        if (item.production.left === "_START") {
          item.lookahead = new Set(["EOF"]);
          continue;
        }

        // Find source states where reading the full RHS lands in this state
        for (const sourceState of this.states) {
          let cursor: LRState | undefined = sourceState;
          for (let i = 0; i < item.production.right.length; i++) {
            cursor = cursor?.transitions.get(item.production.right[i]);
            if (!cursor) break;
          }
          if (cursor?.id !== state.id) continue;

          const key = ntKey({ stateId: sourceState.id, symbol: item.production.left });
          const la = followResult.get(key);
          if (la) for (const sym of la) item.lookahead.add(sym);
        }
      }
    }
  }

  /** Digraph algorithm (Tarjan-style SCC) for propagating sets through a relation */
  private digraphPropagate(
    nodes: string[],
    initial: Map<string, Set<SymbolName>>,
    edges: Map<string, string[]>,
  ): Map<string, Set<SymbolName>> {
    const result = new Map<string, Set<SymbolName>>();
    const dfn = new Map<string, number>();
    const stack: string[] = [];
    let counter = 0;

    for (const node of nodes) {
      result.set(node, new Set(initial.get(node) || []));
      dfn.set(node, 0);
    }

    const traverse = (x: string) => {
      counter++;
      const xDfn = counter;
      dfn.set(x, xDfn);
      stack.push(x);

      for (const y of edges.get(x) || []) {
        if (!dfn.has(y)) continue;
        if (dfn.get(y) === 0) traverse(y);

        const xSet = result.get(x)!;
        const ySet = result.get(y);
        if (ySet) for (const sym of ySet) xSet.add(sym);

        const yDfn = dfn.get(y)!;
        if (yDfn < dfn.get(x)!) dfn.set(x, yDfn);
      }

      // If x is an SCC root, pop and propagate
      if (dfn.get(x) === xDfn) {
        const xSet = result.get(x)!;
        while (stack.length > 0) {
          const top = stack.pop()!;
          dfn.set(top, Infinity);
          if (top === x) break;
          const topSet = result.get(top);
          if (topSet) for (const sym of xSet) topSet.add(sym);
        }
      }
    };

    for (const node of nodes) {
      if (dfn.get(node) === 0) traverse(node);
    }

    return result;
  }

  /**
   * Computes the Minimum Reduction Distance (MRD) for error recovery heuristics.
   * This is used to determine the cost of error recovery paths by calculating the minimum
   * number of terminal tokens required to fully reduce from a given state.
   */
  computeMRD(): number[] {
    const mrd = new Array(this.states.length).fill(1000000); // Infinity equivalent
    const queue: number[] = [];

    // Base cases: States with immediate REDUCE or ACCEPT
    for (const state of this.states) {
      if (state.items.some((item) => item.dot === item.production.right.length)) {
        mrd[state.id] = 0;
        queue.push(state.id);
      }
    }

    const reverseEdges = new Map<number, { sym: SymbolName; from: number }[]>();
    for (const state of this.states) {
      for (const [sym, target] of state.transitions.entries()) {
        if (!reverseEdges.has(target.id)) reverseEdges.set(target.id, []);
        reverseEdges.get(target.id)!.push({ sym, from: state.id });
      }
    }

    const minYield = new Map<SymbolName, number>();
    for (const term of this.grammar.terminals) minYield.set(term, 1);

    let changed = true;
    while (changed) {
      changed = false;
      for (const prod of this.grammar.productions) {
        let currentYield = 0;
        for (const sym of prod.right) {
          const y = minYield.get(sym);
          if (y === undefined) {
            currentYield = 1000000;
            break;
          }
          currentYield += y;
        }
        const existing = minYield.get(prod.left) ?? 1000000;
        if (currentYield < existing) {
          minYield.set(prod.left, currentYield);
          changed = true;
        }
      }
    }

    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      const distU = mrd[u];

      const incoming = reverseEdges.get(u);
      if (!incoming) continue;

      for (const edge of incoming) {
        let weight = 1;
        if (this.grammar.nonTerminals.has(edge.sym)) {
          weight = minYield.get(edge.sym) ?? 1000000;
        }

        if (distU + weight < mrd[edge.from]) {
          mrd[edge.from] = distU + weight;
          queue.push(edge.from);
        }
      }
    }

    return mrd;
  }

  /** Check if a symbol can derive ε */
  private isNullable(sym: SymbolName): boolean {
    if (!this.grammar.nonTerminals.has(sym)) return false;
    const firstSet = this.firstSets.get(sym);
    return firstSet ? firstSet.has("") : false;
  }

  private closure(items: LR0Item[]): LR0Item[] {
    const result = [...items];
    let changed = true;

    while (changed) {
      changed = false;
      for (let i = 0; i < result.length; i++) {
        const item = result[i];
        if (item.dot < item.production.right.length) {
          const nextSym = item.production.right[item.dot];
          if (this.grammar.nonTerminals.has(nextSym)) {
            const prods = this.grammar.productions.filter((p) => p.left === nextSym);
            for (const p of prods) {
              const newItem: LR0Item = { production: p, dot: 0, lookahead: new Set() };
              if (!this.hasItem(result, newItem)) {
                result.push(newItem);
                changed = true;
              }
            }
          }
        }
      }
    }
    return result;
  }

  private hasItem(items: LR0Item[], item: LR0Item): boolean {
    return items.some((i) => i.production.id === item.production.id && i.dot === item.dot);
  }
}

/**
 * Indicates the type of operation the parser should perform when matching a token.
 */
export enum ActionType {
  SHIFT,
  REDUCE,
  ACCEPT,
}

/**
 * A single cell operation in the LR action table.
 */
export interface Action {
  type: ActionType;
  /** State id for SHIFT, Production id for REDUCE. Undefined for ACCEPT. */
  target?: number;
  /** The precedence of this action, used for conflict resolution. */
  prec?: number;
  /** The associativity of this action, used for conflict resolution. */
  assoc?: "left" | "right";
}

/**
 * Diagnostic information regarding unresolvable grammar ambiguities.
 */
export interface ConflictReport {
  /** The state ID where the conflict occurs. */
  stateId: number;
  /** The terminal symbol triggering the conflict. */
  terminal: string;
  /** The set of conflicting actions (e.g., multiple REDUCEs or a SHIFT and REDUCE). */
  actions: Action[];
  /** Categorization of the conflict type. */
  conflictType: "shift/reduce" | "reduce/reduce";
}

/**
 * Generates the Generalized LR (GLR) Action and Goto tables.
 * Unlike strict LR parsers, GLR tables permit multiple actions per cell
 * to support forking parser execution on ambiguous inputs.
 */
export class GLRTable {
  /**
   * The Action table mapping State ID -> Terminal Symbol -> Array of Actions.
   * GLR natively supports multiple actions in a single cell.
   */
  actionTable = new Map<number, Map<SymbolName, Action[]>>();

  /** The Goto table mapping State ID -> Non-Terminal Symbol -> Next State ID. */
  gotoTable = new Map<number, Map<SymbolName, number>>();

  /** Unresolvable conflicts discovered during table generation. */
  conflicts: ConflictReport[] = [];

  constructor(
    public grammar: NormalizedGrammar,
    public automaton: LRAutomaton,
  ) {
    this.buildTable();
    this.reportConflicts();
  }

  private buildTable() {
    for (const state of this.automaton.states) {
      this.actionTable.set(state.id, new Map());
      this.gotoTable.set(state.id, new Map());

      for (const [sym, targetState] of state.transitions.entries()) {
        if (this.grammar.nonTerminals.has(sym)) {
          // GOTO
          this.gotoTable.get(state.id)!.set(sym, targetState.id);
        } else {
          // SHIFT
          let shiftPrec: number | undefined = this.grammar.globalPrecedences.get(sym);
          let shiftAssoc: "left" | "right" | undefined = undefined;
          for (const item of state.items) {
            if (item.dot < item.production.right.length && item.production.right[item.dot] === sym) {
              if (item.production.prec !== undefined) {
                if (shiftPrec === undefined || item.production.prec > shiftPrec) {
                  shiftPrec = item.production.prec;
                  shiftAssoc = item.production.assoc;
                }
              }
            }
          }
          this.addAction(state.id, sym, {
            type: ActionType.SHIFT,
            target: targetState.id,
            prec: shiftPrec,
            assoc: shiftAssoc,
          });
        }
      }

      // REDUCE & ACCEPT — LALR(1) per-item lookahead (replaces SLR(1) FOLLOW sets)
      for (const item of state.items) {
        if (item.dot === item.production.right.length) {
          if (item.production.left === "_START") {
            this.addAction(state.id, "EOF", { type: ActionType.ACCEPT });
          } else {
            // Use per-item LALR(1) lookahead instead of FOLLOW(lhs)
            for (const term of item.lookahead) {
              const globalPrec = this.grammar.globalPrecedences.get(item.production.left);
              const prec = item.production.prec !== undefined ? item.production.prec : globalPrec;
              this.addAction(state.id, term, {
                type: ActionType.REDUCE,
                target: item.production.id,
                prec: prec,
                assoc: item.production.assoc,
              });
            }
          }
        }
      }
    }
  }

  /** Scan the action table for unresolved conflicts and log a diagnostic report. */
  reportConflicts() {
    this.conflicts = [];

    const formatRule = (s: string) => {
      if (s.startsWith('"') && s.endsWith('"')) return s.replace(/"/g, "'");
      return s;
    };

    for (const [stateId, termMap] of this.actionTable.entries()) {
      for (const [terminal, actions] of termMap.entries()) {
        if (actions.length <= 1) continue;

        const hasShift = actions.some((a) => a.type === ActionType.SHIFT);
        const reduceCount = actions.filter((a) => a.type === ActionType.REDUCE).length;

        let conflictType: "shift/reduce" | "reduce/reduce";
        if (hasShift && reduceCount > 0) {
          conflictType = "shift/reduce";
        } else if (reduceCount > 1) {
          conflictType = "reduce/reduce";
        } else {
          continue; // Multiple shifts to different states are not real conflicts
        }

        let isWhitelisted = false;

        // Extract all involved non-terminals for this conflict
        const involvedRules = new Set<string>();
        for (const a of actions) {
          if (a.type === ActionType.REDUCE && a.target !== undefined) {
            const prod = this.grammar.productions[a.target];
            if (prod) involvedRules.add(formatRule(prod.left));
          }
        }

        // If the user specified a conflict array that contains all these reduced rules, suppress it
        for (const conflictGroup of this.grammar.conflicts) {
          let matchesAll = true;
          for (const rule of involvedRules) {
            if (!conflictGroup.includes(rule)) {
              matchesAll = false;
              break;
            }
          }
          if (matchesAll && involvedRules.size > 0) {
            isWhitelisted = true;
            break;
          }
        }

        if (!isWhitelisted) {
          this.conflicts.push({ stateId, terminal, actions: [...actions], conflictType });
        }
      }
    }

    if (this.conflicts.length > 0) {
      const seenOutputs = new Set<string>();
      const diagnostics: { type: string; output: string }[] = [];

      const groupedConflicts = new Map<
        string,
        { stateId: number; conflictType: string; reduceItems: Set<LR0Item>; shiftItems: Set<LR0Item> }
      >();

      for (const conflict of this.conflicts) {
        const key = `${conflict.stateId}-${conflict.conflictType}`;
        if (!groupedConflicts.has(key)) {
          groupedConflicts.set(key, {
            stateId: conflict.stateId,
            conflictType: conflict.conflictType,
            reduceItems: new Set(),
            shiftItems: new Set(),
          });
        }

        const group = groupedConflicts.get(key)!;
        const state = this.automaton.states[conflict.stateId];

        const rItems = state.items.filter(
          (i) => i.dot === i.production.right.length && i.lookahead.has(conflict.terminal),
        );
        const sItems = state.items.filter(
          (i) => i.dot < i.production.right.length && i.production.right[i.dot] === conflict.terminal,
        );

        for (const i of rItems) group.reduceItems.add(i);
        for (const i of sItems) group.shiftItems.add(i);
      }

      for (const group of groupedConflicts.values()) {
        let output = `    Unresolved ${group.conflictType} conflict for symbol sequence:\n\n`;

        // Find shortest path from state 0 to conflict.stateId
        const queue: { stateId: number; path: string[] }[] = [{ stateId: 0, path: [] }];
        const visited = new Set<number>();
        let prefixPath: string[] = [];

        while (queue.length > 0) {
          const curr = queue.shift()!;
          if (curr.stateId === group.stateId) {
            prefixPath = curr.path;
            break;
          }
          if (visited.has(curr.stateId)) continue;
          visited.add(curr.stateId);

          const s = this.automaton.states[curr.stateId];
          for (const [sym, nextState] of s.transitions) {
            queue.push({ stateId: nextState.id, path: [...curr.path, formatRule(sym)] });
          }
        }
        if (prefixPath.length > 0 && prefixPath[0] === formatRule(this.grammar.startSymbol)) {
          prefixPath.shift();
        }

        const seq = prefixPath.join("  ");
        output += `      ${seq}  •  …\n\n`;

        output += `    Possible interpretations:\n\n`;
        let interpIdx = 1;
        const involvedRules = new Set<string>();

        for (const item of group.reduceItems) {
          const left = formatRule(item.production.left);
          const stackLen = item.production.right.length;
          const prefixStr = prefixPath.slice(0, Math.max(0, prefixPath.length - stackLen)).join("  ");
          const matchedStr = item.production.right.map(formatRule).join("  ");

          output += `      ${interpIdx++}:  ${prefixStr ? prefixStr + "  " : ""}(${left}  ${matchedStr})  •  …\n`;
          involvedRules.add(left);
        }

        for (const item of group.shiftItems) {
          const left = formatRule(item.production.left);
          const matchLen = item.dot;
          const prefixStr = prefixPath.slice(0, Math.max(0, prefixPath.length - matchLen)).join("  ");
          const beforeDot = item.production.right.slice(0, item.dot).map(formatRule).join("  ");
          const afterDot = item.production.right.slice(item.dot).map(formatRule).join("  ");

          output += `      ${interpIdx++}:  ${prefixStr ? prefixStr + "  " : ""}(${left}  ${beforeDot}${beforeDot ? "  " : ""}•  ${afterDot})\n`;
          involvedRules.add(left);
        }

        output += `\n    Possible resolutions:\n\n`;
        const rulesArray = Array.from(involvedRules);
        if (group.conflictType === "shift/reduce") {
          output += `      1:  Specify a left or right associativity in \`${rulesArray[0]}\`\n`;
          output += `      2:  Add a conflict for these rules: \`${rulesArray.join("`, `")}\`\n\n`;
        } else {
          let resIdx = 1;
          for (const rule of rulesArray) {
            output += `      ${resIdx++}:  Specify a higher precedence in \`${rule}\` than in the other rules.\n`;
          }
          output += `      ${resIdx}:  Add a conflict for these rules: \`${rulesArray.join("`, `")}\`\n\n`;
        }

        if (!seenOutputs.has(output)) {
          seenOutputs.add(output);
          diagnostics.push({ type: group.conflictType, output });
        }
      }

      console.warn(`Warning: Conflicts when generating parser\n`);

      let conflictNum = 1;
      for (const diag of diagnostics.slice(0, 5)) {
        console.warn(`Conflict ${conflictNum++}:\n${diag.output}`);
      }
      if (diagnostics.length > 5) {
        console.warn(`... and ${diagnostics.length - 5} more conflicts suppressed.`);
      }

      const numReduceReduce = diagnostics.filter((d) => d.type === "reduce/reduce").length;
      const numShiftReduce = diagnostics.filter((d) => d.type === "shift/reduce").length;

      console.warn(
        `Found ${diagnostics.length} unresolved conflict${diagnostics.length === 1 ? "" : "s"} (${numReduceReduce} reduce/reduce, ${numShiftReduce} shift/reduce).\n`,
      );
      // process.exit(1);
    }
  }

  private addAction(stateId: number, sym: SymbolName, action: Action) {
    const actions = this.actionTable.get(stateId)!;
    if (!actions.has(sym)) {
      actions.set(sym, []);
    }
    const list = actions.get(sym)!;

    // Precedence resolution for Shift vs Reduce
    for (let i = 0; i < list.length; i++) {
      const exist = list[i];
      if (action.prec !== undefined || exist.prec !== undefined) {
        const actionPrec = action.prec ?? 0;
        const existPrec = exist.prec ?? 0;

        if (action.type === ActionType.REDUCE && exist.type === ActionType.SHIFT) {
          if (actionPrec > existPrec) {
            list.splice(i, 1);
            i--;
            continue;
          } // Reduce wins
          if (actionPrec < existPrec) {
            return;
          } // Shift wins
          if (action.assoc === "left") {
            list.splice(i, 1);
            i--;
            continue;
          } // Left assoc -> Reduce wins
          if (action.assoc === "right") {
            return;
          } // Right assoc -> Shift wins
        } else if (action.type === ActionType.SHIFT && exist.type === ActionType.REDUCE) {
          if (actionPrec > existPrec) {
            list.splice(i, 1);
            i--;
            continue;
          } // Shift wins
          if (actionPrec < existPrec) {
            return;
          } // Reduce wins
          if (exist.assoc === "left") {
            return;
          } // Left assoc -> Reduce wins
          if (exist.assoc === "right") {
            list.splice(i, 1);
            i--;
            continue;
          } // Right assoc -> Shift wins
        } else if (action.type === ActionType.REDUCE && exist.type === ActionType.REDUCE) {
          if (actionPrec > existPrec) {
            list.splice(i, 1);
            i--;
            continue;
          }
          if (actionPrec < existPrec) {
            return;
          }
        }
      }
    }

    // Avoid duplicate actions
    if (!list.some((a) => a.type === action.type && a.target === action.target)) {
      list.push(action);
    }
  }
}

type AST =
  | { type: "CHAR"; char: number }
  | { type: "CLASS"; ranges: [number, number][]; invert: boolean }
  | { type: "CONCAT"; left: AST; right: AST }
  | { type: "ALT"; left: AST; right: AST }
  | { type: "STAR"; child: AST }
  | { type: "PLUS"; child: AST }
  | { type: "OPT"; child: AST };

function parseRegex(pattern: string, tokenName: string = "unknown"): AST {
  // Safely strip standard regex anchors as DFAs inherently match from current pos
  let stripped = false;
  if (pattern.startsWith("^")) {
    pattern = pattern.substring(1);
    stripped = true;
  }
  if (pattern.endsWith("$") && !pattern.endsWith("\\$")) {
    pattern = pattern.substring(0, pattern.length - 1);
    stripped = true;
  }
  if (stripped) {
    console.warn(
      `[ModelScript Lexer Warning] Stripped redundant anchors (^ or $) from token definition '${tokenName}'. DFA lexers inherently match from the current stream position.`,
    );
  }

  let pos = 0;

  function parseAlt(): AST {
    let left = parseConcat();
    while (pos < pattern.length && pattern[pos] === "|") {
      pos++;
      const right = parseConcat();
      left = { type: "ALT", left, right };
    }
    return left;
  }

  function parseConcat(): AST {
    let left: AST | null = null;
    while (pos < pattern.length && pattern[pos] !== "|" && pattern[pos] !== ")") {
      const right = parseQuantifier();
      if (left) left = { type: "CONCAT", left, right };
      else left = right;
    }
    if (!left) throw new Error("Empty concat");
    return left;
  }

  function parseQuantifier(): AST {
    const child = parseAtom();
    if (pos < pattern.length) {
      if (pattern[pos] === "*") {
        pos++;
        return { type: "STAR", child };
      }
      if (pattern[pos] === "+") {
        pos++;
        return { type: "PLUS", child };
      }
      if (pattern[pos] === "?") {
        pos++;
        return { type: "OPT", child };
      }
      if (pattern[pos] === "{") {
        const endPos = pattern.indexOf("}", pos);
        if (endPos > -1) {
          const rangeStr = pattern.substring(pos + 1, endPos);
          const parts = rangeStr.split(",");
          if (parts.length > 0 && !isNaN(parseInt(parts[0], 10))) {
            const min = parseInt(parts[0], 10);
            const max = parts.length > 1 ? (parts[1].trim() === "" ? Infinity : parseInt(parts[1], 10)) : min;
            pos = endPos + 1;

            let result: AST | null = null;
            // Add 'min' exact copies
            for (let i = 0; i < min; i++) {
              if (!result) result = child;
              else result = { type: "CONCAT", left: result, right: child };
            }
            if (max === Infinity) {
              if (!result) return { type: "STAR", child };
              result = { type: "CONCAT", left: result, right: { type: "STAR", child } };
            } else {
              // Add (max - min) optional copies
              for (let i = min; i < max; i++) {
                if (!result) result = { type: "OPT", child };
                else result = { type: "CONCAT", left: result, right: { type: "OPT", child } };
              }
            }
            if (!result) throw new Error("Quantifier {0} not supported in DFA engine");
            return result;
          }
        }
      }
    }
    return child;
  }

  function parseAtom(): AST {
    const ch = pattern[pos++];
    if (ch === "(") {
      if (pattern[pos] === "?" && pattern[pos + 1] === ":") pos += 2;
      const inner = parseAlt();
      if (pattern[pos++] !== ")") throw new Error("Unclosed (");
      return inner;
    } else if (ch === "[") {
      let invert = false;
      if (pattern[pos] === "^") {
        invert = true;
        pos++;
      }
      const ranges: [number, number][] = [];
      while (pos < pattern.length && pattern[pos] !== "]") {
        if (pattern[pos] === "\\") {
          pos++;
          const esc = pattern[pos++];
          if (esc === "u") {
            if (pattern[pos] === "{") {
              pos++;
              const endPos = pattern.indexOf("}", pos);
              ranges.push([parseInt(pattern.slice(pos, endPos), 16), parseInt(pattern.slice(pos, endPos), 16)]);
              pos = endPos + 1;
            } else {
              ranges.push([parseInt(pattern.slice(pos, pos + 4), 16), parseInt(pattern.slice(pos, pos + 4), 16)]);
              pos += 4;
            }
          } else if (esc === "x") {
            ranges.push([parseInt(pattern.slice(pos, pos + 2), 16), parseInt(pattern.slice(pos, pos + 2), 16)]);
            pos += 2;
          } else if (esc === "d") ranges.push([48, 57]);
          else if (esc === "w") {
            ranges.push([65, 90]);
            ranges.push([97, 122]);
            ranges.push([48, 57]);
            ranges.push([95, 95]);
          } else if (esc === "s") {
            ranges.push([32, 32]);
            ranges.push([9, 9]);
            ranges.push([10, 10]);
            ranges.push([13, 13]);
          } else if (esc === "n") ranges.push([10, 10]);
          else if (esc === "r") ranges.push([13, 13]);
          else if (esc === "t") ranges.push([9, 9]);
          else if (esc === "f") ranges.push([12, 12]);
          else if (esc === "v") ranges.push([11, 11]);
          else if (esc === "b") ranges.push([8, 8]);
          else ranges.push([esc.charCodeAt(0), esc.charCodeAt(0)]);
        } else {
          const start = pattern.charCodeAt(pos++);
          if (pattern[pos] === "-" && pattern[pos + 1] !== "]") {
            pos++;
            const end = pattern.charCodeAt(pos++);
            ranges.push([start, end]);
          } else {
            ranges.push([start, start]);
          }
        }
      }
      if (pattern[pos++] !== "]") throw new Error("Unclosed [");
      return { type: "CLASS", ranges, invert };
    } else if (ch === "\\") {
      const esc = pattern[pos++];
      if (esc === "u") {
        if (pattern[pos] === "{") {
          pos++;
          const endPos = pattern.indexOf("}", pos);
          const cp = parseInt(pattern.slice(pos, endPos), 16);
          pos = endPos + 1;
          return { type: "CHAR", char: cp };
        } else {
          const cp = parseInt(pattern.slice(pos, pos + 4), 16);
          pos += 4;
          return { type: "CHAR", char: cp };
        }
      }
      if (esc === "x") {
        const cp = parseInt(pattern.slice(pos, pos + 2), 16);
        pos += 2;
        return { type: "CHAR", char: cp };
      }
      if (esc === "d") return { type: "CLASS", ranges: [[48, 57]], invert: false };
      if (esc === "w")
        return {
          type: "CLASS",
          ranges: [
            [65, 90],
            [97, 122],
            [48, 57],
            [95, 95],
          ],
          invert: false,
        };
      if (esc === "s")
        return {
          type: "CLASS",
          ranges: [
            [32, 32],
            [9, 9],
            [10, 10],
            [13, 13],
          ],
          invert: false,
        };
      if (esc === "n") return { type: "CHAR", char: 10 };
      if (esc === "r") return { type: "CHAR", char: 13 };
      if (esc === "t") return { type: "CHAR", char: 9 };
      if (esc === "f") return { type: "CHAR", char: 12 };
      if (esc === "v") return { type: "CHAR", char: 11 };
      if (esc === "b") return { type: "CHAR", char: 8 };
      return { type: "CHAR", char: esc.charCodeAt(0) };
    } else if (ch === ".") {
      return {
        type: "CLASS",
        ranges: [
          [0, 9],
          [11, 12],
          [14, 0x10ffff],
        ],
        invert: false,
      }; // Standard JS: excludes \n and \r
    } else {
      return { type: "CHAR", char: ch.charCodeAt(0) };
    }
  }

  return parseAlt();
}

interface NFAState {
  id: number;
  transitions: Map<number, NFAState[]>; // char -> states, -1 = epsilon
  accepts?: string;
}

export function compileRegexToDFA(regexes: { pattern: string; tokenName: string }[]) {
  let stateId = 0;
  function newState(): NFAState {
    return { id: stateId++, transitions: new Map() };
  }
  function addEpsilon(from: NFAState, to: NFAState) {
    if (!from.transitions.has(-1)) from.transitions.set(-1, []);
    from.transitions.get(-1)!.push(to);
  }
  function addTrans(from: NFAState, to: NFAState, ch: number) {
    if (!from.transitions.has(ch)) from.transitions.set(ch, []);
    from.transitions.get(ch)!.push(to);
  }

  function buildNFA(ast: AST, start: NFAState, end: NFAState) {
    if (ast.type === "CHAR") {
      addTrans(start, end, ast.char);
    } else if (ast.type === "CLASS") {
      if (ast.invert) {
        // Inverted classes match up to unicode max
        for (let i = 0; i <= 0x10ffff; i++) {
          let match = false;
          for (const [s, e] of ast.ranges) {
            if (i >= s && i <= e) {
              match = true;
              break;
            }
          }
          if (!match) addTrans(start, end, i);
        }
      } else {
        for (const [s, e] of ast.ranges) {
          for (let cp = s; cp <= e; cp++) {
            addTrans(start, end, cp);
          }
        }
      }
    } else if (ast.type === "CONCAT") {
      const mid = newState();
      buildNFA(ast.left, start, mid);
      buildNFA(ast.right, mid, end);
    } else if (ast.type === "ALT") {
      buildNFA(ast.left, start, end);
      buildNFA(ast.right, start, end);
    } else if (ast.type === "STAR") {
      const loopStart = newState();
      const loopEnd = newState();
      addEpsilon(start, loopStart);
      addEpsilon(start, end);
      buildNFA(ast.child, loopStart, loopEnd);
      addEpsilon(loopEnd, loopStart);
      addEpsilon(loopEnd, end);
    } else if (ast.type === "PLUS") {
      const loopStart = newState();
      const loopEnd = newState();
      addEpsilon(start, loopStart);
      buildNFA(ast.child, loopStart, loopEnd);
      addEpsilon(loopEnd, loopStart);
      addEpsilon(loopEnd, end);
    } else if (ast.type === "OPT") {
      buildNFA(ast.child, start, end);
      addEpsilon(start, end);
    }
  }

  const nfaStart = newState();
  for (const r of regexes) {
    const ast = parseRegex(r.pattern, r.tokenName);
    const s = newState();
    const e = newState();
    e.accepts = r.tokenName;
    addEpsilon(nfaStart, s);
    buildNFA(ast, s, e);
  }

  // Subset construction (NFA -> DFA)
  function epsilonClosure(states: NFAState[]): NFAState[] {
    const stack = [...states];
    const closure = new Set(states);
    while (stack.length > 0) {
      const s = stack.pop()!;
      const eps = s.transitions.get(-1);
      if (eps) {
        for (const next of eps) {
          if (!closure.has(next)) {
            closure.add(next);
            stack.push(next);
          }
        }
      }
    }
    return Array.from(closure);
  }

  const dfaStates: { id: number; accepts: string[] | null; transitions: Map<number, number> }[] = [];
  const dfaMap = new Map<string, number>();

  const initialClosure = epsilonClosure([nfaStart]).sort((a, b) => a.id - b.id);
  const initialKey = initialClosure.map((s) => s.id).join(",");

  // Determine accepts rules (all defined regexes that match)
  function getAccepts(closure: NFAState[]): string[] | null {
    const accepts: string[] = [];
    for (const r of regexes) {
      for (const s of closure) {
        if (s.accepts === r.tokenName && !accepts.includes(r.tokenName)) {
          accepts.push(r.tokenName);
        }
      }
    }
    return accepts.length > 0 ? accepts : null;
  }

  dfaStates.push({ id: 0, accepts: getAccepts(initialClosure), transitions: new Map() });
  dfaMap.set(initialKey, 0);

  const queue = [{ id: 0, closure: initialClosure }];
  let nextDfaId = 1;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const activeChars = new Set<number>();
    for (const s of current.closure) {
      for (const ch of s.transitions.keys()) {
        if (ch !== -1) activeChars.add(ch);
      }
    }

    for (const ch of activeChars) {
      const nextNFA = new Set<NFAState>();
      for (const s of current.closure) {
        const trans = s.transitions.get(ch);
        if (trans) {
          for (const n of trans) nextNFA.add(n);
        }
      }
      if (nextNFA.size > 0) {
        const nextClosure = epsilonClosure(Array.from(nextNFA)).sort((a, b) => a.id - b.id);
        const nextKey = nextClosure.map((s) => s.id).join(",");
        let nextId = dfaMap.get(nextKey);
        if (nextId === undefined) {
          nextId = nextDfaId++;
          dfaStates.push({ id: nextId, accepts: getAccepts(nextClosure), transitions: new Map() });
          dfaMap.set(nextKey, nextId);
          queue.push({ id: nextId, closure: nextClosure });
        }
        dfaStates[current.id].transitions.set(ch, nextId);
      }
    }
  }

  // Hopcroft's DFA Minimization
  let P: Set<number>[] = [];
  const acceptGroups = new Map<string | null, Set<number>>();
  for (const s of dfaStates) {
    const acc = s.accepts ? s.accepts.join("|") : null;
    if (!acceptGroups.has(acc)) acceptGroups.set(acc, new Set());
    acceptGroups.get(acc)!.add(s.id);
  }
  for (const p of acceptGroups.values()) {
    P.push(p);
  }

  const W = [...P];
  const allActiveChars = new Set<number>();
  for (const s of dfaStates) {
    for (const ch of s.transitions.keys()) {
      allActiveChars.add(ch);
    }
  }

  while (W.length > 0) {
    const A = W.shift()!;
    for (const ch of allActiveChars) {
      const X = new Set<number>();
      for (const s of dfaStates) {
        const to = s.transitions.get(ch);
        if (to !== undefined && A.has(to)) {
          X.add(s.id);
        }
      }
      if (X.size === 0) continue;

      const newP: Set<number>[] = [];
      for (const Y of P) {
        const intersection = new Set<number>();
        const difference = new Set<number>();
        for (const y of Y) {
          if (X.has(y)) intersection.add(y);
          else difference.add(y);
        }

        if (intersection.size > 0 && difference.size > 0) {
          newP.push(intersection, difference);
          const idx = W.indexOf(Y);
          if (idx !== -1) {
            W.splice(idx, 1);
            W.push(intersection, difference);
          } else {
            if (intersection.size <= difference.size) W.push(intersection);
            else W.push(difference);
          }
        } else {
          newP.push(Y);
        }
      }
      P = newP;
    }
  }

  const stateToPartition = new Map<number, number>();
  for (let i = 0; i < P.length; i++) {
    for (const s of P[i]) {
      stateToPartition.set(s, i);
    }
  }

  const minDfaStates: { id: number; accepts: string[] | null; transitions: Map<number, number> }[] = [];
  for (let i = 0; i < P.length; i++) {
    const rep = Array.from(P[i])[0];
    const oldState = dfaStates[rep];

    const newTrans = new Map<number, number>();
    for (const [ch, to] of oldState.transitions.entries()) {
      newTrans.set(ch, stateToPartition.get(to)!);
    }

    minDfaStates.push({
      id: i,
      accepts: oldState.accepts,
      transitions: newTrans,
    });
  }

  const startPartitionId = stateToPartition.get(0)!;
  if (startPartitionId !== 0) {
    const tmp = minDfaStates[0];
    minDfaStates[0] = minDfaStates[startPartitionId];
    minDfaStates[startPartitionId] = tmp;

    minDfaStates[0].id = 0;
    minDfaStates[startPartitionId].id = startPartitionId;

    for (const s of minDfaStates) {
      for (const [ch, to] of s.transitions.entries()) {
        if (to === 0) s.transitions.set(ch, startPartitionId);
        else if (to === startPartitionId) s.transitions.set(ch, 0);
      }
    }
  }

  // Character Equivalence Classes
  const classVectors: number[][] = [];
  const vectorMap = new Map<string, number>();

  const charToClass = new Int32Array(0x10ffff + 1);
  for (const ch of allActiveChars) {
    const vec = [];
    for (const s of minDfaStates) {
      const to = s.transitions.get(ch);
      vec.push(to === undefined ? -1 : to);
    }
    const key = vec.join(",");
    let cId = vectorMap.get(key);
    if (cId === undefined) {
      cId = classVectors.length;
      classVectors.push(vec);
      vectorMap.set(key, cId);
    }
    charToClass[ch] = cId;
  }

  // Default class (for characters with no transitions)
  const defaultVec = minDfaStates.map(() => -1);
  const defaultKey = defaultVec.join(",");
  let defaultClassId = vectorMap.get(defaultKey);
  if (defaultClassId === undefined) {
    defaultClassId = classVectors.length;
    classVectors.push(defaultVec);
    vectorMap.set(defaultKey, defaultClassId);
  }

  // Fill inactive characters with default class
  for (let ch = 0; ch <= 0x10ffff; ch++) {
    if (!allActiveChars.has(ch)) {
      charToClass[ch] = defaultClassId;
    }
  }

  const classRanges: { s: number; e: number; c: number }[] = [];
  let curStart = 0;
  let curClass = charToClass[0];
  for (let ch = 1; ch <= 0x10ffff; ch++) {
    if (charToClass[ch] !== curClass) {
      classRanges.push({ s: curStart, e: ch - 1, c: curClass });
      curStart = ch;
      curClass = charToClass[ch];
    }
  }
  classRanges.push({ s: curStart, e: 0x10ffff, c: curClass });

  const numClasses = classVectors.length;
  const table = new Int32Array(minDfaStates.length * numClasses);
  for (let s = 0; s < minDfaStates.length; s++) {
    for (let c = 0; c < numClasses; c++) {
      table[s * numClasses + c] = classVectors[c][s];
    }
  }

  return {
    table,
    classRanges,
    numClasses,
    accepts: minDfaStates.map((s) => s.accepts),
    numStates: minDfaStates.length,
  };
}

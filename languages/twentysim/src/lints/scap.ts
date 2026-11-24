// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sequential Causality Assignment Procedure (SCAP) for 20-sim Bond Graphs.
 *
 * Assigns causal strokes to power bonds following Karnopp-Margolis-Rosenberg SCAP:
 * 1. Fixed causality sources: `Se`/`MSe` impose effort (`effort-to-target` if outgoing),
 *    `Sf`/`MSf` impose flow (`effort-to-source` if outgoing).
 * 2. Propagate mandatory causality through `0`-junctions (exactly 1 effort input),
 *    `1`-junctions (exactly 1 flow input), `TF` (effort-in -> effort-out), and `GY` (effort-in -> flow-out).
 * 3. Preferred integral causality on storage elements:
 *    - `C`: prefers flow-in (effort-out)
 *    - `I`: prefers effort-in (flow-out)
 *    If forced to opposite causality, record a derivative causality warning.
 * 4. Arbitrary causality on remaining `R` elements, propagating after each assignment.
 */

import type { BondCausality, TwentySimConnection, TwentySimSubmodel } from "../types.js";

export interface ScapConflict {
  node: string;
  bondId: string;
  detail: string;
  line?: number | undefined;
}

export interface ScapDerivativeWarning {
  element: string;
  kind: "C" | "I";
  bondId: string;
  line?: number | undefined;
}

export interface ScapResult {
  bondCausality: Map<string, BondCausality>;
  conflicts: ScapConflict[];
  derivativeCausality: ScapDerivativeWarning[];
}

interface BondRef {
  conn: TwentySimConnection;
  from: TwentySimSubmodel;
  to: TwentySimSubmodel;
}

/**
 * Does bond `b` deliver effort *into* `sub`?
 * - If `sub` is `from`: effort goes into `from` when causality is `"effort-to-source"`.
 * - If `sub` is `to`: effort goes into `to` when causality is `"effort-to-target"`.
 */
function effortInto(causality: BondCausality, isFrom: boolean): boolean {
  return isFrom ? causality === "effort-to-source" : causality === "effort-to-target";
}

function flowInto(causality: BondCausality, isFrom: boolean): boolean {
  return isFrom ? causality === "effort-to-target" : causality === "effort-to-source";
}

function causalityForEffortOut(isFrom: boolean): BondCausality {
  return isFrom ? "effort-to-target" : "effort-to-source";
}

function causalityForFlowOut(isFrom: boolean): BondCausality {
  return isFrom ? "effort-to-source" : "effort-to-target";
}

/**
 * Runs SCAP on a single container submodel's bond graph.
 */
export function runScap(container: TwentySimSubmodel): ScapResult {
  const bondCausality = new Map<string, BondCausality>();
  const conflicts: ScapConflict[] = [];
  const derivativeCausality: ScapDerivativeWarning[] = [];

  const subByName = new Map<string, TwentySimSubmodel>();
  for (const s of container.submodels) {
    subByName.set(s.name, s);
  }

  const bonds: BondRef[] = [];
  const incident = new Map<string, Array<{ bond: BondRef; isFrom: boolean }>>();

  for (const conn of container.connections) {
    if (conn.kind !== "bond") continue;
    const from = subByName.get(conn.fromSubmodel);
    const to = subByName.get(conn.toSubmodel);
    if (!from || !to) continue;
    const ref: BondRef = { conn, from, to };
    bonds.push(ref);
    bondCausality.set(conn.id, "unassigned");

    if (!incident.has(from.name)) incident.set(from.name, []);
    if (!incident.has(to.name)) incident.set(to.name, []);
    incident.get(from.name)!.push({ bond: ref, isFrom: true });
    incident.get(to.name)!.push({ bond: ref, isFrom: false });
  }

  const assign = (bond: BondRef, desired: BondCausality, reasonNode: string): boolean => {
    const current = bondCausality.get(bond.conn.id) ?? "unassigned";
    if (current === desired) return false;
    if (current !== "unassigned" && current !== "conflict") {
      bondCausality.set(bond.conn.id, "conflict");
      conflicts.push({
        node: reasonNode,
        bondId: bond.conn.id,
        detail: `conflicting causal stroke assignment on bond '${bond.conn.fromSubmodel} => ${bond.conn.toSubmodel}'`,
        line: bond.conn.line,
      });
      return false;
    }
    bondCausality.set(bond.conn.id, desired);
    return true;
  };

  const propagate = (): void => {
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 256) {
      changed = false;

      for (const sub of container.submodels) {
        const inc = incident.get(sub.name) ?? [];
        if (inc.length === 0) continue;

        if (sub.elementKind === "0") {
          // 0-junction: exactly ONE bond imposes effort INTO the 0-junction; all others get effort OUT.
          const effortInBonds = inc.filter(({ bond, isFrom }) => {
            const c = bondCausality.get(bond.conn.id)!;
            return c !== "unassigned" && c !== "conflict" && effortInto(c, isFrom);
          });
          const unassigned = inc.filter(({ bond }) => bondCausality.get(bond.conn.id) === "unassigned");

          if (effortInBonds.length > 1) {
            const extra = effortInBonds[1]!.bond;
            if (bondCausality.get(extra.conn.id) !== "conflict") {
              bondCausality.set(extra.conn.id, "conflict");
              conflicts.push({
                node: sub.name,
                bondId: extra.conn.id,
                detail: `0-junction '${sub.name}' has multiple effort-imposing bonds`,
                line: sub.line ?? extra.conn.line,
              });
            }
          } else if (effortInBonds.length === 1 && unassigned.length > 0) {
            for (const { bond, isFrom } of unassigned) {
              if (assign(bond, causalityForEffortOut(isFrom), sub.name)) changed = true;
            }
          } else if (effortInBonds.length === 0 && unassigned.length === 1) {
            // The lone remaining unassigned bond must impose effort into the 0-junction
            const { bond, isFrom } = unassigned[0]!;
            if (assign(bond, causalityForFlowOut(isFrom), sub.name)) changed = true;
          }
        } else if (sub.elementKind === "1") {
          // 1-junction: exactly ONE bond imposes flow INTO the 1-junction; all others get flow OUT (effort IN).
          const flowInBonds = inc.filter(({ bond, isFrom }) => {
            const c = bondCausality.get(bond.conn.id)!;
            return c !== "unassigned" && c !== "conflict" && flowInto(c, isFrom);
          });
          const unassigned = inc.filter(({ bond }) => bondCausality.get(bond.conn.id) === "unassigned");

          if (flowInBonds.length > 1) {
            const extra = flowInBonds[1]!.bond;
            if (bondCausality.get(extra.conn.id) !== "conflict") {
              bondCausality.set(extra.conn.id, "conflict");
              conflicts.push({
                node: sub.name,
                bondId: extra.conn.id,
                detail: `1-junction '${sub.name}' has multiple flow-imposing bonds`,
                line: sub.line ?? extra.conn.line,
              });
            }
          } else if (flowInBonds.length === 1 && unassigned.length > 0) {
            for (const { bond, isFrom } of unassigned) {
              if (assign(bond, causalityForFlowOut(isFrom), sub.name)) changed = true;
            }
          } else if (flowInBonds.length === 0 && unassigned.length === 1) {
            const { bond, isFrom } = unassigned[0]!;
            if (assign(bond, causalityForEffortOut(isFrom), sub.name)) changed = true;
          }
        } else if ((sub.elementKind === "TF" || sub.elementKind === "MTF") && inc.length === 2) {
          const [a, b] = inc as [{ bond: BondRef; isFrom: boolean }, { bond: BondRef; isFrom: boolean }];
          const ca = bondCausality.get(a.bond.conn.id)!;
          const cb = bondCausality.get(b.bond.conn.id)!;
          if (ca !== "unassigned" && ca !== "conflict" && cb === "unassigned") {
            const desired = effortInto(ca, a.isFrom) ? causalityForEffortOut(b.isFrom) : causalityForFlowOut(b.isFrom);
            if (assign(b.bond, desired, sub.name)) changed = true;
          } else if (cb !== "unassigned" && cb !== "conflict" && ca === "unassigned") {
            const desired = effortInto(cb, b.isFrom) ? causalityForEffortOut(a.isFrom) : causalityForFlowOut(a.isFrom);
            if (assign(a.bond, desired, sub.name)) changed = true;
          }
        } else if ((sub.elementKind === "GY" || sub.elementKind === "MGY") && inc.length === 2) {
          const [a, b] = inc as [{ bond: BondRef; isFrom: boolean }, { bond: BondRef; isFrom: boolean }];
          const ca = bondCausality.get(a.bond.conn.id)!;
          const cb = bondCausality.get(b.bond.conn.id)!;
          if (ca !== "unassigned" && ca !== "conflict" && cb === "unassigned") {
            // Gyrator flips effort <-> flow
            const desired = effortInto(ca, a.isFrom) ? causalityForFlowOut(b.isFrom) : causalityForEffortOut(b.isFrom);
            if (assign(b.bond, desired, sub.name)) changed = true;
          } else if (cb !== "unassigned" && cb !== "conflict" && ca === "unassigned") {
            const desired = effortInto(cb, b.isFrom) ? causalityForFlowOut(a.isFrom) : causalityForEffortOut(a.isFrom);
            if (assign(a.bond, desired, sub.name)) changed = true;
          }
        }
      }
    }
  };

  // Step 1: Fixed causality on sources (Se/MSe impose effort; Sf/MSf impose flow)
  for (const sub of container.submodels) {
    const inc = incident.get(sub.name) ?? [];
    if (sub.elementKind === "Se" || sub.elementKind === "MSe") {
      for (const { bond, isFrom } of inc) {
        assign(bond, causalityForEffortOut(isFrom), sub.name);
      }
    } else if (sub.elementKind === "Sf" || sub.elementKind === "MSf") {
      for (const { bond, isFrom } of inc) {
        assign(bond, causalityForFlowOut(isFrom), sub.name);
      }
    }
  }
  propagate();

  // Step 2: Preferred integral causality on storage elements (C: effort-out, I: flow-out)
  for (const sub of container.submodels) {
    if (sub.elementKind !== "C" && sub.elementKind !== "I") continue;
    const inc = incident.get(sub.name) ?? [];
    for (const { bond, isFrom } of inc) {
      const preferred = sub.elementKind === "C" ? causalityForEffortOut(isFrom) : causalityForFlowOut(isFrom);
      const current = bondCausality.get(bond.conn.id)!;
      if (current === "unassigned") {
        assign(bond, preferred, sub.name);
        propagate();
      } else if (current !== "conflict" && current !== preferred) {
        derivativeCausality.push({
          element: sub.name,
          kind: sub.elementKind,
          bondId: bond.conn.id,
          line: sub.line ?? bond.conn.line,
        });
      }
    }
  }

  // Step 3: Assign arbitrary causality to remaining unassigned R / generic bonds
  for (const bond of bonds) {
    if (bondCausality.get(bond.conn.id) === "unassigned") {
      assign(bond, "effort-to-target", bond.from.name);
      propagate();
    }
  }

  return { bondCausality, conflicts, derivativeCausality };
}

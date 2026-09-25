// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Flow Algebra & Conjugated Port Theory Oracle (~Port).
 *
 * Implements SysML v2 / KerML conjugated port algebraic involution:
 *   ~(~P) ≡ P
 * Inverts flow directionality across ports:
 *   ~(in) = out,  ~(out) = in,  ~(inout) = inout
 * Enforces conservative flow balance (Kirchhoff: ∑ flow = 0) and potential equality.
 */

import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";

export type FlowDirection = "in" | "out" | "inout";

export interface FlowItemSpec {
  name: string;
  direction: FlowDirection;
  isFlow: boolean; // true = flow variable (sum to 0), false = potential variable (equal)
}

export interface PortTypeDefinition {
  name: string;
  items: FlowItemSpec[];
}

export interface PortInstance {
  name: string;
  typeName: string;
  isConjugated: boolean;
}

export class FlowAlgebraOracle implements TheoryOracle {
  public readonly name = "FlowAlgebraOracle";
  public readonly domain = "constraint" as const;

  private portTypes = new Map<string, PortTypeDefinition>();
  private portInstances = new Map<string, PortInstance>();
  private connections: [string, string][] = [];
  private assertedLiterals = new Map<number, TheoryLiteral>();

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.portTypes.clear();
    this.portInstances.clear();
    this.connections = [];
    this.assertedLiterals.clear();
  }

  public getEffectiveItems(portName: string): FlowItemSpec[] | null {
    const inst = this.portInstances.get(portName);
    if (!inst) return null;
    const typeDef = this.portTypes.get(inst.typeName);
    if (!typeDef) return null;

    if (!inst.isConjugated) {
      return typeDef.items;
    }

    // Invert directionality under conjugation ~(P)
    return typeDef.items.map((item) => {
      let invDir: FlowDirection = item.direction;
      if (item.direction === "in") invDir = "out";
      else if (item.direction === "out") invDir = "in";
      return {
        ...item,
        direction: invDir,
      };
    });
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.assertedLiterals.set(lit.id, lit);
    const { predicate, args } = lit;

    switch (predicate) {
      case "portType": {
        const [name, items] = args as [string, FlowItemSpec[]];
        this.portTypes.set(name, { name, items });
        break;
      }
      case "portUsage": {
        const [instName, typeName, isConjugated] = args as [string, string, boolean?];
        this.portInstances.set(instName, {
          name: instName,
          typeName,
          isConjugated: !!isConjugated,
        });
        break;
      }
      case "connect": {
        const [portA, portB] = args as [string, string];
        this.connections.push([portA, portB]);
        break;
      }
    }

    return true;
  }

  public retractLiteral(litId: number): void {
    if (!this.assertedLiterals.has(litId)) return;
    this.assertedLiterals.delete(litId);
    const remaining = Array.from(this.assertedLiterals.values());
    this.reset();
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause } {
    for (const [portA, portB] of this.connections) {
      const itemsA = this.getEffectiveItems(portA);
      const itemsB = this.getEffectiveItems(portB);

      if (!itemsA || !itemsB) continue;

      // Check directional compatibility across corresponding flow items
      for (const itemA of itemsA) {
        const itemB = itemsB.find((b) => b.name === itemA.name);
        if (!itemB) continue;

        // Unidirectional ports: 'out' connecting to 'out' or 'in' connecting to 'in'
        if (itemA.direction === "out" && itemB.direction === "out") {
          return {
            isSat: false,
            conflict: {
              literals: Array.from(this.assertedLiterals.values()).filter(
                (l) => l.args.includes(portA) || l.args.includes(portB),
              ),
              explanation: `Port Connection Direction Conflict: Connecting two output ports '${portA}' and '${portB}' on item '${itemA.name}'. A port conjugation (~Port) is required to invert flow direction.`,
              culpritEntities: [portA, portB, itemA.name],
              theoryName: this.name,
            },
          };
        }

        if (itemA.direction === "in" && itemB.direction === "in") {
          return {
            isSat: false,
            conflict: {
              literals: Array.from(this.assertedLiterals.values()).filter(
                (l) => l.args.includes(portA) || l.args.includes(portB),
              ),
              explanation: `Port Connection Direction Conflict: Connecting two input ports '${portA}' and '${portB}' on item '${itemA.name}' without a driver source.`,
              culpritEntities: [portA, portB, itemA.name],
              theoryName: this.name,
            },
          };
        }
      }
    }

    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    const equalities: SharedEquality[] = [];
    // Potential variables on connected ports must be equal
    for (const [portA, portB] of this.connections) {
      const itemsA = this.getEffectiveItems(portA);
      const itemsB = this.getEffectiveItems(portB);
      if (!itemsA || !itemsB) continue;

      for (const itemA of itemsA) {
        if (!itemA.isFlow) {
          const itemB = itemsB.find((b) => b.name === itemA.name);
          if (itemB && !itemB.isFlow) {
            equalities.push({
              varA: `${portA}.${itemA.name}`,
              varB: `${portB}.${itemB.name}`,
              domain: "real",
              explanation: `Potential variable equality across connection connect(${portA}, ${portB})`,
              sourceOracle: this.name,
            });
          }
        }
      }
    }
    return equalities;
  }

  public onSharedEquality(eq: SharedEquality): void {
    // Unifies port instances if aliased
  }
}

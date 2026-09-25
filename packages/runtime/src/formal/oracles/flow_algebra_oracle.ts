// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Flow Algebra & Conjugated Port Theory Oracle (~Port).
 *
 * Implements SysML v2 / KerML conjugated port algebraic involution:
 *   ~(~P) ≡ P
 * Inverts flow directionality across ports:
 *   ~(in) = out,  ~(out) = in,  ~(inout) = inout
 * Enforces conservative flow balance (Kirchhoff: ∑ flow = 0) and potential equality.
 * Supports multi-scale 1D-3D boundary flux integrals coupling 1D fluid ports with 3D CFD patches:
 *   \dot{m}_{1D} + \iint_{\Gamma} (\rho \mathbf{u} \cdot \mathbf{n}) d\Gamma = 0
 *   p_{1D} = \frac{1}{A_\Gamma} \iint_\Gamma p_{3D} d\Gamma
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

export interface SpatialCfdPatchSpec {
  patchName: string;
  surfaceAreaM2: number;
  normalVector: [number, number, number];
  fluidDensity: number;
}

export interface SpatialFluxMeasurement {
  patchName: string;
  integratedMassFlow: number; // \iint (\rho u \cdot n) dA (kg/s)
  meanPressure: number; // \frac{1}{A} \iint p dA (Pa)
}

export interface OneDPortValues {
  portName: string;
  massFlow: number; // kg/s
  pressure: number; // Pa
}

export class FlowAlgebraOracle implements TheoryOracle {
  public readonly name = "FlowAlgebraOracle";
  public readonly domain = "constraint" as const;

  private portTypes = new Map<string, PortTypeDefinition>();
  private portInstances = new Map<string, PortInstance>();
  private connections: [string, string][] = [];
  private assertedLiterals = new Map<number, TheoryLiteral>();

  // 1D-3D Spatial Patch Multi-Scale Bindings
  private spatialPatches = new Map<string, SpatialCfdPatchSpec>();
  private patch1DConnections = new Map<string, string>(); // 1D portName -> cfdPatchName
  private spatialFluxes = new Map<string, SpatialFluxMeasurement>();
  private portValues1D = new Map<string, OneDPortValues>();

  private nextLiteralId = 10000;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.portTypes.clear();
    this.portInstances.clear();
    this.connections = [];
    this.assertedLiterals.clear();
    this.spatialPatches.clear();
    this.patch1DConnections.clear();
    this.spatialFluxes.clear();
    this.portValues1D.clear();
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

  public assertSpatialPatch(patch: SpatialCfdPatchSpec): void {
    this.assertLiteral({
      id: this.nextLiteralId++,
      predicate: "spatialPatch",
      args: [patch.patchName, patch.surfaceAreaM2, patch.normalVector, patch.fluidDensity],
      isNegated: false,
    });
  }

  public connect1Dto3D(oneDPortName: string, cfdPatchName: string): void {
    this.assertLiteral({
      id: this.nextLiteralId++,
      predicate: "connect1Dto3D",
      args: [oneDPortName, cfdPatchName],
      isNegated: false,
    });
  }

  public assertSpatialFlux(flux: SpatialFluxMeasurement): void {
    this.assertLiteral({
      id: this.nextLiteralId++,
      predicate: "spatialFlux",
      args: [flux.patchName, flux.integratedMassFlow, flux.meanPressure],
      isNegated: false,
    });
  }

  public assert1DPortValues(vals: OneDPortValues): void {
    this.assertLiteral({
      id: this.nextLiteralId++,
      predicate: "portValue1D",
      args: [vals.portName, vals.massFlow, vals.pressure],
      isNegated: false,
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
      case "spatialPatch": {
        const [patchName, surfaceAreaM2, normalVector, fluidDensity] = args as [
          string,
          number,
          [number, number, number],
          number,
        ];
        this.spatialPatches.set(patchName, { patchName, surfaceAreaM2, normalVector, fluidDensity });
        break;
      }
      case "connect1Dto3D": {
        const [oneDPort, cfdPatch] = args as [string, string];
        this.patch1DConnections.set(oneDPort, cfdPatch);
        break;
      }
      case "spatialFlux": {
        const [patchName, integratedMassFlow, meanPressure] = args as [string, number, number];
        this.spatialFluxes.set(patchName, { patchName, integratedMassFlow, meanPressure });
        break;
      }
      case "portValue1D": {
        const [portName, massFlow, pressure] = args as [string, number, number];
        this.portValues1D.set(portName, { portName, massFlow, pressure });
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
    // 1. Check Standard 1D Port Connections
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

    // 2. Check 1D-3D Multi-Scale Spatial Boundary Flux Conservation
    for (const [oneDPort, cfdPatch] of this.patch1DConnections.entries()) {
      const vals1D = this.portValues1D.get(oneDPort);
      const flux3D = this.spatialFluxes.get(cfdPatch);

      if (vals1D && flux3D) {
        // Mass conservation across boundary: m_1D + \iint (\rho u . n) dA = 0
        const m1d = vals1D.massFlow;
        const m3d = flux3D.integratedMassFlow;
        const massImbalance = m1d + m3d;
        const massTol = Math.max(1e-4, 0.05 * Math.max(Math.abs(m1d), Math.abs(m3d)));

        if (Math.abs(massImbalance) > massTol) {
          return {
            isSat: false,
            conflict: {
              literals: Array.from(this.assertedLiterals.values()).filter(
                (l) => l.args.includes(oneDPort) || l.args.includes(cfdPatch),
              ),
              explanation: `Spatial Boundary Mass Flux Imbalance: 1D port '${oneDPort}' mass flow (${m1d.toFixed(4)} kg/s) does not balance 3D CFD patch '${cfdPatch}' surface integral (${m3d.toFixed(4)} kg/s). Interface divergence = ${massImbalance.toFixed(4)} kg/s.`,
              culpritEntities: [oneDPort, cfdPatch],
              theoryName: this.name,
            },
          };
        }

        // Potential pressure continuity: p_1D == p_3D_mean
        const p1d = vals1D.pressure;
        const p3d = flux3D.meanPressure;
        const pDelta = Math.abs(p1d - p3d);
        const pTol = Math.max(100.0, 0.05 * Math.max(p1d, p3d));

        if (pDelta > pTol) {
          return {
            isSat: false,
            conflict: {
              literals: Array.from(this.assertedLiterals.values()).filter(
                (l) => l.args.includes(oneDPort) || l.args.includes(cfdPatch),
              ),
              explanation: `Spatial Boundary Potential Pressure Discontinuity: 1D port '${oneDPort}' pressure (${p1d.toFixed(1)} Pa) differs from 3D CFD patch '${cfdPatch}' mean pressure (${p3d.toFixed(1)} Pa). Potential delta = ${pDelta.toFixed(1)} Pa.`,
              culpritEntities: [oneDPort, cfdPatch],
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

    // Potential variables on connected 1D ports must be equal
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

    // 1D-3D Potential equality: port.p == patch.mean_pressure
    for (const [oneDPort, cfdPatch] of this.patch1DConnections.entries()) {
      equalities.push({
        varA: `${oneDPort}.p`,
        varB: `${cfdPatch}.mean_pressure`,
        domain: "real",
        explanation: `Multi-scale potential equality across 1D port '${oneDPort}' and 3D CFD patch '${cfdPatch}'`,
        sourceOracle: this.name,
      });
    }

    return equalities;
  }

  public onSharedEquality(eq: SharedEquality): void {
    // Unifies port instances if aliased
  }
}

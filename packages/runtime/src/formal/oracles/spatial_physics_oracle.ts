// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Spatial Physics & Continuum Mechanics Theory Oracle.
 *
 * Implements a First-Order Logic (FOL) spatial continuum theory oracle for the
 * Generalized Nelson-Oppen SemanticTheoryCoordinator. Verifies:
 *   1. Material Yield & Ultimate Stress Integrity (FEA von Mises stress vs. allowable stress).
 *   2. Structural Deflection & Clearance Bounds (Displacement limits, stiffness criteria).
 *   3. Fluid-Structure Interaction (FSI) Interface Equilibrium (Action-reaction force balance).
 *   4. CAD Solid & B-Rep Topology Integrity (Watertightness, volume positivity, 3D bounding boxes).
 *
 * Propagates continuous intervals and boundary forces to other theory oracles
 * (e.g. ConstraintTheoryOracle, ToleranceStackOracle, FlowAlgebraOracle).
 */

import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";

export interface StressMeasurementSpec {
  partName: string;
  maxVonMisesPa: number;
  yieldStrengthPa: number;
  safetyFactor?: number | undefined; // Defaults to 1.0, e.g. 1.5 for aerospace/pressure vessels
  ultimateStrengthPa?: number | undefined;
  ultimateSafetyFactor?: number | undefined;
  loadCase?: string | undefined;
}

export interface DeflectionMeasurementSpec {
  partName: string;
  maxDisplacementMeters: number;
  allowableDisplacementMeters: number;
  direction?: "x" | "y" | "z" | "resultant" | undefined;
  location?: string | undefined;
}

export interface FsiEquilibriumSpec {
  interfaceName: string;
  fluidForce: [number, number, number] | number; // N (vector or normal scalar)
  solidForce: [number, number, number] | number; // N (reaction force from solid)
  tolerance?: number | undefined; // N (residual tolerance)
}

export interface DroneSlicingProperties {
  mass: number;
  maxVonMisesPa: number;
  yieldStrengthPa: number;
  frontalAreaM2: number;
  dragCoeff: number;
}

export interface SolidGeometrySpec {
  solidName: string;
  isWatertight: boolean;
  volumeM3: number;
  surfaceAreaM2?: number | undefined;
  nonManifoldEdgeCount?: number | undefined;
  boundingBox?:
    | {
        min: [number, number, number];
        max: [number, number, number];
      }
    | undefined;
}

export interface ConnectionLengthSpec {
  connectionName: string;
  sourcePort: string;
  targetPort: string;
  maxLengthMeters: number;
  minLengthMeters?: number | undefined;
  requireRegisteredPorts?: boolean | undefined;
}

export class SpatialPhysicsOracle implements TheoryOracle {
  public readonly name = "SpatialPhysicsOracle";
  public readonly domain = "spatial_physics" as const;

  private stressSpecs = new Map<string, StressMeasurementSpec>();
  private deflectionSpecs = new Map<string, DeflectionMeasurementSpec>();
  private fsiSpecs = new Map<string, FsiEquilibriumSpec>();
  private solidSpecs = new Map<string, SolidGeometrySpec>();
  private portPositions = new Map<string, { x: number; y: number; z: number }>();
  private connectionLengthSpecs = new Map<string, ConnectionLengthSpec>();
  private droneProps?: DroneSlicingProperties | undefined;
  private externalBounds = new Map<string, [number, number]>();

  private assertedLiterals = new Map<number, TheoryLiteral>();
  private nextLiteralId = 20000;

  private levelStack: {
    stressSpecs: Map<string, StressMeasurementSpec>;
    deflectionSpecs: Map<string, DeflectionMeasurementSpec>;
    fsiSpecs: Map<string, FsiEquilibriumSpec>;
    solidSpecs: Map<string, SolidGeometrySpec>;
    portPositions: Map<string, { x: number; y: number; z: number }>;
    connectionLengthSpecs: Map<string, ConnectionLengthSpec>;
    droneProps?: DroneSlicingProperties | undefined;
    externalBounds: Map<string, [number, number]>;
    externalBoundJustifications: Map<string, Set<number>>;
    assertedLitIds: number[];
  }[] = [];

  private externalBoundJustifications = new Map<string, Set<number>>();

  constructor() {
    this.reset();
  }

  public assertDroneSlicingProperties(props: DroneSlicingProperties): void {
    this.assertLiteral({
      id: this.nextLiteralId++,
      predicate: "droneSlicing",
      args: [props],
      domain: this.domain,
    });
  }

  public assertPortPosition(portName: string, pos: { x: number; y: number; z: number }): void {
    this.assertLiteral({
      id: this.nextLiteralId++,
      predicate: "portPosition",
      args: [portName, pos],
      domain: this.domain,
    });
  }

  public assertConnectionLengthBound(spec: ConnectionLengthSpec): void {
    this.assertLiteral({
      id: this.nextLiteralId++,
      predicate: "connectionLengthBound",
      args: [spec],
      domain: this.domain,
    });
  }

  public reset(): void {
    this.stressSpecs.clear();
    this.deflectionSpecs.clear();
    this.fsiSpecs.clear();
    this.solidSpecs.clear();
    this.portPositions.clear();
    this.connectionLengthSpecs.clear();
    this.droneProps = undefined;
    this.externalBounds.clear();
    this.externalBoundJustifications.clear();
    this.assertedLiterals.clear();
    this.levelStack = [];
  }

  public pushLevel(): void {
    const extJustSnap = new Map<string, Set<number>>();
    for (const [k, v] of this.externalBoundJustifications) {
      extJustSnap.set(k, new Set(v));
    }
    this.levelStack.push({
      stressSpecs: new Map(this.stressSpecs),
      deflectionSpecs: new Map(this.deflectionSpecs),
      fsiSpecs: new Map(this.fsiSpecs),
      solidSpecs: new Map(this.solidSpecs),
      portPositions: new Map(this.portPositions),
      connectionLengthSpecs: new Map(this.connectionLengthSpecs),
      droneProps: this.droneProps ? { ...this.droneProps } : undefined,
      externalBounds: new Map(this.externalBounds),
      externalBoundJustifications: extJustSnap,
      assertedLitIds: [],
    });
  }

  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;
    this.stressSpecs = top.stressSpecs;
    this.deflectionSpecs = top.deflectionSpecs;
    this.fsiSpecs = top.fsiSpecs;
    this.solidSpecs = top.solidSpecs;
    this.portPositions = top.portPositions;
    this.connectionLengthSpecs = top.connectionLengthSpecs;
    this.droneProps = top.droneProps;
    this.externalBounds = top.externalBounds;
    this.externalBoundJustifications = top.externalBoundJustifications;
    for (const litId of top.assertedLitIds) {
      this.assertedLiterals.delete(litId);
    }
  }

  // --- Strongly typed assertion helpers ---

  public assertStressMeasurement(spec: StressMeasurementSpec): void {
    this.assertLiteral({
      id: this.nextLiteralId++,
      predicate: "stressMeasurement",
      args: [spec],
      domain: this.domain,
    });
  }

  public assertDeflectionMeasurement(spec: DeflectionMeasurementSpec): void {
    this.assertLiteral({
      id: this.nextLiteralId++,
      predicate: "deflectionMeasurement",
      args: [spec],
      domain: this.domain,
    });
  }

  public assertFsiForceEquilibrium(spec: FsiEquilibriumSpec): void {
    this.assertLiteral({
      id: this.nextLiteralId++,
      predicate: "fsiForceEquilibrium",
      args: [spec],
      domain: this.domain,
    });
  }

  public assertSolidGeometry(spec: SolidGeometrySpec): void {
    this.assertLiteral({
      id: this.nextLiteralId++,
      predicate: "solidGeometry",
      args: [spec],
      domain: this.domain,
    });
  }

  // --- TheoryOracle Implementation ---

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.assertedLiterals.set(lit.id, lit);
    if (this.levelStack.length > 0) {
      this.levelStack[this.levelStack.length - 1]!.assertedLitIds.push(lit.id);
    }

    const { predicate, args } = lit;

    switch (predicate) {
      case "droneSlicing": {
        const props = args[0] as DroneSlicingProperties;
        if (props) {
          this.droneProps = { ...props };
        }
        break;
      }
      case "stressMeasurement":
      case "feaStress": {
        if (args[0] && typeof args[0] === "object" && "partName" in args[0]) {
          const spec = args[0] as StressMeasurementSpec;
          this.stressSpecs.set(spec.partName, { ...spec });
        } else if (args.length >= 3) {
          const [partName, maxVonMisesPa, yieldStrengthPa, safetyFactor, ultimateStrengthPa, ultimateSafetyFactor] =
            args as [string, number, number, number?, number?, number?];
          this.stressSpecs.set(partName, {
            partName,
            maxVonMisesPa,
            yieldStrengthPa,
            safetyFactor: safetyFactor ?? 1.0,
            ultimateStrengthPa,
            ultimateSafetyFactor,
          });
        }
        break;
      }

      case "deflectionMeasurement":
      case "feaDeflection": {
        if (args[0] && typeof args[0] === "object" && "partName" in args[0]) {
          const spec = args[0] as DeflectionMeasurementSpec;
          this.deflectionSpecs.set(spec.partName, { ...spec });
        } else if (args.length >= 3) {
          const [partName, maxDisplacementMeters, allowableDisplacementMeters, direction, location] = args as [
            string,
            number,
            number,
            ("x" | "y" | "z" | "resultant")?,
            string?,
          ];
          this.deflectionSpecs.set(partName, {
            partName,
            maxDisplacementMeters,
            allowableDisplacementMeters,
            direction,
            location,
          });
        }
        break;
      }

      case "fsiForceEquilibrium":
      case "fsiCoupling": {
        if (args[0] && typeof args[0] === "object" && "interfaceName" in args[0]) {
          const spec = args[0] as FsiEquilibriumSpec;
          this.fsiSpecs.set(spec.interfaceName, { ...spec });
        } else if (args.length >= 3) {
          const [interfaceName, fluidForce, solidForce, tolerance] = args as [
            string,
            [number, number, number] | number,
            [number, number, number] | number,
            number?,
          ];
          this.fsiSpecs.set(interfaceName, {
            interfaceName,
            fluidForce,
            solidForce,
            tolerance,
          });
        }
        break;
      }

      case "solidGeometry":
      case "cadSolid": {
        if (args[0] && typeof args[0] === "object" && "solidName" in args[0]) {
          const spec = args[0] as SolidGeometrySpec;
          this.solidSpecs.set(spec.solidName, { ...spec });
        } else if (args.length >= 3) {
          const [solidName, isWatertight, volumeM3, surfaceAreaM2] = args as [string, boolean, number, number?];
          this.solidSpecs.set(solidName, {
            solidName,
            isWatertight: Boolean(isWatertight),
            volumeM3: Number(volumeM3),
            surfaceAreaM2: surfaceAreaM2 !== undefined ? Number(surfaceAreaM2) : undefined,
          });
        }
        break;
      }

      case "portPosition":
      case "portCoordinate": {
        const [portName, pos] = args as [string, { x: number; y: number; z: number } | [number, number, number]];
        if (typeof portName === "string" && pos) {
          if (Array.isArray(pos) && pos.length >= 3) {
            this.portPositions.set(portName, { x: Number(pos[0]), y: Number(pos[1]), z: Number(pos[2]) });
          } else if (typeof pos === "object" && "x" in pos && "y" in pos && "z" in pos) {
            this.portPositions.set(portName, { x: Number(pos.x), y: Number(pos.y), z: Number(pos.z) });
          }
        }
        break;
      }

      case "connectionLengthBound":
      case "wireLengthBound":
      case "pipeLengthBound": {
        if (args[0] && typeof args[0] === "object" && "connectionName" in args[0]) {
          const spec = args[0] as ConnectionLengthSpec;
          this.connectionLengthSpecs.set(spec.connectionName, { ...spec });
        } else if (args.length >= 4) {
          const [connectionName, sourcePort, targetPort, maxLengthMeters, minLengthMeters] = args as [
            string,
            string,
            string,
            number,
            number?,
          ];
          this.connectionLengthSpecs.set(connectionName, {
            connectionName,
            sourcePort,
            targetPort,
            maxLengthMeters: Number(maxLengthMeters),
            minLengthMeters: minLengthMeters !== undefined ? Number(minLengthMeters) : undefined,
          });
        }
        break;
      }

      case "bound": {
        const [varName, op, val] = args as [string, "<=" | "<" | ">=" | ">" | "==", number];
        if (typeof varName === "string" && typeof val === "number") {
          const curr = this.externalBounds.get(varName) ?? [-Infinity, Infinity];
          let lo = curr[0];
          let hi = curr[1];
          if (op === "<=" || op === "<") hi = Math.min(hi, val);
          else if (op === ">=" || op === ">") lo = Math.max(lo, val);
          else if (op === "==") {
            lo = Math.max(lo, val);
            hi = Math.min(hi, val);
          }
          this.externalBounds.set(varName, [lo, hi]);
        }
        break;
      }

      case "interval": {
        const [varName, lo, hi] = args as [string, number, number];
        if (typeof varName === "string" && typeof lo === "number" && typeof hi === "number") {
          const curr = this.externalBounds.get(varName) ?? [-Infinity, Infinity];
          this.externalBounds.set(varName, [Math.max(curr[0], lo), Math.min(curr[1], hi)]);
        }
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

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    // 0. Drone Multi-Physics Slicing Stress Verification
    if (this.droneProps && this.droneProps.maxVonMisesPa > this.droneProps.yieldStrengthPa) {
      return {
        isSat: false,
        conflict: {
          literals: Array.from(this.assertedLiterals.values()).filter((l) => l.predicate === "droneSlicing"),
          explanation: `Drone arm structural yield failure: maximum stress ${(this.droneProps.maxVonMisesPa / 1e6).toFixed(1)} MPa exceeds yield limit ${(this.droneProps.yieldStrengthPa / 1e6).toFixed(1)} MPa.`,
          culpritEntities: ["DroneArm"],
          theoryName: this.name,
        },
      };
    }

    // 1. Material Yield & Ultimate Stress Verification (FEA)
    for (const [partName, spec] of this.stressSpecs.entries()) {
      const sf = spec.safetyFactor && spec.safetyFactor > 0 ? spec.safetyFactor : 1.0;
      const allowableYieldStress = spec.yieldStrengthPa / sf;

      if (spec.maxVonMisesPa > allowableYieldStress) {
        const marginOfSafety = allowableYieldStress / spec.maxVonMisesPa - 1.0;
        return {
          isSat: false,
          conflict: {
            literals: this.findLiteralsReferencing(partName),
            explanation: `Material Yield Stress Failure: Part '${partName}' maximum von Mises stress (${(spec.maxVonMisesPa / 1e6).toFixed(2)} MPa) exceeds allowable yield stress (${(allowableYieldStress / 1e6).toFixed(2)} MPa, yield: ${(spec.yieldStrengthPa / 1e6).toFixed(2)} MPa with safety factor Sf=${sf.toFixed(2)}). Margin of safety MS = ${marginOfSafety.toFixed(3)} < 0.`,
            culpritEntities: [partName],
            theoryName: this.name,
          },
        };
      }

      if (spec.ultimateStrengthPa !== undefined && spec.ultimateStrengthPa > 0) {
        const ultSf = spec.ultimateSafetyFactor && spec.ultimateSafetyFactor > 0 ? spec.ultimateSafetyFactor : 1.5;
        const allowableUltimateStress = spec.ultimateStrengthPa / ultSf;
        if (spec.maxVonMisesPa > allowableUltimateStress) {
          const marginOfSafety = allowableUltimateStress / spec.maxVonMisesPa - 1.0;
          return {
            isSat: false,
            conflict: {
              literals: this.findLiteralsReferencing(partName),
              explanation: `Material Ultimate Tensile Stress Failure: Part '${partName}' maximum von Mises stress (${(spec.maxVonMisesPa / 1e6).toFixed(2)} MPa) exceeds allowable ultimate stress (${(allowableUltimateStress / 1e6).toFixed(2)} MPa, ultimate: ${(spec.ultimateStrengthPa / 1e6).toFixed(2)} MPa with safety factor Sf=${ultSf.toFixed(2)}). Margin of safety MS = ${marginOfSafety.toFixed(3)} < 0.`,
              culpritEntities: [partName],
              theoryName: this.name,
            },
          };
        }
      }

      // Check against external upper bounds propagated from other theories
      const extBound = this.externalBounds.get(`${partName}.max_von_mises`);
      if (extBound && spec.maxVonMisesPa > extBound[1] + 1e-6) {
        const culprits = this.findLiteralsReferencing(partName);
        this.appendBoundJustifications(culprits, `${partName}.max_von_mises`);
        return {
          isSat: false,
          conflict: {
            literals: culprits,
            explanation: `Stress Bound Constraint Violation: Part '${partName}' von Mises stress (${(spec.maxVonMisesPa / 1e6).toFixed(2)} MPa) violates external theory bound constraint upper limit (${(extBound[1] / 1e6).toFixed(2)} MPa).`,
            culpritEntities: [partName],
            theoryName: this.name,
          },
        };
      }
    }

    // 2. Structural Deflection Bounds Verification
    for (const [partName, spec] of this.deflectionSpecs.entries()) {
      if (spec.maxDisplacementMeters > spec.allowableDisplacementMeters) {
        const excess = spec.maxDisplacementMeters - spec.allowableDisplacementMeters;
        const locInfo = spec.location ? ` at location '${spec.location}'` : "";
        const dirInfo = spec.direction ? ` [${spec.direction}-axis]` : "";
        return {
          isSat: false,
          conflict: {
            literals: this.findLiteralsReferencing(partName),
            explanation: `Structural Deflection Exceeded: Part '${partName}'${locInfo}${dirInfo} maximum displacement (${(spec.maxDisplacementMeters * 1e3).toFixed(3)} mm) exceeds allowable deflection limit (${(spec.allowableDisplacementMeters * 1e3).toFixed(3)} mm) by ${(excess * 1e3).toFixed(3)} mm.`,
            culpritEntities: [partName],
            theoryName: this.name,
          },
        };
      }

      const extBound = this.externalBounds.get(`${partName}.max_displacement`);
      if (extBound && spec.maxDisplacementMeters > extBound[1] + 1e-7) {
        const culprits = this.findLiteralsReferencing(partName);
        this.appendBoundJustifications(culprits, `${partName}.max_displacement`);
        return {
          isSat: false,
          conflict: {
            literals: culprits,
            explanation: `Deflection Bound Constraint Violation: Part '${partName}' displacement (${(spec.maxDisplacementMeters * 1e3).toFixed(3)} mm) violates external theory bound upper limit (${(extBound[1] * 1e3).toFixed(3)} mm).`,
            culpritEntities: [partName],
            theoryName: this.name,
          },
        };
      }
    }

    // 3. Fluid-Structure Interface (FSI) Force Equilibrium
    for (const [ifaceName, spec] of this.fsiSpecs.entries()) {
      let residual = 0;
      let fluidMag = 0;
      let solidMag = 0;

      if (Array.isArray(spec.fluidForce) && Array.isArray(spec.solidForce)) {
        // 3D Force Vectors: F_fluid + F_solid = 0
        const rx = spec.fluidForce[0] + spec.solidForce[0];
        const ry = spec.fluidForce[1] + spec.solidForce[1];
        const rz = spec.fluidForce[2] + spec.solidForce[2];
        residual = Math.sqrt(rx * rx + ry * ry + rz * rz);
        fluidMag = Math.sqrt(spec.fluidForce[0] ** 2 + spec.fluidForce[1] ** 2 + spec.fluidForce[2] ** 2);
        solidMag = Math.sqrt(spec.solidForce[0] ** 2 + spec.solidForce[1] ** 2 + spec.solidForce[2] ** 2);
      } else {
        // Scalar normal forces: F_fluid + F_solid = 0
        const ff = typeof spec.fluidForce === "number" ? spec.fluidForce : spec.fluidForce[0];
        const sf = typeof spec.solidForce === "number" ? spec.solidForce : spec.solidForce[0];
        residual = Math.abs(ff + sf);
        fluidMag = Math.abs(ff);
        solidMag = Math.abs(sf);
      }

      const tol =
        spec.tolerance !== undefined && spec.tolerance > 0
          ? spec.tolerance
          : Math.max(1e-3, 0.05 * Math.max(fluidMag, solidMag));

      if (residual > tol) {
        return {
          isSat: false,
          conflict: {
            literals: this.findLiteralsReferencing(ifaceName),
            explanation: `FSI Interface Force Disequilibrium: Interface '${ifaceName}' fluid force (${fluidMag.toFixed(2)} N) and solid reaction force (${solidMag.toFixed(2)} N) have residual ||F_fluid + F_solid|| = ${residual.toFixed(2)} N, exceeding equilibrium tolerance ${tol.toFixed(2)} N. Action-reaction equilibrium violated across fluid-solid boundary.`,
            culpritEntities: [ifaceName],
            theoryName: this.name,
          },
        };
      }
    }

    // 4. CAD Solid & B-Rep Topology Integrity
    for (const [solidName, spec] of this.solidSpecs.entries()) {
      if (!spec.isWatertight || (spec.nonManifoldEdgeCount !== undefined && spec.nonManifoldEdgeCount > 0)) {
        const edgeDetails =
          spec.nonManifoldEdgeCount !== undefined ? ` (${spec.nonManifoldEdgeCount} non-manifold edges detected)` : "";
        return {
          isSat: false,
          conflict: {
            literals: this.findLiteralsReferencing(solidName),
            explanation: `CAD Solid Non-Watertight B-Rep Conflict: Solid '${solidName}' is not watertight${edgeDetails}. Mesh discretization cannot proceed on non-closed boundary representation.`,
            culpritEntities: [solidName],
            theoryName: this.name,
          },
        };
      }

      if (spec.volumeM3 <= 0) {
        return {
          isSat: false,
          conflict: {
            literals: this.findLiteralsReferencing(solidName),
            explanation: `CAD Solid Inverted/Degenerate Geometry Conflict: Solid '${solidName}' has non-positive volume (${spec.volumeM3.toExponential(3)} m³).`,
            culpritEntities: [solidName],
            theoryName: this.name,
          },
        };
      }

      if (spec.boundingBox) {
        const { min, max } = spec.boundingBox;
        if (min[0] >= max[0] || min[1] >= max[1] || min[2] >= max[2]) {
          return {
            isSat: false,
            conflict: {
              literals: this.findLiteralsReferencing(solidName),
              explanation: `CAD Solid Degenerate Bounding Box Conflict: Solid '${solidName}' has min >= max in bounding box dimensions.`,
              culpritEntities: [solidName],
              theoryName: this.name,
            },
          };
        }
      }
    }

    // 5. Physical Wire/Pipe Connection Length Bounds
    for (const [connName, spec] of this.connectionLengthSpecs.entries()) {
      const posA = this.portPositions.get(spec.sourcePort);
      const posB = this.portPositions.get(spec.targetPort);
      if (!posA || !posB) {
        if (spec.requireRegisteredPorts) {
          const missing = !posA ? spec.sourcePort : spec.targetPort;
          return {
            isSat: false,
            conflict: {
              literals: this.findLiteralsReferencing(connName),
              explanation: `Unregistered Port Position Conflict: Connection '${connName}' references port '${missing}' which has no registered 3D spatial coordinates.`,
              culpritEntities: [connName, missing],
              theoryName: this.name,
            },
          };
        }
        // Skip unresolved ports rather than silently defaulting to { x: 0, y: 0, z: 0 }
        continue;
      }
      const dx = posB.x - posA.x;
      const dy = posB.y - posA.y;
      const dz = posB.z - posA.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > spec.maxLengthMeters) {
        return {
          isSat: false,
          conflict: {
            literals: this.findLiteralsReferencing(connName),
            explanation: `Physical Connection Length Exceeded: Connection '${connName}' between '${spec.sourcePort}' and '${spec.targetPort}' requires Euclidean span ${dist.toFixed(3)} m, exceeding maximum allowable length ${spec.maxLengthMeters.toFixed(3)} m.`,
            culpritEntities: [connName, spec.sourcePort, spec.targetPort],
            theoryName: this.name,
          },
        };
      }
      if (spec.minLengthMeters !== undefined && dist < spec.minLengthMeters) {
        return {
          isSat: false,
          conflict: {
            literals: this.findLiteralsReferencing(connName),
            explanation: `Physical Connection Minimum Bend/Span Violation: Connection '${connName}' between '${spec.sourcePort}' and '${spec.targetPort}' has span ${dist.toFixed(3)} m, below minimum allowable length ${spec.minLengthMeters.toFixed(3)} m.`,
            culpritEntities: [connName, spec.sourcePort, spec.targetPort],
            theoryName: this.name,
          },
        };
      }
    }

    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    const equalities: SharedEquality[] = [];

    // Propagate max von Mises stress intervals
    for (const [partName, spec] of this.stressSpecs.entries()) {
      equalities.push({
        varA: `${partName}.max_von_mises`,
        varB: `${partName}.max_von_mises`,
        domain: "interval",
        bounds: [0, spec.maxVonMisesPa],
        explanation: `FEA simulated maximum von Mises stress on '${partName}'`,
        sourceOracle: this.name,
      });

      const sf = spec.safetyFactor ?? 1.0;
      equalities.push({
        varA: `${partName}.allowable_yield_stress`,
        varB: `${partName}.allowable_yield_stress`,
        domain: "interval",
        bounds: [spec.yieldStrengthPa / sf, spec.yieldStrengthPa / sf],
        explanation: `Material allowable yield stress for '${partName}' with safety factor ${sf}`,
        sourceOracle: this.name,
      });
    }

    // Propagate deflection intervals
    for (const [partName, spec] of this.deflectionSpecs.entries()) {
      equalities.push({
        varA: `${partName}.max_displacement`,
        varB: `${partName}.max_displacement`,
        domain: "interval",
        bounds: [0, spec.maxDisplacementMeters],
        explanation: `FEA simulated structural deflection on '${partName}'`,
        sourceOracle: this.name,
      });
    }

    // Propagate CAD solid volume bounds
    for (const [solidName, spec] of this.solidSpecs.entries()) {
      equalities.push({
        varA: `${solidName}.volume`,
        varB: `${solidName}.volume`,
        domain: "interval",
        bounds: [spec.volumeM3, spec.volumeM3],
        explanation: `CAD B-Rep solid volume for '${solidName}'`,
        sourceOracle: this.name,
      });

      if (spec.surfaceAreaM2 !== undefined) {
        equalities.push({
          varA: `${solidName}.surface_area`,
          varB: `${solidName}.surface_area`,
          domain: "interval",
          bounds: [spec.surfaceAreaM2, spec.surfaceAreaM2],
          explanation: `CAD B-Rep surface area for '${solidName}'`,
          sourceOracle: this.name,
        });
      }
    }

    if (this.droneProps) {
      equalities.push({
        varA: "DroneSimulation.m",
        varB: "DroneSimulation.m",
        domain: "interval",
        bounds: [this.droneProps.mass, this.droneProps.mass],
        explanation: `FEA structural sizing derived mass m = ${this.droneProps.mass} kg`,
        sourceOracle: this.name,
      });
      equalities.push({
        varA: "DroneSimulation.A",
        varB: "DroneSimulation.A",
        domain: "interval",
        bounds: [this.droneProps.frontalAreaM2, this.droneProps.frontalAreaM2],
        explanation: `CAD projected frontal area A = ${this.droneProps.frontalAreaM2} m²`,
        sourceOracle: this.name,
      });
      equalities.push({
        varA: "DroneSimulation.Cd",
        varB: "DroneSimulation.Cd",
        domain: "interval",
        bounds: [this.droneProps.dragCoeff, this.droneProps.dragCoeff],
        explanation: `CFD aerodynamic drag polar Cd = ${this.droneProps.dragCoeff}`,
        sourceOracle: this.name,
      });
    }

    return equalities;
  }

  public onSharedEquality(eq: SharedEquality): void {
    if (eq.bounds) {
      if (eq.varA === eq.varB) {
        this.externalBounds.set(eq.varA, [...eq.bounds]);
      } else {
        this.externalBounds.set(eq.varA, [...eq.bounds]);
        this.externalBounds.set(eq.varB, [...eq.bounds]);
      }
      const justs = eq.justifications ?? eq.justification ?? [];
      if (justs.length > 0) {
        if (!this.externalBoundJustifications.has(eq.varA)) {
          this.externalBoundJustifications.set(eq.varA, new Set());
        }
        for (const j of justs) this.externalBoundJustifications.get(eq.varA)!.add(j);
        if (eq.varA !== eq.varB) {
          if (!this.externalBoundJustifications.has(eq.varB)) {
            this.externalBoundJustifications.set(eq.varB, new Set());
          }
          for (const j of justs) this.externalBoundJustifications.get(eq.varB)!.add(j);
        }
      }
    }
  }

  public getModel(): Record<string, any> {
    const stressStatus: Record<string, any> = {};
    for (const [name, spec] of this.stressSpecs.entries()) {
      const sf = spec.safetyFactor ?? 1.0;
      const allowable = spec.yieldStrengthPa / sf;
      stressStatus[name] = {
        maxVonMisesPa: spec.maxVonMisesPa,
        allowableYieldStressPa: allowable,
        safetyFactor: sf,
        marginOfSafety: allowable / spec.maxVonMisesPa - 1.0,
        status: spec.maxVonMisesPa <= allowable ? "SAT" : "UNSAT",
      };
    }

    const deflectionStatus: Record<string, any> = {};
    for (const [name, spec] of this.deflectionSpecs.entries()) {
      deflectionStatus[name] = {
        maxDisplacementMeters: spec.maxDisplacementMeters,
        allowableDisplacementMeters: spec.allowableDisplacementMeters,
        status: spec.maxDisplacementMeters <= spec.allowableDisplacementMeters ? "SAT" : "UNSAT",
      };
    }

    const fsiStatus: Record<string, any> = {};
    for (const [name, spec] of this.fsiSpecs.entries()) {
      fsiStatus[name] = {
        fluidForce: spec.fluidForce,
        solidForce: spec.solidForce,
        tolerance: spec.tolerance,
      };
    }

    const solidStatus: Record<string, any> = {};
    for (const [name, spec] of this.solidSpecs.entries()) {
      solidStatus[name] = {
        isWatertight: spec.isWatertight,
        volumeM3: spec.volumeM3,
        surfaceAreaM2: spec.surfaceAreaM2,
        status: spec.isWatertight && spec.volumeM3 > 0 ? "SAT" : "UNSAT",
      };
    }

    return {
      stresses: stressStatus,
      deflections: deflectionStatus,
      fsi: fsiStatus,
      solids: solidStatus,
    };
  }

  private appendBoundJustifications(culprits: TheoryLiteral[], varName: string): void {
    const justs = this.externalBoundJustifications.get(varName);
    if (!justs) return;
    const existingIds = new Set(culprits.map((c) => c.id));
    for (const jId of justs) {
      if (!existingIds.has(jId)) {
        const lit = this.assertedLiterals.get(jId);
        if (lit) {
          culprits.push(lit);
          existingIds.add(jId);
        } else {
          culprits.push({
            id: jId,
            predicate: "crossTheoryAntecedent",
            args: [varName],
            isNegated: false,
          });
          existingIds.add(jId);
        }
      }
    }
  }

  private findLiteralsReferencing(entity: string): TheoryLiteral[] {
    return Array.from(this.assertedLiterals.values()).filter((l) => {
      if (l.args.includes(entity)) return true;
      for (const a of l.args) {
        if (a && typeof a === "object") {
          if (
            a.partName === entity ||
            a.interfaceName === entity ||
            a.solidName === entity ||
            a.connectionName === entity ||
            a.sourcePort === entity ||
            a.targetPort === entity
          ) {
            return true;
          }
        }
      }
      return false;
    });
  }
}

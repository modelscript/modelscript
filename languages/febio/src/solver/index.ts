// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/febio — Hyperelastic & Biphasic Continuum Mechanics Solver and DAE Lowering.
 *
 * Evaluates neo-Hookean and Mooney-Rivlin strain energy density:
 *   W = C1 * (I1 - 3) + C2 * (I2 - 3) + 0.5 * K * (J - 1)^2
 * principal Cauchy stress tensor σ, von Mises stress, element signed volumes,
 * biphasic Darcy fluid flux, nodal displacements, and lowers biomechanics models
 * into ModelScript's linear-memory DAEBuilder arena.
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { computeElementJacobianDeterminant, computeElementSignedVolume } from "../lints/rules.js";
import type { FebioDocument, FebioMaterial, FebioNode } from "../types.js";

export interface FebioMaterialConstitutiveState {
  materialId: string;
  materialName: string;
  materialType: string;
  c1: number;
  c2: number;
  bulkModulusK: number;
  shearModulusMu: number;
  youngsModulusE: number;
  poissonRatioNu: number;
  principalStretches: [number, number, number];
  invariantI1: number;
  invariantI2: number;
  jacobianJ: number;
  strainEnergyDensityW: number;
  cauchyStress: [number, number, number];
  vonMisesStress: number;
  darcyFluidFlux?: number | undefined;
}

export interface FebioNodalDisplacement {
  nodeId: string;
  ux: number;
  uy: number;
  uz: number;
  magnitude: number;
}

export interface FebioElementQuality {
  elementId: string;
  elementType: string;
  jacobianDeterminant: number;
  signedVolume: number;
}

export interface FebioMechanicsSummary {
  title: string;
  totalVolume: number;
  invertedElementCount: number;
  maxDisplacementMagnitude: number;
  maxVonMisesStress: number;
  totalStrainEnergy: number;
  materials: FebioMaterialConstitutiveState[];
  nodalDisplacements: FebioNodalDisplacement[];
  elementQualities: FebioElementQuality[];
}

export interface SolveHyperelasticOptions {
  stretch?: number | undefined;
  volumeRatioJ?: number | undefined;
}

export function deriveConstitutiveParameters(mat: FebioMaterial): {
  c1: number;
  c2: number;
  bulkModulusK: number;
  shearModulusMu: number;
  youngsModulusE: number;
  poissonRatioNu: number;
} {
  if (mat.c1 !== undefined || mat.c2 !== undefined) {
    const c1 = mat.c1 ?? 0.1;
    const c2 = mat.c2 ?? 0.0;
    const mu = 2.0 * (c1 + c2);
    const k = mat.k ?? mu * 10.0;
    const denom = 3.0 * k + mu;
    const E = denom > 0 ? (9.0 * k * mu) / denom : 3.0 * mu;
    const nu = denom > 0 ? (3.0 * k - 2.0 * mu) / (2.0 * denom) : 0.45;
    return {
      c1,
      c2,
      bulkModulusK: k,
      shearModulusMu: mu,
      youngsModulusE: E,
      poissonRatioNu: nu,
    };
  }

  const E = mat.E ?? 1000.0;
  const nu = mat.v !== undefined ? Math.min(0.499, Math.max(-0.99, mat.v)) : 0.45;
  const mu = E / (2.0 * (1.0 + nu));
  const k = mat.k ?? E / (3.0 * (1.0 - 2.0 * nu));
  const c1 = mu / 2.0;
  const c2 = 0.0;

  return {
    c1,
    c2,
    bulkModulusK: k,
    shearModulusMu: mu,
    youngsModulusE: E,
    poissonRatioNu: nu,
  };
}

export function solveHyperelasticMechanics(
  doc: FebioDocument,
  options?: SolveHyperelasticOptions,
): FebioMechanicsSummary {
  const nodeById = new Map<string, FebioNode>();
  for (const n of doc.nodes) {
    nodeById.set(n.id, n);
  }

  // 1. Element volumes and Jacobians
  const elementQualities: FebioElementQuality[] = [];
  let totalVolume = 0;
  let invertedElementCount = 0;

  for (const el of doc.elements) {
    const detJ = computeElementJacobianDeterminant(el, nodeById) ?? 0;
    const vol = computeElementSignedVolume(el, nodeById) ?? 0;
    if ((el.type === "tet4" || el.type === "hex8") && detJ <= 1e-12) {
      invertedElementCount++;
    }
    if (vol > 0) {
      totalVolume += vol;
    }
    elementQualities.push({
      elementId: el.id,
      elementType: el.type,
      jacobianDeterminant: detJ,
      signedVolume: vol,
    });
  }

  // Compute bounding box along Z (or primary axis)
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const n of doc.nodes) {
    if (n.z < minZ) minZ = n.z;
    if (n.z > maxZ) maxZ = n.z;
  }
  const spanZ = Number.isFinite(maxZ - minZ) && maxZ > minZ ? maxZ - minZ : 1.0;

  // Determine axial stretch lambda1 from options, prescribed BCs, or loads
  let lambda1 = options?.stretch;
  if (lambda1 === undefined) {
    const prescribedBc = doc.boundaryConditions.find(
      (bc) => bc.type === "prescribed displacement" && bc.value !== undefined,
    );
    if (prescribedBc?.value !== undefined) {
      lambda1 = Math.max(0.2, 1.0 + prescribedBc.value / spanZ);
    } else if (doc.loads.length > 0) {
      const firstLoad = doc.loads[0]!;
      const firstMat = doc.materials[0];
      const refE = firstMat ? deriveConstitutiveParameters(firstMat).youngsModulusE : 1000.0;
      const strainEst = refE > 0 ? firstLoad.value / refE : 0.1;
      lambda1 = Math.max(0.2, 1.0 + Math.max(-0.5, Math.min(1.5, strainEst)));
    } else {
      lambda1 = 1.2; // Default 20% benchmark stretch when evaluating hyperelastic response
    }
  }

  const J = options?.volumeRatioJ ?? 1.0;
  const lambda2 = Math.sqrt(J / lambda1);
  const lambda3 = lambda2;

  const I1 = lambda1 * lambda1 + lambda2 * lambda2 + lambda3 * lambda3;
  const I2 =
    lambda1 * lambda1 * lambda2 * lambda2 +
    lambda2 * lambda2 * lambda3 * lambda3 +
    lambda3 * lambda3 * lambda1 * lambda1;

  // 2. Evaluate constitutive response per material
  const matSourceList: FebioMaterial[] =
    doc.materials.length > 0
      ? doc.materials
      : [
          {
            id: "1",
            name: "DefaultSoftTissue",
            type: "neo-Hookean",
            c1: 0.5,
            c2: 0.1,
            k: 10.0,
            range: doc.range,
          },
        ];

  const materials: FebioMaterialConstitutiveState[] = [];
  let maxVonMisesStress = 0;

  for (const mat of matSourceList) {
    const params = deriveConstitutiveParameters(mat);
    const { c1, c2, bulkModulusK, shearModulusMu, youngsModulusE, poissonRatioNu } = params;

    // Strain energy density: W = C1*(I1 - 3) + C2*(I2 - 3) + 0.5*K*(J - 1)^2
    const W = c1 * (I1 - 3.0) + c2 * (I2 - 3.0) + 0.5 * bulkModulusK * (J - 1.0) * (J - 1.0);

    // Uniaxial Mooney-Rivlin + volumetric Cauchy stress
    const volStress = bulkModulusK * (J - 1.0);
    const devSigma1 = (2.0 / J) * (lambda1 * lambda1 - 1.0 / lambda1) * (c1 + c2 / lambda1);
    const sigma1 = devSigma1 + volStress;
    const sigma2 = volStress;
    const sigma3 = volStress;

    const vonMises = Math.sqrt(
      0.5 *
        ((sigma1 - sigma2) * (sigma1 - sigma2) +
          (sigma2 - sigma3) * (sigma2 - sigma3) +
          (sigma3 - sigma1) * (sigma3 - sigma1)),
    );

    if (vonMises > maxVonMisesStress) {
      maxVonMisesStress = vonMises;
    }

    const state: FebioMaterialConstitutiveState = {
      materialId: mat.id,
      materialName: mat.name,
      materialType: mat.type,
      c1,
      c2,
      bulkModulusK,
      shearModulusMu,
      youngsModulusE,
      poissonRatioNu,
      principalStretches: [lambda1, lambda2, lambda3],
      invariantI1: I1,
      invariantI2: I2,
      jacobianJ: J,
      strainEnergyDensityW: W,
      cauchyStress: [sigma1, sigma2, sigma3],
      vonMisesStress: vonMises,
    };

    if (mat.perm !== undefined && mat.perm > 0) {
      const pressureGrad = Math.abs(sigma1) / spanZ;
      state.darcyFluidFlux = mat.perm * pressureGrad;
    }

    materials.push(state);
  }

  // 3. Compute nodal displacements respecting fixed NodeSets
  const fixedNodeIds = new Set<string>();
  const nodeSetMap = new Map<string, string[]>();
  for (const ns of doc.nodeSets) {
    nodeSetMap.set(ns.name, ns.nodeIds);
  }
  for (const bc of doc.boundaryConditions) {
    if (bc.type === "fix" || bc.type === "zero displacement") {
      const ids = nodeSetMap.get(bc.nodeSet) ?? [];
      for (const id of ids) fixedNodeIds.add(id);
    }
  }

  const nodalDisplacements: FebioNodalDisplacement[] = [];
  let maxDisplacementMagnitude = 0;
  const zOrigin = Number.isFinite(minZ) ? minZ : 0;

  for (const node of doc.nodes) {
    if (fixedNodeIds.has(node.id)) {
      nodalDisplacements.push({
        nodeId: node.id,
        ux: 0,
        uy: 0,
        uz: 0,
        magnitude: 0,
      });
      continue;
    }
    const ux = (lambda2 - 1.0) * node.x;
    const uy = (lambda3 - 1.0) * node.y;
    const uz = (lambda1 - 1.0) * (node.z - zOrigin);
    const mag = Math.hypot(ux, uy, uz);
    if (mag > maxDisplacementMagnitude) {
      maxDisplacementMagnitude = mag;
    }
    nodalDisplacements.push({
      nodeId: node.id,
      ux,
      uy,
      uz,
      magnitude: mag,
    });
  }

  const primaryW = materials[0]?.strainEnergyDensityW ?? 0;
  const effectiveVol = totalVolume > 0 ? totalVolume : 1.0;
  const totalStrainEnergy = primaryW * effectiveVol;

  return {
    title: doc.title,
    totalVolume,
    invertedElementCount,
    maxDisplacementMagnitude,
    maxVonMisesStress,
    totalStrainEnergy,
    materials,
    nodalDisplacements,
    elementQualities,
  };
}

/**
 * Lowers FEBio hyperelastic material parameters, principal invariants (I1, I2, J),
 * Mooney-Rivlin strain energy density W, Cauchy stress σ, and nodal displacements
 * into ModelScript's linear-memory DAEBuilder arena.
 */
export function lowerFebioToDae(doc: FebioDocument, arenaTitle?: string): DAEBuilder {
  const title = arenaTitle ?? sanitizeIdentifier(doc.title || "FEBioBiomechanics");
  const interner = new StringInterner();
  const arena = new DAEBuilder(interner, title);

  const summary = solveHyperelasticMechanics(doc);

  for (const mat of summary.materials) {
    const prefix = sanitizeIdentifier(mat.materialName || `Mat_${mat.materialId}`);

    // Parameters: C1, C2, K
    const c1Var = `${prefix}_C1`;
    const c1Id = interner.intern(c1Var);
    arena.addVariable(c1Var, VarType.Real, Variability.Parameter, Causality.Local);
    const c1Expr = arena.addExpression(ExprKind.Name, c1Id);
    arena.addEquation(EqKind.InitialSimple, c1Expr, arena.addRealLiteral(mat.c1));

    const c2Var = `${prefix}_C2`;
    const c2Id = interner.intern(c2Var);
    arena.addVariable(c2Var, VarType.Real, Variability.Parameter, Causality.Local);
    const c2Expr = arena.addExpression(ExprKind.Name, c2Id);
    arena.addEquation(EqKind.InitialSimple, c2Expr, arena.addRealLiteral(mat.c2));

    const kVar = `${prefix}_K`;
    const kId = interner.intern(kVar);
    arena.addVariable(kVar, VarType.Real, Variability.Parameter, Causality.Local);
    const kExpr = arena.addExpression(ExprKind.Name, kId);
    arena.addEquation(EqKind.InitialSimple, kExpr, arena.addRealLiteral(mat.bulkModulusK));

    // Invariants I1 and I2
    const i1Var = `${prefix}_I1`;
    const i1Id = interner.intern(i1Var);
    arena.addVariable(i1Var, VarType.Real, Variability.Continuous, Causality.Local);
    const i1Expr = arena.addExpression(ExprKind.Name, i1Id);
    arena.addEquation(EqKind.Simple, i1Expr, arena.addRealLiteral(mat.invariantI1));

    const i2Var = `${prefix}_I2`;
    const i2Id = interner.intern(i2Var);
    arena.addVariable(i2Var, VarType.Real, Variability.Continuous, Causality.Local);
    const i2Expr = arena.addExpression(ExprKind.Name, i2Id);
    arena.addEquation(EqKind.Simple, i2Expr, arena.addRealLiteral(mat.invariantI2));

    // Strain energy density equation: W = C1 * (I1 - 3) + C2 * (I2 - 3)
    const wVar = `${prefix}_W`;
    const wId = interner.intern(wVar);
    arena.addVariable(wVar, VarType.Real, Variability.Continuous, Causality.Output);
    const wExpr = arena.addExpression(ExprKind.Name, wId);

    const threeLit = arena.addRealLiteral(3.0);
    const i1Minus3 = arena.addBinaryExpr(BinOp.Sub, i1Expr, threeLit);
    const i2Minus3 = arena.addBinaryExpr(BinOp.Sub, i2Expr, threeLit);
    const term1 = arena.addBinaryExpr(BinOp.Mul, c1Expr, i1Minus3);
    const term2 = arena.addBinaryExpr(BinOp.Mul, c2Expr, i2Minus3);
    const wRhs = arena.addBinaryExpr(BinOp.Add, term1, term2);
    arena.addEquation(EqKind.Simple, wExpr, wRhs);

    // Axial Cauchy stress output
    const sigVar = `${prefix}_sigma11`;
    const sigId = interner.intern(sigVar);
    arena.addVariable(sigVar, VarType.Real, Variability.Continuous, Causality.Output);
    const sigExpr = arena.addExpression(ExprKind.Name, sigId);
    arena.addEquation(EqKind.Simple, sigExpr, arena.addRealLiteral(mat.cauchyStress[0]));
  }

  // Lower mesh volume and max displacement
  const volVar = "mesh_total_volume";
  const volId = interner.intern(volVar);
  arena.addVariable(volVar, VarType.Real, Variability.Parameter, Causality.Output);
  const volExpr = arena.addExpression(ExprKind.Name, volId);
  arena.addEquation(EqKind.InitialSimple, volExpr, arena.addRealLiteral(summary.totalVolume));

  const dispVar = "max_nodal_displacement";
  const dispId = interner.intern(dispVar);
  arena.addVariable(dispVar, VarType.Real, Variability.Continuous, Causality.Output);
  const dispExpr = arena.addExpression(ExprKind.Name, dispId);
  arena.addEquation(EqKind.Simple, dispExpr, arena.addRealLiteral(summary.maxDisplacementMagnitude));

  return arena;
}

function sanitizeIdentifier(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned || "FEBioEntity";
}

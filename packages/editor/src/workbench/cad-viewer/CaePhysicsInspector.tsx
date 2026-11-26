// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CaePhysicsInspector — Compact dark-glass, schema-driven physics & boundary-condition
 * inspector for CFD 2030 (WebGPU LBM, Octree LBM, Compressible FVM, High-Order Nodal DG)
 * and High-Fidelity FEA (Tet4/Tet10, Corotational, Newmark-beta, SA-AMG, CLT CFRP, J2 Plasticity).
 */

import React, { useEffect, useMemo, useState } from "react";

export type CaeCfdSolverFamily = "lbm-d3q19" | "lbm-octree" | "fvm-compressible" | "dg-nodal";
export type CaeCfdTurbulenceModel =
  "laminar" | "smagorinsky" | "dynamic-smagorinsky" | "wmles-spalding" | "spalart-allmaras" | "ddes";
export type CaeCfdCollisionOperator = "bgk" | "regularized";
export type CaeCfdFluxScheme = "hllc" | "roe" | "rusanov";
export type CaeCfdSlopeLimiter = "minmod" | "venkatakrishnan" | "none";
export type CaeCfdBcKind = "inlet" | "outlet" | "wall" | "heatflux" | "isothermal" | "farfield" | "symmetry";

export type CaeFeaElementOrder = "tet4" | "tet10";
export type CaeFeaKinematics = "linear" | "corotational";
export type CaeFeaAnalysisType = "static" | "transient-newmark";
export type CaeFeaPreconditioner = "jacobi-pcg" | "sa-amg" | "mixed-f32-f64-amg";
export type CaeFeaMaterialModel = "isotropic" | "cfrp-laminate" | "j2-plasticity";
export type CaeFeaBcKind = "fixed_support" | "prescribed_displacement" | "force_load" | "pressure_load" | "thermal_bc";

export interface CaeCfdPhysicsConfig {
  solverFamily: CaeCfdSolverFamily;
  turbulenceModel: CaeCfdTurbulenceModel;
  collisionOperator: CaeCfdCollisionOperator;
  bouzidiCurvedWalls: boolean;
  thermalBoussinesq: boolean;
  prandtl: number;
  ambientTempK: number;
  wallTempK: number;
  heatFluxW: number;
  fluxScheme: CaeCfdFluxScheme;
  limiter: CaeCfdSlopeLimiter;
  implicitGmres: boolean;
  dgOrder: 1 | 2 | 3;
  // y+ calculator parameters
  uInf: number;
  charLength: number;
  kinematicViscosity: number;
  targetYPlus: number;
}

export interface CaeFeaPhysicsConfig {
  elementOrder: CaeFeaElementOrder;
  kinematics: CaeFeaKinematics;
  analysisType: CaeFeaAnalysisType;
  newmarkDt: number;
  newmarkSteps: number;
  preconditioner: CaeFeaPreconditioner;
  materialModel: CaeFeaMaterialModel;
  // Isotropic / shared baseline
  materialName: string;
  youngsModulusMpa: number;
  poissonsRatio: number;
  densityKgM3: number;
  // CFRP Orthotropic Laminate (Classical Laminate Theory)
  plyAnglesDeg: number[];
  symmetricLayup: boolean;
  plyThicknessMm: number;
  cfrpE1Mpa: number;
  cfrpE2Mpa: number;
  cfrpG12Mpa: number;
  cfrpNu12: number;
  // J2 Elastoplasticity
  yieldStressMpa: number;
  hardeningModulusMpa: number;
}

export interface CaePhysicsConfig {
  cfd: CaeCfdPhysicsConfig;
  fea: CaeFeaPhysicsConfig;
}

export interface CaeYPlusResult {
  reynolds: number;
  skinFrictionCf: number;
  uTau: number;
  firstCellHeightM: number;
  firstCellHeightMm: number;
  regime: "laminar" | "turbulent";
}

export interface CaeCltLaminateSummary {
  totalPlies: number;
  totalThicknessMm: number;
  exMpa: number;
  eyMpa: number;
  gxyMpa: number;
  nuxy: number;
  a11Nmm: number;
  a22Nmm: number;
  a66Nmm: number;
  stackupNotation: string;
}

export interface CaePhysicsInspectorProps {
  /** Active physics mode ("cfd" or "fea"). User can also toggle between tabs if desired. */
  dialect: "cfd" | "fea";
  /** Current picked 3D face/node set name from the CAD viewport */
  pickedFaceSet?: string | undefined;
  /** Controlled or initial physics configuration */
  config?: CaePhysicsConfig | undefined;
  /** Called whenever any physics setting changes */
  onConfigChange?: ((next: CaePhysicsConfig) => void) | undefined;
  /** Inserts or syncs generated .cfg / .inp directives into the live source deck */
  onInsertSnippet?: ((section: string, snippet: string) => void) | undefined;
  /** Optional callback to switch active dialect tab in parent */
  onDialectChange?: ((dialect: "cfd" | "fea") => void) | undefined;
  /** Dark-glass theme (default true) */
  dark?: boolean | undefined;
  /** Optional close callback */
  onClose?: (() => void) | undefined;
}

export function createDefaultCaePhysicsConfig(): CaePhysicsConfig {
  return {
    cfd: {
      solverFamily: "lbm-d3q19",
      turbulenceModel: "smagorinsky",
      collisionOperator: "regularized",
      bouzidiCurvedWalls: true,
      thermalBoussinesq: false,
      prandtl: 0.71,
      ambientTempK: 293.15,
      wallTempK: 330.0,
      heatFluxW: 250.0,
      fluxScheme: "hllc",
      limiter: "venkatakrishnan",
      implicitGmres: true,
      dgOrder: 2,
      uInf: 30.0,
      charLength: 1.0,
      kinematicViscosity: 1.5e-5,
      targetYPlus: 1.0,
    },
    fea: {
      elementOrder: "tet10",
      kinematics: "corotational",
      analysisType: "static",
      newmarkDt: 0.001,
      newmarkSteps: 200,
      preconditioner: "sa-amg",
      materialModel: "cfrp-laminate",
      materialName: "IM7_8552_CFRP",
      youngsModulusMpa: 113800,
      poissonsRatio: 0.342,
      densityKgM3: 1580,
      plyAnglesDeg: [0, 45, -45, 90],
      symmetricLayup: true,
      plyThicknessMm: 0.125,
      cfrpE1Mpa: 161000,
      cfrpE2Mpa: 11380,
      cfrpG12Mpa: 5170,
      cfrpNu12: 0.32,
      yieldStressMpa: 880,
      hardeningModulusMpa: 2500,
    },
  };
}

/**
 * Computes analytical boundary-layer Reynolds number, skin friction coefficient C_f
 * (Schlichting turbulent correlation / Blasius laminar), friction velocity u_tau,
 * and first-cell height Δy_1 for a target y+.
 */
export function computeYPlusMetrics(
  uInf: number,
  charLength: number,
  kinematicViscosity: number,
  targetYPlus: number,
): CaeYPlusResult {
  const U = Math.max(1e-6, Math.abs(uInf));
  const L = Math.max(1e-6, Math.abs(charLength));
  const nu = Math.max(1e-12, Math.abs(kinematicViscosity));
  const yPlus = Math.max(1e-3, Math.abs(targetYPlus));

  const reynolds = (U * L) / nu;
  const regime: "laminar" | "turbulent" = reynolds < 5e5 ? "laminar" : "turbulent";

  let cf: number;
  if (regime === "laminar") {
    cf = 0.664 / Math.sqrt(Math.max(1, reynolds));
  } else {
    // Schlichting flat-plate turbulent correlation: Cf = (2*log10(Re) - 0.65)^(-2.3)
    const denom = Math.max(0.5, 2 * Math.log10(reynolds) - 0.65);
    cf = Math.pow(denom, -2.3);
  }

  const uTau = U * Math.sqrt(Math.max(1e-12, cf * 0.5));
  const firstCellHeightM = (yPlus * nu) / Math.max(1e-12, uTau);

  return {
    reynolds,
    skinFrictionCf: cf,
    uTau,
    firstCellHeightM,
    firstCellHeightMm: firstCellHeightM * 1000,
    regime,
  };
}

/**
 * Computes Classical Laminate Theory (CLT) in-plane extensional stiffness [A] and
 * effective engineering moduli (Ex, Ey, Gxy, nuxy) for an orthotropic CFRP layup.
 */
export function computeCfrpLaminateSummary(
  plyAnglesDeg: number[],
  symmetricLayup: boolean,
  plyThicknessMm: number,
  e1Mpa: number,
  e2Mpa: number,
  g12Mpa: number,
  nu12: number,
): CaeCltLaminateSummary {
  const basePlies = plyAnglesDeg.length > 0 ? plyAnglesDeg : [0];
  const fullPlies = symmetricLayup ? [...basePlies, ...[...basePlies].reverse()] : [...basePlies];
  const tPly = Math.max(1e-4, plyThicknessMm);
  const totalThicknessMm = fullPlies.length * tPly;

  const E1 = Math.max(1, e1Mpa);
  const E2 = Math.max(1, e2Mpa);
  const G12 = Math.max(1, g12Mpa);
  const nu21 = (nu12 * E2) / E1;
  const denom = Math.max(1e-6, 1 - nu12 * nu21);

  const Q11 = E1 / denom;
  const Q22 = E2 / denom;
  const Q12 = (nu12 * E2) / denom;
  const Q66 = G12;

  let A11 = 0;
  let A12 = 0;
  let A22 = 0;
  let A66 = 0;

  for (const deg of fullPlies) {
    const rad = (deg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const c2 = c * c;
    const s2 = s * s;
    const c4 = c2 * c2;
    const s4 = s2 * s2;

    const q11Bar = Q11 * c4 + 2 * (Q12 + 2 * Q66) * s2 * c2 + Q22 * s4;
    const q22Bar = Q11 * s4 + 2 * (Q12 + 2 * Q66) * s2 * c2 + Q22 * c4;
    const q12Bar = (Q11 + Q22 - 4 * Q66) * s2 * c2 + Q12 * (c4 + s4);
    const q66Bar = (Q11 + Q22 - 2 * Q12 - 2 * Q66) * s2 * c2 + Q66 * (c4 + s4);

    A11 += q11Bar * tPly;
    A22 += q22Bar * tPly;
    A12 += q12Bar * tPly;
    A66 += q66Bar * tPly;
  }

  const det12 = Math.max(1e-6, A11 * A22 - A12 * A12);
  const exMpa = det12 / (totalThicknessMm * Math.max(1e-6, A22));
  const eyMpa = det12 / (totalThicknessMm * Math.max(1e-6, A11));
  const gxyMpa = A66 / totalThicknessMm;
  const nuxy = A12 / Math.max(1e-6, A22);
  const stackupNotation = `[${basePlies.join("/")}]${symmetricLayup ? "s" : ""}`;

  return {
    totalPlies: fullPlies.length,
    totalThicknessMm,
    exMpa,
    eyMpa,
    gxyMpa,
    nuxy,
    a11Nmm: A11,
    a22Nmm: A22,
    a66Nmm: A66,
    stackupNotation,
  };
}

/**
 * Serializes a CaePhysicsConfig into valid SU2/CFD (.cfg) or CalculiX/FEA (.inp) directives.
 */
export function serializePhysicsToDeckDirectives(dialect: "cfd" | "fea", config: CaePhysicsConfig): string {
  if (dialect === "cfd") {
    const c = config.cfd;
    const solverMap: Record<CaeCfdSolverFamily, string> = {
      "lbm-d3q19": "LBM_D3Q19_WEBGPU",
      "lbm-octree": "LBM_OCTREE_AMR_2TO1",
      "fvm-compressible": "NAVIER_STOKES_FVM",
      "dg-nodal": "NODAL_DG_COMPRESSIBLE",
    };
    const turbMap: Record<CaeCfdTurbulenceModel, string> = {
      laminar: "NONE",
      smagorinsky: "LES_SMAGORINSKY",
      "dynamic-smagorinsky": "LES_DYNAMIC_SMAGORINSKY",
      "wmles-spalding": "WMLES_SPALDING",
      "spalart-allmaras": "SA",
      ddes: "DDES_SA",
    };

    const lines: string[] = [
      "% --- CFD 2030 Physics Configuration ---",
      `SOLVER= ${solverMap[c.solverFamily]}`,
      `KIND_TURB_MODEL= ${turbMap[c.turbulenceModel]}`,
    ];

    if (c.solverFamily === "lbm-d3q19" || c.solverFamily === "lbm-octree") {
      lines.push(`LBM_COLLISION= ${c.collisionOperator === "regularized" ? "REGULARIZED_HERMITE2" : "BGK"}`);
      lines.push(`BOUZIDI_CURVED_WALLS= ${c.bouzidiCurvedWalls ? "YES" : "NO"}`);
    } else {
      lines.push(`CONV_NUM_METHOD_FLOW= ${c.fluxScheme.toUpperCase()}`);
      lines.push(`SLOPE_LIMITER_FLOW= ${c.limiter.toUpperCase()}`);
      lines.push(`TIME_DISCRE_FLOW= ${c.implicitGmres ? "EULER_IMPLICIT_GMRES" : "RUNGE_KUTTA_EXPLICIT"}`);
      if (c.solverFamily === "dg-nodal") {
        lines.push(`DG_POLY_ORDER= ${c.dgOrder}`);
      }
    }

    if (c.thermalBoussinesq) {
      lines.push("THERMAL_MODEL= D3Q7_BOUSSINESQ");
      lines.push(`PRANDTL_LAM= ${c.prandtl.toFixed(3)}`);
      lines.push(`FREESTREAM_TEMPERATURE= ${c.ambientTempK.toFixed(2)}`);
      lines.push(`WALL_TEMPERATURE= ${c.wallTempK.toFixed(2)}`);
      lines.push(`WALL_HEATFLUX= ${c.heatFluxW.toFixed(2)}`);
    }

    const yp = computeYPlusMetrics(c.uInf, c.charLength, c.kinematicViscosity, c.targetYPlus);
    lines.push(
      `% Target y+= ${c.targetYPlus} | Re= ${yp.reynolds.toExponential(2)} | dy1= ${yp.firstCellHeightM.toExponential(3)} m`,
    );
    return `\n${lines.join("\n")}\n`;
  }

  // FEA (.inp CalculiX / Ansatz directives)
  const f = config.fea;
  const precondMap: Record<CaeFeaPreconditioner, string> = {
    "jacobi-pcg": "JACOBI_PCG",
    "sa-amg": "SA_AMG",
    "mixed-f32-f64-amg": "MIXED_F32_F64_AMG",
  };
  const lines: string[] = [
    "** --- High-Fidelity FEA Physics Configuration ---",
    `** ELEMENT_ORDER=${f.elementOrder.toUpperCase()}, KINEMATICS=${f.kinematics.toUpperCase()}, PRECONDITIONER=${precondMap[f.preconditioner]}`,
  ];

  if (f.materialModel === "isotropic") {
    lines.push(`*MATERIAL, NAME=${f.materialName || "IsotropicMat"}`);
    lines.push("*ELASTIC");
    lines.push(`${f.youngsModulusMpa}, ${f.poissonsRatio}`);
    lines.push("*DENSITY");
    lines.push(`${(f.densityKgM3 * 1e-12).toExponential(3)}`);
  } else if (f.materialModel === "cfrp-laminate") {
    const clt = computeCfrpLaminateSummary(
      f.plyAnglesDeg,
      f.symmetricLayup,
      f.plyThicknessMm,
      f.cfrpE1Mpa,
      f.cfrpE2Mpa,
      f.cfrpG12Mpa,
      f.cfrpNu12,
    );
    lines.push(
      `** CFRP Layup ${clt.stackupNotation} (${clt.totalPlies} plies, h=${clt.totalThicknessMm.toFixed(3)} mm)`,
    );
    lines.push(
      `** CLT Effective Moduli: Ex=${clt.exMpa.toFixed(0)} MPa, Ey=${clt.eyMpa.toFixed(0)} MPa, Gxy=${clt.gxyMpa.toFixed(0)} MPa, nuxy=${clt.nuxy.toFixed(3)}`,
    );
    lines.push(`*MATERIAL, NAME=${f.materialName || "CFRP_Laminate"}`);
    lines.push("*ELASTIC, TYPE=ENGINEERING CONSTANTS");
    lines.push(
      `${f.cfrpE1Mpa}, ${f.cfrpE2Mpa}, ${f.cfrpE2Mpa}, ${f.cfrpNu12}, ${f.cfrpNu12}, 0.42, ${f.cfrpG12Mpa}, ${f.cfrpG12Mpa}`,
    );
    lines.push(`${Math.round(f.cfrpG12Mpa * 0.72)}`);
    lines.push("*DENSITY");
    lines.push(`${(f.densityKgM3 * 1e-12).toExponential(3)}`);
  } else {
    lines.push(`*MATERIAL, NAME=${f.materialName || "J2_Alloy"}`);
    lines.push("*ELASTIC");
    lines.push(`${f.youngsModulusMpa}, ${f.poissonsRatio}`);
    lines.push("*PLASTIC");
    lines.push(`${f.yieldStressMpa}, 0.0`);
    lines.push(`${f.yieldStressMpa + f.hardeningModulusMpa * 0.1}, 0.1`);
    lines.push("*DENSITY");
    lines.push(`${(f.densityKgM3 * 1e-12).toExponential(3)}`);
  }

  const nlgeom = f.kinematics === "corotational" ? ", NLGEOM" : "";
  lines.push(`*STEP${nlgeom}`);
  if (f.analysisType === "transient-newmark") {
    const totalTime = f.newmarkDt * f.newmarkSteps;
    lines.push(`*DYNAMIC, ALPHA=-0.05`);
    lines.push(`${f.newmarkDt}, ${totalTime.toFixed(6)}`);
  } else {
    lines.push("*STATIC");
  }
  lines.push("*END STEP");

  return `\n${lines.join("\n")}\n`;
}

export function CaePhysicsInspector({
  dialect,
  pickedFaceSet,
  config: controlledConfig,
  onConfigChange,
  onInsertSnippet,
  onDialectChange,
  dark = true,
  onClose,
}: CaePhysicsInspectorProps) {
  const [activeTab, setActiveTab] = useState<"cfd" | "fea">(dialect);
  const [internalConfig, setInternalConfig] = useState<CaePhysicsConfig>(
    () => controlledConfig ?? createDefaultCaePhysicsConfig(),
  );

  useEffect(() => {
    setActiveTab(dialect);
  }, [dialect]);

  const cfg = controlledConfig ?? internalConfig;

  const updateCfd = (patch: Partial<CaeCfdPhysicsConfig>) => {
    const next: CaePhysicsConfig = { ...cfg, cfd: { ...cfg.cfd, ...patch } };
    if (!controlledConfig) setInternalConfig(next);
    onConfigChange?.(next);
  };

  const updateFea = (patch: Partial<CaeFeaPhysicsConfig>) => {
    const next: CaePhysicsConfig = { ...cfg, fea: { ...cfg.fea, ...patch } };
    if (!controlledConfig) setInternalConfig(next);
    onConfigChange?.(next);
  };

  // Structured BC builder local state
  const [cfdBcKind, setCfdBcKind] = useState<CaeCfdBcKind>("inlet");
  const [cfdBcTarget, setCfdBcTarget] = useState<string>(pickedFaceSet || "INLET");
  const [cfdBcValue, setCfdBcValue] = useState<string>("30.0");

  const [feaBcKind, setFeaBcKind] = useState<CaeFeaBcKind>("fixed_support");
  const [feaBcTarget, setFeaBcTarget] = useState<string>(pickedFaceSet || "FIX_NODES");
  const [feaBcValue, setFeaBcValue] = useState<string>("-1000.0");
  const [feaBcAxis, setFeaBcAxis] = useState<"1" | "2" | "3">("2");
  const [newPlyAngle, setNewPlyAngle] = useState<string>("45");

  useEffect(() => {
    if (pickedFaceSet) {
      setCfdBcTarget(pickedFaceSet);
      setFeaBcTarget(pickedFaceSet);
    }
  }, [pickedFaceSet]);

  const yPlusResult = useMemo(
    () => computeYPlusMetrics(cfg.cfd.uInf, cfg.cfd.charLength, cfg.cfd.kinematicViscosity, cfg.cfd.targetYPlus),
    [cfg.cfd.uInf, cfg.cfd.charLength, cfg.cfd.kinematicViscosity, cfg.cfd.targetYPlus],
  );

  const cltSummary = useMemo(
    () =>
      computeCfrpLaminateSummary(
        cfg.fea.plyAnglesDeg,
        cfg.fea.symmetricLayup,
        cfg.fea.plyThicknessMm,
        cfg.fea.cfrpE1Mpa,
        cfg.fea.cfrpE2Mpa,
        cfg.fea.cfrpG12Mpa,
        cfg.fea.cfrpNu12,
      ),
    [
      cfg.fea.plyAnglesDeg,
      cfg.fea.symmetricLayup,
      cfg.fea.plyThicknessMm,
      cfg.fea.cfrpE1Mpa,
      cfg.fea.cfrpE2Mpa,
      cfg.fea.cfrpG12Mpa,
      cfg.fea.cfrpNu12,
    ],
  );

  // Theme tokens matching CaeSimulationTree.tsx
  const bg = dark ? "rgba(15, 23, 42, 0.90)" : "rgba(255, 255, 255, 0.95)";
  const subBg = dark ? "rgba(255, 255, 255, 0.04)" : "rgba(15, 23, 42, 0.04)";
  const border = dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.12)";
  const textPrimary = dark ? "#e2e8f0" : "#1f2328";
  const textMuted = dark ? "#94a3b8" : "#64748b";
  const accent = "#06b6d4";
  const activeBg = dark ? "rgba(6, 182, 212, 0.18)" : "rgba(6, 182, 212, 0.12)";

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    background: dark ? "rgba(15, 23, 42, 0.78)" : "#ffffff",
    color: textPrimary,
    border: `1px solid ${border}`,
    borderRadius: 6,
    padding: "3px 6px",
    fontSize: 10.5,
    fontFamily: "var(--font-mono, monospace)",
    outline: "none",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    fontFamily: "system-ui, -apple-system, sans-serif",
    cursor: "pointer",
  };

  const sectionCardStyle: React.CSSProperties = {
    background: subBg,
    border: `1px solid ${border}`,
    borderRadius: 8,
    padding: "7px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 5,
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: accent,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: textMuted,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  };

  const primaryBtnStyle: React.CSSProperties = {
    background: "rgba(6, 182, 212, 0.22)",
    color: dark ? "#67e8f9" : "#0e7490",
    border: "1px solid rgba(6, 182, 212, 0.55)",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 10.5,
    fontWeight: 600,
    cursor: "pointer",
  };

  const isCompressibleOrDg = cfg.cfd.solverFamily === "fvm-compressible" || cfg.cfd.solverFamily === "dg-nodal";

  const emitCfdBcSnippet = () => {
    const marker = cfdBcTarget.trim() || "WALL";
    const val = cfdBcValue.trim() || "0.0";
    let snippet = "";
    switch (cfdBcKind) {
      case "inlet":
        snippet = `\nMARKER_INLET= ( ${marker}, ${cfg.cfd.ambientTempK.toFixed(1)}, 101325.0, 1.0, 0.0, 0.0 ) % U=${val} m/s\n`;
        break;
      case "outlet":
        snippet = `\nMARKER_OUTLET= ( ${marker}, ${val} )\n`;
        break;
      case "wall":
        snippet = `\nMARKER_HEATFLUX= ( ${marker}, 0.0 ) % No-slip adiabatic wall\n`;
        break;
      case "heatflux":
        snippet = `\nMARKER_HEATFLUX= ( ${marker}, ${val} )\n`;
        break;
      case "isothermal":
        snippet = `\nMARKER_ISOTHERMAL= ( ${marker}, ${val} )\n`;
        break;
      case "farfield":
        snippet = `\nMARKER_FAR= ( ${marker} ) % Mach/U=${val}\n`;
        break;
      case "symmetry":
        snippet = `\nMARKER_SYM= ( ${marker} )\n`;
        break;
    }
    onInsertSnippet?.("boundaryConditions", snippet);
  };

  const emitFeaBcSnippet = () => {
    const set = feaBcTarget.trim() || "FIX_NODES";
    const val = feaBcValue.trim() || "0.0";
    let snippet = "";
    switch (feaBcKind) {
      case "fixed_support":
        snippet = `\n*BOUNDARY\n${set}, 1, 3, 0.0\n`;
        break;
      case "prescribed_displacement":
        snippet = `\n*BOUNDARY\n${set}, ${feaBcAxis}, ${feaBcAxis}, ${val}\n`;
        break;
      case "force_load":
        snippet = `\n*CLOAD\n${set}, ${feaBcAxis}, ${val}\n`;
        break;
      case "pressure_load":
        snippet = `\n*DSLOAD\n${set}, P, ${val}\n`;
        break;
      case "thermal_bc":
        snippet = `\n*BOUNDARY\n${set}, 11, 11, ${val}\n`;
        break;
    }
    onInsertSnippet?.("boundaryConditions", snippet);
  };

  const handleTabSwitch = (next: "cfd" | "fea") => {
    setActiveTab(next);
    onDialectChange?.(next);
  };

  const cfdBcValueLabel: Record<CaeCfdBcKind, string> = {
    inlet: "Inlet Velocity (m/s)",
    outlet: "Static Pressure (Pa)",
    wall: "Roughness ks (m)",
    heatflux: "Heat Flux (W/m²)",
    isothermal: "Wall Temp (K)",
    farfield: "Freestream Mach / U",
    symmetry: "Symmetry Offset",
  };

  const feaBcValueLabel: Record<CaeFeaBcKind, string> = {
    fixed_support: "Fixed DOFs (1-3)",
    prescribed_displacement: "Displacement (mm)",
    force_load: "Force Magnitude (N)",
    pressure_load: "Pressure (MPa)",
    thermal_bc: "Temperature (K)",
  };

  return (
    <div
      style={{
        width: 312,
        maxHeight: "calc(100% - 28px)",
        background: bg,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: 10,
        border: `1px solid ${border}`,
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.28)",
        padding: "8px 9px",
        display: "flex",
        flexDirection: "column",
        gap: 7,
        overflowY: "auto",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: textPrimary,
        pointerEvents: "auto",
      }}
    >
      {/* Header & Mode Switcher */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, flex: 1 }}>Physics Inspector</span>
        <div
          style={{
            display: "flex",
            background: subBg,
            border: `1px solid ${border}`,
            borderRadius: 6,
            padding: 2,
            gap: 2,
          }}
        >
          {(["cfd", "fea"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => handleTabSwitch(tab)}
              style={{
                border: "none",
                borderRadius: 4,
                padding: "2px 8px",
                fontSize: 10,
                fontWeight: 700,
                cursor: "pointer",
                background: activeTab === tab ? activeBg : "transparent",
                color: activeTab === tab ? accent : textMuted,
              }}
            >
              {tab === "cfd" ? "CFD 2030" : "FEA"}
            </button>
          ))}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Close Inspector"
            style={{
              background: "transparent",
              border: "none",
              color: textMuted,
              cursor: "pointer",
              fontSize: 13,
              lineHeight: 1,
              padding: "0 2px",
            }}
          >
            ×
          </button>
        )}
      </div>

      {activeTab === "cfd" ? (
        <>
          {/* CFD Solver & Turbulence */}
          <div style={sectionCardStyle}>
            <div style={sectionTitleStyle}>Solver & Turbulence</div>
            <label style={labelStyle}>
              <span>Solver Family</span>
              <select
                style={selectStyle}
                value={cfg.cfd.solverFamily}
                onChange={(e) => updateCfd({ solverFamily: e.target.value as CaeCfdSolverFamily })}
              >
                <option value="lbm-d3q19">WebGPU LBM (D3Q19)</option>
                <option value="lbm-octree">Octree Adaptive LBM (2:1)</option>
                <option value="fvm-compressible">Compressible FVM (HLLC/Roe)</option>
                <option value="dg-nodal">High-Order Nodal DG (p=1..3)</option>
              </select>
            </label>

            <label style={labelStyle}>
              <span>Turbulence Model</span>
              <select
                style={selectStyle}
                value={cfg.cfd.turbulenceModel}
                onChange={(e) => updateCfd({ turbulenceModel: e.target.value as CaeCfdTurbulenceModel })}
              >
                <option value="laminar">Laminar</option>
                <option value="smagorinsky">Smagorinsky LES</option>
                <option value="dynamic-smagorinsky">Dynamic Smagorinsky</option>
                <option value="wmles-spalding">WMLES (Spalding)</option>
                <option value="spalart-allmaras">Spalart-Allmaras</option>
                <option value="ddes">DDES (Hybrid RANS-LES)</option>
              </select>
            </label>
          </div>

          {/* Collision, Wall Treatment & Thermal */}
          <div style={sectionCardStyle}>
            <div style={sectionTitleStyle}>Collision, Walls & Thermal</div>
            <label style={labelStyle}>
              <span>Collision Operator</span>
              <select
                style={selectStyle}
                value={cfg.cfd.collisionOperator}
                onChange={(e) => updateCfd({ collisionOperator: e.target.value as CaeCfdCollisionOperator })}
              >
                <option value="bgk">BGK (Single Relaxation Time)</option>
                <option value="regularized">Regularized (2nd-order Hermite)</option>
              </select>
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 10.5,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={cfg.cfd.bouzidiCurvedWalls}
                onChange={(e) => updateCfd({ bouzidiCurvedWalls: e.target.checked })}
              />
              <span>Bouzidi Curved Walls (Sub-Grid)</span>
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 10.5,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={cfg.cfd.thermalBoussinesq}
                onChange={(e) => updateCfd({ thermalBoussinesq: e.target.checked })}
              />
              <span>D3Q7 Thermal + Boussinesq Buoyancy</span>
            </label>

            {cfg.cfd.thermalBoussinesq && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 2 }}>
                <label style={labelStyle}>
                  <span>Prandtl (Pr)</span>
                  <input
                    type="number"
                    step="0.01"
                    style={inputStyle}
                    value={cfg.cfd.prandtl}
                    onChange={(e) => updateCfd({ prandtl: Number(e.target.value) || 0.71 })}
                  />
                </label>
                <label style={labelStyle}>
                  <span>Ambient (K)</span>
                  <input
                    type="number"
                    step="1"
                    style={inputStyle}
                    value={cfg.cfd.ambientTempK}
                    onChange={(e) => updateCfd({ ambientTempK: Number(e.target.value) || 293.15 })}
                  />
                </label>
                <label style={labelStyle}>
                  <span>Wall Temp (K)</span>
                  <input
                    type="number"
                    step="1"
                    style={inputStyle}
                    value={cfg.cfd.wallTempK}
                    onChange={(e) => updateCfd({ wallTempK: Number(e.target.value) || 300 })}
                  />
                </label>
                <label style={labelStyle}>
                  <span>Heat Flux (W)</span>
                  <input
                    type="number"
                    step="10"
                    style={inputStyle}
                    value={cfg.cfd.heatFluxW}
                    onChange={(e) => updateCfd({ heatFluxW: Number(e.target.value) || 0 })}
                  />
                </label>
              </div>
            )}
          </div>

          {/* Compressible FVM / Nodal DG Controls */}
          {isCompressibleOrDg && (
            <div style={sectionCardStyle}>
              <div style={sectionTitleStyle}>Compressible / DG Discretization</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                <label style={labelStyle}>
                  <span>Riemann Flux</span>
                  <select
                    style={selectStyle}
                    value={cfg.cfd.fluxScheme}
                    onChange={(e) => updateCfd({ fluxScheme: e.target.value as CaeCfdFluxScheme })}
                  >
                    <option value="hllc">HLLC</option>
                    <option value="roe">Roe</option>
                    <option value="rusanov">Rusanov</option>
                  </select>
                </label>
                <label style={labelStyle}>
                  <span>Slope Limiter</span>
                  <select
                    style={selectStyle}
                    value={cfg.cfd.limiter}
                    onChange={(e) => updateCfd({ limiter: e.target.value as CaeCfdSlopeLimiter })}
                  >
                    <option value="minmod">Minmod</option>
                    <option value="venkatakrishnan">Venkatakrishnan</option>
                    <option value="none">None</option>
                  </select>
                </label>
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 10.5,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={cfg.cfd.implicitGmres}
                  onChange={(e) => updateCfd({ implicitGmres: e.target.checked })}
                />
                <span>Implicit Matrix-Free GMRES</span>
              </label>

              {cfg.cfd.solverFamily === "dg-nodal" && (
                <label style={labelStyle}>
                  <span>DG Polynomial Order</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {([1, 2, 3] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => updateCfd({ dgOrder: p })}
                        style={{
                          flex: 1,
                          padding: "3px 0",
                          borderRadius: 5,
                          fontSize: 10.5,
                          fontWeight: 700,
                          cursor: "pointer",
                          border: `1px solid ${cfg.cfd.dgOrder === p ? accent : border}`,
                          background: cfg.cfd.dgOrder === p ? activeBg : "transparent",
                          color: cfg.cfd.dgOrder === p ? accent : textMuted,
                        }}
                      >
                        p={p}
                      </button>
                    ))}
                  </div>
                </label>
              )}
            </div>
          )}

          {/* Live Analytical y+ & First-Cell Height Calculator */}
          <div style={sectionCardStyle}>
            <div style={sectionTitleStyle}>y⁺ & First-Cell Height (Δy₁) Calculator</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
              <label style={labelStyle}>
                <span>U∞ (m/s)</span>
                <input
                  type="number"
                  step="1"
                  style={inputStyle}
                  value={cfg.cfd.uInf}
                  onChange={(e) => updateCfd({ uInf: Number(e.target.value) || 1 })}
                />
              </label>
              <label style={labelStyle}>
                <span>L (m)</span>
                <input
                  type="number"
                  step="0.1"
                  style={inputStyle}
                  value={cfg.cfd.charLength}
                  onChange={(e) => updateCfd({ charLength: Number(e.target.value) || 0.1 })}
                />
              </label>
              <label style={labelStyle}>
                <span>ν (m²/s)</span>
                <input
                  type="number"
                  step="1e-6"
                  style={inputStyle}
                  value={cfg.cfd.kinematicViscosity}
                  onChange={(e) => updateCfd({ kinematicViscosity: Number(e.target.value) || 1.5e-5 })}
                />
              </label>
              <label style={labelStyle}>
                <span>Target y⁺</span>
                <input
                  type="number"
                  step="0.5"
                  style={inputStyle}
                  value={cfg.cfd.targetYPlus}
                  onChange={(e) => updateCfd({ targetYPlus: Number(e.target.value) || 1 })}
                />
              </label>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 4,
                padding: "5px 6px",
                borderRadius: 6,
                background: dark ? "rgba(6, 182, 212, 0.08)" : "rgba(6, 182, 212, 0.06)",
                border: "1px solid rgba(6, 182, 212, 0.25)",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 10,
              }}
            >
              <div>
                <span style={{ color: textMuted }}>Re:</span> {yPlusResult.reynolds.toExponential(2)}
              </div>
              <div>
                <span style={{ color: textMuted }}>Cf:</span> {yPlusResult.skinFrictionCf.toExponential(2)}
              </div>
              <div>
                <span style={{ color: textMuted }}>uτ:</span> {yPlusResult.uTau.toFixed(3)} m/s
              </div>
              <div style={{ color: accent, fontWeight: 700 }}>Δy₁: {yPlusResult.firstCellHeightMm.toFixed(4)} mm</div>
            </div>
          </div>

          {/* CFD Structured Boundary Condition Builder */}
          <div style={sectionCardStyle}>
            <div style={sectionTitleStyle}>Boundary Condition Builder</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
              <label style={labelStyle}>
                <span>BC Type</span>
                <select
                  style={selectStyle}
                  value={cfdBcKind}
                  onChange={(e) => setCfdBcKind(e.target.value as CaeCfdBcKind)}
                >
                  <option value="inlet">Inlet</option>
                  <option value="outlet">Outlet</option>
                  <option value="wall">Wall (No-Slip)</option>
                  <option value="heatflux">Heat Flux</option>
                  <option value="isothermal">Isothermal</option>
                  <option value="farfield">Farfield</option>
                  <option value="symmetry">Symmetry</option>
                </select>
              </label>
              <label style={labelStyle}>
                <span>Target Face Set</span>
                <input
                  type="text"
                  style={inputStyle}
                  value={cfdBcTarget}
                  onChange={(e) => setCfdBcTarget(e.target.value)}
                />
              </label>
            </div>
            {cfdBcKind !== "symmetry" && cfdBcKind !== "wall" && (
              <label style={labelStyle}>
                <span>{cfdBcValueLabel[cfdBcKind]}</span>
                <input
                  type="text"
                  style={inputStyle}
                  value={cfdBcValue}
                  onChange={(e) => setCfdBcValue(e.target.value)}
                />
              </label>
            )}
            <div style={{ display: "flex", gap: 5 }}>
              <button type="button" style={{ ...primaryBtnStyle, flex: 1 }} onClick={emitCfdBcSnippet}>
                Insert / Sync BC
              </button>
              <button
                type="button"
                style={{ ...primaryBtnStyle, flex: 1 }}
                onClick={() => onInsertSnippet?.("numerics", serializePhysicsToDeckDirectives("cfd", cfg))}
              >
                Sync Solver Deck
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* FEA Formulation & Solver */}
          <div style={sectionCardStyle}>
            <div style={sectionTitleStyle}>Formulation & Solver</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
              <label style={labelStyle}>
                <span>Element Order</span>
                <select
                  style={selectStyle}
                  value={cfg.fea.elementOrder}
                  onChange={(e) => updateFea({ elementOrder: e.target.value as CaeFeaElementOrder })}
                >
                  <option value="tet4">Tet4 (Linear)</option>
                  <option value="tet10">Tet10 Quadratic</option>
                </select>
              </label>
              <label style={labelStyle}>
                <span>Kinematics</span>
                <select
                  style={selectStyle}
                  value={cfg.fea.kinematics}
                  onChange={(e) => updateFea({ kinematics: e.target.value as CaeFeaKinematics })}
                >
                  <option value="linear">Linear Small-Strain</option>
                  <option value="corotational">Corotational Large-Rot</option>
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
              <label style={labelStyle}>
                <span>Analysis Type</span>
                <select
                  style={selectStyle}
                  value={cfg.fea.analysisType}
                  onChange={(e) => updateFea({ analysisType: e.target.value as CaeFeaAnalysisType })}
                >
                  <option value="static">Static</option>
                  <option value="transient-newmark">Transient Newmark-β</option>
                </select>
              </label>
              <label style={labelStyle}>
                <span>Preconditioner</span>
                <select
                  style={selectStyle}
                  value={cfg.fea.preconditioner}
                  onChange={(e) => updateFea({ preconditioner: e.target.value as CaeFeaPreconditioner })}
                >
                  <option value="jacobi-pcg">Jacobi PCG</option>
                  <option value="sa-amg">SA-AMG</option>
                  <option value="mixed-f32-f64-amg">Mixed f32/f64 AMG</option>
                </select>
              </label>
            </div>

            {cfg.fea.analysisType === "transient-newmark" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                <label style={labelStyle}>
                  <span>Time Step dt (s)</span>
                  <input
                    type="number"
                    step="0.0005"
                    style={inputStyle}
                    value={cfg.fea.newmarkDt}
                    onChange={(e) => updateFea({ newmarkDt: Number(e.target.value) || 0.001 })}
                  />
                </label>
                <label style={labelStyle}>
                  <span>Steps</span>
                  <input
                    type="number"
                    step="10"
                    style={inputStyle}
                    value={cfg.fea.newmarkSteps}
                    onChange={(e) => updateFea({ newmarkSteps: Math.max(1, Number(e.target.value) || 100) })}
                  />
                </label>
              </div>
            )}
          </div>

          {/* Aerospace Material Builder */}
          <div style={sectionCardStyle}>
            <div style={sectionTitleStyle}>Aerospace Material Builder</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
              <label style={labelStyle}>
                <span>Constitutive Model</span>
                <select
                  style={selectStyle}
                  value={cfg.fea.materialModel}
                  onChange={(e) => updateFea({ materialModel: e.target.value as CaeFeaMaterialModel })}
                >
                  <option value="isotropic">Isotropic Elastic</option>
                  <option value="cfrp-laminate">Orthotropic CFRP Laminate</option>
                  <option value="j2-plasticity">J2 Elastoplasticity</option>
                </select>
              </label>
              <label style={labelStyle}>
                <span>Material Name</span>
                <input
                  type="text"
                  style={inputStyle}
                  value={cfg.fea.materialName}
                  onChange={(e) => updateFea({ materialName: e.target.value })}
                />
              </label>
            </div>

            {cfg.fea.materialModel === "isotropic" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                <label style={labelStyle}>
                  <span>E (MPa)</span>
                  <input
                    type="number"
                    style={inputStyle}
                    value={cfg.fea.youngsModulusMpa}
                    onChange={(e) => updateFea({ youngsModulusMpa: Number(e.target.value) || 68900 })}
                  />
                </label>
                <label style={labelStyle}>
                  <span>ν</span>
                  <input
                    type="number"
                    step="0.01"
                    style={inputStyle}
                    value={cfg.fea.poissonsRatio}
                    onChange={(e) => updateFea({ poissonsRatio: Number(e.target.value) || 0.33 })}
                  />
                </label>
                <label style={labelStyle}>
                  <span>ρ (kg/m³)</span>
                  <input
                    type="number"
                    style={inputStyle}
                    value={cfg.fea.densityKgM3}
                    onChange={(e) => updateFea({ densityKgM3: Number(e.target.value) || 2700 })}
                  />
                </label>
              </div>
            )}

            {cfg.fea.materialModel === "cfrp-laminate" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                  <label style={labelStyle}>
                    <span>E₁ (MPa)</span>
                    <input
                      type="number"
                      style={inputStyle}
                      value={cfg.fea.cfrpE1Mpa}
                      onChange={(e) => updateFea({ cfrpE1Mpa: Number(e.target.value) || 161000 })}
                    />
                  </label>
                  <label style={labelStyle}>
                    <span>E₂ (MPa)</span>
                    <input
                      type="number"
                      style={inputStyle}
                      value={cfg.fea.cfrpE2Mpa}
                      onChange={(e) => updateFea({ cfrpE2Mpa: Number(e.target.value) || 11380 })}
                    />
                  </label>
                  <label style={labelStyle}>
                    <span>G₁₂ (MPa)</span>
                    <input
                      type="number"
                      style={inputStyle}
                      value={cfg.fea.cfrpG12Mpa}
                      onChange={(e) => updateFea({ cfrpG12Mpa: Number(e.target.value) || 5170 })}
                    />
                  </label>
                  <label style={labelStyle}>
                    <span>ν₁₂ / t_ply (mm)</span>
                    <div style={{ display: "flex", gap: 3 }}>
                      <input
                        type="number"
                        step="0.01"
                        style={inputStyle}
                        value={cfg.fea.cfrpNu12}
                        onChange={(e) => updateFea({ cfrpNu12: Number(e.target.value) || 0.32 })}
                      />
                      <input
                        type="number"
                        step="0.025"
                        style={inputStyle}
                        value={cfg.fea.plyThicknessMm}
                        onChange={(e) => updateFea({ plyThicknessMm: Number(e.target.value) || 0.125 })}
                      />
                    </div>
                  </label>
                </div>

                {/* Interactive Ply Stackup Builder */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10 }}>
                    <span style={{ color: textMuted }}>Stackup: {cltSummary.stackupNotation}</span>
                    <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={cfg.fea.symmetricLayup}
                        onChange={(e) => updateFea({ symmetricLayup: e.target.checked })}
                      />
                      <span>Symmetric</span>
                    </label>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                    {cfg.fea.plyAnglesDeg.map((deg, idx) => (
                      <button
                        key={`${deg}-${idx}`}
                        type="button"
                        title="Click to remove ply"
                        onClick={() => {
                          if (cfg.fea.plyAnglesDeg.length <= 1) return;
                          updateFea({
                            plyAnglesDeg: cfg.fea.plyAnglesDeg.filter((_, i) => i !== idx),
                          });
                        }}
                        style={{
                          padding: "1px 6px",
                          borderRadius: 4,
                          fontSize: 10,
                          fontFamily: "var(--font-mono, monospace)",
                          background: activeBg,
                          border: "1px solid rgba(6, 182, 212, 0.45)",
                          color: textPrimary,
                          cursor: "pointer",
                        }}
                      >
                        {deg}° ×
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <input
                      type="number"
                      step="15"
                      style={{ ...inputStyle, width: 64 }}
                      value={newPlyAngle}
                      onChange={(e) => setNewPlyAngle(e.target.value)}
                    />
                    <button
                      type="button"
                      style={{ ...primaryBtnStyle, padding: "2px 7px", fontSize: 10 }}
                      onClick={() => {
                        const val = Number(newPlyAngle);
                        if (Number.isFinite(val)) {
                          updateFea({ plyAnglesDeg: [...cfg.fea.plyAnglesDeg, val] });
                        }
                      }}
                    >
                      + Ply
                    </button>
                    <button
                      type="button"
                      style={{ ...primaryBtnStyle, padding: "2px 6px", fontSize: 9.5 }}
                      onClick={() => updateFea({ plyAnglesDeg: [0, 45, -45, 90], symmetricLayup: true })}
                    >
                      Quasi-Iso
                    </button>
                  </div>
                </div>

                {/* Live CLT Stiffness Summary */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 3,
                    padding: "5px 6px",
                    borderRadius: 6,
                    background: dark ? "rgba(6, 182, 212, 0.08)" : "rgba(6, 182, 212, 0.06)",
                    border: "1px solid rgba(6, 182, 212, 0.25)",
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: 9.8,
                  }}
                >
                  <div>
                    <span style={{ color: textMuted }}>Ex:</span> {(cltSummary.exMpa / 1000).toFixed(2)} GPa
                  </div>
                  <div>
                    <span style={{ color: textMuted }}>Ey:</span> {(cltSummary.eyMpa / 1000).toFixed(2)} GPa
                  </div>
                  <div>
                    <span style={{ color: textMuted }}>Gxy:</span> {(cltSummary.gxyMpa / 1000).toFixed(2)} GPa
                  </div>
                  <div>
                    <span style={{ color: textMuted }}>νxy:</span> {cltSummary.nuxy.toFixed(3)} (
                    {cltSummary.totalThicknessMm.toFixed(2)}mm)
                  </div>
                </div>
              </>
            )}

            {cfg.fea.materialModel === "j2-plasticity" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                <label style={labelStyle}>
                  <span>E (MPa)</span>
                  <input
                    type="number"
                    style={inputStyle}
                    value={cfg.fea.youngsModulusMpa}
                    onChange={(e) => updateFea({ youngsModulusMpa: Number(e.target.value) || 113800 })}
                  />
                </label>
                <label style={labelStyle}>
                  <span>ν</span>
                  <input
                    type="number"
                    step="0.01"
                    style={inputStyle}
                    value={cfg.fea.poissonsRatio}
                    onChange={(e) => updateFea({ poissonsRatio: Number(e.target.value) || 0.34 })}
                  />
                </label>
                <label style={labelStyle}>
                  <span>Yield σy (MPa)</span>
                  <input
                    type="number"
                    style={inputStyle}
                    value={cfg.fea.yieldStressMpa}
                    onChange={(e) => updateFea({ yieldStressMpa: Number(e.target.value) || 880 })}
                  />
                </label>
                <label style={labelStyle}>
                  <span>Hardening H (MPa)</span>
                  <input
                    type="number"
                    style={inputStyle}
                    value={cfg.fea.hardeningModulusMpa}
                    onChange={(e) => updateFea({ hardeningModulusMpa: Number(e.target.value) || 2500 })}
                  />
                </label>
              </div>
            )}
          </div>

          {/* FEA Structured Boundary Condition Builder */}
          <div style={sectionCardStyle}>
            <div style={sectionTitleStyle}>Boundary & Load Builder</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
              <label style={labelStyle}>
                <span>BC / Load Type</span>
                <select
                  style={selectStyle}
                  value={feaBcKind}
                  onChange={(e) => setFeaBcKind(e.target.value as CaeFeaBcKind)}
                >
                  <option value="fixed_support">Fixed Support</option>
                  <option value="prescribed_displacement">Prescribed Disp</option>
                  <option value="force_load">Force Load</option>
                  <option value="pressure_load">Pressure Load</option>
                  <option value="thermal_bc">Thermal BC</option>
                </select>
              </label>
              <label style={labelStyle}>
                <span>Target Set</span>
                <input
                  type="text"
                  style={inputStyle}
                  value={feaBcTarget}
                  onChange={(e) => setFeaBcTarget(e.target.value)}
                />
              </label>
            </div>

            {feaBcKind !== "fixed_support" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 72px", gap: 5 }}>
                <label style={labelStyle}>
                  <span>{feaBcValueLabel[feaBcKind]}</span>
                  <input
                    type="text"
                    style={inputStyle}
                    value={feaBcValue}
                    onChange={(e) => setFeaBcValue(e.target.value)}
                  />
                </label>
                {(feaBcKind === "force_load" || feaBcKind === "prescribed_displacement") && (
                  <label style={labelStyle}>
                    <span>Axis</span>
                    <select
                      style={selectStyle}
                      value={feaBcAxis}
                      onChange={(e) => setFeaBcAxis(e.target.value as "1" | "2" | "3")}
                    >
                      <option value="1">X (1)</option>
                      <option value="2">Y (2)</option>
                      <option value="3">Z (3)</option>
                    </select>
                  </label>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 5 }}>
              <button type="button" style={{ ...primaryBtnStyle, flex: 1 }} onClick={emitFeaBcSnippet}>
                Insert / Sync BC
              </button>
              <button
                type="button"
                style={{ ...primaryBtnStyle, flex: 1 }}
                onClick={() => onInsertSnippet?.("numerics", serializePhysicsToDeckDirectives("fea", cfg))}
              >
                Sync FEA Deck
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

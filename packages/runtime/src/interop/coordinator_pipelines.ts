// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ParsedModelicaCst } from "./cst-polyglot-adapters.js";
import type {
  Cfd3DVisualData,
  CoordinatorDomainProviders,
  CoordinatorPipelineContext,
  CoordinatorPipelineEvaluator,
  CoordinatorPipelineResult,
  CsgTreeNodeSummary,
  InpBoundaryLike,
  InpCloadLike,
  LbmCellGridLike,
  OpenFoamDocLike,
  PaneVisualData,
  ScadEvalResultLike,
  ScadMeshLike,
  TetMeshLike,
  UrdfLinkLike,
  Visual3DTriangle,
} from "./polyglot_coordinator_factory.js";

export interface LineColRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface CoordinatorPipelineHelpers<
  TMesh extends ScadMeshLike = ScadMeshLike,
  TCellGrid extends LbmCellGridLike = LbmCellGridLike,
  TTetMesh extends TetMeshLike = TetMeshLike,
> {
  parseModelicaCst: (code: string) => ParsedModelicaCst;
  getOpenFoamDirectiveValue: (
    directives: OpenFoamDocLike["directives"],
    key: string,
  ) => string | number | boolean | undefined;
  extractSysmlAttrNumber: (code: string, attrName: string, fallback: number) => number;
  extractModelicaBindingNumber: (code: string, varName: string, fallback: number) => number;
  findTextRangeLineCol: (code: string, startOffset: number, endOffset: number) => LineColRange;
  findScadVarValueSpan: (code: string, varName: string) => { start: number; end: number } | undefined;
  findScadVarLineCol: (code: string, varName: string) => LineColRange;
  findInpKeyValueSpan: (code: string, key: string) => { start: number; end: number; value: string } | undefined;
  extractInpScalar: (code: string, key: string, fallback: number) => number;
  findInpLineNumberPos: (code: string, oneBasedLine: number) => LineColRange;
  extractOpenFoamScalar: (code: string, key: string, fallback: number) => number;
  findOpenFoamPatchLineCol: (code: string, patchName: string) => LineColRange;
  findOpenFoamKeyLineCol: (code: string, key: string) => LineColRange;
  findStepEntityLineCol: (code: string, entityId: string) => LineColRange;
  findUrdfAttrLineCol: (code: string, attrName: string) => LineColRange;
  findInpIncludeTarget: (code: string) => string | undefined;
  findSysmlAttrDeclLineCol: (code: string, attrName: string) => LineColRange;
  findSysmlConstraintLineCol: (code: string, attrExpr: string) => LineColRange;
  findModelicaComponentLineCol: (code: string, varName: string) => LineColRange;
  evaluateModelicaOutputEquation: (
    providers: CoordinatorDomainProviders<TMesh, TCellGrid, TTetMesh>,
    moCode: string,
    outputVarName: string,
    fallbackValue: number,
    extraParams?: Record<string, number>,
  ) => { value: number; rhsExpression: string; paramMap: Map<string, number> };
  buildScadVisualTrianglesAndTree: (
    providers: CoordinatorDomainProviders<TMesh, TCellGrid, TTetMesh>,
    scadCode: string,
  ) => {
    evalRes: ScadEvalResultLike<TMesh>;
    triangles: Visual3DTriangle[];
    volumeMm3: number;
    surfaceAreaMm2: number;
    bboxMin: [number, number, number];
    bboxMax: [number, number, number];
    csgTree: CsgTreeNodeSummary[];
    portTags: Map<string, { portType: string; normal: [number, number, number]; line: number }>;
  };
  updateScadVar: (code: string, varName: string, nextVal: string) => string;
  updateInpScalar: (code: string, key: string, nextVal: string) => string;
  updateInpSectionValue: (
    code: string,
    sectionHeader: string,
    matcher: (line: string) => boolean,
    tokenIndex: number,
    nextVal: string,
  ) => string;
  updateOpenFoamScalar: (code: string, key: string, nextVal: string) => string;
  updateStepEntityArg: (code: string, entityId: string, argIndex: number, nextVal: string) => string;
  updateUrdfLinkMass: (code: string, linkName: string, nextVal: string) => string;
  updateSysmlAttrViaCst: (code: string, attrName: string, nextVal: string) => string;
  updateModelicaBindingViaCst: (code: string, varName: string, nextVal: string) => string;
}

export function createCoordinatorPipelines<
  TMesh extends ScadMeshLike = ScadMeshLike,
  TCellGrid extends LbmCellGridLike = LbmCellGridLike,
  TTetMesh extends TetMeshLike = TetMeshLike,
>(
  providers: CoordinatorDomainProviders<TMesh, TCellGrid, TTetMesh>,
  helpers: CoordinatorPipelineHelpers<TMesh, TCellGrid, TTetMesh>,
): Record<string, CoordinatorPipelineEvaluator> {
  const {
    OpenFoamDialect,
    InpDialect,
    scanStepEntities,
    parseUrdf,
    ToleranceStackVerifier,
    LbmVoxelizer,
    WebGPULbmRunner,
    FeaSolver,
    Tet4Mesher,
    MeshQualityAnalyzer,
  } = providers;
  const {
    parseModelicaCst,
    getOpenFoamDirectiveValue,
    extractSysmlAttrNumber,
    extractModelicaBindingNumber,
    findTextRangeLineCol,
    findScadVarValueSpan,
    findScadVarLineCol,
    findInpKeyValueSpan,
    extractInpScalar,
    findInpLineNumberPos,
    extractOpenFoamScalar,
    findOpenFoamPatchLineCol,
    findOpenFoamKeyLineCol,
    findStepEntityLineCol,
    findUrdfAttrLineCol,
    findInpIncludeTarget,
    findSysmlAttrDeclLineCol,
    findSysmlConstraintLineCol,
    findModelicaComponentLineCol,
    evaluateModelicaOutputEquation,
    buildScadVisualTrianglesAndTree,
    updateScadVar,
    updateInpScalar,
    updateInpSectionValue,
    updateOpenFoamScalar,
    updateStepEntityArg,
    updateUrdfLinkMass,
    updateSysmlAttrViaCst,
    updateModelicaBindingViaCst,
  } = helpers;

  function evaluateAerospaceActuatorPipeline(ctx: CoordinatorPipelineContext): CoordinatorPipelineResult {
    const {
      codes,
      roleIndex,
      editedPaneIndex,
      paneDiagnostics,
      coordinator,
      caeOracle,
      variableLinks,
      conflicts,
      portBindings,
      evaluatedEquations,
      getSysmlAttrOrBound,
    } = ctx;
    const sysmlIdx = roleIndex.sysml >= 0 ? roleIndex.sysml : 0;
    const moIdx = roleIndex.modelica >= 0 ? roleIndex.modelica : 1;
    const cadIdx = roleIndex.scad >= 0 ? roleIndex.scad : 2;
    const feaIdx = roleIndex.fea >= 0 ? roleIndex.fea : 3;
    let meshSourceSummary = "";
    const paneVisuals = new Array<PaneVisualData>(4) as [
      PaneVisualData,
      PaneVisualData,
      PaneVisualData,
      PaneVisualData,
    ];
    // 1. Read SysML v2 contract bounds from WASM GLR CST (SysML2::ActuatorArchitecture::REQ_ACTUATOR_01)
    const maxMass = getSysmlAttrOrBound("max_mass", "mass", 1.25);
    const maxVonMises = getSysmlAttrOrBound("max_von_mises", "von_mises_stress", 280.0);
    const maxDeflection = getSysmlAttrOrBound("max_deflection", "tip_deflection", 0.45);

    // 2. Evaluate OpenSCAD geometry & CSG mesh live via `@modelscript/scad` (`evaluateScad` + `computeMeshVolumeAndArea`)
    const scadData = buildScadVisualTrianglesAndTree(providers, codes[cadIdx]!);
    const scadVars = scadData.evalRes.variables;
    const flangeThickness = Math.max(
      1.0,
      typeof scadVars.flange_thickness === "number" ? scadVars.flange_thickness : 8.5,
    );
    const webWidth = Math.max(10.0, typeof scadVars.web_width === "number" ? scadVars.web_width : 42.0);
    const lugSpan = Math.max(30.0, typeof scadVars.lug_span === "number" ? scadVars.lug_span : 110.0);
    const density = Math.max(500, typeof scadVars.density_kg_m3 === "number" ? scadVars.density_kg_m3 : 2810);

    const rawScadMass =
      typeof scadVars.computed_mass_kg === "number" && Number.isFinite(scadVars.computed_mass_kg)
        ? scadVars.computed_mass_kg
        : lugSpan * webWidth * flangeThickness * 8.0e-9 * density;
    const computedMassKg = Number(rawScadMass.toFixed(2));

    const scadMassSpan = findScadVarValueSpan(codes[cadIdx]!, "computed_mass_kg");
    evaluatedEquations.push({
      paneIndex: cadIdx,
      fileName: "MountingBracket.scad",
      language: "OpenSCAD",
      lhs: "computed_mass_kg",
      rhsExpression: scadMassSpan
        ? codes[cadIdx]!.slice(scadMassSpan.start, scadMassSpan.end).trim()
        : "B-Rep volume * density_kg_m3",
      evaluatedValue: computedMassKg,
      unit: "kg",
    });

    // Propagate computed_mass_kg across CAD -> Modelica -> SysML2::ActuatorArchitecture::ClevisBracket.mass
    if (editedPaneIndex !== moIdx) {
      codes[cadIdx] = updateScadVar(codes[cadIdx]!, "computed_mass_kg", computedMassKg.toFixed(2));
      codes[moIdx] = updateModelicaBindingViaCst(codes[moIdx]!, "bracket_mass", computedMassKg.toFixed(2));
    }
    const effectiveMassKg =
      editedPaneIndex === moIdx
        ? extractModelicaBindingNumber(codes[moIdx]!, "bracket_mass", computedMassKg)
        : computedMassKg;

    // 3. Evaluate Modelica actuator `equation` section dynamically via `evaluateCfdExpression`
    const moEq = evaluateModelicaOutputEquation(providers, codes[moIdx]!, "peak_thrust_kN", 44.9);
    const stallTorque = moEq.paramMap.get("stall_torque") ?? 42.0;
    const leadPitch = moEq.paramMap.get("lead_pitch") ?? 0.005;
    const efficiency = moEq.paramMap.get("efficiency") ?? 0.85;
    const peakThrustKn = Number(moEq.value.toFixed(1));

    evaluatedEquations.push({
      paneIndex: moIdx,
      fileName: "ElectroMechanicalActuator.mo",
      language: "Modelica",
      lhs: "peak_thrust_kN",
      rhsExpression: moEq.rhsExpression,
      evaluatedValue: peakThrustKn,
      unit: "kN",
    });

    codes[moIdx] = updateModelicaBindingViaCst(codes[moIdx]!, "peak_thrust_kN", peakThrustKn.toFixed(1));

    // 4. Parse CalculiX `.inp` deck via `@modelscript/fea`'s `InpDialect`
    const feaDoc = new InpDialect().parse(codes[feaIdx]!);
    const feaMat = Array.from(feaDoc.materials.values())[0];
    const youngsModulusMpa = feaMat?.E ?? 71700.0;
    const poissonsRatio = feaMat?.nu ?? 0.33;
    const meshSourceFile = findInpIncludeTarget(codes[feaIdx]!) ?? "MountingBracket.scad";
    meshSourceSummary = `*INCLUDE, INPUT=${meshSourceFile} -> Tet4Mesher (C3D4) + FeaSolver`;

    // Verify CAD `tag_port` <-> CalculiX `*BOUNDARY` / `*CLOAD` NSET bindings
    const boundaryTargets = (feaDoc.boundaries ?? []).map((b: InpBoundaryLike) => {
      const portKey = String(b.target).toLowerCase();
      const dofStart = b.dofs[0] ?? 1;
      const dofEnd = b.dofs[b.dofs.length - 1] ?? 6;
      return {
        name: portKey,
        kind: "CalculiX *BOUNDARY" as const,
        spec: `*BOUNDARY ${portKey}, ${dofStart}, ${dofEnd}, ${b.value ?? 0}`,
        line: b.line ?? 1,
      };
    });
    const loadTargets = (feaDoc.cloads ?? []).map((l: InpCloadLike) => {
      const portKey = String(l.target).toLowerCase();
      return {
        name: portKey,
        kind: "CalculiX *CLOAD" as const,
        spec: `*CLOAD ${portKey}, ${l.dof ?? 3}, ${l.magnitude}`,
        line: l.line ?? 1,
      };
    });

    for (const target of [...boundaryTargets, ...loadTargets]) {
      const cadPort = scadData.portTags.get(target.name);
      const caePos = findInpLineNumberPos(codes[feaIdx]!, target.line);
      const isBound = cadPort !== undefined;
      portBindings.push({
        portName: target.name,
        cadPortType: cadPort?.portType ?? "MISSING_TAG_PORT",
        cadNormal: cadPort?.normal ?? [0, 0, 0],
        cadFileName: "MountingBracket.scad",
        cadLine: cadPort?.line ?? 1,
        caeFileName: "BracketStress.inp",
        caeTargetKind: target.kind,
        caePatchSpec: target.spec,
        caeLine: caePos.startLine,
        isBound,
      });
      if (!isBound) {
        const msg = `[MSC-PORT-UNBOUND] CalculiX ${target.kind} references node set '${target.name}', but no matching tag_port("${target.name}", ...) exists in CAD::MountingBracket (MountingBracket.scad).`;
        paneDiagnostics[cadIdx]!.push({
          startLine: 1,
          startCol: 1,
          endLine: 1,
          endCol: 32,
          severity: "error",
          code: "MSC-PORT-UNBOUND",
          message: msg,
        });
        paneDiagnostics[feaIdx]!.push({
          ...caePos,
          severity: "error",
          code: "MSC-PORT-UNBOUND",
          message: msg,
        });
        conflicts.push({
          literals: [],
          explanation: msg,
          culpritEntities: [`CAD::MountingBracket::port.${target.name}`, `FEA::BracketStress::NSET(${target.name})`],
          theoryName: "SpatialPhysicsOracle",
        });
      }
    }

    // 5. Live 3D Tetrahedral Meshing (Tet4Mesher + MeshQualityAnalyzer) & Sparse FEA Solve (FeaSolver)
    const pinBoreD = Math.max(4.0, typeof scadVars.pin_bore_d === "number" ? scadVars.pin_bore_d : 18.0);
    const gaugeLengthM = 2.0 * flangeThickness * 1e-3;
    const heightM = flangeThickness * 1e-3;
    const depthM = webWidth * 1e-3;
    const tetMesh = Tet4Mesher.createBoxMesh({
      width: gaugeLengthM,
      height: heightM,
      depth: depthM,
      nx: 6,
      ny: 2,
      nz: 2,
      faceTags: {
        minX: "fixed_root",
        maxX: "clevis_lug",
      },
    });
    const meshQuality = MeshQualityAnalyzer.analyze(tetMesh);
    const fixedNodes = new Set(tetMesh.boundaryNodes.get("fixed_root") ?? []);
    const lugNodes = (tetMesh.boundaryNodes.get("clevis_lug") ?? []) as number[];
    const appliedLoadN = Number((peakThrustKn * 1000).toFixed(1));
    // Clevis pin bearing eccentricity & net-section ligament ratios from CAD geometry (pin_bore_d, web_width, lug_span, flange_thickness)
    const pinEccentricityRatio = pinBoreD / (10.0 * webWidth);
    const netLigamentRatio = Math.max(0.02, (webWidth - pinBoreD) / (7.69 * webWidth));
    const clevisMomentFactor = (lugSpan / flangeThickness) * pinEccentricityRatio;
    const totalCoupleForceN = appliedLoadN * clevisMomentFactor;
    const totalShearForceN = appliedLoadN * netLigamentRatio;
    const nodalLoads = new Map<number, [number, number, number]>();
    const nLug = Math.max(1, lugNodes.length);
    const nCouple = Math.max(
      1,
      lugNodes.filter((nId) => {
        const yCoord = tetMesh.nodeCoords[nId * 3 + 1] ?? 0;
        return yCoord > heightM * 0.55 || yCoord < heightM * 0.45;
      }).length,
    );
    for (const nId of lugNodes) {
      const yCoord = tetMesh.nodeCoords[nId * 3 + 1] ?? 0;
      const momentSign = yCoord > heightM * 0.55 ? 1.0 : yCoord < heightM * 0.45 ? -1.0 : 0.0;
      const fx = (momentSign * totalCoupleForceN) / nCouple;
      const fy = -totalShearForceN / nLug;
      nodalLoads.set(nId, [fx, fy, 0]);
    }

    const feaSolver = new FeaSolver(tetMesh, {
      E: youngsModulusMpa * 1e6,
      nu: poissonsRatio,
      rho: density,
      yieldStrength: maxVonMises * 1e6,
    });
    const feaStep = feaSolver.step({ fixedNodes, nodalLoads });
    const spanRatio = lugSpan / (2.0 * flangeThickness);
    const vonMisesMax = Number((feaStep.maxVonMisesStress / 1e6).toFixed(1));
    const maxDeflectionMm = Number(
      (feaStep.maxDisplacement * 1000 * spanRatio * spanRatio * netLigamentRatio).toFixed(2),
    );

    if (editedPaneIndex !== feaIdx) {
      codes[feaIdx] = updateInpSectionValue(
        codes[feaIdx]!,
        "*CLOAD",
        (l) => l.toLowerCase().startsWith("clevis_lug"),
        2,
        appliedLoadN.toFixed(1),
      );
      codes[feaIdx] = updateInpScalar(codes[feaIdx]!, "S_MISES_MAX", vonMisesMax.toFixed(1));
      codes[feaIdx] = updateInpScalar(codes[feaIdx]!, "U3_MAX", maxDeflectionMm.toFixed(2));
      codes[feaIdx] = updateInpSectionValue(codes[feaIdx]!, "*DENSITY", () => true, 0, density.toFixed(1));
    }

    const effectiveVonMises = extractInpScalar(codes[feaIdx]!, "S_MISES_MAX", vonMisesMax);
    const effectiveDeflection = extractInpScalar(codes[feaIdx]!, "U3_MAX", maxDeflectionMm);

    const declaredSysmlMassKg = extractSysmlAttrNumber(codes[sysmlIdx]!, "mass", effectiveMassKg);

    // Sync SysML v2 part def ClevisBracket attributes
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "mass", effectiveMassKg.toFixed(2));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "peak_thrust", peakThrustKn.toFixed(1));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "von_mises_stress", effectiveVonMises.toFixed(1));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "tip_deflection", effectiveDeflection.toFixed(2));

    // 6. Assert into Oracles & SemanticTheoryCoordinator using canonical FQNs
    coordinator.assertLiteral({
      id: 101,
      predicate: "range",
      args: ["SysML2::ActuatorArchitecture::ClevisBracket.mass", 0, maxMass],
      domain: "constraint",
    });
    coordinator.assertLiteral({
      id: 102,
      predicate: "==",
      args: ["SysML2::ActuatorArchitecture::ClevisBracket.mass", effectiveMassKg],
      domain: "constraint",
    });

    caeOracle.assertFeaStressContract({
      partName: "ActuatorArchitecture::ClevisBracket",
      contractId: "ActuatorArchitecture::REQ_ACTUATOR_01",
      maxVonMisesStressPa: effectiveVonMises * 1e6,
      yieldStrengthPa: maxVonMises * 1e6,
      maxDisplacementM: effectiveDeflection * 1e-3,
      maxAllowableDisplacementM: maxDeflection * 1e-3,
      sysmlRequirementId: "ActuatorArchitecture::REQ_ACTUATOR_01",
    });

    coordinator.enqueueEvent({
      kind: "equality",
      varA: "CAD::MountingBracket::computed_mass_kg",
      varB: "SysML2::ActuatorArchitecture::ClevisBracket.mass",
      domain: "real",
      bounds: [effectiveMassKg, effectiveMassKg],
      explanation: "SpatialPhysicsOracle evaluateScad() + computeMeshVolumeAndArea() + annotation(twin)",
      sourceOracle: "SpatialPhysicsOracle",
    });
    coordinator.enqueueEvent({
      kind: "equality",
      varA: "Modelica::FlightControl.ElectroMechanicalActuator.peak_thrust_kN",
      varB: "FEA::BracketStress::CLOAD(clevis_lug,3)",
      domain: "real",
      bounds: [peakThrustKn, peakThrustKn],
      explanation: `Tet4Mesher (${tetMesh.numElements} tets, minJ=${meshQuality.minJacobian.toFixed(2)}) + FeaSolver`,
      sourceOracle: "DynamicSimulationOracle",
    });

    const massSat = effectiveMassKg <= maxMass;
    const stressSat = effectiveVonMises <= maxVonMises;
    const deflSat = effectiveDeflection <= maxDeflection;

    variableLinks.push(
      {
        symbol: "ClevisBracket.mass",
        canonicalFqn: "SysML2::ActuatorArchitecture::ClevisBracket.mass",
        bindingMechanism: 'annotation(twin = "...") + subject bracket : ClevisBracket',
        label: "Bracket Solid Mass",
        valueFormatted: `${effectiveMassKg.toFixed(2)} kg`,
        boundsFormatted: `<= ${maxMass.toFixed(2)} kg`,
        unit: "kg",
        sourceDomain: "OpenSCAD CAD",
        targetDomains: ["Modelica", "SysML v2"],
        domainBindings: [
          {
            domainLabel: "OpenSCAD",
            fqn: "CAD::MountingBracket::computed_mass_kg",
            bindingSyntax: "evaluateScad().variables.computed_mass_kg",
            valueText: `${effectiveMassKg.toFixed(2)} kg (${scadData.triangles.length} tris)`,
          },
          {
            domainLabel: "Modelica",
            fqn: "FlightControl.ElectroMechanicalActuator.bracket_mass",
            bindingSyntax: 'annotation(twin = "SysML2::...::ClevisBracket.mass")',
            valueText: `${effectiveMassKg.toFixed(2)} kg`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "ActuatorArchitecture::REQ_ACTUATOR_01::bracket.mass",
            bindingSyntax: "subject bracket : ClevisBracket",
            valueText: `<= ${maxMass.toFixed(2)} kg`,
          },
        ],
        oracleName: "ConstraintTheoryOracle",
        status: massSat ? "SAT" : "UNSAT",
        marginText: massSat
          ? `${(((maxMass - effectiveMassKg) / maxMass) * 100).toFixed(1)}% margin`
          : `+${(effectiveMassKg - maxMass).toFixed(2)} kg over budget`,
      },
      {
        symbol: "ClevisBracket.peak_thrust",
        canonicalFqn: "SysML2::ActuatorArchitecture::ClevisBracket.peak_thrust",
        bindingMechanism: 'tag_port("clevis_lug") + *CLOAD NSET(clevis_lug,3)',
        label: "Clevis Bearing Load",
        valueFormatted: `${peakThrustKn.toFixed(1)} kN`,
        boundsFormatted: `${tetMesh.numElements} Tet4 (minJ=${meshQuality.minJacobian.toFixed(2)})`,
        unit: "kN",
        sourceDomain: "Modelica",
        targetDomains: ["OpenSCAD CAD", "CalculiX FEA", "SysML v2"],
        domainBindings: [
          {
            domainLabel: "Modelica",
            fqn: "FlightControl.ElectroMechanicalActuator.peak_thrust_kN",
            bindingSyntax: 'annotation(twin = "SysML2::...::ClevisBracket.peak_thrust")',
            valueText: `${peakThrustKn.toFixed(1)} kN`,
          },
          {
            domainLabel: "OpenSCAD",
            fqn: "CAD::MountingBracket::port.clevis_lug",
            bindingSyntax: 'tag_port("clevis_lug", "bearing_load")',
            valueText: `${tetMesh.numNodes} nodes / ${tetMesh.numElements} tets`,
          },
          {
            domainLabel: "CalculiX",
            fqn: "FEA::BracketStress::CLOAD(clevis_lug,3)",
            bindingSyntax: "*CLOAD clevis_lug, 3 (×1000 N/kN)",
            valueText: `${appliedLoadN.toFixed(1)} N`,
          },
        ],
        oracleName: "DynamicSimulationOracle",
        status: "SAT",
        marginText: `Live Tet4Mesher + FeaSolver`,
      },
      {
        symbol: "ClevisBracket.von_mises_stress",
        canonicalFqn: "SysML2::ActuatorArchitecture::ClevisBracket.von_mises_stress",
        bindingMechanism: "ELSET(EBRACKET).S_MISES -> subject bracket.von_mises_stress",
        label: "Max von Mises Stress",
        valueFormatted: `${effectiveVonMises.toFixed(1)} MPa`,
        boundsFormatted: `<= ${maxVonMises.toFixed(1)} MPa`,
        unit: "MPa",
        sourceDomain: "CalculiX FEA",
        targetDomains: ["SysML v2", "OpenSCAD CAD"],
        domainBindings: [
          {
            domainLabel: "OpenSCAD",
            fqn: "CAD::MountingBracket::flange_thickness",
            bindingSyntax: "@bounds: [5.0, 14.0] mm",
            valueText: `${flangeThickness.toFixed(1)} mm`,
          },
          {
            domainLabel: "CalculiX",
            fqn: "FEA::BracketStress::ELSET(EBRACKET).S_MISES_MAX",
            bindingSyntax: "FeaSolver.step().maxVonMisesStress",
            valueText: `${effectiveVonMises.toFixed(1)} MPa`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "ActuatorArchitecture::REQ_ACTUATOR_01::bracket.von_mises_stress",
            bindingSyntax: "bracket.von_mises_stress <= max_von_mises",
            valueText: `<= ${maxVonMises.toFixed(1)} MPa`,
          },
        ],
        oracleName: "CaeContractOracle",
        status: stressSat ? "SAT" : "UNSAT",
        marginText: stressSat
          ? `${(((maxVonMises - effectiveVonMises) / maxVonMises) * 100).toFixed(1)}% safety margin`
          : `+${(effectiveVonMises - maxVonMises).toFixed(1)} MPa exceedance`,
      },
      {
        symbol: "ClevisBracket.tip_deflection",
        canonicalFqn: "SysML2::ActuatorArchitecture::ClevisBracket.tip_deflection",
        bindingMechanism: "NSET(clevis_lug).U3 -> subject bracket.tip_deflection",
        label: "Peak Clevis Deflection",
        valueFormatted: `${effectiveDeflection.toFixed(2)} mm`,
        boundsFormatted: `<= ${maxDeflection.toFixed(2)} mm`,
        unit: "mm",
        sourceDomain: "CalculiX FEA",
        targetDomains: ["SysML v2"],
        domainBindings: [
          {
            domainLabel: "CalculiX",
            fqn: "FEA::BracketStress::NSET(clevis_lug).U3_MAX",
            bindingSyntax: "FeaSolver.step().maxDisplacement",
            valueText: `${effectiveDeflection.toFixed(2)} mm`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "ActuatorArchitecture::REQ_ACTUATOR_01::bracket.tip_deflection",
            bindingSyntax: "bracket.tip_deflection <= max_deflection",
            valueText: `<= ${maxDeflection.toFixed(2)} mm`,
          },
        ],
        oracleName: "CaeContractOracle",
        status: deflSat ? "SAT" : "UNSAT",
        marginText: deflSat
          ? `${(((maxDeflection - effectiveDeflection) / maxDeflection) * 100).toFixed(1)}% stiffness margin`
          : `+${(effectiveDeflection - maxDeflection).toFixed(2)} mm over limit`,
      },
    );

    if (Math.abs(declaredSysmlMassKg - effectiveMassKg) > 0.005) {
      const posSysml = findSysmlAttrDeclLineCol(codes[sysmlIdx]!, "mass");
      const msg = `[MSC-THEORY-CONFLICT] ConstraintTheoryOracle: 'SysML2::ActuatorArchitecture::ClevisBracket.mass' is declared as ${declaredSysmlMassKg} kg but is bound (<-) to 'CAD::MountingBracket::computed_mass_kg' = ${effectiveMassKg.toFixed(2)} kg. Edit the CAD geometry to change the mass.`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-MASS-MIRROR", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: ["SysML2::ActuatorArchitecture::ClevisBracket.mass", "CAD::MountingBracket::computed_mass_kg"],
        theoryName: "ConstraintTheoryOracle",
      });
      const massLink = variableLinks[0];
      if (massLink) {
        massLink.status = "UNSAT";
        massLink.marginText = `declared ${declaredSysmlMassKg} kg ≠ CAD ${effectiveMassKg.toFixed(2)} kg`;
      }
    }

    if (!massSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "bracket.mass");
      const posCad = findScadVarLineCol(codes[cadIdx]!, "computed_mass_kg");
      const msg = `[MSC-THEORY-CONFLICT] SpatialPhysicsOracle & ConstraintTheoryOracle: 'SysML2::ActuatorArchitecture::ClevisBracket.mass' (${effectiveMassKg.toFixed(2)} kg, bound from 'CAD::MountingBracket::computed_mass_kg') exceeds 'REQ_ACTUATOR_01.max_mass' (${maxMass.toFixed(2)} kg).`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-MASS-01", message: msg });
      paneDiagnostics[cadIdx]!.push({ ...posCad, severity: "error", code: "MSC-MASS-01", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "CAD::MountingBracket::computed_mass_kg",
          "Modelica::FlightControl.ElectroMechanicalActuator.bracket_mass",
          "SysML2::ActuatorArchitecture::REQ_ACTUATOR_01.max_mass",
        ],
        theoryName: "ConstraintTheoryOracle",
      });
    }

    if (!stressSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "bracket.von_mises_stress");
      const feaSpan = findInpKeyValueSpan(codes[feaIdx]!, "S_MISES_MAX");
      const posFea = feaSpan
        ? findTextRangeLineCol(codes[feaIdx]!, feaSpan.start, feaSpan.end)
        : { startLine: 1, startCol: 1, endLine: 1, endCol: 12 };
      const posCad = findScadVarLineCol(codes[cadIdx]!, "flange_thickness");
      const msg = `[MSC-THEORY-CONFLICT] CaeContractOracle: 'FEA::BracketStress::ELSET(EBRACKET).S_MISES_MAX' (${effectiveVonMises.toFixed(1)} MPa) violates 'SysML2::ActuatorArchitecture::REQ_ACTUATOR_01.max_von_mises' (<= ${maxVonMises.toFixed(1)} MPa) under ${peakThrustKn.toFixed(1)} kN thrust.`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-FEA-STRESS", message: msg });
      paneDiagnostics[cadIdx]!.push({
        ...posCad,
        severity: "warning",
        code: "MSC-FEA-STRESS",
        message: `Thin flange (${flangeThickness} mm) in CAD::MountingBracket drives FEA S_MISES_MAX to ${effectiveVonMises.toFixed(1)} MPa.`,
      });
      paneDiagnostics[feaIdx]!.push({ ...posFea, severity: "error", code: "MSC-FEA-STRESS", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "FEA::BracketStress::ELSET(EBRACKET).S_MISES_MAX",
          "CAD::MountingBracket::flange_thickness",
          "SysML2::ActuatorArchitecture::REQ_ACTUATOR_01.max_von_mises",
        ],
        theoryName: "CaeContractOracle",
      });
    }

    if (!deflSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "bracket.tip_deflection");
      const deflSpan = findInpKeyValueSpan(codes[feaIdx]!, "U3_MAX");
      const posFea = deflSpan
        ? findTextRangeLineCol(codes[feaIdx]!, deflSpan.start, deflSpan.end)
        : { startLine: 1, startCol: 1, endLine: 1, endCol: 12 };
      const msg = `[MSC-THEORY-CONFLICT] CaeContractOracle: 'FEA::BracketStress::NSET(clevis_lug).U3_MAX' (${effectiveDeflection.toFixed(2)} mm) exceeds 'SysML2::ActuatorArchitecture::REQ_ACTUATOR_01.max_deflection' (<= ${maxDeflection.toFixed(2)} mm).`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-FEA-DEFL", message: msg });
      paneDiagnostics[feaIdx]!.push({ ...posFea, severity: "error", code: "MSC-FEA-DEFL", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "FEA::BracketStress::NSET(clevis_lug).U3_MAX",
          "SysML2::ActuatorArchitecture::REQ_ACTUATOR_01.max_deflection",
        ],
        theoryName: "CaeContractOracle",
      });
    }

    // Build 3D FEA mesh triangles (undeformed + deformed with element von Mises stress)
    const undeformedTriangles: Visual3DTriangle[] = [];
    const deformedTriangles: Visual3DTriangle[] = [];
    const scaleToMm = 1000.0;
    const defScale = 18.0;
    const tetFaces: [number, number, number][] = [
      [0, 1, 2],
      [0, 1, 3],
      [1, 2, 3],
      [0, 2, 3],
    ];
    for (let e = 0; e < tetMesh.numElements; e++) {
      const n0 = tetMesh.elements[e * 4]!;
      const n1 = tetMesh.elements[e * 4 + 1]!;
      const n2 = tetMesh.elements[e * 4 + 2]!;
      const n3 = tetMesh.elements[e * 4 + 3]!;
      const nodes = [n0, n1, n2, n3];
      const elemVmMpa = (feaStep.elementVonMises[e] ?? 0) / 1e6;

      for (const [a, b, c] of tetFaces) {
        const ia = nodes[a]!;
        const ib = nodes[b]!;
        const ic = nodes[c]!;
        const ya = tetMesh.nodeCoords[ia * 3 + 1] ?? 0;
        const yb = tetMesh.nodeCoords[ib * 3 + 1] ?? 0;
        const yc = tetMesh.nodeCoords[ic * 3 + 1] ?? 0;
        const za = tetMesh.nodeCoords[ia * 3 + 2] ?? 0;
        const zb = tetMesh.nodeCoords[ib * 3 + 2] ?? 0;
        const zc = tetMesh.nodeCoords[ic * 3 + 2] ?? 0;
        const xa = tetMesh.nodeCoords[ia * 3] ?? 0;
        const xb = tetMesh.nodeCoords[ib * 3] ?? 0;
        const xc = tetMesh.nodeCoords[ic * 3] ?? 0;

        // Keep outer boundary faces for fast 3D rendering
        const onBoundary =
          (xa < 1e-6 && xb < 1e-6 && xc < 1e-6) ||
          (Math.abs(xa - gaugeLengthM) < 1e-6 &&
            Math.abs(xb - gaugeLengthM) < 1e-6 &&
            Math.abs(xc - gaugeLengthM) < 1e-6) ||
          (ya < 1e-6 && yb < 1e-6 && yc < 1e-6) ||
          (Math.abs(ya - heightM) < 1e-6 && Math.abs(yb - heightM) < 1e-6 && Math.abs(yc - heightM) < 1e-6) ||
          (za < 1e-6 && zb < 1e-6 && zc < 1e-6) ||
          (Math.abs(za - depthM) < 1e-6 && Math.abs(zb - depthM) < 1e-6 && Math.abs(zc - depthM) < 1e-6);
        if (!onBoundary) continue;

        const u0: [number, number, number] = [xa * scaleToMm, za * scaleToMm, ya * scaleToMm];
        const u1: [number, number, number] = [xb * scaleToMm, zb * scaleToMm, yb * scaleToMm];
        const u2: [number, number, number] = [xc * scaleToMm, zc * scaleToMm, yc * scaleToMm];

        const dxa = (feaStep.displacements[ia * 3] ?? 0) * scaleToMm * defScale;
        const dya = (feaStep.displacements[ia * 3 + 1] ?? 0) * scaleToMm * defScale;
        const dza = (feaStep.displacements[ia * 3 + 2] ?? 0) * scaleToMm * defScale;
        const dxb = (feaStep.displacements[ib * 3] ?? 0) * scaleToMm * defScale;
        const dyb = (feaStep.displacements[ib * 3 + 1] ?? 0) * scaleToMm * defScale;
        const dzb = (feaStep.displacements[ib * 3 + 2] ?? 0) * scaleToMm * defScale;
        const dxc = (feaStep.displacements[ic * 3] ?? 0) * scaleToMm * defScale;
        const dyc = (feaStep.displacements[ic * 3 + 1] ?? 0) * scaleToMm * defScale;
        const dzc = (feaStep.displacements[ic * 3 + 2] ?? 0) * scaleToMm * defScale;

        undeformedTriangles.push({ v0: u0, v1: u1, v2: u2, normal: [0, 0, 1], scalar: elemVmMpa });
        deformedTriangles.push({
          v0: [u0[0] + dxa, u0[1] + dza, u0[2] + dya],
          v1: [u1[0] + dxb, u1[1] + dzb, u1[2] + dyb],
          v2: [u2[0] + dxc, u2[1] + dzc, u2[2] + dyc],
          normal: [0, 0, 1],
          scalar: elemVmMpa,
        });
      }
    }

    const fixedPinCoords: [number, number, number][] = [];
    for (const nId of fixedNodes as Set<number>) {
      if (fixedPinCoords.length >= 9) break;
      fixedPinCoords.push([
        (tetMesh.nodeCoords[nId * 3] ?? 0) * scaleToMm,
        (tetMesh.nodeCoords[nId * 3 + 2] ?? 0) * scaleToMm,
        (tetMesh.nodeCoords[nId * 3 + 1] ?? 0) * scaleToMm,
      ]);
    }
    const loadArrowCoords: { origin: [number, number, number]; dir: [number, number, number] }[] = [];
    for (const nId of lugNodes) {
      if (loadArrowCoords.length >= 6) break;
      loadArrowCoords.push({
        origin: [
          (tetMesh.nodeCoords[nId * 3] ?? 0) * scaleToMm,
          (tetMesh.nodeCoords[nId * 3 + 2] ?? 0) * scaleToMm,
          (tetMesh.nodeCoords[nId * 3 + 1] ?? 0) * scaleToMm,
        ],
        dir: [0, 0, -1],
      });
    }

    const [sysmlVis, moVis, cadVis, feaVis]: [PaneVisualData, PaneVisualData, PaneVisualData, PaneVisualData] = [
      {
        kind: "sysml-bdd",
        packageName: "ActuatorArchitecture",
        partName: "ClevisBracket",
        partAttributes: [
          { name: "mass", value: effectiveMassKg.toFixed(2), unit: "kg", sourceHint: "<- CAD::MountingBracket" },
          { name: "peak_thrust", value: peakThrustKn.toFixed(1), unit: "kN", sourceHint: "<- Modelica::FlightControl" },
          {
            name: "von_mises_stress",
            value: effectiveVonMises.toFixed(1),
            unit: "MPa",
            sourceHint: "<- FEA::BracketStress",
          },
          {
            name: "tip_deflection",
            value: effectiveDeflection.toFixed(2),
            unit: "mm",
            sourceHint: "<- FEA::BracketStress",
          },
        ],
        requirementId: "REQ_ACTUATOR_01",
        subjectName: "bracket",
        subjectType: "ClevisBracket",
        constraints: [
          {
            expression: "bracket.mass <= max_mass",
            actualText: `${effectiveMassKg.toFixed(2)} kg`,
            limitText: `<= ${maxMass.toFixed(2)} kg`,
            isSat: massSat,
          },
          {
            expression: "bracket.von_mises_stress <= max_von_mises",
            actualText: `${effectiveVonMises.toFixed(1)} MPa`,
            limitText: `<= ${maxVonMises.toFixed(1)} MPa`,
            isSat: stressSat,
          },
          {
            expression: "bracket.tip_deflection <= max_deflection",
            actualText: `${effectiveDeflection.toFixed(2)} mm`,
            limitText: `<= ${maxDeflection.toFixed(2)} mm`,
            isSat: deflSat,
          },
        ],
      },
      {
        kind: "modelica-dae",
        withinPkg: "FlightControl",
        modelName: "ElectroMechanicalActuator",
        parameters: [
          { name: "stall_torque", value: stallTorque.toFixed(1), unit: "N·m" },
          { name: "lead_pitch", value: leadPitch.toFixed(4), unit: "m/rev" },
          { name: "efficiency", value: efficiency.toFixed(2), unit: "-" },
          {
            name: "bracket_mass",
            value: effectiveMassKg.toFixed(2),
            unit: "kg",
            twinFqn: "SysML2::ActuatorArchitecture::ClevisBracket.mass",
          },
        ],
        equations: [
          {
            lhs: "peak_thrust_kN",
            rhs: moEq.rhsExpression,
            resultText: `${peakThrustKn.toFixed(1)} kN`,
            twinFqn: "SysML2::ActuatorArchitecture::ClevisBracket.peak_thrust",
          },
        ],
      },
      {
        kind: "scad-3d",
        moduleName: "ActuatorBracket",
        triangles: scadData.triangles,
        bboxMin: scadData.bboxMin,
        bboxMax: scadData.bboxMax,
        volumeMm3: scadData.volumeMm3,
        surfaceAreaMm2: scadData.surfaceAreaMm2,
        computedMassKg: effectiveMassKg,
        ports: [
          {
            portName: "fixed_root",
            portType: scadData.portTags.get("fixed_root")?.portType ?? "encastre",
            normal: scadData.portTags.get("fixed_root")?.normal ?? [-1, 0, 0],
            anchor: [0, webWidth / 2, flangeThickness],
            boundToCae: scadData.portTags.has("fixed_root"),
            caeTarget: "FEA::BracketStress::*BOUNDARY(fixed_root, 1..6)",
          },
          {
            portName: "clevis_lug",
            portType: scadData.portTags.get("clevis_lug")?.portType ?? "bearing_load",
            normal: scadData.portTags.get("clevis_lug")?.normal ?? [0, 0, -1],
            anchor: [lugSpan - 22, webWidth / 2, flangeThickness],
            boundToCae: scadData.portTags.has("clevis_lug"),
            caeTarget: `FEA::BracketStress::*CLOAD(clevis_lug, 3, ${appliedLoadN.toFixed(0)} N)`,
          },
        ],
        csgTree: scadData.csgTree,
      },
      {
        kind: "fea-3d",
        materialName: feaMat?.name ?? "AL7075_T6",
        youngsModulusGpa: Number((youngsModulusMpa / 1000).toFixed(1)),
        poissonsRatio,
        densityKgM3: density,
        meshSourceFile,
        numNodes: tetMesh.numNodes,
        numElements: tetMesh.numElements,
        minJacobian: Number(meshQuality.minJacobian.toFixed(2)),
        appliedLoadN,
        maxVonMisesMpa: effectiveVonMises,
        allowableVonMisesMpa: maxVonMises,
        maxDeflectionMm: effectiveDeflection,
        allowableDeflectionMm: maxDeflection,
        undeformedTriangles,
        deformedTriangles,
        fixedPinCoords,
        loadArrowCoords,
        bboxMin: [0, 0, 0],
        bboxMax: [gaugeLengthM * scaleToMm, depthM * scaleToMm, heightM * scaleToMm],
      },
    ];
    paneVisuals[sysmlIdx] = sysmlVis;
    paneVisuals[moIdx] = moVis;
    paneVisuals[cadIdx] = cadVis;
    paneVisuals[feaIdx] = feaVis;
    return { meshSourceSummary, paneVisuals };
  }

  function evaluateEvBatteryColdplatePipeline(ctx: CoordinatorPipelineContext): CoordinatorPipelineResult {
    const {
      codes,
      roleIndex,
      editedPaneIndex,
      paneDiagnostics,
      coordinator,
      caeOracle,
      variableLinks,
      conflicts,
      portBindings,
      evaluatedEquations,
      getSysmlAttrOrBound,
    } = ctx;
    const sysmlIdx = roleIndex.sysml >= 0 ? roleIndex.sysml : 0;
    const moIdx = roleIndex.modelica >= 0 ? roleIndex.modelica : 1;
    const cadIdx = roleIndex.scad >= 0 ? roleIndex.scad : 2;
    const cfdIdx = roleIndex.cfd >= 0 ? roleIndex.cfd : 3;
    let meshSourceSummary = "";
    const paneVisuals = new Array<PaneVisualData>(4) as [
      PaneVisualData,
      PaneVisualData,
      PaneVisualData,
      PaneVisualData,
    ];
    // 1. Read SysML v2 thermal safety contract from WASM GLR CST (SysML2::BatteryThermal::REQ_THERMAL_02)
    const maxCellTempK = getSysmlAttrOrBound("max_cell_temp_K", "max_surface_temp", 318.15);
    const maxPressureDropKpa = getSysmlAttrOrBound("max_pressure_drop_kPa", "pressure_drop", 18.0);
    const minFlowRateLpm = getSysmlAttrOrBound("min_flow_rate_lpm", "coolant_flow", 8.0);

    // 2. Evaluate Modelica electro-thermal `equation` dynamically via `evaluateCfdExpression`
    const moEq = evaluateModelicaOutputEquation(providers, codes[moIdx]!, "heat_rejection_W", 1433.6);
    const packCurrent = Math.max(10, moEq.paramMap.get("pack_current") ?? 320.0);
    const internalRes = Math.max(0.001, moEq.paramMap.get("internal_res") ?? 0.014);
    const coolantFlowLpm = Math.max(
      1.0,
      moEq.paramMap.get("coolant_flow_lpm") ?? extractModelicaBindingNumber(codes[moIdx]!, "coolant_flow_lpm", 14.0),
    );
    const heatRejectionW = Number(moEq.value.toFixed(1));

    evaluatedEquations.push({
      paneIndex: moIdx,
      fileName: "BatteryPackLoop.mo",
      language: "Modelica",
      lhs: "heat_rejection_W",
      rhsExpression: moEq.rhsExpression,
      evaluatedValue: heatRejectionW,
      unit: "W",
    });

    codes[moIdx] = updateModelicaBindingViaCst(codes[moIdx]!, "heat_rejection_W", heatRejectionW.toFixed(1));

    // 3. Evaluate OpenSCAD cold-plate micro-channel geometry live via `evaluateScad`
    const scadData = buildScadVisualTrianglesAndTree(providers, codes[cadIdx]!);
    const scadVars = scadData.evalRes.variables;
    const channelWidthMm = Math.max(
      0.5,
      typeof scadVars.channel_width_mm === "number" ? scadVars.channel_width_mm : 4.2,
    );
    const channelDepthMm = Math.max(
      0.5,
      typeof scadVars.channel_depth_mm === "number" ? scadVars.channel_depth_mm : 3.0,
    );
    const channelCount = Math.max(
      2,
      Math.round(typeof scadVars.channel_count === "number" ? scadVars.channel_count : 12),
    );
    const rawHydraulicDia =
      typeof scadVars.hydraulic_dia_mm === "number" && Number.isFinite(scadVars.hydraulic_dia_mm)
        ? scadVars.hydraulic_dia_mm
        : (2 * channelWidthMm * channelDepthMm) / (channelWidthMm + channelDepthMm);
    const hydraulicDiaMm = Number(rawHydraulicDia.toFixed(2));
    const rawFlowAreaMm2 =
      typeof scadVars.flow_area_mm2 === "number" && Number.isFinite(scadVars.flow_area_mm2)
        ? scadVars.flow_area_mm2
        : channelCount * channelWidthMm * channelDepthMm;
    const flowAreaMm2 = Number(rawFlowAreaMm2.toFixed(1));

    const dhSpan = findScadVarValueSpan(codes[cadIdx]!, "hydraulic_dia_mm");
    evaluatedEquations.push({
      paneIndex: cadIdx,
      fileName: "ColdPlateChannels.scad",
      language: "OpenSCAD",
      lhs: "hydraulic_dia_mm",
      rhsExpression: dhSpan
        ? codes[cadIdx]!.slice(dhSpan.start, dhSpan.end).trim()
        : "(2 * channel_width_mm * channel_depth_mm) / (channel_width_mm + channel_depth_mm)",
      evaluatedValue: hydraulicDiaMm,
      unit: "mm",
    });

    // 4. Parse OpenFOAM `.cfd` dictionary via `@modelscript/cfd`'s `OpenFoamDialect`
    const cfdDoc = new OpenFoamDialect().parse(codes[cfdIdx]!);
    const geomSource =
      String(getOpenFoamDirectiveValue(cfdDoc.directives, "geometry.ColdPlateChannels.scad.source") ?? "").replace(
        /^"|"$/g,
        "",
      ) || "CAD::ColdPlateChannels::SerpentineColdPlate";
    meshSourceSummary = `geometry { ColdPlateChannels.scad (${geomSource}) } -> LbmVoxelizer (20×10×8 D3Q19)`;

    // Verify every OpenFOAM boundaryField patch against OpenSCAD `tag_port(...)` declarations
    const markerKeys: string[] =
      cfdDoc.markers instanceof Map
        ? (Array.from(cfdDoc.markers.keys()) as string[])
        : Array.isArray(cfdDoc.markers)
          ? (cfdDoc.markers as string[])
          : [];
    const expectedPatches: string[] =
      markerKeys.length > 0 ? markerKeys : ["coolant_inlet", "fluid_core", "coolant_outlet"];
    for (const patchName of expectedPatches) {
      const cadPort = scadData.portTags.get(patchName);
      const patchType = String(
        getOpenFoamDirectiveValue(cfdDoc.directives, `boundaryField.${patchName}.type`) ?? "patch",
      );
      const caePos = findOpenFoamPatchLineCol(codes[cfdIdx]!, patchName);
      const isBound = cadPort !== undefined;
      portBindings.push({
        portName: patchName,
        cadPortType: cadPort?.portType ?? "MISSING_TAG_PORT",
        cadNormal: cadPort?.normal ?? [0, 0, 0],
        cadFileName: "ColdPlateChannels.scad",
        cadLine: cadPort?.line ?? 1,
        caeFileName: "CoolantManifold.cfd",
        caeTargetKind: "OpenFOAM boundaryField",
        caePatchSpec: `boundaryField.${patchName} { type ${patchType}; }`,
        caeLine: caePos.startLine,
        isBound,
      });
      if (!isBound) {
        const msg = `[MSC-PORT-UNBOUND] OpenFOAM boundaryField patch '${patchName}' (type ${patchType}) has no matching tag_port("${patchName}", ...) in ColdPlateChannels.scad (${geomSource}).`;
        paneDiagnostics[cadIdx]!.push({
          startLine: 1,
          startCol: 1,
          endLine: 1,
          endCol: 32,
          severity: "error",
          code: "MSC-PORT-UNBOUND",
          message: msg,
        });
        paneDiagnostics[cfdIdx]!.push({
          ...caePos,
          severity: "error",
          code: "MSC-PORT-UNBOUND",
          message: msg,
        });
        conflicts.push({
          literals: [],
          explanation: msg,
          culpritEntities: [
            `CAD::ColdPlateChannels::port.${patchName}`,
            `CFD::CoolantManifold::boundaryField.${patchName}`,
          ],
          theoryName: "SpatialPhysicsOracle",
        });
      }
    }

    // 5. Live 3D Lattice-Boltzmann D3Q19 Voxelization & Fluid Solve (LbmVoxelizer + WebGPULbmRunner)
    // Read fluid properties from OpenFOAM `thermoFluidProperties` & `boundaryField` dictionaries
    const fluidRho = Number(
      getOpenFoamDirectiveValue(cfdDoc.directives, "thermoFluidProperties.density_kg_m3") ?? 1060.0,
    );
    const fluidCp = Number(
      getOpenFoamDirectiveValue(cfdDoc.directives, "thermoFluidProperties.specificHeat_J_kgK") ?? 3450.0,
    );
    const fluidMu = Number(
      getOpenFoamDirectiveValue(cfdDoc.directives, "thermoFluidProperties.viscosity_Pa_s") ?? 0.00297,
    );
    const fluidK = Number(
      getOpenFoamDirectiveValue(cfdDoc.directives, "thermoFluidProperties.conductivity_W_mK") ?? 0.42,
    );
    const inletTempK = Number(
      getOpenFoamDirectiveValue(cfdDoc.directives, "boundaryField.coolant_inlet.inletTemp_K") ?? 298.15,
    );

    const channelAreaM2 = Math.max(1e-6, flowAreaMm2 * 1e-6);
    const meanInletVelMs = Math.min(4.8, Math.max(0.2, coolantFlowLpm / 60000 / channelAreaM2));
    const lbmConfig = {
      nx: 20,
      ny: 10,
      nz: 8,
      dx: (hydraulicDiaMm * 1e-3) / 4,
      dt: 5e-5,
      tau: 0.65,
      density: fluidRho,
      inletVelocity: [meanInletVelMs, 0.0, 0.0] as [number, number, number],
    };
    const finBlockage = Math.min(0.68, Math.max(0.18, 2.0 / (channelWidthMm + 2.0)));
    const cellGrid = LbmVoxelizer.voxelize(lbmConfig, {
      boxes: [
        {
          min: [0.3, 0.5 - finBlockage * 0.4, 0.2],
          max: [0.7, 0.5 + finBlockage * 0.4, 0.8],
        },
      ],
    });
    const lbmRunner = new WebGPULbmRunner(lbmConfig, cellGrid);
    const lbmRes = lbmRunner.step(8);

    // First-principles Darcy-Weisbach & Dittus-Boelter convective energy balance coupled with LBM constriction field
    const passLengthM = Math.max(0.08, (scadData.bboxMax[0] - scadData.bboxMin[0] - 28.0) * 1e-3);
    const dhM = hydraulicDiaMm * 1e-3;
    const passAreaM2 = Math.max(1e-7, channelAreaM2 / channelCount);
    const nParallelBanks = 4.0;
    const passesPerBank = channelCount / nParallelBanks;
    const uSerpMs = coolantFlowLpm / 60000 / (nParallelBanks * passAreaM2);
    const reynolds = Math.max(50.0, (fluidRho * uSerpMs * dhM) / fluidMu);
    const prandtl = (fluidMu * fluidCp) / fluidK;
    const darcyF = 0.3164 / Math.pow(reynolds, 0.25) + 64.0 / reynolds;
    const lbmConstrictionRatio = Math.max(1.0, lbmRes.maxVelocity / Math.max(0.1, meanInletVelMs));
    const dynamicHeadPa = 0.5 * fluidRho * uSerpMs * uSerpMs;
    const darcyDropPa =
      passesPerBank * ((darcyF * (passLengthM / dhM) + 0.12 * lbmConstrictionRatio) / nParallelBanks) * dynamicHeadPa;
    const computedPressureDropKpa = Number(((lbmRes.pressureDropPa * 0.4 + darcyDropPa) * 1e-3).toFixed(1));

    const massFlowKgS = fluidRho * (coolantFlowLpm / 60000);
    const nusselt = 0.023 * Math.pow(reynolds, 0.8) * Math.pow(prandtl, 0.3);
    const hConv = (nusselt * fluidK) / dhM;
    const wettedAreaM2 = channelCount * (channelWidthMm + 2.0 * channelDepthMm) * 1e-3 * passLengthM;
    const deltaTBulkK = heatRejectionW / (massFlowKgS * fluidCp);
    const deltaTConvK = heatRejectionW / (hConv * wettedAreaM2);
    const computedMaxTempK = Number((inletTempK + deltaTBulkK + deltaTConvK).toFixed(1));

    if (editedPaneIndex !== cfdIdx) {
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "volumetricFlowRate", coolantFlowLpm.toFixed(1));
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "qWall", heatRejectionW.toFixed(1));
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "Dh", hydraulicDiaMm.toFixed(2));
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "inletFlowRate", coolantFlowLpm.toFixed(1));
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "wallHeatLoad", heatRejectionW.toFixed(1));
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "hydraulicDiameter", hydraulicDiaMm.toFixed(2));
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "pressureDrop_kPa", computedPressureDropKpa.toFixed(1));
      codes[cfdIdx] = updateOpenFoamScalar(codes[cfdIdx]!, "maxSurfaceTemp_K", computedMaxTempK.toFixed(1));
    }

    const effectiveDeltaPKpa = extractOpenFoamScalar(codes[cfdIdx]!, "pressureDrop_kPa", computedPressureDropKpa);
    const effectiveMaxTempK = extractOpenFoamScalar(codes[cfdIdx]!, "maxSurfaceTemp_K", computedMaxTempK);

    // Sync SysML v2 part def ColdPlateManifold attributes
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "max_surface_temp", effectiveMaxTempK.toFixed(1));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "pressure_drop", effectiveDeltaPKpa.toFixed(1));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "coolant_flow", coolantFlowLpm.toFixed(1));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "heat_load", heatRejectionW.toFixed(1));

    // 6. Assert into Oracles
    caeOracle.assertCfdAerodynamicContract({
      partName: "BatteryThermal::ColdPlateManifold",
      contractId: "BatteryThermal::REQ_THERMAL_02",
      pressureDropPa: effectiveDeltaPKpa * 1000,
      maxPressureDropPa: maxPressureDropKpa * 1000,
      sysmlRequirementId: "BatteryThermal::REQ_THERMAL_02",
    });
    caeOracle.assertContract({
      contractId: "BatteryThermal::REQ_THERMAL_02_Temp",
      metricName: "ColdPlateManifold.max_surface_temp",
      actualValue: effectiveMaxTempK,
      threshold: maxCellTempK,
      operator: "<=",
      unit: "K",
      partName: "BatteryThermal::ColdPlateManifold",
      sysmlRequirementId: "BatteryThermal::REQ_THERMAL_02",
    });

    coordinator.enqueueEvent({
      kind: "equality",
      varA: "Modelica::Powertrain.BatteryPackLoop.heat_rejection_W",
      varB: "CFD::CoolantManifold::thermoFluidProperties.wallHeatLoad",
      domain: "real",
      bounds: [heatRejectionW, heatRejectionW],
      explanation: "Joule heating I²R coupled via annotation(twin) & boundaryField.fluid_core.qWall",
      sourceOracle: "DynamicSimulationOracle",
    });
    coordinator.enqueueEvent({
      kind: "equality",
      varA: "CAD::ColdPlateChannels::hydraulic_dia_mm",
      varB: "CFD::CoolantManifold::thermoFluidProperties.hydraulicDiameter",
      domain: "real",
      bounds: [hydraulicDiaMm, hydraulicDiaMm],
      explanation: 'evaluateScad() hydraulic_dia_mm on tag_port("fluid_core") <-> OpenFOAM boundaryField',
      sourceOracle: "SpatialPhysicsOracle",
    });

    const tempSat = effectiveMaxTempK <= maxCellTempK;
    const dpSat = effectiveDeltaPKpa <= maxPressureDropKpa;
    const flowSat = coolantFlowLpm >= minFlowRateLpm;

    variableLinks.push(
      {
        symbol: "ColdPlateManifold.heat_load",
        canonicalFqn: "SysML2::BatteryThermal::ColdPlateManifold.heat_load",
        bindingMechanism: 'annotation(twin = "...") + boundaryField.fluid_core.qWall',
        label: "Joule Heat Load (I²R)",
        valueFormatted: `${heatRejectionW.toFixed(1)} W`,
        boundsFormatted: `I = ${packCurrent.toFixed(0)} A`,
        unit: "W",
        sourceDomain: "Modelica",
        targetDomains: ["OpenFOAM CFD", "SysML v2"],
        domainBindings: [
          {
            domainLabel: "Modelica",
            fqn: "Powertrain.BatteryPackLoop.heat_rejection_W",
            bindingSyntax: 'annotation(twin = "SysML2::...::ColdPlateManifold.heat_load")',
            valueText: `${heatRejectionW.toFixed(1)} W`,
          },
          {
            domainLabel: "OpenFOAM",
            fqn: "CFD::CoolantManifold::boundaryField.fluid_core.qWall",
            bindingSyntax: "@twin <- Powertrain.BatteryPackLoop.heat_rejection_W",
            valueText: `${heatRejectionW.toFixed(1)} W`,
          },
        ],
        oracleName: "DynamicSimulationOracle",
        status: "SAT",
        marginText: `Coupled to patch fluid_core`,
      },
      {
        symbol: "ColdPlateChannels.hydraulic_dia_mm",
        canonicalFqn: "CAD::ColdPlateChannels::hydraulic_dia_mm",
        bindingMechanism: 'tag_port("fluid_core") <-> geometry { ColdPlateChannels.scad }',
        label: "Channel Hydraulic Dia D_h",
        valueFormatted: `${hydraulicDiaMm.toFixed(2)} mm`,
        boundsFormatted: `${channelWidthMm}×${channelDepthMm} mm (${channelCount} ch)`,
        unit: "mm",
        sourceDomain: "OpenSCAD CAD",
        targetDomains: ["OpenFOAM CFD"],
        domainBindings: [
          {
            domainLabel: "OpenSCAD",
            fqn: "CAD::ColdPlateChannels::hydraulic_dia_mm",
            bindingSyntax: 'evaluateScad() + tag_port("fluid_core")',
            valueText: `${hydraulicDiaMm.toFixed(2)} mm (A=${flowAreaMm2.toFixed(0)} mm²)`,
          },
          {
            domainLabel: "OpenFOAM",
            fqn: "CFD::CoolantManifold::boundaryField.fluid_core.Dh",
            bindingSyntax: "geometry.ColdPlateChannels.scad + LbmVoxelizer",
            valueText: `${cellGrid.length} D3Q19 cells (${expectedPatches.length} patches)`,
          },
        ],
        oracleName: "SpatialPhysicsOracle",
        status: portBindings.every((p) => p.isBound) ? "SAT" : "UNSAT",
        marginText: `3 tag_port patches bound to OpenFOAM`,
      },
      {
        symbol: "ColdPlateManifold.max_surface_temp",
        canonicalFqn: "SysML2::BatteryThermal::ColdPlateManifold.max_surface_temp",
        bindingMechanism: "solverSummary.maxSurfaceTemp_K -> subject manifold.max_surface_temp",
        label: "Peak Cell Surface Temp",
        valueFormatted: `${effectiveMaxTempK.toFixed(1)} K`,
        boundsFormatted: `<= ${maxCellTempK.toFixed(2)} K`,
        unit: "K",
        sourceDomain: "OpenFOAM CFD",
        targetDomains: ["SysML v2", "Modelica"],
        domainBindings: [
          {
            domainLabel: "OpenFOAM",
            fqn: "CFD::CoolantManifold::solverSummary.maxSurfaceTemp_K",
            bindingSyntax: "@twin -> ColdPlateManifold.max_surface_temp",
            valueText: `${effectiveMaxTempK.toFixed(1)} K`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "BatteryThermal::REQ_THERMAL_02::manifold.max_surface_temp",
            bindingSyntax: "manifold.max_surface_temp <= max_cell_temp_K",
            valueText: `<= ${maxCellTempK.toFixed(2)} K`,
          },
        ],
        oracleName: "CaeContractOracle",
        status: tempSat ? "SAT" : "UNSAT",
        marginText: tempSat
          ? `${(maxCellTempK - effectiveMaxTempK).toFixed(1)} K below runaway limit`
          : `+${(effectiveMaxTempK - maxCellTempK).toFixed(1)} K thermal exceedance`,
      },
      {
        symbol: "ColdPlateManifold.pressure_drop",
        canonicalFqn: "SysML2::BatteryThermal::ColdPlateManifold.pressure_drop",
        bindingMechanism: "solverSummary.pressureDrop_kPa -> subject manifold.pressure_drop",
        label: "Manifold Pressure Drop ΔP",
        valueFormatted: `${effectiveDeltaPKpa.toFixed(1)} kPa`,
        boundsFormatted: `<= ${maxPressureDropKpa.toFixed(1)} kPa`,
        unit: "kPa",
        sourceDomain: "OpenFOAM CFD",
        targetDomains: ["SysML v2", "OpenSCAD CAD"],
        domainBindings: [
          {
            domainLabel: "Modelica",
            fqn: "Powertrain.BatteryPackLoop.coolant_flow_lpm",
            bindingSyntax: 'annotation(twin = "SysML2::...::ColdPlateManifold.coolant_flow")',
            valueText: `${coolantFlowLpm.toFixed(1)} L/min`,
          },
          {
            domainLabel: "OpenFOAM",
            fqn: "CFD::CoolantManifold::solverSummary.pressureDrop_kPa",
            bindingSyntax: "WebGPULbmRunner.step(8).pressureDropPa",
            valueText: `${effectiveDeltaPKpa.toFixed(1)} kPa (u_max=${lbmRes.maxVelocity.toFixed(2)} m/s)`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "BatteryThermal::REQ_THERMAL_02::manifold.pressure_drop",
            bindingSyntax: "manifold.pressure_drop <= max_pressure_drop_kPa",
            valueText: `<= ${maxPressureDropKpa.toFixed(1)} kPa`,
          },
        ],
        oracleName: "CaeContractOracle",
        status: dpSat && flowSat ? "SAT" : "UNSAT",
        marginText: !flowSat
          ? `Flow ${coolantFlowLpm.toFixed(1)} < ${minFlowRateLpm.toFixed(1)} L/min`
          : dpSat
            ? `${(((maxPressureDropKpa - effectiveDeltaPKpa) / maxPressureDropKpa) * 100).toFixed(1)}% pump margin`
            : `+${(effectiveDeltaPKpa - maxPressureDropKpa).toFixed(1)} kPa over pump head`,
      },
    );

    if (!tempSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "manifold.max_surface_temp");
      const posCfd = findOpenFoamKeyLineCol(codes[cfdIdx]!, "maxSurfaceTemp_K");
      const msg = `[MSC-THEORY-CONFLICT] CaeContractOracle: 'CFD::CoolantManifold::solverSummary.maxSurfaceTemp_K' (${effectiveMaxTempK.toFixed(1)} K) exceeds 'SysML2::BatteryThermal::REQ_THERMAL_02.max_cell_temp_K' (${maxCellTempK.toFixed(2)} K) under ${heatRejectionW.toFixed(0)} W heat load.`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-CFD-TEMP", message: msg });
      paneDiagnostics[cfdIdx]!.push({ ...posCfd, severity: "error", code: "MSC-CFD-TEMP", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "CFD::CoolantManifold::solverSummary.maxSurfaceTemp_K",
          "Modelica::Powertrain.BatteryPackLoop.pack_current",
          "SysML2::BatteryThermal::REQ_THERMAL_02.max_cell_temp_K",
        ],
        theoryName: "CaeContractOracle",
      });
    }

    if (!dpSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "manifold.pressure_drop");
      const posCad = findScadVarLineCol(codes[cadIdx]!, "channel_width_mm");
      const posCfd = findOpenFoamKeyLineCol(codes[cfdIdx]!, "pressureDrop_kPa");
      const msg = `[MSC-THEORY-CONFLICT] CaeContractOracle: 'CFD::CoolantManifold::solverSummary.pressureDrop_kPa' (${effectiveDeltaPKpa.toFixed(1)} kPa) violates 'SysML2::BatteryThermal::REQ_THERMAL_02.max_pressure_drop_kPa' (<= ${maxPressureDropKpa.toFixed(1)} kPa) for D_h = ${hydraulicDiaMm.toFixed(2)} mm.`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-CFD-DP", message: msg });
      paneDiagnostics[cadIdx]!.push({
        ...posCad,
        severity: "warning",
        code: "MSC-CFD-DP",
        message: `Narrow channel width (${channelWidthMm} mm) in CAD::ColdPlateChannels restricts D_h to ${hydraulicDiaMm.toFixed(2)} mm.`,
      });
      paneDiagnostics[cfdIdx]!.push({ ...posCfd, severity: "error", code: "MSC-CFD-DP", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "CFD::CoolantManifold::solverSummary.pressureDrop_kPa",
          "CAD::ColdPlateChannels::channel_width_mm",
          "SysML2::BatteryThermal::REQ_THERMAL_02.max_pressure_drop_kPa",
        ],
        theoryName: "CaeContractOracle",
      });
    }

    if (!flowSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "manifold.coolant_flow");
      const posMo = findModelicaComponentLineCol(codes[moIdx]!, "coolant_flow_lpm");
      const msg = `[MSC-THEORY-CONFLICT] ConstraintTheoryOracle: 'Modelica::Powertrain.BatteryPackLoop.coolant_flow_lpm' (${coolantFlowLpm.toFixed(1)} L/min) is below 'SysML2::BatteryThermal::REQ_THERMAL_02.min_flow_rate_lpm' (>= ${minFlowRateLpm.toFixed(1)} L/min).`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-FLOW-MIN", message: msg });
      paneDiagnostics[moIdx]!.push({ ...posMo, severity: "error", code: "MSC-FLOW-MIN", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "Modelica::Powertrain.BatteryPackLoop.coolant_flow_lpm",
          "SysML2::BatteryThermal::REQ_THERMAL_02.min_flow_rate_lpm",
        ],
        theoryName: "ConstraintTheoryOracle",
      });
    }

    // Extract mid-plane z=4 slice of the D3Q19 LBM grid for 3D/2D field visualization
    const sliceZ = Math.floor(lbmConfig.nz / 2);
    const lbmCells: Cfd3DVisualData["cells"] = [];
    for (let iy = 0; iy < lbmConfig.ny; iy++) {
      for (let ix = 0; ix < lbmConfig.nx; ix++) {
        const idx = ix + lbmConfig.nx * (iy + lbmConfig.ny * sliceZ);
        const isSolid = cellGrid[idx] === 1;
        const ux = lbmRunner.vx[idx] ?? 0;
        const uy = lbmRunner.vy[idx] ?? 0;
        const uz = lbmRunner.vz[idx] ?? 0;
        const uMag = Math.sqrt(ux * ux + uy * uy + uz * uz);
        const xFrac = ix / Math.max(1, lbmConfig.nx - 1);
        const pKpa = Number((effectiveDeltaPKpa * (1 - xFrac)).toFixed(2));
        const tK = Number((298.15 + (effectiveMaxTempK - 298.15) * (isSolid ? 1.0 : 0.25 + 0.75 * xFrac)).toFixed(1));
        lbmCells.push({
          ix,
          iy,
          isSolid,
          velocityMagMs: Number(uMag.toFixed(2)),
          pressureKpa: pKpa,
          tempK: tK,
        });
      }
    }

    const totalPlateWidthMm = channelCount * (channelWidthMm + 2.0);
    const [sysmlVis, moVis, cadVis, cfdVis]: [PaneVisualData, PaneVisualData, PaneVisualData, PaneVisualData] = [
      {
        kind: "sysml-bdd",
        packageName: "BatteryThermal",
        partName: "ColdPlateManifold",
        partAttributes: [
          {
            name: "max_surface_temp",
            value: effectiveMaxTempK.toFixed(1),
            unit: "K",
            sourceHint: "<- CFD::CoolantManifold",
          },
          {
            name: "pressure_drop",
            value: effectiveDeltaPKpa.toFixed(1),
            unit: "kPa",
            sourceHint: "<- CFD::CoolantManifold",
          },
          {
            name: "coolant_flow",
            value: coolantFlowLpm.toFixed(1),
            unit: "L/min",
            sourceHint: "<- Modelica::Powertrain",
          },
          { name: "heat_load", value: heatRejectionW.toFixed(1), unit: "W", sourceHint: "<- Modelica::Powertrain" },
        ],
        requirementId: "REQ_THERMAL_02",
        subjectName: "manifold",
        subjectType: "ColdPlateManifold",
        constraints: [
          {
            expression: "manifold.max_surface_temp <= max_cell_temp_K",
            actualText: `${effectiveMaxTempK.toFixed(1)} K`,
            limitText: `<= ${maxCellTempK.toFixed(2)} K`,
            isSat: tempSat,
          },
          {
            expression: "manifold.pressure_drop <= max_pressure_drop_kPa",
            actualText: `${effectiveDeltaPKpa.toFixed(1)} kPa`,
            limitText: `<= ${maxPressureDropKpa.toFixed(1)} kPa`,
            isSat: dpSat,
          },
          {
            expression: "manifold.coolant_flow >= min_flow_rate_lpm",
            actualText: `${coolantFlowLpm.toFixed(1)} L/min`,
            limitText: `>= ${minFlowRateLpm.toFixed(1)} L/min`,
            isSat: flowSat,
          },
        ],
      },
      {
        kind: "modelica-dae",
        withinPkg: "Powertrain",
        modelName: "BatteryPackLoop",
        parameters: [
          { name: "pack_current", value: packCurrent.toFixed(1), unit: "A" },
          { name: "internal_res", value: internalRes.toFixed(3), unit: "Ω" },
          {
            name: "coolant_flow_lpm",
            value: coolantFlowLpm.toFixed(1),
            unit: "L/min",
            twinFqn: "SysML2::BatteryThermal::ColdPlateManifold.coolant_flow",
          },
        ],
        equations: [
          {
            lhs: "heat_rejection_W",
            rhs: moEq.rhsExpression,
            resultText: `${heatRejectionW.toFixed(1)} W`,
            twinFqn: "SysML2::BatteryThermal::ColdPlateManifold.heat_load",
          },
        ],
      },
      {
        kind: "scad-3d",
        moduleName: "SerpentineColdPlate",
        triangles: scadData.triangles,
        bboxMin: scadData.bboxMin,
        bboxMax: scadData.bboxMax,
        volumeMm3: scadData.volumeMm3,
        surfaceAreaMm2: scadData.surfaceAreaMm2,
        hydraulicDiaMm,
        flowAreaMm2,
        ports: [
          {
            portName: "coolant_inlet",
            portType: scadData.portTags.get("coolant_inlet")?.portType ?? "inlet",
            normal: scadData.portTags.get("coolant_inlet")?.normal ?? [1, 0, 0],
            anchor: [7, totalPlateWidthMm / 2, channelDepthMm],
            boundToCae: scadData.portTags.has("coolant_inlet"),
            caeTarget: `CFD::boundaryField.coolant_inlet (${coolantFlowLpm.toFixed(1)} L/min)`,
          },
          {
            portName: "fluid_core",
            portType: scadData.portTags.get("fluid_core")?.portType ?? "conjugate_wall",
            normal: scadData.portTags.get("fluid_core")?.normal ?? [0, 0, 1],
            anchor: [74, totalPlateWidthMm / 2, channelDepthMm],
            boundToCae: scadData.portTags.has("fluid_core"),
            caeTarget: `CFD::boundaryField.fluid_core (q=${heatRejectionW.toFixed(0)} W, Dh=${hydraulicDiaMm.toFixed(2)} mm)`,
          },
          {
            portName: "coolant_outlet",
            portType: scadData.portTags.get("coolant_outlet")?.portType ?? "outlet",
            normal: scadData.portTags.get("coolant_outlet")?.normal ?? [-1, 0, 0],
            anchor: [141, totalPlateWidthMm / 2, channelDepthMm],
            boundToCae: scadData.portTags.has("coolant_outlet"),
            caeTarget: "CFD::boundaryField.coolant_outlet (p = 0 kPa)",
          },
        ],
        csgTree: scadData.csgTree,
      },
      {
        kind: "cfd-3d",
        solverName: (cfdDoc as { solver?: string }).solver || "chtMultiRegionSimpleFoam",
        meshSourceFile: `ColdPlateChannels.scad (${geomSource})`,
        nx: lbmConfig.nx,
        ny: lbmConfig.ny,
        nz: lbmConfig.nz,
        channelCount,
        hydraulicDiaMm,
        inletFlowLpm: coolantFlowLpm,
        wallHeatLoadW: heatRejectionW,
        maxVelocityMs: Number(lbmRes.maxVelocity.toFixed(2)),
        pressureDropKpa: effectiveDeltaPKpa,
        maxAllowableDpKpa: maxPressureDropKpa,
        maxSurfaceTempK: effectiveMaxTempK,
        maxAllowableTempK: maxCellTempK,
        cells: lbmCells,
        patches: portBindings.map((pb) => ({
          name: pb.portName,
          openFoamType: pb.caePatchSpec.replace(/^boundaryField\.\S+\s*\{\s*type\s+|\s*;\s*\}$/g, ""),
          cadPortType: pb.cadPortType,
          isBound: pb.isBound,
          summary:
            pb.portName === "coolant_inlet"
              ? `Q = ${coolantFlowLpm.toFixed(1)} L/min (u_in = ${meanInletVelMs.toFixed(2)} m/s)`
              : pb.portName === "fluid_core"
                ? `Q_wall = ${heatRejectionW.toFixed(1)} W, D_h = ${hydraulicDiaMm.toFixed(2)} mm`
                : "Fixed gauge pressure p = 0 Pa",
        })),
      },
    ];
    paneVisuals[sysmlIdx] = sysmlVis;
    paneVisuals[moIdx] = moVis;
    paneVisuals[cadIdx] = cadVis;
    paneVisuals[cfdIdx] = cfdVis;
    return { meshSourceSummary, paneVisuals };
  }

  function evaluateRoboticsGdtPipeline(ctx: CoordinatorPipelineContext): CoordinatorPipelineResult {
    const {
      codes,
      roleIndex,
      editedPaneIndex,
      paneDiagnostics,
      coordinator,
      toleranceOracle,
      variableLinks,
      conflicts,
      evaluatedEquations,
      getSysmlAttrOrBound,
    } = ctx;
    const sysmlIdx = roleIndex.sysml >= 0 ? roleIndex.sysml : 0;
    const urdfIdx = roleIndex.urdf >= 0 ? roleIndex.urdf : 1;
    const moIdx = roleIndex.modelica >= 0 ? roleIndex.modelica : 2;
    const stepIdx = roleIndex.step >= 0 ? roleIndex.step : 3;
    let meshSourceSummary = "";
    const paneVisuals = new Array<PaneVisualData>(4) as [
      PaneVisualData,
      PaneVisualData,
      PaneVisualData,
      PaneVisualData,
    ];
    // SCENARIO 3: Precision Robotics & STEP AP242 GD&T
    // 1. Read SysML v2 contract from WASM GLR CST (SysML2::SurgicalRobotics::REQ_HARMONIC_03)
    const minClearanceMm = getSysmlAttrOrBound("min_clearance_mm", "min_radial_clearance", 0.015);
    const maxClearanceMm = getSysmlAttrOrBound("max_clearance_mm", "max_radial_clearance", 0.08);
    const maxSysmlTorqueNm = getSysmlAttrOrBound("max_joint_torque_Nm", "peak_torque", 140.0);

    // 2. Parse URDF (URDF::SurgicalArm) via `@modelscript/urdf` `parseUrdf`
    const urdfModel = parseUrdf(codes[urdfIdx]!);
    const upperArmLink = urdfModel.links.get("upper_arm");
    const shoulderJoint = urdfModel.joints.get("shoulder_pitch") ?? Array.from(urdfModel.joints.values())[0];
    const urdfMass = upperArmLink?.inertial?.mass ?? 2.8;
    const urdfEffort = shoulderJoint?.limits?.effort ?? 140.0;

    if (editedPaneIndex === urdfIdx) {
      codes[moIdx] = updateModelicaBindingViaCst(codes[moIdx]!, "arm_mass", urdfMass.toFixed(1));
    }
    const moArmMass = parseModelicaCst(codes[moIdx]!).components.find((c) => c.name === "arm_mass")?.bindingExpr
      ? Number.parseFloat(
          parseModelicaCst(codes[moIdx]!).components.find((c) => c.name === "arm_mass")!.bindingExpr!,
        ) || urdfMass
      : urdfMass;
    if (editedPaneIndex === moIdx && Math.abs(moArmMass - urdfMass) > 1e-4) {
      codes[urdfIdx] = updateUrdfLinkMass(codes[urdfIdx]!, "upper_arm", moArmMass.toFixed(1));
    }

    // 3. Evaluate Modelica RNEA `equation` dynamically via `evaluateCfdExpression`
    const moEq = evaluateModelicaOutputEquation(providers, codes[moIdx]!, "peak_torque_Nm", 98.5, {
      arm_mass: moArmMass,
    });
    const payloadMass = Math.max(0.1, moEq.paramMap.get("payload_mass") ?? 4.2);
    const linkReach = Math.max(0.1, moEq.paramMap.get("link_reach") ?? 0.65);
    const peakAccel = Math.max(0.5, moEq.paramMap.get("peak_accel") ?? 8.5);
    const peakTorqueNm = Number(moEq.value.toFixed(1));

    evaluatedEquations.push({
      paneIndex: moIdx,
      fileName: "HarmonicDriveDynamics.mo",
      language: "Modelica",
      lhs: "peak_torque_Nm",
      rhsExpression: moEq.rhsExpression,
      evaluatedValue: peakTorqueNm,
      unit: "N·m",
    });

    codes[moIdx] = updateModelicaBindingViaCst(codes[moIdx]!, "peak_torque_Nm", peakTorqueNm.toFixed(1));

    // 4. Parse STEP AP242 GD&T (STEP::BearingFit_AP242) via `@modelscript/step` `scanStepEntities` + `ToleranceStackVerifier`
    const stepScan = scanStepEntities(codes[stepIdx]!);
    const getStepEntityFirstNum = (entityId: string, fallback: number): number => {
      const ent = stepScan.find((e) => e.id === entityId);
      if (!ent) return fallback;
      const firstArg = ent.args.split(",")[0]?.trim() ?? "";
      const n = Number.parseFloat(firstArg);
      return Number.isFinite(n) ? n : fallback;
    };
    const boreNominalMm = getStepEntityFirstNum("#11", 40.048);
    const boreTolMm = Math.max(0.001, getStepEntityFirstNum("#12", 0.015));
    const shaftNominalMm = getStepEntityFirstNum("#21", 40.0);
    const shaftTolMm = Math.max(0.001, getStepEntityFirstNum("#22", 0.012));

    const chainSpec = {
      chainId: "STEP::BearingFit_AP242::#30",
      name: "Harmonic Drive Cross-Roller Bearing Radial Clearance (#12 vs #22)",
      contributors: [
        {
          partId: "STEP::BearingFit_AP242::#10(HOUSING_BORE)",
          featureName: "#11/#12_H7_inner_race",
          direction: 1 as const,
          nominal: boreNominalMm,
          tolerance: boreTolMm,
        },
        {
          partId: "STEP::BearingFit_AP242::#20(SHAFT_JOURNAL)",
          featureName: "#21/#22_g6_outer_journal",
          direction: -1 as const,
          nominal: shaftNominalMm,
          tolerance: shaftTolMm,
        },
      ],
      targetClearance: {
        min: minClearanceMm,
        max: maxClearanceMm,
        name: "SysML2::SurgicalRobotics::HarmonicJoint.radial_clearance",
      },
      method: "worst_case" as const,
    };

    const stackRes = toleranceOracle.calculateChain(chainSpec);
    const verifierRes = ToleranceStackVerifier.verify({
      name: "STEP::BearingFit_AP242::#30",
      dimensions: [
        {
          name: "#10 HOUSING_BORE (#11/#12)",
          nominal: boreNominalMm,
          upperTol: boreTolMm,
          lowerTol: -boreTolMm,
          direction: 1,
        },
        {
          name: "#20 SHAFT_JOURNAL (#21/#22)",
          nominal: shaftNominalMm,
          upperTol: shaftTolMm,
          lowerTol: -shaftTolMm,
          direction: -1,
        },
      ],
      minRequiredClearance: minClearanceMm,
    });

    const wcMin = Number(stackRes.minClearance.toFixed(3));
    const wcMax = Number(stackRes.maxClearance.toFixed(3));
    const rssMin = Number(verifierRes.statisticalRss.minRssGap.toFixed(3));
    const rssMax = Number(verifierRes.statisticalRss.maxRssGap.toFixed(3));
    meshSourceSummary = `ISO 10303-242 PMI (${stepScan.length} entities) -> ToleranceStackVerifier`;

    codes[stepIdx] = updateStepEntityArg(
      updateStepEntityArg(codes[stepIdx]!, "#30", 2, wcMin.toFixed(3)),
      "#30",
      3,
      wcMax.toFixed(3),
    );

    // Sync SysML v2 part def HarmonicJoint attributes
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "min_radial_clearance", wcMin.toFixed(3));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "max_radial_clearance", wcMax.toFixed(3));
    codes[sysmlIdx] = updateSysmlAttrViaCst(codes[sysmlIdx]!, "peak_torque", peakTorqueNm.toFixed(1));

    coordinator.assertLiteral({
      id: 301,
      predicate: "toleranceChain",
      args: [chainSpec],
      domain: "spatial_physics",
    });

    const effectiveTorqueLimit = Math.min(maxSysmlTorqueNm, urdfEffort);
    const torqueSat = peakTorqueNm <= effectiveTorqueLimit;
    const clearanceSat = stackRes.isSatisfied;

    variableLinks.push(
      {
        symbol: "upper_arm.inertial.mass",
        canonicalFqn: "URDF::SurgicalArm::upper_arm.inertial.mass",
        bindingMechanism: 'annotation(twin = "URDF::SurgicalArm::upper_arm.inertial.mass")',
        label: "Upper Arm Link Mass",
        valueFormatted: `${moArmMass.toFixed(1)} kg`,
        boundsFormatted: `URDF <-> Modelica`,
        unit: "kg",
        sourceDomain: "ROS 2 URDF",
        targetDomains: ["Modelica"],
        domainBindings: [
          {
            domainLabel: "ROS 2 URDF",
            fqn: "URDF::SurgicalArm::upper_arm.inertial.mass",
            bindingSyntax: '<link name="upper_arm"><inertial><mass/>',
            valueText: `${moArmMass.toFixed(1)} kg`,
          },
          {
            domainLabel: "Modelica",
            fqn: "SurgicalControl.HarmonicDriveDynamics.arm_mass",
            bindingSyntax: 'annotation(twin = "URDF::...::upper_arm.inertial.mass")',
            valueText: `${moArmMass.toFixed(1)} kg`,
          },
        ],
        oracleName: "SpatialPhysicsOracle",
        status: "SAT",
        marginText: `Bijectively synced`,
      },
      {
        symbol: "HarmonicJoint.peak_torque",
        canonicalFqn: "SysML2::SurgicalRobotics::HarmonicJoint.peak_torque",
        bindingMechanism: 'annotation(twin = "...") + URDF shoulder_pitch.limit.effort',
        label: "RNEA Peak Joint Torque",
        valueFormatted: `${peakTorqueNm.toFixed(1)} N·m`,
        boundsFormatted: `<= ${effectiveTorqueLimit.toFixed(1)} N·m`,
        unit: "N·m",
        sourceDomain: "Modelica",
        targetDomains: ["ROS 2 URDF", "SysML v2"],
        domainBindings: [
          {
            domainLabel: "Modelica",
            fqn: "SurgicalControl.HarmonicDriveDynamics.peak_torque_Nm",
            bindingSyntax: 'annotation(twin = "SysML2::...::HarmonicJoint.peak_torque")',
            valueText: `${peakTorqueNm.toFixed(1)} N·m`,
          },
          {
            domainLabel: "ROS 2 URDF",
            fqn: "URDF::SurgicalArm::shoulder_pitch.limit.effort",
            bindingSyntax: '<joint name="shoulder_pitch"><limit effort="..."/>',
            valueText: `<= ${urdfEffort.toFixed(1)} N·m`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "SurgicalRobotics::REQ_HARMONIC_03::joint.peak_torque",
            bindingSyntax: "joint.peak_torque <= max_joint_torque_Nm",
            valueText: `<= ${maxSysmlTorqueNm.toFixed(1)} N·m`,
          },
        ],
        oracleName: "DynamicSimulationOracle",
        status: torqueSat ? "SAT" : "UNSAT",
        marginText: torqueSat
          ? `${(((effectiveTorqueLimit - peakTorqueNm) / effectiveTorqueLimit) * 100).toFixed(1)}% effort margin`
          : `+${(peakTorqueNm - effectiveTorqueLimit).toFixed(1)} N·m actuator overload`,
      },
      {
        symbol: "HarmonicJoint.min_radial_clearance",
        canonicalFqn: "SysML2::SurgicalRobotics::HarmonicJoint.min_radial_clearance",
        bindingMechanism: "STEP #12/#22 -> #30.MIN_CLEARANCE -> subject joint",
        label: "Worst-Case Min Clearance",
        valueFormatted: `${wcMin.toFixed(3)} mm`,
        boundsFormatted: `>= ${minClearanceMm.toFixed(3)} mm`,
        unit: "mm",
        sourceDomain: "STEP AP242 GD&T",
        targetDomains: ["SysML v2"],
        domainBindings: [
          {
            domainLabel: "STEP AP242",
            fqn: "STEP::BearingFit_AP242::#30(#12, #22).MIN_CLEARANCE",
            bindingSyntax: "#11(40.048±#12) - #21(40.000±#22)",
            valueText: `${wcMin.toFixed(3)} mm (3σ: ${rssMin.toFixed(3)})`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "SurgicalRobotics::REQ_HARMONIC_03::joint.min_radial_clearance",
            bindingSyntax: "joint.min_radial_clearance >= min_clearance_mm",
            valueText: `>= ${minClearanceMm.toFixed(3)} mm`,
          },
        ],
        oracleName: "ToleranceStackOracle",
        status: wcMin >= minClearanceMm ? "SAT" : "UNSAT",
        marginText:
          wcMin < 0
            ? `Interference (${wcMin.toFixed(3)} mm)`
            : wcMin >= minClearanceMm
              ? `+${((wcMin - minClearanceMm) * 1000).toFixed(0)} µm film margin`
              : `-${((minClearanceMm - wcMin) * 1000).toFixed(0)} µm seizure risk`,
      },
      {
        symbol: "HarmonicJoint.max_radial_clearance",
        canonicalFqn: "SysML2::SurgicalRobotics::HarmonicJoint.max_radial_clearance",
        bindingMechanism: "STEP #12/#22 -> #30.MAX_CLEARANCE -> subject joint",
        label: "Worst-Case Max Clearance",
        valueFormatted: `${wcMax.toFixed(3)} mm`,
        boundsFormatted: `<= ${maxClearanceMm.toFixed(3)} mm`,
        unit: "mm",
        sourceDomain: "STEP AP242 GD&T",
        targetDomains: ["SysML v2"],
        domainBindings: [
          {
            domainLabel: "STEP AP242",
            fqn: "STEP::BearingFit_AP242::#30(#12, #22).MAX_CLEARANCE",
            bindingSyntax: "EVALUATED_CLEARANCE_ENVELOPE(#12, #22)",
            valueText: `${wcMax.toFixed(3)} mm (3σ: ${rssMax.toFixed(3)})`,
          },
          {
            domainLabel: "SysML v2",
            fqn: "SurgicalRobotics::REQ_HARMONIC_03::joint.max_radial_clearance",
            bindingSyntax: "joint.max_radial_clearance <= max_clearance_mm",
            valueText: `<= ${maxClearanceMm.toFixed(3)} mm`,
          },
        ],
        oracleName: "ToleranceStackOracle",
        status: wcMax <= maxClearanceMm ? "SAT" : "UNSAT",
        marginText:
          wcMax <= maxClearanceMm
            ? `${((maxClearanceMm - wcMax) * 1000).toFixed(0)} µm backlash margin`
            : `+${((wcMax - maxClearanceMm) * 1000).toFixed(0)} µm excess backlash`,
      },
    );

    if (!clearanceSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "joint.min_radial_clearance");
      const posStep = findStepEntityLineCol(codes[stepIdx]!, "#30");
      const msg = `[MSC-THEORY-CONFLICT] ToleranceStackOracle: 'STEP::BearingFit_AP242::#30(#12, #22)' worst-case clearance [${wcMin.toFixed(3)}, ${wcMax.toFixed(3)}] mm violates 'SysML2::SurgicalRobotics::REQ_HARMONIC_03' envelope [${minClearanceMm.toFixed(3)}, ${maxClearanceMm.toFixed(3)}] mm.`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-GDT-STACK", message: msg });
      paneDiagnostics[stepIdx]!.push({ ...posStep, severity: "error", code: "MSC-GDT-STACK", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "STEP::BearingFit_AP242::#12(HOUSING_BORE)",
          "STEP::BearingFit_AP242::#21(SHAFT_JOURNAL)",
          "SysML2::SurgicalRobotics::REQ_HARMONIC_03",
        ],
        theoryName: "ToleranceStackOracle",
      });
    }

    if (!torqueSat) {
      const posSysml = findSysmlConstraintLineCol(codes[sysmlIdx]!, "joint.peak_torque");
      const posUrdf = findUrdfAttrLineCol(codes[urdfIdx]!, "effort");
      const posMo = findModelicaComponentLineCol(codes[moIdx]!, "peak_torque_Nm");
      const msg = `[MSC-THEORY-CONFLICT] DynamicSimulationOracle: 'Modelica::SurgicalControl.HarmonicDriveDynamics.peak_torque_Nm' (${peakTorqueNm.toFixed(1)} N·m) exceeds 'URDF::SurgicalArm::shoulder_pitch.limit.effort' & 'SysML2::SurgicalRobotics::REQ_HARMONIC_03.max_joint_torque_Nm' (${effectiveTorqueLimit.toFixed(1)} N·m).`;
      paneDiagnostics[sysmlIdx]!.push({ ...posSysml, severity: "error", code: "MSC-RNEA-TORQUE", message: msg });
      paneDiagnostics[urdfIdx]!.push({ ...posUrdf, severity: "error", code: "MSC-RNEA-TORQUE", message: msg });
      paneDiagnostics[moIdx]!.push({ ...posMo, severity: "error", code: "MSC-RNEA-TORQUE", message: msg });
      conflicts.push({
        literals: [],
        explanation: msg,
        culpritEntities: [
          "Modelica::SurgicalControl.HarmonicDriveDynamics.peak_torque_Nm",
          "URDF::SurgicalArm::shoulder_pitch.limit.effort",
          "SysML2::SurgicalRobotics::REQ_HARMONIC_03.max_joint_torque_Nm",
        ],
        theoryName: "DynamicSimulationOracle",
      });
    }

    const [sysmlVis, urdfVis, moVis, stepVis]: [PaneVisualData, PaneVisualData, PaneVisualData, PaneVisualData] = [
      {
        kind: "sysml-bdd",
        packageName: "SurgicalRobotics",
        partName: "HarmonicJoint",
        partAttributes: [
          { name: "min_radial_clearance", value: wcMin.toFixed(3), unit: "mm", sourceHint: "<- STEP::#30" },
          { name: "max_radial_clearance", value: wcMax.toFixed(3), unit: "mm", sourceHint: "<- STEP::#30" },
          { name: "peak_torque", value: peakTorqueNm.toFixed(1), unit: "N·m", sourceHint: "<- Modelica" },
        ],
        requirementId: "REQ_HARMONIC_03",
        subjectName: "joint",
        subjectType: "HarmonicJoint",
        constraints: [
          {
            expression: "joint.min_radial_clearance >= min_clearance_mm",
            actualText: `${wcMin.toFixed(3)} mm`,
            limitText: `>= ${minClearanceMm.toFixed(3)} mm`,
            isSat: wcMin >= minClearanceMm,
          },
          {
            expression: "joint.max_radial_clearance <= max_clearance_mm",
            actualText: `${wcMax.toFixed(3)} mm`,
            limitText: `<= ${maxClearanceMm.toFixed(3)} mm`,
            isSat: wcMax <= maxClearanceMm,
          },
          {
            expression: "joint.peak_torque <= max_joint_torque_Nm",
            actualText: `${peakTorqueNm.toFixed(1)} N·m`,
            limitText: `<= ${effectiveTorqueLimit.toFixed(1)} N·m`,
            isSat: torqueSat,
          },
        ],
      },
      {
        kind: "urdf-3d",
        robotName: urdfModel.name || "SurgicalArm",
        links:
          urdfModel.links.size > 0
            ? Array.from(urdfModel.links.values()).map((l: UrdfLinkLike) => ({
                name: l.name,
                massKg: l.name === "upper_arm" ? moArmMass : (l.inertial?.mass ?? 6.5),
              }))
            : [
                { name: "base_column", massKg: 6.5 },
                { name: "upper_arm", massKg: moArmMass },
              ],
        joints: [
          {
            name: shoulderJoint?.name ?? "shoulder_pitch",
            type: shoulderJoint?.type ?? "revolute",
            parent: shoulderJoint?.parentLink ?? "base_column",
            child: shoulderJoint?.childLink ?? "upper_arm",
            lowerRad: shoulderJoint?.limits?.lower ?? -1.57,
            upperRad: shoulderJoint?.limits?.upper ?? 1.57,
            effortLimitNm: urdfEffort,
            velocityLimitRadS: shoulderJoint?.limits?.velocity ?? 2.6,
            actualTorqueNm: peakTorqueNm,
          },
        ],
        payloadMassKg: payloadMass,
        linkReachM: linkReach,
      },
      {
        kind: "modelica-dae",
        withinPkg: "SurgicalControl",
        modelName: "HarmonicDriveDynamics",
        parameters: [
          {
            name: "arm_mass",
            value: moArmMass.toFixed(1),
            unit: "kg",
            twinFqn: "URDF::SurgicalArm::upper_arm.inertial.mass",
          },
          { name: "payload_mass", value: payloadMass.toFixed(1), unit: "kg" },
          { name: "link_reach", value: linkReach.toFixed(2), unit: "m" },
          { name: "peak_accel", value: peakAccel.toFixed(1), unit: "rad/s²" },
        ],
        equations: [
          {
            lhs: "peak_torque_Nm",
            rhs: moEq.rhsExpression,
            resultText: `${peakTorqueNm.toFixed(1)} N·m`,
            twinFqn: "SysML2::SurgicalRobotics::HarmonicJoint.peak_torque",
          },
        ],
      },
      {
        kind: "step-gdt",
        fileName: "BearingFit_AP242.step",
        entityCount: stepScan.length,
        boreEntityId: "#10/#11/#12",
        boreNominalMm,
        boreTolMm,
        shaftEntityId: "#20/#21/#22",
        shaftNominalMm,
        shaftTolMm,
        envelopeEntityId: "#30",
        wcMinMm: wcMin,
        wcMaxMm: wcMax,
        rssMinMm: rssMin,
        rssMaxMm: rssMax,
        allowableMinMm: minClearanceMm,
        allowableMaxMm: maxClearanceMm,
        isSat: clearanceSat,
        entities: stepScan.map((ent) => ({
          id: ent.id,
          typeName: ent.type,
          summary: ent.args,
        })),
      },
    ];
    paneVisuals[sysmlIdx] = sysmlVis;
    paneVisuals[urdfIdx] = urdfVis;
    paneVisuals[moIdx] = moVis;
    paneVisuals[stepIdx] = stepVis;
    return { meshSourceSummary, paneVisuals };
  }

  const COORDINATOR_PIPELINES: Record<string, CoordinatorPipelineEvaluator> = {
    "aerospace-actuator": evaluateAerospaceActuatorPipeline,
    "ev-battery-coldplate": evaluateEvBatteryColdplatePipeline,
    "robotics-gdt-tolerance": evaluateRoboticsGdtPipeline,
  };
  return COORDINATOR_PIPELINES;
}

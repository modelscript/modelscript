// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Multi-Domain Assume-Guarantee Contract Bridge.
 *
 * Bridges SysML v2 architectural contracts, 1D Modelica continuous dynamic interface
 * specifications, and 3D CAD/FEA boundary condition structural constraints into
 * unified compositional contract algebra proofs.
 */

import { ContractAlgebra, type AssumeGuaranteeContract, type CompositionalProofResult } from "./contract-verifier.js";

export interface FeaContractSpec {
  componentName: string;
  appliedForceVar: string;
  maxAllowableForce: number;
  yieldStressPa: number;
  safetyFactor?: number;
  maxDeflectionMm?: number;
  deflectionVar?: string;
  stressVar?: string;
}

export interface ModelicaPortContractSpec {
  subsystemName: string;
  portName: string;
  variableName: string;
  peakLoadMagnitude: number;
  operatingTempRange?: [number, number];
  tempVar?: string;
  sourceGuarantees?: string[];
  consumerAssumptions?: string[];
}

export interface MultiDomainCompositionResult {
  isCertifiedSafe: boolean;
  systemContractName: string;
  domainsEvaluated: ("sysml" | "modelica" | "cad_fea")[];
  compositionProof: CompositionalProofResult;
  domainViolations: {
    domain: "sysml" | "modelica" | "cad_fea";
    component: string;
    description: string;
  }[];
  summary: string;
}

export class MultiDomainContractBridge {
  /**
   * Synthesizes an Assume-Guarantee contract from CAD FEA structural limits.
   *
   * Assumption: External dynamic loads transmitted across interface do not exceed maximum allowable force.
   * Guarantee: Internal von Mises stress remains below certified yield threshold (with factor of safety).
   */
  public static fromFeaBoundary(spec: FeaContractSpec): AssumeGuaranteeContract {
    const safetyFactor = spec.safetyFactor ?? 1.5;
    const maxStress = spec.yieldStressPa / safetyFactor;
    const stressVar = spec.stressVar ?? `${spec.componentName}.vonMisesStress`;
    const forceVar = spec.appliedForceVar;

    const assumptions = [`${forceVar} <= ${spec.maxAllowableForce}`];
    const guarantees = [`${stressVar} <= ${maxStress}`];
    const outputs = [stressVar];

    if (spec.maxDeflectionMm !== undefined) {
      const deflVar = spec.deflectionVar ?? `${spec.componentName}.deflection`;
      guarantees.push(`${deflVar} <= ${spec.maxDeflectionMm}`);
      outputs.push(deflVar);
    }

    return {
      name: `FEA_${spec.componentName}_Contract`,
      assumptions,
      guarantees,
      inputs: [forceVar],
      outputs,
    };
  }

  /**
   * Synthesizes an Assume-Guarantee contract from Modelica port dynamics and peak loads.
   */
  public static fromModelicaPort(spec: ModelicaPortContractSpec): AssumeGuaranteeContract {
    const assumptions: string[] = [];
    const guarantees: string[] = [];
    const inputs: string[] = [];
    const outputs: string[] = [];

    // Operating temperature assumption if specified
    if (spec.operatingTempRange) {
      const tempVar = spec.tempVar ?? `${spec.subsystemName}.ambientTemp`;
      assumptions.push(`${tempVar} >= ${spec.operatingTempRange[0]}`);
      assumptions.push(`${tempVar} <= ${spec.operatingTempRange[1]}`);
      inputs.push(tempVar);
    }

    if (spec.consumerAssumptions) {
      assumptions.push(...spec.consumerAssumptions);
    }

    // Dynamic output peak load guarantee
    const forceVar = `${spec.subsystemName}.${spec.portName}.${spec.variableName}`;
    guarantees.push(`${forceVar} <= ${spec.peakLoadMagnitude}`);
    outputs.push(forceVar);

    if (spec.sourceGuarantees) {
      guarantees.push(...spec.sourceGuarantees);
    }

    return {
      name: `Modelica_${spec.subsystemName}_${spec.portName}_Contract`,
      assumptions,
      guarantees,
      inputs,
      outputs,
    };
  }

  /**
   * Verifies total multi-domain contract composition across SysML v2 system requirements,
   * Modelica 1D dynamic behavioral models, and CAD/FEA 3D structural bounds.
   */
  public static verifyMultiDomainComposition(
    systemRequirementContract: AssumeGuaranteeContract,
    subsystemContracts: AssumeGuaranteeContract[],
  ): MultiDomainCompositionResult {
    // Run formal algebraic composition verification via ContractAlgebra
    const compositionProof = ContractAlgebra.verifySystemComposition(systemRequirementContract, subsystemContracts);

    const domainViolations: MultiDomainCompositionResult["domainViolations"] = [];

    // Categorize compatibility violations by domain
    for (const v of compositionProof.compatibilityViolations) {
      let domain: "sysml" | "modelica" | "cad_fea" = "sysml";
      if (
        v.component.startsWith("FEA_") ||
        v.missingAssumption.includes("Stress") ||
        v.missingAssumption.includes("force")
      ) {
        domain = "cad_fea";
      } else if (
        v.component.startsWith("Modelica_") ||
        v.missingAssumption.includes("Temp") ||
        v.missingAssumption.includes("voltage")
      ) {
        domain = "modelica";
      }

      domainViolations.push({
        domain,
        component: v.component,
        description: `Compatibility failure: '${v.component}' requires assumption '${v.missingAssumption}' which is not guaranteed by upstream subsystems: ${v.reason}`,
      });
    }

    // Categorize refinement violations
    for (const r of compositionProof.refinementViolations) {
      domainViolations.push({
        domain: "sysml",
        component: systemRequirementContract.name,
        description: `Refinement failure: Subsystem contracts fail to entail top-level system requirement '${r.systemGuarantee}': ${r.reason}`,
      });
    }

    const isCertifiedSafe = compositionProof.isCompatible && compositionProof.isRefined;

    const domainsEvaluated: ("sysml" | "modelica" | "cad_fea")[] = ["sysml", "modelica", "cad_fea"];

    let summary = isCertifiedSafe
      ? `Multi-domain digital thread contract composition CERTIFIED SAFE. All 1D Modelica dynamics and 3D CAD/FEA stress limits mathematically refine SysML system requirement '${systemRequirementContract.name}'.`
      : `Multi-domain digital thread contract FALSIFIED with ${domainViolations.length} issue(s) across domains.`;

    return {
      isCertifiedSafe,
      systemContractName: systemRequirementContract.name,
      domainsEvaluated,
      compositionProof,
      domainViolations,
      summary,
    };
  }
}

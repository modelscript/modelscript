// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — SOTA KerML/SysML v2 Static & Live Formal Verification Lints.
 *
 * Barrel module re-exporting domain-organized lint modules under `./sota-lints/`.
 */

import type { LintResult } from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import {
  checkInvocationAndTriggers,
  checkMultiplicityNaturalBounds,
  checkParallelStateAndSingletonMembers,
  checkVariationAndModifierRules,
} from "./sota-lints/behavioral-modifiers.js";
import {
  checkCalcAndFeatureAbstractInterpretation,
  checkContractRefinement,
  checkRequirementDecompositionAndVacuity,
  checkStateMachineZenoAndParallelRaces,
  checkStructuralBalanceAndRollup,
} from "./sota-lints/formal-verification.js";
import {
  checkIndividualAndPortionRules,
  checkInvalidCastOrTypeTest,
  checkMetadataAnnotationValidity,
  checkOpaqueInterfaceCompatibility,
  checkUnusedImportAndPrivateMember,
} from "./sota-lints/hygiene-metadata.js";
import {
  checkCyberPhysicalNyquist,
  checkSequenceIndexBounds,
  checkSpatialEnvelopes,
  extractSpatialBoundingBox,
} from "./sota-lints/physical-spatial.js";
import { narrowDiagnosticRange, type SysML2LintFn } from "./sota-lints/shared.js";
import {
  checkDisjointClassifierSpecialization,
  checkInheritedMemberShadowing,
  checkSpecializationResolutionAndConformance,
  checkUsageDefinitionKindMatch,
  checkVisibilityAndImports,
} from "./sota-lints/type-hierarchy.js";

export {
  checkCalcAndFeatureAbstractInterpretation,
  checkContractRefinement,
  checkCyberPhysicalNyquist,
  checkDisjointClassifierSpecialization,
  checkIndividualAndPortionRules,
  checkInheritedMemberShadowing,
  checkInvalidCastOrTypeTest,
  checkInvocationAndTriggers,
  checkMetadataAnnotationValidity,
  checkMultiplicityNaturalBounds,
  checkOpaqueInterfaceCompatibility,
  checkParallelStateAndSingletonMembers,
  checkRequirementDecompositionAndVacuity,
  checkSequenceIndexBounds,
  checkSpatialEnvelopes,
  checkSpecializationResolutionAndConformance,
  checkStateMachineZenoAndParallelRaces,
  checkStructuralBalanceAndRollup,
  checkUnusedImportAndPrivateMember,
  checkUsageDefinitionKindMatch,
  checkVariationAndModifierRules,
  checkVisibilityAndImports,
  extractSpatialBoundingBox,
  narrowDiagnosticRange,
  type SysML2LintFn,
};

// ---------------------------------------------------------------------------
// Composable Rule Bundles for Salsa Query Integration
// ---------------------------------------------------------------------------

export const sotaDefinitionLints = {
  specializationResolutionAndConformance: checkSpecializationResolutionAndConformance,
  visibilityAndImports: checkVisibilityAndImports,
  unusedImportAndPrivateMember: checkUnusedImportAndPrivateMember,
  inheritedMemberShadowing: checkInheritedMemberShadowing,
  disjointClassifierSpecialization: checkDisjointClassifierSpecialization,
  invocationAndTriggers: checkInvocationAndTriggers,
  invalidCastOrTypeTest: checkInvalidCastOrTypeTest,
  variationAndModifierRules: checkVariationAndModifierRules,
  individualAndPortionRules: checkIndividualAndPortionRules,
  metadataAnnotationValidity: checkMetadataAnnotationValidity,
  parallelStateAndSingletonMembers: checkParallelStateAndSingletonMembers,
  contractRefinement: checkContractRefinement,
  requirementDecompositionAndVacuity: checkRequirementDecompositionAndVacuity,
  stateMachineZenoAndParallelRaces: checkStateMachineZenoAndParallelRaces,
  calcAndFeatureAbstractInterpretation: checkCalcAndFeatureAbstractInterpretation,
  sequenceIndexBounds: checkSequenceIndexBounds,
  structuralBalanceAndRollup: checkStructuralBalanceAndRollup,
  cyberPhysicalNyquist: checkCyberPhysicalNyquist,
  spatialEnvelopes: checkSpatialEnvelopes,
};

export const sotaUsageLints = {
  specializationResolutionAndConformance: checkSpecializationResolutionAndConformance,
  visibilityAndImports: checkVisibilityAndImports,
  unusedImportAndPrivateMember: checkUnusedImportAndPrivateMember,
  usageDefinitionKindMatch: checkUsageDefinitionKindMatch,
  invocationAndTriggers: checkInvocationAndTriggers,
  invalidCastOrTypeTest: checkInvalidCastOrTypeTest,
  multiplicityNaturalBounds: checkMultiplicityNaturalBounds,
  variationAndModifierRules: checkVariationAndModifierRules,
  individualAndPortionRules: checkIndividualAndPortionRules,
  metadataAnnotationValidity: checkMetadataAnnotationValidity,
  parallelStateAndSingletonMembers: checkParallelStateAndSingletonMembers,
  contractRefinement: checkContractRefinement,
  requirementDecompositionAndVacuity: checkRequirementDecompositionAndVacuity,
  opaqueInterfaceCompatibility: checkOpaqueInterfaceCompatibility,
  stateMachineZenoAndParallelRaces: checkStateMachineZenoAndParallelRaces,
  calcAndFeatureAbstractInterpretation: checkCalcAndFeatureAbstractInterpretation,
  sequenceIndexBounds: checkSequenceIndexBounds,
  structuralBalanceAndRollup: checkStructuralBalanceAndRollup,
  cyberPhysicalNyquist: checkCyberPhysicalNyquist,
  spatialEnvelopes: checkSpatialEnvelopes,
};

export const sotaImportLints = {
  visibilityAndImports: checkVisibilityAndImports,
  unusedImportAndPrivateMember: checkUnusedImportAndPrivateMember,
};

export const sotaAliasLints = {
  specializationResolutionAndConformance: checkSpecializationResolutionAndConformance,
  visibilityAndImports: checkVisibilityAndImports,
};

export const sotaPackageLints = {
  invocationAndTriggers: checkInvocationAndTriggers,
  invalidCastOrTypeTest: checkInvalidCastOrTypeTest,
  metadataAnnotationValidity: checkMetadataAnnotationValidity,
  sequenceIndexBounds: checkSequenceIndexBounds,
  cyberPhysicalNyquist: checkCyberPhysicalNyquist,
};

/**
 * Evaluates all applicable SOTA static and live-formal lint rules on `self` in a single pass.
 */
export function runAllSotaLintsForSymbol(db: QueryDB, self: SymbolEntry): LintResult[] {
  const fns: SysML2LintFn[] = [
    checkSpecializationResolutionAndConformance,
    checkVisibilityAndImports,
    checkUnusedImportAndPrivateMember,
    checkInheritedMemberShadowing,
    checkUsageDefinitionKindMatch,
    checkDisjointClassifierSpecialization,
    checkInvocationAndTriggers,
    checkInvalidCastOrTypeTest,
    checkMultiplicityNaturalBounds,
    checkVariationAndModifierRules,
    checkIndividualAndPortionRules,
    checkMetadataAnnotationValidity,
    checkParallelStateAndSingletonMembers,
    checkContractRefinement,
    checkRequirementDecompositionAndVacuity,
    checkOpaqueInterfaceCompatibility,
    checkStateMachineZenoAndParallelRaces,
    checkCalcAndFeatureAbstractInterpretation,
    checkSequenceIndexBounds,
    checkStructuralBalanceAndRollup,
    checkCyberPhysicalNyquist,
    checkSpatialEnvelopes,
  ];
  const results: LintResult[] = [];
  for (const fn of fns) {
    const res = fn(db, self);
    if (!res) continue;
    if (Array.isArray(res)) {
      results.push(...res);
    } else {
      results.push(res);
    }
  }
  return results;
}

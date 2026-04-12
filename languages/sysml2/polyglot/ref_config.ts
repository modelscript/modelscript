/* eslint-disable */
import type { RefHook } from "@modelscript/polyglot/runtime";

export const REF_HOOKS: RefHook[] = [
  {
    ruleName: "Annotation",
    namePath: "annotatedElement",
    targetKinds: ["Element"],
    resolve: "qualified",
  },
  {
    ruleName: "MetadataTyping",
    namePath: "type",
    targetKinds: ["Metaclass"],
    resolve: "qualified",
  },
  {
    ruleName: "_ImportedMembership",
    namePath: "importedMembership",
    targetKinds: ["Membership"],
    resolve: "qualified",
  },
  {
    ruleName: "_ImportedNamespace",
    namePath: "importedNamespace",
    targetKinds: ["Namespace"],
    resolve: "qualified",
  },
  {
    ruleName: "OwnedSubclassification",
    namePath: "superclassifier",
    targetKinds: ["Classifier"],
    resolve: "qualified",
  },
  {
    ruleName: "OwnedFeatureTyping",
    namePath: "type",
    targetKinds: ["Type"],
    resolve: "qualified",
  },
  {
    ruleName: "OwnedSubsetting",
    namePath: "subsettedFeature",
    targetKinds: ["Feature"],
    resolve: "qualified",
  },
  {
    ruleName: "OwnedReferenceSubsetting",
    namePath: "referencedFeature",
    targetKinds: ["Feature"],
    resolve: "qualified",
  },
  {
    ruleName: "OwnedCrossSubsetting",
    namePath: "crossedFeature",
    targetKinds: ["Feature"],
    resolve: "qualified",
  },
  {
    ruleName: "OwnedRedefinition",
    namePath: "redefinedFeature",
    targetKinds: ["Feature"],
    resolve: "qualified",
  },
  {
    ruleName: "ConjugatedPortTyping",
    namePath: "conjugatedPortDefinition",
    targetKinds: ["ConjugatedPortDefinition"],
    resolve: "qualified",
  },
  {
    ruleName: "FlowFeature",
    namePath: "ownedRelationship",
    targetKinds: ["Feature"],
    resolve: "qualified",
  },
  {
    ruleName: "ReferenceTyping",
    namePath: "type",
    targetKinds: ["Type"],
    resolve: "qualified",
  },
  {
    ruleName: "FeatureChainMember",
    namePath: "memberElement",
    targetKinds: ["Feature"],
    resolve: "qualified",
  },
  {
    ruleName: "FeatureReferenceMember",
    namePath: "memberElement",
    targetKinds: ["Feature"],
    resolve: "qualified",
  },
  {
    ruleName: "ElementReferenceMember",
    namePath: "memberElement",
    targetKinds: ["Element"],
    resolve: "qualified",
  },
  {
    ruleName: "InstantiatedTypeMember",
    namePath: "memberElement",
    targetKinds: ["Type"],
    resolve: "qualified",
  },
  {
    ruleName: "OwnedFeatureChaining",
    namePath: "chainingFeature",
    targetKinds: ["Feature"],
    resolve: "qualified",
  },
  {
    ruleName: "ParameterRedefinition",
    namePath: "redefinedFeature",
    targetKinds: ["Feature"],
    resolve: "qualified",
  },
];

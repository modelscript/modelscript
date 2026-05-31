import type { DiffConfig, GraphicsConfig, IndexerHook, RefHook } from "@modelscript/compiler";

export const INDEXER_HOOKS: IndexerHook[] = [
  {
    ruleName: "Annotation",
    kind: "Reference",
    namePath: "annotatedElement",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "MetadataUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "MetadataTyping",
    kind: "Reference",
    namePath: "type",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "MetadataDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "Package",
    kind: "Package",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "LibraryPackage",
    kind: "Package",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isStandard: "isStandard" },
  },
  {
    ruleName: "AliasMember",
    kind: "Alias",
    namePath: "memberName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "MembershipImport",
    kind: "Import",
    namePath: "importedMembership",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: { isImportAll: "isImportAll", isRecursive: "isRecursive" },
  },
  {
    ruleName: "_ImportedMembership",
    kind: "Reference",
    namePath: "importedMembership",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "NamespaceImport",
    kind: "Import",
    namePath: "importedNamespace",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: { isImportAll: "isImportAll", isRecursive: "isRecursive" },
  },
  {
    ruleName: "_ImportedNamespace",
    kind: "Reference",
    namePath: "importedNamespace",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "OwnedSubclassification",
    kind: "Reference",
    namePath: "superclassifier",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "OwnedFeatureTyping",
    kind: "Reference",
    namePath: "type",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "OwnedSubsetting",
    kind: "Reference",
    namePath: "subsettedFeature",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "OwnedReferenceSubsetting",
    kind: "Reference",
    namePath: "referencedFeature",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "OwnedCrossSubsetting",
    kind: "Reference",
    namePath: "crossedFeature",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "OwnedRedefinition",
    kind: "Reference",
    namePath: "redefinedFeature",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "DefaultReferenceUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "ReferenceUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "AttributeDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "AttributeUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "EnumerationDefinition",
    kind: "Enumeration",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "EnumeratedValue",
    kind: "EnumerationValue",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "EnumerationUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "OccurrenceDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "OccurrenceUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "ItemDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "ItemUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "PartDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "PartUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "PortDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "PortUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "ConjugatedPortTyping",
    kind: "Reference",
    namePath: "conjugatedPortDefinition",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "ConnectionDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "ConnectionUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "BindingConnectorAsUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "SuccessionAsUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
      guard: "guard",
    },
  },
  {
    ruleName: "InterfaceDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "InterfaceUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "AllocationDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "AllocationUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "FlowDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "FlowUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "SuccessionFlowUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "FlowFeature",
    kind: "Reference",
    namePath: "ownedRelationship",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "ActionDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "MergeNode",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "DecisionNode",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "JoinNode",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "ForkNode",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "ActionUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "AcceptActionNode",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "SendActionNode",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "AssignActionNode",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "PerformActionUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "CalculationDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "CalculationUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "ConstraintDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "ConstraintUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "AssertConstraintUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "RequirementDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "SubjectUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "RequirementConstraintUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "ActorUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "StakeholderUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "RequirementUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "SatisfyRequirementUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "ConcernDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "ConcernUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "CaseDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "CaseUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "AnalysisCaseDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "AnalysisCaseUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "VerificationCaseDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "VerificationCaseUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "VerifyRequirementUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "ObjectiveRequirementUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "UseCaseDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "UseCaseUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "IncludeUseCaseUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "StateDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation", isParallel: "isParallel" },
  },
  {
    ruleName: "StateUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
      isParallel: "isParallel",
    },
  },
  {
    ruleName: "ExhibitStateUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
      isParallel: "isParallel",
    },
  },
  {
    ruleName: "TransitionUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
      trigger: "trigger",
      guard: "guard",
      effect: "effect",
    },
  },
  {
    ruleName: "ViewDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "ViewUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "ViewpointDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "ViewpointUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "RenderingDefinition",
    kind: "Definition",
    namePath: "declaredName",
    exportPaths: [null],
    inheritPaths: [],
    metadataFieldPaths: { isAbstract: "isAbstract", isVariation: "isVariation" },
  },
  {
    ruleName: "RenderingUsage",
    kind: "Usage",
    namePath: "declaredName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {
      direction: "direction",
      isAbstract: "isAbstract",
      isVariation: "isVariation",
      isDerived: "isDerived",
      isEnd: "isEnd",
      isRef: "isRef",
      isOrdered: "isOrdered",
      isNonunique: "isNonunique",
      isConstant: "isConstant",
      multiplicityLower: "ownedMultiplicity.ownedRelatedElement.lowerBound",
      multiplicityUpper: "ownedMultiplicity.ownedRelatedElement.upperBound",
    },
  },
  {
    ruleName: "ReferenceTyping",
    kind: "Reference",
    namePath: "type",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "FeatureChainMember",
    kind: "Reference",
    namePath: "memberElement",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "FeatureReferenceMember",
    kind: "Reference",
    namePath: "memberElement",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "ElementReferenceMember",
    kind: "Reference",
    namePath: "memberElement",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "InstantiatedTypeMember",
    kind: "Reference",
    namePath: "memberElement",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "OwnedFeatureChaining",
    kind: "Reference",
    namePath: "chainingFeature",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "ParameterRedefinition",
    kind: "Reference",
    namePath: "redefinedFeature",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
];

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

export const graphicsConfig: Record<string, GraphicsConfig> = {
  Package: {
    role: "group",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "rect",
          selector: "tab",
        },
        {
          tagName: "text",
          selector: "tabLabel",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#f0f4ff",
          stroke: "#4a90d9",
          strokeWidth: 2,
          rx: 0,
          ry: 0,
        },
        tab: {
          fill: "#4a90d9",
          width: 80,
          height: 20,
          rx: 0,
          ry: 0,
          x: 0,
          y: 0,
        },
        tabLabel: {
          text: "package",
          fill: "#fff",
          fontSize: 10,
          x: 40,
          y: 13,
          textAnchor: "middle",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          refX: 0.5,
          refY: 34,
          textAnchor: "middle",
        },
      },
      size: {
        width: 300,
        height: 200,
      },
    },
  },
  LibraryPackage: {
    role: "group",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "rect",
          selector: "tab",
        },
        {
          tagName: "text",
          selector: "tabLabel",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#f0f4ff",
          stroke: "#4a90d9",
          strokeWidth: 2,
          rx: 0,
          ry: 0,
        },
        tab: {
          fill: "#4a90d9",
          width: 80,
          height: 20,
          rx: 0,
          ry: 0,
          x: 0,
          y: 0,
        },
        tabLabel: {
          text: "library",
          fill: "#fff",
          fontSize: 10,
          x: 40,
          y: 13,
          textAnchor: "middle",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          refX: 0.5,
          refY: 34,
          textAnchor: "middle",
        },
      },
      size: {
        width: 300,
        height: 200,
      },
    },
  },
  AttributeDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#fce4ec",
          stroke: "#e91e63",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«attribute def»",
          fill: "#e91e63",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#e91e63",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#e91e63",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#e91e63",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  AttributeUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#fce4ec",
          stroke: "#f48fb1",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  EnumerationDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#f3e5f5",
          stroke: "#7b1fa2",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«enum def»",
          fill: "#7b1fa2",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#7b1fa2",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#7b1fa2",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#7b1fa2",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  OccurrenceDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#f5f5f5",
          stroke: "#616161",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«occurrence def»",
          fill: "#616161",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#616161",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#616161",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#616161",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  ItemDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#e0f2f1",
          stroke: "#00897b",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«item def»",
          fill: "#00897b",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#00897b",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#00897b",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#00897b",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  ItemUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#e0f2f1",
          stroke: "#4db6ac",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  PartDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#e8f5e9",
          stroke: "#43a047",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«part def»",
          fill: "#43a047",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#43a047",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#43a047",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#43a047",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
      portQuery: "ownedPorts",
    },
  },
  PartUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#e8f5e9",
          stroke: "#66bb6a",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  PortDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#fff9c4",
          stroke: "#f57f17",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«port def»",
          fill: "#f57f17",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#f57f17",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#f57f17",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#f57f17",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  PortUsage: {
    role: "port-owner",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#fff3e0",
          stroke: "#ef6c00",
          strokeWidth: 2,
          rx: 0,
          ry: 0,
          width: 16,
          height: 16,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 10,
          refX: 0.5,
          refY: 20,
          textAnchor: "middle",
        },
      },
      size: {
        width: 16,
        height: 16,
      },
    },
  },
  ConnectionDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#eceff1",
          stroke: "#546e7a",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«connection def»",
          fill: "#546e7a",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#546e7a",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#546e7a",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#546e7a",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  ConnectionUsage: {
    role: "edge",
    edge: {
      shape: "edge",
      attrs: {
        line: {
          stroke: "#546e7a",
          strokeWidth: 1.5,
          targetMarker: "classic",
        },
      },
      labels: [
        {
          attrs: {
            text: {
              text: "«connect»",
              fill: "#666",
              fontSize: 11,
            },
            rect: {
              fill: "#fff",
              stroke: "none",
              rx: 3,
              ry: 3,
            },
          },
          position: {
            distance: 0.5,
            offset: 0,
          },
        },
      ],
      router: "manhattan",
      connector: "rounded",
    },
  },
  BindingConnectorAsUsage: {
    role: "edge",
    edge: {
      shape: "edge",
      attrs: {
        line: {
          stroke: "#37474f",
          strokeWidth: 1.5,
          targetMarker: "classic",
        },
      },
      labels: [
        {
          attrs: {
            text: {
              text: "«bind»",
              fill: "#666",
              fontSize: 11,
            },
            rect: {
              fill: "#fff",
              stroke: "none",
              rx: 3,
              ry: 3,
            },
          },
          position: {
            distance: 0.5,
            offset: 0,
          },
        },
      ],
      router: "manhattan",
      connector: "rounded",
    },
  },
  SuccessionAsUsage: {
    role: "edge",
    edge: {
      shape: "edge",
      attrs: {
        line: {
          stroke: "#455a64",
          strokeWidth: 1.5,
          strokeDasharray: "4 2",
          targetMarker: "classic",
        },
      },
      labels: [
        {
          attrs: {
            text: {
              text: "«succession»",
              fill: "#666",
              fontSize: 11,
            },
            rect: {
              fill: "#fff",
              stroke: "none",
              rx: 3,
              ry: 3,
            },
          },
          position: {
            distance: 0.5,
            offset: 0,
          },
        },
      ],
      router: "manhattan",
      connector: "rounded",
    },
  },
  InterfaceDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#e0f2f1",
          stroke: "#00695c",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«interface def»",
          fill: "#00695c",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#00695c",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#00695c",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#00695c",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  InterfaceUsage: {
    role: "edge",
    edge: {
      shape: "edge",
      attrs: {
        line: {
          stroke: "#00695c",
          strokeWidth: 1.5,
          targetMarker: "classic",
        },
      },
      labels: [
        {
          attrs: {
            text: {
              text: "«interface»",
              fill: "#666",
              fontSize: 11,
            },
            rect: {
              fill: "#fff",
              stroke: "none",
              rx: 3,
              ry: 3,
            },
          },
          position: {
            distance: 0.5,
            offset: 0,
          },
        },
      ],
      router: "manhattan",
      connector: "rounded",
    },
  },
  AllocationDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#e8eaf6",
          stroke: "#283593",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«allocation def»",
          fill: "#283593",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#283593",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#283593",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#283593",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  AllocationUsage: {
    role: "edge",
    edge: {
      shape: "edge",
      attrs: {
        line: {
          stroke: "#283593",
          strokeWidth: 1.5,
          strokeDasharray: "6 3",
          targetMarker: "classic",
        },
      },
      labels: [
        {
          attrs: {
            text: {
              text: "«allocate»",
              fill: "#666",
              fontSize: 11,
            },
            rect: {
              fill: "#fff",
              stroke: "none",
              rx: 3,
              ry: 3,
            },
          },
          position: {
            distance: 0.5,
            offset: 0,
          },
        },
      ],
      router: "manhattan",
      connector: "rounded",
    },
  },
  FlowDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#e1f5fe",
          stroke: "#01579b",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«flow def»",
          fill: "#01579b",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#01579b",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#01579b",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#01579b",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  FlowUsage: {
    role: "edge",
    edge: {
      shape: "edge",
      attrs: {
        line: {
          stroke: "#01579b",
          strokeWidth: 1.5,
          targetMarker: "classic",
        },
      },
      labels: [
        {
          attrs: {
            text: {
              text: "«flow»",
              fill: "#666",
              fontSize: 11,
            },
            rect: {
              fill: "#fff",
              stroke: "none",
              rx: 3,
              ry: 3,
            },
          },
          position: {
            distance: 0.5,
            offset: 0,
          },
        },
      ],
      router: "manhattan",
      connector: "rounded",
    },
  },
  SuccessionFlowUsage: {
    role: "edge",
    edge: {
      shape: "edge",
      attrs: {
        line: {
          stroke: "#01579b",
          strokeWidth: 1.5,
          strokeDasharray: "4 2",
          targetMarker: "classic",
        },
      },
      labels: [
        {
          attrs: {
            text: {
              text: "«succession flow»",
              fill: "#666",
              fontSize: 11,
            },
            rect: {
              fill: "#fff",
              stroke: "none",
              rx: 3,
              ry: 3,
            },
          },
          position: {
            distance: 0.5,
            offset: 0,
          },
        },
      ],
      router: "manhattan",
      connector: "rounded",
    },
  },
  ActionDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#e3f2fd",
          stroke: "#1565c0",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«action def»",
          fill: "#1565c0",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#1565c0",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#1565c0",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#1565c0",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  ActionUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#e3f2fd",
          stroke: "#1976d2",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  PerformActionUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#e3f2fd",
          stroke: "#0d47a1",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  CalculationDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#e0f7fa",
          stroke: "#00838f",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«calc def»",
          fill: "#00838f",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#00838f",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#00838f",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#00838f",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  CalculationUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#e0f7fa",
          stroke: "#006064",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  ConstraintDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#ffebee",
          stroke: "#c62828",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«constraint def»",
          fill: "#c62828",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#c62828",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#c62828",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#c62828",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  ConstraintUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#ffebee",
          stroke: "#b71c1c",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  RequirementDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#f3e5f5",
          stroke: "#9c27b0",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«requirement def»",
          fill: "#9c27b0",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#9c27b0",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 200,
        height: 70,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#9c27b0",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#9c27b0",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  SubjectUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#f1f8e9",
          stroke: "#33691e",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  ActorUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#fff3e0",
          stroke: "#e65100",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  StakeholderUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#fbe9e7",
          stroke: "#bf360c",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  RequirementUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#f3e5f5",
          stroke: "#4a148c",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  SatisfyRequirementUsage: {
    role: "edge",
    edge: {
      shape: "edge",
      attrs: {
        line: {
          stroke: "#9c27b0",
          strokeWidth: 1.5,
          strokeDasharray: "8 4",
          targetMarker: "classic",
        },
      },
      labels: [
        {
          attrs: {
            text: {
              text: "«satisfy»",
              fill: "#666",
              fontSize: 11,
            },
            rect: {
              fill: "#fff",
              stroke: "none",
              rx: 3,
              ry: 3,
            },
          },
          position: {
            distance: 0.5,
            offset: 0,
          },
        },
      ],
      router: "manhattan",
      connector: "rounded",
    },
  },
  ConcernDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#fce4ec",
          stroke: "#ad1457",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«concern def»",
          fill: "#ad1457",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#ad1457",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#ad1457",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#ad1457",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  ConcernUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#fce4ec",
          stroke: "#c2185b",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  CaseDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#ede7f6",
          stroke: "#4527a0",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«case def»",
          fill: "#4527a0",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#4527a0",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#4527a0",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#4527a0",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  CaseUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#ede7f6",
          stroke: "#311b92",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  AnalysisCaseDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#ede7f6",
          stroke: "#311b92",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«analysis case def»",
          fill: "#311b92",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#311b92",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#311b92",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#311b92",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  AnalysisCaseUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#ede7f6",
          stroke: "#512da8",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  VerificationCaseDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#e8eaf6",
          stroke: "#3f51b5",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«verification def»",
          fill: "#3f51b5",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#3f51b5",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#3f51b5",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#3f51b5",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  VerificationCaseUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#e8eaf6",
          stroke: "#1a237e",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  VerifyRequirementUsage: {
    role: "edge",
    edge: {
      shape: "edge",
      attrs: {
        line: {
          stroke: "#3f51b5",
          strokeWidth: 1.5,
          strokeDasharray: "4 4",
          targetMarker: "classic",
        },
      },
      labels: [
        {
          attrs: {
            text: {
              text: "«verify»",
              fill: "#666",
              fontSize: 11,
            },
            rect: {
              fill: "#fff",
              stroke: "none",
              rx: 3,
              ry: 3,
            },
          },
          position: {
            distance: 0.5,
            offset: 0,
          },
        },
      ],
      router: "manhattan",
      connector: "rounded",
    },
  },
  UseCaseDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#fce4ec",
          stroke: "#880e4f",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«use case def»",
          fill: "#880e4f",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#880e4f",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#880e4f",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#880e4f",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  UseCaseUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#fce4ec",
          stroke: "#c2185b",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  StateDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#fff8e1",
          stroke: "#f9a825",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«state def»",
          fill: "#f9a825",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#f9a825",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#f9a825",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#f9a825",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  StateUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#fff8e1",
          stroke: "#fbc02d",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  TransitionUsage: {
    role: "edge",
    edge: {
      shape: "edge",
      attrs: {
        line: {
          stroke: "#f9a825",
          strokeWidth: 1.5,
          targetMarker: "classic",
        },
      },
      labels: [
        {
          attrs: {
            text: {
              text: "«transition»",
              fill: "#666",
              fontSize: 11,
            },
            rect: {
              fill: "#fff",
              stroke: "none",
              rx: 3,
              ry: 3,
            },
          },
          position: {
            distance: 0.5,
            offset: 0,
          },
        },
      ],
      router: "manhattan",
      connector: "rounded",
    },
  },
  ViewDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#efebe9",
          stroke: "#4e342e",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«view def»",
          fill: "#4e342e",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#4e342e",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#4e342e",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#4e342e",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  ViewUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#efebe9",
          stroke: "#6d4c41",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  ViewpointDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#efebe9",
          stroke: "#3e2723",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«viewpoint def»",
          fill: "#3e2723",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#3e2723",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#3e2723",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#3e2723",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  ViewpointUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#efebe9",
          stroke: "#5d4037",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
  RenderingDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
        {
          tagName: "image",
          selector: "icon",
        },
      ],
      attrs: {
        body: {
          fill: "#fafafa",
          stroke: "#424242",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "«rendering def»",
          fill: "#424242",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#424242",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
        icon: {},
      },
      size: {
        width: 180,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#424242",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#424242",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
    },
  },
  RenderingUsage: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#fafafa",
          stroke: "#616161",
          strokeWidth: 1.5,
          rx: 4,
          ry: 4,
          strokeDasharray: "6 3",
        },
        label: {
          text: "{{name}}",
          fill: "#1a1a1a",
          fontSize: 13,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 140,
        height: 40,
      },
    },
  },
};

export const diffConfig: Record<string, DiffConfig> = {
  PartDefinition: {
    ignore: ["annotationClause", "description"],
    breaking: ["isAbstract"],
  },
  PortDefinition: {
    ignore: ["annotationClause", "description"],
    breaking: ["direction"],
  },
  ConnectionUsage: {
    identity: (self) => self.name || `connection_${self.id}`,
  },
  RequirementDefinition: {
    ignore: ["description", "text"],
    breaking: ["subject", "isAbstract"],
  },
};

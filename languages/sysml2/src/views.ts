// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Declarative 9-View Projection Configurations for SysML v2.
// Replaces hardcoded logic in polyglot builder with declarative projection specs.

import type { DiagramProjectionConfig } from "@modelscript/dsl";

export const sysml2Views: Record<string, DiagramProjectionConfig> = {
  BDD: {
    label: "Block Definition Diagram",
    description: "System taxonomy, definitions, classifications, and general structure",
    excludeRules: ["PartUsage", "PortUsage", "StateDefinition", "StateUsage", "ExhibitStateUsage", "TransitionUsage"],
  },
  IBD: {
    label: "Internal Block Diagram",
    description: "Internal parts, ports, delegation, and assembly connections",
    excludeRules: [
      "Package",
      "LibraryPackage",
      "StateDefinition",
      "StateUsage",
      "ExhibitStateUsage",
      "TransitionUsage",
    ],
  },
  StateMachine: {
    label: "State Machine Diagram",
    description: "States, substates, pseudostates, and event/guard-driven transitions",
    includeRules: ["StateDefinition", "StateUsage", "ExhibitStateUsage", "TransitionUsage", "ActionUsage", "Package"],
    groupRules: ["StateDefinition", "StateUsage", "ExhibitStateUsage"],
    standaloneRules: ["StateDefinition", "StateUsage", "ExhibitStateUsage"],
  },
  Activity: {
    label: "Activity Diagram",
    description: "Action execution, succession flows, control nodes, and swimlanes",
    includeRules: [
      "ActionDefinition",
      "ActionUsage",
      "PerformActionUsage",
      "ForkNode",
      "JoinNode",
      "DecisionNode",
      "MergeNode",
      "AcceptActionNode",
      "SendActionNode",
      "AssignActionNode",
      "SuccessionAsUsage",
      "SuccessionFlowUsage",
      "Package",
    ],
    groupRules: ["ActorUsage", "SubjectUsage", "PartUsage", "PartDefinition"],
  },
  UseCase: {
    label: "Use Case Diagram",
    description: "Use cases, subject boundaries, and actor interactions",
    includeRules: [
      "UseCaseDefinition",
      "UseCaseUsage",
      "IncludeUseCaseUsage",
      "ActorUsage",
      "ActorDefinition",
      "SubjectUsage",
      "Package",
    ],
  },
  Requirement: {
    label: "Requirement Diagram",
    description: "Requirements, concerns, constraints, and satisfy/verify relations",
    includeRules: [
      "RequirementDefinition",
      "RequirementUsage",
      "SatisfyRequirementUsage",
      "VerifyRequirementUsage",
      "ConcernDefinition",
      "ConcernUsage",
      "ConstraintDefinition",
      "ConstraintUsage",
      "Package",
    ],
  },
  Parametric: {
    label: "Parametric Diagram",
    description: "Constraint blocks, calculations, attribute equations, and bindings",
    includeRules: [
      "ConstraintDefinition",
      "ConstraintUsage",
      "CalculationDefinition",
      "CalculationUsage",
      "AttributeUsage",
      "BindingConnectorAsUsage",
      "Package",
    ],
  },
  Package: {
    label: "Package Diagram",
    description: "Package containment, namespaces, and definition hierarchy",
    filter: (sym: any) =>
      sym.ruleName === "Package" ||
      sym.ruleName === "LibraryPackage" ||
      (typeof sym.ruleName === "string" && sym.ruleName.endsWith("Definition")),
  },
  Sequence: {
    label: "Sequence Diagram",
    description: "Lifeline participants, message flows, and synchronous/asynchronous calls",
    includeRules: [
      "PartDefinition",
      "PartUsage",
      "ActionDefinition",
      "ActionUsage",
      "FlowConnectionUsage",
      "SuccessionFlowUsage",
      "SuccessionAsUsage",
      "SendActionNode",
      "AcceptActionNode",
      "Package",
    ],
    defaultLayout: "sequence",
  },
};

export const sysml2StructuralKinds = new Set([
  "PartUsage",
  "PartDefinition",
  "ActionDefinition",
  "ActionUsage",
  "ItemDefinition",
  "ItemUsage",
  "RequirementDefinition",
  "RequirementUsage",
  "ConstraintDefinition",
  "ConstraintUsage",
  "CalculationDefinition",
  "CalculationUsage",
  "VerificationCaseDefinition",
  "VerificationCaseUsage",
  "StateDefinition",
  "StateUsage",
  "UseCaseDefinition",
  "UseCaseUsage",
  "CaseDefinition",
  "CaseUsage",
  "AnalysisCaseDefinition",
  "AnalysisCaseUsage",
  "ConcernDefinition",
  "ConcernUsage",
  "PortDefinition",
  "PortUsage",
  "ActorDefinition",
  "ActorUsage",
  "InterfaceDefinition",
  "FlowDefinition",
  "AllocationDefinition",
  "OccurrenceDefinition",
  "OccurrenceUsage",
  "ViewDefinition",
  "ViewUsage",
  "ViewpointDefinition",
  "ViewpointUsage",
  "RenderingDefinition",
  "RenderingUsage",
  "EnumerationDefinition",
]);

export const sysml2StandaloneChildKinds = new Set([
  "PartUsage",
  "PartDefinition",
  "PortUsage",
  "PortDefinition",
  "ActorUsage",
  "StakeholderUsage",
]);

export const sysml2UsageKinds = new Set([
  "PartUsage",
  "ItemUsage",
  "PortUsage",
  "ActionUsage",
  "StateUsage",
  "ConstraintUsage",
  "RequirementUsage",
  "CalculationUsage",
  "AttributeUsage",
  "ConnectionUsage",
  "OccurrenceUsage",
  "ReferenceUsage",
]);

export const sysml2DefinitionKinds = new Set([
  "PartDefinition",
  "ItemDefinition",
  "PortDefinition",
  "ActionDefinition",
  "StateDefinition",
  "ConstraintDefinition",
  "RequirementDefinition",
  "CalculationDefinition",
  "AttributeDefinition",
  "ConnectionDefinition",
  "OccurrenceDefinition",
  "InterfaceDefinition",
  "AllocationDefinition",
  "FlowDefinition",
  "UseCaseDefinition",
  "AnalysisCaseDefinition",
  "VerificationCaseDefinition",
  "ViewDefinition",
  "ViewpointDefinition",
]);

export const sysml2TypingRules = ["OwnedFeatureTyping", "FeatureTyping"];
export const sysml2SubclassificationRules = ["OwnedSubclassification"];
export const sysml2SubsettingRules = ["OwnedSubsetting"];
export const sysml2RedefinitionRules = ["OwnedRedefinition"];

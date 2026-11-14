// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * @modelscript/sysml2 — SysML v2 Language Definition
 *
 * Declarative language definition composing Xtext-derived GLR grammar rules,
 * Salsa semantic queries, formal verification lints, and diagram graphics.
 */

import { sysml2Actions } from "./actions.js";
import { sysmlEdgeGraphics, sysmlGroupGraphics, sysmlNodeGraphics, sysmlUsageGraphics } from "./graphics.js";
import { sysml2TabularConfig } from "./tabular.js";
import { sysml2PolyglotConfig } from "./tgg.js";
import { sysml2Writeback } from "./writeback.js";

import {
  SysmlRuleSelf,
  allocationQueries,
  calculationDefinitionModel,
  calculationQueries,
  calculationUsageModel,
  calculationUsageQueries,
  constraintDefinitionModel,
  constraintDefinitionQueries,
  constraintUsageModel,
  constraintUsageQueries,
  defAttrs,
  definitionModel,
  definitionStructuralQueries,
  importModel,
  packageTraceabilityModel,
  packageTraceabilityQueries,
  requirementDefinitionModel,
  requirementQueries,
  requirementUsageModel,
  requirementUsageQueries,
  satisfyRequirementModel,
  satisfyRequirementQueries,
  stateDefinitionModel,
  stateQueries,
  stateUsageModel,
  usageAttrs,
  usageModel,
  usageQueries,
  verificationCaseDefinitionModel,
  verificationCaseQueries,
  verificationCaseUsageModel,
  verificationCaseUsageQueries,
} from "./queries.js";

import {
  actionDefinitionLints,
  actionUsageLints,
  allocationLints,
  bindingConnectorLints,
  calculationDefinitionLints,
  calculationUsageLints,
  connectionLints,
  constraintDefinitionLints,
  constraintUsageLintRules,
  definitionLints,
  enumValueLints,
  flowLints,
  importLints,
  packageTraceabilityLints,
  requirementDefinitionLintsEnhanced,
  requirementUsageLintsEnhanced,
  satisfyRequirementLints,
  stateDefinitionLints,
  stateUsageLints,
  transitionUsageLints,
  usageLints,
  verificationCaseDefinitionLints,
  verificationCaseUsageLints,
  verifyRequirementLints,
  viewDefinitionLints,
  viewUsageLints,
} from "./lints.js";

export * from "./graphics.js";
export * from "./lints.js";
export * from "./queries.js";

import {
  choice,
  def,
  domain,
  error,
  field,
  language,
  optional,
  prec,
  ref,
  repeat,
  repeat1,
  seq,
  token,
} from "@modelscript/dsl";
import type { QueryDB, SymbolEntry } from "@modelscript/runtime";
import { SysML2ErrorCode } from "./errors.js";

const PREC = {
  CONDITIONAL: 1,
  NULL_COALESCING: 2,
  IMPLIES: 3,
  OR: 4,
  XOR: 5,
  AND: 6,
  EQUALITY: 7,
  CLASSIFICATION: 8,
  RELATIONAL: 9,
  RANGE: 10,
  ADDITIVE: 11,
  MULTIPLICATIVE: 12,
  EXPONENTIATION: 13,
  UNARY: 14,
  EXTENT: 15,
  PRIMARY: 16,
} as const;

export const sysml2Language = language({
  name: "sysml2",
  displayName: "SysML v2",
  fileExtensions: [".sysml", ".sysml2", ".kerml"],
  maturity: "stable",

  lsp: {
    fileExtensions: [".sysml", ".sysml2", ".kerml"],
    icons: {
      light: "./assets/sysml2/icon-light.png",
      dark: "./assets/sysml2/icon-dark.png",
    },
  },

  writeback: sysml2Writeback,

  // Configure background SMT theories (Linear Real Arithmetic + Equality with Uninterpreted Functions)
  semantics: {
    reasoner: {
      smt: {
        theories: ["LRA", "EUF"],
        maxSimplexVars: 500,
      },
    } as unknown as { maxFacts?: number | undefined },
  },

  // Relational Octagon abstract domain (±x ± y <= c) for static interval and difference bound analysis
  domains: {
    bounds: domain.octagon(),
  },

  // Control-flow graph (CFG) node descriptors for activity and state-machine static analysis
  cfgNodes: {
    IfNode: {
      condition: "condition",
      trueBranch: "thenBody",
      falseBranch: "elseBody",
    },
    WhileLoopNode: {
      condition: "condition",
      trueBranch: "ActionBodyParameter",
      isLoop: true,
    },
    TransitionUsage: {
      condition: "guard",
      trueBranch: "effect",
    },
  },

  actions: sysml2Actions,

  mcp: {
    serverName: "sysml2-mcp",
    serverVersion: "1.0.0",
    tools: [
      {
        name: "sysml2_extract_topology",
        description: "Extracts physical connection and port topology from a SysML v2 part definition.",
        category: "ast",
        inputSchema: {
          name: { type: "string", description: "Fully qualified part name", required: true },
        },
      },
      {
        name: "sysml2_verify_requirements",
        description: "Evaluates requirement satisfaction matrices and constraint checks across a SysML v2 model.",
        category: "query",
        inputSchema: {
          partName: { type: "string", description: "Part name to verify", required: true },
        },
      },
      {
        name: "hybrid_simulate",
        description: "Flatten and simulate a hybrid SysML v2 / Modelica system.",
        category: "simulation",
        inputSchema: {
          name: { type: "string", description: "Fully qualified part/class name to simulate", required: true },
          paths: {
            type: "array",
            description: "Paths to load into UnifiedWorkspace",
            required: true,
            items: { type: "string" },
          },
          startTime: { type: "number", description: "Simulation start time", default: 0 },
          stopTime: { type: "number", description: "Simulation stop time", default: 10 },
        },
      },
    ],
    resources: [
      {
        uriTemplate: "sysml2://workspace/{partName}/topology",
        name: "SysML2 Topology Resource",
        mimeType: "application/json",
        description: "Directed port-connection topology graph of a SysML v2 part",
      },
    ],
    prompts: [
      {
        name: "sysml2_trace_requirements",
        description: "Trace requirements from high-level system requirements down to behavioral parts",
        arguments: [{ name: "requirementId", description: "Target requirement ID", required: true }],
        template: (args: Record<string, string>) => `Trace requirements from ${args["requirementId"]}`,
      },
    ],
  },

  primitives: {
    nestedComment: { open: "/*", close: "*/" },
    lineComment: "//",
  },

  extras: (_$) => [/\s/],

  conflicts: ($) => [
    [$["LiteralInteger"]!, $["RealValue"]!],
    [$["FeatureReferenceMember"]!, $["ElementReferenceMember"]!, $["OwnedFeatureChaining"]!],
    [$["Qualification"]!],
    [$["_FeatureChain"]!],
    [$["_postfix_operation"]!],
    [$["MeasurementExpression"]!, $["PrimaryExpression"]!],
    // All definition and usage rules share modifier keyword prefixes
    [
      $["DefaultReferenceUsage"]!,
      $["ReferenceUsage"]!,
      $["AttributeDefinition"]!,
      $["AttributeUsage"]!,
      $["EnumerationDefinition"]!,
      $["EnumerationUsage"]!,
      $["EnumeratedValue"]!,
      $["OccurrenceDefinition"]!,
      $["OccurrenceUsage"]!,
      $["ItemDefinition"]!,
      $["ItemUsage"]!,
      $["PartDefinition"]!,
      $["PartUsage"]!,
      $["PortDefinition"]!,
      $["PortUsage"]!,
      $["ConnectionDefinition"]!,
      $["ConnectionUsage"]!,
      $["InterfaceDefinition"]!,
      $["InterfaceUsage"]!,
      $["AllocationDefinition"]!,
      $["AllocationUsage"]!,
      $["FlowDefinition"]!,
      $["FlowUsage"]!,
      $["SuccessionFlowUsage"]!,
      $["BindingConnectorAsUsage"]!,
      $["SuccessionAsUsage"]!,
      $["ActionDefinition"]!,
      $["ActionUsage"]!,
      $["PerformActionUsage"]!,
      $["CalculationDefinition"]!,
      $["CalculationUsage"]!,
      $["ConstraintDefinition"]!,
      $["ConstraintUsage"]!,
      $["AssertConstraintUsage"]!,
      $["RequirementDefinition"]!,
      $["RequirementUsage"]!,
      $["SatisfyRequirementUsage"]!,
      $["ConcernDefinition"]!,
      $["ConcernUsage"]!,
      $["CaseDefinition"]!,
      $["CaseUsage"]!,
      $["AnalysisCaseDefinition"]!,
      $["AnalysisCaseUsage"]!,
      $["VerificationCaseDefinition"]!,
      $["VerificationCaseUsage"]!,
      $["UseCaseDefinition"]!,
      $["UseCaseUsage"]!,
      $["IncludeUseCaseUsage"]!,
      $["StateDefinition"]!,
      $["StateUsage"]!,
      $["ExhibitStateUsage"]!,
      $["ViewDefinition"]!,
      $["ViewUsage"]!,
      $["ViewpointDefinition"]!,
      $["ViewpointUsage"]!,
      $["RenderingDefinition"]!,
      $["RenderingUsage"]!,
      $["MetadataDefinition"]!,
      $["MergeNode"]!,
      $["DecisionNode"]!,
      $["JoinNode"]!,
      $["ForkNode"]!,
      $["AcceptActionNode"]!,
      $["SendActionNode"]!,
      $["AssignActionNode"]!,
      $["VerifyRequirementUsage"]!,
      $["ObjectiveRequirementUsage"]!,
    ],
    [$["_usage_modifier"]!, $["ReferenceUsage"]!],
    [$["PrefixMetadataAnnotation"]!, $["PrefixMetadataMember"]!],
    [$["OwnedReferenceSubsetting"]!, $["OwnedFeatureChaining"]!],
    [$["OwnedFeatureTyping"]!, $["OwnedFeatureChaining"]!],
    [$["OwnedSubsetting"]!, $["OwnedFeatureChaining"]!],
    [$["OwnedSubclassification"]!, $["OwnedSubsetting"]!, $["OwnedFeatureChaining"]!],
    [$["OwnedSubclassification"]!, $["OwnedFeatureChaining"]!],
    [$["OwnedRedefinition"]!, $["OwnedFeatureChaining"]!],
    [$["OwnedCrossSubsetting"]!, $["OwnedFeatureChaining"]!],
    [$["Qualification"]!, $["QualifiedName"]!],
    [$["_FeatureSpecializationPart"]!],
    [$["_SubclassificationPart"]!, $["_FeatureSpecializationPart"]!],
    [$["_SubclassificationPart"]!, $["_Subsettings"]!],
    [$["MetadataUsage"]!, $["ClassificationTestOperator"]!],
    [$["_Identification"]!, $["QualifiedName"]!],
    [$["_Identification"]!],
    [$["_ActionBody"]!, $["StateActionUsage"]!],
    [$["_ActionBodyItem"]!, $["_CalculationBody"]!],
    [$["FeatureReferenceMember"]!, $["InstantiatedTypeMember"]!],
    // GLR lookahead ambiguities whitelisted for SysML v2 grammar
    [$["_VisibilityIndicator"]!, $["_PrefixMetadataMember"]!],
    [$["_VisibilityIndicator"]!, $["_EmptySuccessionMember"]!, $["_PrefixMetadataMember"]!],
    [$["_VisibilityIndicator"]!, $["_EmptySuccessionMember"]!],
    [$["_VisibilityIndicator"]!, $["_PrefixMetadataAnnotation"]!],
    [$["_VisibilityIndicator"]!, $["ReferenceUsage"]!],
    [$["_VisibilityIndicator"]!, $["Comment"]!],
    [$["_VisibilityIndicator"]!, $["Documentation"]!],
    [$["_usage_modifier"]!, $["PrefixMetadataAnnotation"]!],
    [$["_usage_modifier"]!, $["_PrefixMetadataAnnotation"]!],
    [$["_usage_modifier"]!, $["GlobalQualification"]!],
    [$["_usage_modifier"]!, $["_GlobalQualification"]!],
    [$["_usage_modifier"]!, $["UnaryOperator"]!],
    [$["_usage_modifier"]!, $["MultiplicityRange"]!],
    [$["_usage_modifier"]!, $["UsageDeclaration"]!],
    [$["_usage_modifier"]!, $["_UsageDeclaration"]!],
    [$["_usage_modifier"]!, $["_Redefinitions"]!],
    [$["_usage_modifier"]!, $["_Subsettings"]!],
    [$["_usage_modifier"]!, $["_References"]!],
    [$["_usage_modifier"]!, $["_Crosses"]!],
    [$["_usage_modifier"]!, $["_Typings"]!],
    [$["_usage_modifier"]!, $["OwnedRedefinition"]!],
    [$["_usage_modifier"]!, $["OwnedSubsetting"]!],
    [$["_usage_modifier"]!, $["OwnedMultiplicity"]!],
    [$["_usage_modifier"]!, $["EnumerationUsage"]!],
    [$["_usage_modifier"]!, $["EnumeratedValue"]!],
    [$["_usage_modifier"]!, $["EnumerationDefinition"]!, $["EnumerationUsage"]!],
    [$["_usage_modifier"]!, $["AssertConstraintUsage"]!, $["ConstraintUsage"]!],
    [$["_usage_modifier"]!, $["ConstraintDefinition"]!, $["ConstraintUsage"]!, $["AssertConstraintUsage"]!],
    [
      $["_usage_modifier"]!,
      $["_Typings"]!,
      $["_Subsettings"]!,
      $["_References"]!,
      $["_Crosses"]!,
      $["_Redefinitions"]!,
    ],
    [$["_usage_modifier"]!, $["_Identification"]!, $["Name"]!, $["ID"]!, $["UNRESTRICTED_NAME"]!],
    [$["Comment"]!],
    [$["Comment"]!, $["REGULAR_COMMENT"]!, $["STRING_VALUE"]!],
    [$["Documentation"]!],
    [$["Documentation"]!, $["REGULAR_COMMENT"]!, $["STRING_VALUE"]!],
    [$["TextualRepresentation"]!],
    [$["TextualRepresentation"]!, $["Comment"]!],
    [$["TextualRepresentation"]!, $["REGULAR_COMMENT"]!, $["STRING_VALUE"]!],
    [$["_Identification"]!, $["ID"]!, $["UNRESTRICTED_NAME"]!],
    [$["_Identification"]!, $["Name"]!, $["ID"]!, $["UNRESTRICTED_NAME"]!],
    [
      $["_Identification"]!,
      $["GlobalQualification"]!,
      $["_GlobalQualification"]!,
      $["MultiplicityRange"]!,
      $["ID"]!,
      $["UNRESTRICTED_NAME"]!,
    ],
    [$["_Identification"]!, $["MultiplicityRange"]!],
    [$["_Identification"]!, $["_FeatureSpecializationPart"]!],
    [$["_Identification"]!, $["FeatureSpecializationPart"]!],
    [$["_Identification"]!, $["Dependency"]!],
    [$["MultiplicityRange"]!, $["_FeatureSpecializationPart"]!],
    [$["MultiplicityRange"]!, $["_UsageDeclaration"]!, $["ID"]!, $["UNRESTRICTED_NAME"]!],
    [$["MultiplicityRange"]!, $["OwnedMultiplicity"]!],
    [$["_MultiplicityPart"]!],
    [$["_MultiplicityPart"]!, $["OwnedMultiplicity"]!],
    [$["OwnedMultiplicity"]!],
    [$["Name"]!, $["ID"]!, $["UNRESTRICTED_NAME"]!],
    [
      $["GlobalQualification"]!,
      $["_GlobalQualification"]!,
      $["OwnedReferenceSubsetting"]!,
      $["ID"]!,
      $["UNRESTRICTED_NAME"]!,
    ],
    [$["GlobalQualification"]!, $["OwnedReferenceSubsetting"]!],
    [$["_GlobalQualification"]!, $["OwnedReferenceSubsetting"]!],
    [$["_GlobalQualification"]!, $["_PrefixMetadataAnnotation"]!, $["_usage_modifier"]!],
    [$["OwnedReferenceSubsetting"]!],
    [$["PayloadFeature"]!, $["FlowEndMember"]!],
    [$["TransitionUsage"]!, $["_UsageDeclaration"]!, $["ID"]!, $["UNRESTRICTED_NAME"]!],
    // Binary & arithmetic operator associativity/precedence lookahead groups
    [
      $["MultiplicativeExpression"]!,
      $["AdditiveExpression"]!,
      $["RelationalExpression"]!,
      $["EqualityExpression"]!,
      $["ClassificationTestExpression"]!,
      $["CastExpression"]!,
      $["ExponentiationExpression"]!,
      $["XorExpression"]!,
      $["ImpliesExpression"]!,
      $["AndExpression"]!,
      $["OrExpression"]!,
      $["OwnedExpression"]!,
      $["CastOperator"]!,
      $["MultiplicativeOperator"]!,
      $["AdditiveOperator"]!,
      $["RelationalOperator"]!,
      $["EqualityOperator"]!,
      $["ExponentiationOperator"]!,
      $["ClassificationTestOperator"]!,
    ],
  ],

  word: ($) => $["ID"]!,

  rules: {
    // =====================================================================
    // ROOT
    // =====================================================================

    RootNamespace: ($) => repeat($["_PackageBodyElement"]!),

    _PackageBodyElement: ($) =>
      choice($["PackageMember"]!, $["ElementFilterMember"]!, $["AliasMember"]!, $["Import"]!, $["AnnotatingMember"]!),

    // =====================================================================
    // BASIC ELEMENTS
    // =====================================================================

    _Identification: ($) =>
      choice(
        seq("<", field("declaredShortName", $["Name"]!), ">", optional(field("declaredName", $["Name"]!))),
        field("declaredName", $["Name"]!),
      ),

    _RelationshipBody: ($) => choice(";", seq("{", repeat($["OwnedAnnotation"]!), "}")),

    // =====================================================================
    // VISIBILITY
    // =====================================================================

    VisibilityIndicator: () => choice("public", "private", "protected"),

    // =====================================================================
    // DEPENDENCIES
    // =====================================================================

    Dependency: ($) =>
      seq(
        repeat($["PrefixMetadataAnnotation"]!),
        "dependency",
        optional(seq(optional($["_Identification"]!), "from")),
        field("client", $["QualifiedName"]!),
        repeat(seq(",", field("client", $["QualifiedName"]!))),
        "to",
        field("supplier", $["QualifiedName"]!),
        repeat(seq(",", field("supplier", $["QualifiedName"]!))),
        $["_RelationshipBody"]!,
      ),

    // =====================================================================
    // ANNOTATIONS
    // =====================================================================

    Annotation: ($) =>
      ref({
        syntax: field("annotatedElement", $["QualifiedName"]!),
        name: (self) => self.annotatedElement,
        targetKinds: ["Element"],
        resolve: "qualified",
      }),

    OwnedAnnotation: ($) => field("ownedRelatedElement", $["_AnnotatingElement"]!),

    AnnotatingMember: ($) => field("ownedRelatedElement", $["_AnnotatingElement"]!),

    _AnnotatingElement: ($) =>
      choice($["Comment"]!, $["Documentation"]!, $["TextualRepresentation"]!, $["MetadataUsage"]!),

    Comment: ($) =>
      seq(
        choice(
          seq(
            "comment",
            optional($["_Identification"]!),
            optional(seq("about", $["Annotation"]!, repeat(seq(",", $["Annotation"]!)))),
            optional(seq("locale", field("locale", $["STRING_VALUE"]!))),
            optional(field("body", choice($["REGULAR_COMMENT"]!, $["STRING_VALUE"]!))),
          ),
          seq(
            optional(seq("locale", field("locale", $["STRING_VALUE"]!))),
            field("body", choice($["REGULAR_COMMENT"]!, $["STRING_VALUE"]!)),
          ),
        ),
        optional(";"),
      ),

    Documentation: ($) =>
      seq(
        choice(
          seq(
            "doc",
            optional($["_Identification"]!),
            optional(seq("locale", field("locale", $["STRING_VALUE"]!))),
            field("body", choice($["REGULAR_COMMENT"]!, $["STRING_VALUE"]!)),
          ),
          seq(
            "doc",
            optional(seq("<", field("declaredShortName", $["Name"]!), ">")),
            optional(seq("locale", field("locale", $["STRING_VALUE"]!))),
          ),
        ),
        optional(";"),
      ),

    TextualRepresentation: ($) =>
      seq(
        optional(seq("rep", optional($["_Identification"]!))),
        "language",
        field("language", $["STRING_VALUE"]!),
        optional(field("body", choice($["REGULAR_COMMENT"]!, $["STRING_VALUE"]!))),
        optional(";"),
      ),

    // =====================================================================
    // METADATA
    // =====================================================================

    PrefixMetadataAnnotation: ($) => seq("#", field("ownedRelatedElement", $["PrefixMetadataUsage"]!)),

    PrefixMetadataMember: ($) => seq("#", field("ownedRelatedElement", $["PrefixMetadataUsage"]!)),

    PrefixMetadataUsage: ($) => field("ownedRelationship", $["MetadataTyping"]!),

    MetadataUsage: ($) =>
      def({
        syntax: seq(
          repeat($["PrefixMetadataMember"]!),
          choice("metadata", "@"),
          optional(seq(optional($["_Identification"]!), optional(seq(choice(":", seq("defined", "by")))))),
          field("ownedRelationship", $["MetadataTyping"]!),
          optional(seq("about", $["Annotation"]!, repeat(seq(",", $["Annotation"]!)))),
          $["_MetadataBody"]!,
        ),
        symbol: usageAttrs("metadata"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    MetadataTyping: ($) =>
      ref({
        syntax: field("type", $["QualifiedName"]!),
        name: (self) => self.type,
        targetKinds: ["Metaclass"],
        resolve: "qualified",
      }),

    _MetadataBody: ($) =>
      choice(
        ";",
        seq(
          "{",
          repeat(choice($["DefinitionMember"]!, $["MetadataBodyUsageMember"]!, $["AliasMember"]!, $["Import"]!)),
          "}",
        ),
      ),

    MetadataBodyUsageMember: ($) => field("ownedRelatedElement", $["MetadataBodyUsage"]!),

    MetadataBodyUsage: ($) =>
      seq(
        optional("ref"),
        optional(choice(":>>", "redefines")),
        field("ownedRelationship", $["OwnedRedefinition"]!),
        optional($["_FeatureSpecializationPart"]!),
        optional($["_ValuePart"]!),
        $["_MetadataBody"]!,
      ),

    MetadataDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "metadata", "def", $["_Definition"]!),
        symbol: defAttrs("metadata"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
      }),

    // =====================================================================
    // PACKAGES
    // =====================================================================

    Package: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "package",
          optional($["_Identification"]!),
          field("body", $["_PackageBody"]!),
        ),
        symbol: (self: SysmlRuleSelf) => ({
          kind: "Package",
          name: self.declaredName,
          exports: ["body"],
        }),
        queries: packageTraceabilityQueries,
        model: packageTraceabilityModel,
        lints: packageTraceabilityLints,
        graphics: () => sysmlGroupGraphics({ fill: "#f8fafc", stroke: "#475569", tabText: "package" }),
      }),

    LibraryPackage: ($) =>
      def({
        syntax: seq(
          optional(field("isStandard", "standard")),
          "library",
          repeat($["_usage_modifier"]!),
          "package",
          optional($["_Identification"]!),
          field("body", $["_PackageBody"]!),
        ),
        symbol: (self: SysmlRuleSelf) => ({
          kind: "Package",
          name: self.declaredName,
          exports: ["body"],
          attributes: { isStandard: self.isStandard },
        }),
        queries: packageTraceabilityQueries,
        model: packageTraceabilityModel,
        lints: packageTraceabilityLints,
        graphics: () => sysmlGroupGraphics({ fill: "#f8fafc", stroke: "#475569", tabText: "library" }),
      }),

    _PackageBody: ($) => choice(";", seq("{", repeat($["_PackageBodyElement"]!), "}")),

    PackageMember: ($) =>
      seq(
        optional($["VisibilityIndicator"]!),
        choice(
          field("ownedRelatedElement", $["_DefinitionElement"]!),
          field("ownedRelatedElement", $["_UsageElement"]!),
        ),
      ),

    ElementFilterMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), "filter", field("ownedRelatedElement", $["OwnedExpression"]!), ";"),

    AliasMember: ($) =>
      def({
        syntax: seq(
          optional($["VisibilityIndicator"]!),
          "alias",
          optional(seq("<", field("memberShortName", $["Name"]!), ">")),
          optional(field("memberName", $["Name"]!)),
          "for",
          ref({
            syntax: field("memberElement", $["QualifiedName"]!),
            name: (self) => self.memberElement,
            targetKinds: ["Element"],
            resolve: "qualified",
          }),
          $["_RelationshipBody"]!,
        ),
        symbol: (self) => ({ kind: "Alias", name: self.memberName }),
        model: {
          name: "AliasNode" as const,
          visitable: true,
        },
      }),

    // =====================================================================
    // IMPORTS
    // =====================================================================

    _ImportPrefix: ($) => seq(optional($["VisibilityIndicator"]!), "import", optional(field("isImportAll", "all"))),

    Import: ($) => seq(choice($["MembershipImport"]!, $["NamespaceImport"]!), $["_RelationshipBody"]!),

    MembershipImport: ($) =>
      def({
        syntax: seq($["_ImportPrefix"]!, $["_ImportedMembership"]!),
        symbol: (self) => ({
          kind: "Import",
          name: self.importedMembership,
          attributes: {
            isImportAll: self.isImportAll,
            isRecursive: self.isRecursive,
          },
        }),
        model: importModel,
        lints: importLints,
      }),

    _ImportedMembership: ($) =>
      seq(
        ref({
          syntax: field("importedMembership", $["QualifiedName"]!),
          name: (self) => self.importedMembership,
          targetKinds: ["Membership"],
          resolve: "qualified",
        }),
        optional(seq("::", field("isRecursive", "**"))),
      ),

    NamespaceImport: ($) =>
      def({
        syntax: seq(
          $["_ImportPrefix"]!,
          choice($["_ImportedNamespace"]!, field("ownedRelatedElement", $["FilterPackage"]!)),
        ),
        symbol: (self: SysmlRuleSelf) => ({
          kind: "Import",
          name: self.importedNamespace,
          attributes: {
            isImportAll: self.isImportAll,
            isRecursive: self.isRecursive,
          },
        }),
        model: importModel,
        lints: importLints,
      }),

    _ImportedNamespace: ($) =>
      seq(
        ref({
          syntax: field("importedNamespace", $["QualifiedName"]!),
          name: (self) => self.importedNamespace,
          targetKinds: ["Namespace"],
          resolve: "qualified",
        }),
        "::",
        "*",
        optional(seq("::", field("isRecursive", "**"))),
      ),

    FilterPackage: ($) => seq($["FilterPackageImport"]!, repeat1($["FilterPackageMember"]!)),

    FilterPackageImport: ($) => choice($["FilterPackageMembershipImport"]!, $["FilterPackageNamespaceImport"]!),

    FilterPackageMembershipImport: ($) => $["_ImportedMembership"]!,
    FilterPackageNamespaceImport: ($) => $["_ImportedNamespace"]!,

    FilterPackageMember: ($) => seq("[", field("ownedRelatedElement", $["OwnedExpression"]!), "]"),

    // =====================================================================
    // DEFINITION & USAGE ELEMENTS (dispatch)
    // =====================================================================

    _DefinitionElement: ($) =>
      choice(
        $["Package"]!,
        $["LibraryPackage"]!,
        $["Dependency"]!,
        $["AttributeDefinition"]!,
        $["EnumerationDefinition"]!,
        $["OccurrenceDefinition"]!,
        $["ItemDefinition"]!,
        $["MetadataDefinition"]!,
        $["PartDefinition"]!,
        $["ConnectionDefinition"]!,
        $["FlowDefinition"]!,
        $["InterfaceDefinition"]!,
        $["AllocationDefinition"]!,
        $["PortDefinition"]!,
        $["ActionDefinition"]!,
        $["CalculationDefinition"]!,
        $["StateDefinition"]!,
        $["ConstraintDefinition"]!,
        $["RequirementDefinition"]!,
        $["ConcernDefinition"]!,
        $["CaseDefinition"]!,
        $["AnalysisCaseDefinition"]!,
        $["VerificationCaseDefinition"]!,
        $["UseCaseDefinition"]!,
        $["ViewDefinition"]!,
        $["ViewpointDefinition"]!,
        $["RenderingDefinition"]!,
      ),

    _UsageElement: ($) => choice($["_NonOccurrenceUsageElement"]!, $["_OccurrenceUsageElement"]!),

    _NonOccurrenceUsageElement: ($) =>
      choice(
        $["DefaultReferenceUsage"]!,
        $["ReferenceUsage"]!,
        $["AttributeUsage"]!,
        $["EnumerationUsage"]!,
        $["BindingConnectorAsUsage"]!,
        $["SuccessionAsUsage"]!,
      ),

    _OccurrenceUsageElement: ($) => choice($["_StructureUsageElement"]!, $["_BehaviorUsageElement"]!),

    _StructureUsageElement: ($) =>
      choice(
        $["OccurrenceUsage"]!,
        $["ItemUsage"]!,
        $["PartUsage"]!,
        $["PortUsage"]!,
        $["ConnectionUsage"]!,
        $["InterfaceUsage"]!,
        $["AllocationUsage"]!,
        $["FlowUsage"]!,
        $["SuccessionFlowUsage"]!,
        $["ViewUsage"]!,
        $["RenderingUsage"]!,
      ),

    _BehaviorUsageElement: ($) =>
      choice(
        $["ActionUsage"]!,
        $["CalculationUsage"]!,
        $["StateUsage"]!,
        $["ConstraintUsage"]!,
        $["RequirementUsage"]!,
        $["ConcernUsage"]!,
        $["CaseUsage"]!,
        $["AnalysisCaseUsage"]!,
        $["VerificationCaseUsage"]!,
        $["UseCaseUsage"]!,
        $["ViewpointUsage"]!,
        $["PerformActionUsage"]!,
        $["ExhibitStateUsage"]!,
        $["IncludeUseCaseUsage"]!,
        $["AssertConstraintUsage"]!,
        $["SatisfyRequirementUsage"]!,
      ),

    // =====================================================================
    // CLASSIFIERS — Subclassification
    // =====================================================================

    _SubclassificationPart: ($) =>
      seq(choice(":>", "specializes"), $["OwnedSubclassification"]!, repeat(seq(",", $["OwnedSubclassification"]!))),

    OwnedSubclassification: ($) =>
      ref({
        syntax: field("superclassifier", $["QualifiedName"]!),
        name: (self) => self.superclassifier,
        targetKinds: ["Classifier"],
        resolve: "qualified",
      }),

    // =====================================================================
    // FEATURES
    // =====================================================================

    _FeatureDeclaration: ($) =>
      choice(seq($["_Identification"]!, optional($["_FeatureSpecializationPart"]!)), $["_FeatureSpecializationPart"]!),

    _FeatureSpecializationPart: ($) => repeat1(choice($["_FeatureSpecialization"]!, $["_MultiplicityPart"]!)),

    _MultiplicityPart: ($) =>
      choice(
        $["OwnedMultiplicity"]!,
        seq(
          optional($["OwnedMultiplicity"]!),
          choice(
            seq(field("isOrdered", "ordered"), optional(field("isNonunique", "nonunique"))),
            seq(field("isNonunique", "nonunique"), optional(field("isOrdered", "ordered"))),
          ),
        ),
      ),

    _FeatureSpecialization: ($) =>
      choice($["_Typings"]!, $["_Subsettings"]!, $["_References"]!, $["_Crosses"]!, $["_Redefinitions"]!),

    _Typings: ($) => seq(choice(":", seq("defined", "by")), $["FeatureTyping"]!, repeat(seq(",", $["FeatureTyping"]!))),

    _Subsettings: ($) =>
      seq(choice(":>", "subsets", "subset"), $["OwnedSubsetting"]!, repeat(seq(",", $["OwnedSubsetting"]!))),

    _References: ($) => seq(choice("::>", "references", "reference"), $["OwnedReferenceSubsetting"]!),

    _Crosses: ($) => seq(choice("=>", "crosses"), $["OwnedCrossSubsetting"]!),

    _Redefinitions: ($) =>
      seq(choice(":>>", "redefines", "redefine"), $["OwnedRedefinition"]!, repeat(seq(",", $["OwnedRedefinition"]!))),

    FeatureTyping: ($) => choice($["OwnedFeatureTyping"]!, $["ConjugatedPortTyping"]!),

    OwnedFeatureTyping: ($) =>
      choice(
        ref({
          syntax: field("type", $["QualifiedName"]!),
          name: (self) => self.type,
          targetKinds: ["Type"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $["OwnedFeatureChain"]!),
      ),

    OwnedSubsetting: ($) =>
      choice(
        ref({
          syntax: field("subsettedFeature", $["QualifiedName"]!),
          name: (self) => self.subsettedFeature,
          targetKinds: ["Feature"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $["OwnedFeatureChain"]!),
      ),

    OwnedReferenceSubsetting: ($) =>
      choice(
        ref({
          syntax: field("referencedFeature", $["QualifiedName"]!),
          name: (self) => self.referencedFeature,
          targetKinds: ["Feature"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $["OwnedFeatureChain"]!),
      ),

    OwnedCrossSubsetting: ($) =>
      choice(
        ref({
          syntax: field("crossedFeature", $["QualifiedName"]!),
          name: (self) => self.crossedFeature,
          targetKinds: ["Feature"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $["OwnedFeatureChain"]!),
      ),

    OwnedRedefinition: ($) =>
      choice(
        ref({
          syntax: field("redefinedFeature", $["QualifiedName"]!),
          name: (self) => self.redefinedFeature,
          targetKinds: ["Feature"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $["OwnedFeatureChain"]!),
      ),

    // =====================================================================
    // MULTIPLICITY
    // =====================================================================

    OwnedMultiplicity: ($) => field("ownedRelatedElement", $["MultiplicityRange"]!),

    MultiplicityRange: ($) =>
      seq(
        "[",
        field("lowerBound", $["MultiplicityExpressionMember"]!),
        optional(seq("..", field("upperBound", $["MultiplicityExpressionMember"]!))),
        "]",
      ),

    MultiplicityExpressionMember: ($) =>
      field("ownedRelatedElement", choice($["_LiteralExpression"]!, $["FeatureReferenceExpression"]!)),

    // =====================================================================
    // DEFINITIONS
    // =====================================================================

    _Definition: ($) =>
      seq(optional($["_Identification"]!), optional($["_SubclassificationPart"]!), $["_DefinitionBody"]!),

    _DefinitionBody: ($) => choice(";", seq("{", repeat($["_DefinitionBodyItem"]!), "}")),

    _DefinitionBodyItem: ($) =>
      choice(
        $["DefinitionMember"]!,
        $["VariantUsageMember"]!,
        $["NonOccurrenceUsageMember"]!,
        seq(optional($["EmptySuccessionMember"]!), $["OccurrenceUsageMember"]!),
        $["AliasMember"]!,
        $["Import"]!,
        $["AnnotatingMember"]!,
      ),

    DefinitionMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["_DefinitionElement"]!)),

    VariantUsageMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), "variant", field("ownedRelatedElement", $["_UsageElement"]!)),

    NonOccurrenceUsageMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["_NonOccurrenceUsageElement"]!)),

    OccurrenceUsageMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["_OccurrenceUsageElement"]!)),

    // =====================================================================
    // USAGES
    // =====================================================================
    // Single shared modifier rule — avoids per-rule repeat() conflicts
    _usage_modifier: ($) =>
      choice(
        field("isEnd", "end"),
        field("direction", "in"),
        field("direction", "out"),
        field("direction", "inout"),
        field("isDerived", "derived"),
        field("isAbstract", "abstract"),
        field("isVariation", "variation"),
        field("isConstant", "constant"),
        field("isRef", "ref"),
        field("isRedefine", "redefine"),
        field("isRedefine", "redefines"),
        field("isSubsetting", "subset"),
        field("isSubsetting", "subsets"),
        "individual",
        "snapshot",
        "timeslice",
        $["PrefixMetadataMember"]!,
      ),

    _UsageDeclaration: ($) => $["_FeatureDeclaration"]!,

    _UsageCompletion: ($) => seq(optional($["_ValuePart"]!), $["_DefinitionBody"]!),

    _Usage: ($) => seq(optional($["_UsageDeclaration"]!), $["_UsageCompletion"]!),

    _ValuePart: ($) => $["FeatureValue"]!,

    FeatureValue: ($) =>
      seq(
        choice(
          "=",
          field("isInitial", ":="),
          seq(field("isDefault", "default"), optional(choice("=", field("isInitial", ":=")))),
        ),
        field("ownedRelatedElement", $["OwnedExpression"]!),
      ),

    // =====================================================================
    // REFERENCE USAGES
    // =====================================================================

    DefaultReferenceUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          $["_UsageDeclaration"]!,
          optional($["_ValuePart"]!),
          $["_DefinitionBody"]!,
        ),
        symbol: usageAttrs("ref"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    ReferenceUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "ref", $["_Usage"]!),
        symbol: usageAttrs("ref"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    // =====================================================================
    // ATTRIBUTES
    // =====================================================================

    AttributeDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "attribute", "def", $["_Definition"]!),
        symbol: defAttrs("attribute"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "attribute def", fill: "#fce4ec", stroke: "#e91e63" }),
      }),

    AttributeUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "attribute", $["_Usage"]!),
        symbol: usageAttrs("attribute"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "attribute", fill: "#fce4ec", stroke: "#f48fb1" }),
      }),

    // =====================================================================
    // ENUMERATIONS
    // =====================================================================

    EnumerationDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "enum",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          field("body", $["_EnumerationBody"]!),
        ),
        symbol: (self: SysmlRuleSelf) => ({ kind: "Enumeration", name: self.declaredName, exports: ["body"] }),
        queries: definitionStructuralQueries,
        model: {
          name: "EnumerationNode" as const,
          visitable: true,
          specializable: true,
          properties: { isAbstract: "boolean" as const },
          queryTypes: {
            members: "SemanticNode[]" as const,
            ownedDefinitions: "DefinitionNode[]" as const,
            ownedUsages: "UsageNode[]" as const,
            imports: "SemanticNode[]" as const,
          },
        },
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "enum def", fill: "#f3e5f5", stroke: "#7b1fa2" }),
      }),

    _EnumerationBody: ($) =>
      choice(";", seq("{", repeat(choice($["AnnotatingMember"]!, $["EnumerationUsageMember"]!)), "}")),

    EnumerationUsageMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["EnumeratedValue"]!)),

    EnumeratedValue: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), optional("enum"), $["_Usage"]!),
        symbol: (self) => ({ kind: "EnumerationValue", name: self.declaredName }),
        model: {
          name: "EnumerationValueNode" as const,
          visitable: true,
        },
        lints: enumValueLints,
      }),

    EnumerationUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "enum", $["_Usage"]!),
        symbol: usageAttrs("enumeration"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    // =====================================================================
    // OCCURRENCES
    // =====================================================================

    OccurrenceDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "occurrence", "def", $["_Definition"]!),
        symbol: defAttrs("occurrence"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "occurrence def", fill: "#f5f5f5", stroke: "#616161" }),
      }),

    OccurrenceUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "occurrence", $["_Usage"]!),
        symbol: usageAttrs("occurrence"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    // =====================================================================
    // ITEMS
    // =====================================================================

    ItemDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "item", "def", $["_Definition"]!),
        symbol: defAttrs("item"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "item def", fill: "#f0fdfa", stroke: "#0d9488" }),
      }),

    ItemUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "item", $["_Usage"]!),
        symbol: usageAttrs("item"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "item", fill: "#f0fdfa", stroke: "#14b8a6" }),
      }),

    PartDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "part", "def", $["_Definition"]!),
        symbol: defAttrs("part"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () =>
          sysmlNodeGraphics({ stereotype: "part def", fill: "#ecfdf5", stroke: "#059669", portQuery: "ownedPorts" }),
        diff: {
          ignore: ["annotationClause", "description"],
          breaking: ["isAbstract"],
        },
      }),

    PartUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "part", $["_Usage"]!),
        symbol: usageAttrs("part"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "part", fill: "#ecfdf5", stroke: "#10b981" }),
      }),

    // =====================================================================
    // PORTS
    // =====================================================================

    PortDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "port", "def", $["_Definition"]!),
        symbol: defAttrs("port"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "port def", fill: "#fff7ed", stroke: "#ea580c" }),
        diff: {
          ignore: ["annotationClause", "description"],
          breaking: ["direction"],
        },
      }),

    PortUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "port", $["_Usage"]!),
        symbol: usageAttrs("port"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => ({
          role: "port-owner" as const,
          node: {
            shape: "rect",
            markup: [
              { tagName: "rect", selector: "body" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { fill: "#ffffff", stroke: "#ea580c", strokeWidth: 1.5, rx: 0, ry: 0, width: 12, height: 12 },
              label: {
                text: "{{name}}",
                fill: "#334155",
                fontSize: 10,
                fontWeight: "500",
                refX: 0.5,
                refY: 18,
                textAnchor: "middle",
              },
            },
            size: { width: 12, height: 12 },
          },
        }),
      }),

    ConjugatedPortTyping: ($) =>
      seq(
        "~",
        ref({
          syntax: field("conjugatedPortDefinition", $["QualifiedName"]!),
          name: (self) => self.conjugatedPortDefinition,
          targetKinds: ["ConjugatedPortDefinition"],
          resolve: "qualified",
        }),
      ),

    // =====================================================================
    // CONNECTIONS
    // =====================================================================

    ConnectorEndMember: ($) => field("ownedRelatedElement", $["ConnectorEnd"]!),

    ConnectorEnd: ($) =>
      seq(
        optional(field("ownedRelationship", $["OwnedMultiplicity"]!)),
        optional(seq(field("declaredName", $["Name"]!), choice("::>", "references"))),
        $["OwnedReferenceSubsetting"]!,
      ),

    ConnectionDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "connection", "def", $["_Definition"]!),
        symbol: defAttrs("connection"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "connection def", fill: "#eceff1", stroke: "#546e7a" }),
      }),

    ConnectionUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          choice(
            seq(
              "connection",
              optional($["_UsageDeclaration"]!),
              optional($["_ValuePart"]!),
              optional(seq("connect", $["_ConnectorPart"]!)),
            ),
            seq("connect", $["_ConnectorPart"]!),
          ),
          $["_DefinitionBody"]!,
        ),
        symbol: usageAttrs("connection"),
        queries: usageQueries,
        model: usageModel,
        lints: connectionLints,
        graphics: () => sysmlEdgeGraphics({ stroke: "#546e7a", label: "«connect»", connector: "jumpover" }),
        diff: {
          identity: (self) => self.name || `connection_${self.id}`,
        },
      }),

    _ConnectorPart: ($) => choice($["_BinaryConnectorPart"]!, $["_NaryConnectorPart"]!),

    _BinaryConnectorPart: ($) => seq($["ConnectorEndMember"]!, "to", $["ConnectorEndMember"]!),

    _NaryConnectorPart: ($) =>
      seq(
        "(",
        $["ConnectorEndMember"]!,
        ",",
        $["ConnectorEndMember"]!,
        repeat(seq(",", $["ConnectorEndMember"]!)),
        ")",
      ),

    BindingConnectorAsUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          optional(seq("binding", optional($["_UsageDeclaration"]!))),
          "bind",
          $["ConnectorEndMember"]!,
          "=",
          $["ConnectorEndMember"]!,
          $["_DefinitionBody"]!,
        ),
        symbol: usageAttrs("binding"),
        queries: usageQueries,
        model: usageModel,
        lints: bindingConnectorLints,
        graphics: () => sysmlEdgeGraphics({ label: "«bind»", stroke: "#37474f", connector: "jumpover" }),
      }),

    SuccessionAsUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          optional(seq("succession", optional($["_UsageDeclaration"]!))),
          optional("first"),
          $["ConnectorEndMember"]!,
          "then",
          $["ConnectorEndMember"]!,
          optional(seq("if", field("guard", $["OwnedExpression"]!))),
          $["_DefinitionBody"]!,
        ),
        symbol: (self: SysmlRuleSelf) => ({
          ...usageAttrs("succession")(self),
          attributes: {
            ...usageAttrs("succession")(self).attributes,
            guard: self.guard,
          },
        }),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlEdgeGraphics({ label: "«succession»", stroke: "#455a64", strokeDasharray: "4 2" }),
      }),

    // =====================================================================
    // INTERFACES
    // =====================================================================

    InterfaceDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "interface",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_DefinitionBody"]!,
        ),
        symbol: defAttrs("interface"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "interface def", fill: "#e0f2f1", stroke: "#00695c" }),
      }),

    InterfaceUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "interface",
          optional($["_UsageDeclaration"]!),
          optional(seq("connect", $["_ConnectorPart"]!)),
          $["_DefinitionBody"]!,
        ),
        symbol: usageAttrs("interface"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlEdgeGraphics({ label: "«interface»", stroke: "#00695c" }),
      }),

    // =====================================================================
    // ALLOCATIONS
    // =====================================================================

    AllocationDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "allocation", "def", $["_Definition"]!),
        symbol: defAttrs("allocation"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "allocation def", fill: "#e8eaf6", stroke: "#283593" }),
      }),

    AllocationUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          choice(
            seq("allocation", optional($["_UsageDeclaration"]!), optional(seq("allocate", $["_ConnectorPart"]!))),
            seq("allocate", $["_ConnectorPart"]!),
          ),
          $["_DefinitionBody"]!,
        ),
        symbol: usageAttrs("allocation"),
        queries: allocationQueries,
        model: usageModel,
        lints: allocationLints,
        graphics: () => sysmlEdgeGraphics({ label: "«allocate»", stroke: "#283593", strokeDasharray: "6 3" }),
      }),

    // =====================================================================
    // FLOWS
    // =====================================================================

    FlowDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "flow", "def", $["_Definition"]!),
        symbol: defAttrs("flow"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "flow def", fill: "#e1f5fe", stroke: "#01579b" }),
      }),

    FlowUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "flow",
          choice(
            seq($["FlowEndMember"]!, "to", $["FlowEndMember"]!),
            seq(
              optional($["_UsageDeclaration"]!),
              optional($["_ValuePart"]!),
              optional(seq("of", $["PayloadFeatureMember"]!)),
              optional(seq("from", $["FlowEndMember"]!, "to", $["FlowEndMember"]!)),
            ),
          ),
          $["_DefinitionBody"]!,
        ),
        symbol: usageAttrs("flow"),
        queries: usageQueries,
        model: usageModel,
        lints: flowLints,
        graphics: () => sysmlEdgeGraphics({ label: "«flow»", stroke: "#01579b", connector: "jumpover" }),
      }),

    SuccessionFlowUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "succession",
          "flow",
          choice(
            seq($["FlowEndMember"]!, "to", $["FlowEndMember"]!),
            seq(
              optional($["_UsageDeclaration"]!),
              optional($["_ValuePart"]!),
              optional(seq("of", $["PayloadFeatureMember"]!)),
              optional(seq("from", $["FlowEndMember"]!, "to", $["FlowEndMember"]!)),
            ),
          ),
          $["_DefinitionBody"]!,
        ),
        symbol: usageAttrs("flow"),
        queries: usageQueries,
        lints: flowLints,
        graphics: () =>
          sysmlEdgeGraphics({
            label: "«succession flow»",
            stroke: "#01579b",
            strokeDasharray: "4 2",
            connector: "jumpover",
          }),
      }),

    PayloadFeatureMember: ($) => field("ownedRelatedElement", $["PayloadFeature"]!),

    PayloadFeature: ($) =>
      choice(
        seq(optional($["_Identification"]!), $["_FeatureSpecializationPart"]!, optional($["_ValuePart"]!)),
        seq(optional($["_Identification"]!), $["_ValuePart"]!),
        seq($["OwnedFeatureTyping"]!, optional($["OwnedMultiplicity"]!)),
        seq($["OwnedMultiplicity"]!, $["OwnedFeatureTyping"]!),
      ),

    FlowEndMember: ($) => field("ownedRelatedElement", $["FlowEnd"]!),

    FlowEnd: ($) =>
      seq(optional(seq($["OwnedReferenceSubsetting"]!, ".")), field("ownedRelationship", $["FlowFeatureMember"]!)),

    FlowFeatureMember: ($) => field("ownedRelatedElement", $["FlowFeature"]!),

    FlowFeature: ($) =>
      ref({
        syntax: field("ownedRelationship", $["QualifiedName"]!),
        name: (self) => self.ownedRelationship,
        targetKinds: ["Feature"],
        resolve: "qualified",
      }),

    // =====================================================================
    // ACTIONS
    // =====================================================================

    ActionDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "action",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          optional($["_ParameterList"]!),
          $["_ActionBody"]!,
        ),
        symbol: defAttrs("action"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: actionDefinitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "action def", fill: "#f0f9ff", stroke: "#0284c7" }),
      }),

    _ActionBody: ($) => choice(";", seq("{", repeat($["_ActionBodyItem"]!), "}")),

    _ActionBodyItem: ($) =>
      choice(
        $["Import"]!,
        $["AliasMember"]!,
        $["DefinitionMember"]!,
        $["VariantUsageMember"]!,
        $["NonOccurrenceUsageMember"]!,
        $["OccurrenceUsageMember"]!,
        seq(optional($["EmptySuccessionMember"]!), $["_OccurrenceUsageElement"]!),
        $["ActionNodeMember"]!,
        $["ReturnParameterMember"]!,
        $["AnnotatingMember"]!,
      ),

    EmptySuccessionMember: ($) => seq("then", field("ownedRelatedElement", $["MultiplicitySourceEnd"]!)),

    MultiplicitySourceEnd: ($) => field("ownedRelationship", $["OwnedMultiplicity"]!),

    ActionNodeMember: ($) => seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["_ActionNode"]!)),

    _ActionNode: ($) =>
      choice(
        $["IfNode"]!,
        $["WhileLoopNode"]!,
        $["ForLoopNode"]!,
        $["ControlNode"]!,
        $["AcceptActionNode"]!,
        $["SendActionNode"]!,
        $["AssignActionNode"]!,
      ),

    IfNode: ($) =>
      seq(
        repeat($["_usage_modifier"]!),
        optional(seq("action", optional($["_UsageDeclaration"]!))),
        "if",
        field("condition", $["OwnedExpression"]!),
        field("thenBody", $["ActionBodyParameter"]!),
        optional(seq("else", choice(field("elseBody", $["ActionBodyParameter"]!), $["IfNode"]!))),
      ),

    ActionBodyParameter: ($) =>
      seq(optional(seq("action", optional($["_UsageDeclaration"]!))), "{", repeat($["_ActionBodyItem"]!), "}"),

    WhileLoopNode: ($) =>
      seq(
        repeat($["_usage_modifier"]!),
        optional(seq("action", optional($["_UsageDeclaration"]!))),
        choice(seq("while", field("condition", $["OwnedExpression"]!)), "loop"),
        $["ActionBodyParameter"]!,
        optional(seq("until", field("untilCondition", $["OwnedExpression"]!), ";")),
      ),

    ForLoopNode: ($) =>
      seq(
        repeat($["_usage_modifier"]!),
        optional(seq("action", optional($["_UsageDeclaration"]!))),
        "for",
        field("variable", $["ForVariableDeclaration"]!),
        "in",
        field("range", $["OwnedExpression"]!),
        $["ActionBodyParameter"]!,
      ),

    ForVariableDeclaration: ($) => $["_UsageDeclaration"]!,

    ControlNode: ($) => choice($["MergeNode"]!, $["DecisionNode"]!, $["JoinNode"]!, $["ForkNode"]!),

    MergeNode: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "merge", optional($["_UsageDeclaration"]!), $["_ActionBody"]!),
        symbol: usageAttrs("merge"),
        graphics: () => ({
          role: "node",
          node: {
            shape: "polygon",
            markup: [
              { tagName: "polygon", selector: "body" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { points: "20,0 40,20 20,40 0,20", fill: "#f0f9ff", stroke: "#0284c7", strokeWidth: 1.5 },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 10,
                fontWeight: "600",
                refX: 20,
                refY: 48,
                textAnchor: "middle",
              },
            },
            size: { width: 40, height: 40 },
          },
        }),
      }),

    DecisionNode: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "decide", optional($["_UsageDeclaration"]!), $["_ActionBody"]!),
        symbol: usageAttrs("decide"),
        graphics: () => ({
          role: "node",
          node: {
            shape: "polygon",
            markup: [
              { tagName: "polygon", selector: "body" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { points: "20,0 40,20 20,40 0,20", fill: "#f0f9ff", stroke: "#0284c7", strokeWidth: 1.5 },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 10,
                fontWeight: "600",
                refX: 20,
                refY: 48,
                textAnchor: "middle",
              },
            },
            size: { width: 40, height: 40 },
          },
        }),
      }),

    JoinNode: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "join", optional($["_UsageDeclaration"]!), $["_ActionBody"]!),
        symbol: usageAttrs("join"),
        graphics: () => ({
          role: "node",
          node: {
            shape: "rect",
            markup: [
              { tagName: "rect", selector: "body" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { fill: "#1e293b", stroke: "#0f172a", strokeWidth: 1, rx: 1, ry: 1 },
              label: { text: "{{name}}", fill: "#475569", fontSize: 9, refX: 0.5, refY: -8, textAnchor: "middle" },
            },
            size: { width: 60, height: 6 },
          },
        }),
      }),

    ForkNode: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "fork", optional($["_UsageDeclaration"]!), $["_ActionBody"]!),
        symbol: usageAttrs("fork"),
        graphics: () => ({
          role: "node",
          node: {
            shape: "rect",
            markup: [
              { tagName: "rect", selector: "body" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { fill: "#1e293b", stroke: "#0f172a", strokeWidth: 1, rx: 1, ry: 1 },
              label: { text: "{{name}}", fill: "#475569", fontSize: 9, refX: 0.5, refY: -8, textAnchor: "middle" },
            },
            size: { width: 60, height: 6 },
          },
        }),
      }),

    ActionUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "action",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          optional($["_ParameterList"]!),
          $["_ActionBody"]!,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
        lints: actionUsageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "action", fill: "#f0f9ff", stroke: "#0284c7" }),
      }),

    // -----------------------------------------------------------------
    // ACCEPT / SEND / ASSIGN action nodes
    // -----------------------------------------------------------------

    AcceptActionNode: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          optional(seq("action", optional($["_UsageDeclaration"]!))),
          "accept",
          $["PayloadFeatureMember"]!,
          optional(seq("via", $["OwnedReferenceSubsetting"]!)),
          $["_ActionBody"]!,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => ({
          role: "node",
          node: {
            shape: "polygon",
            markup: [
              { tagName: "polygon", selector: "body" },
              { tagName: "text", selector: "stereotype" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { points: "0,0 120,0 120,40 0,40 16,20", fill: "#f0f9ff", stroke: "#0284c7", strokeWidth: 1.5 },
              stereotype: {
                text: "«accept»",
                fill: "#0284c7",
                fontSize: 9,
                fontStyle: "italic",
                refX: 0.55,
                refY: 14,
                textAnchor: "middle",
              },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 11,
                fontWeight: "bold",
                refX: 0.55,
                refY: 28,
                textAnchor: "middle",
              },
            },
            size: { width: 120, height: 40 },
          },
        }),
      }),

    SendActionNode: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          optional(seq("action", optional($["_UsageDeclaration"]!))),
          "send",
          field("sentItem", $["OwnedExpression"]!),
          optional(seq("via", $["OwnedReferenceSubsetting"]!)),
          optional(seq("to", field("receiver", $["OwnedExpression"]!))),
          $["_ActionBody"]!,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => ({
          role: "node",
          node: {
            shape: "polygon",
            markup: [
              { tagName: "polygon", selector: "body" },
              { tagName: "text", selector: "stereotype" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { points: "0,0 104,0 120,20 104,40 0,40", fill: "#f0f9ff", stroke: "#0284c7", strokeWidth: 1.5 },
              stereotype: {
                text: "«send»",
                fill: "#0284c7",
                fontSize: 9,
                fontStyle: "italic",
                refX: 0.45,
                refY: 14,
                textAnchor: "middle",
              },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 11,
                fontWeight: "bold",
                refX: 0.45,
                refY: 28,
                textAnchor: "middle",
              },
            },
            size: { width: 120, height: 40 },
          },
        }),
      }),

    AssignActionNode: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          optional(seq("action", optional($["_UsageDeclaration"]!))),
          "assign",
          choice(
            seq(field("targetFeature", $["OwnedExpression"]!), ":=", field("assignedValue", $["OwnedExpression"]!)),
            seq(field("assignedValue", $["OwnedExpression"]!), "=:", field("targetFeature", $["OwnedExpression"]!)),
          ),
          $["_ActionBody"]!,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    PerformActionUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "perform",
          choice(
            seq($["OwnedReferenceSubsetting"]!, optional($["_FeatureSpecializationPart"]!)),
            seq("action", optional($["_UsageDeclaration"]!)),
          ),
          optional($["_ValuePart"]!),
          $["_ActionBody"]!,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
        lints: actionUsageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "perform", fill: "#f0f9ff", stroke: "#0369a1" }),
      }),

    // =====================================================================
    // CALCULATIONS
    // =====================================================================

    CalculationDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "calc",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          optional($["_ParameterList"]!),
          $["_CalculationBody"]!,
        ),
        symbol: defAttrs("calc"),
        queries: calculationQueries,
        model: calculationDefinitionModel,
        lints: calculationDefinitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "calc def", fill: "#f0fdfa", stroke: "#0f766e" }),
      }),

    _CalculationBody: ($) =>
      choice(
        ";",
        seq(
          "{",
          repeat(choice($["_ActionBodyItem"]!, $["ReturnParameterMember"]!)),
          optional($["ResultExpressionMember"]!),
          "}",
        ),
      ),

    _ParameterList: ($) => seq("(", optional(seq($["ParameterMember"]!, repeat(seq(",", $["ParameterMember"]!)))), ")"),

    ParameterMember: ($) => seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["_UsageElement"]!)),

    ReturnParameterMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), "return", field("ownedRelatedElement", $["_UsageElement"]!)),

    ResultExpressionMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["OwnedExpression"]!)),

    CalculationUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "calc",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          optional($["_ParameterList"]!),
          $["_CalculationBody"]!,
        ),
        symbol: usageAttrs("calc"),
        queries: calculationUsageQueries,
        model: calculationUsageModel,
        lints: calculationUsageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "calc", fill: "#f0fdfa", stroke: "#0f766e" }),
      }),

    // =====================================================================
    // CONSTRAINTS
    // =====================================================================

    ConstraintDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "constraint",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_CalculationBody"]!,
        ),
        symbol: defAttrs("constraint"),
        queries: constraintDefinitionQueries,
        model: constraintDefinitionModel,
        lints: constraintDefinitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "constraint def", fill: "#fff1f2", stroke: "#e11d48" }),
      }),

    ConstraintUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "constraint",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_CalculationBody"]!,
        ),
        symbol: usageAttrs("constraint"),
        queries: constraintUsageQueries,
        model: constraintUsageModel,
        lints: constraintUsageLintRules,
        graphics: () => sysmlUsageGraphics({ stereotype: "constraint", fill: "#fff1f2", stroke: "#f43f5e" }),
      }),

    AssertConstraintUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "assert",
          optional(field("isNegated", "not")),
          choice(
            seq($["OwnedReferenceSubsetting"]!, optional($["_FeatureSpecializationPart"]!)),
            seq("constraint", optional($["_UsageDeclaration"]!), optional($["_ValuePart"]!)),
          ),
          $["_CalculationBody"]!,
        ),
        symbol: usageAttrs("constraint"),
        queries: constraintUsageQueries,
        model: constraintUsageModel,
        lints: constraintUsageLintRules,
      }),

    // =====================================================================
    // REQUIREMENTS
    // =====================================================================

    RequirementDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "requirement",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: defAttrs("requirement"),
        queries: requirementQueries,
        model: requirementDefinitionModel,
        lints: {
          ...requirementDefinitionLintsEnhanced,
          evolutionCheck: (_db: QueryDB, self: SymbolEntry, previous?: SymbolEntry) => {
            if (previous) {
              const prevIsAbstract = (previous.metadata as Record<string, unknown>)?.["isAbstract"];
              const currIsAbstract = (self.metadata as Record<string, unknown>)?.["isAbstract"];
              if (currIsAbstract && !prevIsAbstract) {
                return error(SysML2ErrorCode.ABSTRACT_REQUIREMENT_VIOLATION.message(), {
                  code: SysML2ErrorCode.ABSTRACT_REQUIREMENT_VIOLATION.code,
                  field: "declaredName",
                });
              }
            }
            return null;
          },
        },
        graphics: () =>
          sysmlNodeGraphics({
            stereotype: "requirement def",
            fill: "#f5f3ff",
            stroke: "#7c3aed",
            width: 200,
            height: 70,
          }),
        diff: {
          ignore: ["description", "text"], // Formatting of text is ignored, logical rules matter
          breaking: ["subject", "isAbstract"],
        },
      }),

    _RequirementBody: ($) => choice(";", seq("{", repeat($["_RequirementBodyItem"]!), "}")),

    _RequirementBodyItem: ($) =>
      choice(
        $["_DefinitionBodyItem"]!,
        $["SubjectMember"]!,
        $["RequirementConstraintMember"]!,
        $["ActorMember"]!,
        $["StakeholderMember"]!,
      ),

    SubjectMember: ($) => seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["SubjectUsage"]!)),

    SubjectUsage: ($) =>
      def({
        syntax: seq("subject", repeat($["_usage_modifier"]!), $["_Usage"]!),
        symbol: usageAttrs("subject"),
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "subject", fill: "#f1f8e9", stroke: "#33691e" }),
      }),

    RequirementConstraintMember: ($) =>
      seq(
        optional($["VisibilityIndicator"]!),
        field("constraintKind", choice("assume", "require")),
        field("ownedRelatedElement", $["RequirementConstraintUsage"]!),
      ),

    RequirementConstraintUsage: ($) =>
      def({
        syntax: choice(
          seq($["OwnedReferenceSubsetting"]!, repeat($["_FeatureSpecialization"]!), $["_CalculationBody"]!),
          seq(
            repeat($["_usage_modifier"]!),
            optional("constraint"),
            optional($["_UsageDeclaration"]!),
            optional($["_ValuePart"]!),
            $["_CalculationBody"]!,
          ),
        ),
        symbol: usageAttrs("constraint"),
        queries: constraintUsageQueries,
        model: constraintUsageModel,
      }),

    ActorMember: ($) => seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["ActorUsage"]!)),

    ActorUsage: ($) =>
      def({
        syntax: seq("actor", repeat($["_usage_modifier"]!), $["_Usage"]!),
        symbol: usageAttrs("actor"),
        model: usageModel,
        graphics: () => ({
          role: "node",
          node: {
            shape: "rect",
            markup: [
              { tagName: "circle", selector: "actorHead" },
              { tagName: "line", selector: "actorSpine" },
              { tagName: "line", selector: "actorArms" },
              { tagName: "line", selector: "actorLeftLeg" },
              { tagName: "line", selector: "actorRightLeg" },
              { tagName: "text", selector: "stereotype" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              actorHead: { cx: 25, cy: 12, r: 8, fill: "#fff7ed", stroke: "#ea580c", strokeWidth: 1.5 },
              actorSpine: { x1: 25, y1: 20, x2: 25, y2: 38, stroke: "#ea580c", strokeWidth: 1.5 },
              actorArms: { x1: 10, y1: 26, x2: 40, y2: 26, stroke: "#ea580c", strokeWidth: 1.5 },
              actorLeftLeg: { x1: 25, y1: 38, x2: 12, y2: 54, stroke: "#ea580c", strokeWidth: 1.5 },
              actorRightLeg: { x1: 25, y1: 38, x2: 38, y2: 54, stroke: "#ea580c", strokeWidth: 1.5 },
              stereotype: {
                text: "«actor»",
                fill: "#ea580c",
                fontSize: 9,
                fontStyle: "italic",
                textAnchor: "middle",
                refX: 25,
                refY: 66,
              },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 11,
                fontWeight: "bold",
                textAnchor: "middle",
                refX: 25,
                refY: 78,
              },
            },
            size: { width: 50, height: 85 },
          },
        }),
      }),

    StakeholderMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["StakeholderUsage"]!)),

    StakeholderUsage: ($) =>
      def({
        syntax: seq("stakeholder", repeat($["_usage_modifier"]!), $["_Usage"]!),
        symbol: usageAttrs("stakeholder"),
        model: usageModel,
        graphics: () => sysmlUsageGraphics({ stereotype: "stakeholder", fill: "#fbe9e7", stroke: "#bf360c" }),
      }),

    RequirementUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "requirement",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: usageAttrs("requirement"),
        queries: requirementUsageQueries,
        model: requirementUsageModel,
        lints: requirementUsageLintsEnhanced,
        graphics: () => sysmlUsageGraphics({ stereotype: "requirement", fill: "#f5f3ff", stroke: "#8b5cf6" }),
      }),

    SatisfyRequirementUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          optional("assert"),
          optional(field("isNegated", "not")),
          "satisfy",
          choice(
            seq($["OwnedReferenceSubsetting"]!, optional($["_FeatureSpecializationPart"]!)),
            seq("requirement", optional($["_UsageDeclaration"]!)),
          ),
          optional($["_ValuePart"]!),
          optional(seq("by", field("satisfyingFeature", $["OwnedReferenceSubsetting"]!))),
          $["_RequirementBody"]!,
        ),
        symbol: usageAttrs("requirement"),
        queries: satisfyRequirementQueries,
        model: satisfyRequirementModel,
        lints: satisfyRequirementLints,
        graphics: () => sysmlEdgeGraphics({ label: "«satisfy»", stroke: "#7c3aed", strokeDasharray: "8 4" }),
      }),

    // =====================================================================
    // CONCERNS
    // =====================================================================

    ConcernDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "concern",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: defAttrs("concern"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "concern def", fill: "#fdf2f8", stroke: "#db2777" }),
      }),

    ConcernUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "concern",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: usageAttrs("concern"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "concern", fill: "#fdf2f8", stroke: "#ec4899" }),
      }),

    // =====================================================================
    // CASES
    // =====================================================================

    CaseDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "case",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_CaseBody"]!,
        ),
        symbol: defAttrs("case"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "case def", fill: "#ede7f6", stroke: "#4527a0" }),
      }),

    _CaseBody: ($) =>
      choice(
        ";",
        seq(
          "{",
          repeat(
            choice(
              $["_ActionBodyItem"]!,
              $["SubjectMember"]!,
              $["ActorMember"]!,
              $["StakeholderMember"]!,
              $["ObjectiveMember"]!,
            ),
          ),
          optional($["ResultExpressionMember"]!),
          "}",
        ),
      ),

    CaseUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "case",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_CaseBody"]!,
        ),
        symbol: usageAttrs("case"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "case", fill: "#ede7f6", stroke: "#311b92" }),
      }),

    AnalysisCaseDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "analysis",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_CaseBody"]!,
        ),
        symbol: defAttrs("analysisCase"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "analysis case def", fill: "#ede7f6", stroke: "#311b92" }),
      }),

    AnalysisCaseUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "analysis",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_CaseBody"]!,
        ),
        symbol: usageAttrs("analysisCase"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "analysis case", fill: "#ede7f6", stroke: "#512da8" }),
      }),

    VerificationCaseDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "verification",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_VerificationBody"]!,
        ),
        symbol: defAttrs("verificationCase"),
        queries: verificationCaseQueries,
        model: verificationCaseDefinitionModel,
        lints: verificationCaseDefinitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "verification def", fill: "#e8eaf6", stroke: "#3f51b5" }),
      }),

    VerificationCaseUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "verification",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_VerificationBody"]!,
        ),
        symbol: usageAttrs("verificationCase"),
        queries: verificationCaseUsageQueries,
        model: verificationCaseUsageModel,
        graphics: () => sysmlUsageGraphics({ stereotype: "verification case", fill: "#e8eaf6", stroke: "#1a237e" }),
        lints: verificationCaseUsageLints,
      }),

    _VerificationBody: ($) =>
      choice(";", seq("{", repeat($["_VerificationBodyItem"]!), optional($["ResultExpressionMember"]!), "}")),

    _VerificationBodyItem: ($) =>
      choice($["_ActionBodyItem"]!, $["VerifyRequirementUsageMember"]!, $["ObjectiveMember"]!, $["AnnotatingMember"]!),

    VerifyRequirementUsageMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["VerifyRequirementUsage"]!)),

    VerifyRequirementUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "verify",
          choice(
            seq($["OwnedReferenceSubsetting"]!, optional($["_FeatureSpecializationPart"]!)),
            seq("requirement", optional($["_UsageDeclaration"]!)),
          ),
          optional($["_ValuePart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: usageAttrs("verification"),
        queries: usageQueries,
        model: usageModel,
        lints: verifyRequirementLints,
        graphics: () => sysmlEdgeGraphics({ label: "«verify»", stroke: "#3f51b5", strokeDasharray: "4 4" }),
      }),

    ObjectiveMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["ObjectiveRequirementUsage"]!)),

    ObjectiveRequirementUsage: ($) =>
      def({
        syntax: seq(
          "objective",
          repeat($["_usage_modifier"]!),
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: usageAttrs("objective"),
        model: usageModel,
      }),

    UseCaseDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "use",
          "case",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_CaseBody"]!,
        ),
        symbol: defAttrs("useCase"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => ({
          role: "node",
          node: {
            shape: "ellipse",
            markup: [
              { tagName: "ellipse", selector: "body" },
              { tagName: "text", selector: "stereotype" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: {
                refCx: "50%",
                refCy: "50%",
                refRx: "50%",
                refRy: "50%",
                fill: "#fdf2f8",
                stroke: "#db2777",
                strokeWidth: 1.5,
              },
              stereotype: {
                text: "«use case def»",
                fill: "#db2777",
                fontSize: 10,
                fontStyle: "italic",
                textAnchor: "middle",
                refX: 0.5,
                refY: 18,
              },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 12,
                fontWeight: "bold",
                textAnchor: "middle",
                refX: 0.5,
                refY: 34,
              },
            },
            size: { width: 160, height: 60 },
          },
        }),
      }),

    UseCaseUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "use",
          "case",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_CaseBody"]!,
        ),
        symbol: usageAttrs("useCase"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => ({
          role: "node",
          node: {
            shape: "ellipse",
            markup: [
              { tagName: "ellipse", selector: "body" },
              { tagName: "text", selector: "stereotype" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: {
                refCx: "50%",
                refCy: "50%",
                refRx: "50%",
                refRy: "50%",
                fill: "#fdf2f8",
                stroke: "#db2777",
                strokeWidth: 1.5,
                strokeDasharray: "6 3",
              },
              stereotype: {
                text: "«use case»",
                fill: "#db2777",
                fontSize: 9,
                fontStyle: "italic",
                textAnchor: "middle",
                refX: 0.5,
                refY: 16,
              },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 12,
                fontWeight: "bold",
                textAnchor: "middle",
                refX: 0.5,
                refY: 32,
              },
            },
            size: { width: 140, height: 50 },
          },
        }),
      }),

    IncludeUseCaseUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "include",
          choice(
            seq($["OwnedReferenceSubsetting"]!, optional($["_FeatureSpecializationPart"]!)),
            seq("use", "case", optional($["_UsageDeclaration"]!)),
          ),
          optional($["_ValuePart"]!),
          $["_CaseBody"]!,
        ),
        symbol: usageAttrs("useCase"),
        queries: usageQueries,
        model: usageModel,
        graphics: () => ({
          role: "node",
          node: {
            shape: "ellipse",
            markup: [
              { tagName: "ellipse", selector: "body" },
              { tagName: "text", selector: "stereotype" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: {
                refCx: "50%",
                refCy: "50%",
                refRx: "50%",
                refRy: "50%",
                fill: "#fdf2f8",
                stroke: "#db2777",
                strokeWidth: 1.5,
                strokeDasharray: "6 3",
              },
              stereotype: {
                text: "«include»",
                fill: "#db2777",
                fontSize: 9,
                fontStyle: "italic",
                textAnchor: "middle",
                refX: 0.5,
                refY: 16,
              },
              label: {
                text: "{{name}}",
                fill: "#0f172a",
                fontSize: 12,
                fontWeight: "bold",
                textAnchor: "middle",
                refX: 0.5,
                refY: 32,
              },
            },
            size: { width: 140, height: 50 },
          },
        }),
      }),

    // =====================================================================
    // STATES
    // =====================================================================

    StateDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "state",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          choice(";", seq(optional(field("isParallel", "parallel")), "{", repeat($["_StateBodyItem"]!), "}")),
        ),
        symbol: (self: SysmlRuleSelf) => ({
          kind: "Definition" as const,
          name: self.declaredName,
          exports: [],
          attributes: {
            isAbstract: self.isAbstract,
            isVariation: self.isVariation,
            isParallel: self.isParallel,
          },
        }),
        queries: stateQueries,
        model: stateDefinitionModel,
        lints: stateDefinitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "state def", fill: "#fffbeb", stroke: "#d97706" }),
      }),

    _StateBodyItem: ($) =>
      choice(
        $["Import"]!,
        $["AliasMember"]!,
        $["DefinitionMember"]!,
        $["VariantUsageMember"]!,
        $["NonOccurrenceUsageMember"]!,
        $["OccurrenceUsageMember"]!,
        seq(optional($["EmptySuccessionMember"]!), $["_OccurrenceUsageElement"]!),
        $["TransitionUsageMember"]!,
        $["EntryActionMember"]!,
        $["DoActionMember"]!,
        $["ExitActionMember"]!,
        $["AnnotatingMember"]!,
      ),

    EntryActionMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), "entry", field("ownedRelatedElement", $["StateActionUsage"]!)),

    DoActionMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), "do", field("ownedRelatedElement", $["StateActionUsage"]!)),

    ExitActionMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), "exit", field("ownedRelatedElement", $["StateActionUsage"]!)),

    StateActionUsage: ($) =>
      choice(";", seq(optional($["_UsageDeclaration"]!), optional($["_ValuePart"]!), $["_ActionBody"]!)),

    StateUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "state",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          choice(";", seq(optional(field("isParallel", "parallel")), "{", repeat($["_StateBodyItem"]!), "}")),
        ),
        symbol: (self: SysmlRuleSelf) => ({
          kind: "Usage" as const,
          name: self.declaredName,
          attributes: {
            ...usageAttrs("state")(self).attributes,
            isParallel: self.isParallel,
          },
        }),
        queries: { ...usageQueries, ...stateQueries },
        model: stateUsageModel,
        lints: stateUsageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "state", fill: "#fffbeb", stroke: "#f59e0b" }),
      }),

    ExhibitStateUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "exhibit",
          choice(
            seq($["OwnedReferenceSubsetting"]!, optional($["_FeatureSpecializationPart"]!)),
            seq("state", optional($["_UsageDeclaration"]!)),
          ),
          optional($["_ValuePart"]!),
          choice(";", seq(optional(field("isParallel", "parallel")), "{", repeat($["_StateBodyItem"]!), "}")),
        ),
        symbol: (self: SysmlRuleSelf) => ({
          kind: "Usage" as const,
          name: self.declaredName,
          attributes: {
            ...usageAttrs("state")(self).attributes,
            isParallel: self.isParallel,
          },
          graphics: () => sysmlUsageGraphics({ stereotype: "exhibit", fill: "#fff8e1", stroke: "#ff8f00" }),
        }),
        queries: { ...usageQueries, ...stateQueries },
        model: stateUsageModel,
        lints: stateUsageLints,
      }),

    TransitionUsageMember: ($) =>
      seq(optional($["VisibilityIndicator"]!), field("ownedRelatedElement", $["TransitionUsage"]!)),

    TransitionUsage: ($) =>
      def({
        syntax: seq(
          "transition",
          optional(seq(optional($["_UsageDeclaration"]!), "first")),
          ref({
            syntax: field("source", $["QualifiedName"]!),
            name: (self) => self.source,
            targetKinds: ["Feature"],
            resolve: "qualified",
          }),
          optional(seq("accept", field("trigger", $["PayloadFeatureMember"]!))),
          optional(seq("if", field("guard", $["OwnedExpression"]!))),
          optional(seq("do", field("effect", $["StateActionUsage"]!))),
          "then",
          $["ConnectorEndMember"]!,
          $["_ActionBody"]!,
        ),
        symbol: (self: SysmlRuleSelf) => ({
          ...usageAttrs("transition")(self),
          attributes: {
            ...usageAttrs("transition")(self).attributes,
            trigger: self.trigger,
            guard: self.guard,
            effect: self.effect,
          },
        }),
        queries: usageQueries,
        model: usageModel,
        lints: transitionUsageLints,
        graphics: () =>
          sysmlEdgeGraphics({
            label: "«transition»",
            stroke: "#f9a825",
            targetMarker: "classic",
            router: "manhattan",
            connector: "rounded",
          }),
      }),

    // =====================================================================
    // VIEWS
    // =====================================================================

    ViewDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "view",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          choice(";", seq("{", repeat(choice($["_DefinitionBodyItem"]!, $["ElementFilterMember"]!)), "}")),
        ),
        symbol: defAttrs("view"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: viewDefinitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "view def", fill: "#efebe9", stroke: "#4e342e" }),
      }),

    ViewUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "view",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          choice(";", seq("{", repeat(choice($["_DefinitionBodyItem"]!, $["ElementFilterMember"]!)), "}")),
        ),
        symbol: usageAttrs("view"),
        queries: usageQueries,
        model: usageModel,
        lints: viewUsageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "view", fill: "#efebe9", stroke: "#6d4c41" }),
      }),

    ViewpointDefinition: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "viewpoint",
          "def",
          optional($["_Identification"]!),
          optional($["_SubclassificationPart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: defAttrs("viewpoint"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "viewpoint def", fill: "#efebe9", stroke: "#3e2723" }),
      }),

    ViewpointUsage: ($) =>
      def({
        syntax: seq(
          repeat($["_usage_modifier"]!),
          "viewpoint",
          optional($["_UsageDeclaration"]!),
          optional($["_ValuePart"]!),
          $["_RequirementBody"]!,
        ),
        symbol: usageAttrs("viewpoint"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "viewpoint", fill: "#efebe9", stroke: "#5d4037" }),
      }),

    // =====================================================================
    // RENDERINGS
    // =====================================================================

    RenderingDefinition: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "rendering", "def", $["_Definition"]!),
        symbol: defAttrs("rendering"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "rendering def", fill: "#fafafa", stroke: "#424242" }),
      }),

    RenderingUsage: ($) =>
      def({
        syntax: seq(repeat($["_usage_modifier"]!), "rendering", $["_Usage"]!),
        symbol: usageAttrs("rendering"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "rendering", fill: "#fafafa", stroke: "#616161" }),
      }),

    // =====================================================================
    // EXPRESSIONS (copied from KerML Expressions, flattened)
    // =====================================================================

    OwnedExpressionMember: ($) => field("ownedRelatedElement", $["OwnedExpression"]!),

    OwnedExpression: ($) => $["_Expression"]!,

    _Expression: ($) =>
      choice(
        $["ConditionalExpression"]!,
        $["NullCoalescingExpression"]!,
        $["ImpliesExpression"]!,
        $["OrExpression"]!,
        $["XorExpression"]!,
        $["AndExpression"]!,
        $["EqualityExpression"]!,
        $["ClassificationExpression"]!,
        $["RelationalExpression"]!,
        $["RangeExpression"]!,
        $["AdditiveExpression"]!,
        $["MultiplicativeExpression"]!,
        $["ExponentiationExpression"]!,
        $["UnaryExpression"]!,
        $["ExtentExpression"]!,
        $["MeasurementExpression"]!,
        $["PrimaryExpression"]!,
        $["_BaseExpression"]!,
      ),

    OwnedExpressionReference: ($) => field("ownedRelationship", $["OwnedExpressionMember"]!),

    ConditionalExpression: ($) =>
      prec.right(
        PREC.CONDITIONAL,
        seq(
          field("operator", "if"),
          field("operand", $["_Expression"]!),
          "?",
          field("thenOperand", $["OwnedExpressionReference"]!),
          "else",
          field("elseOperand", $["OwnedExpressionReference"]!),
        ),
      ),

    NullCoalescingExpression: ($) =>
      prec.left(
        PREC.NULL_COALESCING,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(seq(field("operator", "??"), field("operand", $["ImpliesExpressionReference"]!))),
        ),
      ),

    ImpliesExpressionReference: ($) => field("ownedRelationship", $["ImpliesExpressionMember"]!),
    ImpliesExpressionMember: ($) => field("ownedRelatedElement", $["_Expression"]!),

    ImpliesExpression: ($) =>
      prec.left(
        PREC.IMPLIES,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(seq(field("operator", "implies"), field("operand", $["ImpliesExpressionReference"]!))),
        ),
      ),

    OrExpressionReference: ($) => field("ownedRelationship", $["OrExpressionMember"]!),
    OrExpressionMember: ($) => field("ownedRelatedElement", $["_Expression"]!),

    OrExpression: ($) =>
      prec.left(
        PREC.OR,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(
            choice(
              seq(field("operator", "|"), field("operand", $["_Expression"]!)),
              seq(field("operator", "or"), field("operand", $["XorExpressionReference"]!)),
            ),
          ),
        ),
      ),

    XorExpressionReference: ($) => field("ownedRelationship", $["XorExpressionMember"]!),
    XorExpressionMember: ($) => field("ownedRelatedElement", $["_Expression"]!),

    XorExpression: ($) =>
      prec.left(
        PREC.XOR,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(seq(field("operator", "xor"), field("operand", $["_Expression"]!))),
        ),
      ),

    AndExpression: ($) =>
      prec.left(
        PREC.AND,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(
            choice(
              seq(field("operator", "&"), field("operand", $["_Expression"]!)),
              seq(field("operator", "and"), field("operand", $["EqualityExpressionReference"]!)),
            ),
          ),
        ),
      ),

    EqualityExpressionReference: ($) => field("ownedRelationship", $["EqualityExpressionMember"]!),
    EqualityExpressionMember: ($) => field("ownedRelatedElement", $["_Expression"]!),

    EqualityExpression: ($) =>
      prec.left(
        PREC.EQUALITY,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(seq(field("operator", $["EqualityOperator"]!), field("operand", $["_Expression"]!))),
        ),
      ),

    EqualityOperator: () => choice("==", "!=", "===", "!=="),

    ClassificationExpression: ($) =>
      prec(
        PREC.CLASSIFICATION,
        choice(
          seq(
            field("operand", $["_Expression"]!),
            choice(
              seq(
                field("operator", $["ClassificationTestOperator"]!),
                field("typeReference", $["TypeReferenceMember"]!),
              ),
              seq(field("operator", $["CastOperator"]!), field("typeResult", $["TypeResultMember"]!)),
            ),
          ),
          seq(field("operator", $["ClassificationTestOperator"]!), field("typeReference", $["TypeReferenceMember"]!)),
          seq(
            field("operand", $["MetadataReference"]!),
            field("operator", $["MetaClassificationTestOperator"]!),
            field("typeReference", $["TypeReferenceMember"]!),
          ),
          seq(field("operator", $["CastOperator"]!), field("typeResult", $["TypeResultMember"]!)),
          seq(
            field("operand", $["MetadataReference"]!),
            field("operator", $["MetaCastOperator"]!),
            field("typeResult", $["TypeResultMember"]!),
          ),
        ),
      ),

    ClassificationTestOperator: () => choice("hastype", "istype", "@"),
    MetaClassificationTestOperator: () => "@@",
    CastOperator: () => "as",
    MetaCastOperator: () => "meta",

    MetadataReference: ($) => field("ownedRelationship", $["ElementReferenceMember"]!),

    TypeReferenceMember: ($) => field("ownedRelatedElement", $["TypeReference"]!),
    TypeResultMember: ($) => field("ownedRelatedElement", $["TypeReference"]!),
    TypeReference: ($) => field("ownedRelationship", $["ReferenceTyping"]!),

    ReferenceTyping: ($) =>
      ref({
        syntax: field("type", $["QualifiedName"]!),
        name: (self) => self.type,
        targetKinds: ["Type"],
        resolve: "qualified",
      }),

    RelationalExpression: ($) =>
      prec.left(
        PREC.RELATIONAL,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(seq(field("operator", $["RelationalOperator"]!), field("operand", $["_Expression"]!))),
        ),
      ),
    RelationalOperator: () => choice("<", ">", "<=", ">="),

    RangeExpression: ($) =>
      prec.left(
        PREC.RANGE,
        seq(field("operand", $["_Expression"]!), field("operator", ".."), field("operand", $["_Expression"]!)),
      ),

    AdditiveExpression: ($) =>
      prec.left(
        PREC.ADDITIVE,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(seq(field("operator", $["AdditiveOperator"]!), field("operand", $["_Expression"]!))),
        ),
      ),
    AdditiveOperator: () => choice("+", "-"),

    MultiplicativeExpression: ($) =>
      prec.left(
        PREC.MULTIPLICATIVE,
        seq(
          field("operand", $["_Expression"]!),
          repeat1(seq(field("operator", $["MultiplicativeOperator"]!), field("operand", $["_Expression"]!))),
        ),
      ),
    MultiplicativeOperator: () => choice("*", "/", "%"),

    ExponentiationExpression: ($) =>
      prec.right(
        PREC.EXPONENTIATION,
        seq(
          field("base", $["_Expression"]!),
          field("operator", $["ExponentiationOperator"]!),
          field("exponent", $["_Expression"]!),
        ),
      ),
    ExponentiationOperator: () => choice("**", "^"),

    UnaryExpression: ($) =>
      prec(PREC.UNARY, seq(field("operator", $["UnaryOperator"]!), field("operand", $["_Expression"]!))),
    UnaryOperator: () => choice("+", "-", "~", "not"),

    ExtentExpression: ($) =>
      prec(PREC.EXTENT, seq(field("operator", "all"), field("typeResult", $["TypeResultMember"]!))),

    _postfix_operation: ($) =>
      choice(
        seq("#", "(", field("indexOperand", $["SequenceExpression"]!), ")"),
        seq(field("operator", "["), field("filterOperand", $["SequenceExpression"]!), "]"),
        seq(
          "->",
          field("invocationType", $["InstantiatedTypeMember"]!),
          choice(
            field("body", $["BodyExpression"]!),
            field("functionRef", $["FunctionReferenceExpression"]!),
            $["_ArgumentList"]!,
          ),
        ),
        seq(".", field("collect", $["BodyExpression"]!)),
        seq(".?", field("select", $["BodyExpression"]!)),
      ),

    MeasurementExpression: ($) =>
      prec.left(
        PREC.PRIMARY,
        prec.dynamic(
          1,
          seq(
            field("value", choice($["_LiteralExpression"]!, $["FeatureReferenceExpression"]!)),
            "[",
            field("unit", $["_UnitExpression"]!),
            "]",
          ),
        ),
      ),

    _UnitExpression: ($) =>
      choice($["UnitBinaryExpression"]!, $["UnitExponentExpression"]!, $["_UnitPrimaryExpression"]!),

    UnitBinaryExpression: ($) =>
      prec.left(
        PREC.MULTIPLICATIVE,
        seq(
          field("left", $["_UnitExpression"]!),
          field("operator", choice("*", "/")),
          field("right", $["_UnitExpression"]!),
        ),
      ),

    UnitExponentExpression: ($) =>
      prec.right(
        PREC.EXPONENTIATION,
        seq(
          field("base", $["_UnitPrimaryExpression"]!),
          field("operator", choice("^", "**")),
          field("exponent", choice($["LiteralInteger"]!, seq("-", $["LiteralInteger"]!))),
        ),
      ),

    _UnitPrimaryExpression: ($) => choice($["FeatureReferenceExpression"]!, seq("(", $["_UnitExpression"]!, ")")),

    PrimaryExpression: ($) =>
      prec.left(
        PREC.PRIMARY,
        choice(
          seq(
            field("base", $["_BaseExpression"]!),
            seq(".", field("featureChain", $["FeatureChainMember"]!)),
            repeat($["_postfix_operation"]!),
          ),
          seq(field("base", $["_BaseExpression"]!), repeat1($["_postfix_operation"]!)),
        ),
      ),

    FunctionReferenceExpression: ($) => field("ownedRelationship", $["FunctionReferenceMember"]!),
    FunctionReferenceMember: ($) => field("ownedRelatedElement", $["FunctionReference"]!),
    FunctionReference: ($) => field("ownedRelationship", $["ReferenceTyping"]!),

    FeatureChainMember: ($) =>
      ref({
        syntax: field("memberElement", $["QualifiedName"]!),
        name: (self) => self.memberElement,
        targetKinds: ["Feature"],
        resolve: "qualified",
      }),

    OwnedFeatureChain: ($) => $["_FeatureChain"]!,

    _BaseExpression: ($) =>
      choice(
        $["NullExpression"]!,
        $["_LiteralExpression"]!,
        $["FeatureReferenceExpression"]!,
        $["InvocationExpression"]!,
        $["ConstructorExpression"]!,
        $["BodyExpression"]!,
        seq("(", $["SequenceExpression"]!, ")"),
      ),

    // SysML2 overrides ExpressionBody to use CalculationBody
    BodyExpression: ($) => field("ownedRelationship", $["ExpressionBodyMember"]!),
    ExpressionBodyMember: ($) => field("ownedRelatedElement", $["ExpressionBody"]!),
    ExpressionBody: ($) => $["_CalculationBody"]!,

    SequenceExpression: ($) =>
      seq(
        $["OwnedExpression"]!,
        optional(choice(",", seq(field("operator", ","), field("operand", $["SequenceExpression"]!)))),
      ),

    FeatureReferenceExpression: ($) => field("ownedRelationship", $["FeatureReferenceMember"]!),
    FeatureReferenceMember: ($) =>
      ref({
        syntax: field("memberElement", $["QualifiedName"]!),
        name: (self) => self.memberElement,
        targetKinds: ["Feature"],
        resolve: "qualified",
      }),

    ElementReferenceMember: ($) =>
      ref({
        syntax: field("memberElement", $["QualifiedName"]!),
        name: (self) => self.memberElement,
        targetKinds: ["Element"],
        resolve: "qualified",
      }),

    InvocationExpression: ($) => seq(field("type", $["InstantiatedTypeMember"]!), $["_ArgumentList"]!),
    ConstructorExpression: ($) =>
      seq("new", field("type", $["InstantiatedTypeMember"]!), field("result", $["ConstructorResultMember"]!)),
    ConstructorResultMember: ($) => field("ownedRelatedElement", $["ConstructorResult"]!),
    ConstructorResult: ($) => $["_ArgumentList"]!,

    InstantiatedTypeMember: ($) =>
      choice(
        ref({
          syntax: field("memberElement", $["QualifiedName"]!),
          name: (self) => self.memberElement,
          targetKinds: ["Type"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $["OwnedFeatureChain"]!),
      ),

    _FeatureChain: ($) =>
      seq(
        field("chaining", $["OwnedFeatureChaining"]!),
        repeat1(seq(".", field("chaining", $["OwnedFeatureChaining"]!))),
      ),

    OwnedFeatureChaining: ($) =>
      ref({
        syntax: field("chainingFeature", $["QualifiedName"]!),
        name: (self) => self.chainingFeature,
        targetKinds: ["Feature"],
        resolve: "qualified",
      }),

    _ArgumentList: ($) => seq("(", optional(choice($["_PositionalArgumentList"]!, $["_NamedArgumentList"]!)), ")"),

    _PositionalArgumentList: ($) =>
      seq(field("argument", $["ArgumentMember"]!), repeat(seq(",", field("argument", $["ArgumentMember"]!)))),

    ArgumentMember: ($) => field("ownedRelatedElement", $["Argument"]!),
    Argument: ($) => field("ownedRelationship", $["ArgumentValue"]!),

    _NamedArgumentList: ($) =>
      seq(
        field("namedArgument", $["NamedArgumentMember"]!),
        repeat(seq(",", field("namedArgument", $["NamedArgumentMember"]!))),
      ),

    NamedArgumentMember: ($) => field("ownedRelatedElement", $["NamedArgument"]!),
    NamedArgument: ($) =>
      seq(field("parameterRedefinition", $["ParameterRedefinition"]!), "=", field("value", $["ArgumentValue"]!)),

    ParameterRedefinition: ($) =>
      ref({
        syntax: field("redefinedFeature", $["QualifiedName"]!),
        name: (self) => self.redefinedFeature,
        targetKinds: ["Feature"],
        resolve: "qualified",
      }),

    ArgumentValue: ($) => field("ownedRelatedElement", $["OwnedExpression"]!),

    NullExpression: () => choice("null", seq("(", ")")),

    _LiteralExpression: ($) =>
      choice($["LiteralBoolean"]!, $["LiteralString"]!, $["LiteralInteger"]!, $["LiteralReal"]!, $["LiteralInfinity"]!),

    LiteralBoolean: ($) => field("value", $["BooleanValue"]!),
    BooleanValue: () => choice("true", "false"),
    LiteralString: ($) => field("value", $["STRING_VALUE"]!),
    LiteralInteger: ($) => field("value", $["DECIMAL_VALUE"]!),
    LiteralReal: ($) => field("value", $["RealValue"]!),
    RealValue: ($) =>
      choice(seq(optional($["DECIMAL_VALUE"]!), ".", choice($["DECIMAL_VALUE"]!, $["EXP_VALUE"]!)), $["EXP_VALUE"]!),
    LiteralInfinity: () => "*",

    // =====================================================================
    // NAMES
    // =====================================================================

    Name: ($) => choice($["ID"]!, $["UNRESTRICTED_NAME"]!),
    GlobalQualification: () => seq("$", "::"),
    Qualification: ($) => seq($["Name"]!, "::"),
    QualifiedName: ($) =>
      choice(
        seq(optional($["GlobalQualification"]!), field("name", $["Name"]!)),
        prec.left(1, seq($["QualifiedName"]!, "::", field("name", $["Name"]!))),
      ),

    // =====================================================================
    // TERMINALS
    // =====================================================================

    DECIMAL_VALUE: () => token(/[0-9]+/),
    EXP_VALUE: () => token(/[0-9]+[eE][+-]?[0-9]+/),
    ID: () => token(/[a-zA-Z_][a-zA-Z_0-9\u00B2\u00B3\u00B9\u2070-\u2079]*/),
    UNRESTRICTED_NAME: () => token(/'(?:[^'\\]|\\.)*'/),
    STRING_VALUE: () => token(/"(?:[^"\\]|\\.)*"/),
    REGULAR_COMMENT: () => token(/\/\*[^*]*\*+([^/*][^*]*\*+)*\//),
    ML_NOTE: () => token(/\/\*[^*]*\*+([^/*][^*]*\*+)*\//),
    SL_NOTE: () => token(/\/\/[^\r\n]*/),
  },

  polyglot: sysml2PolyglotConfig,
  tabular: sysml2TabularConfig,
});

export default sysml2Language;

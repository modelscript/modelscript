module.exports = grammar({
  name: "sysml2",
  extras: ($) => [/\s/, $.ML_NOTE, $.SL_NOTE],
  conflicts: ($) => [
    [$.LiteralInteger, $.RealValue],
    [$.FeatureReferenceMember, $.ElementReferenceMember, $.OwnedFeatureChaining],
    [$.Qualification],
    [$.FeatureChainMember, $.OwnedFeatureChaining],
    [$._FeatureChain],
    [$._postfix_operation],
    [
      $.DefaultReferenceUsage,
      $.ReferenceUsage,
      $.AttributeDefinition,
      $.AttributeUsage,
      $.EnumerationDefinition,
      $.EnumerationUsage,
      $.EnumeratedValue,
      $.OccurrenceDefinition,
      $.OccurrenceUsage,
      $.ItemDefinition,
      $.ItemUsage,
      $.PartDefinition,
      $.PartUsage,
      $.PortDefinition,
      $.PortUsage,
      $.ConnectionDefinition,
      $.ConnectionUsage,
      $.InterfaceDefinition,
      $.InterfaceUsage,
      $.AllocationDefinition,
      $.AllocationUsage,
      $.FlowDefinition,
      $.FlowUsage,
      $.SuccessionFlowUsage,
      $.BindingConnectorAsUsage,
      $.SuccessionAsUsage,
      $.ActionDefinition,
      $.ActionUsage,
      $.PerformActionUsage,
      $.CalculationDefinition,
      $.CalculationUsage,
      $.ConstraintDefinition,
      $.ConstraintUsage,
      $.AssertConstraintUsage,
      $.RequirementDefinition,
      $.RequirementUsage,
      $.SatisfyRequirementUsage,
      $.ConcernDefinition,
      $.ConcernUsage,
      $.CaseDefinition,
      $.CaseUsage,
      $.AnalysisCaseDefinition,
      $.AnalysisCaseUsage,
      $.VerificationCaseDefinition,
      $.VerificationCaseUsage,
      $.UseCaseDefinition,
      $.UseCaseUsage,
      $.IncludeUseCaseUsage,
      $.StateDefinition,
      $.StateUsage,
      $.ExhibitStateUsage,
      $.ViewDefinition,
      $.ViewUsage,
      $.ViewpointDefinition,
      $.ViewpointUsage,
      $.RenderingDefinition,
      $.RenderingUsage,
      $.MetadataDefinition,
      $.MetadataUsage,
      $.MergeNode,
      $.DecisionNode,
      $.JoinNode,
      $.ForkNode,
      $.AcceptActionNode,
      $.SendActionNode,
      $.AssignActionNode,
      $.VerifyRequirementUsage,
      $.ObjectiveRequirementUsage,
    ],
    [$._usage_modifier, $.ReferenceUsage],
    [$.PrefixMetadataAnnotation, $.PrefixMetadataMember],
    [$.OwnedReferenceSubsetting, $.OwnedFeatureChaining],
    [$.OwnedFeatureTyping, $.OwnedFeatureChaining],
    [$.OwnedSubsetting, $.OwnedFeatureChaining],
    [$.OwnedRedefinition, $.OwnedFeatureChaining],
    [$.OwnedCrossSubsetting, $.OwnedFeatureChaining],
    [$.Qualification, $.QualifiedName],
    [$._FeatureSpecializationPart],
    [$.MetadataUsage, $.ClassificationTestOperator],
    [$._Identification, $.QualifiedName],
    [$._Identification],
    [$._ActionBody, $.StateActionUsage],
    [$._ActionBodyItem, $._CalculationBody],
    [$.FeatureReferenceMember, $.InstantiatedTypeMember],
  ],
  word: ($) => $.ID,
  rules: {
    RootNamespace: ($) => repeat($._PackageBodyElement),
    _PackageBodyElement: ($) => choice($.PackageMember, $.ElementFilterMember, $.AliasMember, $.Import),
    _Identification: ($) =>
      choice(
        seq("<", field("declaredShortName", $.Name), ">", optional(field("declaredName", $.Name))),
        field("declaredName", $.Name),
      ),
    _RelationshipBody: ($) => choice(";", seq("{", repeat($.OwnedAnnotation), "}")),
    VisibilityIndicator: ($) => choice("public", "private", "protected"),
    Dependency: ($) =>
      seq(
        repeat($.PrefixMetadataAnnotation),
        "dependency",
        optional(seq(optional($._Identification), "from")),
        field("client", $.QualifiedName),
        repeat(seq(",", field("client", $.QualifiedName))),
        "to",
        field("supplier", $.QualifiedName),
        repeat(seq(",", field("supplier", $.QualifiedName))),
        $._RelationshipBody,
      ),
    Annotation: ($) => field("annotatedElement", $.QualifiedName),
    OwnedAnnotation: ($) => field("ownedRelatedElement", $._AnnotatingElement),
    AnnotatingMember: ($) => field("ownedRelatedElement", $._AnnotatingElement),
    _AnnotatingElement: ($) => choice($.Comment, $.Documentation, $.TextualRepresentation, $.MetadataUsage),
    Comment: ($) =>
      seq(
        optional(
          seq(
            "comment",
            optional($._Identification),
            optional(seq("about", $.Annotation, repeat(seq(",", $.Annotation)))),
          ),
        ),
        optional(seq("locale", field("locale", $.STRING_VALUE))),
        field("body", $.REGULAR_COMMENT),
      ),
    Documentation: ($) =>
      seq(
        "doc",
        optional($._Identification),
        optional(seq("locale", field("locale", $.STRING_VALUE))),
        field("body", $.REGULAR_COMMENT),
      ),
    TextualRepresentation: ($) =>
      seq(
        optional(seq("rep", optional($._Identification))),
        "language",
        field("language", $.STRING_VALUE),
        field("body", $.REGULAR_COMMENT),
      ),
    PrefixMetadataAnnotation: ($) => seq("#", field("ownedRelatedElement", $.PrefixMetadataUsage)),
    PrefixMetadataMember: ($) => seq("#", field("ownedRelatedElement", $.PrefixMetadataUsage)),
    PrefixMetadataUsage: ($) => field("ownedRelationship", $.MetadataTyping),
    MetadataUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        choice("metadata", "@"),
        optional(seq(optional($._Identification), optional(seq(choice(":", seq("defined", "by")))))),
        field("ownedRelationship", $.MetadataTyping),
        optional(seq("about", $.Annotation, repeat(seq(",", $.Annotation)))),
        $._MetadataBody,
      ),
    MetadataTyping: ($) => field("type", $.QualifiedName),
    _MetadataBody: ($) =>
      choice(
        ";",
        seq("{", repeat(choice($.DefinitionMember, $.MetadataBodyUsageMember, $.AliasMember, $.Import)), "}"),
      ),
    MetadataBodyUsageMember: ($) => field("ownedRelatedElement", $.MetadataBodyUsage),
    MetadataBodyUsage: ($) =>
      seq(
        optional("ref"),
        optional(choice(":>>", "redefines")),
        field("ownedRelationship", $.OwnedRedefinition),
        optional($._FeatureSpecializationPart),
        optional($._ValuePart),
        $._MetadataBody,
      ),
    MetadataDefinition: ($) => seq(repeat($._usage_modifier), "metadata", "def", $._Definition),
    Package: ($) => seq(repeat($._usage_modifier), "package", optional($._Identification), $._PackageBody),
    LibraryPackage: ($) =>
      seq(
        optional(field("isStandard", "standard")),
        "library",
        repeat($._usage_modifier),
        "package",
        optional($._Identification),
        $._PackageBody,
      ),
    _PackageBody: ($) => choice(";", seq("{", repeat($._PackageBodyElement), "}")),
    PackageMember: ($) =>
      seq(
        optional($.VisibilityIndicator),
        choice(field("ownedRelatedElement", $._DefinitionElement), field("ownedRelatedElement", $._UsageElement)),
      ),
    ElementFilterMember: ($) =>
      seq(optional($.VisibilityIndicator), "filter", field("ownedRelatedElement", $.OwnedExpression), ";"),
    AliasMember: ($) =>
      seq(
        optional($.VisibilityIndicator),
        "alias",
        optional(seq("<", field("memberShortName", $.Name), ">")),
        optional(field("memberName", $.Name)),
        "for",
        field("memberElement", $.QualifiedName),
        $._RelationshipBody,
      ),
    _ImportPrefix: ($) => seq(optional($.VisibilityIndicator), "import", optional(field("isImportAll", "all"))),
    Import: ($) => seq(choice($.MembershipImport, $.NamespaceImport), $._RelationshipBody),
    MembershipImport: ($) => seq($._ImportPrefix, $._ImportedMembership),
    _ImportedMembership: ($) =>
      seq(field("importedMembership", $.QualifiedName), optional(seq("::", field("isRecursive", "**")))),
    NamespaceImport: ($) =>
      seq($._ImportPrefix, choice($._ImportedNamespace, field("ownedRelatedElement", $.FilterPackage))),
    _ImportedNamespace: ($) =>
      seq(field("importedNamespace", $.QualifiedName), "::", "*", optional(seq("::", field("isRecursive", "**")))),
    FilterPackage: ($) => seq($.FilterPackageImport, repeat1($.FilterPackageMember)),
    FilterPackageImport: ($) => choice($.FilterPackageMembershipImport, $.FilterPackageNamespaceImport),
    FilterPackageMembershipImport: ($) => $._ImportedMembership,
    FilterPackageNamespaceImport: ($) => $._ImportedNamespace,
    FilterPackageMember: ($) => seq("[", field("ownedRelatedElement", $.OwnedExpression), "]"),
    _DefinitionElement: ($) =>
      choice(
        $.Package,
        $.LibraryPackage,
        $._AnnotatingElement,
        $.Dependency,
        $.AttributeDefinition,
        $.EnumerationDefinition,
        $.OccurrenceDefinition,
        $.ItemDefinition,
        $.MetadataDefinition,
        $.PartDefinition,
        $.ConnectionDefinition,
        $.FlowDefinition,
        $.InterfaceDefinition,
        $.AllocationDefinition,
        $.PortDefinition,
        $.ActionDefinition,
        $.CalculationDefinition,
        $.StateDefinition,
        $.ConstraintDefinition,
        $.RequirementDefinition,
        $.ConcernDefinition,
        $.CaseDefinition,
        $.AnalysisCaseDefinition,
        $.VerificationCaseDefinition,
        $.UseCaseDefinition,
        $.ViewDefinition,
        $.ViewpointDefinition,
        $.RenderingDefinition,
      ),
    _UsageElement: ($) => choice($._NonOccurrenceUsageElement, $._OccurrenceUsageElement),
    _NonOccurrenceUsageElement: ($) =>
      choice(
        $.DefaultReferenceUsage,
        $.ReferenceUsage,
        $.AttributeUsage,
        $.EnumerationUsage,
        $.BindingConnectorAsUsage,
        $.SuccessionAsUsage,
      ),
    _OccurrenceUsageElement: ($) => choice($._StructureUsageElement, $._BehaviorUsageElement),
    _StructureUsageElement: ($) =>
      choice(
        $.OccurrenceUsage,
        $.ItemUsage,
        $.PartUsage,
        $.PortUsage,
        $.ConnectionUsage,
        $.InterfaceUsage,
        $.AllocationUsage,
        $.FlowUsage,
        $.SuccessionFlowUsage,
        $.ViewUsage,
        $.RenderingUsage,
      ),
    _BehaviorUsageElement: ($) =>
      choice(
        $.ActionUsage,
        $.CalculationUsage,
        $.StateUsage,
        $.ConstraintUsage,
        $.RequirementUsage,
        $.ConcernUsage,
        $.CaseUsage,
        $.AnalysisCaseUsage,
        $.VerificationCaseUsage,
        $.UseCaseUsage,
        $.ViewpointUsage,
        $.PerformActionUsage,
        $.ExhibitStateUsage,
        $.IncludeUseCaseUsage,
        $.AssertConstraintUsage,
        $.SatisfyRequirementUsage,
      ),
    _SubclassificationPart: ($) =>
      seq(choice(":>", "specializes"), $.OwnedSubclassification, repeat(seq(",", $.OwnedSubclassification))),
    OwnedSubclassification: ($) => field("superclassifier", $.QualifiedName),
    _FeatureDeclaration: ($) =>
      choice(seq($._Identification, optional($._FeatureSpecializationPart)), $._FeatureSpecializationPart),
    _FeatureSpecializationPart: ($) =>
      choice(
        seq(repeat1($._FeatureSpecialization), optional($._MultiplicityPart), repeat($._FeatureSpecialization)),
        seq($._MultiplicityPart, repeat($._FeatureSpecialization)),
      ),
    _MultiplicityPart: ($) =>
      choice(
        $.OwnedMultiplicity,
        seq(
          optional($.OwnedMultiplicity),
          choice(
            seq(field("isOrdered", "ordered"), optional(field("isNonunique", "nonunique"))),
            seq(field("isNonunique", "nonunique"), optional(field("isOrdered", "ordered"))),
          ),
        ),
      ),
    _FeatureSpecialization: ($) => choice($._Typings, $._Subsettings, $._References, $._Crosses, $._Redefinitions),
    _Typings: ($) => seq(choice(":", seq("defined", "by")), $.FeatureTyping, repeat(seq(",", $.FeatureTyping))),
    _Subsettings: ($) => seq(choice(":>", "subsets"), $.OwnedSubsetting, repeat(seq(",", $.OwnedSubsetting))),
    _References: ($) => seq(choice("::>", "references"), $.OwnedReferenceSubsetting),
    _Crosses: ($) => seq(choice("=>", "crosses"), $.OwnedCrossSubsetting),
    _Redefinitions: ($) => seq(choice(":>>", "redefines"), $.OwnedRedefinition, repeat(seq(",", $.OwnedRedefinition))),
    FeatureTyping: ($) => choice($.OwnedFeatureTyping, $.ConjugatedPortTyping),
    OwnedFeatureTyping: ($) =>
      choice(field("type", $.QualifiedName), field("ownedRelatedElement", $.OwnedFeatureChain)),
    OwnedSubsetting: ($) =>
      choice(field("subsettedFeature", $.QualifiedName), field("ownedRelatedElement", $.OwnedFeatureChain)),
    OwnedReferenceSubsetting: ($) =>
      choice(field("referencedFeature", $.QualifiedName), field("ownedRelatedElement", $.OwnedFeatureChain)),
    OwnedCrossSubsetting: ($) =>
      choice(field("crossedFeature", $.QualifiedName), field("ownedRelatedElement", $.OwnedFeatureChain)),
    OwnedRedefinition: ($) =>
      choice(field("redefinedFeature", $.QualifiedName), field("ownedRelatedElement", $.OwnedFeatureChain)),
    OwnedMultiplicity: ($) => field("ownedRelatedElement", $.MultiplicityRange),
    MultiplicityRange: ($) =>
      seq(
        "[",
        field("lowerBound", $.MultiplicityExpressionMember),
        optional(seq("..", field("upperBound", $.MultiplicityExpressionMember))),
        "]",
      ),
    MultiplicityExpressionMember: ($) =>
      field("ownedRelatedElement", choice($._LiteralExpression, $.FeatureReferenceExpression)),
    _Definition: ($) => seq(optional($._Identification), optional($._SubclassificationPart), $._DefinitionBody),
    _DefinitionBody: ($) => choice(";", seq("{", repeat($._DefinitionBodyItem), "}")),
    _DefinitionBodyItem: ($) =>
      choice(
        $.DefinitionMember,
        $.VariantUsageMember,
        $.NonOccurrenceUsageMember,
        seq(optional($.EmptySuccessionMember), $.OccurrenceUsageMember),
        $.AliasMember,
        $.Import,
      ),
    DefinitionMember: ($) => seq(optional($.VisibilityIndicator), field("ownedRelatedElement", $._DefinitionElement)),
    VariantUsageMember: ($) =>
      seq(optional($.VisibilityIndicator), "variant", field("ownedRelatedElement", $._UsageElement)),
    NonOccurrenceUsageMember: ($) =>
      seq(optional($.VisibilityIndicator), field("ownedRelatedElement", $._NonOccurrenceUsageElement)),
    OccurrenceUsageMember: ($) =>
      seq(optional($.VisibilityIndicator), field("ownedRelatedElement", $._OccurrenceUsageElement)),
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
        "individual",
        "snapshot",
        "timeslice",
        $.PrefixMetadataMember,
      ),
    _UsageDeclaration: ($) => $._FeatureDeclaration,
    _UsageCompletion: ($) => seq(optional($._ValuePart), $._DefinitionBody),
    _Usage: ($) => seq(optional($._UsageDeclaration), $._UsageCompletion),
    _ValuePart: ($) => $.FeatureValue,
    FeatureValue: ($) =>
      seq(
        choice(
          "=",
          field("isInitial", ":="),
          seq(field("isDefault", "default"), optional(choice("=", field("isInitial", ":=")))),
        ),
        field("ownedRelatedElement", $.OwnedExpression),
      ),
    DefaultReferenceUsage: ($) =>
      seq(repeat($._usage_modifier), $._UsageDeclaration, optional($._ValuePart), $._DefinitionBody),
    ReferenceUsage: ($) => seq(repeat($._usage_modifier), "ref", $._Usage),
    AttributeDefinition: ($) => seq(repeat($._usage_modifier), "attribute", "def", $._Definition),
    AttributeUsage: ($) => seq(repeat($._usage_modifier), "attribute", $._Usage),
    EnumerationDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        "enum",
        "def",
        optional($._Identification),
        optional($._SubclassificationPart),
        $._EnumerationBody,
      ),
    _EnumerationBody: ($) => choice(";", seq("{", repeat(choice($.AnnotatingMember, $.EnumerationUsageMember)), "}")),
    EnumerationUsageMember: ($) =>
      seq(optional($.VisibilityIndicator), field("ownedRelatedElement", $.EnumeratedValue)),
    EnumeratedValue: ($) => seq(repeat($._usage_modifier), optional("enum"), $._Usage),
    EnumerationUsage: ($) => seq(repeat($._usage_modifier), "enum", $._Usage),
    OccurrenceDefinition: ($) => seq(repeat($._usage_modifier), "occurrence", "def", $._Definition),
    OccurrenceUsage: ($) => seq(repeat($._usage_modifier), "occurrence", $._Usage),
    ItemDefinition: ($) => seq(repeat($._usage_modifier), "item", "def", $._Definition),
    ItemUsage: ($) => seq(repeat($._usage_modifier), "item", $._Usage),
    PartDefinition: ($) => seq(repeat($._usage_modifier), "part", "def", $._Definition),
    PartUsage: ($) => seq(repeat($._usage_modifier), "part", $._Usage),
    PortDefinition: ($) => seq(repeat($._usage_modifier), "port", "def", $._Definition),
    PortUsage: ($) => seq(repeat($._usage_modifier), "port", $._Usage),
    ConjugatedPortTyping: ($) => seq("~", field("conjugatedPortDefinition", $.QualifiedName)),
    ConnectorEndMember: ($) => field("ownedRelatedElement", $.ConnectorEnd),
    ConnectorEnd: ($) =>
      seq(
        optional(field("ownedRelationship", $.OwnedMultiplicity)),
        optional(seq(field("declaredName", $.Name), choice("::>", "references"))),
        $.OwnedReferenceSubsetting,
      ),
    ConnectionDefinition: ($) => seq(repeat($._usage_modifier), "connection", "def", $._Definition),
    ConnectionUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        choice(
          seq(
            "connection",
            optional($._UsageDeclaration),
            optional($._ValuePart),
            optional(seq("connect", $._ConnectorPart)),
          ),
          seq("connect", $._ConnectorPart),
        ),
        $._DefinitionBody,
      ),
    _ConnectorPart: ($) => choice($._BinaryConnectorPart, $._NaryConnectorPart),
    _BinaryConnectorPart: ($) => seq($.ConnectorEndMember, "to", $.ConnectorEndMember),
    _NaryConnectorPart: ($) =>
      seq("(", $.ConnectorEndMember, ",", $.ConnectorEndMember, repeat(seq(",", $.ConnectorEndMember)), ")"),
    BindingConnectorAsUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        optional(seq("binding", optional($._UsageDeclaration))),
        "bind",
        $.ConnectorEndMember,
        "=",
        $.ConnectorEndMember,
        $._DefinitionBody,
      ),
    SuccessionAsUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        optional(seq("succession", optional($._UsageDeclaration))),
        "first",
        $.ConnectorEndMember,
        "then",
        $.ConnectorEndMember,
        $._DefinitionBody,
      ),
    InterfaceDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        "interface",
        "def",
        optional($._Identification),
        optional($._SubclassificationPart),
        $._DefinitionBody,
      ),
    InterfaceUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "interface",
        optional($._UsageDeclaration),
        optional(seq("connect", $._ConnectorPart)),
        $._DefinitionBody,
      ),
    AllocationDefinition: ($) => seq(repeat($._usage_modifier), "allocation", "def", $._Definition),
    AllocationUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        choice(
          seq("allocation", optional($._UsageDeclaration), optional(seq("allocate", $._ConnectorPart))),
          seq("allocate", $._ConnectorPart),
        ),
        $._DefinitionBody,
      ),
    FlowDefinition: ($) => seq(repeat($._usage_modifier), "flow", "def", $._Definition),
    FlowUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "flow",
        choice(
          seq($.FlowEndMember, "to", $.FlowEndMember),
          seq(
            optional($._UsageDeclaration),
            optional($._ValuePart),
            optional(seq("of", $.PayloadFeatureMember)),
            optional(seq("from", $.FlowEndMember, "to", $.FlowEndMember)),
          ),
        ),
        $._DefinitionBody,
      ),
    SuccessionFlowUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "succession",
        "flow",
        choice(
          seq($.FlowEndMember, "to", $.FlowEndMember),
          seq(
            optional($._UsageDeclaration),
            optional($._ValuePart),
            optional(seq("of", $.PayloadFeatureMember)),
            optional(seq("from", $.FlowEndMember, "to", $.FlowEndMember)),
          ),
        ),
        $._DefinitionBody,
      ),
    PayloadFeatureMember: ($) => field("ownedRelatedElement", $.PayloadFeature),
    PayloadFeature: ($) =>
      choice(
        seq(optional($._Identification), $._FeatureSpecializationPart, optional($._ValuePart)),
        seq(optional($._Identification), $._ValuePart),
        seq($.OwnedFeatureTyping, optional($.OwnedMultiplicity)),
        seq($.OwnedMultiplicity, $.OwnedFeatureTyping),
      ),
    FlowEndMember: ($) => field("ownedRelatedElement", $.FlowEnd),
    FlowEnd: ($) =>
      seq(optional(seq($.OwnedReferenceSubsetting, ".")), field("ownedRelationship", $.FlowFeatureMember)),
    FlowFeatureMember: ($) => field("ownedRelatedElement", $.FlowFeature),
    FlowFeature: ($) => field("ownedRelationship", $.QualifiedName),
    ActionDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        "action",
        "def",
        optional($._Identification),
        optional($._SubclassificationPart),
        optional($._ParameterList),
        $._ActionBody,
      ),
    _ActionBody: ($) => choice(";", seq("{", repeat($._ActionBodyItem), "}")),
    _ActionBodyItem: ($) =>
      choice(
        $.Import,
        $.AliasMember,
        $.DefinitionMember,
        $.VariantUsageMember,
        $.NonOccurrenceUsageMember,
        seq(optional($.EmptySuccessionMember), $._OccurrenceUsageElement),
        $.ActionNodeMember,
        $.ReturnParameterMember,
      ),
    EmptySuccessionMember: ($) => seq("then", field("ownedRelatedElement", $.MultiplicitySourceEnd)),
    MultiplicitySourceEnd: ($) => field("ownedRelationship", $.OwnedMultiplicity),
    ActionNodeMember: ($) => seq(optional($.VisibilityIndicator), field("ownedRelatedElement", $._ActionNode)),
    _ActionNode: ($) =>
      choice(
        $.IfNode,
        $.WhileLoopNode,
        $.ForLoopNode,
        $.ControlNode,
        $.AcceptActionNode,
        $.SendActionNode,
        $.AssignActionNode,
      ),
    IfNode: ($) =>
      seq(
        repeat($._usage_modifier),
        optional(seq("action", optional($._UsageDeclaration))),
        "if",
        field("condition", $.OwnedExpression),
        field("thenBody", $.ActionBodyParameter),
        optional(seq("else", choice(field("elseBody", $.ActionBodyParameter), $.IfNode))),
      ),
    ActionBodyParameter: ($) =>
      seq(optional(seq("action", optional($._UsageDeclaration))), "{", repeat($._ActionBodyItem), "}"),
    WhileLoopNode: ($) =>
      seq(
        repeat($._usage_modifier),
        optional(seq("action", optional($._UsageDeclaration))),
        choice(seq("while", field("condition", $.OwnedExpression)), "loop"),
        $.ActionBodyParameter,
        optional(seq("until", field("untilCondition", $.OwnedExpression), ";")),
      ),
    ForLoopNode: ($) =>
      seq(
        repeat($._usage_modifier),
        optional(seq("action", optional($._UsageDeclaration))),
        "for",
        field("variable", $.ForVariableDeclaration),
        "in",
        field("range", $.OwnedExpression),
        $.ActionBodyParameter,
      ),
    ForVariableDeclaration: ($) => $._UsageDeclaration,
    ControlNode: ($) => choice($.MergeNode, $.DecisionNode, $.JoinNode, $.ForkNode),
    MergeNode: ($) => seq(repeat($._usage_modifier), "merge", optional($._UsageDeclaration), $._ActionBody),
    DecisionNode: ($) => seq(repeat($._usage_modifier), "decide", optional($._UsageDeclaration), $._ActionBody),
    JoinNode: ($) => seq(repeat($._usage_modifier), "join", optional($._UsageDeclaration), $._ActionBody),
    ForkNode: ($) => seq(repeat($._usage_modifier), "fork", optional($._UsageDeclaration), $._ActionBody),
    ActionUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "action",
        optional($._UsageDeclaration),
        optional($._ValuePart),
        optional($._ParameterList),
        $._ActionBody,
      ),
    AcceptActionNode: ($) =>
      seq(
        repeat($._usage_modifier),
        optional(seq("action", optional($._UsageDeclaration))),
        "accept",
        $.PayloadFeatureMember,
        optional(seq("via", $.OwnedReferenceSubsetting)),
        $._ActionBody,
      ),
    SendActionNode: ($) =>
      seq(
        repeat($._usage_modifier),
        optional(seq("action", optional($._UsageDeclaration))),
        "send",
        field("sentItem", $.OwnedExpression),
        optional(seq("via", $.OwnedReferenceSubsetting)),
        optional(seq("to", field("receiver", $.OwnedExpression))),
        $._ActionBody,
      ),
    AssignActionNode: ($) =>
      seq(
        repeat($._usage_modifier),
        optional(seq("action", optional($._UsageDeclaration))),
        "assign",
        field("assignedValue", $.OwnedExpression),
        "=:",
        field("targetFeature", $.OwnedExpression),
        $._ActionBody,
      ),
    PerformActionUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "perform",
        choice(
          seq($.OwnedReferenceSubsetting, optional($._FeatureSpecializationPart)),
          seq("action", optional($._UsageDeclaration)),
        ),
        optional($._ValuePart),
        $._ActionBody,
      ),
    CalculationDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        "calc",
        "def",
        optional($._Identification),
        optional($._SubclassificationPart),
        optional($._ParameterList),
        $._CalculationBody,
      ),
    _CalculationBody: ($) =>
      choice(
        ";",
        seq("{", repeat(choice($._ActionBodyItem, $.ReturnParameterMember)), optional($.ResultExpressionMember), "}"),
      ),
    _ParameterList: ($) => seq("(", optional(seq($.ParameterMember, repeat(seq(",", $.ParameterMember)))), ")"),
    ParameterMember: ($) => seq(optional($.VisibilityIndicator), field("ownedRelatedElement", $._UsageElement)),
    ReturnParameterMember: ($) =>
      seq(optional($.VisibilityIndicator), "return", field("ownedRelatedElement", $._UsageElement)),
    ResultExpressionMember: ($) =>
      seq(optional($.VisibilityIndicator), field("ownedRelatedElement", $.OwnedExpression)),
    CalculationUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "calc",
        optional($._UsageDeclaration),
        optional($._ValuePart),
        optional($._ParameterList),
        $._CalculationBody,
      ),
    ConstraintDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        "constraint",
        "def",
        optional($._Identification),
        optional($._SubclassificationPart),
        $._CalculationBody,
      ),
    ConstraintUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "constraint",
        optional($._UsageDeclaration),
        optional($._ValuePart),
        $._CalculationBody,
      ),
    AssertConstraintUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "assert",
        optional(field("isNegated", "not")),
        choice(
          seq($.OwnedReferenceSubsetting, optional($._FeatureSpecializationPart)),
          seq("constraint", optional($._UsageDeclaration), optional($._ValuePart)),
        ),
        $._CalculationBody,
      ),
    RequirementDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        "requirement",
        "def",
        optional($._Identification),
        optional($._SubclassificationPart),
        $._RequirementBody,
      ),
    _RequirementBody: ($) => choice(";", seq("{", repeat($._RequirementBodyItem), "}")),
    _RequirementBodyItem: ($) =>
      choice($._DefinitionBodyItem, $.SubjectMember, $.RequirementConstraintMember, $.ActorMember, $.StakeholderMember),
    SubjectMember: ($) => seq(optional($.VisibilityIndicator), field("ownedRelatedElement", $.SubjectUsage)),
    SubjectUsage: ($) => seq("subject", repeat($._usage_modifier), $._Usage),
    RequirementConstraintMember: ($) =>
      seq(
        optional($.VisibilityIndicator),
        field("constraintKind", choice("assume", "require")),
        field("ownedRelatedElement", $.RequirementConstraintUsage),
      ),
    RequirementConstraintUsage: ($) =>
      choice(
        seq($.OwnedReferenceSubsetting, repeat($._FeatureSpecialization), $._CalculationBody),
        seq(
          repeat($._usage_modifier),
          optional("constraint"),
          optional($._UsageDeclaration),
          optional($._ValuePart),
          $._CalculationBody,
        ),
      ),
    ActorMember: ($) => seq(optional($.VisibilityIndicator), field("ownedRelatedElement", $.ActorUsage)),
    ActorUsage: ($) => seq("actor", repeat($._usage_modifier), $._Usage),
    StakeholderMember: ($) => seq(optional($.VisibilityIndicator), field("ownedRelatedElement", $.StakeholderUsage)),
    StakeholderUsage: ($) => seq("stakeholder", repeat($._usage_modifier), $._Usage),
    RequirementUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "requirement",
        optional($._UsageDeclaration),
        optional($._ValuePart),
        $._RequirementBody,
      ),
    SatisfyRequirementUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        optional("assert"),
        optional(field("isNegated", "not")),
        "satisfy",
        choice(
          seq($.OwnedReferenceSubsetting, optional($._FeatureSpecializationPart)),
          seq("requirement", optional($._UsageDeclaration)),
        ),
        optional($._ValuePart),
        optional(seq("by", field("satisfyingFeature", $.OwnedReferenceSubsetting))),
        $._RequirementBody,
      ),
    ConcernDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        "concern",
        "def",
        optional($._Identification),
        optional($._SubclassificationPart),
        $._RequirementBody,
      ),
    ConcernUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "concern",
        optional($._UsageDeclaration),
        optional($._ValuePart),
        $._RequirementBody,
      ),
    CaseDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        "case",
        "def",
        optional($._Identification),
        optional($._SubclassificationPart),
        $._CaseBody,
      ),
    _CaseBody: ($) =>
      choice(
        ";",
        seq(
          "{",
          repeat(choice($._ActionBodyItem, $.SubjectMember, $.ActorMember, $.StakeholderMember, $.ObjectiveMember)),
          optional($.ResultExpressionMember),
          "}",
        ),
      ),
    CaseUsage: ($) =>
      seq(repeat($._usage_modifier), "case", optional($._UsageDeclaration), optional($._ValuePart), $._CaseBody),
    AnalysisCaseDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        "analysis",
        "def",
        optional($._Identification),
        optional($._SubclassificationPart),
        $._CaseBody,
      ),
    AnalysisCaseUsage: ($) =>
      seq(repeat($._usage_modifier), "analysis", optional($._UsageDeclaration), optional($._ValuePart), $._CaseBody),
    VerificationCaseDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        "verification",
        "def",
        optional($._Identification),
        optional($._SubclassificationPart),
        $._VerificationBody,
      ),
    VerificationCaseUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "verification",
        optional($._UsageDeclaration),
        optional($._ValuePart),
        $._VerificationBody,
      ),
    _VerificationBody: ($) =>
      choice(";", seq("{", repeat($._VerificationBodyItem), optional($.ResultExpressionMember), "}")),
    _VerificationBodyItem: ($) => choice($._ActionBodyItem, $.VerifyRequirementUsageMember, $.ObjectiveMember),
    VerifyRequirementUsageMember: ($) =>
      seq(optional($.VisibilityIndicator), field("ownedRelatedElement", $.VerifyRequirementUsage)),
    VerifyRequirementUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "verify",
        choice(
          seq($.OwnedReferenceSubsetting, optional($._FeatureSpecializationPart)),
          seq("requirement", optional($._UsageDeclaration)),
        ),
        optional($._ValuePart),
        $._RequirementBody,
      ),
    ObjectiveMember: ($) =>
      seq(optional($.VisibilityIndicator), field("ownedRelatedElement", $.ObjectiveRequirementUsage)),
    ObjectiveRequirementUsage: ($) =>
      seq(
        "objective",
        repeat($._usage_modifier),
        optional($._UsageDeclaration),
        optional($._ValuePart),
        $._RequirementBody,
      ),
    UseCaseDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        "use",
        "case",
        "def",
        optional($._Identification),
        optional($._SubclassificationPart),
        $._CaseBody,
      ),
    UseCaseUsage: ($) =>
      seq(repeat($._usage_modifier), "use", "case", optional($._UsageDeclaration), optional($._ValuePart), $._CaseBody),
    IncludeUseCaseUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "include",
        choice(
          seq($.OwnedReferenceSubsetting, optional($._FeatureSpecializationPart)),
          seq("use", "case", optional($._UsageDeclaration)),
        ),
        optional($._ValuePart),
        $._CaseBody,
      ),
    StateDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        "state",
        "def",
        optional($._Identification),
        optional($._SubclassificationPart),
        choice(";", seq(optional(field("isParallel", "parallel")), "{", repeat($._StateBodyItem), "}")),
      ),
    _StateBodyItem: ($) =>
      choice(
        $.Import,
        $.AliasMember,
        $.DefinitionMember,
        $.VariantUsageMember,
        $.NonOccurrenceUsageMember,
        seq(optional($.EmptySuccessionMember), $._OccurrenceUsageElement),
        $.TransitionUsageMember,
        $.EntryActionMember,
        $.DoActionMember,
        $.ExitActionMember,
      ),
    EntryActionMember: ($) =>
      seq(optional($.VisibilityIndicator), "entry", field("ownedRelatedElement", $.StateActionUsage)),
    DoActionMember: ($) => seq(optional($.VisibilityIndicator), "do", field("ownedRelatedElement", $.StateActionUsage)),
    ExitActionMember: ($) =>
      seq(optional($.VisibilityIndicator), "exit", field("ownedRelatedElement", $.StateActionUsage)),
    StateActionUsage: ($) => choice(";", seq(optional($._UsageDeclaration), optional($._ValuePart), $._ActionBody)),
    StateUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "state",
        optional($._UsageDeclaration),
        optional($._ValuePart),
        choice(";", seq(optional(field("isParallel", "parallel")), "{", repeat($._StateBodyItem), "}")),
      ),
    ExhibitStateUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "exhibit",
        choice(
          seq($.OwnedReferenceSubsetting, optional($._FeatureSpecializationPart)),
          seq("state", optional($._UsageDeclaration)),
        ),
        optional($._ValuePart),
        choice(";", seq(optional(field("isParallel", "parallel")), "{", repeat($._StateBodyItem), "}")),
      ),
    TransitionUsageMember: ($) => seq(optional($.VisibilityIndicator), field("ownedRelatedElement", $.TransitionUsage)),
    TransitionUsage: ($) =>
      seq(
        "transition",
        optional(seq(optional($._UsageDeclaration), "first")),
        field("source", $.QualifiedName),
        optional(seq("accept", $.PayloadFeatureMember)),
        optional(seq("if", field("guard", $.OwnedExpression))),
        optional(seq("do", field("effect", $.StateActionUsage))),
        "then",
        $.ConnectorEndMember,
        $._ActionBody,
      ),
    ViewDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        "view",
        "def",
        optional($._Identification),
        optional($._SubclassificationPart),
        choice(";", seq("{", repeat(choice($._DefinitionBodyItem, $.ElementFilterMember)), "}")),
      ),
    ViewUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "view",
        optional($._UsageDeclaration),
        optional($._ValuePart),
        choice(";", seq("{", repeat(choice($._DefinitionBodyItem, $.ElementFilterMember)), "}")),
      ),
    ViewpointDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        "viewpoint",
        "def",
        optional($._Identification),
        optional($._SubclassificationPart),
        $._RequirementBody,
      ),
    ViewpointUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        "viewpoint",
        optional($._UsageDeclaration),
        optional($._ValuePart),
        $._RequirementBody,
      ),
    RenderingDefinition: ($) => seq(repeat($._usage_modifier), "rendering", "def", $._Definition),
    RenderingUsage: ($) => seq(repeat($._usage_modifier), "rendering", $._Usage),
    OwnedExpressionMember: ($) => field("ownedRelatedElement", $.OwnedExpression),
    OwnedExpression: ($) => $._Expression,
    _Expression: ($) =>
      choice(
        $.ConditionalExpression,
        $.NullCoalescingExpression,
        $.ImpliesExpression,
        $.OrExpression,
        $.XorExpression,
        $.AndExpression,
        $.EqualityExpression,
        $.ClassificationExpression,
        $.RelationalExpression,
        $.RangeExpression,
        $.AdditiveExpression,
        $.MultiplicativeExpression,
        $.ExponentiationExpression,
        $.UnaryExpression,
        $.ExtentExpression,
        $.PrimaryExpression,
        $._BaseExpression,
      ),
    OwnedExpressionReference: ($) => field("ownedRelationship", $.OwnedExpressionMember),
    ConditionalExpression: ($) =>
      prec.right(
        1,
        seq(
          field("operator", "if"),
          field("operand", $._Expression),
          "?",
          field("thenOperand", $.OwnedExpressionReference),
          "else",
          field("elseOperand", $.OwnedExpressionReference),
        ),
      ),
    NullCoalescingExpression: ($) =>
      prec.left(
        2,
        seq(
          field("operand", $._Expression),
          repeat1(seq(field("operator", "??"), field("operand", $.ImpliesExpressionReference))),
        ),
      ),
    ImpliesExpressionReference: ($) => field("ownedRelationship", $.ImpliesExpressionMember),
    ImpliesExpressionMember: ($) => field("ownedRelatedElement", $._Expression),
    ImpliesExpression: ($) =>
      prec.left(
        3,
        seq(
          field("operand", $._Expression),
          repeat1(seq(field("operator", "implies"), field("operand", $.ImpliesExpressionReference))),
        ),
      ),
    OrExpressionReference: ($) => field("ownedRelationship", $.OrExpressionMember),
    OrExpressionMember: ($) => field("ownedRelatedElement", $._Expression),
    OrExpression: ($) =>
      prec.left(
        4,
        seq(
          field("operand", $._Expression),
          repeat1(
            choice(
              seq(field("operator", "|"), field("operand", $._Expression)),
              seq(field("operator", "or"), field("operand", $.XorExpressionReference)),
            ),
          ),
        ),
      ),
    XorExpressionReference: ($) => field("ownedRelationship", $.XorExpressionMember),
    XorExpressionMember: ($) => field("ownedRelatedElement", $._Expression),
    XorExpression: ($) =>
      prec.left(
        5,
        seq(field("operand", $._Expression), repeat1(seq(field("operator", "xor"), field("operand", $._Expression)))),
      ),
    AndExpression: ($) =>
      prec.left(
        6,
        seq(
          field("operand", $._Expression),
          repeat1(
            choice(
              seq(field("operator", "&"), field("operand", $._Expression)),
              seq(field("operator", "and"), field("operand", $.EqualityExpressionReference)),
            ),
          ),
        ),
      ),
    EqualityExpressionReference: ($) => field("ownedRelationship", $.EqualityExpressionMember),
    EqualityExpressionMember: ($) => field("ownedRelatedElement", $._Expression),
    EqualityExpression: ($) =>
      prec.left(
        7,
        seq(
          field("operand", $._Expression),
          repeat1(seq(field("operator", $.EqualityOperator), field("operand", $._Expression))),
        ),
      ),
    EqualityOperator: ($) => choice("==", "!=", "===", "!=="),
    ClassificationExpression: ($) =>
      prec(
        8,
        choice(
          seq(
            field("operand", $._Expression),
            choice(
              seq(field("operator", $.ClassificationTestOperator), field("typeReference", $.TypeReferenceMember)),
              seq(field("operator", $.CastOperator), field("typeResult", $.TypeResultMember)),
            ),
          ),
          seq(field("operator", $.ClassificationTestOperator), field("typeReference", $.TypeReferenceMember)),
          seq(
            field("operand", $.MetadataReference),
            field("operator", $.MetaClassificationTestOperator),
            field("typeReference", $.TypeReferenceMember),
          ),
          seq(field("operator", $.CastOperator), field("typeResult", $.TypeResultMember)),
          seq(
            field("operand", $.MetadataReference),
            field("operator", $.MetaCastOperator),
            field("typeResult", $.TypeResultMember),
          ),
        ),
      ),
    ClassificationTestOperator: ($) => choice("hastype", "istype", "@"),
    MetaClassificationTestOperator: ($) => "@@",
    CastOperator: ($) => "as",
    MetaCastOperator: ($) => "meta",
    MetadataReference: ($) => field("ownedRelationship", $.ElementReferenceMember),
    TypeReferenceMember: ($) => field("ownedRelatedElement", $.TypeReference),
    TypeResultMember: ($) => field("ownedRelatedElement", $.TypeReference),
    TypeReference: ($) => field("ownedRelationship", $.ReferenceTyping),
    ReferenceTyping: ($) => field("type", $.QualifiedName),
    RelationalExpression: ($) =>
      prec.left(
        9,
        seq(
          field("operand", $._Expression),
          repeat1(seq(field("operator", $.RelationalOperator), field("operand", $._Expression))),
        ),
      ),
    RelationalOperator: ($) => choice("<", ">", "<=", ">="),
    RangeExpression: ($) =>
      prec.left(10, seq(field("operand", $._Expression), field("operator", ".."), field("operand", $._Expression))),
    AdditiveExpression: ($) =>
      prec.left(
        11,
        seq(
          field("operand", $._Expression),
          repeat1(seq(field("operator", $.AdditiveOperator), field("operand", $._Expression))),
        ),
      ),
    AdditiveOperator: ($) => choice("+", "-"),
    MultiplicativeExpression: ($) =>
      prec.left(
        12,
        seq(
          field("operand", $._Expression),
          repeat1(seq(field("operator", $.MultiplicativeOperator), field("operand", $._Expression))),
        ),
      ),
    MultiplicativeOperator: ($) => choice("*", "/", "%"),
    ExponentiationExpression: ($) =>
      prec.right(
        13,
        seq(
          field("operand", $._Expression),
          field("operator", $.ExponentiationOperator),
          field("operand", $._Expression),
        ),
      ),
    ExponentiationOperator: ($) => choice("**", "^"),
    UnaryExpression: ($) => prec(14, seq(field("operator", $.UnaryOperator), field("operand", $._Expression))),
    UnaryOperator: ($) => choice("+", "-", "~", "not"),
    ExtentExpression: ($) => prec(15, seq(field("operator", "all"), field("typeResult", $.TypeResultMember))),
    _postfix_operation: ($) =>
      seq(
        choice(
          seq("#", "(", field("indexOperand", $.SequenceExpression), ")"),
          seq(field("operator", "["), field("filterOperand", $.SequenceExpression), "]"),
          seq(
            "->",
            field("invocationType", $.InstantiatedTypeMember),
            choice(
              field("body", $.BodyExpression),
              field("functionRef", $.FunctionReferenceExpression),
              $._ArgumentList,
            ),
          ),
          seq(".", field("collect", $.BodyExpression)),
          seq(".?", field("select", $.BodyExpression)),
        ),
        optional(seq(".", field("featureChain", $.FeatureChainMember))),
      ),
    PrimaryExpression: ($) =>
      prec.left(
        16,
        choice(
          seq(
            field("base", $._BaseExpression),
            seq(".", field("featureChain", $.FeatureChainMember)),
            repeat($._postfix_operation),
          ),
          seq(field("base", $._BaseExpression), repeat1($._postfix_operation)),
        ),
      ),
    FunctionReferenceExpression: ($) => field("ownedRelationship", $.FunctionReferenceMember),
    FunctionReferenceMember: ($) => field("ownedRelatedElement", $.FunctionReference),
    FunctionReference: ($) => field("ownedRelationship", $.ReferenceTyping),
    FeatureChainMember: ($) =>
      choice(field("memberElement", $.QualifiedName), field("ownedRelatedElement", $.OwnedFeatureChain)),
    OwnedFeatureChain: ($) => $._FeatureChain,
    _BaseExpression: ($) =>
      choice(
        $.NullExpression,
        $._LiteralExpression,
        $.FeatureReferenceExpression,
        $.MetadataAccessExpression,
        $.InvocationExpression,
        $.ConstructorExpression,
        $.BodyExpression,
        seq("(", $.SequenceExpression, ")"),
      ),
    BodyExpression: ($) => field("ownedRelationship", $.ExpressionBodyMember),
    ExpressionBodyMember: ($) => field("ownedRelatedElement", $.ExpressionBody),
    ExpressionBody: ($) => $._CalculationBody,
    SequenceExpression: ($) =>
      seq(
        $.OwnedExpression,
        optional(choice(",", seq(field("operator", ","), field("operand", $.SequenceExpression)))),
      ),
    FeatureReferenceExpression: ($) => field("ownedRelationship", $.FeatureReferenceMember),
    FeatureReferenceMember: ($) => field("memberElement", $.QualifiedName),
    MetadataAccessExpression: ($) => seq(field("ownedRelationship", $.ElementReferenceMember), ".", "metadata"),
    ElementReferenceMember: ($) => field("memberElement", $.QualifiedName),
    InvocationExpression: ($) => seq(field("type", $.InstantiatedTypeMember), $._ArgumentList),
    ConstructorExpression: ($) =>
      seq("new", field("type", $.InstantiatedTypeMember), field("result", $.ConstructorResultMember)),
    ConstructorResultMember: ($) => field("ownedRelatedElement", $.ConstructorResult),
    ConstructorResult: ($) => $._ArgumentList,
    InstantiatedTypeMember: ($) =>
      choice(field("memberElement", $.QualifiedName), field("ownedRelatedElement", $.OwnedFeatureChain)),
    _FeatureChain: ($) =>
      seq(field("chaining", $.OwnedFeatureChaining), repeat1(seq(".", field("chaining", $.OwnedFeatureChaining)))),
    OwnedFeatureChaining: ($) => field("chainingFeature", $.QualifiedName),
    _ArgumentList: ($) => seq("(", optional(choice($._PositionalArgumentList, $._NamedArgumentList)), ")"),
    _PositionalArgumentList: ($) =>
      seq(field("argument", $.ArgumentMember), repeat(seq(",", field("argument", $.ArgumentMember)))),
    ArgumentMember: ($) => field("ownedRelatedElement", $.Argument),
    Argument: ($) => field("ownedRelationship", $.ArgumentValue),
    _NamedArgumentList: ($) =>
      seq(
        field("namedArgument", $.NamedArgumentMember),
        repeat(seq(",", field("namedArgument", $.NamedArgumentMember))),
      ),
    NamedArgumentMember: ($) => field("ownedRelatedElement", $.NamedArgument),
    NamedArgument: ($) =>
      seq(field("parameterRedefinition", $.ParameterRedefinition), "=", field("value", $.ArgumentValue)),
    ParameterRedefinition: ($) => field("redefinedFeature", $.QualifiedName),
    ArgumentValue: ($) => field("ownedRelatedElement", $.OwnedExpression),
    NullExpression: ($) => choice("null", seq("(", ")")),
    _LiteralExpression: ($) =>
      choice($.LiteralBoolean, $.LiteralString, $.LiteralInteger, $.LiteralReal, $.LiteralInfinity),
    LiteralBoolean: ($) => field("value", $.BooleanValue),
    BooleanValue: ($) => choice("true", "false"),
    LiteralString: ($) => field("value", $.STRING_VALUE),
    LiteralInteger: ($) => field("value", $.DECIMAL_VALUE),
    LiteralReal: ($) => field("value", $.RealValue),
    RealValue: ($) => choice(seq(optional($.DECIMAL_VALUE), ".", choice($.DECIMAL_VALUE, $.EXP_VALUE)), $.EXP_VALUE),
    LiteralInfinity: ($) => "*",
    Name: ($) => choice($.ID, $.UNRESTRICTED_NAME),
    GlobalQualification: ($) => seq("$", "::"),
    Qualification: ($) => repeat1(seq($.Name, "::")),
    QualifiedName: ($) => seq(optional($.GlobalQualification), optional($.Qualification), field("name", $.Name)),
    DECIMAL_VALUE: ($) => token(/[0-9]+/),
    EXP_VALUE: ($) => token(seq(/[0-9]+/, choice("e", "E"), optional(choice("+", "-")), /[0-9]+/)),
    ID: ($) => token(seq(/[a-zA-Z_]/, repeat(/[a-zA-Z_0-9]/))),
    UNRESTRICTED_NAME: ($) =>
      token(seq("'", repeat(choice(seq("\\", choice("b", "t", "n", "f", "r", '"', "'", "\\")), /[^'\\]/)), "'")),
    STRING_VALUE: ($) =>
      token(seq('"', repeat(choice(seq("\\", choice("b", "t", "n", "f", "r", '"', "'", "\\")), /[^"\\]/)), '"')),
    REGULAR_COMMENT: ($) => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),
    ML_NOTE: ($) => token(seq("//*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),
    SL_NOTE: ($) => token(seq("//", /[^\r\n]*/)),
  },
});

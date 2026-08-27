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
        seq(token("<"), field(undefined, $.Name), token(">"), choice(field(undefined, $.Name), seq())),
        field(undefined, $.Name),
      ),
    _RelationshipBody: ($) => choice(token(";"), seq(token("{"), repeat($.OwnedAnnotation), token("}"))),
    VisibilityIndicator: ($) => choice(token("public"), token("private"), token("protected")),
    Dependency: ($) =>
      seq(
        repeat($.PrefixMetadataAnnotation),
        token("dependency"),
        choice(seq(choice($._Identification, seq()), token("from")), seq()),
        field(undefined, $.QualifiedName),
        repeat(seq(token(","), field(undefined, $.QualifiedName))),
        token("to"),
        field(undefined, $.QualifiedName),
        repeat(seq(token(","), field(undefined, $.QualifiedName))),
        $._RelationshipBody,
      ),
    Annotation: ($) => field(undefined, $.QualifiedName),
    OwnedAnnotation: ($) => field(undefined, $._AnnotatingElement),
    AnnotatingMember: ($) => field(undefined, $._AnnotatingElement),
    _AnnotatingElement: ($) => choice($.Comment, $.Documentation, $.TextualRepresentation, $.MetadataUsage),
    Comment: ($) =>
      seq(
        choice(
          seq(
            token("comment"),
            choice($._Identification, seq()),
            choice(seq(token("about"), $.Annotation, repeat(seq(token(","), $.Annotation))), seq()),
          ),
          seq(),
        ),
        choice(seq(token("locale"), field(undefined, $.STRING_VALUE)), seq()),
        field(undefined, $.REGULAR_COMMENT),
      ),
    Documentation: ($) =>
      seq(
        token("doc"),
        choice($._Identification, seq()),
        choice(seq(token("locale"), field(undefined, $.STRING_VALUE)), seq()),
        field(undefined, $.REGULAR_COMMENT),
      ),
    TextualRepresentation: ($) =>
      seq(
        choice(seq(token("rep"), choice($._Identification, seq())), seq()),
        token("language"),
        field(undefined, $.STRING_VALUE),
        field(undefined, $.REGULAR_COMMENT),
      ),
    PrefixMetadataAnnotation: ($) => seq(token("#"), field(undefined, $.PrefixMetadataUsage)),
    PrefixMetadataMember: ($) => seq(token("#"), field(undefined, $.PrefixMetadataUsage)),
    PrefixMetadataUsage: ($) => field(undefined, $.MetadataTyping),
    MetadataUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        choice(token("metadata"), token("@")),
        choice(
          seq(
            choice($._Identification, seq()),
            choice(seq(choice(token(":"), seq(token("defined"), token("by")))), seq()),
          ),
          seq(),
        ),
        field(undefined, $.MetadataTyping),
        choice(seq(token("about"), $.Annotation, repeat(seq(token(","), $.Annotation))), seq()),
        $._MetadataBody,
      ),
    MetadataTyping: ($) => field(undefined, $.QualifiedName),
    _MetadataBody: ($) =>
      choice(
        token(";"),
        seq(
          token("{"),
          repeat(choice($.DefinitionMember, $.MetadataBodyUsageMember, $.AliasMember, $.Import)),
          token("}"),
        ),
      ),
    MetadataBodyUsageMember: ($) => field(undefined, $.MetadataBodyUsage),
    MetadataBodyUsage: ($) =>
      seq(
        choice(token("ref"), seq()),
        choice(choice(token(":>>"), token("redefines")), seq()),
        field(undefined, $.OwnedRedefinition),
        choice($._FeatureSpecializationPart, seq()),
        choice($._ValuePart, seq()),
        $._MetadataBody,
      ),
    MetadataDefinition: ($) => seq(repeat($._usage_modifier), token("metadata"), token("def"), $._Definition),
    Package: ($) =>
      seq(
        repeat($._usage_modifier),
        token("package"),
        choice($._Identification, seq()),
        field(undefined, $._PackageBody),
      ),
    LibraryPackage: ($) =>
      seq(
        choice(field(undefined, token("standard")), seq()),
        token("library"),
        repeat($._usage_modifier),
        token("package"),
        choice($._Identification, seq()),
        field(undefined, $._PackageBody),
      ),
    _PackageBody: ($) => choice(token(";"), seq(token("{"), repeat($._PackageBodyElement), token("}"))),
    PackageMember: ($) =>
      seq(
        choice($.VisibilityIndicator, seq()),
        choice(field(undefined, $._DefinitionElement), field(undefined, $._UsageElement)),
      ),
    ElementFilterMember: ($) =>
      seq(choice($.VisibilityIndicator, seq()), token("filter"), field(undefined, $.OwnedExpression), token(";")),
    AliasMember: ($) =>
      seq(
        choice($.VisibilityIndicator, seq()),
        token("alias"),
        choice(seq(token("<"), field(undefined, $.Name), token(">")), seq()),
        choice(field(undefined, $.Name), seq()),
        token("for"),
        field(undefined, $.QualifiedName),
        $._RelationshipBody,
      ),
    _ImportPrefix: ($) =>
      seq(choice($.VisibilityIndicator, seq()), token("import"), choice(field(undefined, token("all")), seq())),
    Import: ($) => seq(choice($.MembershipImport, $.NamespaceImport), $._RelationshipBody),
    MembershipImport: ($) => seq($._ImportPrefix, $._ImportedMembership),
    _ImportedMembership: ($) =>
      seq(field(undefined, $.QualifiedName), choice(seq(token("::"), field(undefined, token("**"))), seq())),
    NamespaceImport: ($) => seq($._ImportPrefix, choice($._ImportedNamespace, field(undefined, $.FilterPackage))),
    _ImportedNamespace: ($) =>
      seq(
        field(undefined, $.QualifiedName),
        token("::"),
        token("*"),
        choice(seq(token("::"), field(undefined, token("**"))), seq()),
      ),
    FilterPackage: ($) => seq($.FilterPackageImport, seq($.FilterPackageMember, repeat($.FilterPackageMember))),
    FilterPackageImport: ($) => choice($.FilterPackageMembershipImport, $.FilterPackageNamespaceImport),
    FilterPackageMembershipImport: ($) => $._ImportedMembership,
    FilterPackageNamespaceImport: ($) => $._ImportedNamespace,
    FilterPackageMember: ($) => seq(token("["), field(undefined, $.OwnedExpression), token("]")),
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
      seq(
        choice(token(":>"), token("specializes")),
        $.OwnedSubclassification,
        repeat(seq(token(","), $.OwnedSubclassification)),
      ),
    OwnedSubclassification: ($) => field(undefined, $.QualifiedName),
    _FeatureDeclaration: ($) =>
      choice(seq($._Identification, choice($._FeatureSpecializationPart, seq())), $._FeatureSpecializationPart),
    _FeatureSpecializationPart: ($) =>
      choice(
        seq(
          seq($._FeatureSpecialization, repeat($._FeatureSpecialization)),
          choice($._MultiplicityPart, seq()),
          repeat($._FeatureSpecialization),
        ),
        seq($._MultiplicityPart, repeat($._FeatureSpecialization)),
      ),
    _MultiplicityPart: ($) =>
      choice(
        $.OwnedMultiplicity,
        seq(
          choice($.OwnedMultiplicity, seq()),
          choice(
            seq(field(undefined, token("ordered")), choice(field(undefined, token("nonunique")), seq())),
            seq(field(undefined, token("nonunique")), choice(field(undefined, token("ordered")), seq())),
          ),
        ),
      ),
    _FeatureSpecialization: ($) => choice($._Typings, $._Subsettings, $._References, $._Crosses, $._Redefinitions),
    _Typings: ($) =>
      seq(
        choice(token(":"), seq(token("defined"), token("by"))),
        $.FeatureTyping,
        repeat(seq(token(","), $.FeatureTyping)),
      ),
    _Subsettings: ($) =>
      seq(choice(token(":>"), token("subsets")), $.OwnedSubsetting, repeat(seq(token(","), $.OwnedSubsetting))),
    _References: ($) => seq(choice(token("::>"), token("references")), $.OwnedReferenceSubsetting),
    _Crosses: ($) => seq(choice(token("=>"), token("crosses")), $.OwnedCrossSubsetting),
    _Redefinitions: ($) =>
      seq(choice(token(":>>"), token("redefines")), $.OwnedRedefinition, repeat(seq(token(","), $.OwnedRedefinition))),
    FeatureTyping: ($) => choice($.OwnedFeatureTyping, $.ConjugatedPortTyping),
    OwnedFeatureTyping: ($) => choice(field(undefined, $.QualifiedName), field(undefined, $.OwnedFeatureChain)),
    OwnedSubsetting: ($) => choice(field(undefined, $.QualifiedName), field(undefined, $.OwnedFeatureChain)),
    OwnedReferenceSubsetting: ($) => choice(field(undefined, $.QualifiedName), field(undefined, $.OwnedFeatureChain)),
    OwnedCrossSubsetting: ($) => choice(field(undefined, $.QualifiedName), field(undefined, $.OwnedFeatureChain)),
    OwnedRedefinition: ($) => choice(field(undefined, $.QualifiedName), field(undefined, $.OwnedFeatureChain)),
    OwnedMultiplicity: ($) => field(undefined, $.MultiplicityRange),
    MultiplicityRange: ($) =>
      seq(
        token("["),
        field(undefined, $.MultiplicityExpressionMember),
        choice(seq(token(".."), field(undefined, $.MultiplicityExpressionMember)), seq()),
        token("]"),
      ),
    MultiplicityExpressionMember: ($) => field(undefined, choice($._LiteralExpression, $.FeatureReferenceExpression)),
    _Definition: ($) =>
      seq(choice($._Identification, seq()), choice($._SubclassificationPart, seq()), $._DefinitionBody),
    _DefinitionBody: ($) => choice(token(";"), seq(token("{"), repeat($._DefinitionBodyItem), token("}"))),
    _DefinitionBodyItem: ($) =>
      choice(
        $.DefinitionMember,
        $.VariantUsageMember,
        $.NonOccurrenceUsageMember,
        seq(choice($.EmptySuccessionMember, seq()), $.OccurrenceUsageMember),
        $.AliasMember,
        $.Import,
      ),
    DefinitionMember: ($) => seq(choice($.VisibilityIndicator, seq()), field(undefined, $._DefinitionElement)),
    VariantUsageMember: ($) =>
      seq(choice($.VisibilityIndicator, seq()), token("variant"), field(undefined, $._UsageElement)),
    NonOccurrenceUsageMember: ($) =>
      seq(choice($.VisibilityIndicator, seq()), field(undefined, $._NonOccurrenceUsageElement)),
    OccurrenceUsageMember: ($) =>
      seq(choice($.VisibilityIndicator, seq()), field(undefined, $._OccurrenceUsageElement)),
    _usage_modifier: ($) =>
      choice(
        field(undefined, token("end")),
        field(undefined, token("in")),
        field(undefined, token("out")),
        field(undefined, token("inout")),
        field(undefined, token("derived")),
        field(undefined, token("abstract")),
        field(undefined, token("variation")),
        field(undefined, token("constant")),
        field(undefined, token("ref")),
        token("individual"),
        token("snapshot"),
        token("timeslice"),
        $.PrefixMetadataMember,
      ),
    _UsageDeclaration: ($) => $._FeatureDeclaration,
    _UsageCompletion: ($) => seq(choice($._ValuePart, seq()), $._DefinitionBody),
    _Usage: ($) => seq(choice($._UsageDeclaration, seq()), $._UsageCompletion),
    _ValuePart: ($) => $.FeatureValue,
    FeatureValue: ($) =>
      seq(
        choice(
          token("="),
          field(undefined, token(":=")),
          seq(field(undefined, token("default")), choice(choice(token("="), field(undefined, token(":="))), seq())),
        ),
        field(undefined, $.OwnedExpression),
      ),
    DefaultReferenceUsage: ($) =>
      seq(repeat($._usage_modifier), $._UsageDeclaration, choice($._ValuePart, seq()), $._DefinitionBody),
    ReferenceUsage: ($) => seq(repeat($._usage_modifier), token("ref"), $._Usage),
    AttributeDefinition: ($) => seq(repeat($._usage_modifier), token("attribute"), token("def"), $._Definition),
    AttributeUsage: ($) => seq(repeat($._usage_modifier), token("attribute"), $._Usage),
    EnumerationDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        token("enum"),
        token("def"),
        choice($._Identification, seq()),
        choice($._SubclassificationPart, seq()),
        field(undefined, $._EnumerationBody),
      ),
    _EnumerationBody: ($) =>
      choice(token(";"), seq(token("{"), repeat(choice($.AnnotatingMember, $.EnumerationUsageMember)), token("}"))),
    EnumerationUsageMember: ($) => seq(choice($.VisibilityIndicator, seq()), field(undefined, $.EnumeratedValue)),
    EnumeratedValue: ($) => seq(repeat($._usage_modifier), choice(token("enum"), seq()), $._Usage),
    EnumerationUsage: ($) => seq(repeat($._usage_modifier), token("enum"), $._Usage),
    OccurrenceDefinition: ($) => seq(repeat($._usage_modifier), token("occurrence"), token("def"), $._Definition),
    OccurrenceUsage: ($) => seq(repeat($._usage_modifier), token("occurrence"), $._Usage),
    ItemDefinition: ($) => seq(repeat($._usage_modifier), token("item"), token("def"), $._Definition),
    ItemUsage: ($) => seq(repeat($._usage_modifier), token("item"), $._Usage),
    PartDefinition: ($) => seq(repeat($._usage_modifier), token("part"), token("def"), $._Definition),
    PartUsage: ($) => seq(repeat($._usage_modifier), token("part"), $._Usage),
    PortDefinition: ($) => seq(repeat($._usage_modifier), token("port"), token("def"), $._Definition),
    PortUsage: ($) => seq(repeat($._usage_modifier), token("port"), $._Usage),
    ConjugatedPortTyping: ($) => seq(token("~"), field(undefined, $.QualifiedName)),
    ConnectorEndMember: ($) => field(undefined, $.ConnectorEnd),
    ConnectorEnd: ($) =>
      seq(
        choice(field(undefined, $.OwnedMultiplicity), seq()),
        choice(seq(field(undefined, $.Name), choice(token("::>"), token("references"))), seq()),
        $.OwnedReferenceSubsetting,
      ),
    ConnectionDefinition: ($) => seq(repeat($._usage_modifier), token("connection"), token("def"), $._Definition),
    ConnectionUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        choice(
          seq(
            token("connection"),
            choice($._UsageDeclaration, seq()),
            choice($._ValuePart, seq()),
            choice(seq(token("connect"), $._ConnectorPart), seq()),
          ),
          seq(token("connect"), $._ConnectorPart),
        ),
        $._DefinitionBody,
      ),
    _ConnectorPart: ($) => choice($._BinaryConnectorPart, $._NaryConnectorPart),
    _BinaryConnectorPart: ($) => seq($.ConnectorEndMember, token("to"), $.ConnectorEndMember),
    _NaryConnectorPart: ($) =>
      seq(
        token("("),
        $.ConnectorEndMember,
        token(","),
        $.ConnectorEndMember,
        repeat(seq(token(","), $.ConnectorEndMember)),
        token(")"),
      ),
    BindingConnectorAsUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        choice(seq(token("binding"), choice($._UsageDeclaration, seq())), seq()),
        token("bind"),
        $.ConnectorEndMember,
        token("="),
        $.ConnectorEndMember,
        $._DefinitionBody,
      ),
    SuccessionAsUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        choice(seq(token("succession"), choice($._UsageDeclaration, seq())), seq()),
        token("first"),
        $.ConnectorEndMember,
        token("then"),
        $.ConnectorEndMember,
        choice(seq(token("if"), field(undefined, $.OwnedExpression)), seq()),
        $._DefinitionBody,
      ),
    InterfaceDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        token("interface"),
        token("def"),
        choice($._Identification, seq()),
        choice($._SubclassificationPart, seq()),
        $._DefinitionBody,
      ),
    InterfaceUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("interface"),
        choice($._UsageDeclaration, seq()),
        choice(seq(token("connect"), $._ConnectorPart), seq()),
        $._DefinitionBody,
      ),
    AllocationDefinition: ($) => seq(repeat($._usage_modifier), token("allocation"), token("def"), $._Definition),
    AllocationUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        choice(
          seq(
            token("allocation"),
            choice($._UsageDeclaration, seq()),
            choice(seq(token("allocate"), $._ConnectorPart), seq()),
          ),
          seq(token("allocate"), $._ConnectorPart),
        ),
        $._DefinitionBody,
      ),
    FlowDefinition: ($) => seq(repeat($._usage_modifier), token("flow"), token("def"), $._Definition),
    FlowUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("flow"),
        choice(
          seq($.FlowEndMember, token("to"), $.FlowEndMember),
          seq(
            choice($._UsageDeclaration, seq()),
            choice($._ValuePart, seq()),
            choice(seq(token("of"), $.PayloadFeatureMember), seq()),
            choice(seq(token("from"), $.FlowEndMember, token("to"), $.FlowEndMember), seq()),
          ),
        ),
        $._DefinitionBody,
      ),
    SuccessionFlowUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("succession"),
        token("flow"),
        choice(
          seq($.FlowEndMember, token("to"), $.FlowEndMember),
          seq(
            choice($._UsageDeclaration, seq()),
            choice($._ValuePart, seq()),
            choice(seq(token("of"), $.PayloadFeatureMember), seq()),
            choice(seq(token("from"), $.FlowEndMember, token("to"), $.FlowEndMember), seq()),
          ),
        ),
        $._DefinitionBody,
      ),
    PayloadFeatureMember: ($) => field(undefined, $.PayloadFeature),
    PayloadFeature: ($) =>
      choice(
        seq(choice($._Identification, seq()), $._FeatureSpecializationPart, choice($._ValuePart, seq())),
        seq(choice($._Identification, seq()), $._ValuePart),
        seq($.OwnedFeatureTyping, choice($.OwnedMultiplicity, seq())),
        seq($.OwnedMultiplicity, $.OwnedFeatureTyping),
      ),
    FlowEndMember: ($) => field(undefined, $.FlowEnd),
    FlowEnd: ($) =>
      seq(choice(seq($.OwnedReferenceSubsetting, token(".")), seq()), field(undefined, $.FlowFeatureMember)),
    FlowFeatureMember: ($) => field(undefined, $.FlowFeature),
    FlowFeature: ($) => field(undefined, $.QualifiedName),
    ActionDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        token("action"),
        token("def"),
        choice($._Identification, seq()),
        choice($._SubclassificationPart, seq()),
        choice($._ParameterList, seq()),
        $._ActionBody,
      ),
    _ActionBody: ($) => choice(token(";"), seq(token("{"), repeat($._ActionBodyItem), token("}"))),
    _ActionBodyItem: ($) =>
      choice(
        $.Import,
        $.AliasMember,
        $.DefinitionMember,
        $.VariantUsageMember,
        $.NonOccurrenceUsageMember,
        seq(choice($.EmptySuccessionMember, seq()), $._OccurrenceUsageElement),
        $.ActionNodeMember,
        $.ReturnParameterMember,
      ),
    EmptySuccessionMember: ($) => seq(token("then"), field(undefined, $.MultiplicitySourceEnd)),
    MultiplicitySourceEnd: ($) => field(undefined, $.OwnedMultiplicity),
    ActionNodeMember: ($) => seq(choice($.VisibilityIndicator, seq()), field(undefined, $._ActionNode)),
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
        choice(seq(token("action"), choice($._UsageDeclaration, seq())), seq()),
        token("if"),
        field(undefined, $.OwnedExpression),
        field(undefined, $.ActionBodyParameter),
        choice(seq(token("else"), choice(field(undefined, $.ActionBodyParameter), $.IfNode)), seq()),
      ),
    ActionBodyParameter: ($) =>
      seq(
        choice(seq(token("action"), choice($._UsageDeclaration, seq())), seq()),
        token("{"),
        repeat($._ActionBodyItem),
        token("}"),
      ),
    WhileLoopNode: ($) =>
      seq(
        repeat($._usage_modifier),
        choice(seq(token("action"), choice($._UsageDeclaration, seq())), seq()),
        choice(seq(token("while"), field(undefined, $.OwnedExpression)), token("loop")),
        $.ActionBodyParameter,
        choice(seq(token("until"), field(undefined, $.OwnedExpression), token(";")), seq()),
      ),
    ForLoopNode: ($) =>
      seq(
        repeat($._usage_modifier),
        choice(seq(token("action"), choice($._UsageDeclaration, seq())), seq()),
        token("for"),
        field(undefined, $.ForVariableDeclaration),
        token("in"),
        field(undefined, $.OwnedExpression),
        $.ActionBodyParameter,
      ),
    ForVariableDeclaration: ($) => $._UsageDeclaration,
    ControlNode: ($) => choice($.MergeNode, $.DecisionNode, $.JoinNode, $.ForkNode),
    MergeNode: ($) => seq(repeat($._usage_modifier), token("merge"), choice($._UsageDeclaration, seq()), $._ActionBody),
    DecisionNode: ($) =>
      seq(repeat($._usage_modifier), token("decide"), choice($._UsageDeclaration, seq()), $._ActionBody),
    JoinNode: ($) => seq(repeat($._usage_modifier), token("join"), choice($._UsageDeclaration, seq()), $._ActionBody),
    ForkNode: ($) => seq(repeat($._usage_modifier), token("fork"), choice($._UsageDeclaration, seq()), $._ActionBody),
    ActionUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("action"),
        choice($._UsageDeclaration, seq()),
        choice($._ValuePart, seq()),
        choice($._ParameterList, seq()),
        $._ActionBody,
      ),
    AcceptActionNode: ($) =>
      seq(
        repeat($._usage_modifier),
        choice(seq(token("action"), choice($._UsageDeclaration, seq())), seq()),
        token("accept"),
        $.PayloadFeatureMember,
        choice(seq(token("via"), $.OwnedReferenceSubsetting), seq()),
        $._ActionBody,
      ),
    SendActionNode: ($) =>
      seq(
        repeat($._usage_modifier),
        choice(seq(token("action"), choice($._UsageDeclaration, seq())), seq()),
        token("send"),
        field(undefined, $.OwnedExpression),
        choice(seq(token("via"), $.OwnedReferenceSubsetting), seq()),
        choice(seq(token("to"), field(undefined, $.OwnedExpression)), seq()),
        $._ActionBody,
      ),
    AssignActionNode: ($) =>
      seq(
        repeat($._usage_modifier),
        choice(seq(token("action"), choice($._UsageDeclaration, seq())), seq()),
        token("assign"),
        field(undefined, $.OwnedExpression),
        token("=:"),
        field(undefined, $.OwnedExpression),
        $._ActionBody,
      ),
    PerformActionUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("perform"),
        choice(
          seq($.OwnedReferenceSubsetting, choice($._FeatureSpecializationPart, seq())),
          seq(token("action"), choice($._UsageDeclaration, seq())),
        ),
        choice($._ValuePart, seq()),
        $._ActionBody,
      ),
    CalculationDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        token("calc"),
        token("def"),
        choice($._Identification, seq()),
        choice($._SubclassificationPart, seq()),
        choice($._ParameterList, seq()),
        $._CalculationBody,
      ),
    _CalculationBody: ($) =>
      choice(
        token(";"),
        seq(
          token("{"),
          repeat(choice($._ActionBodyItem, $.ReturnParameterMember)),
          choice($.ResultExpressionMember, seq()),
          token("}"),
        ),
      ),
    _ParameterList: ($) =>
      seq(token("("), choice(seq($.ParameterMember, repeat(seq(token(","), $.ParameterMember))), seq()), token(")")),
    ParameterMember: ($) => seq(choice($.VisibilityIndicator, seq()), field(undefined, $._UsageElement)),
    ReturnParameterMember: ($) =>
      seq(choice($.VisibilityIndicator, seq()), token("return"), field(undefined, $._UsageElement)),
    ResultExpressionMember: ($) => seq(choice($.VisibilityIndicator, seq()), field(undefined, $.OwnedExpression)),
    CalculationUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("calc"),
        choice($._UsageDeclaration, seq()),
        choice($._ValuePart, seq()),
        choice($._ParameterList, seq()),
        $._CalculationBody,
      ),
    ConstraintDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        token("constraint"),
        token("def"),
        choice($._Identification, seq()),
        choice($._SubclassificationPart, seq()),
        $._CalculationBody,
      ),
    ConstraintUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("constraint"),
        choice($._UsageDeclaration, seq()),
        choice($._ValuePart, seq()),
        $._CalculationBody,
      ),
    AssertConstraintUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("assert"),
        choice(field(undefined, token("not")), seq()),
        choice(
          seq($.OwnedReferenceSubsetting, choice($._FeatureSpecializationPart, seq())),
          seq(token("constraint"), choice($._UsageDeclaration, seq()), choice($._ValuePart, seq())),
        ),
        $._CalculationBody,
      ),
    RequirementDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        token("requirement"),
        token("def"),
        choice($._Identification, seq()),
        choice($._SubclassificationPart, seq()),
        $._RequirementBody,
      ),
    _RequirementBody: ($) => choice(token(";"), seq(token("{"), repeat($._RequirementBodyItem), token("}"))),
    _RequirementBodyItem: ($) =>
      choice($._DefinitionBodyItem, $.SubjectMember, $.RequirementConstraintMember, $.ActorMember, $.StakeholderMember),
    SubjectMember: ($) => seq(choice($.VisibilityIndicator, seq()), field(undefined, $.SubjectUsage)),
    SubjectUsage: ($) => seq(token("subject"), repeat($._usage_modifier), $._Usage),
    RequirementConstraintMember: ($) =>
      seq(
        choice($.VisibilityIndicator, seq()),
        field(undefined, choice(token("assume"), token("require"))),
        field(undefined, $.RequirementConstraintUsage),
      ),
    RequirementConstraintUsage: ($) =>
      choice(
        seq($.OwnedReferenceSubsetting, repeat($._FeatureSpecialization), $._CalculationBody),
        seq(
          repeat($._usage_modifier),
          choice(token("constraint"), seq()),
          choice($._UsageDeclaration, seq()),
          choice($._ValuePart, seq()),
          $._CalculationBody,
        ),
      ),
    ActorMember: ($) => seq(choice($.VisibilityIndicator, seq()), field(undefined, $.ActorUsage)),
    ActorUsage: ($) => seq(token("actor"), repeat($._usage_modifier), $._Usage),
    StakeholderMember: ($) => seq(choice($.VisibilityIndicator, seq()), field(undefined, $.StakeholderUsage)),
    StakeholderUsage: ($) => seq(token("stakeholder"), repeat($._usage_modifier), $._Usage),
    RequirementUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("requirement"),
        choice($._UsageDeclaration, seq()),
        choice($._ValuePart, seq()),
        $._RequirementBody,
      ),
    SatisfyRequirementUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        choice(token("assert"), seq()),
        choice(field(undefined, token("not")), seq()),
        token("satisfy"),
        choice(
          seq($.OwnedReferenceSubsetting, choice($._FeatureSpecializationPart, seq())),
          seq(token("requirement"), choice($._UsageDeclaration, seq())),
        ),
        choice($._ValuePart, seq()),
        choice(seq(token("by"), field(undefined, $.OwnedReferenceSubsetting)), seq()),
        $._RequirementBody,
      ),
    ConcernDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        token("concern"),
        token("def"),
        choice($._Identification, seq()),
        choice($._SubclassificationPart, seq()),
        $._RequirementBody,
      ),
    ConcernUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("concern"),
        choice($._UsageDeclaration, seq()),
        choice($._ValuePart, seq()),
        $._RequirementBody,
      ),
    CaseDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        token("case"),
        token("def"),
        choice($._Identification, seq()),
        choice($._SubclassificationPart, seq()),
        $._CaseBody,
      ),
    _CaseBody: ($) =>
      choice(
        token(";"),
        seq(
          token("{"),
          repeat(choice($._ActionBodyItem, $.SubjectMember, $.ActorMember, $.StakeholderMember, $.ObjectiveMember)),
          choice($.ResultExpressionMember, seq()),
          token("}"),
        ),
      ),
    CaseUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("case"),
        choice($._UsageDeclaration, seq()),
        choice($._ValuePart, seq()),
        $._CaseBody,
      ),
    AnalysisCaseDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        token("analysis"),
        token("def"),
        choice($._Identification, seq()),
        choice($._SubclassificationPart, seq()),
        $._CaseBody,
      ),
    AnalysisCaseUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("analysis"),
        choice($._UsageDeclaration, seq()),
        choice($._ValuePart, seq()),
        $._CaseBody,
      ),
    VerificationCaseDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        token("verification"),
        token("def"),
        choice($._Identification, seq()),
        choice($._SubclassificationPart, seq()),
        $._VerificationBody,
      ),
    VerificationCaseUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("verification"),
        choice($._UsageDeclaration, seq()),
        choice($._ValuePart, seq()),
        $._VerificationBody,
      ),
    _VerificationBody: ($) =>
      choice(
        token(";"),
        seq(token("{"), repeat($._VerificationBodyItem), choice($.ResultExpressionMember, seq()), token("}")),
      ),
    _VerificationBodyItem: ($) => choice($._ActionBodyItem, $.VerifyRequirementUsageMember, $.ObjectiveMember),
    VerifyRequirementUsageMember: ($) =>
      seq(choice($.VisibilityIndicator, seq()), field(undefined, $.VerifyRequirementUsage)),
    VerifyRequirementUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("verify"),
        choice(
          seq($.OwnedReferenceSubsetting, choice($._FeatureSpecializationPart, seq())),
          seq(token("requirement"), choice($._UsageDeclaration, seq())),
        ),
        choice($._ValuePart, seq()),
        $._RequirementBody,
      ),
    ObjectiveMember: ($) => seq(choice($.VisibilityIndicator, seq()), field(undefined, $.ObjectiveRequirementUsage)),
    ObjectiveRequirementUsage: ($) =>
      seq(
        token("objective"),
        repeat($._usage_modifier),
        choice($._UsageDeclaration, seq()),
        choice($._ValuePart, seq()),
        $._RequirementBody,
      ),
    UseCaseDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        token("use"),
        token("case"),
        token("def"),
        choice($._Identification, seq()),
        choice($._SubclassificationPart, seq()),
        $._CaseBody,
      ),
    UseCaseUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("use"),
        token("case"),
        choice($._UsageDeclaration, seq()),
        choice($._ValuePart, seq()),
        $._CaseBody,
      ),
    IncludeUseCaseUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("include"),
        choice(
          seq($.OwnedReferenceSubsetting, choice($._FeatureSpecializationPart, seq())),
          seq(token("use"), token("case"), choice($._UsageDeclaration, seq())),
        ),
        choice($._ValuePart, seq()),
        $._CaseBody,
      ),
    StateDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        token("state"),
        token("def"),
        choice($._Identification, seq()),
        choice($._SubclassificationPart, seq()),
        choice(
          token(";"),
          seq(choice(field(undefined, token("parallel")), seq()), token("{"), repeat($._StateBodyItem), token("}")),
        ),
      ),
    _StateBodyItem: ($) =>
      choice(
        $.Import,
        $.AliasMember,
        $.DefinitionMember,
        $.VariantUsageMember,
        $.NonOccurrenceUsageMember,
        seq(choice($.EmptySuccessionMember, seq()), $._OccurrenceUsageElement),
        $.TransitionUsageMember,
        $.EntryActionMember,
        $.DoActionMember,
        $.ExitActionMember,
      ),
    EntryActionMember: ($) =>
      seq(choice($.VisibilityIndicator, seq()), token("entry"), field(undefined, $.StateActionUsage)),
    DoActionMember: ($) => seq(choice($.VisibilityIndicator, seq()), token("do"), field(undefined, $.StateActionUsage)),
    ExitActionMember: ($) =>
      seq(choice($.VisibilityIndicator, seq()), token("exit"), field(undefined, $.StateActionUsage)),
    StateActionUsage: ($) =>
      choice(token(";"), seq(choice($._UsageDeclaration, seq()), choice($._ValuePart, seq()), $._ActionBody)),
    StateUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("state"),
        choice($._UsageDeclaration, seq()),
        choice($._ValuePart, seq()),
        choice(
          token(";"),
          seq(choice(field(undefined, token("parallel")), seq()), token("{"), repeat($._StateBodyItem), token("}")),
        ),
      ),
    ExhibitStateUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("exhibit"),
        choice(
          seq($.OwnedReferenceSubsetting, choice($._FeatureSpecializationPart, seq())),
          seq(token("state"), choice($._UsageDeclaration, seq())),
        ),
        choice($._ValuePart, seq()),
        choice(
          token(";"),
          seq(choice(field(undefined, token("parallel")), seq()), token("{"), repeat($._StateBodyItem), token("}")),
        ),
      ),
    TransitionUsageMember: ($) => seq(choice($.VisibilityIndicator, seq()), field(undefined, $.TransitionUsage)),
    TransitionUsage: ($) =>
      seq(
        token("transition"),
        choice(seq(choice($._UsageDeclaration, seq()), token("first")), seq()),
        field(undefined, $.QualifiedName),
        choice(seq(token("accept"), field(undefined, $.PayloadFeatureMember)), seq()),
        choice(seq(token("if"), field(undefined, $.OwnedExpression)), seq()),
        choice(seq(token("do"), field(undefined, $.StateActionUsage)), seq()),
        token("then"),
        $.ConnectorEndMember,
        $._ActionBody,
      ),
    ViewDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        token("view"),
        token("def"),
        choice($._Identification, seq()),
        choice($._SubclassificationPart, seq()),
        choice(token(";"), seq(token("{"), repeat(choice($._DefinitionBodyItem, $.ElementFilterMember)), token("}"))),
      ),
    ViewUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("view"),
        choice($._UsageDeclaration, seq()),
        choice($._ValuePart, seq()),
        choice(token(";"), seq(token("{"), repeat(choice($._DefinitionBodyItem, $.ElementFilterMember)), token("}"))),
      ),
    ViewpointDefinition: ($) =>
      seq(
        repeat($._usage_modifier),
        token("viewpoint"),
        token("def"),
        choice($._Identification, seq()),
        choice($._SubclassificationPart, seq()),
        $._RequirementBody,
      ),
    ViewpointUsage: ($) =>
      seq(
        repeat($._usage_modifier),
        token("viewpoint"),
        choice($._UsageDeclaration, seq()),
        choice($._ValuePart, seq()),
        $._RequirementBody,
      ),
    RenderingDefinition: ($) => seq(repeat($._usage_modifier), token("rendering"), token("def"), $._Definition),
    RenderingUsage: ($) => seq(repeat($._usage_modifier), token("rendering"), $._Usage),
    OwnedExpressionMember: ($) => field(undefined, $.OwnedExpression),
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
    OwnedExpressionReference: ($) => field(undefined, $.OwnedExpressionMember),
    ConditionalExpression: ($) =>
      prec.right(
        undefined,
        seq(
          field(undefined, token("if")),
          field(undefined, $._Expression),
          token("?"),
          field(undefined, $.OwnedExpressionReference),
          token("else"),
          field(undefined, $.OwnedExpressionReference),
        ),
      ),
    NullCoalescingExpression: ($) =>
      prec.left(
        undefined,
        seq(
          field(undefined, $._Expression),
          seq(
            seq(field(undefined, token("??")), field(undefined, $.ImpliesExpressionReference)),
            repeat(seq(field(undefined, token("??")), field(undefined, $.ImpliesExpressionReference))),
          ),
        ),
      ),
    ImpliesExpressionReference: ($) => field(undefined, $.ImpliesExpressionMember),
    ImpliesExpressionMember: ($) => field(undefined, $._Expression),
    ImpliesExpression: ($) =>
      prec.left(
        undefined,
        seq(
          field(undefined, $._Expression),
          seq(
            seq(field(undefined, token("implies")), field(undefined, $.ImpliesExpressionReference)),
            repeat(seq(field(undefined, token("implies")), field(undefined, $.ImpliesExpressionReference))),
          ),
        ),
      ),
    OrExpressionReference: ($) => field(undefined, $.OrExpressionMember),
    OrExpressionMember: ($) => field(undefined, $._Expression),
    OrExpression: ($) =>
      prec.left(
        undefined,
        seq(
          field(undefined, $._Expression),
          seq(
            choice(
              seq(field(undefined, token("|")), field(undefined, $._Expression)),
              seq(field(undefined, token("or")), field(undefined, $.XorExpressionReference)),
            ),
            repeat(
              choice(
                seq(field(undefined, token("|")), field(undefined, $._Expression)),
                seq(field(undefined, token("or")), field(undefined, $.XorExpressionReference)),
              ),
            ),
          ),
        ),
      ),
    XorExpressionReference: ($) => field(undefined, $.XorExpressionMember),
    XorExpressionMember: ($) => field(undefined, $._Expression),
    XorExpression: ($) =>
      prec.left(
        undefined,
        seq(
          field(undefined, $._Expression),
          seq(
            seq(field(undefined, token("xor")), field(undefined, $._Expression)),
            repeat(seq(field(undefined, token("xor")), field(undefined, $._Expression))),
          ),
        ),
      ),
    AndExpression: ($) =>
      prec.left(
        undefined,
        seq(
          field(undefined, $._Expression),
          seq(
            choice(
              seq(field(undefined, token("&")), field(undefined, $._Expression)),
              seq(field(undefined, token("and")), field(undefined, $.EqualityExpressionReference)),
            ),
            repeat(
              choice(
                seq(field(undefined, token("&")), field(undefined, $._Expression)),
                seq(field(undefined, token("and")), field(undefined, $.EqualityExpressionReference)),
              ),
            ),
          ),
        ),
      ),
    EqualityExpressionReference: ($) => field(undefined, $.EqualityExpressionMember),
    EqualityExpressionMember: ($) => field(undefined, $._Expression),
    EqualityExpression: ($) =>
      prec.left(
        undefined,
        seq(
          field(undefined, $._Expression),
          seq(
            seq(field(undefined, $.EqualityOperator), field(undefined, $._Expression)),
            repeat(seq(field(undefined, $.EqualityOperator), field(undefined, $._Expression))),
          ),
        ),
      ),
    EqualityOperator: ($) => choice(token("=="), token("!="), token("==="), token("!==")),
    ClassificationExpression: ($) =>
      prec(
        undefined,
        choice(
          seq(
            field(undefined, $._Expression),
            choice(
              seq(field(undefined, $.ClassificationTestOperator), field(undefined, $.TypeReferenceMember)),
              seq(field(undefined, $.CastOperator), field(undefined, $.TypeResultMember)),
            ),
          ),
          seq(field(undefined, $.ClassificationTestOperator), field(undefined, $.TypeReferenceMember)),
          seq(
            field(undefined, $.MetadataReference),
            field(undefined, $.MetaClassificationTestOperator),
            field(undefined, $.TypeReferenceMember),
          ),
          seq(field(undefined, $.CastOperator), field(undefined, $.TypeResultMember)),
          seq(
            field(undefined, $.MetadataReference),
            field(undefined, $.MetaCastOperator),
            field(undefined, $.TypeResultMember),
          ),
        ),
      ),
    ClassificationTestOperator: ($) => choice(token("hastype"), token("istype"), token("@")),
    MetaClassificationTestOperator: ($) => "@@",
    CastOperator: ($) => "as",
    MetaCastOperator: ($) => "meta",
    MetadataReference: ($) => field(undefined, $.ElementReferenceMember),
    TypeReferenceMember: ($) => field(undefined, $.TypeReference),
    TypeResultMember: ($) => field(undefined, $.TypeReference),
    TypeReference: ($) => field(undefined, $.ReferenceTyping),
    ReferenceTyping: ($) => field(undefined, $.QualifiedName),
    RelationalExpression: ($) =>
      prec.left(
        undefined,
        seq(
          field(undefined, $._Expression),
          seq(
            seq(field(undefined, $.RelationalOperator), field(undefined, $._Expression)),
            repeat(seq(field(undefined, $.RelationalOperator), field(undefined, $._Expression))),
          ),
        ),
      ),
    RelationalOperator: ($) => choice(token("<"), token(">"), token("<="), token(">=")),
    RangeExpression: ($) =>
      prec.left(
        undefined,
        seq(field(undefined, $._Expression), field(undefined, token("..")), field(undefined, $._Expression)),
      ),
    AdditiveExpression: ($) =>
      prec.left(
        undefined,
        seq(
          field(undefined, $._Expression),
          seq(
            seq(field(undefined, $.AdditiveOperator), field(undefined, $._Expression)),
            repeat(seq(field(undefined, $.AdditiveOperator), field(undefined, $._Expression))),
          ),
        ),
      ),
    AdditiveOperator: ($) => choice(token("+"), token("-")),
    MultiplicativeExpression: ($) =>
      prec.left(
        undefined,
        seq(
          field(undefined, $._Expression),
          seq(
            seq(field(undefined, $.MultiplicativeOperator), field(undefined, $._Expression)),
            repeat(seq(field(undefined, $.MultiplicativeOperator), field(undefined, $._Expression))),
          ),
        ),
      ),
    MultiplicativeOperator: ($) => choice(token("*"), token("/"), token("%")),
    ExponentiationExpression: ($) =>
      prec.right(
        undefined,
        seq(
          field(undefined, $._Expression),
          field(undefined, $.ExponentiationOperator),
          field(undefined, $._Expression),
        ),
      ),
    ExponentiationOperator: ($) => choice(token("**"), token("^")),
    UnaryExpression: ($) => prec(undefined, seq(field(undefined, $.UnaryOperator), field(undefined, $._Expression))),
    UnaryOperator: ($) => choice(token("+"), token("-"), token("~"), token("not")),
    ExtentExpression: ($) => prec(undefined, seq(field(undefined, token("all")), field(undefined, $.TypeResultMember))),
    _postfix_operation: ($) =>
      seq(
        choice(
          seq(token("#"), token("("), field(undefined, $.SequenceExpression), token(")")),
          seq(field(undefined, token("[")), field(undefined, $.SequenceExpression), token("]")),
          seq(
            token("->"),
            field(undefined, $.InstantiatedTypeMember),
            choice(
              field(undefined, $.BodyExpression),
              field(undefined, $.FunctionReferenceExpression),
              $._ArgumentList,
            ),
          ),
          seq(token("."), field(undefined, $.BodyExpression)),
          seq(token(".?"), field(undefined, $.BodyExpression)),
        ),
        choice(seq(token("."), field(undefined, $.FeatureChainMember)), seq()),
      ),
    PrimaryExpression: ($) =>
      prec.left(
        undefined,
        choice(
          seq(
            field(undefined, $._BaseExpression),
            seq(token("."), field(undefined, $.FeatureChainMember)),
            repeat($._postfix_operation),
          ),
          seq(field(undefined, $._BaseExpression), seq($._postfix_operation, repeat($._postfix_operation))),
        ),
      ),
    FunctionReferenceExpression: ($) => field(undefined, $.FunctionReferenceMember),
    FunctionReferenceMember: ($) => field(undefined, $.FunctionReference),
    FunctionReference: ($) => field(undefined, $.ReferenceTyping),
    FeatureChainMember: ($) => choice(field(undefined, $.QualifiedName), field(undefined, $.OwnedFeatureChain)),
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
        seq(token("("), $.SequenceExpression, token(")")),
      ),
    BodyExpression: ($) => field(undefined, $.ExpressionBodyMember),
    ExpressionBodyMember: ($) => field(undefined, $.ExpressionBody),
    ExpressionBody: ($) => $._CalculationBody,
    SequenceExpression: ($) =>
      seq(
        $.OwnedExpression,
        choice(choice(token(","), seq(field(undefined, token(",")), field(undefined, $.SequenceExpression))), seq()),
      ),
    FeatureReferenceExpression: ($) => field(undefined, $.FeatureReferenceMember),
    FeatureReferenceMember: ($) => field(undefined, $.QualifiedName),
    MetadataAccessExpression: ($) => seq(field(undefined, $.ElementReferenceMember), token("."), token("metadata")),
    ElementReferenceMember: ($) => field(undefined, $.QualifiedName),
    InvocationExpression: ($) => seq(field(undefined, $.InstantiatedTypeMember), $._ArgumentList),
    ConstructorExpression: ($) =>
      seq(token("new"), field(undefined, $.InstantiatedTypeMember), field(undefined, $.ConstructorResultMember)),
    ConstructorResultMember: ($) => field(undefined, $.ConstructorResult),
    ConstructorResult: ($) => $._ArgumentList,
    InstantiatedTypeMember: ($) => choice(field(undefined, $.QualifiedName), field(undefined, $.OwnedFeatureChain)),
    _FeatureChain: ($) =>
      seq(
        field(undefined, $.OwnedFeatureChaining),
        seq(
          seq(token("."), field(undefined, $.OwnedFeatureChaining)),
          repeat(seq(token("."), field(undefined, $.OwnedFeatureChaining))),
        ),
      ),
    OwnedFeatureChaining: ($) => field(undefined, $.QualifiedName),
    _ArgumentList: ($) =>
      seq(token("("), choice(choice($._PositionalArgumentList, $._NamedArgumentList), seq()), token(")")),
    _PositionalArgumentList: ($) =>
      seq(field(undefined, $.ArgumentMember), repeat(seq(token(","), field(undefined, $.ArgumentMember)))),
    ArgumentMember: ($) => field(undefined, $.Argument),
    Argument: ($) => field(undefined, $.ArgumentValue),
    _NamedArgumentList: ($) =>
      seq(field(undefined, $.NamedArgumentMember), repeat(seq(token(","), field(undefined, $.NamedArgumentMember)))),
    NamedArgumentMember: ($) => field(undefined, $.NamedArgument),
    NamedArgument: ($) => seq(field(undefined, $.ParameterRedefinition), token("="), field(undefined, $.ArgumentValue)),
    ParameterRedefinition: ($) => field(undefined, $.QualifiedName),
    ArgumentValue: ($) => field(undefined, $.OwnedExpression),
    NullExpression: ($) => choice(token("null"), seq(token("("), token(")"))),
    _LiteralExpression: ($) =>
      choice($.LiteralBoolean, $.LiteralString, $.LiteralInteger, $.LiteralReal, $.LiteralInfinity),
    LiteralBoolean: ($) => field(undefined, $.BooleanValue),
    BooleanValue: ($) => choice(token("true"), token("false")),
    LiteralString: ($) => field(undefined, $.STRING_VALUE),
    LiteralInteger: ($) => field(undefined, $.DECIMAL_VALUE),
    LiteralReal: ($) => field(undefined, $.RealValue),
    RealValue: ($) =>
      choice(seq(choice($.DECIMAL_VALUE, seq()), token("."), choice($.DECIMAL_VALUE, $.EXP_VALUE)), $.EXP_VALUE),
    LiteralInfinity: ($) => "*",
    Name: ($) => choice($.ID, $.UNRESTRICTED_NAME),
    GlobalQualification: ($) => seq(token("$"), token("::")),
    Qualification: ($) => seq(seq($.Name, token("::")), repeat(seq($.Name, token("::")))),
    QualifiedName: ($) =>
      seq(choice($.GlobalQualification, seq()), choice($.Qualification, seq()), field(undefined, $.Name)),
    DECIMAL_VALUE: ($) => token(/[0-9]+/),
    EXP_VALUE: ($) =>
      token(
        seq(
          token(/[0-9]+/),
          choice(token("e"), token("E")),
          choice(choice(token("+"), token("-")), seq()),
          token(/[0-9]+/),
        ),
      ),
    ID: ($) => token(seq(token(/[a-zA-Z_]/), repeat(token(/[a-zA-Z_0-9]/)))),
    UNRESTRICTED_NAME: ($) =>
      token(
        seq(
          token("'"),
          repeat(
            choice(
              seq(
                token("\\"),
                choice(token("b"), token("t"), token("n"), token("f"), token("r"), token('"'), token("'"), token("\\")),
              ),
              token(/[^'\\]/),
            ),
          ),
          token("'"),
        ),
      ),
    STRING_VALUE: ($) =>
      token(
        seq(
          token('"'),
          repeat(
            choice(
              seq(
                token("\\"),
                choice(token("b"), token("t"), token("n"), token("f"), token("r"), token('"'), token("'"), token("\\")),
              ),
              token(/[^"\\]/),
            ),
          ),
          token('"'),
        ),
      ),
    REGULAR_COMMENT: ($) => token(seq(token("/*"), token(/[^*]*\*+([^/*][^*]*\*+)*/), token("/"))),
    ML_NOTE: ($) => token(seq(token("//*"), token(/[^*]*\*+([^/*][^*]*\*+)*/), token("/"))),
    SL_NOTE: ($) => token(seq(token("//"), token(/[^\r\n]*/))),
  },
});

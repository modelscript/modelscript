// @ts-nocheck
// Auto-generated TypeScript Wrapper for sysml2
export var InputEncoding;
(function (InputEncoding) {
  InputEncoding[(InputEncoding["UTF8"] = 0)] = "UTF8";
  InputEncoding[(InputEncoding["UTF16LE"] = 1)] = "UTF16LE";
  InputEncoding[(InputEncoding["UTF16BE"] = 2)] = "UTF16BE";
  InputEncoding[(InputEncoding["UTF32LE"] = 3)] = "UTF32LE";
  InputEncoding[(InputEncoding["UTF32BE"] = 4)] = "UTF32BE";
})(InputEncoding || (InputEncoding = {}));
/**
 * A lightweight wrapper over a parsed AST node pointer.
 * Used internally by the Parser class to traverse the tree.
 */
export class ASTNode {
  runtime;
  ptr;
  constructor(runtime, ptr) {
    this.runtime = runtime;
    this.ptr = ptr;
  }
  /** Gets the underlying WASM pointer for this node. */
  getPtr() {
    return this.ptr;
  }
  /** Gets the semantic type ID of this node. */
  getTypeId() {
    return this.runtime.getNodeType ? this.runtime.getNodeType(this.ptr) : this.runtime.readU32(this.ptr) & 0x03ff;
  }
  /** Gets the first child of this node in the AST. */
  getFirstChild() {
    const childPtr = this.runtime.getNodeFirstChild(this.ptr);
    return childPtr === 0 ? null : new ASTNode(this.runtime, childPtr);
  }
  /** Gets the next sibling of this node in the AST. */
  getNextSibling() {
    const siblingPtr = this.runtime.getNodeNextSibling(this.ptr);
    return siblingPtr === 0 ? null : new ASTNode(this.runtime, siblingPtr);
  }
}
/**
 * The core Parser facade.
 * Orchestrates memory transfer and invokes the incremental parsing routine.
 */
export class Parser {
  runtime;
  constructor(runtime) {
    this.runtime = runtime;
  }
  /** Sets the expected text encoding (UTF-8, UTF-16, etc.) for parsing. */
  setEncoding(encoding) {
    if (this.runtime.setInputEncoding) {
      this.runtime.setInputEncoding(encoding);
    }
  }
  /**
   * Parses the given source string or byte array, optionally performing an incremental parse
   * if an old tree and edit bounds are provided.
   */
  parse(source, oldTree = null, editStart = 0, editOldEnd = 0) {
    let view;
    if (typeof source === "string") {
      view = new TextEncoder().encode(source);
    } else {
      view = source;
    }
    const inputPtr = this.runtime.ensureInputBuffer
      ? this.runtime.ensureInputBuffer(view.length)
      : this.runtime.getInputBuffer();
    this.runtime.writeU8Array(inputPtr, view);
    // Explicitly set the input length so the WASM parser knows the byte bounds
    if (this.runtime.wasmExports && this.runtime.wasmExports.setInputLength) {
      this.runtime.wasmExports.setInputLength(view.length);
    } else if (this.runtime.nativeAddon && this.runtime.nativeAddon.setInputLength) {
      this.runtime.nativeAddon.setInputLength(view.length);
    }
    const oldTreePtr = oldTree ? oldTree.getPtr() : 0;
    const astRoot = this.runtime.parse(oldTreePtr, editStart, editOldEnd, view.length);
    return astRoot === 0 ? null : new ASTNode(this.runtime, astRoot);
  }
  /** Reads a WASM-allocated length-prefixed string into a JavaScript string. */
  readString(ptr) {
    if (ptr === 0) return "";
    const lenBytes = this.runtime.readU32(ptr - 4);
    const lenChars = lenBytes / 2;
    if (lenChars <= 0) return "";
    const codes = new Uint16Array(lenChars);
    for (let i = 0; i < lenChars; i++) {
      codes[i] = this.runtime.readU16(ptr + i * 2);
    }
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-16le").decode(codes);
    }
    return String.fromCharCode.apply(null, Array.from(codes));
  }
}
/**
 * The WebAssembly runtime implementation for browser and portable Node.js execution.
 * Backed by a WebAssembly linear memory buffer.
 */
export class WasmRuntime {
  wasmExports;
  memory;
  mem32;
  mem16;
  mem8;
  constructor(wasmExports, memory) {
    this.wasmExports = wasmExports;
    this.memory = memory;
    this.mem32 = new Uint32Array(memory.buffer);
    this.mem16 = new Uint16Array(memory.buffer);
    this.mem8 = new Uint8Array(memory.buffer);
  }
  ensureMemory() {
    if (this.mem32.byteLength === 0 || this.mem32.buffer !== this.memory.buffer) {
      this.mem32 = new Uint32Array(this.memory.buffer);
      this.mem16 = new Uint16Array(this.memory.buffer);
      this.mem8 = new Uint8Array(this.memory.buffer);
    }
  }
  readU32(ptr) {
    this.ensureMemory();
    return this.mem32[ptr / 4];
  }
  readU16(ptr) {
    this.ensureMemory();
    return this.mem16[ptr / 2];
  }
  writeU8Array(ptr, data) {
    this.ensureMemory();
    this.mem8.set(data, ptr);
  }
  getInputBuffer() {
    return this.wasmExports.getInputBuffer
      ? this.wasmExports.getInputBuffer()
      : this.wasmExports.lsp_getInputBuffer
        ? this.wasmExports.lsp_getInputBuffer()
        : 0;
  }
  ensureInputBuffer(size) {
    return this.wasmExports.ensureInputBuffer ? this.wasmExports.ensureInputBuffer(size) : this.getInputBuffer();
  }
  setInputEncoding(enc) {
    if (this.wasmExports.setInputEncoding) this.wasmExports.setInputEncoding(enc);
  }
  parse(oldTreePtr, editStart, editOldEnd, editNewEnd) {
    return this.wasmExports.parse(oldTreePtr, editStart, editOldEnd, editNewEnd);
  }
  getNodeFirstChild(ptr) {
    this.ensureMemory();
    return this.mem32[(ptr + 12) / 4];
  }
  getNodeNextSibling(ptr) {
    this.ensureMemory();
    return this.mem32[(ptr + 16) / 4];
  }
  getNodeType(ptr) {
    this.ensureMemory();
    return this.mem32[ptr / 4] & 0x03ff;
  }
  /** Gets the imports needed to instantiate the compiled WASM module. */
  static getWasmImports(onTextEdit, getMemory) {
    return {
      env: {
        emitTextEdit: (startByte, endByte, newSourcePtr) => {
          const memory = getMemory();
          if (!memory) return;
          const memoryArray = new Uint16Array(memory.buffer);
          const lenBytes = new Uint32Array(memory.buffer)[(newSourcePtr - 4) / 4];
          const lenChars = lenBytes / 2;
          let str = "";
          const offset = newSourcePtr / 2;
          for (let i = 0; i < lenChars; i++) {
            str += String.fromCharCode(memoryArray[offset + i]);
          }
          onTextEdit(startByte, endByte, str);
        },
      },
    };
  }
}
/**
 * The Native Addon runtime implementation for high-performance Node.js execution.
 * Proxies calls directly to the N-API module.
 */
export class NativeRuntime {
  nativeAddon;
  constructor(nativeAddon) {
    this.nativeAddon = nativeAddon;
  }
  readU32(ptr) {
    return this.nativeAddon.readU32(ptr);
  }
  readU16(ptr) {
    return this.nativeAddon.readU16(ptr);
  }
  writeU8Array(ptr, data) {
    this.nativeAddon.writeU8Array(ptr, data);
  }
  getInputBuffer() {
    return this.nativeAddon.getInputBuffer();
  }
  ensureInputBuffer(size) {
    return this.nativeAddon.ensureInputBuffer ? this.nativeAddon.ensureInputBuffer(size) : this.getInputBuffer();
  }
  setInputEncoding(enc) {
    if (this.nativeAddon.setInputEncoding) this.nativeAddon.setInputEncoding(enc);
  }
  parse(oldTreePtr, editStart, editOldEnd, editNewEnd) {
    return this.nativeAddon.parse(oldTreePtr, editStart, editOldEnd, editNewEnd);
  }
  getNodeFirstChild(ptr) {
    return this.nativeAddon.getNodeFirstChild(ptr);
  }
  getNodeNextSibling(ptr) {
    return this.nativeAddon.getNodeNextSibling(ptr);
  }
  getNodeType(ptr) {
    return this.nativeAddon.getNodeType ? this.nativeAddon.getNodeType(ptr) : this.readU32(ptr) & 0x03ff;
  }
}
export const SYNTAX_NAMES =
  typeof [
    "ERROR",
    "/\\s/",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    '"<"',
    '">"',
    '";"',
    '"{"',
    '"}"',
    '"public"',
    '"private"',
    '"protected"',
    '"dependency"',
    '"from"',
    '","',
    '"to"',
    '"comment"',
    '"about"',
    '"locale"',
    '"doc"',
    '"rep"',
    '"language"',
    '"#"',
    '"metadata"',
    '"@"',
    '":"',
    '"defined"',
    '"by"',
    '"ref"',
    '":>>"',
    '"redefines"',
    '"def"',
    '"package"',
    '"standard"',
    '"library"',
    '"filter"',
    '"alias"',
    '"for"',
    '"import"',
    '"all"',
    '"::"',
    '"**"',
    '"*"',
    '"["',
    '"]"',
    '":>"',
    '"specializes"',
    '"ordered"',
    '"nonunique"',
    '"subsets"',
    '"subset"',
    '"::>"',
    '"references"',
    '"reference"',
    '"=>"',
    '"crosses"',
    '"redefine"',
    '".."',
    '"variant"',
    '"end"',
    '"in"',
    '"out"',
    '"inout"',
    '"derived"',
    '"abstract"',
    '"variation"',
    '"constant"',
    '"individual"',
    '"snapshot"',
    '"timeslice"',
    '"="',
    '":="',
    '"default"',
    '"attribute"',
    '"enum"',
    '"occurrence"',
    '"item"',
    '"part"',
    '"port"',
    '"~"',
    '"connection"',
    '"connect"',
    '"("',
    '")"',
    '"binding"',
    '"bind"',
    '"succession"',
    '"first"',
    '"then"',
    '"if"',
    '"interface"',
    '"allocation"',
    '"allocate"',
    '"flow"',
    '"of"',
    '"."',
    '"action"',
    '"else"',
    '"while"',
    '"loop"',
    '"until"',
    '"merge"',
    '"decide"',
    '"join"',
    '"fork"',
    '"accept"',
    '"via"',
    '"send"',
    '"assign"',
    '"=:"',
    '"perform"',
    '"calc"',
    '"return"',
    '"constraint"',
    '"assert"',
    '"not"',
    '"requirement"',
    '"subject"',
    '"assume"',
    '"require"',
    '"actor"',
    '"stakeholder"',
    '"satisfy"',
    '"concern"',
    '"case"',
    '"analysis"',
    '"verification"',
    '"verify"',
    '"objective"',
    '"use"',
    '"include"',
    '"state"',
    '"parallel"',
    '"entry"',
    '"do"',
    '"exit"',
    '"exhibit"',
    '"transition"',
    '"view"',
    '"viewpoint"',
    '"rendering"',
    '"?"',
    '"??"',
    '"implies"',
    '"|"',
    '"or"',
    '"xor"',
    '"&"',
    '"and"',
    '"=="',
    '"!="',
    '"==="',
    '"!=="',
    '"hastype"',
    '"istype"',
    '"@@"',
    '"as"',
    '"meta"',
    '"<="',
    '">="',
    '"+"',
    '"-"',
    '"/"',
    '"%"',
    '"^"',
    '"->"',
    '".?"',
    '"new"',
    '"null"',
    '"true"',
    '"false"',
    '"$"',
    "/[0-9]+/",
    "/[0-9]+[eE][+-]?[0-9]+/",
    "/[a-zA-Z_][a-zA-Z_0-9]*/",
    "/'(?:[^'\\\\]|\\\\.)*'/",
    '/"(?:[^"\\\\]|\\\\.)*"/',
    "/\\/\\*[^*]*\\*+([^/*][^*]*\\*+)*\\//",
    "/\\/\\/\\*[^*]*\\*+([^/*][^*]*\\*+)*\\//",
    "/\\/\\/[^\\r\\n]*/",
    "RootNamespace",
    "_PackageBodyElement",
    "_Identification",
    "_RelationshipBody",
    "VisibilityIndicator",
    "Dependency",
    "Annotation",
    "OwnedAnnotation",
    "AnnotatingMember",
    "_AnnotatingElement",
    "Comment",
    "Documentation",
    "TextualRepresentation",
    "PrefixMetadataAnnotation",
    "PrefixMetadataMember",
    "PrefixMetadataUsage",
    "MetadataUsage",
    "MetadataTyping",
    "_MetadataBody",
    "MetadataBodyUsageMember",
    "MetadataBodyUsage",
    "MetadataDefinition",
    "Package",
    "LibraryPackage",
    "_PackageBody",
    "PackageMember",
    "ElementFilterMember",
    "AliasMember",
    "_ImportPrefix",
    "Import",
    "MembershipImport",
    "_ImportedMembership",
    "NamespaceImport",
    "_ImportedNamespace",
    "FilterPackage",
    "FilterPackageImport",
    "FilterPackageMembershipImport",
    "FilterPackageNamespaceImport",
    "FilterPackageMember",
    "_DefinitionElement",
    "_UsageElement",
    "_NonOccurrenceUsageElement",
    "_OccurrenceUsageElement",
    "_StructureUsageElement",
    "_BehaviorUsageElement",
    "_SubclassificationPart",
    "OwnedSubclassification",
    "_FeatureDeclaration",
    "_FeatureSpecializationPart",
    "_MultiplicityPart",
    "_FeatureSpecialization",
    "_Typings",
    "_Subsettings",
    "_References",
    "_Crosses",
    "_Redefinitions",
    "FeatureTyping",
    "OwnedFeatureTyping",
    "OwnedSubsetting",
    "OwnedReferenceSubsetting",
    "OwnedCrossSubsetting",
    "OwnedRedefinition",
    "OwnedMultiplicity",
    "MultiplicityRange",
    "MultiplicityExpressionMember",
    "_Definition",
    "_DefinitionBody",
    "_DefinitionBodyItem",
    "DefinitionMember",
    "VariantUsageMember",
    "NonOccurrenceUsageMember",
    "OccurrenceUsageMember",
    "_usage_modifier",
    "_UsageDeclaration",
    "_UsageCompletion",
    "_Usage",
    "_ValuePart",
    "FeatureValue",
    "DefaultReferenceUsage",
    "ReferenceUsage",
    "AttributeDefinition",
    "AttributeUsage",
    "EnumerationDefinition",
    "_EnumerationBody",
    "EnumerationUsageMember",
    "EnumeratedValue",
    "EnumerationUsage",
    "OccurrenceDefinition",
    "OccurrenceUsage",
    "ItemDefinition",
    "ItemUsage",
    "PartDefinition",
    "PartUsage",
    "PortDefinition",
    "PortUsage",
    "ConjugatedPortTyping",
    "ConnectorEndMember",
    "ConnectorEnd",
    "ConnectionDefinition",
    "ConnectionUsage",
    "_ConnectorPart",
    "_BinaryConnectorPart",
    "_NaryConnectorPart",
    "BindingConnectorAsUsage",
    "SuccessionAsUsage",
    "InterfaceDefinition",
    "InterfaceUsage",
    "AllocationDefinition",
    "AllocationUsage",
    "FlowDefinition",
    "FlowUsage",
    "SuccessionFlowUsage",
    "PayloadFeatureMember",
    "PayloadFeature",
    "FlowEndMember",
    "FlowEnd",
    "FlowFeatureMember",
    "FlowFeature",
    "ActionDefinition",
    "_ActionBody",
    "_ActionBodyItem",
    "EmptySuccessionMember",
    "MultiplicitySourceEnd",
    "ActionNodeMember",
    "_ActionNode",
    "IfNode",
    "ActionBodyParameter",
    "WhileLoopNode",
    "ForLoopNode",
    "ForVariableDeclaration",
    "ControlNode",
    "MergeNode",
    "DecisionNode",
    "JoinNode",
    "ForkNode",
    "ActionUsage",
    "AcceptActionNode",
    "SendActionNode",
    "AssignActionNode",
    "PerformActionUsage",
    "CalculationDefinition",
    "_CalculationBody",
    "_ParameterList",
    "ParameterMember",
    "ReturnParameterMember",
    "ResultExpressionMember",
    "CalculationUsage",
    "ConstraintDefinition",
    "ConstraintUsage",
    "AssertConstraintUsage",
    "RequirementDefinition",
    "_RequirementBody",
    "_RequirementBodyItem",
    "SubjectMember",
    "SubjectUsage",
    "RequirementConstraintMember",
    "RequirementConstraintUsage",
    "ActorMember",
    "ActorUsage",
    "StakeholderMember",
    "StakeholderUsage",
    "RequirementUsage",
    "SatisfyRequirementUsage",
    "ConcernDefinition",
    "ConcernUsage",
    "CaseDefinition",
    "_CaseBody",
    "CaseUsage",
    "AnalysisCaseDefinition",
    "AnalysisCaseUsage",
    "VerificationCaseDefinition",
    "VerificationCaseUsage",
    "_VerificationBody",
    "_VerificationBodyItem",
    "VerifyRequirementUsageMember",
    "VerifyRequirementUsage",
    "ObjectiveMember",
    "ObjectiveRequirementUsage",
    "UseCaseDefinition",
    "UseCaseUsage",
    "IncludeUseCaseUsage",
    "StateDefinition",
    "_StateBodyItem",
    "EntryActionMember",
    "DoActionMember",
    "ExitActionMember",
    "StateActionUsage",
    "StateUsage",
    "ExhibitStateUsage",
    "TransitionUsageMember",
    "TransitionUsage",
    "ViewDefinition",
    "ViewUsage",
    "ViewpointDefinition",
    "ViewpointUsage",
    "RenderingDefinition",
    "RenderingUsage",
    "OwnedExpressionMember",
    "OwnedExpression",
    "_Expression",
    "OwnedExpressionReference",
    "ConditionalExpression",
    "NullCoalescingExpression",
    "ImpliesExpressionReference",
    "ImpliesExpressionMember",
    "ImpliesExpression",
    "OrExpressionReference",
    "OrExpressionMember",
    "OrExpression",
    "XorExpressionReference",
    "XorExpressionMember",
    "XorExpression",
    "AndExpression",
    "EqualityExpressionReference",
    "EqualityExpressionMember",
    "EqualityExpression",
    "EqualityOperator",
    "ClassificationExpression",
    "ClassificationTestOperator",
    "MetadataReference",
    "TypeReferenceMember",
    "TypeResultMember",
    "TypeReference",
    "ReferenceTyping",
    "RelationalExpression",
    "RelationalOperator",
    "RangeExpression",
    "AdditiveExpression",
    "AdditiveOperator",
    "MultiplicativeExpression",
    "MultiplicativeOperator",
    "ExponentiationExpression",
    "ExponentiationOperator",
    "UnaryExpression",
    "UnaryOperator",
    "ExtentExpression",
    "_postfix_operation",
    "PrimaryExpression",
    "FunctionReferenceExpression",
    "FunctionReferenceMember",
    "FunctionReference",
    "FeatureChainMember",
    "OwnedFeatureChain",
    "_BaseExpression",
    "BodyExpression",
    "ExpressionBodyMember",
    "ExpressionBody",
    "SequenceExpression",
    "FeatureReferenceExpression",
    "FeatureReferenceMember",
    "MetadataAccessExpression",
    "ElementReferenceMember",
    "InvocationExpression",
    "ConstructorExpression",
    "ConstructorResultMember",
    "ConstructorResult",
    "InstantiatedTypeMember",
    "_FeatureChain",
    "OwnedFeatureChaining",
    "_ArgumentList",
    "_PositionalArgumentList",
    "ArgumentMember",
    "Argument",
    "_NamedArgumentList",
    "NamedArgumentMember",
    "NamedArgument",
    "ParameterRedefinition",
    "ArgumentValue",
    "NullExpression",
    "_LiteralExpression",
    "LiteralBoolean",
    "BooleanValue",
    "LiteralString",
    "LiteralInteger",
    "LiteralReal",
    "RealValue",
    "Name",
    "GlobalQualification",
    "Qualification",
    "QualifiedName",
    "_START",
    "__PackageBodyElement*",
    "_(PackageMember | ElementFilterMember | AliasMember | Import | AnnotatingMember)",
    "_(Name | ())",
    '_(("<" Name ">" (Name | ())) | Name)',
    '_(";" | ("{" OwnedAnnotation* "}"))',
    "_OwnedAnnotation*",
    '_("public" | "private" | "protected")',
    "_PrefixMetadataAnnotation*",
    "_(_Identification | ())",
    '_(((_Identification | ()) "from") | ())',
    '_("," QualifiedName)*',
    "_(Comment | Documentation | TextualRepresentation | MetadataUsage)",
    '_("," Annotation)*',
    '_(("about" Annotation ("," Annotation)*) | ())',
    '_(("comment" (_Identification | ()) (("about" Annotation ("," Annotation)*) | ())) | ())',
    '_(("locale" STRING_VALUE) | ())',
    '_(("rep" (_Identification | ())) | ())',
    "__usage_modifier*",
    '_("metadata" | "@")',
    '_(":" | ("defined" "by"))',
    '_(((":" | ("defined" "by"))) | ())',
    '_(((_Identification | ()) (((":" | ("defined" "by"))) | ())) | ())',
    '_(";" | ("{" (DefinitionMember | MetadataBodyUsageMember | AliasMember | Import)* "}"))',
    "_(DefinitionMember | MetadataBodyUsageMember | AliasMember | Import)",
    "_(DefinitionMember | MetadataBodyUsageMember | AliasMember | Import)*",
    '_("ref" | ())',
    '_(":>>" | "redefines")',
    '_((":>>" | "redefines") | ())',
    "_(_FeatureSpecializationPart | ())",
    "_(_ValuePart | ())",
    '_("standard" | ())',
    '_(";" | ("{" _PackageBodyElement* "}"))',
    "_(VisibilityIndicator | ())",
    "_(_DefinitionElement | _UsageElement)",
    '_(("<" Name ">") | ())',
    '_("all" | ())',
    "_(MembershipImport | NamespaceImport)",
    '_(("::" "**") | ())',
    "_(_ImportedNamespace | FilterPackage)",
    "_FilterPackageMember*",
    "_(FilterPackageMembershipImport | FilterPackageNamespaceImport)",
    "_(Package | LibraryPackage | _AnnotatingElement | Dependency | AttributeDefinition | EnumerationDefinition | OccurrenceDefinition | ItemDefinition | MetadataDefinition | PartDefinition | ConnectionDefinition | FlowDefinition | InterfaceDefinition | AllocationDefinition | PortDefinition | ActionDefinition | CalculationDefinition | StateDefinition | ConstraintDefinition | RequirementDefinition | ConcernDefinition | CaseDefinition | AnalysisCaseDefinition | VerificationCaseDefinition | UseCaseDefinition | ViewDefinition | ViewpointDefinition | RenderingDefinition)",
    "_(_NonOccurrenceUsageElement | _OccurrenceUsageElement)",
    "_(DefaultReferenceUsage | ReferenceUsage | AttributeUsage | EnumerationUsage | BindingConnectorAsUsage | SuccessionAsUsage)",
    "_(_StructureUsageElement | _BehaviorUsageElement)",
    "_(OccurrenceUsage | ItemUsage | PartUsage | PortUsage | ConnectionUsage | InterfaceUsage | AllocationUsage | FlowUsage | SuccessionFlowUsage | ViewUsage | RenderingUsage)",
    "_(ActionUsage | CalculationUsage | StateUsage | ConstraintUsage | RequirementUsage | ConcernUsage | CaseUsage | AnalysisCaseUsage | VerificationCaseUsage | UseCaseUsage | ViewpointUsage | PerformActionUsage | ExhibitStateUsage | IncludeUseCaseUsage | AssertConstraintUsage | SatisfyRequirementUsage)",
    '_(":>" | "specializes")',
    '_("," OwnedSubclassification)*',
    "_((_Identification (_FeatureSpecializationPart | ())) | _FeatureSpecializationPart)",
    "_(_FeatureSpecialization | _MultiplicityPart)",
    "_(_FeatureSpecialization | _MultiplicityPart)*",
    '_(OwnedMultiplicity | ((OwnedMultiplicity | ()) (("ordered" ("nonunique" | ())) | ("nonunique" ("ordered" | ())))))',
    "_(OwnedMultiplicity | ())",
    '_("nonunique" | ())',
    '_(("ordered" ("nonunique" | ())) | ("nonunique" ("ordered" | ())))',
    '_("ordered" | ())',
    "_(_Typings | _Subsettings | _References | _Crosses | _Redefinitions)",
    '_("," FeatureTyping)*',
    '_(":>" | "subsets" | "subset")',
    '_("," OwnedSubsetting)*',
    '_("::>" | "references" | "reference")',
    '_("=>" | "crosses")',
    '_(":>>" | "redefines" | "redefine")',
    '_("," OwnedRedefinition)*',
    "_(OwnedFeatureTyping | ConjugatedPortTyping)",
    "_(QualifiedName | OwnedFeatureChain)",
    '_((".." MultiplicityExpressionMember) | ())',
    "_(_LiteralExpression | FeatureReferenceExpression)",
    "_(_SubclassificationPart | ())",
    '_(";" | ("{" _DefinitionBodyItem* "}"))',
    "__DefinitionBodyItem*",
    "_(DefinitionMember | VariantUsageMember | NonOccurrenceUsageMember | ((EmptySuccessionMember | ()) OccurrenceUsageMember) | AliasMember | Import | AnnotatingMember)",
    "_(EmptySuccessionMember | ())",
    '_("end" | "in" | "out" | "inout" | "derived" | "abstract" | "variation" | "constant" | "ref" | "redefine" | "redefines" | "subset" | "subsets" | "individual" | "snapshot" | "timeslice" | PrefixMetadataMember)',
    "_(_UsageDeclaration | ())",
    '_("=" | ":=" | ("default" (("=" | ":=") | ())))',
    '_("=" | ":=")',
    '_(("=" | ":=") | ())',
    '_(";" | ("{" (AnnotatingMember | EnumerationUsageMember)* "}"))',
    "_(AnnotatingMember | EnumerationUsageMember)",
    "_(AnnotatingMember | EnumerationUsageMember)*",
    '_("enum" | ())',
    '_("::>" | "references")',
    '_((Name ("::>" | "references")) | ())',
    '_(("connect" _ConnectorPart) | ())',
    '_(("connection" (_UsageDeclaration | ()) (_ValuePart | ()) (("connect" _ConnectorPart) | ())) | ("connect" _ConnectorPart))',
    "_(_BinaryConnectorPart | _NaryConnectorPart)",
    '_("," ConnectorEndMember)*',
    '_(("binding" (_UsageDeclaration | ())) | ())',
    '_(("succession" (_UsageDeclaration | ())) | ())',
    '_(("if" OwnedExpression) | ())',
    '_(("allocate" _ConnectorPart) | ())',
    '_(("allocation" (_UsageDeclaration | ()) (("allocate" _ConnectorPart) | ())) | ("allocate" _ConnectorPart))',
    '_((FlowEndMember "to" FlowEndMember) | ((_UsageDeclaration | ()) (_ValuePart | ()) (("of" PayloadFeatureMember) | ()) (("from" FlowEndMember "to" FlowEndMember) | ())))',
    '_(("of" PayloadFeatureMember) | ())',
    '_(("from" FlowEndMember "to" FlowEndMember) | ())',
    "_(((_Identification | ()) _FeatureSpecializationPart (_ValuePart | ())) | ((_Identification | ()) _ValuePart) | (OwnedFeatureTyping (OwnedMultiplicity | ())) | (OwnedMultiplicity OwnedFeatureTyping))",
    '_((OwnedReferenceSubsetting ".") | ())',
    "_(_ParameterList | ())",
    '_(";" | ("{" _ActionBodyItem* "}"))',
    "__ActionBodyItem*",
    "_(Import | AliasMember | DefinitionMember | VariantUsageMember | NonOccurrenceUsageMember | ((EmptySuccessionMember | ()) _OccurrenceUsageElement) | ActionNodeMember | ReturnParameterMember)",
    "_(IfNode | WhileLoopNode | ForLoopNode | ControlNode | AcceptActionNode | SendActionNode | AssignActionNode)",
    '_(("action" (_UsageDeclaration | ())) | ())',
    "_(ActionBodyParameter | IfNode)",
    '_(("else" (ActionBodyParameter | IfNode)) | ())',
    '_(("while" OwnedExpression) | "loop")',
    '_(("until" OwnedExpression ";") | ())',
    "_(MergeNode | DecisionNode | JoinNode | ForkNode)",
    '_(("via" OwnedReferenceSubsetting) | ())',
    '_(("to" OwnedExpression) | ())',
    '_((OwnedReferenceSubsetting (_FeatureSpecializationPart | ())) | ("action" (_UsageDeclaration | ())))',
    '_(";" | ("{" (_ActionBodyItem | ReturnParameterMember)* (ResultExpressionMember | ()) "}"))',
    "_(_ActionBodyItem | ReturnParameterMember)",
    "_(_ActionBodyItem | ReturnParameterMember)*",
    "_(ResultExpressionMember | ())",
    '_("," ParameterMember)*',
    '_((ParameterMember ("," ParameterMember)*) | ())',
    '_("not" | ())',
    '_((OwnedReferenceSubsetting (_FeatureSpecializationPart | ())) | ("constraint" (_UsageDeclaration | ()) (_ValuePart | ())))',
    '_(";" | ("{" _RequirementBodyItem* "}"))',
    "__RequirementBodyItem*",
    "_(_DefinitionBodyItem | SubjectMember | RequirementConstraintMember | ActorMember | StakeholderMember)",
    '_("assume" | "require")',
    "__FeatureSpecialization*",
    '_((OwnedReferenceSubsetting _FeatureSpecialization* _CalculationBody) | (_usage_modifier* ("constraint" | ()) (_UsageDeclaration | ()) (_ValuePart | ()) _CalculationBody))',
    '_("constraint" | ())',
    '_("assert" | ())',
    '_((OwnedReferenceSubsetting (_FeatureSpecializationPart | ())) | ("requirement" (_UsageDeclaration | ())))',
    '_(("by" OwnedReferenceSubsetting) | ())',
    '_(";" | ("{" (_ActionBodyItem | SubjectMember | ActorMember | StakeholderMember | ObjectiveMember)* (ResultExpressionMember | ()) "}"))',
    "_(_ActionBodyItem | SubjectMember | ActorMember | StakeholderMember | ObjectiveMember)",
    "_(_ActionBodyItem | SubjectMember | ActorMember | StakeholderMember | ObjectiveMember)*",
    '_(";" | ("{" _VerificationBodyItem* (ResultExpressionMember | ()) "}"))',
    "__VerificationBodyItem*",
    "_(_ActionBodyItem | VerifyRequirementUsageMember | ObjectiveMember)",
    '_((OwnedReferenceSubsetting (_FeatureSpecializationPart | ())) | ("use" "case" (_UsageDeclaration | ())))',
    '_(";" | (("parallel" | ()) "{" _StateBodyItem* "}"))',
    '_("parallel" | ())',
    "__StateBodyItem*",
    "_(Import | AliasMember | DefinitionMember | VariantUsageMember | NonOccurrenceUsageMember | ((EmptySuccessionMember | ()) _OccurrenceUsageElement) | TransitionUsageMember | EntryActionMember | DoActionMember | ExitActionMember)",
    '_(";" | ((_UsageDeclaration | ()) (_ValuePart | ()) _ActionBody))',
    '_((OwnedReferenceSubsetting (_FeatureSpecializationPart | ())) | ("state" (_UsageDeclaration | ())))',
    '_(((_UsageDeclaration | ()) "first") | ())',
    '_(("accept" PayloadFeatureMember) | ())',
    '_(("do" StateActionUsage) | ())',
    '_(";" | ("{" (_DefinitionBodyItem | ElementFilterMember)* "}"))',
    "_(_DefinitionBodyItem | ElementFilterMember)",
    "_(_DefinitionBodyItem | ElementFilterMember)*",
    "_(ConditionalExpression | NullCoalescingExpression | ImpliesExpression | OrExpression | XorExpression | AndExpression | EqualityExpression | ClassificationExpression | RelationalExpression | RangeExpression | AdditiveExpression | MultiplicativeExpression | ExponentiationExpression | UnaryExpression | ExtentExpression | PrimaryExpression | _BaseExpression)",
    '_("if" _Expression "?" OwnedExpressionReference "else" OwnedExpressionReference)',
    '_("??" ImpliesExpressionReference)*',
    '_(_Expression (("??" ImpliesExpressionReference) ("??" ImpliesExpressionReference)*))',
    '_("implies" ImpliesExpressionReference)*',
    '_(_Expression (("implies" ImpliesExpressionReference) ("implies" ImpliesExpressionReference)*))',
    '_(("|" _Expression) | ("or" XorExpressionReference))',
    '_(("|" _Expression) | ("or" XorExpressionReference))*',
    '_(_Expression ((("|" _Expression) | ("or" XorExpressionReference)) (("|" _Expression) | ("or" XorExpressionReference))*))',
    '_("xor" _Expression)*',
    '_(_Expression (("xor" _Expression) ("xor" _Expression)*))',
    '_(("&" _Expression) | ("and" EqualityExpressionReference))',
    '_(("&" _Expression) | ("and" EqualityExpressionReference))*',
    '_(_Expression ((("&" _Expression) | ("and" EqualityExpressionReference)) (("&" _Expression) | ("and" EqualityExpressionReference))*))',
    "_(EqualityOperator _Expression)*",
    "_(_Expression ((EqualityOperator _Expression) (EqualityOperator _Expression)*))",
    '_("==" | "!=" | "===" | "!==")',
    "_((ClassificationTestOperator TypeReferenceMember) | (CastOperator TypeResultMember))",
    "_((_Expression ((ClassificationTestOperator TypeReferenceMember) | (CastOperator TypeResultMember))) | (ClassificationTestOperator TypeReferenceMember) | (MetadataReference MetaClassificationTestOperator TypeReferenceMember) | (CastOperator TypeResultMember) | (MetadataReference MetaCastOperator TypeResultMember))",
    '_("hastype" | "istype" | "@")',
    "MetaClassificationTestOperator",
    "CastOperator",
    "MetaCastOperator",
    "_(RelationalOperator _Expression)*",
    "_(_Expression ((RelationalOperator _Expression) (RelationalOperator _Expression)*))",
    '_("<" | ">" | "<=" | ">=")',
    '_(_Expression ".." _Expression)',
    "_(AdditiveOperator _Expression)*",
    "_(_Expression ((AdditiveOperator _Expression) (AdditiveOperator _Expression)*))",
    '_("+" | "-")',
    "_(MultiplicativeOperator _Expression)*",
    "_(_Expression ((MultiplicativeOperator _Expression) (MultiplicativeOperator _Expression)*))",
    '_("*" | "/" | "%")',
    "_(_Expression ExponentiationOperator _Expression)",
    '_("**" | "^")',
    "_(UnaryOperator _Expression)",
    '_("+" | "-" | "~" | "not")',
    '_("all" TypeResultMember)',
    '_(("#" "(" SequenceExpression ")") | ("[" SequenceExpression "]") | ("->" InstantiatedTypeMember (BodyExpression | FunctionReferenceExpression | _ArgumentList)) | ("." BodyExpression) | (".?" BodyExpression))',
    "_(BodyExpression | FunctionReferenceExpression | _ArgumentList)",
    '_(("." FeatureChainMember) | ())',
    "__postfix_operation*",
    '_((_BaseExpression ("." FeatureChainMember) _postfix_operation*) | (_BaseExpression (_postfix_operation _postfix_operation*)))',
    '_(NullExpression | _LiteralExpression | FeatureReferenceExpression | MetadataAccessExpression | InvocationExpression | ConstructorExpression | BodyExpression | ("(" SequenceExpression ")"))',
    '_("," | ("," SequenceExpression))',
    '_(("," | ("," SequenceExpression)) | ())',
    '_("." OwnedFeatureChaining)*',
    "_(_PositionalArgumentList | _NamedArgumentList)",
    "_((_PositionalArgumentList | _NamedArgumentList) | ())",
    '_("," ArgumentMember)*',
    '_("," NamedArgumentMember)*',
    '_("null" | ("(" ")"))',
    "_(LiteralBoolean | LiteralString | LiteralInteger | LiteralReal | LiteralInfinity)",
    '_("true" | "false")',
    "_(DECIMAL_VALUE | ())",
    "_(DECIMAL_VALUE | EXP_VALUE)",
    '_(((DECIMAL_VALUE | ()) "." (DECIMAL_VALUE | EXP_VALUE)) | EXP_VALUE)',
    "LiteralInfinity",
    "_(ID | UNRESTRICTED_NAME)",
    '_(Name "::")*',
    "_(GlobalQualification | ())",
    "_(Qualification | ())",
    "DECIMAL_VALUE",
    "EXP_VALUE",
    "ID",
    "UNRESTRICTED_NAME",
    "STRING_VALUE",
    "REGULAR_COMMENT",
    "ML_NOTE",
    "SL_NOTE",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "UNKNOWN",
    "EOF",
  ] !== "undefined"
    ? [
        "ERROR",
        "/\\s/",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        '"<"',
        '">"',
        '";"',
        '"{"',
        '"}"',
        '"public"',
        '"private"',
        '"protected"',
        '"dependency"',
        '"from"',
        '","',
        '"to"',
        '"comment"',
        '"about"',
        '"locale"',
        '"doc"',
        '"rep"',
        '"language"',
        '"#"',
        '"metadata"',
        '"@"',
        '":"',
        '"defined"',
        '"by"',
        '"ref"',
        '":>>"',
        '"redefines"',
        '"def"',
        '"package"',
        '"standard"',
        '"library"',
        '"filter"',
        '"alias"',
        '"for"',
        '"import"',
        '"all"',
        '"::"',
        '"**"',
        '"*"',
        '"["',
        '"]"',
        '":>"',
        '"specializes"',
        '"ordered"',
        '"nonunique"',
        '"subsets"',
        '"subset"',
        '"::>"',
        '"references"',
        '"reference"',
        '"=>"',
        '"crosses"',
        '"redefine"',
        '".."',
        '"variant"',
        '"end"',
        '"in"',
        '"out"',
        '"inout"',
        '"derived"',
        '"abstract"',
        '"variation"',
        '"constant"',
        '"individual"',
        '"snapshot"',
        '"timeslice"',
        '"="',
        '":="',
        '"default"',
        '"attribute"',
        '"enum"',
        '"occurrence"',
        '"item"',
        '"part"',
        '"port"',
        '"~"',
        '"connection"',
        '"connect"',
        '"("',
        '")"',
        '"binding"',
        '"bind"',
        '"succession"',
        '"first"',
        '"then"',
        '"if"',
        '"interface"',
        '"allocation"',
        '"allocate"',
        '"flow"',
        '"of"',
        '"."',
        '"action"',
        '"else"',
        '"while"',
        '"loop"',
        '"until"',
        '"merge"',
        '"decide"',
        '"join"',
        '"fork"',
        '"accept"',
        '"via"',
        '"send"',
        '"assign"',
        '"=:"',
        '"perform"',
        '"calc"',
        '"return"',
        '"constraint"',
        '"assert"',
        '"not"',
        '"requirement"',
        '"subject"',
        '"assume"',
        '"require"',
        '"actor"',
        '"stakeholder"',
        '"satisfy"',
        '"concern"',
        '"case"',
        '"analysis"',
        '"verification"',
        '"verify"',
        '"objective"',
        '"use"',
        '"include"',
        '"state"',
        '"parallel"',
        '"entry"',
        '"do"',
        '"exit"',
        '"exhibit"',
        '"transition"',
        '"view"',
        '"viewpoint"',
        '"rendering"',
        '"?"',
        '"??"',
        '"implies"',
        '"|"',
        '"or"',
        '"xor"',
        '"&"',
        '"and"',
        '"=="',
        '"!="',
        '"==="',
        '"!=="',
        '"hastype"',
        '"istype"',
        '"@@"',
        '"as"',
        '"meta"',
        '"<="',
        '">="',
        '"+"',
        '"-"',
        '"/"',
        '"%"',
        '"^"',
        '"->"',
        '".?"',
        '"new"',
        '"null"',
        '"true"',
        '"false"',
        '"$"',
        "/[0-9]+/",
        "/[0-9]+[eE][+-]?[0-9]+/",
        "/[a-zA-Z_][a-zA-Z_0-9]*/",
        "/'(?:[^'\\\\]|\\\\.)*'/",
        '/"(?:[^"\\\\]|\\\\.)*"/',
        "/\\/\\*[^*]*\\*+([^/*][^*]*\\*+)*\\//",
        "/\\/\\/\\*[^*]*\\*+([^/*][^*]*\\*+)*\\//",
        "/\\/\\/[^\\r\\n]*/",
        "RootNamespace",
        "_PackageBodyElement",
        "_Identification",
        "_RelationshipBody",
        "VisibilityIndicator",
        "Dependency",
        "Annotation",
        "OwnedAnnotation",
        "AnnotatingMember",
        "_AnnotatingElement",
        "Comment",
        "Documentation",
        "TextualRepresentation",
        "PrefixMetadataAnnotation",
        "PrefixMetadataMember",
        "PrefixMetadataUsage",
        "MetadataUsage",
        "MetadataTyping",
        "_MetadataBody",
        "MetadataBodyUsageMember",
        "MetadataBodyUsage",
        "MetadataDefinition",
        "Package",
        "LibraryPackage",
        "_PackageBody",
        "PackageMember",
        "ElementFilterMember",
        "AliasMember",
        "_ImportPrefix",
        "Import",
        "MembershipImport",
        "_ImportedMembership",
        "NamespaceImport",
        "_ImportedNamespace",
        "FilterPackage",
        "FilterPackageImport",
        "FilterPackageMembershipImport",
        "FilterPackageNamespaceImport",
        "FilterPackageMember",
        "_DefinitionElement",
        "_UsageElement",
        "_NonOccurrenceUsageElement",
        "_OccurrenceUsageElement",
        "_StructureUsageElement",
        "_BehaviorUsageElement",
        "_SubclassificationPart",
        "OwnedSubclassification",
        "_FeatureDeclaration",
        "_FeatureSpecializationPart",
        "_MultiplicityPart",
        "_FeatureSpecialization",
        "_Typings",
        "_Subsettings",
        "_References",
        "_Crosses",
        "_Redefinitions",
        "FeatureTyping",
        "OwnedFeatureTyping",
        "OwnedSubsetting",
        "OwnedReferenceSubsetting",
        "OwnedCrossSubsetting",
        "OwnedRedefinition",
        "OwnedMultiplicity",
        "MultiplicityRange",
        "MultiplicityExpressionMember",
        "_Definition",
        "_DefinitionBody",
        "_DefinitionBodyItem",
        "DefinitionMember",
        "VariantUsageMember",
        "NonOccurrenceUsageMember",
        "OccurrenceUsageMember",
        "_usage_modifier",
        "_UsageDeclaration",
        "_UsageCompletion",
        "_Usage",
        "_ValuePart",
        "FeatureValue",
        "DefaultReferenceUsage",
        "ReferenceUsage",
        "AttributeDefinition",
        "AttributeUsage",
        "EnumerationDefinition",
        "_EnumerationBody",
        "EnumerationUsageMember",
        "EnumeratedValue",
        "EnumerationUsage",
        "OccurrenceDefinition",
        "OccurrenceUsage",
        "ItemDefinition",
        "ItemUsage",
        "PartDefinition",
        "PartUsage",
        "PortDefinition",
        "PortUsage",
        "ConjugatedPortTyping",
        "ConnectorEndMember",
        "ConnectorEnd",
        "ConnectionDefinition",
        "ConnectionUsage",
        "_ConnectorPart",
        "_BinaryConnectorPart",
        "_NaryConnectorPart",
        "BindingConnectorAsUsage",
        "SuccessionAsUsage",
        "InterfaceDefinition",
        "InterfaceUsage",
        "AllocationDefinition",
        "AllocationUsage",
        "FlowDefinition",
        "FlowUsage",
        "SuccessionFlowUsage",
        "PayloadFeatureMember",
        "PayloadFeature",
        "FlowEndMember",
        "FlowEnd",
        "FlowFeatureMember",
        "FlowFeature",
        "ActionDefinition",
        "_ActionBody",
        "_ActionBodyItem",
        "EmptySuccessionMember",
        "MultiplicitySourceEnd",
        "ActionNodeMember",
        "_ActionNode",
        "IfNode",
        "ActionBodyParameter",
        "WhileLoopNode",
        "ForLoopNode",
        "ForVariableDeclaration",
        "ControlNode",
        "MergeNode",
        "DecisionNode",
        "JoinNode",
        "ForkNode",
        "ActionUsage",
        "AcceptActionNode",
        "SendActionNode",
        "AssignActionNode",
        "PerformActionUsage",
        "CalculationDefinition",
        "_CalculationBody",
        "_ParameterList",
        "ParameterMember",
        "ReturnParameterMember",
        "ResultExpressionMember",
        "CalculationUsage",
        "ConstraintDefinition",
        "ConstraintUsage",
        "AssertConstraintUsage",
        "RequirementDefinition",
        "_RequirementBody",
        "_RequirementBodyItem",
        "SubjectMember",
        "SubjectUsage",
        "RequirementConstraintMember",
        "RequirementConstraintUsage",
        "ActorMember",
        "ActorUsage",
        "StakeholderMember",
        "StakeholderUsage",
        "RequirementUsage",
        "SatisfyRequirementUsage",
        "ConcernDefinition",
        "ConcernUsage",
        "CaseDefinition",
        "_CaseBody",
        "CaseUsage",
        "AnalysisCaseDefinition",
        "AnalysisCaseUsage",
        "VerificationCaseDefinition",
        "VerificationCaseUsage",
        "_VerificationBody",
        "_VerificationBodyItem",
        "VerifyRequirementUsageMember",
        "VerifyRequirementUsage",
        "ObjectiveMember",
        "ObjectiveRequirementUsage",
        "UseCaseDefinition",
        "UseCaseUsage",
        "IncludeUseCaseUsage",
        "StateDefinition",
        "_StateBodyItem",
        "EntryActionMember",
        "DoActionMember",
        "ExitActionMember",
        "StateActionUsage",
        "StateUsage",
        "ExhibitStateUsage",
        "TransitionUsageMember",
        "TransitionUsage",
        "ViewDefinition",
        "ViewUsage",
        "ViewpointDefinition",
        "ViewpointUsage",
        "RenderingDefinition",
        "RenderingUsage",
        "OwnedExpressionMember",
        "OwnedExpression",
        "_Expression",
        "OwnedExpressionReference",
        "ConditionalExpression",
        "NullCoalescingExpression",
        "ImpliesExpressionReference",
        "ImpliesExpressionMember",
        "ImpliesExpression",
        "OrExpressionReference",
        "OrExpressionMember",
        "OrExpression",
        "XorExpressionReference",
        "XorExpressionMember",
        "XorExpression",
        "AndExpression",
        "EqualityExpressionReference",
        "EqualityExpressionMember",
        "EqualityExpression",
        "EqualityOperator",
        "ClassificationExpression",
        "ClassificationTestOperator",
        "MetadataReference",
        "TypeReferenceMember",
        "TypeResultMember",
        "TypeReference",
        "ReferenceTyping",
        "RelationalExpression",
        "RelationalOperator",
        "RangeExpression",
        "AdditiveExpression",
        "AdditiveOperator",
        "MultiplicativeExpression",
        "MultiplicativeOperator",
        "ExponentiationExpression",
        "ExponentiationOperator",
        "UnaryExpression",
        "UnaryOperator",
        "ExtentExpression",
        "_postfix_operation",
        "PrimaryExpression",
        "FunctionReferenceExpression",
        "FunctionReferenceMember",
        "FunctionReference",
        "FeatureChainMember",
        "OwnedFeatureChain",
        "_BaseExpression",
        "BodyExpression",
        "ExpressionBodyMember",
        "ExpressionBody",
        "SequenceExpression",
        "FeatureReferenceExpression",
        "FeatureReferenceMember",
        "MetadataAccessExpression",
        "ElementReferenceMember",
        "InvocationExpression",
        "ConstructorExpression",
        "ConstructorResultMember",
        "ConstructorResult",
        "InstantiatedTypeMember",
        "_FeatureChain",
        "OwnedFeatureChaining",
        "_ArgumentList",
        "_PositionalArgumentList",
        "ArgumentMember",
        "Argument",
        "_NamedArgumentList",
        "NamedArgumentMember",
        "NamedArgument",
        "ParameterRedefinition",
        "ArgumentValue",
        "NullExpression",
        "_LiteralExpression",
        "LiteralBoolean",
        "BooleanValue",
        "LiteralString",
        "LiteralInteger",
        "LiteralReal",
        "RealValue",
        "Name",
        "GlobalQualification",
        "Qualification",
        "QualifiedName",
        "_START",
        "__PackageBodyElement*",
        "_(PackageMember | ElementFilterMember | AliasMember | Import | AnnotatingMember)",
        "_(Name | ())",
        '_(("<" Name ">" (Name | ())) | Name)',
        '_(";" | ("{" OwnedAnnotation* "}"))',
        "_OwnedAnnotation*",
        '_("public" | "private" | "protected")',
        "_PrefixMetadataAnnotation*",
        "_(_Identification | ())",
        '_(((_Identification | ()) "from") | ())',
        '_("," QualifiedName)*',
        "_(Comment | Documentation | TextualRepresentation | MetadataUsage)",
        '_("," Annotation)*',
        '_(("about" Annotation ("," Annotation)*) | ())',
        '_(("comment" (_Identification | ()) (("about" Annotation ("," Annotation)*) | ())) | ())',
        '_(("locale" STRING_VALUE) | ())',
        '_(("rep" (_Identification | ())) | ())',
        "__usage_modifier*",
        '_("metadata" | "@")',
        '_(":" | ("defined" "by"))',
        '_(((":" | ("defined" "by"))) | ())',
        '_(((_Identification | ()) (((":" | ("defined" "by"))) | ())) | ())',
        '_(";" | ("{" (DefinitionMember | MetadataBodyUsageMember | AliasMember | Import)* "}"))',
        "_(DefinitionMember | MetadataBodyUsageMember | AliasMember | Import)",
        "_(DefinitionMember | MetadataBodyUsageMember | AliasMember | Import)*",
        '_("ref" | ())',
        '_(":>>" | "redefines")',
        '_((":>>" | "redefines") | ())',
        "_(_FeatureSpecializationPart | ())",
        "_(_ValuePart | ())",
        '_("standard" | ())',
        '_(";" | ("{" _PackageBodyElement* "}"))',
        "_(VisibilityIndicator | ())",
        "_(_DefinitionElement | _UsageElement)",
        '_(("<" Name ">") | ())',
        '_("all" | ())',
        "_(MembershipImport | NamespaceImport)",
        '_(("::" "**") | ())',
        "_(_ImportedNamespace | FilterPackage)",
        "_FilterPackageMember*",
        "_(FilterPackageMembershipImport | FilterPackageNamespaceImport)",
        "_(Package | LibraryPackage | _AnnotatingElement | Dependency | AttributeDefinition | EnumerationDefinition | OccurrenceDefinition | ItemDefinition | MetadataDefinition | PartDefinition | ConnectionDefinition | FlowDefinition | InterfaceDefinition | AllocationDefinition | PortDefinition | ActionDefinition | CalculationDefinition | StateDefinition | ConstraintDefinition | RequirementDefinition | ConcernDefinition | CaseDefinition | AnalysisCaseDefinition | VerificationCaseDefinition | UseCaseDefinition | ViewDefinition | ViewpointDefinition | RenderingDefinition)",
        "_(_NonOccurrenceUsageElement | _OccurrenceUsageElement)",
        "_(DefaultReferenceUsage | ReferenceUsage | AttributeUsage | EnumerationUsage | BindingConnectorAsUsage | SuccessionAsUsage)",
        "_(_StructureUsageElement | _BehaviorUsageElement)",
        "_(OccurrenceUsage | ItemUsage | PartUsage | PortUsage | ConnectionUsage | InterfaceUsage | AllocationUsage | FlowUsage | SuccessionFlowUsage | ViewUsage | RenderingUsage)",
        "_(ActionUsage | CalculationUsage | StateUsage | ConstraintUsage | RequirementUsage | ConcernUsage | CaseUsage | AnalysisCaseUsage | VerificationCaseUsage | UseCaseUsage | ViewpointUsage | PerformActionUsage | ExhibitStateUsage | IncludeUseCaseUsage | AssertConstraintUsage | SatisfyRequirementUsage)",
        '_(":>" | "specializes")',
        '_("," OwnedSubclassification)*',
        "_((_Identification (_FeatureSpecializationPart | ())) | _FeatureSpecializationPart)",
        "_(_FeatureSpecialization | _MultiplicityPart)",
        "_(_FeatureSpecialization | _MultiplicityPart)*",
        '_(OwnedMultiplicity | ((OwnedMultiplicity | ()) (("ordered" ("nonunique" | ())) | ("nonunique" ("ordered" | ())))))',
        "_(OwnedMultiplicity | ())",
        '_("nonunique" | ())',
        '_(("ordered" ("nonunique" | ())) | ("nonunique" ("ordered" | ())))',
        '_("ordered" | ())',
        "_(_Typings | _Subsettings | _References | _Crosses | _Redefinitions)",
        '_("," FeatureTyping)*',
        '_(":>" | "subsets" | "subset")',
        '_("," OwnedSubsetting)*',
        '_("::>" | "references" | "reference")',
        '_("=>" | "crosses")',
        '_(":>>" | "redefines" | "redefine")',
        '_("," OwnedRedefinition)*',
        "_(OwnedFeatureTyping | ConjugatedPortTyping)",
        "_(QualifiedName | OwnedFeatureChain)",
        '_((".." MultiplicityExpressionMember) | ())',
        "_(_LiteralExpression | FeatureReferenceExpression)",
        "_(_SubclassificationPart | ())",
        '_(";" | ("{" _DefinitionBodyItem* "}"))',
        "__DefinitionBodyItem*",
        "_(DefinitionMember | VariantUsageMember | NonOccurrenceUsageMember | ((EmptySuccessionMember | ()) OccurrenceUsageMember) | AliasMember | Import | AnnotatingMember)",
        "_(EmptySuccessionMember | ())",
        '_("end" | "in" | "out" | "inout" | "derived" | "abstract" | "variation" | "constant" | "ref" | "redefine" | "redefines" | "subset" | "subsets" | "individual" | "snapshot" | "timeslice" | PrefixMetadataMember)',
        "_(_UsageDeclaration | ())",
        '_("=" | ":=" | ("default" (("=" | ":=") | ())))',
        '_("=" | ":=")',
        '_(("=" | ":=") | ())',
        '_(";" | ("{" (AnnotatingMember | EnumerationUsageMember)* "}"))',
        "_(AnnotatingMember | EnumerationUsageMember)",
        "_(AnnotatingMember | EnumerationUsageMember)*",
        '_("enum" | ())',
        '_("::>" | "references")',
        '_((Name ("::>" | "references")) | ())',
        '_(("connect" _ConnectorPart) | ())',
        '_(("connection" (_UsageDeclaration | ()) (_ValuePart | ()) (("connect" _ConnectorPart) | ())) | ("connect" _ConnectorPart))',
        "_(_BinaryConnectorPart | _NaryConnectorPart)",
        '_("," ConnectorEndMember)*',
        '_(("binding" (_UsageDeclaration | ())) | ())',
        '_(("succession" (_UsageDeclaration | ())) | ())',
        '_(("if" OwnedExpression) | ())',
        '_(("allocate" _ConnectorPart) | ())',
        '_(("allocation" (_UsageDeclaration | ()) (("allocate" _ConnectorPart) | ())) | ("allocate" _ConnectorPart))',
        '_((FlowEndMember "to" FlowEndMember) | ((_UsageDeclaration | ()) (_ValuePart | ()) (("of" PayloadFeatureMember) | ()) (("from" FlowEndMember "to" FlowEndMember) | ())))',
        '_(("of" PayloadFeatureMember) | ())',
        '_(("from" FlowEndMember "to" FlowEndMember) | ())',
        "_(((_Identification | ()) _FeatureSpecializationPart (_ValuePart | ())) | ((_Identification | ()) _ValuePart) | (OwnedFeatureTyping (OwnedMultiplicity | ())) | (OwnedMultiplicity OwnedFeatureTyping))",
        '_((OwnedReferenceSubsetting ".") | ())',
        "_(_ParameterList | ())",
        '_(";" | ("{" _ActionBodyItem* "}"))',
        "__ActionBodyItem*",
        "_(Import | AliasMember | DefinitionMember | VariantUsageMember | NonOccurrenceUsageMember | ((EmptySuccessionMember | ()) _OccurrenceUsageElement) | ActionNodeMember | ReturnParameterMember)",
        "_(IfNode | WhileLoopNode | ForLoopNode | ControlNode | AcceptActionNode | SendActionNode | AssignActionNode)",
        '_(("action" (_UsageDeclaration | ())) | ())',
        "_(ActionBodyParameter | IfNode)",
        '_(("else" (ActionBodyParameter | IfNode)) | ())',
        '_(("while" OwnedExpression) | "loop")',
        '_(("until" OwnedExpression ";") | ())',
        "_(MergeNode | DecisionNode | JoinNode | ForkNode)",
        '_(("via" OwnedReferenceSubsetting) | ())',
        '_(("to" OwnedExpression) | ())',
        '_((OwnedReferenceSubsetting (_FeatureSpecializationPart | ())) | ("action" (_UsageDeclaration | ())))',
        '_(";" | ("{" (_ActionBodyItem | ReturnParameterMember)* (ResultExpressionMember | ()) "}"))',
        "_(_ActionBodyItem | ReturnParameterMember)",
        "_(_ActionBodyItem | ReturnParameterMember)*",
        "_(ResultExpressionMember | ())",
        '_("," ParameterMember)*',
        '_((ParameterMember ("," ParameterMember)*) | ())',
        '_("not" | ())',
        '_((OwnedReferenceSubsetting (_FeatureSpecializationPart | ())) | ("constraint" (_UsageDeclaration | ()) (_ValuePart | ())))',
        '_(";" | ("{" _RequirementBodyItem* "}"))',
        "__RequirementBodyItem*",
        "_(_DefinitionBodyItem | SubjectMember | RequirementConstraintMember | ActorMember | StakeholderMember)",
        '_("assume" | "require")',
        "__FeatureSpecialization*",
        '_((OwnedReferenceSubsetting _FeatureSpecialization* _CalculationBody) | (_usage_modifier* ("constraint" | ()) (_UsageDeclaration | ()) (_ValuePart | ()) _CalculationBody))',
        '_("constraint" | ())',
        '_("assert" | ())',
        '_((OwnedReferenceSubsetting (_FeatureSpecializationPart | ())) | ("requirement" (_UsageDeclaration | ())))',
        '_(("by" OwnedReferenceSubsetting) | ())',
        '_(";" | ("{" (_ActionBodyItem | SubjectMember | ActorMember | StakeholderMember | ObjectiveMember)* (ResultExpressionMember | ()) "}"))',
        "_(_ActionBodyItem | SubjectMember | ActorMember | StakeholderMember | ObjectiveMember)",
        "_(_ActionBodyItem | SubjectMember | ActorMember | StakeholderMember | ObjectiveMember)*",
        '_(";" | ("{" _VerificationBodyItem* (ResultExpressionMember | ()) "}"))',
        "__VerificationBodyItem*",
        "_(_ActionBodyItem | VerifyRequirementUsageMember | ObjectiveMember)",
        '_((OwnedReferenceSubsetting (_FeatureSpecializationPart | ())) | ("use" "case" (_UsageDeclaration | ())))',
        '_(";" | (("parallel" | ()) "{" _StateBodyItem* "}"))',
        '_("parallel" | ())',
        "__StateBodyItem*",
        "_(Import | AliasMember | DefinitionMember | VariantUsageMember | NonOccurrenceUsageMember | ((EmptySuccessionMember | ()) _OccurrenceUsageElement) | TransitionUsageMember | EntryActionMember | DoActionMember | ExitActionMember)",
        '_(";" | ((_UsageDeclaration | ()) (_ValuePart | ()) _ActionBody))',
        '_((OwnedReferenceSubsetting (_FeatureSpecializationPart | ())) | ("state" (_UsageDeclaration | ())))',
        '_(((_UsageDeclaration | ()) "first") | ())',
        '_(("accept" PayloadFeatureMember) | ())',
        '_(("do" StateActionUsage) | ())',
        '_(";" | ("{" (_DefinitionBodyItem | ElementFilterMember)* "}"))',
        "_(_DefinitionBodyItem | ElementFilterMember)",
        "_(_DefinitionBodyItem | ElementFilterMember)*",
        "_(ConditionalExpression | NullCoalescingExpression | ImpliesExpression | OrExpression | XorExpression | AndExpression | EqualityExpression | ClassificationExpression | RelationalExpression | RangeExpression | AdditiveExpression | MultiplicativeExpression | ExponentiationExpression | UnaryExpression | ExtentExpression | PrimaryExpression | _BaseExpression)",
        '_("if" _Expression "?" OwnedExpressionReference "else" OwnedExpressionReference)',
        '_("??" ImpliesExpressionReference)*',
        '_(_Expression (("??" ImpliesExpressionReference) ("??" ImpliesExpressionReference)*))',
        '_("implies" ImpliesExpressionReference)*',
        '_(_Expression (("implies" ImpliesExpressionReference) ("implies" ImpliesExpressionReference)*))',
        '_(("|" _Expression) | ("or" XorExpressionReference))',
        '_(("|" _Expression) | ("or" XorExpressionReference))*',
        '_(_Expression ((("|" _Expression) | ("or" XorExpressionReference)) (("|" _Expression) | ("or" XorExpressionReference))*))',
        '_("xor" _Expression)*',
        '_(_Expression (("xor" _Expression) ("xor" _Expression)*))',
        '_(("&" _Expression) | ("and" EqualityExpressionReference))',
        '_(("&" _Expression) | ("and" EqualityExpressionReference))*',
        '_(_Expression ((("&" _Expression) | ("and" EqualityExpressionReference)) (("&" _Expression) | ("and" EqualityExpressionReference))*))',
        "_(EqualityOperator _Expression)*",
        "_(_Expression ((EqualityOperator _Expression) (EqualityOperator _Expression)*))",
        '_("==" | "!=" | "===" | "!==")',
        "_((ClassificationTestOperator TypeReferenceMember) | (CastOperator TypeResultMember))",
        "_((_Expression ((ClassificationTestOperator TypeReferenceMember) | (CastOperator TypeResultMember))) | (ClassificationTestOperator TypeReferenceMember) | (MetadataReference MetaClassificationTestOperator TypeReferenceMember) | (CastOperator TypeResultMember) | (MetadataReference MetaCastOperator TypeResultMember))",
        '_("hastype" | "istype" | "@")',
        "MetaClassificationTestOperator",
        "CastOperator",
        "MetaCastOperator",
        "_(RelationalOperator _Expression)*",
        "_(_Expression ((RelationalOperator _Expression) (RelationalOperator _Expression)*))",
        '_("<" | ">" | "<=" | ">=")',
        '_(_Expression ".." _Expression)',
        "_(AdditiveOperator _Expression)*",
        "_(_Expression ((AdditiveOperator _Expression) (AdditiveOperator _Expression)*))",
        '_("+" | "-")',
        "_(MultiplicativeOperator _Expression)*",
        "_(_Expression ((MultiplicativeOperator _Expression) (MultiplicativeOperator _Expression)*))",
        '_("*" | "/" | "%")',
        "_(_Expression ExponentiationOperator _Expression)",
        '_("**" | "^")',
        "_(UnaryOperator _Expression)",
        '_("+" | "-" | "~" | "not")',
        '_("all" TypeResultMember)',
        '_(("#" "(" SequenceExpression ")") | ("[" SequenceExpression "]") | ("->" InstantiatedTypeMember (BodyExpression | FunctionReferenceExpression | _ArgumentList)) | ("." BodyExpression) | (".?" BodyExpression))',
        "_(BodyExpression | FunctionReferenceExpression | _ArgumentList)",
        '_(("." FeatureChainMember) | ())',
        "__postfix_operation*",
        '_((_BaseExpression ("." FeatureChainMember) _postfix_operation*) | (_BaseExpression (_postfix_operation _postfix_operation*)))',
        '_(NullExpression | _LiteralExpression | FeatureReferenceExpression | MetadataAccessExpression | InvocationExpression | ConstructorExpression | BodyExpression | ("(" SequenceExpression ")"))',
        '_("," | ("," SequenceExpression))',
        '_(("," | ("," SequenceExpression)) | ())',
        '_("." OwnedFeatureChaining)*',
        "_(_PositionalArgumentList | _NamedArgumentList)",
        "_((_PositionalArgumentList | _NamedArgumentList) | ())",
        '_("," ArgumentMember)*',
        '_("," NamedArgumentMember)*',
        '_("null" | ("(" ")"))',
        "_(LiteralBoolean | LiteralString | LiteralInteger | LiteralReal | LiteralInfinity)",
        '_("true" | "false")',
        "_(DECIMAL_VALUE | ())",
        "_(DECIMAL_VALUE | EXP_VALUE)",
        '_(((DECIMAL_VALUE | ()) "." (DECIMAL_VALUE | EXP_VALUE)) | EXP_VALUE)',
        "LiteralInfinity",
        "_(ID | UNRESTRICTED_NAME)",
        '_(Name "::")*',
        "_(GlobalQualification | ())",
        "_(Qualification | ())",
        "DECIMAL_VALUE",
        "EXP_VALUE",
        "ID",
        "UNRESTRICTED_NAME",
        "STRING_VALUE",
        "REGULAR_COMMENT",
        "ML_NOTE",
        "SL_NOTE",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "UNKNOWN",
        "EOF",
      ]
    : [];
export const LINT_MESSAGES = typeof {} !== "undefined" ? {} : {};
export const LINT_SEVERITIES = typeof {} !== "undefined" ? {} : {};
export const LINT_CODES = typeof {} !== "undefined" ? {} : {};
export const EXTRAS_PATTERN = "\\s";
export const FIELD_NAMES =
  typeof {
    declaredShortName: 1,
    declaredName: 2,
    client: 3,
    supplier: 4,
    annotatedElement: 5,
    ownedRelatedElement: 6,
    locale: 7,
    body: 8,
    language: 9,
    ownedRelationship: 10,
    type: 11,
    isStandard: 12,
    memberShortName: 13,
    memberElement: 14,
    isImportAll: 15,
    importedMembership: 16,
    isRecursive: 17,
    importedNamespace: 18,
    superclassifier: 19,
    isOrdered: 20,
    isNonunique: 21,
    lowerBound: 22,
    upperBound: 23,
    isEnd: 24,
    direction: 25,
    isDerived: 26,
    isAbstract: 27,
    isVariation: 28,
    isConstant: 29,
    isRef: 30,
    isRedefine: 31,
    isSubsetting: 32,
    isInitial: 33,
    isDefault: 34,
    conjugatedPortDefinition: 35,
    guard: 36,
    condition: 37,
    thenBody: 38,
    elseBody: 39,
    untilCondition: 40,
    variable: 41,
    range: 42,
    sentItem: 43,
    receiver: 44,
    assignedValue: 45,
    targetFeature: 46,
    isNegated: 47,
    constraintKind: 48,
    satisfyingFeature: 49,
    isParallel: 50,
    source: 51,
    trigger: 52,
    effect: 53,
    operator: 54,
    operand: 55,
    thenOperand: 56,
    elseOperand: 57,
    typeReference: 58,
    typeResult: 59,
    indexOperand: 60,
    filterOperand: 61,
    invocationType: 62,
    functionRef: 63,
    collect: 64,
    select: 65,
    featureChain: 66,
    base: 67,
    result: 68,
    chaining: 69,
    chainingFeature: 70,
    argument: 71,
    namedArgument: 72,
    parameterRedefinition: 73,
    value: 74,
    redefinedFeature: 75,
    name: 76,
  } !== "undefined"
    ? {
        declaredShortName: 1,
        declaredName: 2,
        client: 3,
        supplier: 4,
        annotatedElement: 5,
        ownedRelatedElement: 6,
        locale: 7,
        body: 8,
        language: 9,
        ownedRelationship: 10,
        type: 11,
        isStandard: 12,
        memberShortName: 13,
        memberElement: 14,
        isImportAll: 15,
        importedMembership: 16,
        isRecursive: 17,
        importedNamespace: 18,
        superclassifier: 19,
        isOrdered: 20,
        isNonunique: 21,
        lowerBound: 22,
        upperBound: 23,
        isEnd: 24,
        direction: 25,
        isDerived: 26,
        isAbstract: 27,
        isVariation: 28,
        isConstant: 29,
        isRef: 30,
        isRedefine: 31,
        isSubsetting: 32,
        isInitial: 33,
        isDefault: 34,
        conjugatedPortDefinition: 35,
        guard: 36,
        condition: 37,
        thenBody: 38,
        elseBody: 39,
        untilCondition: 40,
        variable: 41,
        range: 42,
        sentItem: 43,
        receiver: 44,
        assignedValue: 45,
        targetFeature: 46,
        isNegated: 47,
        constraintKind: 48,
        satisfyingFeature: 49,
        isParallel: 50,
        source: 51,
        trigger: 52,
        effect: 53,
        operator: 54,
        operand: 55,
        thenOperand: 56,
        elseOperand: 57,
        typeReference: 58,
        typeResult: 59,
        indexOperand: 60,
        filterOperand: 61,
        invocationType: 62,
        functionRef: 63,
        collect: 64,
        select: 65,
        featureChain: 66,
        base: 67,
        result: 68,
        chaining: 69,
        chainingFeature: 70,
        argument: 71,
        namedArgument: 72,
        parameterRedefinition: 73,
        value: 74,
        redefinedFeature: 75,
        name: 76,
      }
    : {};
export function createWasmImports(grammar, facade) {
  const hostQueries = grammar.hostQueries || {};
  const queryKeys = Object.keys(hostQueries);
  return {
    host: {
      runHostQuery: (queryId, arg1, arg2, arg3) => {
        if (queryId > 0 && queryId <= queryKeys.length) {
          const queryName = queryKeys[queryId - 1];
          return hostQueries[queryName](facade, arg1, arg2, arg3);
        }
        return 0;
      },
    },
  };
}
/**
 * The Language Server Protocol Facade.
 *
 * Provides a high-level API over the WebAssembly runtime for IDE integration,
 * managing memory buffer synchronization, incremental parsing, and diagnostic translation.
 */
export class LspFacade {
  syntaxNames = SYNTAX_NAMES;
  extrasRegex = new RegExp(EXTRAS_PATTERN !== "\\s" ? EXTRAS_PATTERN : "\\s", "u");
  wasmMemory;
  exports;
  lastAstRoot = 0;
  _cachedLineStarts = null;
  documentRoots = new Map();
  documentVersions = new Map();
  _idleTimer = null;
  _maxMemoryQuotaBytes = 32 * 1024 * 1024; // 32MB threshold
  /**
   * Returns true if a character matches the grammar's `extras` definition (whitespace/trivia).
   * Line breaks (\n, \r) are excluded so diagnostic ranges stay pinned to their line.
   */
  isExtraChar(ch) {
    if (ch === "\n" || ch === "\r") return false;
    return this.extrasRegex.test(ch);
  }
  /**
   * Retrieves an interned string path from the WASM linear memory string pool.
   */
  getStringFromPool(id) {
    if (!this.exports || id === 0) return "";
    if (this.exports.graph_getStringLength && this.exports.graph_copyString) {
      const len = this.exports.graph_getStringLength(id);
      if (len === 0) return "";
      const bufPtr = this.exports.lsp_getBinaryBuffer ? this.exports.lsp_getBinaryBuffer() : 0;
      if (bufPtr === 0) return "";
      this.exports.graph_copyString(id, bufPtr);
      const u8 = new Uint8Array(len);
      u8.set(new Uint8Array(this.wasmMemory.buffer, bufPtr, len));
      if (typeof TextDecoder !== "undefined") {
        return new TextDecoder("utf-8").decode(u8);
      }
      let str = "";
      for (let i = 0; i < len; i++) str += String.fromCharCode(u8[i]);
      return str;
    }
    return "";
  }
  _childTailCache = new Map();
  currentInputLength = 0;
  constructor(wasmMemoryOrInstance, exports) {
    if (wasmMemoryOrInstance && wasmMemoryOrInstance.exports) {
      this.wasmMemory = wasmMemoryOrInstance.exports.memory || wasmMemoryOrInstance.memory;
      this.exports = wasmMemoryOrInstance.exports;
    } else if (exports) {
      this.wasmMemory = wasmMemoryOrInstance;
      this.exports = exports;
    } else if (
      wasmMemoryOrInstance &&
      (wasmMemoryOrInstance.memory || wasmMemoryOrInstance.parse || wasmMemoryOrInstance.getInputBuffer)
    ) {
      this.wasmMemory = wasmMemoryOrInstance.memory;
      this.exports = wasmMemoryOrInstance;
    } else {
      this.wasmMemory = wasmMemoryOrInstance;
      this.exports = exports;
    }
    if (this.exports && this.exports.memory) {
      this.wasmMemory = this.exports.memory;
    }
    if (this.exports && this.exports.initCompiler) {
      this.exports.initCompiler();
    }
  }
  /**
   * Retrieves the AST root for a specific document URI or numeric fileId (or the default/active document).
   */
  getDocumentRoot(uriOrFileId) {
    if (typeof uriOrFileId === "number") {
      if (this.exports.lsp_getDocumentRoot) {
        return this.exports.lsp_getDocumentRoot(uriOrFileId);
      }
      return this.lastAstRoot;
    }
    if (typeof uriOrFileId === "string" && this.documentRoots.has(uriOrFileId)) {
      return this.documentRoots.get(uriOrFileId);
    }
    return this.lastAstRoot;
  }
  /**
   * Registers/updates the AST root for a specific document URI.
   */
  setDocumentRoot(uri, rootPtr, version = 0) {
    const oldRoot = this.documentRoots.get(uri);
    if (oldRoot && oldRoot !== rootPtr && this.exports.dropRoot) {
      this.exports.dropRoot(oldRoot);
    }
    this.documentRoots.set(uri, rootPtr);
    this.documentVersions.set(uri, version);
    if (rootPtr && this.exports.registerRoot) {
      this.exports.registerRoot(rootPtr);
    }
    this.lastAstRoot = rootPtr;
  }
  /**
   * Closes a document, unregistering its root from GC and triggering compaction.
   */
  removeDocument(uri) {
    const root = this.documentRoots.get(uri);
    if (root && this.exports.dropRoot) {
      this.exports.dropRoot(root);
    }
    this.documentRoots.delete(uri);
    this.documentVersions.delete(uri);
    if (this.lastAstRoot === root) {
      this.lastAstRoot = 0;
    }
    // Trigger 3: Document lifecycle event (cleanup on close)
    this.scheduleCompaction(true);
  }
  /**
   * Returns all active document roots across open files in the workspace.
   */
  getAllDocumentRoots() {
    const roots = Array.from(this.documentRoots.values()).filter((r) => r > 0);
    if (roots.length === 0 && this.lastAstRoot > 0) roots.push(this.lastAstRoot);
    return roots;
  }
  /**
   * Schedules a generational sweep/compaction pass.
   * Trigger 1: Quiescence / Idle Timer (1500ms debounce).
   */
  scheduleCompaction(immediate = false) {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }
  /**
   * Trigger 2: Checks if allocated memory exceeds high-water mark quota.
   */
  checkMemoryQuota() {
    // In immutable append-only arena, memory is reset on generation boundaries (didOpen/didClose/config)
  }
  /**
   * Performs compaction protecting all live document roots if requested.
   */
  gcCompact() {
    // No-op during active editing sessions to preserve append-only immutability
  }
  /** Resets the internal parser state and clears all cached data. */
  resetParser() {
    if (this.exports.resetParser) {
      this.exports.resetParser();
    }
    this.lastAstRoot = 0;
    this.documentRoots.clear();
    this.documentVersions.clear();
    this._cachedLineStarts = null;
    this._childTailCache.clear();
  }
  getInputEncoding() {
    return this._inputEncoding !== undefined
      ? this._inputEncoding
      : this.exports.lsp_getInputEncoding
        ? this.exports.lsp_getInputEncoding()
        : 1;
  }
  setParserConfig(enableBranchA1, enableBranchB, enableBranchC, enableIslandMode = false, enableMultiFile = true) {
    if (this.exports.configEnableBranchA1) {
      this.exports.configEnableBranchA1.value = enableBranchA1 ? 1 : 0;
    }
    if (this.exports.configEnableBranchB) {
      this.exports.configEnableBranchB.value = enableBranchB ? 1 : 0;
    }
    if (this.exports.configEnableBranchC) {
      this.exports.configEnableBranchC.value = enableBranchC ? 1 : 0;
    }
    if (this.exports.configEnableIslandMode) {
      this.exports.configEnableIslandMode.value = enableIslandMode ? 1 : 0;
    }
    if (this.exports.configEnableMultiFile) {
      this.exports.configEnableMultiFile.value = enableMultiFile ? 1 : 0;
    }
  }
  /**
   * Applies a single incremental edit to the WASM memory buffer and triggers a reparse.
   *
   * @param changeText - The new text being inserted.
   * @param rangeOffset - The UTF-16 character offset where the edit begins.
   * @param rangeLength - The number of UTF-16 characters being replaced.
   * @param newTotalLength - The new total length of the document in UTF-16 characters.
   */
  parseIncremental(changeText, rangeOffset, rangeLength, newTotalLength, uri) {
    const getInputBuf = this.exports.getInputBuffer || this.exports.lsp_getInputBuffer;
    if (!this.exports.parse || !getInputBuf) return 0;
    // Invalidate cached line starts on every edit.
    // The full rescan in getLineStarts() is O(N) but runs lazily once per edit.
    this._cachedLineStarts = null;
    this._childTailCache.clear(); // Invalidate tail pointers on edit
    this.currentInputLength = newTotalLength;
    if (this.exports.abortSuspend) this.exports.abortSuspend();
    const lenBytes = newTotalLength * 2;
    const prevAstRoot = this.getDocumentRoot(uri);
    // Fast path for empty input (e.g., clearing the editor)
    if (newTotalLength <= 0) {
      if (this.exports.lsp_setInputEncoding) this.exports.lsp_setInputEncoding(1);
      if (this.exports.lsp_setInputLength) this.exports.lsp_setInputLength(0);
      const newAstRoot = this.exports.parse(0, 0, 0, 0);
      this.lastAstRoot = newAstRoot;
      if (uri) this.setDocumentRoot(uri, newAstRoot);
      if (this.astListeners && this.astListeners.length > 0) {
        for (const listener of this.astListeners) {
          this.walkAstDiff(prevAstRoot, newAstRoot, listener);
        }
      }
      this.scheduleCompaction(false);
      this._cachedLineStarts = new Uint32Array([0]);
      return newAstRoot;
    }
    const oldTotalLength = newTotalLength + rangeLength - changeText.length;
    const oldTextPtr = getInputBuf();
    // Snapshot old buffer contents BEFORE ensureInputBuffer which may grow memory
    // and detach existing typed array views
    let oldSnapshot = null;
    if (oldTotalLength > 0) {
      const oldView = new Uint16Array(this.wasmMemory.buffer, oldTextPtr, oldTotalLength);
      oldSnapshot = new Uint16Array(oldTotalLength);
      oldSnapshot.set(oldView);
    }
    const maxLen = Math.max(oldTotalLength, newTotalLength);
    const lenBytesAlloc = maxLen * 2;
    const textPtr = this.exports.ensureInputBuffer ? this.exports.ensureInputBuffer(lenBytesAlloc) : oldTextPtr;
    const memArray16 = new Uint16Array(this.wasmMemory.buffer, textPtr, maxLen);
    // If the buffer was reallocated, copy the snapshot into the new buffer
    if (oldTextPtr !== textPtr && oldSnapshot) {
      const safeCopyLen = Math.min(oldSnapshot.length, memArray16.length);
      memArray16.set(oldSnapshot.subarray(0, safeCopyLen));
    }
    if (changeText.length !== rangeLength) {
      const sourceIndex = rangeOffset + rangeLength;
      const targetIndex = rangeOffset + changeText.length;
      const count = newTotalLength - targetIndex;
      if (count > 0) {
        memArray16.copyWithin(targetIndex, sourceIndex, sourceIndex + count);
      }
    }
    for (let i = 0; i < changeText.length; i++) {
      memArray16[rangeOffset + i] = changeText.charCodeAt(i);
    }
    if (newTotalLength < maxLen) {
      memArray16.fill(0, newTotalLength, maxLen);
    }
    this._inputEncoding = 1;
    if (this.exports.lsp_setInputEncoding) this.exports.lsp_setInputEncoding(1);
    else if (this.exports.setInputEncoding) this.exports.setInputEncoding(1);
    if (this.exports.lsp_setInputLength) this.exports.lsp_setInputLength(lenBytes);
    else if (this.exports.setInputLength) this.exports.setInputLength(lenBytes);
    const preview = changeText.length > 30 ? changeText.substring(0, 30) + "..." : changeText;
    console.log(
      `[Bindings] parseIncremental START: changeText="${preview.replace(/\n/g, "\\n")}" (len ${changeText.length}), offset=${rangeOffset}, rangeLen=${rangeLength}, newTotalLen=${newTotalLength}, prevRoot=${prevAstRoot}`,
    );
    let editStart = rangeOffset * 2;
    let editOldEnd = (rangeOffset + rangeLength) * 2;
    let editNewEnd = (rangeOffset + changeText.length) * 2;
    let baseRoot = prevAstRoot;
    if (baseRoot === 0 || (editStart === 0 && editOldEnd === 0 && editNewEnd === 0)) {
      baseRoot = 0; // Force full reparse internally if offsets are zeroed or initial parse
      editStart = 0;
      editOldEnd = 0;
      editNewEnd = 0;
    }
    const _t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    let newAstRoot = this.exports.parse(baseRoot, editStart, editOldEnd, editNewEnd);
    const _t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log(
      `[Bindings] parseIncremental WASM parse finished in ${Math.round(_t1 - _t0)}ms -> newAstRoot=${newAstRoot}`,
    );
    if (this.astListeners && this.astListeners.length > 0) {
      for (const listener of this.astListeners) {
        this.walkAstDiff(prevAstRoot, newAstRoot, listener);
      }
    }
    const _t2 = typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log(
      `[Bindings] parseIncremental diff finished in ${Math.round(_t2 - _t1)}ms (total ${Math.round(_t2 - _t0)}ms)`,
    );
    const isCatastrophic = this.exports.lsp_isCatastrophicError ? this.exports.lsp_isCatastrophicError() : false;
    if (isCatastrophic) {
      this.lastAstRoot = 0;
      if (uri) this.setDocumentRoot(uri, 0);
    } else {
      this.lastAstRoot = newAstRoot;
      if (uri) this.setDocumentRoot(uri, newAstRoot);
    }
    // Trigger 2: Check memory quota after parse
    this.checkMemoryQuota();
    // Trigger 1: Schedule idle compaction
    this.scheduleCompaction(false);
    return newAstRoot;
  }
  _hasTopLevelErrors(astRoot) {
    if (astRoot === 0) return false;
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const rootW0 = mem32[astRoot >>> 2];
    const rootFlags = (rootW0 >>> 10) & 0x0fff;
    if ((rootFlags & (128 | 256)) !== 0) return true;
    let childPtr = mem32[(astRoot + 12) >>> 2];
    while (childPtr !== 0) {
      const cFlags = (mem32[childPtr >>> 2] >>> 10) & 0x0fff;
      if ((cFlags & (128 | 256)) !== 0) return true;
      childPtr = mem32[(childPtr + 16) >>> 2];
    }
    return false;
  }
  /**
   * Applies a batch of incremental edits to the WASM memory buffer, coalescing the bounding box
   * and triggering a single reparse to minimize overhead.
   */
  parseIncrementalBatch(edits, newTotalLength, uri) {
    const getInputBuf = this.exports.getInputBuffer || this.exports.lsp_getInputBuffer;
    if (!this.exports.parse || !getInputBuf) return 0;
    if (!edits || edits.length === 0) return this.getDocumentRoot(uri);
    this._cachedLineStarts = null;
    this._childTailCache.clear();
    // First, compute the bounding box of all edits in original coordinates
    let minOrigStart = Infinity;
    let maxOrigEnd = -Infinity;
    let netDelta = 0;
    for (const edit of edits) {
      const origStart = edit.rangeOffset;
      const origEnd = edit.rangeOffset + edit.rangeLength;
      if (origStart < minOrigStart) minOrigStart = origStart;
      if (origEnd > maxOrigEnd) maxOrigEnd = origEnd;
      netDelta += edit.text.length - edit.rangeLength;
    }
    if (minOrigStart === Infinity) minOrigStart = 0;
    const oldTotalLength = this.currentInputLength > 0 ? this.currentInputLength : newTotalLength - netDelta;
    const prevAstRoot = this.getDocumentRoot(uri);
    if (newTotalLength <= 0) {
      if (this.exports.lsp_setInputEncoding) this.exports.lsp_setInputEncoding(1);
      if (this.exports.lsp_setInputLength) this.exports.lsp_setInputLength(0);
      const newAstRoot = this.exports.parse(0, 0, 0, 0);
      this.lastAstRoot = newAstRoot;
      if (uri) this.setDocumentRoot(uri, newAstRoot);
      if (this.astListeners && this.astListeners.length > 0) {
        for (const listener of this.astListeners) {
          this.walkAstDiff(prevAstRoot, newAstRoot, listener);
        }
      }
      this.scheduleCompaction(false);
      this._cachedLineStarts = new Uint32Array([0]);
      this.currentInputLength = 0;
      return newAstRoot;
    }
    if (this.exports.abortSuspend) this.exports.abortSuspend();
    const lenBytes = newTotalLength * 2;
    const oldTextPtr = this.exports.getInputBuffer();
    let oldSnapshot = null;
    if (oldTotalLength > 0) {
      const oldView = new Uint16Array(this.wasmMemory.buffer, oldTextPtr, oldTotalLength);
      oldSnapshot = new Uint16Array(oldTotalLength);
      oldSnapshot.set(oldView);
    }
    const maxLen = Math.max(oldTotalLength, newTotalLength);
    const lenBytesAlloc = maxLen * 2;
    const textPtr = this.exports.ensureInputBuffer ? this.exports.ensureInputBuffer(lenBytesAlloc) : oldTextPtr;
    const memArray16 = new Uint16Array(this.wasmMemory.buffer, textPtr, maxLen);
    if (oldTextPtr !== textPtr && oldSnapshot) {
      const safeCopyLen = Math.min(oldSnapshot.length, memArray16.length);
      memArray16.set(oldSnapshot.subarray(0, safeCopyLen));
    }
    console.log(
      `[Bindings] parseIncrementalBatch START: ${edits.length} edits, netDelta=${netDelta}, oldLen=${oldTotalLength}, newLen=${newTotalLength}, prevRoot=${prevAstRoot}`,
    );
    // Sort edits in descending order so mutations at higher offsets do not shift lower offsets
    const sortedEdits = edits.slice().sort((a, b) => b.rangeOffset - a.rangeOffset);
    let currentLen = oldTotalLength;
    for (const edit of sortedEdits) {
      if (edit.text.length !== edit.rangeLength) {
        const sourceIndex = edit.rangeOffset + edit.rangeLength;
        const targetIndex = edit.rangeOffset + edit.text.length;
        const count = currentLen - sourceIndex;
        if (count > 0) {
          memArray16.copyWithin(targetIndex, sourceIndex, sourceIndex + count);
        }
      }
      for (let i = 0; i < edit.text.length; i++) {
        memArray16[edit.rangeOffset + i] = edit.text.charCodeAt(i);
      }
      currentLen = currentLen - edit.rangeLength + edit.text.length;
    }
    if (newTotalLength < maxLen) {
      memArray16.fill(0, newTotalLength, maxLen);
    }
    this._cachedLineStarts = null;
    this.currentInputLength = newTotalLength;
    if (this.exports.lsp_setInputEncoding) this.exports.lsp_setInputEncoding(1);
    else if (this.exports.setInputEncoding) this.exports.setInputEncoding(1);
    if (this.exports.lsp_setInputLength) this.exports.lsp_setInputLength(lenBytes);
    else if (this.exports.setInputLength) this.exports.setInputLength(lenBytes);
    const maxNewEnd = maxOrigEnd + netDelta;
    let editStartByte = minOrigStart * 2;
    let editOldEndByte = maxOrigEnd * 2;
    let editNewEndByte = maxNewEnd * 2;
    let baseRoot = prevAstRoot;
    if (baseRoot === 0 || (editStartByte === 0 && editOldEndByte === 0 && editNewEndByte === 0)) {
      baseRoot = 0;
      editStartByte = 0;
      editOldEndByte = 0;
      editNewEndByte = 0;
    }
    const _t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const newAstRoot = this.exports.parse(baseRoot, editStartByte, editOldEndByte, editNewEndByte);
    const _t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log(
      `[Bindings] parseIncrementalBatch WASM parse finished in ${Math.round(_t1 - _t0)}ms -> newAstRoot=${newAstRoot}`,
    );
    if (this.astListeners && this.astListeners.length > 0) {
      for (const listener of this.astListeners) {
        this.walkAstDiff(prevAstRoot, newAstRoot, listener);
      }
    }
    const _t2 = typeof performance !== "undefined" ? performance.now() : Date.now();
    console.log(
      `[Bindings] parseIncrementalBatch diff finished in ${Math.round(_t2 - _t1)}ms (total ${Math.round(_t2 - _t0)}ms)`,
    );
    const isCatastrophic = this.exports.lsp_isCatastrophicError ? this.exports.lsp_isCatastrophicError() : false;
    if (isCatastrophic) {
      this.lastAstRoot = 0;
      if (uri) this.setDocumentRoot(uri, 0);
    } else {
      this.lastAstRoot = newAstRoot;
      if (uri) this.setDocumentRoot(uri, newAstRoot);
    }
    this.checkMemoryQuota();
    this.scheduleCompaction(false);
    return newAstRoot;
  }
  /**
   * Incrementally patches the lineStarts array after an edit.
   * Instead of rescanning the entire buffer (O(N)), this:
   * 1. Keeps line starts before the edit unchanged
   * 2. Removes line starts within the deleted range
   * 3. Inserts new line starts for newlines in the inserted text
   * 4. Shifts line starts after the edit by the byte delta
   * Complexity: O(edit_size + affected_lines), typically O(1) for single-char edits.
   */
  _updateLineStarts(old, rangeOffset, rangeLength, changeText) {
    const editStartByte = rangeOffset * 2;
    const editOldEndByte = (rangeOffset + rangeLength) * 2;
    const editNewEndByte = (rangeOffset + changeText.length) * 2;
    const delta = editNewEndByte - editOldEndByte;
    // Find two split points in the old lineStarts array:
    // prefixEnd:  first index where old[i] > editStartByte (entries IN or AFTER the edit zone)
    // suffixStart: first index where old[i] > editOldEndByte (entries AFTER the deleted range)
    //
    // Entries [0, prefixEnd) are unchanged (before the edit).
    // Entries [prefixEnd, suffixStart) are removed (inside the deleted range).
    // Entries [suffixStart, old.length) are shifted by delta (after the edit).
    let prefixEnd = old.length;
    let suffixStart = old.length;
    for (let i = 0; i < old.length; i++) {
      if (old[i] > editStartByte && prefixEnd === old.length) {
        prefixEnd = i;
      }
      if (old[i] > editOldEndByte) {
        suffixStart = i;
        break;
      }
    }
    // If all entries are <= editStartByte, prefixEnd stays at old.length
    // and suffixStart stays at old.length (nothing to remove or shift).
    // Ensure prefixEnd <= suffixStart.
    if (prefixEnd > suffixStart) prefixEnd = suffixStart;
    // Count new newlines in changeText
    const newLineStarts = [];
    for (let i = 0; i < changeText.length; i++) {
      const c = changeText.charCodeAt(i);
      if (c === 13) {
        if (i + 1 < changeText.length && changeText.charCodeAt(i + 1) === 10) {
          newLineStarts.push((rangeOffset + i + 2) * 2);
          i++; // Skip LF
        } else {
          newLineStarts.push((rangeOffset + i + 1) * 2);
        }
      } else if (c === 10 || c === 0x2028 || c === 0x2029) {
        newLineStarts.push((rangeOffset + i + 1) * 2);
      }
    }
    // Build the new array:
    // [0..prefixEnd) unchanged + newLineStarts + [suffixStart..end) shifted by delta
    const beforeCount = prefixEnd;
    const afterCount = old.length - suffixStart;
    const result = new Uint32Array(beforeCount + newLineStarts.length + afterCount);
    // Copy unchanged prefix
    for (let i = 0; i < beforeCount; i++) {
      result[i] = old[i];
    }
    // Insert new line starts from the inserted text
    for (let i = 0; i < newLineStarts.length; i++) {
      result[beforeCount + i] = newLineStarts[i];
    }
    // Copy and shift suffix
    const writeStart = beforeCount + newLineStarts.length;
    for (let i = 0; i < afterCount; i++) {
      result[writeStart + i] = old[suffixStart + i] + delta;
    }
    return result;
  }
  /**
   * Scans the current WASM input buffer and calculates all line start byte offsets.
   * This is cached and only recalculated when the cache is invalidated by edits.
   * Note: The offsets are stored in UTF-16 bytes (i.e. charIndex * 2) to match
   * the WASM AST's byte offset ranges.
   */
  getLineStarts() {
    if (this._cachedLineStarts) return this._cachedLineStarts;
    const encoding = this.getInputEncoding();
    let lenBytes = this.currentInputLength;
    if (encoding === 1) lenBytes *= 2;
    else if (encoding === 2) lenBytes *= 4;
    if (this.currentInputLength === 0) {
      lenBytes = this.exports.inputLength?.value ?? this.exports.inputLength ?? 0;
    }
    const starts = [0];
    const getInputBuf = this.exports.getInputBuffer || this.exports.lsp_getInputBuffer;
    const inputBufPtr = getInputBuf ? getInputBuf() : 0;
    if (encoding === 0) {
      const lenChars = lenBytes;
      const textBuffer = new Uint8Array(this.wasmMemory.buffer, inputBufPtr, lenChars);
      for (let i = 0; i < lenChars; i++) {
        const c = textBuffer[i];
        if (c === 13) {
          if (i + 1 < lenChars && textBuffer[i + 1] === 10) {
            starts.push(i + 2);
            i++;
          } else {
            starts.push(i + 1);
          }
        } else if (c === 10) {
          starts.push(i + 1);
        }
      }
    } else {
      const lenChars = lenBytes / 2;
      const textBuffer = new Uint16Array(this.wasmMemory.buffer, inputBufPtr, lenChars);
      for (let i = 0; i < lenChars; i++) {
        const c = textBuffer[i];
        if (c === 13) {
          if (i + 1 < lenChars && textBuffer[i + 1] === 10) {
            starts.push((i + 2) * 2);
            i++;
          } else {
            starts.push((i + 1) * 2);
          }
        } else if (c === 10 || c === 0x2028 || c === 0x2029) {
          starts.push((i + 1) * 2);
        }
      }
    }
    const lineStarts = new Uint32Array(starts);
    this._cachedLineStarts = lineStarts;
    return lineStarts;
  }
  /**
   * Performs a binary search on the cached line starts to map a linear byte offset
   * to a line and character position (LSP format).
   */
  offsetToPos(offset, lineStarts) {
    let low = 0;
    let high = lineStarts.length - 1;
    let line = 0;
    while (low <= high) {
      let mid = (low + high) >> 1;
      if (lineStarts[mid] <= offset) {
        line = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const encoding = this.getInputEncoding();
    const charDiv = encoding === 1 ? 2 : 1;
    const charOffset = Math.floor((offset - lineStarts[line]) / charDiv);
    return { line, character: charOffset };
  }
  /**
   * Maps a line and character position to a linear byte offset.
   */
  posToOffset(line, character, lineStarts) {
    const encoding = this.getInputEncoding();
    const charMult = encoding === 1 ? 2 : 1;
    if (line < lineStarts.length) {
      return lineStarts[line] + character * charMult;
    }
    return lineStarts.length > 0 ? lineStarts[lineStarts.length - 1] + character * charMult : character * charMult;
  }
  /**
   * Retrieves syntax and semantic diagnostics from the WASM parser.
   *
   * This bridges the gap between the compact struct-of-arrays representation
   * returned by WASM and the object-oriented LSP `Diagnostic` array.
   * Complex diagnostics with contextual formatting strings (e.g. "Expected '}' but got {0}")
   * are resolved by extracting the underlying text from the source buffer.
   */
  getDiagnostics(astRoot) {
    this._lastDiagBinaryLength = 0;
    const lineStarts = this.getLineStarts();
    const numElements = this.exports.lsp_getDiagnostics(astRoot);
    const diags = [];
    if (numElements === 0 || !this.exports.lsp_getBinaryBuffer) return diags;
    let memory = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    // Pre-calculate all needed nodePtr offsets in a single O(N) pass
    // to prevent O(N^2) lockups caused by repeated WASM lsp_findNodeOffset calls.
    const requiredNodePtrs = new Set();
    for (let i = 0; i < numElements * 7; i += 7) {
      const arg0 = memory[(dirPtr >> 2) + i + 3];
      const arg1 = memory[(dirPtr >> 2) + i + 4];
      const arg2 = memory[(dirPtr >> 2) + i + 5];
      const arg3 = memory[(dirPtr >> 2) + i + 6];
      if (arg0) requiredNodePtrs.add(arg0);
      if (arg1) requiredNodePtrs.add(arg1);
      if (arg2) requiredNodePtrs.add(arg2);
      if (arg3) requiredNodePtrs.add(arg3);
    }
    const offsetCache = new Map();
    if (requiredNodePtrs.size > 0 && astRoot) {
      const encoding = this.getInputEncoding();
      const encStep = encoding === 1 ? 2 : 1;
      let stackPtrs = new Uint32Array(50000);
      let stackOffsets = new Uint32Array(50000);
      let stackTop = 0;
      const getNodePad = (ptr) => {
        if (this.exports.lsp_getNodeLeadingPad) {
          return this.exports.lsp_getNodeLeadingPad(ptr);
        }
        if (this.exports.getNodeLeadingPad) {
          return this.exports.getNodeLeadingPad(ptr);
        }
        const typeFlags = memory[ptr / 4];
        const envHashPadding = memory[(ptr + 4) / 4];
        const rawPad = typeFlags >>> 22;
        const isFat = ((envHashPadding >>> 23) & 1) === 1;
        return isFat && this.exports.getFatPaddingPtr ? memory[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
      };
      const getNodeLen = (ptr) => {
        return memory[(ptr + 4) / 4] & 0x007fffff;
      };
      stackPtrs[0] = astRoot;
      stackOffsets[0] = getNodePad(astRoot);
      stackTop = 1;
      let iterations = 0;
      while (stackTop > 0 && ++iterations < 100000) {
        stackTop--;
        const current = stackPtrs[stackTop];
        const nodeStart = stackOffsets[stackTop];
        if (requiredNodePtrs.has(current)) {
          offsetCache.set(current, nodeStart);
          requiredNodePtrs.delete(current);
          if (requiredNodePtrs.size === 0) break;
        }
        const child = memory[(current + 12) / 4];
        if (child !== 0) {
          let childCount = 0;
          let c = child;
          while (c !== 0 && childCount < 5000) {
            childCount++;
            c = memory[(c + 16) / 4];
          }
          if (stackTop + childCount < 50000) {
            let currOffset = nodeStart;
            let consumedInParent = 0;
            let idx = 0;
            c = child;
            while (c !== 0 && idx < childCount) {
              const cPad = getNodePad(c);
              const cLen = getNodeLen(c);
              if (idx > 0) {
                currOffset += cPad;
              }
              const childStart = currOffset;
              const slot = stackTop + (childCount - 1 - idx);
              stackPtrs[slot] = c;
              stackOffsets[slot] = childStart;
              currOffset = childStart + cLen;
              consumedInParent += cLen;
              idx++;
              c = memory[(c + 16) / 4];
            }
            stackTop += childCount;
          }
        }
      }
    }
    for (let i = 0; i < numElements * 7; i += 7) {
      let startByte = memory[(dirPtr >> 2) + i];
      let endByte = memory[(dirPtr >> 2) + i + 1];
      const lintId = memory[(dirPtr >> 2) + i + 2];
      const arg0 = memory[(dirPtr >> 2) + i + 3];
      const arg1 = memory[(dirPtr >> 2) + i + 4];
      const arg2 = memory[(dirPtr >> 2) + i + 5];
      const arg3 = memory[(dirPtr >> 2) + i + 6];
      if (arg0 > 0 && offsetCache.has(arg0)) {
        startByte = offsetCache.get(arg0);
        const nodeLen = memory[(arg0 + 4) / 4] & 0x007fffff;
        endByte = startByte + (nodeLen > 0 ? nodeLen : this.getInputEncoding() === 1 ? 2 : 1);
      }
      const rawLintId = lintId & 0x7fff;
      let msg = lintId > 0 && lintId < 0x8000 ? `Linter Rule ${lintId}` : "Syntax Error";
      let severity = lintId > 0 && lintId < 0x8000 ? 2 : 1; // 1 = Error (Syntax), 2 = Warning (Linter)
      let codeStr = lintId > 0 && lintId < 0x8000 ? lintId : undefined;
      if (rawLintId === 0) {
        if (arg0 === 1 && arg1 > 0) {
          let symName = (this.syntaxNames && this.syntaxNames[arg1]) || `token_${arg1}`;
          if (symName.startsWith("T_")) symName = symName.substring(2);
          if (symName.startsWith('"') && symName.endsWith('"')) {
            symName = symName.substring(1, symName.length - 1);
          }
          msg = `Syntax Error: Missing '${symName}'`;
        }
      }
      if (rawLintId > 0) {
        const key = LINT_MESSAGES[lintId.toString()]
          ? lintId.toString()
          : LINT_MESSAGES[rawLintId.toString()]
            ? rawLintId.toString()
            : null;
        if (lintId < 0x8000 && key !== null) {
          if (LINT_SEVERITIES[key]) {
            severity = LINT_SEVERITIES[key];
          }
          let msgVal = LINT_MESSAGES[key];
          if (typeof msgVal === "function") {
            const lenBytes = this.exports.inputLength
              ? typeof this.exports.inputLength.value === "number"
                ? this.exports.inputLength.value
                : Number(this.exports.inputLength) || 0
              : 0;
            const inputBufPtr = this.exports.getInputBuffer
              ? this.exports.getInputBuffer()
              : this.exports.lsp_getInputBuffer
                ? this.exports.lsp_getInputBuffer()
                : 0;
            let chars = "";
            if (inputBufPtr > 0 && startByte < lenBytes && endByte <= lenBytes && startByte <= endByte) {
              const sliceLen = endByte - startByte;
              const slice = new Uint8Array(sliceLen);
              slice.set(new Uint8Array(this.wasmMemory.buffer, inputBufPtr + startByte, sliceLen));
              const encoding = this.getInputEncoding();
              if (encoding === 1) {
                chars = new TextDecoder("utf-16le").decode(slice);
              } else {
                chars = new TextDecoder("utf-8").decode(slice);
              }
            }
            const dummyTree = {
              sourceCode: {
                substring: (start, end) => {
                  const currentBuf = this.wasmMemory.buffer;
                  const inputPtr = this.exports.getInputBuffer
                    ? this.exports.getInputBuffer()
                    : this.exports.lsp_getInputBuffer
                      ? this.exports.lsp_getInputBuffer()
                      : 0;
                  const totalLenBytes =
                    this.exports.inputLength && typeof this.exports.inputLength.value === "number"
                      ? this.exports.inputLength.value
                      : this.currentInputLength > 0
                        ? this.currentInputLength * 2
                        : 0;
                  const totalLenChars = Math.floor(totalLenBytes / 2);
                  if (inputPtr > 0 && start >= 0 && end <= totalLenChars && start <= end) {
                    const byteLen = (end - start) * 2;
                    const u8 = new Uint8Array(byteLen);
                    u8.set(new Uint8Array(currentBuf, inputPtr + start * 2, byteLen));
                    return new TextDecoder("utf-16le").decode(u8);
                  }
                  return "";
                },
              },
              mem32: memory,
              offsetToPoint: (o) => this.offsetToPos(o, lineStarts),
              facade: this,
            };
            const createContext = (nodePtr, fallbackText) => {
              let syntaxNode = null;
              let text = fallbackText;
              const isAlignedAddress = nodePtr > 0 && nodePtr % 4 === 0 && nodePtr / 4 < memory.length - 4;
              if (isAlignedAddress && this.exports.getChildByFieldId) {
                const typeFlags = memory[nodePtr / 4];
                const typeId = typeFlags & 0x03ff;
                const pad = typeFlags >>> 22;
                const len = memory[(nodePtr + 4) / 4] & 0x007fffff;
                let actualByteStart = -1;
                if (offsetCache.has(nodePtr)) {
                  actualByteStart = offsetCache.get(nodePtr);
                } else if (this.exports.lsp_findNodeOffset) {
                  try {
                    const offset = this.exports.lsp_findNodeOffset(astRoot, nodePtr, 0);
                    memory = new Uint32Array(this.wasmMemory.buffer);
                    if (offset >= 0) {
                      actualByteStart = offset;
                    }
                  } catch (_e) {
                    // Safe fallback if pointer is not in active tree
                  }
                }
                if (actualByteStart >= 0) {
                  syntaxNode = new SyntaxNode(dummyTree, nodePtr, actualByteStart, null, 0, len, typeId);
                  text = dummyTree.sourceCode.substring(syntaxNode.startIndex, syntaxNode.endIndex);
                }
              }
              const isAstNode = syntaxNode !== null;
              const nodeText = isAstNode ? text : fallbackText !== "" ? fallbackText : String(nodePtr);
              return new Proxy(
                {},
                {
                  get: (target, prop) => {
                    if (prop === "text") return nodeText;
                    if (prop === "field") return (name) => (syntaxNode ? syntaxNode.childText(name) : "");
                    if (prop === "asNumber") return () => Number(nodePtr);
                    if (prop === "asSymbol") return () => this.getStringFromPool(nodePtr) || String(nodePtr);
                    if (prop === "toString") return () => nodeText;
                    if (prop === "valueOf") return () => Number(nodePtr);
                    if (prop === "fields") {
                      return new Proxy(
                        {},
                        {
                          get: (_, fieldName) => (syntaxNode ? syntaxNode.childText(fieldName) : ""),
                        },
                      );
                    }
                    if (typeof prop === "symbol") {
                      if (prop === Symbol.toPrimitive) {
                        return (hint) => (hint === "number" ? Number(nodePtr) : nodeText);
                      }
                      return undefined;
                    }
                    if (syntaxNode) {
                      const cText = syntaxNode.childText(prop);
                      if (cText) return cText;
                    }
                    if (arg1 > 0 && nodePtr !== arg1 && offsetCache.has(arg1)) {
                      const ctxSyntaxNode = new SyntaxNode(
                        dummyTree,
                        arg1,
                        offsetCache.get(arg1),
                        null,
                        0,
                        memory[(arg1 + 4) / 4] & 0x007fffff,
                        memory[arg1 / 4] & 0x03ff,
                      );
                      const cText = ctxSyntaxNode.childText(prop);
                      if (cText) return cText;
                    }
                    return "";
                  },
                },
              );
            };
            const ctxTarget = createContext(arg0, chars);
            const ctx1 = createContext(arg1, "");
            const ctx2 = createContext(arg2, "");
            const ctx3 = createContext(arg3, "");
            msg = msgVal(ctxTarget, ctx1, ctx2, ctx3);
          } else {
            msg = msgVal;
          }
          if (LINT_CODES[lintId.toString()] !== undefined) {
            codeStr = LINT_CODES[lintId.toString()];
          }
        } else if (rawLintId < 1000 && this.syntaxNames && rawLintId < this.syntaxNames.length) {
          let name = this.syntaxNames[rawLintId];
          if (name && name.startsWith('"') && name.endsWith('"')) {
            name = name.slice(1, -1);
          }
          msg = `Expected '${name}'`;
          severity = 1; // Syntax parse error (Expected Token) is Error = 1 (Red Squiggle)
          codeStr = undefined;
        }
      }
      if (typeof msg === "string") {
        // Range shifting and clamping removed to preserve WASM output
      }
      if (endByte <= startByte) {
        endByte = startByte + (this.getInputEncoding() === 1 ? 2 : 1);
      }
      let startPos = this.offsetToPos(startByte, lineStarts);
      let endPos = this.offsetToPos(endByte, lineStarts);
      const encoding = this.getInputEncoding();
      const charDiv = encoding === 1 ? 2 : 1;
      // Prevent diagnostic bleed: if a diagnostic ends exactly at the start of the next line,
      // clamp it to the end of the previous line so VS Code doesn't render it under the next token.
      if (endPos.line > startPos.line && endPos.character === 0) {
        endPos = { line: endPos.line - 1, character: startPos.character + 1 };
      }
      const range = {
        start: startPos,
        end: endPos,
      };
      diags.push({
        range,
        message: msg,
        severity: severity,
        code: codeStr,
        startCharOffset: Math.floor(startByte / charDiv),
        endCharOffset: Math.floor(endByte / charDiv),
      });
    }
    // Cache the raw binary length so getAstSExpr/getAstHtml can read without re-calling
    this._lastDiagBinaryLength = numElements * 7;
    const uniqueDiags = [];
    const seenDiags = new Set();
    for (const d of diags) {
      const key = `${d.range.start.line}:${d.range.start.character}-${d.range.end.line}:${d.range.end.character}:${d.code || d.message}`;
      if (!seenDiags.has(key)) {
        seenDiags.add(key);
        uniqueDiags.push(d);
      }
    }
    uniqueDiags.sort((a, b) => {
      if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
      return a.range.start.character - b.range.start.character;
    });
    const mergedDiags = [];
    for (const d of uniqueDiags) {
      if (mergedDiags.length > 0) {
        const prev = mergedDiags[mergedDiags.length - 1];
        const isStartSameLine = prev.range.start.line === d.range.start.line;
        const isOverlapping =
          (prev.endCharOffset !== undefined &&
            d.startCharOffset !== undefined &&
            (d.startCharOffset <= prev.endCharOffset ||
              (isStartSameLine && d.startCharOffset <= prev.endCharOffset + 1))) ||
          (isStartSameLine && prev.range.end.character + 1 >= d.range.start.character) ||
          (prev.range.start.line <= d.range.start.line && prev.range.end.line >= d.range.start.line);
        if (isOverlapping && prev.code === undefined && d.code === undefined) {
          const prevIsSpecific =
            prev.message.startsWith("Expected ") || prev.message.startsWith("Syntax Error: Missing ");
          const dIsSpecific = d.message.startsWith("Expected ") || d.message.startsWith("Syntax Error: Missing ");
          const prevIsGeneric = prev.message === "Syntax Error";
          const dIsGeneric = d.message === "Syntax Error";
          if (prevIsGeneric && dIsSpecific) {
            // Replace generic error with more specific error
            mergedDiags[mergedDiags.length - 1] = d;
            continue;
          } else if (prevIsSpecific && dIsGeneric) {
            // Keep specific error, skip generic
            continue;
          } else if (prevIsGeneric && dIsGeneric) {
            // Merge two adjacent generic syntax errors
            if (d.range.end.character > prev.range.end.character) {
              prev.range.end = d.range.end;
            }
            if (prev.endCharOffset !== undefined && d.endCharOffset !== undefined) {
              prev.endCharOffset = Math.max(prev.endCharOffset, d.endCharOffset);
            }
            continue;
          }
        }
      }
      mergedDiags.push(d);
    }
    return mergedDiags;
  }
  /**
   * Retrieves semantic tokens for syntax highlighting.
   * Returns a raw `Uint32Array` mapped directly from WASM memory for speed.
   * Array layout is: [lineDelta, charDelta, length, typeId] repeating.
   */
  getSemanticTokens(astRoot) {
    if (!this.exports.lsp_semanticTokens_full || !this.exports.lsp_getBinaryBuffer) return new Uint32Array();
    const numElements = this.exports.lsp_semanticTokens_full(astRoot);
    if (numElements === 0) return new Uint32Array();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    const result = new Uint32Array(numElements * 4);
    result.set(mem32.subarray(dirPtr >>> 2, (dirPtr >>> 2) + numElements * 4));
    return result;
  }
  /** Retrieves a list of collapsable folding ranges from the parsed syntax tree. */
  getFoldingRanges(astRoot) {
    if (!this.exports.lsp_getFoldingRanges || !this.exports.lsp_getBinaryBuffer) return [];
    const lineStarts = this.getLineStarts();
    const numElements = this.exports.lsp_getFoldingRanges(astRoot);
    const ranges = [];
    if (numElements === 0) return ranges;
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    for (let i = 0; i < numElements * 2; i += 2) {
      ranges.push({
        start: this.offsetToPos(mem32[(dirPtr >> 2) + i], lineStarts),
        end: this.offsetToPos(mem32[(dirPtr >> 2) + i + 1], lineStarts),
      });
    }
    return ranges;
  }
  /** Extracts document symbols (e.g. classes, functions) for the document outline view. */
  getDocumentSymbols(astRoot) {
    if (!this.exports.lsp_getDocumentSymbols || !this.exports.lsp_getBinaryBuffer) return [];
    const lineStarts = this.getLineStarts();
    const numElements = this.exports.lsp_getDocumentSymbols(astRoot);
    const symbols = [];
    if (numElements === 0) return symbols;
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    for (let i = 0; i < numElements * 4; i += 4) {
      symbols.push({
        start: this.offsetToPos(mem32[(dirPtr >>> 2) + i], lineStarts),
        end: this.offsetToPos(mem32[(dirPtr >>> 2) + i + 1], lineStarts),
        typeId: mem32[(dirPtr >>> 2) + i + 2],
        nodePtr: mem32[(dirPtr >>> 2) + i + 3],
      });
    }
    return symbols;
  }
  /** Locates the definition of the symbol at the given byte offset. */
  getDefinition(astRoot, targetOffset) {
    if (!this.exports.lsp_getDefinition || !this.exports.lsp_getBinaryBuffer) return null;
    const numElements = this.exports.lsp_getDefinition(astRoot, targetOffset);
    if (numElements < 2) return null;
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    if (numElements >= 3) {
      return {
        fileId: mem32[(dirPtr >>> 2) + 0],
        start: mem32[(dirPtr >>> 2) + 1],
        end: mem32[(dirPtr >>> 2) + 2],
      };
    }
    return {
      fileId: 0,
      start: mem32[(dirPtr >>> 2) + 0],
      end: mem32[(dirPtr >>> 2) + 1],
    };
  }
  /** Locates all references to the symbol at the given byte offset across registered workspace files. */
  getReferences(astRoot, targetOffset) {
    if (!this.exports.lsp_getReferences || !this.exports.lsp_getBinaryBuffer) return [];
    const numElements = this.exports.lsp_getReferences(astRoot, targetOffset);
    const references = [];
    if (numElements === 0) return references;
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    for (let i = 0; i < numElements * 3; i += 3) {
      references.push({
        fileId: mem32[(dirPtr >>> 2) + i],
        start: mem32[(dirPtr >>> 2) + i + 1],
        end: mem32[(dirPtr >>> 2) + i + 2],
      });
    }
    return references;
  }
  /**
   * Generic Completion Context Query.
   * Inspects CST around cursorOffset and returns target expression and replacement range.
   */
  getCompletionContext(astRoot, cursorOffset) {
    if (!this.exports.lsp_getCompletionContext || !this.exports.lsp_getBinaryBuffer) return null;
    const count = this.exports.lsp_getCompletionContext(astRoot, cursorOffset);
    if (count < 4) return null;
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const targetStart = mem32[(dirPtr >>> 2) + 0];
    const targetEnd = mem32[(dirPtr >>> 2) + 1];
    const replaceStart = mem32[(dirPtr >>> 2) + 2];
    const replaceEnd = mem32[(dirPtr >>> 2) + 3];
    let targetText = "";
    const inputBufPtr = this.exports.getInputBuffer
      ? this.exports.getInputBuffer()
      : this.exports.lsp_getInputBuffer
        ? this.exports.lsp_getInputBuffer()
        : 0;
    if (inputBufPtr > 0 && targetEnd > targetStart) {
      const isUtf16 = this.getInputEncoding ? this.getInputEncoding() === 1 : false;
      const decoder = isUtf16 ? new TextDecoder("utf-16le") : new TextDecoder("utf-8");
      const rawBytes = new Uint8Array(this.wasmMemory.buffer, inputBufPtr + targetStart, targetEnd - targetStart);
      targetText = decoder.decode(new Uint8Array(rawBytes)).replace(/\0/g, "").trim();
    }
    return {
      hasTarget: true,
      targetText,
      targetRange: { start: targetStart, end: targetEnd },
      replaceRange: { start: replaceStart, end: replaceEnd },
    };
  }
  /** Extracts 2D diagram nodes, ports, spatial positions, and edges for visual modeling. */
  getDiagramData(astRoot, projectionId = 0) {
    const nodes = [];
    const edges = [];
    if (!this.exports.lsp_getDiagramData || !this.exports.lsp_getBinaryBuffer) {
      return { nodes, edges };
    }
    const numRecords = this.exports.lsp_getDiagramData(astRoot);
    if (numRecords === 0) return { nodes, edges };
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    const lineStarts = this.getLineStarts();
    const inputBufPtr = this.exports.getInputBuffer
      ? this.exports.getInputBuffer()
      : this.exports.lsp_getInputBuffer
        ? this.exports.lsp_getInputBuffer()
        : 0;
    const lenBytes = this.exports.inputLength
      ? typeof this.exports.inputLength.value === "number"
        ? this.exports.inputLength.value
        : Number(this.exports.inputLength) || 0
      : 0;
    const textBuffer =
      inputBufPtr > 0 && lenBytes > 0 ? new Uint8Array(this.wasmMemory.buffer, inputBufPtr, lenBytes) : null;
    const isUtf16 = this.getInputEncoding ? this.getInputEncoding() === 1 : false;
    const decoder = isUtf16 ? new TextDecoder("utf-16le") : new TextDecoder("utf-8");
    let offset = dirPtr >>> 2;
    for (let i = 0; i < numRecords; i++) {
      const kind = mem32[offset];
      if (kind === 1) {
        // RECORD_NODE
        const nodePtr = mem32[offset + 1];
        const typeId = mem32[offset + 2];
        const startByte = mem32[offset + 3];
        const endByte = mem32[offset + 4];
        const x = mem32[offset + 5] | 0;
        const y = mem32[offset + 6] | 0;
        const width = mem32[offset + 7];
        const height = mem32[offset + 8];
        const rotation = mem32[offset + 9] | 0;
        const flags = mem32[offset + 12];
        let nodeText = "";
        if (inputBufPtr > 0 && lenBytes > 0 && startByte < lenBytes && endByte <= lenBytes && startByte <= endByte) {
          try {
            const sliceLen = endByte - startByte;
            const slice = new Uint8Array(sliceLen);
            slice.set(new Uint8Array(this.wasmMemory.buffer, inputBufPtr + startByte, sliceLen));
            nodeText = decoder.decode(slice);
          } catch (e) {}
        }
        nodes.push({
          id: `node_${nodePtr}`,
          nodePtr,
          typeId,
          startByte,
          endByte,
          start: this.offsetToPos(startByte, lineStarts),
          end: this.offsetToPos(endByte, lineStarts),
          x,
          y,
          width,
          height,
          rotation,
          flags,
          text: nodeText,
        });
        offset += 13;
      } else if (kind === 2) {
        // RECORD_EDGE
        const edgePtr = mem32[offset + 1];
        const typeId = mem32[offset + 2];
        const srcNodePtr = mem32[offset + 3];
        const tgtNodePtr = mem32[offset + 4];
        edges.push({
          id: `edge_${edgePtr}`,
          edgePtr,
          typeId,
          source: `node_${srcNodePtr}`,
          target: `node_${tgtNodePtr}`,
        });
        offset += 10;
      } else {
        offset += 4;
      }
    }
    return { nodes, edges };
  }
  /** Applies visual diagram actions directly to the Arena AST and returns updated document text. */
  applyDiagramEdits(actions) {
    if (!this.exports.lsp_applyDiagramEdits || actions.length === 0) {
      return { text: "", edits: [] };
    }
    const actionBufferBytes = actions.length * 32;
    const actionPtr = this.allocMem(actionBufferBytes);
    if (actionPtr === 0) return { text: "", edits: [] };
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    let offset = actionPtr >>> 2;
    for (const action of actions) {
      if (action.type === "move" || action.type === "resize") {
        mem32[offset + 0] = action.type === "move" ? 1 : 2;
        mem32[offset + 1] = action.nodePtr || 0;
        mem32[offset + 2] = (action.x || 0) | 0;
        mem32[offset + 3] = (action.y || 0) | 0;
        mem32[offset + 4] = (action.width || 100) >>> 0;
        mem32[offset + 5] = (action.height || 60) >>> 0;
        mem32[offset + 6] = (action.rotation || 0) | 0;
        offset += 7;
      } else if (action.type === "delete") {
        mem32[offset + 0] = 3;
        mem32[offset + 1] = action.nodePtr || 0;
        offset += 2;
      } else if (action.type === "connect") {
        mem32[offset + 0] = 4;
        mem32[offset + 1] = action.srcNodePtr || 0;
        mem32[offset + 2] = action.tgtNodePtr || 0;
        offset += 7;
      }
    }
    const updatedLen = this.exports.lsp_applyDiagramEdits(actionPtr, actions.length);
    let updatedText = "";
    if (updatedLen > 0 && this.exports.lsp_getBinaryBuffer) {
      const dirPtr = this.exports.lsp_getBinaryBuffer();
      const mem8 = new Uint8Array(updatedLen);
      mem8.set(new Uint8Array(this.wasmMemory.buffer, dirPtr, updatedLen));
      const isUtf16 = this.getInputEncoding ? this.getInputEncoding() === 1 : false;
      const decoder = isUtf16 ? new TextDecoder("utf-16le") : new TextDecoder("utf-8");
      updatedText = decoder.decode(mem8);
    }
    return { text: updatedText, edits: [] };
  }
  /** Returns current allocated heap bytes in the WASM linear memory arena. */
  getMemoryUsage() {
    return this.exports.arena_getMemoryUsage ? this.exports.arena_getMemoryUsage() : 0;
  }
  /** Registers a document AST root for multi-file workspace LSP operations. */
  registerDocument(fileId, astRoot) {
    if (this.exports.lsp_registerDocument) {
      this.exports.lsp_registerDocument(fileId, astRoot);
    }
  }
  /** Unregisters a document AST root. */
  unregisterDocument(fileId) {
    if (this.exports.lsp_unregisterDocument) {
      this.exports.lsp_unregisterDocument(fileId);
    }
  }
  /** Clears all registered multi-file document AST roots. */
  clearDocuments() {
    if (this.exports.lsp_clearDocuments) {
      this.exports.lsp_clearDocuments();
    }
  }
  /** Evicts a document's full AST from the Tier 2 arena while preserving Tier 1 stubs. */
  evictDocumentAst(fileId) {
    if (this.exports.lsp_evictDocumentAst) {
      this.exports.lsp_evictDocumentAst(fileId);
    }
  }
  /** Hashes a string using FNV-1a algorithm matching WASM string hash. */
  hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; ) {
      const cp = str.codePointAt(i);
      h = Math.imul(h ^ cp, 16777619) >>> 0;
      i += cp > 0xffff ? 2 : 1;
    }
    return h;
  }
  allocMem(bytes) {
    const fn = this.exports.arena_alloc || this.exports.atomicChunkAlloc;
    return fn ? fn(bytes) : 0;
  }
  allocStringInArena(str) {
    if (!str || !this.exports.arena_allocStringBytes) return 0;
    const lenBytes = str.length * 2;
    const ptr = this.allocMem(lenBytes);
    if (ptr === 0) return 0;
    const memBuffer = this.wasmMemory
      ? this.wasmMemory.buffer
      : this.exports.memory
        ? this.exports.memory.buffer
        : null;
    if (!memBuffer) return 0;
    const mem16 = new Uint16Array(memBuffer);
    const startIdx = ptr >>> 1;
    for (let i = 0; i < str.length; i++) {
      mem16[startIdx + i] = str.charCodeAt(i);
    }
    return this.exports.arena_allocStringBytes(ptr, lenBytes);
  }
  /** Registers a declaration stub into the persistent Tier 1 index. */
  registerStub(
    fileId,
    symbolId,
    parentSymbolId,
    kind,
    flags,
    name,
    startByte,
    endByte,
    merkleLow = 0,
    merkleHigh = 0,
    parentFqn = "",
  ) {
    if (!this.exports.stub_registerSymbol) return 0;
    const nameHash = this.hashString(name);
    const nameHandle = this.allocStringInArena(name);
    const parentFqnHash = parentFqn ? this.hashString(parentFqn) : 0;
    return this.exports.stub_registerSymbol(
      fileId,
      symbolId,
      parentSymbolId,
      kind,
      flags,
      nameHash,
      nameHandle,
      startByte,
      endByte,
      merkleLow,
      merkleHigh,
      parentFqnHash,
    );
  }
  /** Registers an enclosing parent FQN for a given fileId. */
  registerFileParentFQN(fileId, parentFQN) {
    if (!this.exports.stub_registerFileWithParentFQN) return;
    const parentFqnHash = this.hashString(parentFQN);
    this.exports.stub_registerFileWithParentFQN(fileId, parentFqnHash);
  }
  /** Binds an FQN string to a specific stub ID. */
  bindFqnStub(fqn, stubId) {
    if (!this.exports.stub_bindFqnStub) return;
    const fqnHash = this.hashString(fqn);
    this.exports.stub_bindFqnStub(fqnHash, stubId);
  }
  /** Stitches a child stub to its parent package using the parent FQN string. */
  stitchParentFQN(childStubId, parentFQN) {
    if (!this.exports.stub_stitchParentFQN) return 0;
    const parentFqnHash = this.hashString(parentFQN);
    return this.exports.stub_stitchParentFQN(childStubId, parentFqnHash);
  }
  /** Clears all Tier 1 stubs for a specific fileId or all files if fileId === 0. */
  clearFileStubs(fileId = 0) {
    if (fileId === 0 && this.exports.stub_clearAll) {
      this.exports.stub_clearAll();
    } else if (this.exports.stub_clearFile) {
      this.exports.stub_clearFile(fileId);
    }
  }
  /** Alias for clearFileStubs. */
  clearStubs(fileId = 0) {
    this.clearFileStubs(fileId);
  }
  /** Finds all stub symbols matching a name string across the workspace. */
  findStubsByName(name) {
    if (!this.exports.stub_findByName || !this.exports.stub_getBinaryBuffer) return [];
    const hash = this.hashString(name);
    const numStubs = this.exports.stub_findByName(hash);
    if (numStubs === 0) return [];
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.stub_getBinaryBuffer();
    const stride = 12;
    const results = [];
    for (let i = 0; i < numStubs * stride; i += stride) {
      const kf = mem32[(dirPtr >>> 2) + i + 3];
      results.push({
        fileId: mem32[(dirPtr >>> 2) + i + 0],
        symbolId: mem32[(dirPtr >>> 2) + i + 1],
        parentSymbolId: mem32[(dirPtr >>> 2) + i + 2],
        kind: kf & 0xffff,
        flags: (kf >>> 16) & 0xffff,
        nameHash: mem32[(dirPtr >>> 2) + i + 4],
        startByte: mem32[(dirPtr >>> 2) + i + 6],
        endByte: mem32[(dirPtr >>> 2) + i + 7],
        merkleLow: mem32[(dirPtr >>> 2) + i + 8],
        merkleHigh: mem32[(dirPtr >>> 2) + i + 9],
      });
    }
    return results;
  }
  /** Finds all stub symbols matching a name string using WASM SIMD 128-bit vector search. */
  findStubsByNameSIMD(name, preferredFileId = 0) {
    if (!this.exports.stub_findByNameHashSIMD || !this.exports.stub_getBinaryBuffer) return [];
    const hash = this.hashString(name);
    const numStubs = this.exports.stub_findByNameHashSIMD(hash, preferredFileId);
    if (numStubs === 0) return [];
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.stub_getBinaryBuffer();
    const stride = 12;
    const results = [];
    for (let i = 0; i < numStubs * stride; i += stride) {
      const kf = mem32[(dirPtr >>> 2) + i + 3];
      results.push({
        fileId: mem32[(dirPtr >>> 2) + i + 0],
        symbolId: mem32[(dirPtr >>> 2) + i + 1],
        parentSymbolId: mem32[(dirPtr >>> 2) + i + 2],
        kind: kf & 0xffff,
        flags: (kf >>> 16) & 0xffff,
        nameHash: mem32[(dirPtr >>> 2) + i + 4],
        startByte: mem32[(dirPtr >>> 2) + i + 6],
        endByte: mem32[(dirPtr >>> 2) + i + 7],
        merkleLow: mem32[(dirPtr >>> 2) + i + 8],
        merkleHigh: mem32[(dirPtr >>> 2) + i + 9],
      });
    }
    return results;
  }
  /** Queries all symbols for a given fileId (fast LSP document symbol outline). */
  getFileSymbols(fileId) {
    if (!this.exports.stub_getFileSymbols || !this.exports.stub_getBinaryBuffer) return [];
    const numStubs = this.exports.stub_getFileSymbols(fileId);
    if (numStubs === 0) return [];
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.stub_getBinaryBuffer();
    const stride = 12;
    const results = [];
    for (let i = 0; i < numStubs * stride; i += stride) {
      const kf = mem32[(dirPtr >>> 2) + i + 3];
      results.push({
        fileId: mem32[(dirPtr >>> 2) + i + 0],
        symbolId: mem32[(dirPtr >>> 2) + i + 1],
        parentSymbolId: mem32[(dirPtr >>> 2) + i + 2],
        kind: kf & 0xffff,
        flags: (kf >>> 16) & 0xffff,
        nameHash: mem32[(dirPtr >>> 2) + i + 4],
        startByte: mem32[(dirPtr >>> 2) + i + 6],
        endByte: mem32[(dirPtr >>> 2) + i + 7],
        merkleLow: mem32[(dirPtr >>> 2) + i + 8],
        merkleHigh: mem32[(dirPtr >>> 2) + i + 9],
      });
    }
    return results.reverse();
  }
  /** Queries child stub symbols for a parent symbol ID. */
  getStubChildren(parentSymbolId) {
    if (!this.exports.stub_getChildren || !this.exports.stub_getBinaryBuffer) return [];
    const numStubs = this.exports.stub_getChildren(parentSymbolId);
    if (numStubs === 0) return [];
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.stub_getBinaryBuffer();
    const stride = 12;
    const results = [];
    for (let i = 0; i < numStubs * stride; i += stride) {
      const kf = mem32[(dirPtr >>> 2) + i + 3];
      results.push({
        fileId: mem32[(dirPtr >>> 2) + i + 0],
        symbolId: mem32[(dirPtr >>> 2) + i + 1],
        parentSymbolId: mem32[(dirPtr >>> 2) + i + 2],
        kind: kf & 0xffff,
        flags: (kf >>> 16) & 0xffff,
        nameHash: mem32[(dirPtr >>> 2) + i + 4],
        startByte: mem32[(dirPtr >>> 2) + i + 6],
        endByte: mem32[(dirPtr >>> 2) + i + 7],
        merkleLow: mem32[(dirPtr >>> 2) + i + 8],
        merkleHigh: mem32[(dirPtr >>> 2) + i + 9],
      });
    }
    return results;
  }
  /** Returns total number of registered stub symbols. */
  getStubCount() {
    return this.exports.stub_count ? this.exports.stub_count() : 0;
  }
  /** Exports Tier 1 stub store and string arena to a Uint8Array binary snapshot. */
  exportStubBinary() {
    if (!this.exports.stub_exportBinary) return new Uint8Array(0);
    const requiredSize = this.exports.stub_exportBinary(0, 0);
    if (requiredSize === 0) return new Uint8Array(0);
    const ptr = this.allocMem(requiredSize);
    if (ptr === 0) return new Uint8Array(0);
    this.exports.stub_exportBinary(ptr, requiredSize);
    const mem8 = new Uint8Array(this.wasmMemory.buffer);
    return new Uint8Array(mem8.subarray(ptr, ptr + requiredSize));
  }
  /** Imports Tier 1 stub store and string arena from a binary snapshot. */
  importStubBinary(buffer) {
    if (!this.exports.stub_importBinary || buffer.byteLength === 0) return false;
    const ptr = this.allocMem(buffer.byteLength);
    if (ptr === 0) return false;
    const mem8 = new Uint8Array(this.wasmMemory.buffer);
    mem8.set(buffer, ptr);
    const ok = this.exports.stub_importBinary(ptr, buffer.byteLength);
    return ok === 1;
  }
  /** Restores Tier 1 stub store from a binary snapshot and returns the restored stub count. */
  restoreStubBinary(buffer) {
    const ok = this.importStubBinary(buffer);
    return ok ? this.getStubCount() : 0;
  }
  /** Bulk registers raw uint32 stub records from worker threads. */
  bulkRegisterStubs(payload) {
    if (!this.exports.stub_bulkRegister || payload.byteLength === 0) return 0;
    const ptr = this.allocMem(payload.byteLength);
    if (ptr === 0) return 0;
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    mem32.set(payload, ptr >>> 2);
    return this.exports.stub_bulkRegister(ptr, payload.length);
  }
  /** Indexes all stubs into the Dex-style trigram inverted search map. */
  indexTrigrams() {
    return this.exports.trigram_indexAllStubs ? this.exports.trigram_indexAllStubs() : 0;
  }
  /** Dex-style Sub-Millisecond Fuzzy Symbol Search across all indexed stubs in the workspace. */
  fuzzyFindSymbols(query, maxResults = 50) {
    if (!this.exports.trigram_fuzzyFind || !this.exports.stub_getBinaryBuffer) {
      return [];
    }
    const queryHandle = this.allocStringInArena(query);
    const count = this.exports.trigram_fuzzyFind(queryHandle, maxResults);
    const dirPtr = this.exports.stub_getBinaryBuffer ? this.exports.stub_getBinaryBuffer() : 0;
    const memBuffer = this.wasmMemory
      ? this.wasmMemory.buffer
      : this.exports.memory
        ? this.exports.memory.buffer
        : null;
    if (!memBuffer) return [];
    const mem32 = new Uint32Array(memBuffer);
    const results = [];
    for (let i = 0; i < count * 7; i += 7) {
      const kf = mem32[(dirPtr >>> 2) + i + 2];
      results.push({
        stubId: mem32[(dirPtr >>> 2) + i + 0],
        fileId: mem32[(dirPtr >>> 2) + i + 1],
        kind: kf & 0xffff,
        flags: (kf >>> 16) & 0xffff,
        nameHash: mem32[(dirPtr >>> 2) + i + 3],
        startByte: mem32[(dirPtr >>> 2) + i + 4],
        endByte: mem32[(dirPtr >>> 2) + i + 5],
        score: mem32[(dirPtr >>> 2) + i + 6],
      });
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  }
  /** Shifts byte offsets in-place across all stubs in a file after an interior edit. */
  shiftStubByteOffsets(fileId, fromByte, deltaBytes) {
    if (!this.exports.stub_shiftByteOffsets) return 0;
    return this.exports.stub_shiftByteOffsets(fileId, fromByte, deltaBytes);
  }
  /** Gets or looks up an incremental Salsa 3.0 query node. */
  queryGetNode(queryType, arg1, arg2 = 0, arg3 = 0, arg4 = 0) {
    if (!this.exports.query_getNode) return 0;
    return this.exports.query_getNode(queryType, arg1, arg2, arg3, arg4);
  }
  /** Allocates a new incremental Salsa 3.0 query node. */
  queryAllocNode(queryType, arg1, arg2 = 0, arg3 = 0, arg4 = 0) {
    if (!this.exports.query_allocNode) return 0;
    return this.exports.query_allocNode(queryType, arg1, arg2, arg3, arg4);
  }
  /** Invalidates a query node and cascades dirtying to all subscribers. */
  queryInvalidate(queryNodePtr) {
    if (this.exports.query_invalidate) {
      this.exports.query_invalidate(queryNodePtr);
    }
  }
  /** Gets the cached result value of a query node. */
  queryGetValue(queryNodePtr) {
    return this.exports.query_getValue ? this.exports.query_getValue(queryNodePtr) : 0;
  }
  /** Sets the cached result value of a query node. */
  querySetValue(queryNodePtr, val) {
    if (this.exports.query_setValue) {
      this.exports.query_setValue(queryNodePtr, val);
    }
  }
  /** Gets the cached revision of a query node. */
  queryGetRevision(queryNodePtr) {
    return this.exports.query_getRevision ? this.exports.query_getRevision(queryNodePtr) : 0;
  }
  /** Sets the cached revision of a query node. */
  querySetRevision(queryNodePtr, rev) {
    if (this.exports.query_setRevision) {
      this.exports.query_setRevision(queryNodePtr, rev);
    }
  }
  /** Gets the cached result Merkle low 32-bits. */
  queryGetMerkleLow(queryNodePtr) {
    return this.exports.query_getMerkleLow ? this.exports.query_getMerkleLow(queryNodePtr) >>> 0 : 0;
  }
  /** Gets the cached result Merkle high 32-bits. */
  queryGetMerkleHigh(queryNodePtr) {
    return this.exports.query_getMerkleHigh ? this.exports.query_getMerkleHigh(queryNodePtr) >>> 0 : 0;
  }
  /** Sets the cached result Merkle 64-bit hash. */
  querySetMerkle(queryNodePtr, low, high) {
    if (this.exports.query_setMerkle) {
      this.exports.query_setMerkle(queryNodePtr, low, high);
    }
  }
  /** Establishes a directed dependency edge from parent to target query. */
  queryAddDependency(parentPtr, targetPtr) {
    if (this.exports.query_addDependency) {
      this.exports.query_addDependency(parentPtr, targetPtr);
    }
  }
  /** Gets the global database revision counter. */
  queryGetGlobalRevision() {
    return this.exports.query_getGlobalRevision ? this.exports.query_getGlobalRevision() : 0;
  }
  /** Increments the global database revision counter. */
  queryIncrementRevision() {
    if (this.exports.query_incrementRevision) {
      this.exports.query_incrementRevision();
    }
  }
  /** Registers a negative dependency: records that a query failed because a symbol name was missing. */
  salsaRegisterNegativeDependency(queryPtr, name) {
    if (!this.exports.salsa_registerNegativeDependency) return;
    const nameHash = this.hashString(name);
    this.exports.salsa_registerNegativeDependency(queryPtr, nameHash);
  }
  /** Invalidates queries waiting for a symbol name when that symbol is introduced. */
  salsaInvalidateNegativeDependencies(name) {
    if (!this.exports.salsa_invalidateNegativeDependencies) return 0;
    const nameHash = this.hashString(name);
    return this.exports.salsa_invalidateNegativeDependencies(nameHash);
  }
  /** Performs O(1) Merkle backdating on a query result. Returns true if semantically identical. */
  salsaBackdateQuery(nodePtr, newMerkleLow, newMerkleHigh) {
    if (!this.exports.salsa_backdateQuery) return false;
    return this.exports.salsa_backdateQuery(nodePtr, newMerkleLow, newMerkleHigh) === 1;
  }
  /** Gets the version counter for a language in the polyglot arena. */
  polyglotGetLangVersion(arenaPtr, langId) {
    return this.exports.polyglot_getLangVersion ? this.exports.polyglot_getLangVersion(arenaPtr, langId) : 0;
  }
  /** Increments the version counter for a language in the polyglot arena. */
  polyglotIncrementLangVersion(arenaPtr, langId) {
    return this.exports.polyglot_incrementLangVersion
      ? this.exports.polyglot_incrementLangVersion(arenaPtr, langId)
      : 0;
  }
  /** Checks if a language version has changed since snapshotVersion. */
  polyglotHasLangChanged(arenaPtr, langId, snapshotVersion) {
    if (!this.exports.polyglot_hasLangChanged) return true;
    return this.exports.polyglot_hasLangChanged(arenaPtr, langId, snapshotVersion) === 1;
  }
  /** Returns the number of declarative MCP tools registered in WASM. */
  mcpGetToolCount() {
    return this.exports.mcp_getToolCount ? this.exports.mcp_getToolCount() : 0;
  }
  /** Returns the DJB2 name hash for an MCP tool index. */
  mcpGetToolNameHash(index) {
    return this.exports.mcp_getToolNameHash ? this.exports.mcp_getToolNameHash(index) : 0;
  }
  /** Dispatches an MCP tool call directly in WASM linear memory. */
  mcpDispatchTool(toolIndex, arg1 = 0, arg2 = 0, arg3 = 0) {
    return this.exports.mcp_dispatchTool ? this.exports.mcp_dispatchTool(toolIndex, arg1, arg2, arg3) : 0;
  }
  /** Returns the pointer to the MCP result output buffer in WASM linear memory. */
  mcpGetOutputBuffer() {
    return this.exports.mcp_getOutputBuffer ? this.exports.mcp_getOutputBuffer() : 0;
  }
  /** Returns the length of the MCP result output buffer in bytes. */
  mcpGetOutputLength() {
    return this.exports.mcp_getOutputLength ? this.exports.mcp_getOutputLength() : 0;
  }
  /** Reads the MCP output buffer as a UTF-8 string. */
  mcpGetOutputText() {
    const ptr = this.mcpGetOutputBuffer();
    const len = this.mcpGetOutputLength();
    if (ptr === 0 || len === 0) return "";
    const bytes = new Uint8Array(this.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
  }
  /** Adds an OWL 2 axiom to the indexed WASM ontology store. */
  addOntologyAxiom(axiomType, sourceLangId, subject, predicate = "", object = "", flags = 0, extra = 0) {
    if (!this.exports.ontology_addAxiom) return 0;
    const sHash = typeof subject === "number" ? subject : subject ? this.hashString(subject) : 0;
    const pHash = typeof predicate === "number" ? predicate : predicate ? this.hashString(predicate) : 0;
    const oHash = typeof object === "number" ? object : object ? this.hashString(object) : 0;
    return this.exports.ontology_addAxiom(axiomType, sourceLangId, sHash, pHash, oHash, flags, extra);
  }
  /** Evaluates transitive SubClassOf subsumption directly in WASM memory. */
  isSubClassOf(subClass, superClass) {
    if (!this.exports.ontology_isSubClassOf) return false;
    const subHash = this.hashString(subClass);
    const superHash = this.hashString(superClass);
    return this.exports.ontology_isSubClassOf(subHash, superHash) === 1;
  }
  /** Evaluates if two classes are disjoint (directly or through superclasses). */
  areDisjoint(class1, class2) {
    if (!this.exports.ontology_areDisjoint) return false;
    const c1Hash = this.hashString(class1);
    const c2Hash = this.hashString(class2);
    return this.exports.ontology_areDisjoint(c1Hash, c2Hash) === 1;
  }
  /** Evaluates if an individual is an instance of a class (directly or through subclass inference). */
  isInstanceOf(individual, className) {
    if (!this.exports.ontology_isInstanceOf) return false;
    const indHash = this.hashString(individual);
    const clsHash = this.hashString(className);
    return this.exports.ontology_isInstanceOf(indHash, clsHash) === 1;
  }
  /** Computes the transitive closure of reachable nodes along a property from a source individual. */
  getTransitiveClosure(property, source) {
    if (!this.exports.ontology_getTransitiveClosure || !this.exports.ontology_getQueryBuffer) return [];
    const pHash = property ? this.hashString(property) : 0xffffffff;
    const sHash = this.hashString(source);
    const count = this.exports.ontology_getTransitiveClosure(pHash, sHash);
    if (count === 0) return [];
    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const results = [];
    for (let i = 0; i < count; i++) {
      results.push(mem32[(dirPtr >>> 2) + i]);
    }
    return results;
  }
  /** Computes the transitive closure with traversal path edges. */
  getTransitiveClosureWithPath(property, source) {
    if (!this.exports.ontology_getTransitiveClosureWithPath || !this.exports.ontology_getQueryBuffer) {
      return { reachable: [], path: [] };
    }
    const pHash = property ? this.hashString(property) : 0xffffffff;
    const sHash = this.hashString(source);
    const count = this.exports.ontology_getTransitiveClosureWithPath(pHash, sHash);
    if (count === 0) return { reachable: [], path: [] };
    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    let offset = dirPtr >>> 2;
    const reachableCount = mem32[offset++];
    const reachable = [];
    for (let i = 0; i < reachableCount; i++) {
      reachable.push(mem32[offset++]);
    }
    const edgeCount = mem32[offset++];
    const path = [];
    for (let i = 0; i < edgeCount; i++) {
      const s = mem32[offset++];
      const o = mem32[offset++];
      path.push({ subject: s, object: o });
    }
    return { reachable, path };
  }
  /** Explains why a subsumption holds by returning the chain of justifying axioms. */
  explainSubsumption(subClass, superClass) {
    if (!this.exports.ontology_explainSubsumption || !this.exports.ontology_getQueryBuffer) return [];
    const subHash = this.hashString(subClass);
    const superHash = this.hashString(superClass);
    const count = this.exports.ontology_explainSubsumption(subHash, superHash);
    if (count === 0) return [];
    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const stride = 6;
    const results = [];
    for (let i = 0; i < count * stride; i += stride) {
      const typeAndLang = mem32[(dirPtr >>> 2) + i + 0];
      results.push({
        axiomType: typeAndLang & 0xffff,
        sourceLangId: (typeAndLang >>> 16) & 0xffff,
        subjectHash: mem32[(dirPtr >>> 2) + i + 1],
        predicateHash: mem32[(dirPtr >>> 2) + i + 2],
        objectHash: mem32[(dirPtr >>> 2) + i + 3],
        flags: mem32[(dirPtr >>> 2) + i + 4],
      });
    }
    return results;
  }
  /** Audits global ontology consistency, returning conflicting axioms if inconsistent. */
  checkConsistency() {
    if (!this.exports.ontology_checkConsistency || !this.exports.ontology_getQueryBuffer) {
      return { isConsistent: true, conflictingAxioms: [] };
    }
    const count = this.exports.ontology_checkConsistency();
    if (count === 0) return { isConsistent: true, conflictingAxioms: [] };
    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const stride = 6;
    const conflictingAxioms = [];
    for (let i = 0; i < count * stride; i += stride) {
      const typeAndLang = mem32[(dirPtr >>> 2) + i + 0];
      conflictingAxioms.push({
        axiomType: typeAndLang & 0xffff,
        sourceLangId: (typeAndLang >>> 16) & 0xffff,
        subjectHash: mem32[(dirPtr >>> 2) + i + 1],
        predicateHash: mem32[(dirPtr >>> 2) + i + 2],
        objectHash: mem32[(dirPtr >>> 2) + i + 3],
        flags: mem32[(dirPtr >>> 2) + i + 4],
      });
    }
    return {
      isConsistent: false,
      conflictingAxioms,
      explanation: `Found ${conflictingAxioms.length} disjointness violation(s) in the ontology.`,
    };
  }
  /** Classifies an individual, returning direct types and all transitive types. */
  classifyIndividual(individual) {
    if (!this.exports.ontology_classifyIndividual || !this.exports.ontology_getQueryBuffer) {
      return { directTypes: [], allTypes: [] };
    }
    const indHash = this.hashString(individual);
    const wordCount = this.exports.ontology_classifyIndividual(indHash);
    if (wordCount === 0) return { directTypes: [], allTypes: [] };
    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    let offset = dirPtr >>> 2;
    const directCount = mem32[offset++];
    const directTypes = [];
    for (let i = 0; i < directCount; i++) {
      directTypes.push(mem32[offset++]);
    }
    const allCount = mem32[offset++];
    const allTypes = [];
    for (let i = 0; i < allCount; i++) {
      allTypes.push(mem32[offset++]);
    }
    return { directTypes, allTypes };
  }
  /** Returns all taxonomy nodes from the ontology. */
  getTaxonomy() {
    if (!this.exports.ontology_getTaxonomy || !this.exports.ontology_getQueryBuffer) return [];
    const classCount = this.exports.ontology_getTaxonomy();
    if (classCount === 0) return [];
    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    let offset = dirPtr >>> 2;
    const totalClasses = mem32[offset++];
    const nodes = [];
    for (let c = 0; c < totalClasses; c++) {
      const classHash = mem32[offset++];
      const superCount = mem32[offset++];
      const directSuperClasses = [];
      for (let s = 0; s < superCount; s++) directSuperClasses.push(mem32[offset++]);
      const subCount = mem32[offset++];
      const directSubClasses = [];
      for (let s = 0; s < subCount; s++) directSubClasses.push(mem32[offset++]);
      const equivCount = mem32[offset++];
      const equivalentClasses = [];
      for (let e = 0; e < equivCount; e++) equivalentClasses.push(mem32[offset++]);
      nodes.push({
        classHash,
        directSuperClasses,
        directSubClasses,
        equivalentClasses,
      });
    }
    return nodes;
  }
  computeOntologyIntervalIndex() {
    if (this.exports.ontology_computeIntervalIndex) {
      this.exports.ontology_computeIntervalIndex();
    }
  }
  evaluateOntologyPropertyPath(propertyName, pathOp, stepPropertyName2, sourceName) {
    if (!this.exports.ontology_evaluatePropertyPath || !this.exports.ontology_getQueryBuffer) return [];
    const pHash = propertyName ? this.hashString(propertyName) : 0;
    const p2Hash = stepPropertyName2 ? this.hashString(stepPropertyName2) : 0;
    const sHash = sourceName ? this.hashString(sourceName) : 0;
    const count = this.exports.ontology_evaluatePropertyPath(pHash, pathOp, p2Hash, sHash);
    if (count === 0) return [];
    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const offset = dirPtr >>> 2;
    const result = [];
    for (let i = 0; i < count; i++) {
      result.push(mem32[offset + i]);
    }
    return result;
  }
  saturateOntologyELRules() {
    if (this.exports.ontology_saturateELRules) {
      return this.exports.ontology_saturateELRules();
    }
    return 0;
  }
  /** Queries indexed triples via SPO / POS / OSP pattern matching in WASM memory. */
  queryOntologyTriples(subjectPattern = "", predicatePattern = "", objectPattern = "") {
    if (!this.exports.ontology_queryTriples || !this.exports.ontology_getQueryBuffer) return [];
    const sPat = subjectPattern ? this.hashString(subjectPattern) : 0xffffffff;
    const pPat = predicatePattern ? this.hashString(predicatePattern) : 0xffffffff;
    const oPat = objectPattern ? this.hashString(objectPattern) : 0xffffffff;
    const count = this.exports.ontology_queryTriples(sPat, pPat, oPat);
    if (count === 0) return [];
    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const stride = 6;
    const results = [];
    for (let i = 0; i < count * stride; i += stride) {
      const typeAndLang = mem32[(dirPtr >>> 2) + i + 0];
      results.push({
        axiomType: typeAndLang & 0xffff,
        sourceLangId: (typeAndLang >>> 16) & 0xffff,
        subjectHash: mem32[(dirPtr >>> 2) + i + 1],
        predicateHash: mem32[(dirPtr >>> 2) + i + 2],
        objectHash: mem32[(dirPtr >>> 2) + i + 3],
        flags: mem32[(dirPtr >>> 2) + i + 4],
      });
    }
    return results;
  }
  /** Returns total asserted OWL 2 axioms in the store. */
  getOntologyAxiomCount() {
    return this.exports.ontology_getAxiomCount ? this.exports.ontology_getAxiomCount() : 0;
  }
  /** Retracts an axiom by ID in WASM memory using DRed over-deletion and rederivation. */
  retractOntologyAxiom(axiomId) {
    return this.exports.ontology_retractAxiom ? this.exports.ontology_retractAxiom(axiomId) : 0;
  }
  /** Applies an incremental delta of additions and retractions in WASM linear memory. */
  applyOntologyDelta(adds, retractions) {
    if (!this.exports.ontology_applyDelta) return 0;
    const addCount = adds.length;
    const retractCount = retractions.length;
    const addBuffer = new Uint32Array(addCount * 6);
    for (let i = 0; i < addCount; i++) {
      const a = adds[i];
      const typeAndLang = (a.axiomType & 0xffff) | (((a.sourceLangId || 1) & 0xffff) << 16);
      addBuffer[i * 6 + 0] = typeAndLang;
      addBuffer[i * 6 + 1] = a.subject ? this.hashString(a.subject) : 0;
      addBuffer[i * 6 + 2] = a.predicate ? this.hashString(a.predicate) : 0;
      addBuffer[i * 6 + 3] = a.object ? this.hashString(a.object) : 0;
      addBuffer[i * 6 + 4] = a.flags || 0;
      addBuffer[i * 6 + 5] = 0;
    }
    const retBuffer = new Uint32Array(retractCount * 6);
    for (let i = 0; i < retractCount; i++) {
      const r = retractions[i];
      retBuffer[i * 6 + 0] = r.axiomType & 0xffff;
      retBuffer[i * 6 + 1] = r.subject ? this.hashString(r.subject) : 0;
      retBuffer[i * 6 + 2] = r.predicate ? this.hashString(r.predicate) : 0;
      retBuffer[i * 6 + 3] = r.object ? this.hashString(r.object) : 0;
      retBuffer[i * 6 + 4] = 0;
      retBuffer[i * 6 + 5] = 0;
    }
    const addPtr = this.exports.atomicChunkAlloc ? this.exports.atomicChunkAlloc(addCount * 24) : 0;
    const retPtr = this.exports.atomicChunkAlloc ? this.exports.atomicChunkAlloc(retractCount * 24) : 0;
    if (addPtr && addCount > 0) {
      new Uint32Array(this.wasmMemory.buffer, addPtr, addCount * 6).set(addBuffer);
    }
    if (retPtr && retractCount > 0) {
      new Uint32Array(this.wasmMemory.buffer, retPtr, retractCount * 6).set(retBuffer);
    }
    return this.exports.ontology_applyDelta(addCount, addPtr, retractCount, retPtr);
  }
  /** Saturates functional object properties and unifies individual equivalence classes. */
  saturateFunctionalOntology() {
    return this.exports.ontology_saturateFunctional ? this.exports.ontology_saturateFunctional() : 0;
  }
  /** Isolates a Minimal Unsatisfiable Subset (MUS) using QuickXplain in WASM linear memory. */
  quickXplainOntology() {
    if (!this.exports.ontology_quickXplain || !this.exports.ontology_getQueryBuffer) return [];
    const count = this.exports.ontology_quickXplain();
    if (count === 0) return [];
    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const stride = 6;
    const results = [];
    // First word is count
    for (let i = 0; i < count; i++) {
      const base = (dirPtr >>> 2) + 1 + i * stride;
      const typeAndLang = mem32[base + 0];
      results.push({
        axiomType: typeAndLang & 0xffff,
        sourceLangId: (typeAndLang >>> 16) & 0xffff,
        subjectHash: mem32[base + 1],
        predicateHash: mem32[base + 2],
        objectHash: mem32[base + 3],
        flags: mem32[base + 4],
      });
    }
    return results;
  }
  /** Enumerates all minimal unsatisfiable subsets using Reiter's Hitting Set Tree (HST). */
  allMusOntology(maxCores = 16) {
    if (!this.exports.ontology_allMus || !this.exports.ontology_getQueryBuffer) return [];
    const coreCount = this.exports.ontology_allMus(maxCores);
    if (coreCount === 0) return [];
    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const offset = dirPtr >>> 2;
    const totalCores = mem32[offset];
    let ptr = offset + 1;
    const allCores = [];
    for (let c = 0; c < totalCores; c++) {
      const coreSize = mem32[ptr++];
      const coreAxiomIds = [];
      for (let k = 0; k < coreSize; k++) {
        coreAxiomIds.push(mem32[ptr++]);
      }
      allCores.push(coreAxiomIds);
    }
    return allCores;
  }
  /** Clears the WASM ontology store and inverted indices. */
  clearOntology() {
    if (this.exports.ontology_clear) {
      this.exports.ontology_clear();
    }
  }
  /** Runs the full hybrid interleaved fixpoint cycle in WASM memory. */
  runHybridFixpoint() {
    return this.exports.ontology_runHybridFixpoint ? this.exports.ontology_runHybridFixpoint() : 0;
  }
  /** Validates advanced OWL 2 / SHACL constraints (asymmetry, irreflexivity, disjoint properties). */
  validateAdvancedConstraints() {
    if (!this.exports.ontology_validateAdvancedConstraints || !this.exports.ontology_getQueryBuffer) return [];
    const count = this.exports.ontology_validateAdvancedConstraints();
    if (count === 0) return [];
    const dirPtr = this.exports.ontology_getQueryBuffer();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const offset = dirPtr >>> 2;
    const results = [];
    for (let i = 0; i < count; i++) {
      results.push({
        subjectHash: mem32[offset + i * 3 + 0],
        predicateHash: mem32[offset + i * 3 + 1],
        objectHash: mem32[offset + i * 3 + 2],
      });
    }
    return results;
  }
  /** Runs Tier 2 WASM Tableau Engine for disjunctive and complex proofs. */
  runTableauSubsumption(subClassName, superClassName) {
    if (!this.exports.ontology_runTableauSubsumption) return false;
    const subHash = this.hashString(subClassName);
    const supHash = this.hashString(superClassName);
    return this.exports.ontology_runTableauSubsumption(subHash, supHash) === 1;
  }
  /** Projects all indexed declaration stubs into OWL 2 axioms. */
  projectStubsToOntology(sourceLangId) {
    return this.exports.projection_projectAllStubs ? this.exports.projection_projectAllStubs(sourceLangId) : 0;
  }
  /** Projects synthetic symbol with conflict deduplication against real declarations. */
  projectSyntheticSymbol(fileId, symbolId, parentSymbolId, kind, name, parentFqn = "") {
    if (!this.exports.stub_projectSyntheticSymbol) return 0;
    const nameHash = this.hashString(name);
    const nameHandle = this.allocStringInArena(name);
    const parentFqnHash = parentFqn ? this.hashString(parentFqn) : 0;
    return this.exports.stub_projectSyntheticSymbol(
      fileId,
      symbolId,
      parentSymbolId,
      kind,
      nameHash,
      nameHandle,
      parentFqnHash,
    );
  }
  /** Creates an arena-native flattener attached to a DaeBuilder. */
  createFlattener(daePtr) {
    return this.exports.flattener_create ? this.exports.flattener_create(daePtr) : 0;
  }
  /** Flattens an AST class definition into DAE variables and equations. */
  flattenerFlattenClass(flattenerPtr, classNodePtr) {
    return this.exports.flattener_flattenClass ? this.exports.flattener_flattenClass(flattenerPtr, classNodePtr) : 0;
  }
  /** Adds a connector connection equation to the flattener. */
  flattenerAddConnection(flattenerPtr, p1VarId, p2VarId, isFlow, isBoundary = false) {
    return this.exports.flattener_addConnection
      ? this.exports.flattener_addConnection(flattenerPtr, p1VarId, p2VarId, isFlow ? 1 : 0, isBoundary ? 1 : 0)
      : 0;
  }
  /** Finalizes connection graphs and synthesizes zero-sum flow equations. */
  flattenerFinalizeConnections(flattenerPtr) {
    return this.exports.flattener_finalizeConnections ? this.exports.flattener_finalizeConnections(flattenerPtr) : 0;
  }
  /** Creates a modification environment in WASM linear memory. */
  flattenerCreateEnv(parentPtr = 0) {
    return this.exports.flattener_createEnv ? this.exports.flattener_createEnv(parentPtr) : 0;
  }
  /** Binds a parameter override into the modification environment. */
  flattenerEnvBind(envPtr, keyHash, valExprId, isFinal = false, isEach = false) {
    if (this.exports.flattener_envBind) {
      this.exports.flattener_envBind(envPtr, keyHash, valExprId, isFinal ? 1 : 0, isEach ? 1 : 0);
    }
  }
  /** Looks up a parameter override in the modification environment. */
  flattenerEnvLookup(envPtr, keyHash) {
    return this.exports.flattener_envLookup ? this.exports.flattener_envLookup(envPtr, keyHash) >>> 0 : 0xffffffff;
  }
  /** Executes a named in-DSL compilation pipeline (e.g. 'flatten') in WebAssembly. */
  runPipeline(pipelineName, rootNode = 0) {
    const fnName = `runPipeline_${pipelineName}`;
    if (this.exports[fnName]) {
      return this.exports[fnName](rootNode);
    }
    return 0;
  }
  /** Evaluates built-in trigonometric and elementary functions in WASM. */
  mathSin(x) {
    return this.exports.math_sin ? this.exports.math_sin(x) : Math.sin(x);
  }
  mathCos(x) {
    return this.exports.math_cos ? this.exports.math_cos(x) : Math.cos(x);
  }
  mathTan(x) {
    return this.exports.math_tan ? this.exports.math_tan(x) : Math.tan(x);
  }
  mathSqrt(x) {
    return this.exports.math_sqrt ? this.exports.math_sqrt(x) : Math.sqrt(x);
  }
  mathExp(x) {
    return this.exports.math_exp ? this.exports.math_exp(x) : Math.exp(x);
  }
  mathLog(x) {
    return this.exports.math_log ? this.exports.math_log(x) : Math.log(x);
  }
  /** Evaluates CSG sphere Signed Distance Function in WASM. */
  csgSdfSphere(px, py, pz, r) {
    return this.exports.csg_sdf_sphere ? this.exports.csg_sdf_sphere(px, py, pz, r) : 0;
  }
  /** Evaluates CSG box Signed Distance Function in WASM. */
  csgSdfBox(px, py, pz, hx, hy, hz) {
    return this.exports.csg_sdf_box ? this.exports.csg_sdf_box(px, py, pz, hx, hy, hz) : 0;
  }
  /** CSG Boolean Operations. */
  csgOpUnion(d1, d2) {
    return this.exports.csg_op_union ? this.exports.csg_op_union(d1, d2) : Math.min(d1, d2);
  }
  csgOpIntersect(d1, d2) {
    return this.exports.csg_op_intersect ? this.exports.csg_op_intersect(d1, d2) : Math.max(d1, d2);
  }
  csgOpDifference(d1, d2) {
    return this.exports.csg_op_difference ? this.exports.csg_op_difference(d1, d2) : Math.max(d1, -d2);
  }
  /** Simplifies an algebraic expression using CAS rewrite rules and constant folding in WASM. */
  casSimplify(daePtr, exprId) {
    return this.exports.cas_export_simplify ? this.exports.cas_export_simplify(daePtr, exprId) : exprId;
  }
  /** Computes the exact symbolic derivative d(expr) / d(varId) in WASM. */
  casDifferentiate(daePtr, exprId, targetVarId) {
    return this.exports.cas_export_differentiate
      ? this.exports.cas_export_differentiate(daePtr, exprId, targetVarId)
      : 0;
  }
  /** Creates an Automatic Differentiation Tape instance in WASM. */
  createAdTape() {
    return this.exports.tape_create ? this.exports.tape_create() : 0;
  }
  /** Pushes an elementary operation node to the AD tape. */
  tapePushOp(tapePtr, op, left, right, val) {
    return this.exports.tape_pushOp ? this.exports.tape_pushOp(tapePtr, op, left, right, val) : 0;
  }
  /** Runs the reverse-mode AD pass backwards from rootNode. */
  tapeBackward(tapePtr, rootNode) {
    if (this.exports.tape_backward) {
      this.exports.tape_backward(tapePtr, rootNode);
    }
  }
  /** Retrieves the accumulated gradient for a node on the AD tape. */
  tapeGetGrad(tapePtr, nodeIdx) {
    return this.exports.tape_getGrad ? this.exports.tape_getGrad(tapePtr, nodeIdx) : 0;
  }
  /** Resets the AD tape for the next evaluation pass. */
  tapeReset(tapePtr) {
    if (this.exports.tape_reset) {
      this.exports.tape_reset(tapePtr);
    }
  }
  /** Creates a fast snapshot checkpoint of the arena allocation state. */
  createArenaSnapshot() {
    return this.exports.arena_createSnapshot ? this.exports.arena_createSnapshot() : 0;
  }
  /** Restores the arena allocation state to a previous snapshot checkpoint. */
  restoreArenaSnapshot(snapshotPtr) {
    if (this.exports.arena_restoreSnapshot) {
      this.exports.arena_restoreSnapshot(snapshotPtr);
    }
  }
  /** Formats/unparses the document AST using zero-GC AssemblyScript formatting rules. */
  formatDocument(astRoot, preserveFormatting = false) {
    if (!this.exports.lsp_formatDocument || !this.exports.lsp_getBinaryBuffer) return "";
    const numBytes = this.exports.lsp_formatDocument(astRoot, preserveFormatting ? 1 : 0);
    if (numBytes === 0) return "";
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    const bytes = new Uint8Array(numBytes);
    bytes.set(new Uint8Array(this.wasmMemory.buffer, dirPtr, numBytes));
    const encoding = this.getInputEncoding();
    if (encoding === 1) {
      return new TextDecoder("utf-16le").decode(bytes);
    }
    return new TextDecoder("utf-8").decode(bytes);
  }
  /** Reads a WASM-allocated length-prefixed UTF-16 string into a JavaScript string. */
  readWasmString(ptr) {
    if (ptr === 0) return "";
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const lenBytes = mem32[(ptr - 4) >>> 2] || 0;
    const lenChars = lenBytes >>> 1;
    if (lenChars <= 0) return "";
    const u8 = new Uint8Array(lenBytes);
    u8.set(new Uint8Array(this.wasmMemory.buffer, ptr, lenBytes));
    if (typeof TextDecoder !== "undefined") {
      return new TextDecoder("utf-16le").decode(u8);
    }
    const u16 = new Uint16Array(u8.buffer);
    return String.fromCharCode.apply(null, Array.from(u16));
  }
  /** Retrieves available compiler pipelines that can be executed. */
  getPipelines() {
    if (!this.exports.lsp_getPipelinesInfo || !this.exports.lsp_getBinaryBuffer) return [];
    const numElements = this.exports.lsp_getPipelinesInfo();
    if (numElements === 0) return [];
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    const pipelines = [];
    for (let i = 0; i < numElements * 3; i += 3) {
      const idPtr = mem32[(dirPtr >> 2) + i];
      const labelPtr = mem32[(dirPtr >> 2) + i + 1];
      const targetPtr = mem32[(dirPtr >> 2) + i + 2];
      pipelines.push({
        id: this.readWasmString(idPtr),
        label: this.readWasmString(labelPtr),
        target: this.readWasmString(targetPtr),
      });
    }
    return pipelines;
  }
  /** Executes a specific compiler pipeline by its ID. */
  executePipeline(astRoot, pipelineId) {
    const fnName = `runPipeline_${pipelineId}`;
    if (this.exports[fnName]) {
      this.exports[fnName](astRoot);
    } else if (this.exports.lsp_executePipeline) {
      let hash = 5381;
      for (let i = 0; i < pipelineId.length; i++) {
        hash = (hash << 5) + hash + pipelineId.charCodeAt(i);
      }
      this.exports.lsp_executePipeline(astRoot, hash >>> 0);
    }
    const daePtr = this.exports.graph_getDaeBuilder ? this.exports.graph_getDaeBuilder() : 0;
    if (daePtr === 0 || !this.exports.dae_getVarCount) {
      return {
        pipelineId,
        variables: [],
        equations: [],
        connections: [],
        bltBlocks: [],
        flatText: "// Pipeline executed without DAE output",
        varCount: 0,
        eqCount: 0,
        paramCount: 0,
      };
    }
    const numVars = this.exports.dae_getVarCount(daePtr);
    const numEqs = this.exports.dae_getEqCount ? this.exports.dae_getEqCount(daePtr) : 0;
    const varTypeNames = ["Real", "Integer", "Boolean", "String", "Enumeration", "Clock"];
    const variabilityNames = ["continuous", "discrete", "parameter", "constant"];
    const causalityNames = ["local", "input", "output"];
    const variables = [];
    for (let i = 0; i < numVars; i++) {
      const nameId = this.exports.dae_getVarNameId ? this.exports.dae_getVarNameId(daePtr, i) : 0;
      const name = this.getStringFromPool(nameId) || `v_${i}`;
      const typeIdx = this.exports.dae_getVarType ? this.exports.dae_getVarType(daePtr, i) : 0;
      const varType = varTypeNames[typeIdx] || "Real";
      const varIdx = this.exports.dae_getVarVariability ? this.exports.dae_getVarVariability(daePtr, i) : 0;
      const variability = variabilityNames[varIdx] || "continuous";
      const causIdx = this.exports.dae_getVarCausality ? this.exports.dae_getVarCausality(daePtr, i) : 0;
      const causality = causalityNames[causIdx] || "local";
      const flags = this.exports.dae_getVarFlags ? this.exports.dae_getVarFlags(daePtr, i) : 0;
      const isFlow = (flags & (1 << 1)) !== 0;
      const startVal = this.exports.dae_getVarStartValue ? this.exports.dae_getVarStartValue(daePtr, i) : 0;
      // Read array shape dimensions
      const dimensions = [];
      if (this.exports.dae_getVarShapeDim) {
        for (let d = 0; d < 4; d++) {
          const dimSize = this.exports.dae_getVarShapeDim(daePtr, i, d);
          if (dimSize > 0) {
            dimensions.push(dimSize);
          } else {
            break;
          }
        }
      }
      variables.push({
        name,
        type: varType,
        variability,
        causality,
        isFlow,
        dimensions,
        start: startVal !== 0 ? startVal : null,
      });
    }
    const decompileExpr = (exprId) => {
      if (exprId === 0xffffffff || exprId < 0 || !this.exports.dae_getExprKind) return "";
      const kind = this.exports.dae_getExprKind(daePtr, exprId);
      const data1 = this.exports.dae_getExprData1 ? this.exports.dae_getExprData1(daePtr, exprId) : 0;
      const left = this.exports.dae_getExprLeft ? this.exports.dae_getExprLeft(daePtr, exprId) : 0xffffffff;
      const right = this.exports.dae_getExprRight ? this.exports.dae_getExprRight(daePtr, exprId) : 0xffffffff;
      switch (kind) {
        case 0: {
          return this.getStringFromPool(data1) || `var_${data1}`;
        }
        case 1:
          return String(data1 | 0);
        case 2: {
          const bits = (BigInt(left >>> 0) << 32n) | BigInt(data1 >>> 0);
          const buf = new ArrayBuffer(8);
          new BigUint64Array(buf)[0] = bits;
          const floatVal = new Float64Array(buf)[0];
          return String(floatVal);
        }
        case 5: {
          const binOps = [" + ", " - ", " * ", " / ", " ^ "];
          const op = binOps[data1] || " + ";
          return `${decompileExpr(left)}${op}${decompileExpr(right)}`;
        }
        case 12:
          return `der(${decompileExpr(left)})`;
        case 14:
          return `-${decompileExpr(left)}`;
        default:
          return `expr_${exprId}`;
      }
    };
    const equations = [];
    for (let i = 0; i < numEqs; i++) {
      const eqKind = this.exports.dae_getEqKind ? this.exports.dae_getEqKind(daePtr, i) : 0;
      const lhs = this.exports.dae_getEqLhs ? this.exports.dae_getEqLhs(daePtr, i) : 0;
      const rhs = this.exports.dae_getEqRhs ? this.exports.dae_getEqRhs(daePtr, i) : 0;
      const lhsStr = decompileExpr(lhs);
      const rhsStr = decompileExpr(rhs);
      const eqText = eqKind === 6 ? `connect(${lhsStr}, ${rhsStr})` : rhsStr ? `${lhsStr} = ${rhsStr}` : lhsStr;
      const kindStr = eqKind === 6 ? "connect" : eqKind === 7 ? "initial" : "simple";
      equations.push({
        kind: kindStr,
        text: eqText,
        lhs: lhsStr,
        rhs: rhsStr,
      });
    }
    const bltBlocks = [];
    for (let i = 0; i < equations.length; i++) {
      const eq = equations[i];
      const lhs = eq.text.split("=")[0].trim();
      bltBlocks.push({
        id: i + 1,
        type: eq.kind === "connect" ? "linear" : "scalar",
        size: 1,
        solvedVars: [lhs],
        equations: [eq.text],
      });
    }
    const continuousVars = variables.filter((v) => v.variability !== "parameter" && v.variability !== "constant");
    const paramVars = variables.filter((v) => v.variability === "parameter" || v.variability === "constant");
    const flatLines = [];
    flatLines.push("model FlattenedModel");
    if (continuousVars.length > 0) {
      flatLines.push("  // --- Continuous & Discrete Unknowns ---");
      for (const v of continuousVars) {
        const prefix = v.isFlow ? "flow " : "";
        const startStr = v.start !== null ? ` (start = ${v.start})` : "";
        const dimStr = v.dimensions && v.dimensions.length > 0 ? `[${v.dimensions.join(", ")}]` : "";
        flatLines.push(`  ${prefix}${v.type} ${v.name}${dimStr}${startStr};`);
      }
    }
    if (paramVars.length > 0) {
      flatLines.push("");
      flatLines.push("  // --- Parameters & Constants ---");
      for (const p of paramVars) {
        const startStr = p.start !== null ? ` = ${p.start}` : "";
        const dimStr = p.dimensions && p.dimensions.length > 0 ? `[${p.dimensions.join(", ")}]` : "";
        flatLines.push(`  ${p.variability} ${p.type} ${p.name}${dimStr}${startStr};`);
      }
    }
    if (equations.length > 0) {
      flatLines.push("");
      flatLines.push("equation");
      for (const eq of equations) {
        flatLines.push(`  ${eq.text};`);
      }
    }
    flatLines.push("end FlattenedModel;");
    const flatText = flatLines.join("\n");
    const clockCount = this.exports.dae_getClockCount ? this.exports.dae_getClockCount(daePtr) : 0;
    const smCount = this.exports.dae_getStateMachineCount ? this.exports.dae_getStateMachineCount(daePtr) : 0;
    const eventIndicatorCount = this.exports.dae_getEventIndicatorCount
      ? this.exports.dae_getEventIndicatorCount(daePtr)
      : 0;
    return {
      pipelineId,
      variables,
      equations,
      connections: [],
      bltBlocks,
      flatText,
      varCount: continuousVars.length,
      eqCount: equations.length,
      paramCount: paramVars.length,
      clockCount,
      stateMachineCount: smCount,
      eventIndicatorCount,
    };
  }
  _lastDiagBinaryLength = 0;
  /**
   * Read error ranges from the already-populated binary buffer without
   * calling lsp_getDiagnostics again. Only valid after getDiagnostics().
   */
  readCachedErrorRanges() {
    const errorRanges = [];
    if (!this.exports.lsp_getBinaryBuffer || this._lastDiagBinaryLength === 0) return errorRanges;
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const dirPtr = this.exports.lsp_getBinaryBuffer();
    for (let i = 0; i < this._lastDiagBinaryLength; i += 7) {
      errorRanges.push({
        start: mem32[(dirPtr >> 2) + i],
        end: mem32[(dirPtr >> 2) + i + 1],
      });
    }
    return errorRanges;
  }
  /**
   * Traverses the AST and returns a string representation in Lisp-like S-Expressions.
   * Useful for debugging syntax trees and writing test expectations.
   */
  getAstSExpr(astRoot, verbose = false) {
    if (!astRoot) return "";
    const lineStarts = this.getLineStarts();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    // Reuse cached error ranges from the last getDiagnostics() call
    // instead of calling lsp_getDiagnostics again (avoids triple traversal)
    const errorRanges = this.readCachedErrorRanges();
    const printedErrors = new Set();
    const toSExpr = (ptr, currentOffset, depth) => {
      if (depth > 100) return { strs: ["(...)"], nextOffset: currentOffset };
      if (!ptr) return { strs: [], nextOffset: currentOffset };
      const typeFlags = mem32[ptr / 4];
      const typeId = typeFlags & 0x03ff;
      let typeName = (this.syntaxNames && this.syntaxNames[typeId]) || `node_${typeId}`;
      if (typeName.startsWith("T_")) typeName = typeName.substring(2);
      const envHashPadding = mem32[(ptr + 4) / 4];
      const rawPad = typeFlags >>> 22;
      const isFat = (envHashPadding >>> 23) & 1;
      const pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
      const len = envHashPadding & 0x007fffff;
      const startOffset = currentOffset + pad;
      const endOffset = startOffset + len;
      const startPos = this.offsetToPos(startOffset, lineStarts);
      const endPos = this.offsetToPos(endOffset, lineStarts);
      const posStr = `[${startPos.line}, ${startPos.character}] - [${endPos.line}, ${endPos.character}]`;
      const indent = "  ".repeat(depth);
      const isInvisible = (typeFlags & (1 << 14)) !== 0;
      const shouldPrint =
        verbose ||
        (!typeName.startsWith("_") && !typeName.startsWith('"') && !typeName.startsWith("node_") && !isInvisible);
      let childStrs = [];
      let childOffset = startOffset;
      let childPtr = mem32[(ptr + 12) / 4];
      let slowPtr = childPtr;
      let step = 0;
      while (childPtr) {
        if (step !== 0 && childPtr === slowPtr) {
          childStrs.push("(CYCLE)");
          break;
        }
        const childResult = toSExpr(childPtr, childOffset, shouldPrint ? depth + 1 : depth);
        for (const s of childResult.strs) {
          if (s) childStrs.push(s);
        }
        childOffset = childResult.nextOffset;
        childPtr = mem32[(childPtr + 16) / 4];
        if (step % 2 === 1) slowPtr = mem32[(slowPtr + 16) / 4];
        step++;
      }
      if (!shouldPrint) {
        return { strs: childStrs, nextOffset: endOffset };
      }
      let flags = (typeFlags >> 10) & 0x0fff;
      let flagStr = "";
      if (flags & 256) flagStr += " (I)";
      if (flags & 128) flagStr += " (E)";
      if (flags & 16) flagStr += " (T)";
      let str = `(${typeName}${flagStr} ${posStr}`;
      if (childStrs.length > 0) {
        for (const cs of childStrs) {
          str += "\n" + indent + "  " + cs;
        }
      }
      return { strs: [str + ")"], nextOffset: endOffset };
    };
    const rootResult = toSExpr(astRoot, 0, 0);
    let str = rootResult.strs[0] || "";
    return str;
  }
  /**
   * Traverses the AST and returns an array of HTML strings representing the tree structure.
   * Used for the visual AST inspector.
   */
  getAstHtml(astRoot) {
    if (!astRoot) return [];
    const lineStarts = this.getLineStarts();
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    // Reuse cached error ranges from the last getDiagnostics() call
    const errorRanges = this.readCachedErrorRanges();
    const printedErrors = new Set();
    const lines = [];
    lines.push(
      `<style>.ast-node, .ast-error { cursor: pointer; margin-top: 4px; display: block; width: fit-content; } .ast-node { color: #0969da; } .ast-error { color: #cf222e; } .ast-node:hover > .hoverable-text, .ast-error:hover > .hoverable-text { text-decoration: underline; }</style>`,
    );
    const toHtml = (ptr, currentOffset, depth) => {
      if (lines.length > 5000) {
        if (
          lines[lines.length - 1] !==
          "<div style='margin-left: 15px; color: #cf222e;'>... AST Truncated (exceeded 5000 elements) ...</div>"
        ) {
          lines.push(
            "<div style='margin-left: 15px; color: #cf222e;'>... AST Truncated (exceeded 5000 elements) ...</div>",
          );
        }
        return currentOffset;
      }
      if (depth > 100) {
        lines.push("<div style='margin-left: 15px'>...</div>");
        return currentOffset;
      }
      if (!ptr) return currentOffset;
      const typeFlags = mem32[ptr / 4];
      const typeId = typeFlags & 0x03ff;
      let typeName = (this.syntaxNames && this.syntaxNames[typeId]) || `node_${typeId}`;
      if (typeName.startsWith("T_")) typeName = typeName.substring(2);
      const envHashPadding = mem32[(ptr + 4) / 4];
      const rawPad = typeFlags >>> 22;
      const isFat = (envHashPadding >>> 23) & 1;
      const pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
      const len = envHashPadding & 0x007fffff;
      const startOffset = currentOffset + pad;
      const endOffset = startOffset + len;
      const startPos = this.offsetToPos(startOffset, lineStarts);
      const endPos = this.offsetToPos(endOffset, lineStarts);
      const posStr = `<span style="color: #6e7781;">[${startPos.line}, ${startPos.character}] - [${endPos.line}, ${endPos.character}]</span>`;
      const isInvisible = (typeFlags & (1 << 14)) !== 0;
      const shouldPrint = true; // Debug: print all nodes
      let renderedChildren = 0;
      let childOffset = startOffset;
      let childPtr = mem32[(ptr + 12) / 4];
      let slowPtr = childPtr;
      let step = 0;
      let nodeIndex = -1;
      if (shouldPrint) {
        const isGhost = len === 0 && typeName !== "ERROR";
        const nodeClass = isGhost ? "ast-node ghost-node" : "ast-node";
        nodeIndex = lines.length;
        lines.push(
          `<div class="${nodeClass}" style="margin-left: ${depth * 20}px;" onclick="window.highlightNode(${startPos.line}, ${startPos.character}, ${endPos.line}, ${endPos.character})"><span class="hoverable-text">${typeName} (pad=${pad}, len=${len}, childOffset=${childOffset}, ptr=${ptr})</span> ${posStr}</div>`,
        );
      }
      while (childPtr) {
        if (step !== 0 && childPtr === slowPtr) {
          if (shouldPrint) {
            lines.push(`<div style="margin-left: ${(depth + 1) * 20}px; color: #8c959f; margin-top: 4px;">CYCLE</div>`);
          }
          break;
        }
        childOffset = toHtml(childPtr, childOffset, shouldPrint ? depth + 1 : depth);
        renderedChildren++;
        childPtr = mem32[(childPtr + 16) / 4];
        if (step % 2 === 1) slowPtr = mem32[(slowPtr + 16) / 4];
        step++;
      }
      if (shouldPrint && nodeIndex !== -1 && len === 0 && renderedChildren === 0 && typeName !== "ERROR") {
        // Retrospectively add ghost-node class if it ended up having no children
        lines[nodeIndex] = lines[nodeIndex].replace('"ast-node"', '"ast-node ghost-node"');
      }
      return endOffset;
    };
    toHtml(astRoot, 0, 0);
    return lines;
  }
  astListeners = [];
  addAstChangeListener(listener) {
    this.astListeners.push(listener);
  }
  /**
   * Appends a child to a parent node in O(1) using a JS-side tail pointer cache.
   * Falls back to the WASM ast_appendChild if the cache misses or the export is unavailable.
   */
  appendChild(parentPtr, childPtr) {
    if (!parentPtr || !childPtr) return;
    const mem32 = new Uint32Array(this.wasmMemory.buffer);
    const lastChild = this._childTailCache.get(parentPtr);
    if (lastChild !== undefined) {
      // Wire nextSibling of the cached tail → new child
      mem32[(lastChild + 16) / 4] = childPtr;
    } else {
      // Check if parent already has a firstChild
      const firstChild = mem32[(parentPtr + 12) / 4];
      if (firstChild === 0) {
        mem32[(parentPtr + 12) / 4] = childPtr;
      } else if (this.exports.ast_appendChild) {
        // Fallback: let WASM walk the chain (cold path)
        this.exports.ast_appendChild(parentPtr, childPtr);
        this._childTailCache.set(parentPtr, childPtr);
        return;
      }
    }
    this._childTailCache.set(parentPtr, childPtr);
  }
  /**
   * Performs a full non-incremental parse of the given text buffer.
   * Used as a fallback or for initial parsing.
   */
  parse(text, editStart = 0, editOldEnd = 0, editNewEnd = 0, uri) {
    const getInputBuf = this.exports.getInputBuffer || this.exports.lsp_getInputBuffer;
    if (!this.exports.parse || !getInputBuf) return 0;
    this._cachedLineStarts = null; // Invalidate cached line starts on edit
    this._childTailCache.clear(); // Invalidate tail pointers on edit
    if (this.exports.abortSuspend) this.exports.abortSuspend();
    const lenBytes = text.length * 2;
    const textPtr = this.exports.ensureInputBuffer ? this.exports.ensureInputBuffer(lenBytes) : getInputBuf();
    const memArray16 = new Uint16Array(this.wasmMemory.buffer, textPtr, text.length);
    for (let i = 0; i < text.length; i++) {
      memArray16[i] = text.charCodeAt(i);
    }
    if (this.exports.lsp_setInputEncoding) this.exports.lsp_setInputEncoding(1);
    else if (this.exports.setInputEncoding) this.exports.setInputEncoding(1);
    if (this.exports.lsp_setInputLength) this.exports.lsp_setInputLength(lenBytes);
    else if (this.exports.setInputLength) this.exports.setInputLength(lenBytes);
    this.currentInputLength = text.length;
    const prevAstRoot = this.getDocumentRoot(uri);
    let baseRoot = prevAstRoot;
    if (editStart === 0 && editOldEnd === 0 && editNewEnd === 0) {
      editNewEnd = lenBytes;
      baseRoot = 0;
    }
    const newAstRoot = this.exports.parse(baseRoot, editStart, editOldEnd, editNewEnd);
    if (this.astListeners.length > 0) {
      if (prevAstRoot !== 0) {
        for (const listener of this.astListeners) {
          this.walkAstDiff(prevAstRoot, newAstRoot, listener);
        }
      } else if (newAstRoot !== 0) {
        for (const listener of this.astListeners) {
          this.walkAstDiff(0, newAstRoot, listener);
        }
      }
    }
    this.lastAstRoot = newAstRoot;
    if (uri) this.setDocumentRoot(uri, newAstRoot);
    this.checkMemoryQuota();
    this.scheduleCompaction(false);
    return newAstRoot;
  }
  /**
   * Compares two ASTs generated before and after an edit, and emits
   * a minimal sequence of insertion, deletion, and update events.
   *
   * This bridges the gap between tree-sitter's internal incremental parsing state
   * and higher-level tooling (like the LSP reasoner) that needs to know exactly
   * what semantic nodes changed.
   */
  walkAstDiff(oldRoot, newRoot, listener) {
    console.log(`[Bindings] walkAstDiff START: oldRoot=${oldRoot}, newRoot=${newRoot}`);
    let mem32 = new Uint32Array(this.wasmMemory.buffer);
    const getMem32 = () => {
      if (mem32.buffer !== this.wasmMemory.buffer || mem32.byteLength === 0) {
        mem32 = new Uint32Array(this.wasmMemory.buffer);
      }
      return mem32;
    };
    let opsCount = 0;
    const MAX_DIFF_OPS = 50000;
    const fieldIdToName = [];
    for (const [name, id] of Object.entries(FIELD_NAMES)) {
      fieldIdToName[id] = name;
    }
    const getChildren = (ptr) => {
      const mem32 = getMem32();
      const children = [];
      const firstChild = mem32[(ptr + 12) / 4];
      let curr = firstChild;
      const typeFlags = mem32[ptr / 4];
      const parentTypeId = typeFlags & 0x03ff;
      let childIndex = 0;
      let slow = curr;
      let step = 0;
      while (curr !== 0 && childIndex < 5000) {
        if (opsCount >= MAX_DIFF_OPS) break;
        opsCount++;
        let fieldId = -1;
        if (this.exports.getFieldIdForChild) {
          try {
            const currType = mem32[curr / 4] & 0x03ff;
            fieldId = this.exports.getFieldIdForChild(parentTypeId, childIndex, currType);
          } catch {
            fieldId = -1;
          }
        }
        const field = fieldId >= 0 ? fieldIdToName[fieldId] : null;
        children.push({ ptr: curr, field });
        curr = getMem32()[(curr + 16) / 4];
        if (step % 2 === 1) slow = getMem32()[(slow + 16) / 4];
        if (step > 0 && slow === curr) break;
        step++;
        childIndex++;
      }
      return children;
    };
    const getFlattenedChildren = (startPtr) => {
      if (!startPtr) return [];
      const children = [];
      let currentAccumulatedPad = 0;
      const stack = [];
      let nodePtr = startPtr;
      let parentField = null;
      let childPtr = getMem32()[(nodePtr + 12) / 4];
      let childIndex = 0;
      let step = 0;
      let slowPtr = childPtr;
      while (true) {
        if (childPtr !== 0) {
          if (step > 0 && slowPtr === childPtr) {
            childPtr = 0;
            continue;
          }
          const mem32 = getMem32();
          const cTypeFlags = mem32[childPtr / 4];
          const typeId = cTypeFlags & 0x03ff;
          let typeName = (this.syntaxNames && this.syntaxNames[typeId]) || `node_${typeId}`;
          const isInvisible = (cTypeFlags & (1 << 14)) !== 0 || typeName.startsWith("_");
          const parentTypeId = mem32[nodePtr / 4] & 0x03ff;
          let fieldId = -1;
          if (this.exports.getFieldIdForChild) {
            try {
              fieldId = this.exports.getFieldIdForChild(parentTypeId, childIndex, typeId);
            } catch {
              fieldId = -1;
            }
          }
          const field = fieldId >= 0 ? fieldIdToName[fieldId] : isInvisible ? parentField : null;
          const childEnvHashPadding = mem32[(childPtr + 4) / 4];
          const childRawPad = cTypeFlags >>> 22;
          const childIsFat = (childEnvHashPadding >>> 23) & 1;
          const childPad =
            childIsFat && this.exports.getFatPaddingPtr
              ? mem32[this.exports.getFatPaddingPtr(childRawPad) / 4]
              : childRawPad;
          const childLen = childEnvHashPadding & 0x007fffff;
          const hasChildren = mem32[(childPtr + 12) / 4] !== 0;
          if (isInvisible) {
            if (hasChildren) {
              currentAccumulatedPad += childPad;
              stack.push({
                nodePtr,
                parentField,
                childPtr: mem32[(childPtr + 16) / 4],
                childIndex: childIndex + 1,
                step: step + 1,
                slowPtr: step % 2 === 1 ? mem32[(slowPtr + 16) / 4] : slowPtr,
              });
              nodePtr = childPtr;
              parentField = field;
              childPtr = mem32[(nodePtr + 12) / 4];
              childIndex = 0;
              step = 0;
              slowPtr = childPtr;
              continue;
            } else {
              currentAccumulatedPad += childPad + childLen;
            }
          } else {
            children.push({ ptr: childPtr, field, fieldId, invisiblePad: currentAccumulatedPad });
            currentAccumulatedPad = 0;
          }
          childPtr = mem32[(childPtr + 16) / 4];
          if (step % 2 === 1) slowPtr = mem32[(slowPtr + 16) / 4];
          step++;
          childIndex++;
        } else {
          if (stack.length === 0) break;
          const state = stack.pop();
          nodePtr = state.nodePtr;
          parentField = state.parentField;
          childPtr = state.childPtr;
          childIndex = state.childIndex;
          step = state.step;
          slowPtr = state.slowPtr;
        }
      }
      return children;
    };
    const buildInsertions = (startPtr, initialInvisiblePad = 0) => {
      if (!startPtr) return;
      const stack = [{ ptr: startPtr, invisiblePad: initialInvisiblePad }];
      while (stack.length > 0) {
        if (opsCount >= MAX_DIFF_OPS) throw new Error("MAX_DIFF_OPS");
        opsCount++;
        const item = stack.pop();
        const ptr = item.ptr;
        if (!ptr) continue;
        const mem32 = getMem32();
        const typeFlags = mem32[ptr / 4];
        const typeId = typeFlags & 0x03ff;
        let typeName = (this.syntaxNames && this.syntaxNames[typeId]) || `node_${typeId}`;
        if (typeName.startsWith("T_")) typeName = typeName.substring(2);
        const envHashPadding = mem32[(ptr + 4) / 4];
        const rawPad = typeFlags >>> 22;
        const isFat = (envHashPadding >>> 23) & 1;
        let pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
        const len = envHashPadding & 0x007fffff;
        const children = getFlattenedChildren(ptr);
        pad += item.invisiblePad;
        const flags = (typeFlags >> 10) & 0x0fff;
        listener.onNodeInserted(ptr, typeId, typeName, pad, len, flags, children);
        // Push children in reverse so they are processed in forward order
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push({ ptr: children[i].ptr, invisiblePad: children[i].invisiblePad });
        }
      }
    };
    const buildDeletions = (startPtr) => {
      if (!startPtr) return;
      const stack = [startPtr];
      while (stack.length > 0) {
        if (opsCount >= MAX_DIFF_OPS) throw new Error("MAX_DIFF_OPS");
        opsCount++;
        const ptr = stack.pop();
        if (!ptr) continue;
        listener.onNodeDeleted(ptr);
        const children = getChildren(ptr);
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push(children[i].ptr);
        }
      }
    };
    const diffNodes = (oldPtr, newPtr, oldInvisiblePad = 0, newInvisiblePad = 0) => {
      if (opsCount >= MAX_DIFF_OPS) throw new Error("MAX_DIFF_OPS");
      if (oldPtr === newPtr && oldInvisiblePad === newInvisiblePad) {
        if (oldPtr !== oldRoot) {
          const mem32r = getMem32();
          const retFlags = (mem32r[newPtr / 4] >> 10) & 0x0fff;
          listener.onNodeRetained(newPtr, retFlags);
          return;
        }
      }
      if (oldPtr === newPtr && oldInvisiblePad !== newInvisiblePad) {
        const mem32 = getMem32();
        const newTypeFlags = mem32[newPtr / 4];
        const newTypeId = newTypeFlags & 0x03ff;
        let typeName = (this.syntaxNames && this.syntaxNames[newTypeId]) || `node_${newTypeId}`;
        if (typeName.startsWith("T_")) typeName = typeName.substring(2);
        const envHashPadding = mem32[(newPtr + 4) / 4];
        const rawPad = newTypeFlags >>> 22;
        const isFat = (envHashPadding >>> 23) & 1;
        let pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
        const len = envHashPadding & 0x007fffff;
        const flags = (newTypeFlags >> 10) & 0x0fff;
        const newCh = getFlattenedChildren(newPtr);
        pad += newInvisiblePad;
        listener.onNodeUpdated(newPtr, oldPtr, newTypeId, typeName, pad, len, flags, newCh);
        opsCount++;
        return;
      }
      if (!oldPtr) {
        buildInsertions(newPtr, newInvisiblePad);
        return;
      }
      if (!newPtr) {
        buildDeletions(oldPtr);
        return;
      }
      const mem32 = getMem32();
      const oldTypeId = mem32[oldPtr / 4] & 0x03ff;
      const newTypeId = mem32[newPtr / 4] & 0x03ff;
      if (oldTypeId !== newTypeId) {
        buildDeletions(oldPtr);
        buildInsertions(newPtr, newInvisiblePad);
        return;
      }
      const newTypeFlags = mem32[newPtr / 4];
      let typeName = (this.syntaxNames && this.syntaxNames[newTypeId]) || `node_${newTypeId}`;
      if (typeName.startsWith("T_")) typeName = typeName.substring(2);
      const envHashPadding = mem32[(newPtr + 4) / 4];
      const rawPad = newTypeFlags >>> 22;
      const isFat = (envHashPadding >>> 23) & 1;
      let pad = isFat && this.exports.getFatPaddingPtr ? mem32[this.exports.getFatPaddingPtr(rawPad) / 4] : rawPad;
      const len = envHashPadding & 0x007fffff;
      const oldCh = getFlattenedChildren(oldPtr);
      const newCh = getFlattenedChildren(newPtr);
      pad += newInvisiblePad;
      const flags = (newTypeFlags >> 10) & 0x0fff;
      listener.onNodeUpdated(newPtr, oldPtr, newTypeId, typeName, pad, len, flags, newCh);
      opsCount++;
      let start = 0;
      while (start < oldCh.length && start < newCh.length && oldCh[start].ptr === newCh[start].ptr) {
        if (oldCh[start].invisiblePad !== newCh[start].invisiblePad) break;
        const mem32s = getMem32();
        const sFlags = (mem32s[newCh[start].ptr / 4] >> 10) & 0x0fff;
        listener.onNodeRetained(newCh[start].ptr, sFlags);
        start++;
      }
      let oldEnd = oldCh.length - 1;
      let newEnd = newCh.length - 1;
      while (oldEnd >= start && newEnd >= start && oldCh[oldEnd].ptr === newCh[newEnd].ptr) {
        if (oldCh[oldEnd].invisiblePad !== newCh[newEnd].invisiblePad) break;
        oldEnd--;
        newEnd--;
      }
      const maxMiddle = Math.max(oldEnd - start + 1, newEnd - start + 1);
      if (maxMiddle === 1 && oldEnd - start + 1 === 1 && newEnd - start + 1 === 1) {
        const oPtr = oldCh[start].ptr;
        const nPtr = newCh[start].ptr;
        const oPad = oldCh[start].invisiblePad;
        const nPad = newCh[start].invisiblePad;
        if (oPtr && nPtr) diffNodes(oPtr, nPtr, oPad, nPad);
        else if (nPtr) buildInsertions(nPtr, nPad);
        else if (oPtr) buildDeletions(oPtr);
      } else {
        for (let i = start; i <= oldEnd; i++) {
          if (oldCh[i].ptr) buildDeletions(oldCh[i].ptr);
        }
        for (let i = start; i <= newEnd; i++) {
          if (newCh[i].ptr) buildInsertions(newCh[i].ptr, newCh[i].invisiblePad);
        }
      }
      for (let i = newEnd + 1; i < newCh.length; i++) {
        const mem32e = getMem32();
        const eFlags = (mem32e[newCh[i].ptr / 4] >> 10) & 0x0fff;
        listener.onNodeRetained(newCh[i].ptr, eFlags);
      }
    };
    if (!oldRoot && listener.onFullReset) {
      listener.onFullReset(newRoot);
    }
    try {
      if (oldRoot) {
        diffNodes(oldRoot, newRoot);
      } else {
        buildInsertions(newRoot);
      }
    } catch (e) {
      console.warn("AST diff fallback due to:", e?.message || e);
      if (listener.onFullReset) {
        listener.onFullReset(newRoot);
      } else if (oldRoot) {
        listener.onNodeDeleted(oldRoot);
      }
      if (newRoot) {
        opsCount = 0;
        try {
          buildInsertions(newRoot);
        } catch {
          // Suppress fallback bounds
        }
      }
    }
    console.log(`[Bindings] walkAstDiff COMPLETE: oldRoot=${oldRoot}, newRoot=${newRoot}, total opsCount=${opsCount}`);
  }
}
/**
 * A Tree-sitter compatible facade for a ModelScript AST Node.
 * Supports zero-copy traversal, field queries, positional lookups,
 * and standard Tree-sitter inspection methods.
 */
export class SyntaxNode {
  tree;
  ptr;
  _startOffset;
  parent;
  _cachedPad;
  _cachedLen;
  _cachedTypeId;
  constructor(tree, ptr, _startOffset, parent, _cachedPad, _cachedLen, _cachedTypeId) {
    this.tree = tree;
    this.ptr = ptr;
    this._startOffset = _startOffset;
    this.parent = parent;
    this._cachedPad = _cachedPad;
    this._cachedLen = _cachedLen;
    this._cachedTypeId = _cachedTypeId;
  }
  /** Unique integer ID for this node (pointer address). */
  get id() {
    return this.ptr;
  }
  /** Gets the semantic type name of this node (e.g., 'ModelicaClassDefinition'). */
  get type() {
    if (this._cachedTypeId === 0) return "ERROR";
    let name =
      (this.tree.facade?.syntaxNames && this.tree.facade.syntaxNames[this._cachedTypeId]) ||
      (SYNTAX_NAMES && SYNTAX_NAMES[this._cachedTypeId]) ||
      `node_${this._cachedTypeId}`;
    if (name.startsWith("T_")) name = name.substring(2);
    return name;
  }
  /** Numeric type identifier for this node. */
  get typeId() {
    return this._cachedTypeId;
  }
  /** Grammar type identifier matching typeId. */
  get grammarId() {
    return this._cachedTypeId;
  }
  /** Semantic grammar type name. */
  get grammarType() {
    return this.type;
  }
  /** Extracts the substring from the original source code corresponding to this node. */
  get text() {
    if (!this.tree.sourceCode) return "";
    return this.tree.sourceCode.substring(this.startIndex, this.endIndex);
  }
  /** The start character index of the node (UTF-16). */
  get startIndex() {
    return (this._startOffset + this._cachedPad) / 2;
  }
  /** The end character index of the node (UTF-16). */
  get endIndex() {
    return (this._startOffset + this._cachedPad + this._cachedLen) / 2;
  }
  /** The start byte index of the node (character offset matching Tree-sitter JS). */
  get startByte() {
    return (this._startOffset + this._cachedPad) / 2;
  }
  /** The end byte index of the node (character offset matching Tree-sitter JS). */
  get endByte() {
    return (this._startOffset + this._cachedPad + this._cachedLen) / 2;
  }
  /**
   * Returns true if this node was inserted by the parser to recover from a syntax error.
   */
  isMissing() {
    if (this.ptr === 0) return false;
    const typeFlags = this.tree.mem32[this.ptr / 4];
    const flags = (typeFlags >>> 10) & 0x0fff;
    return (flags & 256) !== 0;
  }
  /** Returns true if this node is an extra token (comment/whitespace). */
  isExtra() {
    return false;
  }
  /** Returns true if this node has been edited. */
  hasChanges() {
    return false;
  }
  /** The line and column where this node starts. */
  get startPosition() {
    return this.tree.offsetToPoint(this.startIndex * 2);
  }
  /** The line and column where this node ends. */
  get endPosition() {
    return this.tree.offsetToPoint(this.endIndex * 2);
  }
  /**
   * Returns a list of all visible child nodes by walking the WASM sibling linked list.
   * Recursively flattens invisible nodes (e.g., anonymous sequences) into their parents.
   */
  get children() {
    const mem32 = this.tree.mem32;
    const kids = [];
    const stack = [];
    let currentChildPtr = mem32[(this.ptr + 12) / 4];
    let currentOffset = this._startOffset + this._cachedPad;
    while (true) {
      if (currentChildPtr !== 0) {
        const typeFlags = mem32[currentChildPtr / 4];
        const typeId = typeFlags & 0x03ff;
        const name =
          (this.tree.facade?.syntaxNames && this.tree.facade.syntaxNames[typeId]) ||
          (SYNTAX_NAMES && SYNTAX_NAMES[typeId]) ||
          `node_${typeId}`;
        const envHashPadding = mem32[(currentChildPtr + 4) / 4];
        const rawPad = typeFlags >>> 22;
        const isFat = (envHashPadding >>> 23) & 1;
        const pad =
          isFat && this.tree.facade.exports.getFatPaddingPtr
            ? mem32[this.tree.facade.exports.getFatPaddingPtr(rawPad) / 4]
            : rawPad;
        const len = envHashPadding & 0x007fffff;
        const isInvisible = (typeFlags & (1 << 14)) !== 0;
        const nextChildPtr = mem32[(currentChildPtr + 16) / 4];
        const nextOffset = currentOffset + pad + len;
        if (name.startsWith("_") || isInvisible) {
          stack.push({ nextChildPtr, nextOffset });
          currentChildPtr = mem32[(currentChildPtr + 12) / 4];
          currentOffset = currentOffset + pad;
          continue;
        } else {
          kids.push(new SyntaxNode(this.tree, currentChildPtr, currentOffset, this, pad, len, typeId));
        }
        currentOffset = nextOffset;
        currentChildPtr = nextChildPtr;
      } else {
        if (stack.length === 0) break;
        const state = stack.pop();
        currentChildPtr = state.nextChildPtr;
        currentOffset = state.nextOffset;
      }
    }
    return kids;
  }
  /** Gets all named children (excluding anonymous tokens and punctuation). */
  get namedChildren() {
    return this.children.filter((k) => k.isNamed());
  }
  /** Gets the number of children the node has. */
  get childCount() {
    return this.children.length;
  }
  /** Gets the number of named children the node has. */
  get namedChildCount() {
    return this.namedChildren.length;
  }
  /** Gets the first child of the node. */
  get firstChild() {
    const kids = this.children;
    return kids.length > 0 ? kids[0] : null;
  }
  /** Gets the last child of the node. */
  get lastChild() {
    const kids = this.children;
    return kids.length > 0 ? kids[kids.length - 1] : null;
  }
  /** Gets the first named child of the node. */
  get firstNamedChild() {
    const named = this.namedChildren;
    return named.length > 0 ? named[0] : null;
  }
  /** Gets the last named child of the node. */
  get lastNamedChild() {
    const named = this.namedChildren;
    return named.length > 0 ? named[named.length - 1] : null;
  }
  /** Gets the next sibling of the node. */
  get nextSibling() {
    if (!this.parent) return null;
    const siblings = this.parent.children;
    const idx = siblings.findIndex((s) => s.ptr === this.ptr && s.startIndex === this.startIndex);
    if (idx >= 0 && idx < siblings.length - 1) {
      return siblings[idx + 1];
    }
    return null;
  }
  /** Gets the previous sibling of the node. */
  get previousSibling() {
    if (!this.parent) return null;
    const siblings = this.parent.children;
    const idx = siblings.findIndex((s) => s.ptr === this.ptr && s.startIndex === this.startIndex);
    if (idx > 0) {
      return siblings[idx - 1];
    }
    return null;
  }
  /** Gets the next named sibling of the node. */
  get nextNamedSibling() {
    if (!this.parent) return null;
    const siblings = this.parent.namedChildren;
    const idx = siblings.findIndex((s) => s.ptr === this.ptr && s.startIndex === this.startIndex);
    if (idx >= 0 && idx < siblings.length - 1) {
      return siblings[idx + 1];
    }
    return null;
  }
  /** Gets the previous named sibling of the node. */
  get previousNamedSibling() {
    if (!this.parent) return null;
    const siblings = this.parent.namedChildren;
    const idx = siblings.findIndex((s) => s.ptr === this.ptr && s.startIndex === this.startIndex);
    if (idx > 0) {
      return siblings[idx - 1];
    }
    return null;
  }
  /** Gets the child at the specified index. */
  child(index) {
    const kids = this.children;
    if (index >= 0 && index < kids.length) return kids[index];
    return null;
  }
  /** Gets the named child at the specified index. */
  namedChild(index) {
    const named = this.namedChildren;
    if (index >= 0 && index < named.length) return named[index];
    return null;
  }
  /**
   * Helper that tests if this node or its WASM subtree contains targetPtr.
   */
  containsPtr(targetPtr) {
    if (this.ptr === targetPtr) return true;
    if (this.ptr === 0 || targetPtr === 0) return false;
    const mem32 = this.tree.mem32;
    const stack = [mem32[(this.ptr + 12) / 4]];
    while (stack.length > 0) {
      const p = stack.pop();
      if (p === 0) continue;
      if (p === targetPtr) return true;
      const sib = mem32[(p + 16) / 4];
      if (sib !== 0) stack.push(sib);
      const ch = mem32[(p + 12) / 4];
      if (ch !== 0) stack.push(ch);
    }
    return false;
  }
  /**
   * Looks up a child node by numeric field ID.
   */
  childForFieldId(fieldId) {
    if (!this.tree.facade.exports.getChildByFieldId || !this.ptr) return null;
    const childPtr = this.tree.facade.exports.getChildByFieldId(this.ptr, fieldId);
    if (!childPtr) return null;
    const kids = this.children;
    for (const kid of kids) {
      if (kid.ptr === childPtr || kid.containsPtr(childPtr)) return kid;
    }
    return null;
  }
  /**
   * Looks up a named field on this node and returns the corresponding child syntax node.
   */
  childForFieldName(name) {
    const snake = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    const camel = name.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
    const fieldId = FIELD_NAMES[name] ?? FIELD_NAMES[snake] ?? FIELD_NAMES[camel];
    if (fieldId !== undefined) {
      const node = this.childForFieldId(fieldId);
      if (node) return node;
    }
    // Fallback: match by child node type name (snake_case or camelCase) or condition alias
    for (const kid of this.children) {
      const kt = kid.type;
      if (
        kt === name ||
        kt === snake ||
        kt === camel ||
        (name === "condition" && (kt === "expression" || kt === "simple_expression"))
      ) {
        return kid;
      }
    }
    return null;
  }
  /**
   * Returns all child nodes matching the given numeric field ID (e.g. for repeated fields).
   */
  childrenForFieldId(fieldId) {
    const single = this.childForFieldId(fieldId);
    if (!single) return [];
    return [single];
  }
  /**
   * Returns all child nodes matching the given field name.
   */
  childrenForFieldName(name) {
    const snake = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    const camel = name.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
    const fieldId = FIELD_NAMES[name] ?? FIELD_NAMES[snake] ?? FIELD_NAMES[camel];
    if (fieldId !== undefined) {
      const byId = this.childrenForFieldId(fieldId);
      if (byId.length > 0) return byId;
    }
    // Fallback: match by child node type name (snake_case or camelCase)
    const matches = [];
    for (const kid of this.children) {
      const kt = kid.type;
      if (kt === name || kt === snake || kt === camel) {
        matches.push(kid);
      }
    }
    return matches;
  }
  /**
   * Returns the field name associated with a child at childIndex.
   */
  fieldNameForChild(childIndex) {
    if (childIndex < 0 || childIndex >= this.children.length) return null;
    const typeId = this._cachedTypeId;
    if (!typeId || typeId <= 0) return null;
    if (!this.tree.facade.exports.getFieldIdForChild) return null;
    try {
      const fieldId = this.tree.facade.exports.getFieldIdForChild(typeId, childIndex);
      if (fieldId <= 0) return null;
      for (const [name, id] of Object.entries(FIELD_NAMES)) {
        if (id === fieldId) return name;
      }
    } catch {
      return null;
    }
    return null;
  }
  /**
   * Returns the field name associated with a named child at namedChildIndex.
   */
  fieldNameForNamedChild(namedChildIndex) {
    if (namedChildIndex < 0 || namedChildIndex >= this.namedChildren.length) return null;
    const target = this.namedChildren[namedChildIndex];
    const rawIndex = this.children.indexOf(target);
    return rawIndex >= 0 ? this.fieldNameForChild(rawIndex) : null;
  }
  /** Extracts the source code text for a specific child field. */
  childText(name) {
    const child = this.childForFieldName(name);
    return child ? child.text : "";
  }
  /** Returns true if the node is a named (non-anonymous) node. */
  isNamed() {
    if (this._cachedTypeId === 0) return true; // ERROR nodes are named in Tree-sitter
    const t = this.type;
    return !t.startsWith('"') && !t.startsWith("/") && !t.startsWith("_");
  }
  /** Returns true if the node or any of its descendants represents a syntax error. */
  hasError() {
    if (this._cachedTypeId === 0) return true;
    if (this.ptr !== 0) {
      const typeFlags = this.tree.mem32[this.ptr / 4];
      const flags = (typeFlags >>> 10) & 0x0fff;
      if ((flags & 128) !== 0) return true; // FLAG_HAS_ERROR
    }
    for (const kid of this.children) {
      if (kid.hasError()) return true;
    }
    return false;
  }
  /** Finds the smallest syntax node covering the character range [start, end]. */
  descendantForIndex(start, end = start) {
    if (start < this.startIndex || end > this.endIndex) return null;
    for (const kid of this.children) {
      if (start >= kid.startIndex && end <= kid.endIndex) {
        return kid.descendantForIndex(start, end);
      }
    }
    return this;
  }
  /** Finds the smallest named syntax node covering the character range [start, end]. */
  namedDescendantForIndex(start, end = start) {
    const node = this.descendantForIndex(start, end);
    let curr = node;
    while (curr && !curr.isNamed()) {
      curr = curr.parent;
    }
    return curr;
  }
  /** Finds the smallest syntax node covering the given Point range. */
  descendantForPosition(start, end = start) {
    const startOffset = this.tree.pointToOffset(start);
    const endOffset = this.tree.pointToOffset(end);
    return this.descendantForIndex(startOffset, endOffset);
  }
  /** Finds the smallest named syntax node covering the given Point range. */
  namedDescendantForPosition(start, end = start) {
    const node = this.descendantForPosition(start, end);
    let curr = node;
    while (curr && !curr.isNamed()) {
      curr = curr.parent;
    }
    return curr;
  }
  /** Finds all descendants of the given type name(s). */
  descendantsOfType(types, start, end) {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    const results = [];
    const visit = (node) => {
      if (
        start &&
        (node.endPosition.row < start.row ||
          (node.endPosition.row === start.row && node.endPosition.column < start.column))
      ) {
        return;
      }
      if (
        end &&
        (node.startPosition.row > end.row ||
          (node.startPosition.row === end.row && node.startPosition.column > end.column))
      ) {
        return;
      }
      if (typeSet.has(node.type)) {
        results.push(node);
      }
      for (const kid of node.children) {
        visit(kid);
      }
    };
    visit(this);
    return results;
  }
  /** Finds the closest ancestor node (or self) matching the given type(s). */
  closest(types) {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    if (typeSet.has(this.type)) return this;
    return this.parent ? this.parent.closest(types) : null;
  }
  /** Generates the canonical S-expression string representation for this node. */
  toString() {
    if (this.isMissing()) {
      return `(MISSING ${this.type})`;
    }
    if (!this.isNamed() && this.children.length === 0) {
      return `"${this.text}"`;
    }
    if (this.children.length === 0) {
      return `(${this.type})`;
    }
    const childStrs = [];
    for (let i = 0; i < this.children.length; i++) {
      const c = this.children[i];
      const field = this.fieldNameForChild(i);
      const str = c.toString();
      childStrs.push(field ? `${field}: ${str}` : str);
    }
    return `(${this.type} ${childStrs.join(" ")})`;
  }
  /** Returns true if this node is equal to other. */
  equals(other) {
    if (!other) return false;
    return this.ptr === other.ptr && this.startIndex === other.startIndex && this.endIndex === other.endIndex;
  }
  /** Creates a stateful TreeCursor for traversing the tree starting at this node. */
  walk() {
    return new TreeCursor(this);
  }
}
/**
 * A Tree-sitter compatible stateful cursor for efficiently walking the syntax tree.
 */
export class TreeCursor {
  stack = [];
  current;
  constructor(node) {
    this.current = node;
  }
  get nodeType() {
    return this.current.type;
  }
  get nodeTypeId() {
    return this.current.typeId;
  }
  get nodeIsNamed() {
    return this.current.isNamed();
  }
  get nodeIsMissing() {
    return this.current.isMissing();
  }
  get nodeText() {
    return this.current.text;
  }
  get currentNode() {
    return this.current;
  }
  get startIndex() {
    return this.current.startIndex;
  }
  get endIndex() {
    return this.current.endIndex;
  }
  get startPosition() {
    return this.current.startPosition;
  }
  get endPosition() {
    return this.current.endPosition;
  }
  get currentFieldName() {
    if (this.stack.length === 0) return null;
    const parentFrame = this.stack[this.stack.length - 1];
    return parentFrame.node.fieldNameForChild(parentFrame.childIndex);
  }
  get currentFieldId() {
    const name = this.currentFieldName;
    return name && FIELD_NAMES[name] !== undefined ? FIELD_NAMES[name] : 0;
  }
  get currentDepth() {
    return this.stack.length;
  }
  isMissing() {
    return this.current.isMissing();
  }
  gotoFirstChild() {
    const kids = this.current.children;
    if (kids.length === 0) return false;
    this.stack.push({ node: this.current, childIndex: 0 });
    this.current = kids[0];
    return true;
  }
  gotoFirstChildForIndex(index) {
    const kids = this.current.children;
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].startIndex <= index && index < kids[i].endIndex) {
        this.stack.push({ node: this.current, childIndex: i });
        this.current = kids[i];
        return true;
      }
    }
    return false;
  }
  gotoFirstChildForPosition(position) {
    const offset = this.current.tree.pointToOffset(position);
    return this.gotoFirstChildForIndex(offset);
  }
  gotoNextSibling() {
    if (this.stack.length === 0) return false;
    const parentFrame = this.stack[this.stack.length - 1];
    const siblings = parentFrame.node.children;
    if (parentFrame.childIndex + 1 < siblings.length) {
      parentFrame.childIndex++;
      this.current = siblings[parentFrame.childIndex];
      return true;
    }
    return false;
  }
  gotoPreviousSibling() {
    if (this.stack.length === 0) return false;
    const parentFrame = this.stack[this.stack.length - 1];
    const siblings = parentFrame.node.children;
    if (parentFrame.childIndex > 0) {
      parentFrame.childIndex--;
      this.current = siblings[parentFrame.childIndex];
      return true;
    }
    return false;
  }
  gotoParent() {
    if (this.stack.length === 0) return false;
    const parentFrame = this.stack.pop();
    this.current = parentFrame.node;
    return true;
  }
  reset(node) {
    this.current = node;
    this.stack = [];
  }
}
/**
 * Represents the root of a parsed syntax tree.
 */
export class Tree {
  facade;
  rootPtr;
  sourceCode;
  lineStarts;
  mem32;
  constructor(facade, rootPtr, sourceCode) {
    this.facade = facade;
    this.rootPtr = rootPtr;
    this.sourceCode = sourceCode;
    // Build lineStarts in byte offsets (UTF-16: 2 bytes per character)
    this.lineStarts = [0];
    for (let i = 0; i < sourceCode.length; i++) {
      if (sourceCode[i] === "\n") this.lineStarts.push((i + 1) * 2);
    }
    this.mem32 = new Uint32Array(facade.wasmMemory.buffer);
  }
  /** Gets the root node of the syntax tree. */
  get rootNode() {
    if (!this.rootPtr) throw new Error("Null root pointer");
    const typeFlags = this.mem32[this.rootPtr / 4];
    const typeId = typeFlags & 0x03ff;
    const envHashPadding = this.mem32[(this.rootPtr + 4) / 4];
    const rawPad = typeFlags >>> 22;
    const isFat = (envHashPadding >>> 23) & 1;
    const pad =
      isFat && this.facade.exports.getFatPaddingPtr
        ? this.mem32[this.facade.exports.getFatPaddingPtr(rawPad) / 4]
        : rawPad;
    const len = envHashPadding & 0x007fffff;
    return new SyntaxNode(this, this.rootPtr, 0, null, pad, len, typeId);
  }
  /** Creates a stateful TreeCursor for traversing the tree starting at the root. */
  walk() {
    return this.rootNode.walk();
  }
  /** Converts a linear byte offset into a row and column Point. */
  offsetToPoint(offset) {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.lineStarts[mid] <= offset) {
        if (mid === this.lineStarts.length - 1 || this.lineStarts[mid + 1] > offset) {
          return { row: mid, column: (offset - this.lineStarts[mid]) / 2 };
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return { row: 0, column: offset / 2 };
  }
  /** Converts a row and column Point into a linear character offset. */
  pointToOffset(point) {
    if (point.row < 0) return 0;
    if (point.row >= this.lineStarts.length) return this.sourceCode.length;
    const lineStart = this.lineStarts[point.row] / 2;
    return Math.min(this.sourceCode.length, lineStart + point.column);
  }
}
/**
 * Tree-sitter standard Parser class interface.
 */
export class TreeSitterParser {
  languageBinding = null;
  setLanguage(language) {
    this.languageBinding = language;
  }
  getLanguage() {
    return this.languageBinding;
  }
  parse(source, oldTree = null) {
    if (!this.languageBinding) {
      throw new Error("Language not set on Parser. Call setLanguage() first.");
    }
    let facade;
    if (typeof this.languageBinding === "function") {
      try {
        facade = new this.languageBinding();
      } catch {
        facade = this.languageBinding();
      }
    } else {
      facade = this.languageBinding;
    }
    const code = typeof source === "string" ? source : new TextDecoder().decode(source);
    const astRoot = facade.parse(code);
    if (!astRoot) return null;
    return new Tree(facade, astRoot, code);
  }
  reset() {}
}
export const WasmLanguageBinding = LspFacade;
export default WasmLanguageBinding;
/**
 * Tier 2 On-Demand LRU Full AST Cache.
 * Evicts inactive ASTs to prevent WASM heap exhaustion in large monorepos.
 */
export class LruAstCache {
  facade;
  activeRoots = new Map();
  maxActiveAsts;
  maxAstMemoryBytes;
  constructor(facade, options) {
    this.facade = facade;
    this.maxActiveAsts = options?.maxActiveAsts ?? 100;
    this.maxAstMemoryBytes = options?.maxAstMemoryBytes ?? 128 * 1024 * 1024;
  }
  get activeCount() {
    return this.activeRoots.size;
  }
  has(fileId) {
    return this.activeRoots.has(fileId);
  }
  get(fileId) {
    const entry = this.activeRoots.get(fileId);
    if (entry) {
      entry.lastAccessed = Date.now();
      return entry.astRoot;
    }
    return undefined;
  }
  set(fileId, astRoot, isDirty = false) {
    this.activeRoots.set(fileId, { astRoot, lastAccessed: Date.now(), isDirty });
    this.facade.registerDocument(fileId, astRoot);
    this.evictIfNecessary();
  }
  markDirty(fileId, isDirty) {
    const entry = this.activeRoots.get(fileId);
    if (entry) entry.isDirty = isDirty;
  }
  evict(fileId) {
    const entry = this.activeRoots.get(fileId);
    if (!entry) return false;
    if (entry.isDirty) return false;
    this.facade.evictDocumentAst(fileId);
    this.activeRoots.delete(fileId);
    return true;
  }
  evictIfNecessary() {
    const memUsage = this.facade.getMemoryUsage();
    const exceedsCount = this.activeRoots.size > this.maxActiveAsts;
    const exceedsMem = memUsage > this.maxAstMemoryBytes;
    if (!exceedsCount && !exceedsMem) return;
    const entries = Array.from(this.activeRoots.entries())
      .filter(([_, v]) => !v.isDirty)
      .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);
    for (const [fId] of entries) {
      if (this.activeRoots.size <= this.maxActiveAsts && this.facade.getMemoryUsage() <= this.maxAstMemoryBytes) {
        break;
      }
      this.evict(fId);
    }
  }
  clear() {
    for (const [fileId] of this.activeRoots) {
      this.facade.evictDocumentAst(fileId);
    }
    this.activeRoots.clear();
  }
}
/**
 * Manages workspace-wide multi-file symbol indexing and Two-Tier storage.
 */
export class LspWorkspaceManager {
  facade;
  astCache;
  uriToFileId = new Map();
  fileIdToUri = new Map();
  nextFileId = 1;
  constructor(facade, options) {
    this.facade = facade;
    this.astCache = new LruAstCache(facade, options);
  }
  getFileId(uri) {
    let id = this.uriToFileId.get(uri);
    if (id === undefined) {
      id = this.nextFileId++;
      this.uriToFileId.set(uri, id);
      this.fileIdToUri.set(id, uri);
    }
    return id;
  }
  getUri(fileId) {
    return this.fileIdToUri.get(fileId);
  }
  indexFile(uri, content, keepAst = false) {
    const fileId = this.getFileId(uri);
    this.facade.clearFileStubs(fileId);
    const astRoot = this.facade.parse(content);
    const symbols = this.facade.getDocumentSymbols(astRoot);
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i];
      this.facade.registerStub(fileId, i + 1, 0, s.typeId, 0, `symbol_${s.typeId}_${i}`, s.start.line, s.end.line);
    }
    if (keepAst) {
      this.astCache.set(fileId, astRoot);
    } else {
      this.facade.evictDocumentAst(fileId);
    }
    return fileId;
  }
  getDefinition(uri, offset) {
    const fileId = this.getFileId(uri);
    let astRoot = this.astCache.get(fileId);
    if (!astRoot) return null;
    const def = this.facade.getDefinition(astRoot, offset);
    if (!def) return null;
    const targetUri = def.fileId === 0 ? uri : this.getUri(def.fileId) || uri;
    return {
      uri: targetUri,
      start: def.start,
      end: def.end,
    };
  }
  findSymbolsFuzzy(query, maxResults = 50) {
    const results = this.facade.fuzzyFindSymbols(query, maxResults);
    return results.map((r) => ({
      uri: this.getUri(r.fileId) || "",
      stubId: r.stubId,
      kind: r.kind,
      startByte: r.startByte,
      endByte: r.endByte,
      score: r.score,
    }));
  }
}
/**
 * Asynchronously loads a ModelScript language WebAssembly parser module from a URL,
 * local file path, or in-memory byte buffer and wraps it in a high-performance LspFacade and TreeSitterParser.
 */
export async function createWasmParser(wasmUrlOrBytes, options) {
  let bytes;
  let syntaxNames = options?.syntaxNames;
  if (typeof wasmUrlOrBytes === "string") {
    if (
      typeof fetch !== "undefined" &&
      (wasmUrlOrBytes.startsWith("http://") ||
        wasmUrlOrBytes.startsWith("https://") ||
        wasmUrlOrBytes.startsWith("blob:") ||
        wasmUrlOrBytes.startsWith("vscode-") ||
        wasmUrlOrBytes.startsWith("/"))
    ) {
      try {
        const res = await fetch(wasmUrlOrBytes);
        bytes = await res.arrayBuffer();
      } catch {
        const modName = "node" + ":fs";
        const fs = await Function("m", "return import(m)")(modName);
        const buf = fs.readFileSync(wasmUrlOrBytes);
        bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
    } else {
      const modName = "node" + ":fs";
      const fs = await Function("m", "return import(m)")(modName);
      const buf = fs.readFileSync(wasmUrlOrBytes);
      bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    if (!syntaxNames) {
      const bindingsPaths = [
        wasmUrlOrBytes.replace(/\/dist\/parser\.wasm$/, "/src-gen/bindings.js"),
        wasmUrlOrBytes.replace(/\.wasm$/, ".bindings.js"),
        wasmUrlOrBytes.replace(/\/parser\.wasm$/, "/bindings.js"),
        wasmUrlOrBytes.replace(/\/tree-sitter-[^/]+\.wasm$/, "/bindings.js"),
      ];
      for (const bPath of bindingsPaths) {
        const mod = await Function("m", "return import(m)")(bPath);
        if (mod) {
          if (mod.SYNTAX_NAMES && mod.SYNTAX_NAMES.length > 0) {
            syntaxNames = mod.SYNTAX_NAMES;
          }
          if (mod.FIELD_NAMES) {
            Object.assign(FIELD_NAMES, mod.FIELD_NAMES);
          }
          if (syntaxNames) break;
        }
      }
    }
  } else if (wasmUrlOrBytes instanceof Uint8Array) {
    bytes = wasmUrlOrBytes.buffer.slice(
      wasmUrlOrBytes.byteOffset,
      wasmUrlOrBytes.byteOffset + wasmUrlOrBytes.byteLength,
    );
  } else {
    bytes = wasmUrlOrBytes;
  }
  const imports = {
    env: {
      abort: (msg, file, line, col) => {
        console.error(`WASM abort: ${msg}:${file}:${line}:${col}`);
      },
    },
    parser: {
      logInt: (val) => {},
    },
    engine: {
      debugLog: (ptr, len) => {},
    },
    host: {
      runHostQuery: () => 0,
    },
  };
  const wasmModule = await WebAssembly.instantiate(bytes, imports);
  const exports = wasmModule.instance ? wasmModule.instance.exports : wasmModule.exports;
  const facade = new LspFacade(exports);
  if (syntaxNames && syntaxNames.length > 0) {
    facade.syntaxNames = syntaxNames;
  }
  const parser = new TreeSitterParser();
  parser.setLanguage(facade);
  return { facade, parser };
}

export const semanticLegend = { tokenTypes: [], tokenModifiers: [] };

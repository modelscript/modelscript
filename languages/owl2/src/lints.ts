// SPDX-License-Identifier: AGPL-3.0-or-later

import { WasmOntologyReasoner } from "@modelscript/runtime";
import {
  BUILTIN_OWL2_PREFIXES,
  getNodeChildren,
  getNodeText,
  lowerCstToAxioms,
  normalizeIri,
  type GenericSyntaxNode,
  type LoweringContext,
} from "./cst-lowering.js";
import { Owl2ErrorCode, type Owl2DiagnosticSeverity, type Owl2ErrorCodeDef } from "./errors.js";

export interface Owl2LintDiagnostic {
  readonly code: number;
  readonly rule: string;
  readonly severity: Owl2DiagnosticSeverity;
  readonly message: string;
  readonly startByte: number;
  readonly endByte: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly iri?: string;
}

export interface Owl2LintOptions {
  /**
   * Emit O2001 warnings for entities referenced without an explicit Declaration(...) axiom.
   * When undefined, defaults to true if the ontology contains at least one Declaration axiom.
   */
  checkUndeclaredEntities?: boolean;
  /**
   * Run WasmOntologyReasoner consistency & satisfiability verification (O5001–O5004).
   * Defaults to true.
   */
  checkConsistency?: boolean;
  /**
   * Optional OWL 2 profile to validate against ("DL" | "EL").
   * When set to "EL", emits O6001 warnings for constructs outside the OWL 2 EL profile.
   */
  profile?: "DL" | "EL";
}

const STANDARD_OWL2_DATATYPES = new Set([
  "xsd:string",
  "xsd:boolean",
  "xsd:decimal",
  "xsd:integer",
  "xsd:double",
  "xsd:float",
  "xsd:dateTime",
  "xsd:dateTimeStamp",
  "xsd:time",
  "xsd:date",
  "xsd:gYearMonth",
  "xsd:gYear",
  "xsd:gMonthDay",
  "xsd:gDay",
  "xsd:gMonth",
  "xsd:hexBinary",
  "xsd:base64Binary",
  "xsd:anyURI",
  "xsd:normalizedString",
  "xsd:token",
  "xsd:language",
  "xsd:NMTOKEN",
  "xsd:Name",
  "xsd:NCName",
  "xsd:long",
  "xsd:int",
  "xsd:short",
  "xsd:byte",
  "xsd:nonNegativeInteger",
  "xsd:nonPositiveInteger",
  "xsd:positiveInteger",
  "xsd:negativeInteger",
  "xsd:unsignedLong",
  "xsd:unsignedInt",
  "xsd:unsignedShort",
  "xsd:unsignedByte",
  "rdfs:Literal",
  "rdf:PlainLiteral",
  "rdf:XMLLiteral",
  "rdf:langString",
  "owl:real",
  "owl:rational",
]);

const BUILTIN_CLASS_IRIS = new Set(["owl:Thing", "owl:Nothing"]);

const OWL2_EL_DISALLOWED_NODES: Readonly<Record<string, string>> = {
  ObjectUnionOf: "ObjectUnionOf",
  ObjectComplementOf: "ObjectComplementOf",
  ObjectAllValuesFrom: "ObjectAllValuesFrom",
  DataAllValuesFrom: "DataAllValuesFrom",
  ObjectMinCardinality: "ObjectMinCardinality",
  ObjectMaxCardinality: "ObjectMaxCardinality",
  ObjectExactCardinality: "ObjectExactCardinality",
  DataMinCardinality: "DataMinCardinality",
  DataMaxCardinality: "DataMaxCardinality",
  DataExactCardinality: "DataExactCardinality",
  DisjointObjectPropertiesAxiom: "DisjointObjectProperties",
  IrreflexiveObjectPropertyAxiom: "IrreflexiveObjectProperty",
  InverseObjectPropertiesAxiom: "InverseObjectProperties",
  FunctionalObjectPropertyAxiom: "FunctionalObjectProperty",
  InverseFunctionalObjectPropertyAxiom: "InverseFunctionalObjectProperty",
  SymmetricObjectPropertyAxiom: "SymmetricObjectProperty",
  AsymmetricObjectPropertyAxiom: "AsymmetricObjectProperty",
};

const NARY_MIN_ARITY: Readonly<Record<string, { name: string; min: number }>> = {
  ObjectIntersectionOf: { name: "ObjectIntersectionOf", min: 2 },
  ObjectUnionOf: { name: "ObjectUnionOf", min: 2 },
  EquivalentClassesAxiom: { name: "EquivalentClasses", min: 2 },
  DisjointClassesAxiom: { name: "DisjointClasses", min: 2 },
  DisjointObjectPropertiesAxiom: { name: "DisjointObjectProperties", min: 2 },
  SameIndividualAxiom: { name: "SameIndividual", min: 2 },
  DifferentIndividualsAxiom: { name: "DifferentIndividuals", min: 2 },
  ObjectOneOf: { name: "ObjectOneOf", min: 1 },
};

const NON_SIMPLE_RESTRICTED_CONSTRUCTS: Readonly<Record<string, string>> = {
  ObjectMinCardinality: "ObjectMinCardinality",
  ObjectMaxCardinality: "ObjectMaxCardinality",
  ObjectExactCardinality: "ObjectExactCardinality",
  ObjectHasSelf: "ObjectHasSelf",
  FunctionalObjectPropertyAxiom: "FunctionalObjectProperty",
  InverseFunctionalObjectPropertyAxiom: "InverseFunctionalObjectProperty",
  IrreflexiveObjectPropertyAxiom: "IrreflexiveObjectProperty",
  AsymmetricObjectPropertyAxiom: "AsymmetricObjectProperty",
  DisjointObjectPropertiesAxiom: "DisjointObjectProperties",
};

function getNodeSpan(node: GenericSyntaxNode, sourceText?: string): { startByte: number; endByte: number } {
  const start = node.startByte ?? node.startOffset ?? node.startIndex ?? 0;
  const end = node.endByte ?? node.endOffset ?? node.endIndex ?? (sourceText ? sourceText.length : start);
  return { startByte: start, endByte: Math.max(start, end) };
}

function isBuiltInVocabularyIri(iri: string): boolean {
  return (
    iri.startsWith("owl:") ||
    iri.startsWith("rdf:") ||
    iri.startsWith("rdfs:") ||
    iri.startsWith("xsd:") ||
    iri.startsWith("http://www.w3.org/2002/07/owl#") ||
    iri.startsWith("http://www.w3.org/1999/02/22-rdf-syntax-ns#") ||
    iri.startsWith("http://www.w3.org/2000/01/rdf-schema#") ||
    iri.startsWith("http://www.w3.org/2001/XMLSchema#")
  );
}

function isDatatypeIri(iri: string): boolean {
  return (
    STANDARD_OWL2_DATATYPES.has(iri) || iri.startsWith("xsd:") || iri.startsWith("http://www.w3.org/2001/XMLSchema#")
  );
}

function isValidLexicalValueForDatatype(value: string, datatypeIri: string): boolean {
  switch (datatypeIri) {
    case "xsd:integer":
    case "xsd:long":
    case "xsd:int":
    case "xsd:short":
    case "xsd:byte":
      return /^[+-]?\d+$/.test(value);
    case "xsd:nonNegativeInteger":
    case "xsd:unsignedLong":
    case "xsd:unsignedInt":
    case "xsd:unsignedShort":
    case "xsd:unsignedByte":
      return /^\+?\d+$/.test(value);
    case "xsd:positiveInteger":
      return /^\+?[1-9]\d*$/.test(value);
    case "xsd:nonPositiveInteger":
      return /^(?:0|-\d+)$/.test(value);
    case "xsd:negativeInteger":
      return /^-[1-9]\d*$/.test(value);
    case "xsd:decimal":
    case "xsd:double":
    case "xsd:float":
    case "owl:real":
      return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
    case "xsd:boolean":
      return /^(?:true|false|1|0)$/.test(value);
    default:
      return true;
  }
}

function isSyntacticallyValidFullIri(rawFullIri: string): boolean {
  const trimmed = rawFullIri.trim();
  if (!trimmed.startsWith("<") || !trimmed.endsWith(">")) return false;
  const inner = trimmed.slice(1, -1);
  if (inner.length === 0) return false;
  if (/[\s<>"{}|\\^`]/.test(inner)) return false;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(inner)) return false;
  return true;
}

/**
 * Runs the comprehensive OWL 2 static & semantic linter over a parsed OWL 2 CST.
 * Covers syntax/prefix checks (O1xxx), declarations (O2xxx), typing/punning/datatypes (O3xxx),
 * OWL 2 DL global structural restrictions (O4xxx), reasoner consistency/satisfiability (O5xxx),
 * and OWL 2 EL profile checks (O6xxx).
 */
export function lintOwl2Document(
  rootNode: GenericSyntaxNode,
  sourceText?: string,
  options?: Owl2LintOptions,
): Owl2LintDiagnostic[] {
  const diagnostics: Owl2LintDiagnostic[] = [];
  const emittedKeys = new Set<string>();

  const emit = (def: Owl2ErrorCodeDef, node: GenericSyntaxNode, args: string[], iri?: string): void => {
    const { startByte, endByte } = getNodeSpan(node, sourceText);
    const message = def.message(...args);
    const dedupKey = `${def.code}:${startByte}:${endByte}:${message}`;
    if (emittedKeys.has(dedupKey)) return;
    emittedKeys.add(dedupKey);
    diagnostics.push({
      code: def.code,
      rule: def.rule,
      severity: def.severity,
      message,
      startByte,
      endByte,
      startOffset: startByte,
      endOffset: endByte,
      ...(iri !== undefined ? { iri } : {}),
    });
  };

  const ctx: LoweringContext = {
    sourceText,
    prefixes: new Map(BUILTIN_OWL2_PREFIXES),
    userPrefixes: new Map(),
    expandPrefixes: false,
  };

  // -------------------------------------------------------------------------
  // Pass 1: Prefix declarations, parse errors, and IRI syntax (O1001, O1003, O1004)
  // -------------------------------------------------------------------------
  const declaredPrefixes = new Set<string>(BUILTIN_OWL2_PREFIXES.map(([k]) => k));
  const seenUserPrefixes = new Set<string>();

  const collectPrefixesAndSyntax = (node: GenericSyntaxNode): void => {
    if (node.type === "ERROR" || node.isError) {
      const snippet = getNodeText(node, ctx).slice(0, 40) || "unexpected token";
      emit(Owl2ErrorCode.PARSE_ERROR, node, [snippet]);
    }

    if (node.type === "PrefixDeclaration") {
      const children = getNodeChildren(node);
      let prefixName = ":";
      let targetIri = "";
      let fullIriNode: GenericSyntaxNode | undefined;

      for (const child of children) {
        if (child.type === "PrefixName") {
          const rawPrefix = getNodeText(child, ctx);
          prefixName = rawPrefix.endsWith(":") ? rawPrefix : `${rawPrefix}:`;
        } else if (child.type === "FullIRI" || child.type === "IRI") {
          fullIriNode = child;
          const rawTarget = getNodeText(child, ctx).trim();
          if (!isSyntacticallyValidFullIri(rawTarget)) {
            emit(Owl2ErrorCode.INVALID_IRI, child, [rawTarget], rawTarget);
          }
          targetIri = rawTarget.startsWith("<") && rawTarget.endsWith(">") ? rawTarget.slice(1, -1) : rawTarget;
        }
      }

      const prefixLabel = prefixName.endsWith(":") ? prefixName.slice(0, -1) : prefixName;
      if (seenUserPrefixes.has(prefixName)) {
        emit(Owl2ErrorCode.DUPLICATE_PREFIX, node, [prefixLabel], prefixName);
      }
      seenUserPrefixes.add(prefixName);
      declaredPrefixes.add(prefixName);
      if (targetIri) {
        ctx.prefixes.set(prefixName, targetIri);
        ctx.userPrefixes.set(prefixName, targetIri);
      }
      void fullIriNode;
      return;
    }

    if (node.type === "FullIRI") {
      const raw = getNodeText(node, ctx);
      if (raw && !isSyntacticallyValidFullIri(raw)) {
        emit(Owl2ErrorCode.INVALID_IRI, node, [raw], raw);
      }
    }

    for (const child of getNodeChildren(node)) {
      collectPrefixesAndSyntax(child);
    }
  };

  collectPrefixesAndSyntax(rootNode);

  // If rootNode reports hasError but no explicit ERROR child node was found, emit O1001 on root
  const rootHasError =
    typeof (rootNode as any).hasError === "function" ? (rootNode as any).hasError() : Boolean(rootNode.hasError);
  if (rootHasError && !diagnostics.some((d) => d.code === Owl2ErrorCode.PARSE_ERROR.code)) {
    const snippet = getNodeText(rootNode, ctx).slice(0, 40) || "document";
    emit(Owl2ErrorCode.PARSE_ERROR, rootNode, [snippet]);
  }

  // -------------------------------------------------------------------------
  // Pass 2: Declarations, Prefix Resolution (O1002), Arity (O1005),
  //         Reserved Vocabulary (O2003), Duplicate Declarations (O2002),
  //         and Property Punning (O3001)
  // -------------------------------------------------------------------------
  const declaredClasses = new Map<string, GenericSyntaxNode>();
  const declaredObjectProps = new Map<string, GenericSyntaxNode>();
  const declaredDataProps = new Map<string, GenericSyntaxNode>();
  const declaredIndividuals = new Map<string, GenericSyntaxNode>();
  const firstAxiomNodeByIri = new Map<string, GenericSyntaxNode>();
  const undeclaredPrefixIris = new Set<string>();
  let totalDeclarations = 0;

  const checkAbbreviatedIris = (node: GenericSyntaxNode): void => {
    if (node.type === "AbbreviatedIRI") {
      const raw = getNodeText(node, ctx);
      const colonIdx = raw.indexOf(":");
      if (colonIdx !== -1) {
        const prefixKey = raw.slice(0, colonIdx + 1);
        const prefixLabel = raw.slice(0, colonIdx);
        if (!declaredPrefixes.has(prefixKey)) {
          undeclaredPrefixIris.add(raw);
          emit(Owl2ErrorCode.UNDECLARED_PREFIX, node, [prefixLabel, raw], raw);
        }
      }
      return;
    }
    for (const child of getNodeChildren(node)) {
      checkAbbreviatedIris(child);
    }
  };
  checkAbbreviatedIris(rootNode);

  const collectDeclarations = (node: GenericSyntaxNode): void => {
    if (node.type === "Declaration") {
      const entityNode = getNodeChildren(node).find((c) =>
        ["ClassEntity", "ObjectPropertyEntity", "DataPropertyEntity", "NamedIndividualEntity"].includes(c.type),
      );
      if (entityNode) {
        totalDeclarations++;
        const iriNode =
          getNodeChildren(entityNode).find(
            (c) => c.type === "IRI" || c.type === "FullIRI" || c.type === "AbbreviatedIRI",
          ) ?? entityNode;
        const iri = normalizeIri(getNodeText(iriNode, ctx), ctx);
        if (iri) {
          if (!firstAxiomNodeByIri.has(iri)) {
            firstAxiomNodeByIri.set(iri, node);
          }

          if (isBuiltInVocabularyIri(iri)) {
            emit(Owl2ErrorCode.RESERVED_VOCABULARY_DECLARATION, iriNode, [iri], iri);
          }

          if (entityNode.type === "ClassEntity") {
            if (declaredClasses.has(iri)) {
              emit(Owl2ErrorCode.DUPLICATE_DECLARATION, node, ["Class", iri], iri);
            } else {
              declaredClasses.set(iri, node);
            }
          } else if (entityNode.type === "ObjectPropertyEntity") {
            if (declaredObjectProps.has(iri)) {
              emit(Owl2ErrorCode.DUPLICATE_DECLARATION, node, ["ObjectProperty", iri], iri);
            } else {
              declaredObjectProps.set(iri, node);
            }
            if (declaredDataProps.has(iri)) {
              emit(Owl2ErrorCode.ILLEGAL_PROPERTY_PUNNING, node, [iri, "ObjectProperty", "DataProperty"], iri);
            }
          } else if (entityNode.type === "DataPropertyEntity") {
            if (declaredDataProps.has(iri)) {
              emit(Owl2ErrorCode.DUPLICATE_DECLARATION, node, ["DataProperty", iri], iri);
            } else {
              declaredDataProps.set(iri, node);
            }
            if (declaredObjectProps.has(iri)) {
              emit(Owl2ErrorCode.ILLEGAL_PROPERTY_PUNNING, node, [iri, "DataProperty", "ObjectProperty"], iri);
            }
          } else if (entityNode.type === "NamedIndividualEntity") {
            if (declaredIndividuals.has(iri)) {
              emit(Owl2ErrorCode.DUPLICATE_DECLARATION, node, ["NamedIndividual", iri], iri);
            } else {
              declaredIndividuals.set(iri, node);
            }
          }
        }
      }
      return;
    }

    for (const child of getNodeChildren(node)) {
      collectDeclarations(child);
    }
  };
  collectDeclarations(rootNode);

  // -------------------------------------------------------------------------
  // Pass 3: Collect Property Hierarchy, Transitivity, Characteristics, and
  //         DataProperty Ranges so we can check OWL 2 DL Non-Simple Property
  //         Restrictions (O4001), Contradictory Characteristics (O4002),
  //         Cycles (O4003, O4004), and Datatype Literal Mismatches (O3006)
  // -------------------------------------------------------------------------
  const transitiveProps = new Set<string>();
  const subObjectPropEdges = new Map<string, Set<string>>();
  const subDataPropEdges = new Map<string, Set<string>>();
  const inversePropPairs = new Map<string, Set<string>>();
  const subClassEdges = new Map<string, Set<string>>();
  const propCharacteristics = new Map<string, Map<string, GenericSyntaxNode>>();
  const dataPropRanges = new Map<string, string[]>();
  const objectPropDomains = new Map<string, Set<string>>();
  const objectPropRanges = new Map<string, Set<string>>();
  const usedAsObjectProp = new Map<string, GenericSyntaxNode>();
  const usedAsDataProp = new Map<string, GenericSyntaxNode>();

  const recordPropChar = (propIri: string, charName: string, node: GenericSyntaxNode): void => {
    let map = propCharacteristics.get(propIri);
    if (!map) {
      map = new Map();
      propCharacteristics.set(propIri, map);
    }
    map.set(charName, node);
  };

  const getDirectIriNodes = (node: GenericSyntaxNode): GenericSyntaxNode[] => {
    const out: GenericSyntaxNode[] = [];
    for (const c of getNodeChildren(node)) {
      if (c.type === "IRI" || c.type === "FullIRI" || c.type === "AbbreviatedIRI" || c.type === "DataRange") {
        out.push(c);
      }
    }
    return out;
  };

  const getExpressionChildNodes = (node: GenericSyntaxNode): GenericSyntaxNode[] => {
    return getNodeChildren(node).filter((c) => {
      const t = c.type.replace(/^"|"$/g, "");
      return (
        t !== "(" &&
        t !== ")" &&
        t !== "=" &&
        t !== ":" &&
        t !== "INTEGER" &&
        !t.startsWith("ObjectMinCardinality") &&
        !t.startsWith("ObjectMaxCardinality") &&
        !t.startsWith("ObjectExactCardinality") &&
        !t.startsWith("DataMinCardinality") &&
        !t.startsWith("DataMaxCardinality") &&
        !t.startsWith("DataExactCardinality") &&
        ![
          "Prefix",
          "Ontology",
          "Import",
          "Declaration",
          "SubClassOf",
          "EquivalentClasses",
          "DisjointClasses",
          "SubObjectPropertyOf",
          "SubDataPropertyOf",
          "InverseObjectProperties",
          "DisjointObjectProperties",
          "ObjectPropertyDomain",
          "ObjectPropertyRange",
          "DataPropertyDomain",
          "DataPropertyRange",
          "FunctionalObjectProperty",
          "InverseFunctionalObjectProperty",
          "ReflexiveObjectProperty",
          "IrreflexiveObjectProperty",
          "SymmetricObjectProperty",
          "AsymmetricObjectProperty",
          "TransitiveObjectProperty",
          "FunctionalDataProperty",
          "ObjectPropertyAssertion",
          "DataPropertyAssertion",
          "NegativeObjectPropertyAssertion",
          "NegativeDataPropertyAssertion",
          "ClassAssertion",
          "SameIndividual",
          "DifferentIndividuals",
          "ObjectIntersectionOf",
          "ObjectUnionOf",
          "ObjectComplementOf",
          "ObjectSomeValuesFrom",
          "ObjectAllValuesFrom",
          "ObjectHasSelf",
          "ObjectHasValue",
          "ObjectOneOf",
          "DataSomeValuesFrom",
          "DataAllValuesFrom",
        ].includes(t)
      );
    });
  };

  const preScanAxioms = (node: GenericSyntaxNode): void => {
    switch (node.type) {
      case "TransitiveObjectPropertyAxiom": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes[0]) {
          const p = normalizeIri(getNodeText(iriNodes[0], ctx), ctx);
          if (p) {
            transitiveProps.add(p);
            recordPropChar(p, "TransitiveObjectProperty", node);
          }
        }
        break;
      }
      case "FunctionalObjectPropertyAxiom": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes[0]) {
          const p = normalizeIri(getNodeText(iriNodes[0], ctx), ctx);
          if (p) recordPropChar(p, "FunctionalObjectProperty", node);
        }
        break;
      }
      case "InverseFunctionalObjectPropertyAxiom": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes[0]) {
          const p = normalizeIri(getNodeText(iriNodes[0], ctx), ctx);
          if (p) recordPropChar(p, "InverseFunctionalObjectProperty", node);
        }
        break;
      }
      case "ReflexiveObjectPropertyAxiom": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes[0]) {
          const p = normalizeIri(getNodeText(iriNodes[0], ctx), ctx);
          if (p) recordPropChar(p, "ReflexiveObjectProperty", node);
        }
        break;
      }
      case "IrreflexiveObjectPropertyAxiom": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes[0]) {
          const p = normalizeIri(getNodeText(iriNodes[0], ctx), ctx);
          if (p) recordPropChar(p, "IrreflexiveObjectProperty", node);
        }
        break;
      }
      case "SymmetricObjectPropertyAxiom": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes[0]) {
          const p = normalizeIri(getNodeText(iriNodes[0], ctx), ctx);
          if (p) recordPropChar(p, "SymmetricObjectProperty", node);
        }
        break;
      }
      case "AsymmetricObjectPropertyAxiom": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes[0]) {
          const p = normalizeIri(getNodeText(iriNodes[0], ctx), ctx);
          if (p) recordPropChar(p, "AsymmetricObjectProperty", node);
        }
        break;
      }
      case "SubObjectPropertyOfAxiom": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes.length >= 2) {
          const sub = normalizeIri(getNodeText(iriNodes[0]!, ctx), ctx);
          const sup = normalizeIri(getNodeText(iriNodes[1]!, ctx), ctx);
          if (sub && sup) {
            let set = subObjectPropEdges.get(sub);
            if (!set) {
              set = new Set();
              subObjectPropEdges.set(sub, set);
            }
            set.add(sup);
          }
        }
        break;
      }
      case "SubDataPropertyOfAxiom": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes.length >= 2) {
          const sub = normalizeIri(getNodeText(iriNodes[0]!, ctx), ctx);
          const sup = normalizeIri(getNodeText(iriNodes[1]!, ctx), ctx);
          if (sub && sup) {
            let set = subDataPropEdges.get(sub);
            if (!set) {
              set = new Set();
              subDataPropEdges.set(sub, set);
            }
            set.add(sup);
          }
        }
        break;
      }
      case "InverseObjectPropertiesAxiom": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes.length >= 2) {
          const p1 = normalizeIri(getNodeText(iriNodes[0]!, ctx), ctx);
          const p2 = normalizeIri(getNodeText(iriNodes[1]!, ctx), ctx);
          if (p1 && p2) {
            let s1 = inversePropPairs.get(p1);
            if (!s1) {
              s1 = new Set();
              inversePropPairs.set(p1, s1);
            }
            s1.add(p2);
            let s2 = inversePropPairs.get(p2);
            if (!s2) {
              s2 = new Set();
              inversePropPairs.set(p2, s2);
            }
            s2.add(p1);
          }
        }
        break;
      }
      case "DataPropertyRangeAxiom": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes.length >= 2) {
          const p = normalizeIri(getNodeText(iriNodes[0]!, ctx), ctx);
          const rng = normalizeIri(getNodeText(iriNodes[1]!, ctx), ctx);
          if (p && rng) {
            const list = dataPropRanges.get(p) ?? [];
            list.push(rng);
            dataPropRanges.set(p, list);
          }
        }
        break;
      }
      case "ObjectPropertyDomainAxiom": {
        const exprs = getExpressionChildNodes(node);
        if (exprs.length >= 2) {
          const p = normalizeIri(getNodeText(exprs[0]!, ctx), ctx);
          const dom = normalizeIri(getNodeText(exprs[1]!, ctx), ctx);
          if (p && dom) {
            const set = objectPropDomains.get(p) ?? new Set();
            set.add(dom);
            objectPropDomains.set(p, set);
          }
        }
        break;
      }
      case "ObjectPropertyRangeAxiom": {
        const exprs = getExpressionChildNodes(node);
        if (exprs.length >= 2) {
          const p = normalizeIri(getNodeText(exprs[0]!, ctx), ctx);
          const rng = normalizeIri(getNodeText(exprs[1]!, ctx), ctx);
          if (p && rng) {
            const set = objectPropRanges.get(p) ?? new Set();
            set.add(rng);
            objectPropRanges.set(p, set);
          }
        }
        break;
      }
      case "SubClassOfAxiom": {
        const exprs = getExpressionChildNodes(node);
        if (exprs.length >= 2) {
          const sub = exprs[0]!;
          const sup = exprs[1]!;
          if (
            (sub.type === "IRI" || sub.type === "FullIRI" || sub.type === "AbbreviatedIRI") &&
            (sup.type === "IRI" || sup.type === "FullIRI" || sup.type === "AbbreviatedIRI")
          ) {
            const subIri = normalizeIri(getNodeText(sub, ctx), ctx);
            const supIri = normalizeIri(getNodeText(sup, ctx), ctx);
            if (subIri && supIri && subIri !== supIri) {
              let set = subClassEdges.get(subIri);
              if (!set) {
                set = new Set();
                subClassEdges.set(subIri, set);
              }
              set.add(supIri);
              if (!firstAxiomNodeByIri.has(subIri)) {
                firstAxiomNodeByIri.set(subIri, node);
              }
            }
          } else if (sub.type === "IRI" || sub.type === "FullIRI" || sub.type === "AbbreviatedIRI") {
            const subIri = normalizeIri(getNodeText(sub, ctx), ctx);
            if (subIri && !firstAxiomNodeByIri.has(subIri)) {
              firstAxiomNodeByIri.set(subIri, node);
            }
          }
        }
        break;
      }
    }

    for (const child of getNodeChildren(node)) {
      preScanAxioms(child);
    }
  };
  preScanAxioms(rootNode);

  // Compute non-simple (composite) object properties:
  // A property P is non-simple if it is transitive, its inverse is non-simple,
  // or it has a non-simple sub-property Q (Q SubObjectPropertyOf* P).
  const nonSimpleProps = new Set<string>(transitiveProps);
  let nsChanged = true;
  while (nsChanged) {
    nsChanged = false;
    for (const p of Array.from(nonSimpleProps)) {
      const invs = inversePropPairs.get(p);
      if (invs) {
        for (const inv of invs) {
          if (!nonSimpleProps.has(inv)) {
            nonSimpleProps.add(inv);
            nsChanged = true;
          }
        }
      }
      const sups = subObjectPropEdges.get(p);
      if (sups) {
        for (const sup of sups) {
          if (!nonSimpleProps.has(sup)) {
            nonSimpleProps.add(sup);
            nsChanged = true;
          }
        }
      }
    }
  }

  // Check contradictory property characteristics (O4002)
  const contradictoryCharPairs: readonly (readonly [string, string])[] = [
    ["ReflexiveObjectProperty", "IrreflexiveObjectProperty"],
    ["ReflexiveObjectProperty", "AsymmetricObjectProperty"],
    ["SymmetricObjectProperty", "AsymmetricObjectProperty"],
    ["TransitiveObjectProperty", "AsymmetricObjectProperty"],
    ["TransitiveObjectProperty", "IrreflexiveObjectProperty"],
  ];
  for (const [propIri, charMap] of propCharacteristics) {
    for (const [charA, charB] of contradictoryCharPairs) {
      if (charMap.has(charA) && charMap.has(charB)) {
        const targetNode = charMap.get(charB) ?? charMap.get(charA)!;
        emit(Owl2ErrorCode.CONTRADICTORY_PROPERTY_CHARACTERISTICS, targetNode, [propIri, charA, charB], propIri);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Pass 4: Structural, Typing, Arity, Datatype, and Profile AST Walk
  // -------------------------------------------------------------------------
  const shouldCheckUndeclared =
    options?.checkUndeclaredEntities !== undefined ? options.checkUndeclaredEntities : totalDeclarations > 0;
  const warnedUndeclared = new Set<string>();

  const checkEntityDeclared = (
    iri: string,
    role: "Class" | "ObjectProperty" | "DataProperty" | "NamedIndividual",
    node: GenericSyntaxNode,
  ): void => {
    if (!shouldCheckUndeclared) return;
    if (!iri || isBuiltInVocabularyIri(iri) || BUILTIN_CLASS_IRIS.has(iri)) return;
    const raw = getNodeText(node, ctx);
    if (undeclaredPrefixIris.has(raw)) return;

    const isDeclared =
      role === "Class"
        ? declaredClasses.has(iri)
        : role === "ObjectProperty"
          ? declaredObjectProps.has(iri)
          : role === "DataProperty"
            ? declaredDataProps.has(iri)
            : declaredIndividuals.has(iri);

    // Don't double-report if it's declared as the wrong property kind (O3002/O3003 handles that)
    if (
      (role === "ObjectProperty" && declaredDataProps.has(iri)) ||
      (role === "DataProperty" && declaredObjectProps.has(iri))
    ) {
      return;
    }

    const key = `${role}:${iri}`;
    if (!isDeclared && !warnedUndeclared.has(key)) {
      warnedUndeclared.add(key);
      emit(Owl2ErrorCode.UNDECLARED_ENTITY, node, [iri, role], iri);
    }
  };

  const checkObjectPropertyRole = (propNode: GenericSyntaxNode, constructName: string): string => {
    const propIri = normalizeIri(getNodeText(propNode, ctx), ctx);
    if (!propIri) return "";

    if (!usedAsObjectProp.has(propIri)) {
      usedAsObjectProp.set(propIri, propNode);
    }

    if (declaredDataProps.has(propIri) && !declaredObjectProps.has(propIri)) {
      emit(Owl2ErrorCode.EXPECTED_OBJECT_PROPERTY, propNode, [propIri, constructName], propIri);
    } else if (usedAsDataProp.has(propIri) && !declaredDataProps.has(propIri)) {
      emit(Owl2ErrorCode.ILLEGAL_PROPERTY_PUNNING, propNode, [propIri, "ObjectProperty", "DataProperty"], propIri);
    }

    checkEntityDeclared(propIri, "ObjectProperty", propNode);
    return propIri;
  };

  const checkDataPropertyRole = (propNode: GenericSyntaxNode, constructName: string): string => {
    const propIri = normalizeIri(getNodeText(propNode, ctx), ctx);
    if (!propIri) return "";

    if (!usedAsDataProp.has(propIri)) {
      usedAsDataProp.set(propIri, propNode);
    }

    if (declaredObjectProps.has(propIri) && !declaredDataProps.has(propIri)) {
      emit(Owl2ErrorCode.EXPECTED_DATA_PROPERTY, propNode, [propIri, constructName], propIri);
    } else if (usedAsObjectProp.has(propIri) && !declaredObjectProps.has(propIri)) {
      emit(Owl2ErrorCode.ILLEGAL_PROPERTY_PUNNING, propNode, [propIri, "DataProperty", "ObjectProperty"], propIri);
    }

    checkEntityDeclared(propIri, "DataProperty", propNode);
    return propIri;
  };

  const checkClassExpressionRole = (exprNode: GenericSyntaxNode, constructName: string): string => {
    if (exprNode.type === "IRI" || exprNode.type === "FullIRI" || exprNode.type === "AbbreviatedIRI") {
      const iri = normalizeIri(getNodeText(exprNode, ctx), ctx);
      if (iri) {
        if (isDatatypeIri(iri)) {
          emit(Owl2ErrorCode.EXPECTED_CLASS_EXPRESSION, exprNode, [iri, constructName], iri);
        } else {
          checkEntityDeclared(iri, "Class", exprNode);
        }
      }
      return iri;
    }
    return "";
  };

  const checkDataRangeNode = (rangeNode: GenericSyntaxNode): string => {
    const iri = normalizeIri(getNodeText(rangeNode, ctx), ctx);
    if (!iri) return "";
    if (!STANDARD_OWL2_DATATYPES.has(iri)) {
      emit(Owl2ErrorCode.INVALID_DATATYPE, rangeNode, [iri], iri);
    }
    return iri;
  };

  const walkValidate = (node: GenericSyntaxNode): void => {
    const t = node.type;

    // O6001: OWL 2 EL Profile Conformance
    if (options?.profile === "EL" && t in OWL2_EL_DISALLOWED_NODES) {
      emit(Owl2ErrorCode.PROFILE_EL_VIOLATION, node, [OWL2_EL_DISALLOWED_NODES[t]!]);
    }

    // O1005: N-ary construct minimum arity
    if (t in NARY_MIN_ARITY) {
      const spec = NARY_MIN_ARITY[t]!;
      const args = getExpressionChildNodes(node);
      if (args.length < spec.min) {
        emit(Owl2ErrorCode.INSUFFICIENT_ARITY, node, [spec.name, String(spec.min), String(args.length)]);
      }
    }

    // O4001: OWL 2 DL Non-Simple Property Global Restriction
    if (t in NON_SIMPLE_RESTRICTED_CONSTRUCTS) {
      const constructName = NON_SIMPLE_RESTRICTED_CONSTRUCTS[t]!;
      const iriNodes = getDirectIriNodes(node);
      for (const iriNode of iriNodes) {
        // In ObjectMin/Max/ExactCardinality, the first IRI is the property and the optional second is the filler class
        if (
          (t === "ObjectMinCardinality" || t === "ObjectMaxCardinality" || t === "ObjectExactCardinality") &&
          iriNode !== iriNodes[0]
        ) {
          continue;
        }
        const propIri = normalizeIri(getNodeText(iriNode, ctx), ctx);
        if (propIri && nonSimpleProps.has(propIri)) {
          emit(Owl2ErrorCode.NON_SIMPLE_PROPERTY_RESTRICTION, node, [propIri, constructName], propIri);
        }
      }
    }

    // Construct-specific typing & self-reference checks
    switch (t) {
      case "ObjectSomeValuesFrom":
      case "ObjectAllValuesFrom": {
        const exprs = getExpressionChildNodes(node);
        if (exprs[0]) checkObjectPropertyRole(exprs[0], t);
        if (exprs[1]) checkClassExpressionRole(exprs[1], t);
        break;
      }

      case "ObjectHasSelf": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes[0]) checkObjectPropertyRole(iriNodes[0], t);
        break;
      }

      case "ObjectHasValue": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes[0]) checkObjectPropertyRole(iriNodes[0], t);
        if (iriNodes[1]) {
          const indIri = normalizeIri(getNodeText(iriNodes[1], ctx), ctx);
          checkEntityDeclared(indIri, "NamedIndividual", iriNodes[1]);
        }
        break;
      }

      case "ObjectOneOf": {
        const iriNodes = getDirectIriNodes(node);
        if (options?.profile === "EL" && iriNodes.length > 1) {
          emit(Owl2ErrorCode.PROFILE_EL_VIOLATION, node, ["ObjectOneOf (with more than 1 individual)"]);
        }
        for (const indNode of iriNodes) {
          const indIri = normalizeIri(getNodeText(indNode, ctx), ctx);
          checkEntityDeclared(indIri, "NamedIndividual", indNode);
        }
        break;
      }

      case "ObjectMinCardinality":
      case "ObjectMaxCardinality":
      case "ObjectExactCardinality": {
        const exprs = getExpressionChildNodes(node);
        if (exprs[0]) checkObjectPropertyRole(exprs[0], t);
        if (exprs[1]) checkClassExpressionRole(exprs[1], t);
        break;
      }

      case "DataSomeValuesFrom":
      case "DataAllValuesFrom":
      case "DataMinCardinality":
      case "DataMaxCardinality":
      case "DataExactCardinality": {
        const children = getExpressionChildNodes(node);
        if (children[0]) checkDataPropertyRole(children[0], t);
        if (children[1]) checkDataRangeNode(children[1]);
        break;
      }

      case "ObjectIntersectionOf":
      case "ObjectUnionOf":
      case "ObjectComplementOf": {
        for (const expr of getExpressionChildNodes(node)) {
          checkClassExpressionRole(expr, t);
        }
        break;
      }

      case "SubClassOfAxiom": {
        const exprs = getExpressionChildNodes(node);
        if (exprs.length >= 2) {
          const subIri = checkClassExpressionRole(exprs[0]!, "SubClassOf");
          const supIri = checkClassExpressionRole(exprs[1]!, "SubClassOf");
          if (subIri && supIri && subIri === supIri) {
            emit(Owl2ErrorCode.SELF_REFERENTIAL_AXIOM, node, ["SubClassOf", subIri], subIri);
          }
        }
        break;
      }

      case "EquivalentClassesAxiom":
      case "DisjointClassesAxiom": {
        const construct = t === "EquivalentClassesAxiom" ? "EquivalentClasses" : "DisjointClasses";
        const seen = new Set<string>();
        for (const expr of getExpressionChildNodes(node)) {
          const iri = checkClassExpressionRole(expr, construct);
          if (iri) {
            if (seen.has(iri)) {
              emit(Owl2ErrorCode.SELF_REFERENTIAL_AXIOM, node, [construct, iri], iri);
            }
            seen.add(iri);
          }
        }
        break;
      }

      case "SubObjectPropertyOfAxiom":
      case "InverseObjectPropertiesAxiom": {
        const construct = t === "SubObjectPropertyOfAxiom" ? "SubObjectPropertyOf" : "InverseObjectProperties";
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes.length >= 2) {
          const p1 = checkObjectPropertyRole(iriNodes[0]!, construct);
          const p2 = checkObjectPropertyRole(iriNodes[1]!, construct);
          if (t === "SubObjectPropertyOfAxiom" && p1 && p2 && p1 === p2) {
            emit(Owl2ErrorCode.SELF_REFERENTIAL_AXIOM, node, [construct, p1], p1);
          }
        }
        break;
      }

      case "SubDataPropertyOfAxiom": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes.length >= 2) {
          const p1 = checkDataPropertyRole(iriNodes[0]!, "SubDataPropertyOf");
          const p2 = checkDataPropertyRole(iriNodes[1]!, "SubDataPropertyOf");
          if (p1 && p2 && p1 === p2) {
            emit(Owl2ErrorCode.SELF_REFERENTIAL_AXIOM, node, ["SubDataPropertyOf", p1], p1);
          }
        }
        break;
      }

      case "DisjointObjectPropertiesAxiom": {
        const seen = new Set<string>();
        for (const iriNode of getDirectIriNodes(node)) {
          const p = checkObjectPropertyRole(iriNode, "DisjointObjectProperties");
          if (p) {
            if (seen.has(p)) {
              emit(Owl2ErrorCode.SELF_REFERENTIAL_AXIOM, node, ["DisjointObjectProperties", p], p);
            }
            seen.add(p);
          }
        }
        break;
      }

      case "ObjectPropertyDomainAxiom":
      case "ObjectPropertyRangeAxiom": {
        const construct = t === "ObjectPropertyDomainAxiom" ? "ObjectPropertyDomain" : "ObjectPropertyRange";
        const exprs = getExpressionChildNodes(node);
        if (exprs[0]) checkObjectPropertyRole(exprs[0], construct);
        if (exprs[1]) checkClassExpressionRole(exprs[1], construct);
        break;
      }

      case "DataPropertyDomainAxiom": {
        const exprs = getExpressionChildNodes(node);
        if (exprs[0]) checkDataPropertyRole(exprs[0], "DataPropertyDomain");
        if (exprs[1]) checkClassExpressionRole(exprs[1], "DataPropertyDomain");
        break;
      }

      case "DataPropertyRangeAxiom": {
        const exprs = getExpressionChildNodes(node);
        if (exprs[0]) checkDataPropertyRole(exprs[0], "DataPropertyRange");
        if (exprs[1]) checkDataRangeNode(exprs[1]);
        break;
      }

      case "FunctionalObjectPropertyAxiom":
      case "InverseFunctionalObjectPropertyAxiom":
      case "ReflexiveObjectPropertyAxiom":
      case "IrreflexiveObjectPropertyAxiom":
      case "SymmetricObjectPropertyAxiom":
      case "AsymmetricObjectPropertyAxiom":
      case "TransitiveObjectPropertyAxiom": {
        const construct = t.replace(/Axiom$/, "");
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes[0]) checkObjectPropertyRole(iriNodes[0], construct);
        break;
      }

      case "FunctionalDataPropertyAxiom": {
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes[0]) checkDataPropertyRole(iriNodes[0], "FunctionalDataProperty");
        break;
      }

      case "ObjectPropertyAssertionAxiom":
      case "NegativeObjectPropertyAssertionAxiom": {
        const construct = t.replace(/Axiom$/, "");
        const iriNodes = getDirectIriNodes(node);
        if (iriNodes[0]) checkObjectPropertyRole(iriNodes[0], construct);
        if (iriNodes[1]) {
          const s = normalizeIri(getNodeText(iriNodes[1], ctx), ctx);
          checkEntityDeclared(s, "NamedIndividual", iriNodes[1]);
        }
        if (iriNodes[2]) {
          const o = normalizeIri(getNodeText(iriNodes[2], ctx), ctx);
          checkEntityDeclared(o, "NamedIndividual", iriNodes[2]);
        }
        break;
      }

      case "DataPropertyAssertionAxiom":
      case "NegativeDataPropertyAssertionAxiom": {
        const construct = t.replace(/Axiom$/, "");
        const iriNodes = getDirectIriNodes(node);
        let propIri = "";
        if (iriNodes[0]) {
          propIri = checkDataPropertyRole(iriNodes[0], construct);
        }
        if (iriNodes[1]) {
          const s = normalizeIri(getNodeText(iriNodes[1], ctx), ctx);
          checkEntityDeclared(s, "NamedIndividual", iriNodes[1]);
        }
        const strNode = getNodeChildren(node).find((c) => c.type === "StringLiteral");
        if (strNode && propIri) {
          const rawVal = getNodeText(strNode, ctx);
          const cleanVal = rawVal.startsWith('"') && rawVal.endsWith('"') ? rawVal.slice(1, -1) : rawVal;
          const ranges = dataPropRanges.get(propIri) ?? [];
          for (const dt of ranges) {
            if (!isValidLexicalValueForDatatype(cleanVal, dt)) {
              emit(Owl2ErrorCode.DATATYPE_LITERAL_MISMATCH, strNode, [cleanVal, dt], propIri);
            }
          }
        }
        break;
      }

      case "ClassAssertionAxiom": {
        const exprs = getExpressionChildNodes(node);
        if (exprs[0]) checkClassExpressionRole(exprs[0], "ClassAssertion");
        if (exprs[1]) {
          const indIri = normalizeIri(getNodeText(exprs[1], ctx), ctx);
          checkEntityDeclared(indIri, "NamedIndividual", exprs[1]);
        }
        break;
      }

      case "SameIndividualAxiom":
      case "DifferentIndividualsAxiom": {
        const construct = t === "SameIndividualAxiom" ? "SameIndividual" : "DifferentIndividuals";
        const seen = new Set<string>();
        for (const iriNode of getDirectIriNodes(node)) {
          const indIri = normalizeIri(getNodeText(iriNode, ctx), ctx);
          checkEntityDeclared(indIri, "NamedIndividual", iriNode);
          if (indIri) {
            if (seen.has(indIri)) {
              emit(Owl2ErrorCode.SELF_REFERENTIAL_AXIOM, node, [construct, indIri], indIri);
            }
            seen.add(indIri);
          }
        }
        break;
      }
    }

    for (const child of getNodeChildren(node)) {
      walkValidate(child);
    }
  };
  walkValidate(rootNode);

  // -------------------------------------------------------------------------
  // Pass 5: Cycle Detection on Property & Class Hierarchies (O4003, O4004)
  // -------------------------------------------------------------------------
  const detectGraphCycles = (edges: ReadonlyMap<string, ReadonlySet<string>>, def: Owl2ErrorCodeDef): void => {
    const reportedCycles = new Set<string>();
    for (const startNode of edges.keys()) {
      const path: string[] = [startNode];
      const onPath = new Set<string>([startNode]);

      const dfs = (curr: string): void => {
        const nexts = edges.get(curr);
        if (!nexts) return;
        for (const nxt of nexts) {
          if (nxt === curr) continue;
          if (nxt === startNode && path.length >= 2) {
            const minElem = [...path].sort()[0]!;
            const minIdx = path.indexOf(minElem);
            const canonical = [...path.slice(minIdx), ...path.slice(0, minIdx)];
            const cycleKey = canonical.join(" -> ");
            if (!reportedCycles.has(cycleKey)) {
              reportedCycles.add(cycleKey);
              const cycleStr = `${canonical.join(" -> ")} -> ${canonical[0]}`;
              const targetNode = firstAxiomNodeByIri.get(canonical[0]!) ?? rootNode;
              emit(def, targetNode, [cycleStr], canonical[0]);
            }
          } else if (!onPath.has(nxt) && path.length < 16) {
            onPath.add(nxt);
            path.push(nxt);
            dfs(nxt);
            path.pop();
            onPath.delete(nxt);
          }
        }
      };
      dfs(startNode);
    }
  };

  detectGraphCycles(subObjectPropEdges, Owl2ErrorCode.PROPERTY_HIERARCHY_CYCLE);
  detectGraphCycles(subDataPropEdges, Owl2ErrorCode.PROPERTY_HIERARCHY_CYCLE);
  detectGraphCycles(subClassEdges, Owl2ErrorCode.CLASS_HIERARCHY_CYCLE);

  // -------------------------------------------------------------------------
  // Pass 6: Logical Consistency & Satisfiability via WasmOntologyReasoner (O5xxx)
  // -------------------------------------------------------------------------
  if (options?.checkConsistency !== false) {
    const axioms = lowerCstToAxioms(rootNode, sourceText);
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology(axioms);
    reasoner.classify();

    // Check TBox Unsatisfiable Classes (O5003):
    // 1. SubClassOf(C, owl:Nothing)
    // 2. Class C inherits from two disjoint classes A and B
    // 3. Class C has minCardinality > maxCardinality on the same property
    // 4. Class C has ObjectSomeValuesFrom(P, Filler) where Filler is disjoint with ObjectPropertyRange(P, R)
    //    or C is disjoint with ObjectPropertyDomain(P, D)
    const disjointClassPairs = new Set<string>();
    for (const ax of axioms) {
      if (ax.type === "DisjointClasses") {
        for (let i = 0; i < ax.classIris.length; i++) {
          for (let j = i + 1; j < ax.classIris.length; j++) {
            const a = ax.classIris[i]!;
            const b = ax.classIris[j]!;
            disjointClassPairs.add(a < b ? `${a}|${b}` : `${b}|${a}`);
          }
        }
      }
    }

    const areClassesDisjoint = (c1: string, c2: string): boolean => {
      if (c1 === "owl:Nothing" || c2 === "owl:Nothing") return true;
      const sups1 = [c1, ...reasoner.getSuperClasses(c1)];
      const sups2 = [c2, ...reasoner.getSuperClasses(c2)];
      for (const s1 of sups1) {
        for (const s2 of sups2) {
          const key = s1 < s2 ? `${s1}|${s2}` : `${s2}|${s1}`;
          if (disjointClassPairs.has(key)) return true;
        }
      }
      return false;
    };

    const unsatisfiableClasses = new Set<string>(["owl:Nothing"]);
    const allClassCandidates = new Set<string>([...declaredClasses.keys(), ...subClassEdges.keys()]);
    for (const ax of axioms) {
      if (ax.type === "SubClassOf") {
        allClassCandidates.add(ax.subClassIri);
      } else if (ax.type === "ObjectSomeValuesFrom" && ax.subClassIri) {
        allClassCandidates.add(ax.subClassIri);
      } else if (ax.type === "QualifiedCardinality") {
        allClassCandidates.add(ax.classIri);
      }
    }

    for (const cls of allClassCandidates) {
      if (cls === "owl:Nothing" || cls === "owl:Thing") continue;
      const sups = reasoner.getSuperClasses(cls);
      const targetNode = declaredClasses.get(cls) ?? firstAxiomNodeByIri.get(cls) ?? rootNode;

      if (sups.includes("owl:Nothing")) {
        unsatisfiableClasses.add(cls);
        emit(Owl2ErrorCode.UNSATISFIABLE_CLASS, targetNode, [cls, `SubClassOf(${cls} owl:Nothing) holds`], cls);
        continue;
      }

      const allTypes = [cls, ...sups];
      let foundDisjoint = false;
      for (let i = 0; i < allTypes.length && !foundDisjoint; i++) {
        for (let j = i + 1; j < allTypes.length; j++) {
          const a = allTypes[i]!;
          const b = allTypes[j]!;
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          if (disjointClassPairs.has(key)) {
            unsatisfiableClasses.add(cls);
            emit(
              Owl2ErrorCode.UNSATISFIABLE_CLASS,
              targetNode,
              [cls, `'${cls}' is a subclass of disjoint classes '${a}' and '${b}'`],
              cls,
            );
            foundDisjoint = true;
            break;
          }
        }
      }
    }

    // Check contradictory cardinality bounds on the same class & property (min > max)
    const cardBounds = new Map<string, { min: number; max: number; classIri: string; propIri: string }>();
    for (const ax of axioms) {
      if (ax.type === "QualifiedCardinality") {
        const key = `${ax.classIri}|${ax.propertyIri}|${ax.fillerClassIri ?? "*"}`;
        const b = cardBounds.get(key) ?? {
          min: 0,
          max: Infinity,
          classIri: ax.classIri,
          propIri: ax.propertyIri,
        };
        if (ax.cardinalityType === "min" || ax.cardinalityType === "exact") {
          b.min = Math.max(b.min, ax.count);
        }
        if (ax.cardinalityType === "max" || ax.cardinalityType === "exact") {
          b.max = Math.min(b.max, ax.count);
        }
        cardBounds.set(key, b);
      }
    }
    for (const b of cardBounds.values()) {
      if (b.min > b.max) {
        unsatisfiableClasses.add(b.classIri);
        const targetNode = declaredClasses.get(b.classIri) ?? firstAxiomNodeByIri.get(b.classIri) ?? rootNode;
        emit(
          Owl2ErrorCode.UNSATISFIABLE_CLASS,
          targetNode,
          [b.classIri, `contradictory cardinality restrictions on '${b.propIri}' (min ${b.min} > max ${b.max})`],
          b.classIri,
        );
      }
    }

    // Check existential restrictions with unsatisfiable filler or domain/range clash
    for (const ax of axioms) {
      if (ax.type === "ObjectSomeValuesFrom" && ax.subClassIri && ax.subClassIri !== "owl:Thing") {
        const cls = ax.subClassIri;
        const targetNode = declaredClasses.get(cls) ?? firstAxiomNodeByIri.get(cls) ?? rootNode;
        if (unsatisfiableClasses.has(ax.fillerClassIri)) {
          unsatisfiableClasses.add(cls);
          emit(
            Owl2ErrorCode.UNSATISFIABLE_CLASS,
            targetNode,
            [
              cls,
              `ObjectSomeValuesFrom(${ax.propertyIri} ${ax.fillerClassIri}) has unsatisfiable filler '${ax.fillerClassIri}'`,
            ],
            cls,
          );
        }
        const doms = objectPropDomains.get(ax.propertyIri);
        if (doms) {
          for (const dom of doms) {
            if (areClassesDisjoint(cls, dom)) {
              unsatisfiableClasses.add(cls);
              emit(
                Owl2ErrorCode.UNSATISFIABLE_CLASS,
                targetNode,
                [cls, `'${cls}' uses property '${ax.propertyIri}' whose domain '${dom}' is disjoint with '${cls}'`],
                cls,
              );
            }
          }
        }
        const rngs = objectPropRanges.get(ax.propertyIri);
        if (rngs) {
          for (const rng of rngs) {
            if (areClassesDisjoint(ax.fillerClassIri, rng)) {
              unsatisfiableClasses.add(cls);
              emit(
                Owl2ErrorCode.UNSATISFIABLE_CLASS,
                targetNode,
                [
                  cls,
                  `ObjectSomeValuesFrom(${ax.propertyIri} ${ax.fillerClassIri}) filler '${ax.fillerClassIri}' is disjoint with property range '${rng}'`,
                ],
                cls,
              );
            }
          }
        }
      }
    }

    const consistency = reasoner.checkConsistency();
    if (!consistency.isConsistent) {
      const conflicts = consistency.conflictingAxioms ?? [];

      // Check for O5002 (NegativeAssertionClash)
      for (const c of conflicts) {
        if (c.type === "NegativeObjectPropertyAssertion") {
          emit(
            Owl2ErrorCode.NEGATIVE_ASSERTION_CLASH,
            rootNode,
            [c.propertyIri, c.subjectIri, c.objectIri],
            c.subjectIri,
          );
        } else if (c.type === "NegativeDataPropertyAssertion") {
          emit(
            Owl2ErrorCode.NEGATIVE_ASSERTION_CLASH,
            rootNode,
            [c.propertyIri, c.subjectIri, `"${c.value}"`],
            c.subjectIri,
          );
        } else if (c.type === "FunctionalDataProperty") {
          emit(
            Owl2ErrorCode.FUNCTIONAL_PROPERTY_CLASH,
            rootNode,
            [c.propertyIri, "multiple distinct data values asserted for the same subject"],
            c.propertyIri,
          );
        }
      }

      // Check if functional/inverse-functional object property unification caused SameIndividual + DifferentIndividuals clash
      const hasDiffSameClash =
        conflicts.some((c) => c.type === "DifferentIndividuals") && conflicts.some((c) => c.type === "SameIndividual");
      if (hasDiffSameClash) {
        for (const ax of axioms) {
          if (ax.type === "FunctionalObjectProperty" || ax.type === "InverseFunctionalObjectProperty") {
            emit(
              Owl2ErrorCode.FUNCTIONAL_PROPERTY_CLASH,
              rootNode,
              [
                ax.propertyIri,
                `${ax.type}(${ax.propertyIri}) unifies individuals that are declared DifferentIndividuals`,
              ],
              ax.propertyIri,
            );
          }
        }
      }

      const explanation = consistency.explanation ?? "Logical contradiction detected in ontology axioms.";
      emit(Owl2ErrorCode.ONTOLOGY_INCONSISTENT, rootNode, [explanation]);
    }
  }

  return diagnostics;
}

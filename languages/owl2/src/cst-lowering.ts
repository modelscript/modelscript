// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OWL2Axiom } from "@modelscript/runtime";

/**
 * Generic AST/CST node representation compatible with WASM parser nodes
 * and lightweight parse trees.
 */
export interface GenericSyntaxNode {
  type: string;
  text?: string | undefined;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  isError?: boolean | undefined;
  hasError?: boolean | (() => boolean) | undefined;
  children?: GenericSyntaxNode[] | undefined;
  childCount?: number | undefined;
  child?: ((index: number) => GenericSyntaxNode | null) | undefined;
  getFirstChild?: (() => GenericSyntaxNode | null) | undefined;
  getNextSibling?: (() => GenericSyntaxNode | null) | undefined;
  getTypeId?: (() => number) | undefined;
}

export type CstNodeLike = GenericSyntaxNode;

/**
 * Configuration options for OWL 2 Functional-Style Syntax CST lowering.
 */
export interface LoweringOptions {
  /**
   * When true, expands abbreviated IRIs (`:Car`, `ex:Car`) into full IRIs
   * (`http://example.org/test#Car`) using declared and built-in prefixes.
   * When false (default), compacts full IRIs (`<http://example.org/test#Car>`)
   * that match a declared prefix into their abbreviated form (`:Car`) so that
   * mixed full/abbreviated IRIs in the same ontology unify to a single canonical IRI.
   */
  expandPrefixes?: boolean | undefined;
}

/**
 * Stateful context passed through the prefix and axiom CST traversal passes.
 */
export interface LoweringContext {
  sourceText?: string | undefined;
  prefixes: Map<string, string>;
  userPrefixes: Map<string, string>;
  expandPrefixes: boolean;
  auxCounter?: number | undefined;
}

/**
 * Standard W3C built-in prefix declarations implicitly available in every OWL 2 ontology.
 */
export const BUILTIN_OWL2_PREFIXES: readonly (readonly [string, string])[] = [
  ["owl:", "http://www.w3.org/2002/07/owl#"],
  ["rdf:", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"],
  ["rdfs:", "http://www.w3.org/2000/01/rdf-schema#"],
  ["xsd:", "http://www.w3.org/2001/XMLSchema#"],
];

/**
 * Extracts prefix declarations (`Prefix(: = <...>)`) from a parsed OWL 2 CST,
 * merged on top of the standard built-in OWL 2 prefixes (`owl:`, `rdf:`, `rdfs:`, `xsd:`).
 */
export function extractOwl2Prefixes(rootNode: GenericSyntaxNode, sourceText?: string): Map<string, string> {
  const ctx: LoweringContext = {
    sourceText,
    prefixes: new Map(BUILTIN_OWL2_PREFIXES),
    userPrefixes: new Map(),
    expandPrefixes: false,
    auxCounter: 0,
  };
  walkForPrefixes(rootNode, ctx);
  return ctx.prefixes;
}

/**
 * Expands an OWL 2 abbreviated IRI or strips angle brackets from a full IRI
 * using the provided prefix map.
 */
export function expandOwl2Iri(rawIri: string, prefixes: ReadonlyMap<string, string>): string {
  const clean = rawIri.trim();
  if (clean.startsWith("<") && clean.endsWith(">")) {
    return clean.slice(1, -1);
  }
  const colonIdx = clean.indexOf(":");
  if (colonIdx !== -1 && !clean.includes("//")) {
    const prefixKey = clean.slice(0, colonIdx + 1);
    const localName = clean.slice(colonIdx + 1);
    const baseIri = prefixes.get(prefixKey);
    if (baseIri !== undefined) {
      return `${baseIri}${localName}`;
    }
  }
  return clean;
}

/**
 * Lowers a parsed OWL 2 Functional-Style Syntax CST into typed OWL2Axiom records.
 * Covers all 27 OWL 2 Functional-Style Syntax axiom productions in the grammar,
 * with recursive Tseitin / $\mathcal{SROIQ}$ normalization for nested class expressions
 * and General Concept Inclusions (GCIs).
 */
export function lowerCstToAxioms(
  rootNode: GenericSyntaxNode,
  sourceText?: string,
  options?: LoweringOptions,
): OWL2Axiom[] {
  const axioms: OWL2Axiom[] = [];
  const ctx: LoweringContext = {
    sourceText,
    prefixes: new Map(BUILTIN_OWL2_PREFIXES),
    userPrefixes: new Map(),
    expandPrefixes: options?.expandPrefixes ?? false,
    auxCounter: 0,
  };

  walkForPrefixes(rootNode, ctx);
  walkForAxioms(rootNode, ctx, axioms);

  return axioms;
}

/**
 * Returns the direct child nodes of a `GenericSyntaxNode`, supporting both array-based
 * `children` and indexed `child(i)` / `childCount` WASM parser cursors.
 */
export function getNodeChildren(node: GenericSyntaxNode): GenericSyntaxNode[] {
  if (Array.isArray(node.children)) {
    return node.children;
  }
  if (typeof node.childCount === "number" && typeof node.child === "function") {
    const list: GenericSyntaxNode[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      if (c) list.push(c);
    }
    return list;
  }
  return [];
}

/**
 * Extracts the trimmed source text of a syntax node via direct `.text`, byte/offset slicing,
 * or recursive child concatenation.
 */
export function getNodeText(node: GenericSyntaxNode, ctx: { sourceText?: string | undefined }): string {
  if (node.text !== undefined) {
    return node.text.trim();
  }
  const start = node.startIndex ?? node.startOffset;
  const end = node.endIndex ?? node.endOffset;
  if (ctx.sourceText !== undefined && typeof start === "number" && typeof end === "number") {
    return ctx.sourceText.slice(start, end).trim();
  }
  const children = getNodeChildren(node);
  if (children.length > 0) {
    return children
      .map((c) => getNodeText(c, ctx))
      .filter(Boolean)
      .join(" ")
      .trim();
  }
  return "";
}

/**
 * Normalizes a raw IRI token into a canonical identifier according to `ctx.expandPrefixes`,
 * unifying full IRIs (`<http://...>`) and abbreviated IRIs (`prefix:Local`) that refer to the same entity.
 */
export function normalizeIri(rawText: string, ctx: LoweringContext): string {
  const clean = rawText.trim();
  if (!clean) return "";

  if (ctx.expandPrefixes) {
    return expandOwl2Iri(clean, ctx.prefixes);
  }

  if (clean.startsWith("<") && clean.endsWith(">")) {
    const fullIri = clean.slice(1, -1);
    // Unify full IRIs that match a declared prefix in this document (or built-in owl:/rdf:/rdfs:/xsd:)
    // with their abbreviated form so `<http://example.org/test#Car>` and `:Car` resolve to the same ID.
    let bestPrefix: string | null = null;
    let bestBaseLen = -1;
    for (const [prefixKey, baseIri] of ctx.userPrefixes) {
      if (fullIri.startsWith(baseIri) && fullIri.length > baseIri.length && baseIri.length > bestBaseLen) {
        const local = fullIri.slice(baseIri.length);
        if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(local)) {
          bestPrefix = `${prefixKey}${local}`;
          bestBaseLen = baseIri.length;
        }
      }
    }
    if (bestPrefix !== null) {
      return bestPrefix;
    }
    for (const [prefixKey, baseIri] of BUILTIN_OWL2_PREFIXES) {
      if (fullIri.startsWith(baseIri) && fullIri.length > baseIri.length) {
        const local = fullIri.slice(baseIri.length);
        if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(local)) {
          return `${prefixKey}${local}`;
        }
      }
    }
    return fullIri;
  }

  return clean;
}

/**
 * Pre-pass that walks the CST to collect `PrefixDeclaration` mappings into `ctx.prefixes` and `ctx.userPrefixes`.
 */
function walkForPrefixes(node: GenericSyntaxNode, ctx: LoweringContext): void {
  if (node.type === "PrefixDeclaration") {
    const children = getNodeChildren(node);
    let prefixName = ":";
    let targetIri = "";

    for (const child of children) {
      if (child.type === "PrefixName") {
        const rawPrefix = getNodeText(child, ctx);
        prefixName = rawPrefix.endsWith(":") ? rawPrefix : `${rawPrefix}:`;
      } else if (child.type === "FullIRI" || child.type === "IRI") {
        const rawTarget = getNodeText(child, ctx).trim();
        targetIri = rawTarget.startsWith("<") && rawTarget.endsWith(">") ? rawTarget.slice(1, -1) : rawTarget;
      }
    }
    if (targetIri) {
      ctx.prefixes.set(prefixName, targetIri);
      ctx.userPrefixes.set(prefixName, targetIri);
    }
    return;
  }

  for (const child of getNodeChildren(node)) {
    walkForPrefixes(child, ctx);
  }
}

/**
 * Recursively traverses the CST and lowers each OWL 2 axiom node into its corresponding
 * runtime `OWL2Axiom` representation for the tableau/consequence reasoner.
 */
function walkForAxioms(node: GenericSyntaxNode, ctx: LoweringContext, out: OWL2Axiom[]): void {
  const t = node.type;

  switch (t) {
    case "Declaration": {
      const entityNode = getNodeChildren(node).find((c) =>
        ["ClassEntity", "ObjectPropertyEntity", "DataPropertyEntity", "NamedIndividualEntity"].includes(c.type),
      );
      if (entityNode) {
        const iriNode = getNodeChildren(entityNode).find(
          (c) => c.type === "IRI" || c.type === "FullIRI" || c.type === "AbbreviatedIRI",
        );
        const iri = iriNode ? normalizeIri(getNodeText(iriNode, ctx), ctx) : (getIris(entityNode, ctx)[0] ?? "");
        if (iri) {
          if (entityNode.type === "ClassEntity") {
            out.push({ type: "ClassDeclaration", iri, sourceLang: "owl2" });
          } else if (entityNode.type === "ObjectPropertyEntity") {
            out.push({ type: "ObjectPropertyDeclaration", iri, sourceLang: "owl2" });
          } else if (entityNode.type === "DataPropertyEntity") {
            out.push({ type: "DataPropertyDeclaration", iri, sourceLang: "owl2" });
          } else if (entityNode.type === "NamedIndividualEntity") {
            out.push({ type: "IndividualDeclaration", iri, sourceLang: "owl2" });
          }
        }
      }
      return;
    }

    case "SubClassOfAxiom": {
      const exprs = getMeaningfulExpressions(node, ctx);
      if (exprs.length >= 2) {
        const subClass = unwrapClassExprNode(exprs[0]!);
        const superClass = unwrapClassExprNode(exprs[1]!);

        // Lower `SubClassOf(ObjectUnionOf(A B ...) Super)` into a DisjunctiveClass axiom
        if (cleanNodeType(subClass) === "ObjectUnionOf") {
          const unionOps = getClassExprOperands(subClass, ctx);
          const unionIris = unionOps.map((op) => normalizeClassExprToIri(op, ctx, out)).filter(Boolean);
          const supIri = normalizeClassExprToIri(superClass, ctx, out);
          if (unionIris.length >= 1 && supIri) {
            out.push({
              type: "DisjunctiveClass",
              superClassIri: supIri,
              classIris: unionIris,
              sourceLang: "owl2",
            });
            return;
          }
        }

        const subIri = normalizeClassExprToIri(subClass, ctx, out);
        const superKind = cleanNodeType(superClass);

        if (
          superKind === "ObjectSomeValuesFrom" ||
          superKind === "DataSomeValuesFrom" ||
          superKind === "ObjectAllValuesFrom" ||
          superKind === "DataAllValuesFrom" ||
          superKind === "ObjectHasSelf" ||
          superKind === "ObjectHasValue" ||
          superKind === "ObjectOneOf" ||
          superKind === "ObjectMinCardinality" ||
          superKind === "ObjectMaxCardinality" ||
          superKind === "ObjectExactCardinality" ||
          superKind === "DataMinCardinality" ||
          superKind === "DataMaxCardinality" ||
          superKind === "DataExactCardinality"
        ) {
          lowerComplexClassRestriction(subIri, superClass, ctx, out, false);
        } else {
          const supIri = normalizeClassExprToIri(superClass, ctx, out);
          out.push({
            type: "SubClassOf",
            subClassIri: subIri,
            superClassIri: supIri,
            sourceLang: "owl2",
          });
        }
      }
      return;
    }

    case "EquivalentClassesAxiom": {
      const exprs = getMeaningfulExpressions(node, ctx).map(unwrapClassExprNode);
      // Special-case `EquivalentClasses(C ObjectOneOf(i1 i2 ...))` into an ObjectOneOf enumeration axiom
      if (exprs.length === 2) {
        const oneOfIdx = exprs.findIndex((e) => cleanNodeType(e) === "ObjectOneOf");
        if (oneOfIdx !== -1) {
          const otherExpr = exprs[oneOfIdx === 0 ? 1 : 0]!;
          const oneOfExpr = exprs[oneOfIdx]!;
          const classIri = normalizeClassExprToIri(otherExpr, ctx, out);
          const individualIris = getIris(oneOfExpr, ctx);
          if (classIri && individualIris.length > 0) {
            out.push({
              type: "ObjectOneOf",
              classIri,
              individualIris,
              sourceLang: "owl2",
            });
            return;
          }
        }
      }
      const iris = exprs.map((c) => normalizeClassExprToIri(c, ctx, out)).filter(Boolean);
      if (iris.length >= 2) {
        out.push({ type: "EquivalentClasses", classIris: iris, sourceLang: "owl2" });
      }
      return;
    }

    case "DisjointClassesAxiom": {
      const iris = getMeaningfulExpressions(node, ctx)
        .map((c) => normalizeClassExprToIri(c, ctx, out))
        .filter(Boolean);
      if (iris.length >= 2) {
        out.push({ type: "DisjointClasses", classIris: iris, sourceLang: "owl2" });
      }
      return;
    }

    case "SubObjectPropertyOfAxiom": {
      const chainNode = getNodeChildren(node).find((c) => c.type === "ObjectPropertyChain");
      const iris = getIris(node, ctx);
      if (chainNode && iris.length >= 1) {
        const chainIris = getIris(chainNode, ctx);
        if (chainIris.length >= 2) {
          out.push({
            type: "SubObjectPropertyChainOf" as unknown as "SubObjectPropertyOf",
            subPropertyIri: chainIris[0]!,
            superPropertyIri: iris[0]!,
            propertyChainIris: chainIris,
            sourceLang: "owl2",
          } as unknown as OWL2Axiom);
          return;
        }
      }
      if (iris.length >= 2) {
        out.push({
          type: "SubObjectPropertyOf",
          subPropertyIri: iris[0]!,
          superPropertyIri: iris[1]!,
          sourceLang: "owl2",
        });
      }
      return;
    }

    case "SubDataPropertyOfAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 2) {
        out.push({
          type: "SubDataPropertyOf",
          subPropertyIri: iris[0]!,
          superPropertyIri: iris[1]!,
          sourceLang: "owl2",
        });
      }
      return;
    }

    case "ObjectPropertyAssertionAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 3) {
        out.push({
          type: "ObjectPropertyAssertion",
          propertyIri: iris[0]!,
          subjectIri: iris[1]!,
          objectIri: iris[2]!,
          sourceLang: "owl2",
        });
      }
      return;
    }

    case "DataPropertyAssertionAxiom": {
      const iris = getIris(node, ctx);
      const strNode = getNodeChildren(node).find((c) => c.type === "StringLiteral");
      const val = strNode ? cleanString(getNodeText(strNode, ctx)) : "";
      if (iris.length >= 2) {
        out.push({
          type: "DataPropertyAssertion",
          propertyIri: iris[0]!,
          subjectIri: iris[1]!,
          value: val,
          sourceLang: "owl2",
        });
      }
      return;
    }

    case "NegativeObjectPropertyAssertionAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 3) {
        out.push({
          type: "NegativeObjectPropertyAssertion",
          propertyIri: iris[0]!,
          subjectIri: iris[1]!,
          objectIri: iris[2]!,
          sourceLang: "owl2",
        });
      }
      return;
    }

    case "NegativeDataPropertyAssertionAxiom": {
      const iris = getIris(node, ctx);
      const strNode = getNodeChildren(node).find((c) => c.type === "StringLiteral");
      const val = strNode ? cleanString(getNodeText(strNode, ctx)) : "";
      if (iris.length >= 2) {
        out.push({
          type: "NegativeDataPropertyAssertion",
          propertyIri: iris[0]!,
          subjectIri: iris[1]!,
          value: val,
          sourceLang: "owl2",
        });
      }
      return;
    }

    case "ClassAssertionAxiom": {
      const children = getMeaningfulExpressions(node, ctx);
      if (children.length >= 2) {
        out.push({
          type: "ClassAssertion",
          classIri: normalizeClassExprToIri(children[0]!, ctx, out),
          individualIri: normalizeIri(getNodeText(children[1]!, ctx), ctx),
          sourceLang: "owl2",
        });
      }
      return;
    }

    case "TransitiveObjectPropertyAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 1) {
        out.push({ type: "TransitiveObjectProperty", propertyIri: iris[0]!, sourceLang: "owl2" });
      }
      return;
    }

    case "FunctionalObjectPropertyAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 1) {
        out.push({ type: "FunctionalObjectProperty", propertyIri: iris[0]!, sourceLang: "owl2" });
      }
      return;
    }

    case "FunctionalDataPropertyAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 1) {
        out.push({ type: "FunctionalDataProperty", propertyIri: iris[0]!, sourceLang: "owl2" });
      }
      return;
    }

    case "InverseFunctionalObjectPropertyAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 1) {
        out.push({
          type: "InverseFunctionalObjectProperty",
          propertyIri: iris[0]!,
          sourceLang: "owl2",
        });
      }
      return;
    }

    case "ReflexiveObjectPropertyAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 1) {
        out.push({
          type: "ReflexiveObjectProperty",
          propertyIri: iris[0]!,
          sourceLang: "owl2",
        });
      }
      return;
    }

    case "SymmetricObjectPropertyAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 1) {
        out.push({ type: "SymmetricObjectProperty", propertyIri: iris[0]!, sourceLang: "owl2" });
      }
      return;
    }

    case "AsymmetricObjectPropertyAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 1) {
        out.push({ type: "AsymmetricObjectProperty", propertyIri: iris[0]!, sourceLang: "owl2" });
      }
      return;
    }

    case "IrreflexiveObjectPropertyAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 1) {
        out.push({ type: "IrreflexiveObjectProperty", propertyIri: iris[0]!, sourceLang: "owl2" });
      }
      return;
    }

    case "InverseObjectPropertiesAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 2) {
        out.push({
          type: "InverseObjectProperty",
          propertyIri: iris[0]!,
          inversePropertyIri: iris[1]!,
          sourceLang: "owl2",
        });
      }
      return;
    }

    case "DisjointObjectPropertiesAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 2) {
        out.push({ type: "DisjointObjectProperties", propertyIris: iris, sourceLang: "owl2" });
      }
      return;
    }

    case "SameIndividualAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 2) {
        out.push({ type: "SameIndividual", individualIris: iris, sourceLang: "owl2" });
      }
      return;
    }

    case "DifferentIndividualsAxiom": {
      const iris = getIris(node, ctx);
      if (iris.length >= 2) {
        out.push({ type: "DifferentIndividuals", individualIris: iris, sourceLang: "owl2" });
      }
      return;
    }

    case "ObjectPropertyDomainAxiom": {
      const children = getMeaningfulExpressions(node, ctx);
      if (children.length >= 2) {
        const propIri = normalizeIri(getNodeText(children[0]!, ctx), ctx);
        const domainIri = normalizeClassExprToIri(children[1]!, ctx, out);
        out.push({
          type: "ObjectPropertyDomain",
          propertyIri: propIri,
          domainIri,
          sourceLang: "owl2",
        });
      }
      return;
    }

    case "ObjectPropertyRangeAxiom": {
      const children = getMeaningfulExpressions(node, ctx);
      if (children.length >= 2) {
        const propIri = normalizeIri(getNodeText(children[0]!, ctx), ctx);
        const rangeIri = normalizeClassExprToIri(children[1]!, ctx, out);
        out.push({
          type: "ObjectPropertyRange",
          propertyIri: propIri,
          rangeIri,
          sourceLang: "owl2",
        });
      }
      return;
    }

    case "DataPropertyDomainAxiom": {
      const children = getMeaningfulExpressions(node, ctx);
      if (children.length >= 2) {
        const propIri = normalizeIri(getNodeText(children[0]!, ctx), ctx);
        const domainIri = normalizeClassExprToIri(children[1]!, ctx, out);
        out.push({
          type: "DataPropertyDomain",
          propertyIri: propIri,
          domainIri,
          sourceLang: "owl2",
        });
      }
      return;
    }

    case "DataPropertyRangeAxiom": {
      const children = getMeaningfulExpressions(node, ctx);
      if (children.length >= 2) {
        const propIri = normalizeIri(getNodeText(children[0]!, ctx), ctx);
        const rangeIri = normalizeIri(getNodeText(children[1]!, ctx), ctx);
        out.push({
          type: "DataPropertyRange",
          propertyIri: propIri,
          rangeIri,
          sourceLang: "owl2",
        });
      }
      return;
    }
  }

  for (const child of getNodeChildren(node)) {
    walkForAxioms(child, ctx, out);
  }
}

/**
 * Set of complex OWL 2 class expression non-terminal types eligible for Tseitin normalization.
 */
const COMPLEX_CLASS_EXPR_TYPES = new Set([
  "ObjectIntersectionOf",
  "ObjectUnionOf",
  "ObjectComplementOf",
  "ObjectSomeValuesFrom",
  "ObjectAllValuesFrom",
  "ObjectHasSelf",
  "ObjectHasValue",
  "ObjectOneOf",
  "ObjectMinCardinality",
  "ObjectMaxCardinality",
  "ObjectExactCardinality",
  "DataSomeValuesFrom",
  "DataAllValuesFrom",
  "DataMinCardinality",
  "DataMaxCardinality",
  "DataExactCardinality",
  "DataHasValue",
]);

function unwrapClassExprNode(node: GenericSyntaxNode): GenericSyntaxNode {
  let curr = node;
  while (cleanNodeType(curr) === "_ClassExpression") {
    const children = getNodeChildren(curr).filter((c) => {
      const t = cleanNodeType(c);
      return t !== "(" && t !== ")" && !AXIOM_KEYWORDS.has(t);
    });
    if (children.length === 1) {
      curr = children[0]!;
    } else {
      break;
    }
  }
  return curr;
}

function isComplexClassExpr(node: GenericSyntaxNode): boolean {
  const unwrapped = unwrapClassExprNode(node);
  return COMPLEX_CLASS_EXPR_TYPES.has(cleanNodeType(unwrapped)) && getNodeChildren(unwrapped).length > 0;
}

function getClassExprOperands(node: GenericSyntaxNode, _ctx: LoweringContext): GenericSyntaxNode[] {
  const unwrapped = unwrapClassExprNode(node);
  return getNodeChildren(unwrapped).filter((c) => {
    const t = cleanNodeType(c);
    if (AXIOM_KEYWORDS.has(t) || t.endsWith("Axiom")) return false;
    if (getNodeChildren(c).length === 0 && COMPLEX_CLASS_EXPR_TYPES.has(t)) return false;
    return true;
  });
}

/**
 * Recursively normalizes a class expression node into an atomic class IRI,
 * introducing fresh `__aux_N` auxiliary concept declarations and structural
 * $\mathcal{SROIQ}$ axioms when `rawNode` is a complex class expression.
 */
export function normalizeClassExprToIri(rawNode: GenericSyntaxNode, ctx: LoweringContext, out: OWL2Axiom[]): string {
  const node = unwrapClassExprNode(rawNode);
  if (!isComplexClassExpr(node)) {
    return normalizeIri(getNodeText(node, ctx), ctx);
  }
  ctx.auxCounter = (ctx.auxCounter ?? 0) + 1;
  const auxIri = `__aux_${ctx.auxCounter}`;
  lowerComplexClassRestriction(auxIri, node, ctx, out, true);
  return auxIri;
}

function lowerComplexClassRestriction(
  targetClassIri: string,
  rawExprNode: GenericSyntaxNode,
  ctx: LoweringContext,
  out: OWL2Axiom[],
  isAuxDefinition: boolean,
): void {
  const exprNode = unwrapClassExprNode(rawExprNode);
  const kind = cleanNodeType(exprNode);
  const operands = getClassExprOperands(exprNode, ctx);

  let declAxiom: Record<string, unknown> | undefined;
  if (isAuxDefinition) {
    declAxiom = { type: "ClassDeclaration", iri: targetClassIri, sourceLang: "owl2" };
    out.push(declAxiom as unknown as OWL2Axiom);
  }

  switch (kind) {
    case "ObjectIntersectionOf": {
      const opIris = operands.map((op) => normalizeClassExprToIri(op, ctx, out)).filter(Boolean);
      if (declAxiom) declAxiom["intersectionOf"] = opIris;
      for (const opIri of opIris) {
        out.push({
          type: "SubClassOf",
          subClassIri: targetClassIri,
          superClassIri: opIri,
          sourceLang: "owl2",
        });
      }
      break;
    }

    case "ObjectUnionOf": {
      const opIris = operands.map((op) => normalizeClassExprToIri(op, ctx, out)).filter(Boolean);
      if (declAxiom) declAxiom["unionOf"] = opIris;
      if (opIris.length >= 1) {
        out.push({
          type: "DisjunctiveClass",
          superClassIri: targetClassIri,
          classIris: opIris,
          sourceLang: "owl2",
          ...(isAuxDefinition ? { unionEquiv: true } : {}),
        } as unknown as OWL2Axiom);
      }
      break;
    }

    case "ObjectComplementOf": {
      const opNode = operands[0];
      if (opNode) {
        const opIri = normalizeClassExprToIri(opNode, ctx, out);
        if (opIri) {
          if (declAxiom) declAxiom["complementOf"] = opIri;
          out.push({
            type: "DisjointClasses",
            classIris: [targetClassIri, opIri],
            sourceLang: "owl2",
          });
        }
      }
      break;
    }

    case "ObjectSomeValuesFrom": {
      if (operands.length >= 2) {
        const propIri = normalizeIri(getNodeText(operands[0]!, ctx), ctx);
        const fillerIri = normalizeClassExprToIri(operands[1]!, ctx, out);
        if (propIri && fillerIri) {
          if (declAxiom) {
            declAxiom["someValuesFrom"] = { propertyIri: propIri, fillerClassIri: fillerIri };
          }
          out.push({
            type: "ObjectSomeValuesFrom",
            subClassIri: targetClassIri || undefined,
            propertyIri: propIri,
            fillerClassIri: fillerIri,
            sourceLang: "owl2",
          });
        }
      }
      break;
    }

    case "DataSomeValuesFrom": {
      if (operands.length >= 2) {
        const propIri = normalizeIri(getNodeText(operands[0]!, ctx), ctx);
        const dataRange = normalizeIri(getNodeText(operands[1]!, ctx), ctx);
        if (propIri && dataRange) {
          out.push({
            type: "DataSomeValuesFrom",
            subClassIri: targetClassIri || undefined,
            propertyIri: propIri,
            dataRange,
            sourceLang: "owl2",
          });
        }
      }
      break;
    }

    case "ObjectAllValuesFrom":
    case "DataAllValuesFrom": {
      if (operands.length >= 2) {
        const propIri = normalizeIri(getNodeText(operands[0]!, ctx), ctx);
        const targetIri =
          kind === "ObjectAllValuesFrom"
            ? normalizeClassExprToIri(operands[1]!, ctx, out)
            : normalizeIri(getNodeText(operands[1]!, ctx), ctx);
        if (propIri && targetIri) {
          if (declAxiom && kind === "ObjectAllValuesFrom") {
            declAxiom["allValuesFrom"] = { propertyIri: propIri, targetClassIri: targetIri };
          }
          out.push({
            type: "UniversalRestriction",
            propertyIri: propIri,
            targetClassIri: targetIri,
            classIri: targetClassIri,
            sourceLang: "owl2",
          });
        }
      }
      break;
    }

    case "ObjectHasSelf": {
      const innerIris = getIris(exprNode, ctx);
      const propIri = innerIris[0] ?? (operands[0] ? normalizeIri(getNodeText(operands[0], ctx), ctx) : "");
      if (propIri) {
        out.push({
          type: "SelfRestriction",
          classIri: targetClassIri,
          propertyIri: propIri,
          sourceLang: "owl2",
        });
      }
      break;
    }

    case "ObjectHasValue": {
      const innerIris = getIris(exprNode, ctx);
      if (innerIris.length >= 2) {
        out.push({
          type: "ObjectSomeValuesFrom",
          subClassIri: targetClassIri || undefined,
          propertyIri: innerIris[0]!,
          fillerClassIri: innerIris[1]!,
          sourceLang: "owl2",
          ...({ isNominal: true } as Record<string, unknown>),
        });
      }
      break;
    }

    case "ObjectOneOf": {
      const innerIris = getIris(exprNode, ctx);
      if (innerIris.length >= 1) {
        out.push({
          type: "ObjectOneOf",
          classIri: targetClassIri,
          individualIris: innerIris,
          sourceLang: "owl2",
        });
      }
      break;
    }

    case "ObjectMinCardinality":
    case "ObjectMaxCardinality":
    case "ObjectExactCardinality":
    case "DataMinCardinality":
    case "DataMaxCardinality":
    case "DataExactCardinality": {
      const cardType =
        kind === "ObjectMinCardinality" || kind === "DataMinCardinality"
          ? "min"
          : kind === "ObjectMaxCardinality" || kind === "DataMaxCardinality"
            ? "max"
            : "exact";
      const count = getInteger(exprNode, ctx);
      const nonIntOps = operands.filter((c) => cleanNodeType(c) !== "INTEGER");
      const propIri = nonIntOps[0]
        ? normalizeIri(getNodeText(nonIntOps[0], ctx), ctx)
        : (getIris(exprNode, ctx)[0] ?? "");
      const fillerIri = nonIntOps[1]
        ? kind.startsWith("Object")
          ? normalizeClassExprToIri(nonIntOps[1], ctx, out)
          : normalizeIri(getNodeText(nonIntOps[1], ctx), ctx)
        : undefined;
      if (propIri) {
        out.push({
          type: "QualifiedCardinality",
          classIri: targetClassIri,
          propertyIri: propIri,
          cardinalityType: cardType,
          count,
          fillerClassIri: fillerIri,
          sourceLang: "owl2",
        });
      }
      break;
    }
  }
}

/** Strips surrounding double quotes from an OWL 2 `StringLiteral` token. */
function cleanString(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  return raw;
}

/** Collects and normalizes all direct IRI or `DataRange` child nodes of `node`. */
function getIris(node: GenericSyntaxNode, ctx: LoweringContext): string[] {
  const result: string[] = [];
  for (const c of getNodeChildren(node)) {
    if (c.type === "IRI" || c.type === "FullIRI" || c.type === "AbbreviatedIRI" || c.type === "DataRange") {
      const norm = normalizeIri(getNodeText(c, ctx), ctx);
      if (norm) result.push(norm);
    }
  }
  return result;
}

/** Extracts the non-negative integer cardinality argument from a cardinality restriction node. */
function getInteger(node: GenericSyntaxNode, ctx: LoweringContext): number {
  const intNode = getNodeChildren(node).find((c) => cleanNodeType(c) === "INTEGER");
  if (!intNode) return 1;
  const val = parseInt(getNodeText(intNode, ctx), 10);
  return isNaN(val) ? 1 : val;
}

/**
 * Set of OWL 2 Functional-Style Syntax punctuation and axiom keywords ignored when
 * extracting operand expressions from an axiom node.
 */
const AXIOM_KEYWORDS = new Set([
  "(",
  ")",
  "=",
  ":",
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
]);

/** Strips optional quotes from a syntax node's `.type` name. */
function cleanNodeType(node: GenericSyntaxNode): string {
  const raw = node.type;
  return raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

/**
 * Filters a node's children to only semantic operand expressions (excluding keywords and delimiters).
 */
function getMeaningfulExpressions(node: GenericSyntaxNode, _ctx: LoweringContext): GenericSyntaxNode[] {
  return getNodeChildren(node).filter((c) => {
    const t = cleanNodeType(c);
    return !AXIOM_KEYWORDS.has(t) && !t.endsWith("Axiom");
  });
}

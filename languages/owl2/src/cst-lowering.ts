// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OWL2Axiom } from "@modelscript/runtime";

/**
 * Generic AST/CST node representation compatible with tree-sitter, WASM parser nodes,
 * and lightweight parse trees.
 */
export interface GenericSyntaxNode {
  type: string;
  text?: string;
  startIndex?: number;
  endIndex?: number;
  children?: GenericSyntaxNode[];
  childCount?: number;
  child?: (index: number) => GenericSyntaxNode | null;
  getFirstChild?: () => any;
  getNextSibling?: () => any;
  getTypeId?: () => number;
}

export interface LoweringContext {
  sourceText?: string;
  prefixes: Map<string, string>;
}

/**
 * Lowers a parsed OWL 2 Functional-Style Syntax CST into typed OWL2Axiom records.
 */
export function lowerCstToAxioms(rootNode: GenericSyntaxNode, sourceText?: string): OWL2Axiom[] {
  const axioms: OWL2Axiom[] = [];
  const ctx: LoweringContext = {
    sourceText,
    prefixes: new Map([
      ["owl:", "http://www.w3.org/2002/07/owl#"],
      ["rdf:", "http://www.w3.org/1999/02/22-rdf-syntax-ns#"],
      ["rdfs:", "http://www.w3.org/2000/01/rdf-schema#"],
      ["xsd:", "http://www.w3.org/2001/XMLSchema#"],
    ]),
  };

  walkForPrefixes(rootNode, ctx);
  walkForAxioms(rootNode, ctx, axioms);

  return axioms;
}

function getNodeChildren(node: GenericSyntaxNode): GenericSyntaxNode[] {
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

function getNodeText(node: GenericSyntaxNode, ctx: LoweringContext): string {
  if (node.text !== undefined) {
    return node.text.trim();
  }
  if (ctx.sourceText !== undefined && typeof node.startIndex === "number" && typeof node.endIndex === "number") {
    return ctx.sourceText.slice(node.startIndex, node.endIndex).trim();
  }
  return "";
}

function normalizeIri(rawText: string, ctx: LoweringContext): string {
  const clean = rawText.trim();
  if (clean.startsWith("<") && clean.endsWith(">")) {
    return clean.slice(1, -1);
  }
  return clean;
}

function walkForPrefixes(node: GenericSyntaxNode, ctx: LoweringContext): void {
  if (node.type === "PrefixDeclaration") {
    const children = getNodeChildren(node);
    let prefixName = ":";
    let targetIri = "";

    for (const child of children) {
      if (child.type === "PrefixName") {
        prefixName = getNodeText(child, ctx);
      } else if (child.type === "FullIRI" || child.type === "IRI") {
        targetIri = normalizeIri(getNodeText(child, ctx), ctx);
      }
    }
    if (targetIri) {
      ctx.prefixes.set(prefixName, targetIri);
    }
    return;
  }

  for (const child of getNodeChildren(node)) {
    walkForPrefixes(child, ctx);
  }
}

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
        const iri = iriNode ? normalizeIri(getNodeText(iriNode, ctx), ctx) : "";
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
        const subClass = exprs[0]!;
        const superClass = exprs[1]!;

        // Check if superClass is a complex restriction
        if (superClass.type === "ObjectSomeValuesFrom") {
          const innerIris = getIris(superClass, ctx);
          if (innerIris.length >= 2) {
            out.push({
              type: "ObjectSomeValuesFrom",
              propertyIri: innerIris[0]!,
              fillerClassIri: innerIris[1]!,
              sourceLang: "owl2",
            });
          }
        } else if (superClass.type === "DataSomeValuesFrom") {
          const innerIris = getIris(superClass, ctx);
          if (innerIris.length >= 2) {
            out.push({
              type: "DataSomeValuesFrom",
              propertyIri: innerIris[0]!,
              dataRange: innerIris[1]!,
              sourceLang: "owl2",
            });
          }
        } else if (superClass.type === "ObjectAllValuesFrom") {
          const innerIris = getIris(superClass, ctx);
          const subIri = getNodeText(subClass, ctx);
          if (innerIris.length >= 2) {
            out.push({
              type: "UniversalRestriction",
              propertyIri: innerIris[0]!,
              targetClassIri: innerIris[1]!,
              classIri: subIri,
              sourceLang: "owl2",
            });
          }
        } else if (superClass.type === "ObjectHasSelf") {
          const innerIris = getIris(superClass, ctx);
          const subIri = getNodeText(subClass, ctx);
          if (innerIris.length >= 1) {
            out.push({
              type: "SelfRestriction",
              classIri: subIri,
              propertyIri: innerIris[0]!,
              sourceLang: "owl2",
            });
          }
        } else if (
          superClass.type === "ObjectMinCardinality" ||
          superClass.type === "ObjectMaxCardinality" ||
          superClass.type === "ObjectExactCardinality"
        ) {
          const subIri = getNodeText(subClass, ctx);
          const cardType =
            superClass.type === "ObjectMinCardinality"
              ? "min"
              : superClass.type === "ObjectMaxCardinality"
                ? "max"
                : "exact";
          const count = getInteger(superClass, ctx);
          const innerIris = getIris(superClass, ctx);
          if (innerIris.length >= 1) {
            out.push({
              type: "QualifiedCardinality",
              classIri: subIri,
              propertyIri: innerIris[0]!,
              cardinalityType: cardType,
              count,
              fillerClassIri: innerIris[1],
              sourceLang: "owl2",
            });
          }
        } else {
          out.push({
            type: "SubClassOf",
            subClassIri: normalizeIri(getNodeText(subClass, ctx), ctx),
            superClassIri: normalizeIri(getNodeText(superClass, ctx), ctx),
            sourceLang: "owl2",
          });
        }
      }
      return;
    }

    case "EquivalentClassesAxiom": {
      const iris = getMeaningfulExpressions(node, ctx).map((c) => normalizeIri(getNodeText(c, ctx), ctx));
      if (iris.length >= 2) {
        out.push({ type: "EquivalentClasses", classIris: iris, sourceLang: "owl2" });
      }
      return;
    }

    case "DisjointClassesAxiom": {
      const iris = getMeaningfulExpressions(node, ctx).map((c) => normalizeIri(getNodeText(c, ctx), ctx));
      if (iris.length >= 2) {
        out.push({ type: "DisjointClasses", classIris: iris, sourceLang: "owl2" });
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

    case "ClassAssertionAxiom": {
      const children = getMeaningfulExpressions(node, ctx);
      if (children.length >= 2) {
        out.push({
          type: "ClassAssertion",
          classIri: normalizeIri(getNodeText(children[0]!, ctx), ctx),
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

    case "ObjectPropertyDomainAxiom": {
      const children = getMeaningfulExpressions(node, ctx);
      if (children.length >= 2) {
        const propIri = normalizeIri(getNodeText(children[0]!, ctx), ctx);
        const domainIri = normalizeIri(getNodeText(children[1]!, ctx), ctx);
        out.push({
          type: "UniversalRestriction",
          propertyIri: propIri,
          targetClassIri: domainIri,
          sourceLang: "owl2",
        });
      }
      return;
    }

    case "ObjectPropertyRangeAxiom": {
      const children = getMeaningfulExpressions(node, ctx);
      if (children.length >= 2) {
        const propIri = normalizeIri(getNodeText(children[0]!, ctx), ctx);
        const rangeIri = normalizeIri(getNodeText(children[1]!, ctx), ctx);
        out.push({
          type: "UniversalRestriction",
          propertyIri: propIri,
          targetClassIri: rangeIri,
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

function cleanString(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  return raw;
}

function getIris(node: GenericSyntaxNode, ctx: LoweringContext): string[] {
  const result: string[] = [];
  for (const c of getNodeChildren(node)) {
    if (c.type === "IRI" || c.type === "FullIRI" || c.type === "AbbreviatedIRI") {
      result.push(normalizeIri(getNodeText(c, ctx), ctx));
    }
  }
  return result;
}

function getInteger(node: GenericSyntaxNode, ctx: LoweringContext): number {
  const intNode = getNodeChildren(node).find((c) => cleanNodeType(c) === "INTEGER");
  if (!intNode) return 1;
  const val = parseInt(getNodeText(intNode, ctx), 10);
  return isNaN(val) ? 1 : val;
}

function cleanNodeType(node: GenericSyntaxNode): string {
  const raw = node.type;
  return raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

function getMeaningfulExpressions(node: GenericSyntaxNode, ctx: LoweringContext): GenericSyntaxNode[] {
  return getNodeChildren(node).filter((c) => {
    const t = cleanNodeType(c);
    return (
      t !== "(" &&
      t !== ")" &&
      t !== "=" &&
      t !== ":" &&
      !t.endsWith("Axiom") &&
      t !== "SubClassOf" &&
      t !== "EquivalentClasses" &&
      t !== "DisjointClasses" &&
      t !== "ClassAssertion" &&
      t !== "ObjectPropertyDomain" &&
      t !== "ObjectPropertyRange" &&
      t !== "DataPropertyDomain" &&
      t !== "DataPropertyRange" &&
      t !== "Prefix" &&
      t !== "Ontology" &&
      t !== "Import" &&
      t !== "Declaration"
    );
  });
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OWL2Axiom, QueryDB, SymbolEntry } from "@modelscript/runtime";
import { collectCstLeaves, parseSysmlSource, stripLeadingTilde, stripSurroundingQuotes } from "./cst-utils.js";

function hasDisjointMarker(db: QueryDB, entry: SymbolEntry): boolean {
  if (entry.metadata?.["isDisjoint"]) return true;
  const stack = [...db.childrenOf(entry.id)];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (
      node.name?.toLowerCase() === "disjoint" ||
      (node.ruleName === "MetadataTyping" && node.name?.toLowerCase() === "disjoint")
    ) {
      return true;
    }
    if (
      node.ruleName === "PrefixMetadataAnnotation" ||
      node.ruleName === "PrefixMetadataMember" ||
      node.ruleName === "PrefixMetadataUsage"
    ) {
      for (const gc of db.childrenOf(node.id)) stack.push(gc);
    }
  }
  return false;
}

function getDirectSuperclassifierNames(db: QueryDB, entry: SymbolEntry): string[] {
  const supers: string[] = [];
  if (entry.inherits) {
    for (const inh of entry.inherits) {
      if (inh) supers.push(inh);
    }
  }
  for (const child of db.childrenOf(entry.id)) {
    if (
      (child.ruleName === "OwnedSubclassification" ||
        child.ruleName === "Subclassification" ||
        child.ruleName === "OwnedSubsetting" ||
        child.ruleName === "OwnedRedefinition") &&
      child.name
    ) {
      supers.push(child.name);
    }
  }
  return supers;
}

function extractMultiplicityBounds(
  db: QueryDB,
  entry: SymbolEntry,
): { lower: string | undefined; upper: string | undefined } {
  let lower = entry.metadata?.["multiplicityLower"] as string | undefined;
  let upper = entry.metadata?.["multiplicityUpper"] as string | undefined;
  if (lower != null || upper != null) {
    return {
      lower: lower != null ? String(lower).trim() : undefined,
      upper: upper != null ? String(upper).trim() : undefined,
    };
  }

  // Fallback: inspect declaration header CST leaves before `{` or `;` for `[N]`, `[N..M]`, `[*]`
  const text = db.cstText(entry.startOffset, entry.endOffset, entry);
  if (text) {
    const leaves = collectCstLeaves(parseSysmlSource(text));
    for (let i = 0; i < leaves.length; i++) {
      const tok = leaves[i]!.text;
      if (tok === "{" || tok === ";" || tok === "=") break;
      if (tok === "[") {
        let closeIdx = -1;
        for (let j = i + 1; j < leaves.length; j++) {
          if (leaves[j]!.text === "]") {
            closeIdx = j;
            break;
          }
        }
        if (closeIdx > i + 1) {
          const inner = leaves.slice(i + 1, closeIdx);
          const dotDotIdx = inner.findIndex((l) => l.text === "..");
          if (dotDotIdx !== -1) {
            lower = inner
              .slice(0, dotDotIdx)
              .map((l) => l.text)
              .join("")
              .trim();
            upper = inner
              .slice(dotDotIdx + 1)
              .map((l) => l.text)
              .join("")
              .trim();
          } else {
            lower = inner
              .map((l) => l.text)
              .join("")
              .trim();
          }
          break;
        }
      }
    }
  }

  return { lower, upper };
}

/**
 * Extracts OWL2 DL axioms natively from a SysML v2 file/namespace.
 * This is the Phase 1 "Frontend" compiler for the Reasoner integration.
 */
export function emitAxioms(db: QueryDB, self: SymbolEntry): OWL2Axiom[] {
  const axioms: OWL2Axiom[] = [];

  // 0. Base Property Declarations
  axioms.push(
    { type: "ObjectPropertyDeclaration", iri: "sysml:hasPart", sourceLang: "sysml2" },
    { type: "ObjectPropertyDeclaration", iri: "sysml:hasPort", sourceLang: "sysml2" },
    { type: "ObjectPropertyDeclaration", iri: "sysml:hasAttribute", sourceLang: "sysml2" },
    { type: "ObjectPropertyDeclaration", iri: "sysml:hasConnection", sourceLang: "sysml2" },
  );

  const rootPkgPrefix =
    (self.kind === "Package" || self.ruleName === "Package" || self.ruleName === "LibraryPackage") && self.name
      ? `${stripSurroundingQuotes(self.name)}::`
      : "";

  function resolveClassIri(rawName: string, scopeContainerId: number | null, nsPrefix: string): string {
    let cleaned = stripSurroundingQuotes(stripLeadingTilde(rawName.trim()));
    if (rootPkgPrefix && cleaned.startsWith(rootPkgPrefix)) {
      cleaned = cleaned.slice(rootPkgPrefix.length);
    }
    if (cleaned.includes("::")) {
      return `sysml:${cleaned}`;
    }
    if (nsPrefix && scopeContainerId !== null) {
      const siblings = db.childrenOf(scopeContainerId);
      if (siblings.some((s) => s.kind === "Definition" && stripSurroundingQuotes(s.name) === cleaned)) {
        return `sysml:${nsPrefix}::${cleaned}`;
      }
    }
    return `sysml:${cleaned}`;
  }

  function emitScopedDisjointSiblings(containerId: number, children: SymbolEntry[], nsPrefix: string): void {
    const defChildren = children.filter((c) => c.kind === "Definition");
    if (defChildren.length < 2) return;

    const disjointDefs = defChildren.filter((c) => hasDisjointMarker(db, c));
    if (disjointDefs.length < 2) return;

    // Group `#disjoint` sibling definitions by common direct superclassifier (or `owl:Thing` when none is specified)
    const groups = new Map<string, string[]>();
    const defIriOf = (d: SymbolEntry): string => {
      const local = d.name ? stripSurroundingQuotes(d.name) : `anon_${d.id}`;
      return `sysml:${nsPrefix ? `${nsPrefix}::${local}` : local}`;
    };

    for (const d of disjointDefs) {
      const dIri = defIriOf(d);
      const supers = getDirectSuperclassifierNames(db, d);
      if (supers.length === 0) {
        const list = groups.get("owl:Thing") ?? [];
        if (!list.includes(dIri)) list.push(dIri);
        groups.set("owl:Thing", list);
      } else {
        for (const sup of supers) {
          const supIri = resolveClassIri(sup, containerId, nsPrefix);
          const list = groups.get(supIri) ?? [];
          if (!list.includes(dIri)) list.push(dIri);
          groups.set(supIri, list);
        }
      }
    }

    const emittedGroupKeys = new Set<string>();
    for (const [, classIris] of groups) {
      if (classIris.length >= 2) {
        const dedupKey = [...classIris].sort().join("|");
        if (!emittedGroupKeys.has(dedupKey)) {
          emittedGroupKeys.add(dedupKey);
          axioms.push({
            type: "DisjointClasses",
            classIris,
            sourceLang: "sysml2",
          });
        }
      }
    }
  }

  // Helper to recursively walk the SymbolIndex
  function walk(id: number, parentIri: string | null, nsPrefix: string, parentUsagePath: string): void {
    const entry = db.symbol(id);
    if (!entry) return;

    const children = db.childrenOf(id);
    const isPkgLike = entry.kind === "Package" || entry.ruleName === "Package" || entry.ruleName === "LibraryPackage";

    if (isPkgLike) {
      const nextNsPrefix =
        id === self.id
          ? ""
          : entry.name
            ? nsPrefix
              ? `${nsPrefix}::${stripSurroundingQuotes(entry.name)}`
              : stripSurroundingQuotes(entry.name)
            : nsPrefix;

      emitScopedDisjointSiblings(id, children, nextNsPrefix);

      for (const child of children) {
        walk(child.id, null, nextNsPrefix, nextNsPrefix);
      }
      return;
    }

    const localName = entry.name ? stripSurroundingQuotes(entry.name) : `anon_${id}`;

    // 1. Map Definitions to ClassDeclarations (top-level definitions keep `sysml:${def.name}` for queries.ts compatibility)
    if (entry.kind === "Definition") {
      const qualDefName = nsPrefix ? `${nsPrefix}::${localName}` : localName;
      const iri = `sysml:${qualDefName}`;

      axioms.push({
        type: "ClassDeclaration",
        iri,
        sourceLang: "sysml2",
        sourceQualifiedName: qualDefName,
      });

      // Handle subclassification, subsetting, and redefinition
      for (const child of children) {
        if (
          (child.ruleName === "OwnedSubclassification" ||
            child.ruleName === "OwnedSubsetting" ||
            child.ruleName === "OwnedRedefinition") &&
          child.name
        ) {
          axioms.push({
            type: "SubClassOf",
            subClassIri: iri,
            superClassIri: resolveClassIri(child.name, entry.parentId, nsPrefix),
            sourceLang: "sysml2",
          });
        }
      }

      emitScopedDisjointSiblings(id, children, qualDefName);

      for (const child of children) {
        walk(child.id, iri, qualDefName, qualDefName);
      }
      return;
    }

    // 2. Map Usages (Parts, Attributes, Ports, Connections, etc.) with qualified `sysml:${parentPath}.${child.name}` IRI
    if (entry.kind === "Usage") {
      const qualUsagePath = parentUsagePath
        ? `${parentUsagePath}.${localName}`
        : nsPrefix
          ? `${nsPrefix}::${localName}`
          : localName;
      const iri = `sysml:${qualUsagePath}`;

      axioms.push({
        type: "ClassDeclaration",
        iri,
        sourceLang: "sysml2",
        sourceQualifiedName: qualUsagePath,
      });
      axioms.push({
        type: "IndividualDeclaration",
        iri,
        sourceLang: "sysml2",
      });

      // Find typing (e.g., `part p : Vehicle` -> p SubClassOf Vehicle, p instance of Vehicle)
      const typeChildren = children.filter((c) => c.ruleName === "OwnedFeatureTyping" && Boolean(c.name));
      for (const typeChild of typeChildren) {
        if (typeChild?.name) {
          const typeIri = resolveClassIri(typeChild.name, entry.parentId, nsPrefix);
          axioms.push({
            type: "SubClassOf",
            subClassIri: iri,
            superClassIri: typeIri,
            sourceLang: "sysml2",
          });
          axioms.push({
            type: "ClassAssertion",
            individualIri: iri,
            classIri: typeIri,
            sourceLang: "sysml2",
          });
        }
      }

      // Mereological / structural relationship to parent
      let propertyIri = "sysml:hasPart";
      if (entry.ruleName === "PortUsage") {
        propertyIri = "sysml:hasPort";
      } else if (entry.ruleName === "AttributeUsage") {
        propertyIri = "sysml:hasAttribute";
      } else if (entry.ruleName === "ConnectionUsage" || entry.ruleName === "BindingConnectorAsUsage") {
        propertyIri = "sysml:hasConnection";
      }

      if (parentIri) {
        const { lower, upper } = extractMultiplicityBounds(db, entry);
        const primaryType = typeChildren[0]?.name;
        const fillerClassIri = primaryType ? resolveClassIri(primaryType, entry.parentId, nsPrefix) : iri;

        // Multiplicity lower bound 0 (`[0]`, `[0..1]`, `[0..*]`, `[*]`) must NOT emit ObjectPropertyAssertion (>= 1 link)
        const parsedLower = lower != null && lower !== "*" ? parseInt(lower, 10) : NaN;
        const isZeroLowerBound = lower === "*" || (!isNaN(parsedLower) && parsedLower <= 0);

        if (!isZeroLowerBound) {
          axioms.push({
            type: "ObjectPropertyAssertion",
            propertyIri,
            subjectIri: parentIri,
            objectIri: iri,
            sourceLang: "sysml2",
          });
        }

        if (lower != null && upper == null && lower !== "*") {
          // Exact cardinality: [N]
          if (!isNaN(parsedLower) && parsedLower >= 0) {
            axioms.push({
              type: "QualifiedCardinality",
              classIri: parentIri,
              propertyIri,
              fillerClassIri,
              cardinalityType: "exact",
              count: parsedLower,
              sourceLang: "sysml2",
            });
          }
        } else if (upper != null) {
          // Range cardinality: [N..M] or [N..*]
          if (!isNaN(parsedLower) && parsedLower > 0) {
            axioms.push({
              type: "QualifiedCardinality",
              classIri: parentIri,
              propertyIri,
              fillerClassIri,
              cardinalityType: "min",
              count: parsedLower,
              sourceLang: "sysml2",
            });
          }
          if (upper !== "*") {
            const maxCount = parseInt(upper, 10);
            if (!isNaN(maxCount) && maxCount >= 0) {
              axioms.push({
                type: "QualifiedCardinality",
                classIri: parentIri,
                propertyIri,
                fillerClassIri,
                cardinalityType: "max",
                count: maxCount,
                sourceLang: "sysml2",
              });
            }
          }
        }
      }

      for (const child of children) {
        walk(child.id, iri, nsPrefix, qualUsagePath);
      }
      return;
    }

    // 3. Fallback for non-Usage Connection / Binding nodes if any
    if (entry.ruleName === "ConnectionUsage" || entry.ruleName === "BindingConnectorAsUsage") {
      const qualConnPath = parentUsagePath ? `${parentUsagePath}.${localName}` : localName;
      const iri = `sysml:${qualConnPath}`;
      axioms.push({
        type: "ClassDeclaration",
        iri,
        sourceLang: "sysml2",
        sourceQualifiedName: qualConnPath,
      });
      if (parentIri) {
        axioms.push({
          type: "ObjectPropertyAssertion",
          propertyIri: "sysml:hasConnection",
          subjectIri: parentIri,
          objectIri: iri,
          sourceLang: "sysml2",
        });
      }
      for (const child of children) {
        walk(child.id, iri, nsPrefix, qualConnPath);
      }
      return;
    }

    // Recurse into any other structural container
    for (const child of children) {
      walk(child.id, parentIri, nsPrefix, parentUsagePath);
    }
  }

  // Start walking from the provided namespace/root
  walk(self.id, null, "", "");

  return axioms;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OWL2Axiom, QueryDB, SymbolEntry } from "@modelscript/runtime";

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

  // Helper to recursively walk the SymbolIndex
  function walk(id: number, parentIri: string | null) {
    const entry = db.symbol(id);
    if (!entry) return;

    const iri = `sysml:${entry.name || `anon_${id}`}`;
    const children = db.childrenOf(id);

    // 1. Map Definitions to ClassDeclarations
    if (entry.kind === "Definition") {
      axioms.push({
        type: "ClassDeclaration",
        iri,
        sourceLang: "sysml2",
        sourceQualifiedName: entry.name || "",
      });

      // Handle subclassification, subsetting, and redefinition
      for (const child of children) {
        if (
          child.ruleName === "OwnedSubclassification" ||
          child.ruleName === "OwnedSubsetting" ||
          child.ruleName === "OwnedRedefinition"
        ) {
          axioms.push({
            type: "SubClassOf",
            subClassIri: iri,
            superClassIri: `sysml:${child.name}`,
            sourceLang: "sysml2",
          });
        }
      }
    }

    // Check for sibling definitions marked with #disjoint or @disjoint in this scope
    const defChildren = children.filter((c) => c.kind === "Definition");
    if (defChildren.length >= 2) {
      const disjointDefs = defChildren.filter((c) => {
        const grandChildren = db.childrenOf(c.id);
        return grandChildren.some(
          (gc) =>
            gc.name?.toLowerCase() === "disjoint" ||
            (gc.ruleName === "MetadataTyping" && gc.name?.toLowerCase() === "disjoint"),
        );
      });
      if (disjointDefs.length >= 2) {
        axioms.push({
          type: "DisjointClasses",
          classIris: disjointDefs.map((d) => `sysml:${d.name || `anon_${d.id}`}`),
          sourceLang: "sysml2",
        });
      }
    }

    // 2. Map Usages (Parts, Attributes, Ports, etc.)
    if (entry.kind === "Usage") {
      axioms.push({
        type: "ClassDeclaration",
        iri,
        sourceLang: "sysml2",
        sourceQualifiedName: entry.name || "",
      });
      axioms.push({
        type: "IndividualDeclaration",
        iri,
        sourceLang: "sysml2",
      });

      // Find typing (e.g., `part p : Vehicle` -> p SubClassOf Vehicle, p instance of Vehicle)
      const typeChildren = children.filter((c) => c.ruleName === "OwnedFeatureTyping");
      for (const typeChild of typeChildren) {
        if (typeChild && typeChild.name) {
          const typeIri = `sysml:${typeChild.name}`;
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
      } else if (entry.ruleName === "ConnectionUsage") {
        propertyIri = "sysml:hasConnection";
      }

      if (parentIri) {
        axioms.push({
          type: "ObjectPropertyAssertion",
          propertyIri,
          subjectIri: parentIri,
          objectIri: iri,
          sourceLang: "sysml2",
        });

        // Multiplicity constraints: exact, min, max cardinality
        const lower = entry.metadata?.multiplicityLower as string | undefined;
        const upper = entry.metadata?.multiplicityUpper as string | undefined;
        const primaryType = typeChildren[0]?.name;
        const fillerClassIri = primaryType ? `sysml:${primaryType}` : iri;

        if (lower != null && upper == null) {
          // Exact cardinality: [N]
          const exactCount = parseInt(String(lower), 10);
          if (!isNaN(exactCount)) {
            axioms.push({
              type: "QualifiedCardinality",
              classIri: parentIri,
              propertyIri,
              fillerClassIri,
              cardinalityType: "exact",
              count: exactCount,
              sourceLang: "sysml2",
            });
          }
        } else if (upper != null) {
          // Range cardinality: [N..M] or [N..*]
          if (lower != null && lower !== "*") {
            const minCount = parseInt(String(lower), 10);
            if (!isNaN(minCount) && minCount > 0) {
              axioms.push({
                type: "QualifiedCardinality",
                classIri: parentIri,
                propertyIri,
                fillerClassIri,
                cardinalityType: "min",
                count: minCount,
                sourceLang: "sysml2",
              });
            }
          }
          if (upper !== "*") {
            const maxCount = parseInt(String(upper), 10);
            if (!isNaN(maxCount)) {
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
    }

    // 3. Map Connections / Bindings
    if (entry.ruleName === "ConnectionUsage" || entry.ruleName === "BindingConnectorAsUsage") {
      axioms.push({
        type: "ClassDeclaration",
        iri,
        sourceLang: "sysml2",
        sourceQualifiedName: entry.name || "",
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
    }

    // Recurse into children
    for (const child of children) {
      walk(child.id, iri);
    }
  }

  // Start walking from the provided namespace/root
  walk(self.id, null);

  return axioms;
}

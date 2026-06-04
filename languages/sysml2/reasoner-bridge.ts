// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OWL2Axiom, QueryDB, SymbolEntry } from "@modelscript/compiler";

/**
 * Extracts OWL2 DL axioms natively from a SysML v2 file/namespace.
 * This is the Phase 1 "Frontend" compiler for the Reasoner integration.
 */
export function emitAxioms(db: QueryDB, self: SymbolEntry): OWL2Axiom[] {
  const axioms: OWL2Axiom[] = [];

  // Helper to recursively walk the SymbolIndex
  function walk(id: number, parentIri: string | null) {
    const entry = db.symbol(id);
    if (!entry) return;

    const iri = `sysml:${entry.name || `anon_${id}`}`;

    // 1. Map Definitions to ClassDeclarations
    if (entry.kind === "Definition") {
      axioms.push({
        type: "ClassDeclaration",
        iri,
        sourceLang: "sysml2",
        sourceQualifiedName: entry.name || "",
      });

      // Handle subsetting / specialization
      for (const child of db.childrenOf(id)) {
        if (child.ruleName === "OwnedSubsetting" || child.ruleName === "OwnedRedefinition") {
          axioms.push({
            type: "SubClassOf",
            subClassIri: iri,
            superClassIri: `sysml:${child.name}`,
            sourceLang: "sysml2",
          });
        }
      }
    }

    // 2. Map Usages (Parts, Attributes, etc.) to SubClasses
    // We treat usages as classes so we can reason about their structure (DL-Lite approach).
    if (entry.kind === "Usage") {
      axioms.push({
        type: "ClassDeclaration",
        iri,
        sourceLang: "sysml2",
        sourceQualifiedName: entry.name || "",
      });

      // Find typing (e.g., `part p : Vehicle` -> p SubClassOf Vehicle)
      const typeChild = db.childrenOf(id).find((c) => c.ruleName === "OwnedFeatureTyping");
      if (typeChild && typeChild.name) {
        axioms.push({
          type: "SubClassOf",
          subClassIri: iri,
          superClassIri: `sysml:${typeChild.name}`,
          sourceLang: "sysml2",
        });
      }

      // If it has a parent, we can assert a mereological relationship
      // e.g., System hasPart System_v
      if (parentIri) {
        axioms.push({
          type: "ObjectPropertyAssertion",
          propertyIri: "sysml:hasPart",
          subjectIri: parentIri,
          objectIri: iri,
          sourceLang: "sysml2",
        });
      }
    }

    // 3. Map Connections / Bindings
    if (entry.ruleName === "ConnectionUsage" || entry.ruleName === "BindingConnectorAsUsage") {
      // Very basic connection mapping: treat as an object property between ends
      // In a real scenario, we'd extract the actual connection ends from the AST.
      // For now, we emit the connection itself as a feature.
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
    for (const child of db.childrenOf(id)) {
      walk(child.id, iri);
    }
  }

  // Start walking from the provided namespace/root
  walk(self.id, null);

  return axioms;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Universal Semantic Axiom Projector.
 *
 * Declaratively projects language-agnostic SymbolIndex entries and topologies
 * into BFO 2020 (ISO/IEC 21838-2) and IOF Core-aligned OWL2 DL axioms
 * for incremental consumption by the in-WASM Tableau Reasoner.
 */

import type { SymbolIndex } from "../runtime.js";
import { BFO, IOF, RELATIONS } from "./bfo_vocabulary.js";
import type { OWL2Axiom } from "./wasm_ontology.js";

export interface ProjectorOptions {
  sourceLang?: string | undefined;
  sourceUri?: string | undefined;
  basePrefix?: string | undefined;
}

export class SemanticAxiomProjector {
  /**
   * Projects a flat SymbolIndex into a set of BFO/IOF-aligned OWL2 axioms.
   */
  public static projectSymbolIndex(
    symbolIndex: SymbolIndex,
    options?: ProjectorOptions,
  ): OWL2Axiom[] {
    const axioms: OWL2Axiom[] = [];
    const lang = options?.sourceLang ?? "polyglot";
    const prefix = options?.basePrefix ?? `${lang}:`;

    for (const [, entry] of symbolIndex.symbols.entries()) {
      if (!entry || !entry.name) continue;

      let qualifiedName = entry.name;
      if (entry.parentId !== null) {
        const parent = symbolIndex.symbols.get(entry.parentId);
        if (parent && parent.name && !entry.name.startsWith(parent.name)) {
          qualifiedName = `${parent.name}.${entry.name}`;
        }
      }
      const entityIri = `${prefix}${qualifiedName}`;
      const kindStr = String(entry.kind || "").toLowerCase();
      const ruleStr = String(entry.ruleName || "").toLowerCase();
      const meta = entry.metadata || {};

      // 1. Classify Engineering Entity Category (Continuant vs Occurrent)
      const isProcessOrAction =
        kindStr.includes("action") ||
        kindStr.includes("process") ||
        kindStr.includes("event") ||
        kindStr.includes("transition") ||
        ruleStr.includes("action") ||
        ruleStr.includes("process") ||
        ruleStr.includes("state_transition") ||
        meta["defKind"] === "action";

      const isPortOrInterface =
        kindStr.includes("port") ||
        kindStr.includes("pin") ||
        kindStr.includes("flange") ||
        kindStr.includes("terminal") ||
        kindStr.includes("connector") ||
        ruleStr.includes("port") ||
        ruleStr.includes("pin") ||
        ruleStr.includes("connector") ||
        meta["defKind"] === "port" ||
        meta["isPort"] === true;

      const isRequirementOrSpec =
        kindStr.includes("requirement") ||
        kindStr.includes("concern") ||
        kindStr.includes("constraint") ||
        ruleStr.includes("requirement") ||
        ruleStr.includes("constraint") ||
        meta["defKind"] === "requirement";

      const isParameterOrQuality =
        kindStr.includes("parameter") ||
        kindStr.includes("variable") ||
        meta["variability"] === "parameter" ||
        meta["defKind"] === "attribute";

      const isClassOrDef =
        kindStr === "class" ||
        kindStr === "def" ||
        ruleStr.includes("definition") ||
        ruleStr.includes("declaration") ||
        meta["classKind"] !== undefined;

      // 2. Emit BFO Classification Axioms
      if (isProcessOrAction) {
        axioms.push(
          {
            type: "ClassDeclaration",
            iri: entityIri,
            sourceLang: lang,
            sourceQualifiedName: entry.name,
          },
          {
            type: "SubClassOf",
            subClassIri: entityIri,
            superClassIri: BFO.Process,
            sourceLang: lang,
          },
        );
      } else if (isPortOrInterface) {
        if (isClassOrDef) {
          axioms.push(
            {
              type: "ClassDeclaration",
              iri: entityIri,
              sourceLang: lang,
              sourceQualifiedName: entry.name,
            },
            {
              type: "SubClassOf",
              subClassIri: entityIri,
              superClassIri: IOF.Port,
              sourceLang: lang,
            },
          );
        } else {
          axioms.push(
            {
              type: "IndividualDeclaration",
              iri: entityIri,
              sourceLang: lang,
            },
            {
              type: "ClassAssertion",
              classIri: IOF.Port,
              individualIri: entityIri,
              sourceLang: lang,
            },
          );
        }

        // Link port to parent component if available
        if (entry.parentId !== null) {
          const parent = symbolIndex.symbols.get(entry.parentId);
          if (parent && parent.name) {
            const parentIri = `${prefix}${parent.name}`;
            axioms.push({
              type: "ObjectPropertyAssertion",
              propertyIri: RELATIONS.has_part,
              subjectIri: parentIri,
              objectIri: entityIri,
              sourceLang: lang,
            });
          }
        }
      } else if (isRequirementOrSpec) {
        axioms.push(
          {
            type: "ClassDeclaration",
            iri: entityIri,
            sourceLang: lang,
            sourceQualifiedName: entry.name,
          },
          {
            type: "SubClassOf",
            subClassIri: entityIri,
            superClassIri: IOF.RequirementSpecification,
            sourceLang: lang,
          },
        );
      } else if (isParameterOrQuality) {
        axioms.push({
          type: "ClassDeclaration",
          iri: entityIri,
          sourceLang: lang,
          sourceQualifiedName: entry.name,
        });

        // Numeric bounds / value projection if known
        const rawVal = meta["value"] ?? meta["default"] ?? meta["start"];
        const numVal = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
        if (!Number.isNaN(numVal)) {
          axioms.push({
            type: "DataPropertyAssertion",
            propertyIri: "qudt:numericValue",
            subjectIri: entityIri,
            value: String(numVal),
            datatype: "xsd:double",
            minVal: meta["min"] !== undefined ? Number(meta["min"]) : undefined,
            maxVal: meta["max"] !== undefined ? Number(meta["max"]) : undefined,
            sourceLang: lang,
          });
        }
      } else {
        // Standard Material Artifact / Component
        if (isClassOrDef) {
          axioms.push(
            {
              type: "ClassDeclaration",
              iri: entityIri,
              sourceLang: lang,
              sourceQualifiedName: entry.name,
            },
            {
              type: "SubClassOf",
              subClassIri: entityIri,
              superClassIri: IOF.Component,
              sourceLang: lang,
            },
          );
        } else {
          axioms.push(
            {
              type: "IndividualDeclaration",
              iri: entityIri,
              sourceLang: lang,
            },
            {
              type: "ClassAssertion",
              classIri: IOF.Component,
              individualIri: entityIri,
              sourceLang: lang,
            },
          );
        }
      }

      // 3. Subclassing / Type Hierarchy
      if (entry.inherits && Array.isArray(entry.inherits)) {
        for (const sup of entry.inherits) {
          if (sup && typeof sup === "string") {
            const superIri = sup.includes(":") ? sup : `${prefix}${sup}`;
            axioms.push({
              type: "SubClassOf",
              subClassIri: entityIri,
              superClassIri: superIri,
              sourceLang: lang,
            });
          }
        }
      }

      // 4. Scope Disjointness Annotations
      if (meta["isDisjoint"] === true || meta["disjointWith"]) {
        const others = Array.isArray(meta["disjointWith"]) ? meta["disjointWith"] : [meta["disjointWith"]];
        const disjointIris = [entityIri, ...others.filter(Boolean).map((o: string) => (o.includes(":") ? o : `${prefix}${o}`))];
        if (disjointIris.length >= 2) {
          axioms.push({
            type: "DisjointClasses",
            classIris: disjointIris,
            sourceLang: lang,
          });
        }
      }

      // 5. Domain-Specific Physics & Integrity Axioms (sound TBox disjointness)
      // 5a. Electrical (SPICE / Verilog-A / PSCAD): Safe Operating Area (SOA)
      const vMax = meta["vmax"] ?? meta["vrated"] ?? meta["breakdown"];
      const vAct = meta["voltage"] ?? meta["v"];
      if (vMax !== undefined && vAct !== undefined) {
        const numVMax = Number(vMax);
        const numVAct = Number(vAct);
        if (!Number.isNaN(numVMax) && !Number.isNaN(numVAct) && numVAct > numVMax) {
          axioms.push(
            {
              type: "DisjointClasses",
              classIris: [`${prefix}CompliantOperatingCondition`, `${prefix}OvervoltageViolation`],
              sourceLang: lang,
            },
            {
              type: "SubClassOf",
              subClassIri: entityIri,
              superClassIri: `${prefix}CompliantOperatingCondition`,
              sourceLang: lang,
            },
            {
              type: "SubClassOf",
              subClassIri: entityIri,
              superClassIri: `${prefix}OvervoltageViolation`,
              sourceLang: lang,
            },
          );
        }
      }

      // 5b. Robotics (URDF / Multibody): Joint Limits & Inertia
      if (meta["lower"] !== undefined && meta["upper"] !== undefined) {
        const lower = Number(meta["lower"]);
        const upper = Number(meta["upper"]);
        if (!Number.isNaN(lower) && !Number.isNaN(upper) && lower > upper) {
          axioms.push(
            {
              type: "DisjointClasses",
              classIris: [`${prefix}ConsistentKinematicJoint`, `${prefix}InvertedLimitViolation`],
              sourceLang: lang,
            },
            {
              type: "SubClassOf",
              subClassIri: entityIri,
              superClassIri: `${prefix}ConsistentKinematicJoint`,
              sourceLang: lang,
            },
            {
              type: "SubClassOf",
              subClassIri: entityIri,
              superClassIri: `${prefix}InvertedLimitViolation`,
              sourceLang: lang,
            },
          );
        }
      }
      if (meta["ixx"] !== undefined && Number(meta["ixx"]) <= 0) {
        axioms.push(
          {
            type: "DisjointClasses",
            classIris: [`${prefix}PositiveDefiniteInertia`, `${prefix}NonPhysicalInertiaViolation`],
            sourceLang: lang,
          },
          {
            type: "SubClassOf",
            subClassIri: entityIri,
            superClassIri: `${prefix}PositiveDefiniteInertia`,
            sourceLang: lang,
          },
          {
            type: "SubClassOf",
            subClassIri: entityIri,
            superClassIri: `${prefix}NonPhysicalInertiaViolation`,
            sourceLang: lang,
          },
        );
      }

      // 5c. Biochemical (SBML / Reaction Networks): Empty Reactants Mass Imbalance
      if (ruleStr.includes("reaction") || meta["defKind"] === "reaction") {
        const reactantsCount = meta["reactantsCount"] ?? (meta["reactants"] as any)?.length;
        const productsCount = meta["productsCount"] ?? (meta["products"] as any)?.length;
        const isBoundary = meta["boundary"] === true || meta["isBoundary"] === true;
        if (reactantsCount === 0 && productsCount > 0 && !isBoundary) {
          axioms.push(
            {
              type: "DisjointClasses",
              classIris: [`${prefix}MassConservingReaction`, `${prefix}EmptyReactantImbalanceViolation`],
              sourceLang: lang,
            },
            {
              type: "SubClassOf",
              subClassIri: entityIri,
              superClassIri: `${prefix}MassConservingReaction`,
              sourceLang: lang,
            },
            {
              type: "SubClassOf",
              subClassIri: entityIri,
              superClassIri: `${prefix}EmptyReactantImbalanceViolation`,
              sourceLang: lang,
            },
          );
        }
      }

      // 5d. 3D CAD (STEP / OpenSCAD): Degenerate Bounding Box
      const dx = meta["dx"] ?? meta["width"];
      const dy = meta["dy"] ?? meta["depth"];
      const dz = meta["dz"] ?? meta["height"];
      if (dx !== undefined && dy !== undefined && dz !== undefined) {
        if (Number(dx) <= 0 || Number(dy) <= 0 || Number(dz) <= 0) {
          axioms.push(
            {
              type: "DisjointClasses",
              classIris: [`${prefix}ValidSolidEnvelope`, `${prefix}DegenerateVolumeViolation`],
              sourceLang: lang,
            },
            {
              type: "SubClassOf",
              subClassIri: entityIri,
              superClassIri: `${prefix}ValidSolidEnvelope`,
              sourceLang: lang,
            },
            {
              type: "SubClassOf",
              subClassIri: entityIri,
              superClassIri: `${prefix}DegenerateVolumeViolation`,
              sourceLang: lang,
            },
          );
        }
      }
    }

    return axioms;
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DiagramData, DiagramEdge, DiagramNode } from "@modelscript/diagram/protocol";

export interface OWL2Entity {
  iri: string;
  label: string;
  type: "class" | "objectProperty" | "dataProperty" | "individual" | "datatype";
  isDefinedClass?: boolean | undefined;
  subtitle?: string | undefined;
  compartmentEntries?: string[] | undefined;
}

export interface OWL2Relationship {
  source: string;
  target: string;
  label: string;
  type:
    | "subClassOf"
    | "inferredSubClassOf"
    | "equivalentTo"
    | "disjointWith"
    | "domain"
    | "range"
    | "objectProperty"
    | "objectPropertyAssertion"
    | "inverseOf"
    | "classAssertion";
  isHorizontalPeer?: boolean | undefined;
}

export interface OWL2DiagramOptions {
  /** Inferred SubClassOf pairs computed by TableauReasoner */
  inferredSubClassOf?: { subClassIri: string; superClassIri: string }[] | undefined;
}

export function getShortLabel(iri: string): string {
  const hashIdx = iri.lastIndexOf("#");
  if (hashIdx !== -1 && hashIdx < iri.length - 1) {
    return iri.slice(hashIdx + 1);
  }
  const slashIdx = iri.lastIndexOf("/");
  if (slashIdx !== -1 && slashIdx < iri.length - 1) {
    return iri.slice(slashIdx + 1);
  }
  const colonIdx = iri.indexOf(":");
  if (colonIdx !== -1 && !iri.startsWith("http://") && !iri.startsWith("https://")) {
    return iri.slice(colonIdx + 1);
  }
  return iri;
}

export interface OWL2DiagramAxiom {
  readonly type: string;
  readonly iri?: string | undefined;
  readonly subClassIri?: string | undefined;
  readonly superClassIri?: string | undefined;
  readonly subPropertyIri?: string | undefined;
  readonly superPropertyIri?: string | undefined;
  readonly inferred?: boolean | undefined;
  readonly subjectIri?: string | undefined;
  readonly objectIri?: string | undefined;
  readonly propertyIri?: string | undefined;
  readonly classIri?: string | undefined;
  readonly fillerClassIri?: string | undefined;
  readonly individualIri?: string | undefined;
  readonly individualIris?: readonly string[] | undefined;
  readonly domainIri?: string | undefined;
  readonly rangeIri?: string | undefined;
  readonly targetClassIri?: string | undefined;
  readonly dataRange?: string | undefined;
  readonly value?: string | undefined;
  readonly cardinalityType?: "min" | "max" | "exact" | undefined;
  readonly count?: number | undefined;
  readonly inversePropertyIri?: string | undefined;
  readonly propertyIris?: readonly string[] | undefined;
  readonly classIris?: readonly string[] | undefined;
}

interface PropertyMeta {
  iri: string;
  type: "objectProperty" | "dataProperty";
  domains: string[];
  ranges: string[];
  inverses: string[];
  characteristics: string[];
  superProperties: string[];
}

/**
 * Builds SOTA DiagramData for an OWL 2 ontology suitable for AntV X6 rendering.
 *
 * - In "All" view:
 *   - ObjectProperties with both Domain and Range are projected as direct semantic edges (Domain → Range),
 *     folding inverse property pairs into a unified `prop ⇄ invProp` label.
 *   - DataProperties with a Domain are folded into the Domain class's UML/ODM Attributes compartment
 *     (`prop : xsd:type`), keeping the graph free of floating datatype/property clutter.
 *   - Class restrictions (`∃`, `∀`, cardinality, `ObjectOneOf`) and Individual `DataPropertyAssertion` facts
 *     are rendered in structured multi-compartment cards.
 * - In "Taxonomy" ("ClassTaxonomy") view:
 *   - Displays pure class hierarchy (`SubClassOf`, `inferredSubClassOf`, `EquivalentClasses`, `DisjointClasses`).
 * - In "Properties" view:
 *   - Displays explicit `ObjectProperty`, `DataProperty`, and `Datatype` nodes with `rdfs:domain`,
 *     `rdfs:range`, and `owl:inverseOf` edges.
 */
export function buildOWL2DiagramData(
  axioms: readonly OWL2DiagramAxiom[],
  layout?: {
    elements?:
      | Record<string, { x: number; y: number; width?: number | undefined; height?: number | undefined }>
      | undefined;
  },
  diagramType: string = "All",
  options?: OWL2DiagramOptions,
): DiagramData {
  const nodesMap = new Map<string, OWL2Entity>();
  const rawEdgesData: OWL2Relationship[] = [];
  const assertedSubClassPairs = new Set<string>();

  const isTaxonomyView = diagramType === "Taxonomy" || diagramType === "Hierarchy" || diagramType === "ClassTaxonomy";
  const isPropertiesView = diagramType === "Properties";
  const isAllView = !isTaxonomyView && !isPropertiesView;

  // Track defined classes (classes appearing in EquivalentClasses with >1 operands or ObjectOneOf)
  const definedClasses = new Set<string>();
  for (const ax of axioms) {
    if (ax.type === "EquivalentClasses" && Array.isArray(ax.classIris) && ax.classIris.length > 1) {
      for (const c of ax.classIris) definedClasses.add(c);
    } else if (ax.type === "ObjectOneOf" && ax.classIri) {
      definedClasses.add(ax.classIri);
    }
  }

  const classAttributes = new Map<string, string[]>();
  const classRestrictions = new Map<string, string[]>();
  const individualTypes = new Map<string, string[]>();
  const individualFacts = new Map<string, string[]>();
  const propertyMetaMap = new Map<string, PropertyMeta>();

  const pushUnique = (map: Map<string, string[]>, key: string, val: string) => {
    const list = map.get(key) ?? [];
    if (!list.includes(val)) {
      list.push(val);
      map.set(key, list);
    }
  };

  const ensurePropertyMeta = (iri: string, defaultType: "objectProperty" | "dataProperty"): PropertyMeta => {
    let meta = propertyMetaMap.get(iri);
    if (!meta) {
      meta = {
        iri,
        type: defaultType,
        domains: [],
        ranges: [],
        inverses: [],
        characteristics: [],
        superProperties: [],
      };
      propertyMetaMap.set(iri, meta);
    } else if (defaultType === "dataProperty") {
      meta.type = "dataProperty";
    }
    return meta;
  };

  const ensureNode = (iri: string, defaultType: OWL2Entity["type"]) => {
    if (!iri || iri === "owl:Thing" || iri === "owl:Nothing") return;
    const isDatatype = defaultType === "datatype" || iri.startsWith("xsd:") || iri.startsWith("rdfs:Literal");
    const effectiveType = isDatatype ? "datatype" : defaultType;
    const existing = nodesMap.get(iri);
    if (!existing) {
      nodesMap.set(iri, {
        iri,
        label: effectiveType === "datatype" && iri.startsWith("xsd:") ? iri : getShortLabel(iri),
        type: effectiveType,
        ...(effectiveType === "class" ? { isDefinedClass: definedClasses.has(iri) } : {}),
      });
    } else if (existing.type === "class" && effectiveType !== "class") {
      existing.type = effectiveType;
      if (effectiveType === "datatype" && iri.startsWith("xsd:")) {
        existing.label = iri;
      }
    }
  };

  for (const ax of axioms) {
    if ((ax.type === "ClassDeclaration" || ax.type === "Class") && ax.iri) {
      ensureNode(ax.iri, "class");
    } else if ((ax.type === "ObjectPropertyDeclaration" || ax.type === "ObjectProperty") && ax.iri) {
      ensureNode(ax.iri, "objectProperty");
      ensurePropertyMeta(ax.iri, "objectProperty");
    } else if ((ax.type === "DataPropertyDeclaration" || ax.type === "DataProperty") && ax.iri) {
      ensureNode(ax.iri, "dataProperty");
      ensurePropertyMeta(ax.iri, "dataProperty");
    } else if ((ax.type === "IndividualDeclaration" || ax.type === "NamedIndividual") && ax.iri) {
      ensureNode(ax.iri, "individual");
    } else if (ax.type === "SubClassOf" && ax.subClassIri && ax.superClassIri) {
      ensureNode(ax.subClassIri, "class");
      ensureNode(ax.superClassIri, "class");
      const isInferred = Boolean(ax.inferred);
      if (!isInferred) {
        assertedSubClassPairs.add(`${ax.subClassIri}→${ax.superClassIri}`);
      }
      rawEdgesData.push({
        source: ax.subClassIri,
        target: ax.superClassIri,
        label: isInferred ? "«inferred» ⊑" : "subClassOf",
        type: isInferred ? "inferredSubClassOf" : "subClassOf",
      });
    } else if (ax.type === "ObjectSomeValuesFrom" && ax.subClassIri && ax.propertyIri && ax.fillerClassIri) {
      ensureNode(ax.subClassIri, "class");
      ensureNode(ax.fillerClassIri, "class");
      pushUnique(
        classRestrictions,
        ax.subClassIri,
        `⊑ ∃${getShortLabel(ax.propertyIri)}.${getShortLabel(ax.fillerClassIri)}`,
      );
      rawEdgesData.push({
        source: ax.subClassIri,
        target: ax.fillerClassIri,
        label: `∃${getShortLabel(ax.propertyIri)}`,
        type: "objectProperty",
      });
    } else if (ax.type === "DataSomeValuesFrom" && ax.subClassIri && ax.propertyIri) {
      ensureNode(ax.subClassIri, "class");
      const rangeStr = ax.dataRange ? getShortLabel(ax.dataRange) : "Literal";
      pushUnique(classAttributes, ax.subClassIri, `${getShortLabel(ax.propertyIri)} : ${rangeStr}`);
    } else if (ax.type === "QualifiedCardinality" && ax.classIri && ax.propertyIri) {
      ensureNode(ax.classIri, "class");
      const sym = ax.cardinalityType === "min" ? "≥" : ax.cardinalityType === "max" ? "≤" : "=";
      const filler = ax.fillerClassIri ? getShortLabel(ax.fillerClassIri) : "Thing";
      pushUnique(classRestrictions, ax.classIri, `⊑ ${sym}${ax.count ?? 1} ${getShortLabel(ax.propertyIri)}.${filler}`);
    } else if (ax.type === "ObjectOneOf" && ax.classIri && Array.isArray(ax.individualIris)) {
      ensureNode(ax.classIri, "class");
      pushUnique(classRestrictions, ax.classIri, `≡ { ${ax.individualIris.map(getShortLabel).join(", ")} }`);
    } else if (ax.type === "ObjectPropertyAssertion" && ax.subjectIri && ax.objectIri && ax.propertyIri) {
      ensureNode(ax.subjectIri, "individual");
      ensureNode(ax.objectIri, "individual");
      rawEdgesData.push({
        source: ax.subjectIri,
        target: ax.objectIri,
        label: getShortLabel(ax.propertyIri),
        type: "objectPropertyAssertion",
        isHorizontalPeer: true,
      });
    } else if (ax.type === "DataPropertyAssertion" && ax.subjectIri && ax.propertyIri) {
      ensureNode(ax.subjectIri, "individual");
      const valStr = ax.value !== undefined ? `"${ax.value}"` : "";
      pushUnique(individualFacts, ax.subjectIri, `${getShortLabel(ax.propertyIri)} = ${valStr}`);
    } else if (ax.type === "ClassAssertion") {
      const classIri = ax.classIri;
      const indivIri = ax.individualIri;
      if (classIri && indivIri) {
        ensureNode(indivIri, "individual");
        ensureNode(classIri, "class");
        pushUnique(individualTypes, indivIri, getShortLabel(classIri));
        rawEdgesData.push({
          source: indivIri,
          target: classIri,
          label: "rdf:type",
          type: "classAssertion",
        });
      }
    } else if (ax.type === "ObjectPropertyDomain" || ax.type === "DataPropertyDomain") {
      const propIri = ax.propertyIri;
      const domainIri = ax.domainIri ?? ax.classIri ?? ax.targetClassIri;
      if (propIri && domainIri) {
        const isData = ax.type === "DataPropertyDomain" || nodesMap.get(propIri)?.type === "dataProperty";
        ensureNode(propIri, isData ? "dataProperty" : "objectProperty");
        ensureNode(domainIri, "class");
        const meta = ensurePropertyMeta(propIri, isData ? "dataProperty" : "objectProperty");
        if (!meta.domains.includes(domainIri)) meta.domains.push(domainIri);
        rawEdgesData.push({
          source: propIri,
          target: domainIri,
          label: "rdfs:domain",
          type: "domain",
        });
      }
    } else if (ax.type === "ObjectPropertyRange" || ax.type === "DataPropertyRange") {
      const propIri = ax.propertyIri;
      const rangeIri = ax.rangeIri ?? ax.classIri ?? ax.targetClassIri ?? ax.dataRange;
      if (propIri && rangeIri) {
        const isData =
          ax.type === "DataPropertyRange" ||
          nodesMap.get(propIri)?.type === "dataProperty" ||
          rangeIri.startsWith("xsd:") ||
          rangeIri.startsWith("rdfs:Literal");
        ensureNode(propIri, isData ? "dataProperty" : "objectProperty");
        ensureNode(rangeIri, isData ? "datatype" : "class");
        const meta = ensurePropertyMeta(propIri, isData ? "dataProperty" : "objectProperty");
        if (!meta.ranges.includes(rangeIri)) meta.ranges.push(rangeIri);
        rawEdgesData.push({
          source: propIri,
          target: rangeIri,
          label: "rdfs:range",
          type: "range",
        });
      }
    } else if (ax.type === "UniversalRestriction" && ax.propertyIri && ax.targetClassIri) {
      if (ax.classIri) {
        ensureNode(ax.classIri, "class");
        ensureNode(ax.targetClassIri, "class");
        pushUnique(
          classRestrictions,
          ax.classIri,
          `⊑ ∀${getShortLabel(ax.propertyIri)}.${getShortLabel(ax.targetClassIri)}`,
        );
      } else {
        ensureNode(ax.propertyIri, "objectProperty");
        ensureNode(ax.targetClassIri, "class");
        const meta = ensurePropertyMeta(ax.propertyIri, "objectProperty");
        if (!meta.domains.includes(ax.targetClassIri)) meta.domains.push(ax.targetClassIri);
        rawEdgesData.push({
          source: ax.propertyIri,
          target: ax.targetClassIri,
          label: "domain/range",
          type: "domain",
        });
      }
    } else if (ax.type === "InverseObjectProperty" || ax.type === "InverseObjectProperties") {
      const p1 = ax.propertyIri ?? ax.propertyIris?.[0];
      const p2 = ax.inversePropertyIri ?? ax.propertyIris?.[1];
      if (p1 && p2) {
        ensureNode(p1, "objectProperty");
        ensureNode(p2, "objectProperty");
        const m1 = ensurePropertyMeta(p1, "objectProperty");
        const m2 = ensurePropertyMeta(p2, "objectProperty");
        if (!m1.inverses.includes(p2)) m1.inverses.push(p2);
        if (!m2.inverses.includes(p1)) m2.inverses.push(p1);
        rawEdgesData.push({
          source: p1,
          target: p2,
          label: "owl:inverseOf",
          type: "inverseOf",
          isHorizontalPeer: true,
        });
      }
    } else if (
      ax.type === "FunctionalObjectProperty" ||
      ax.type === "InverseFunctionalObjectProperty" ||
      ax.type === "TransitiveObjectProperty" ||
      ax.type === "SymmetricObjectProperty" ||
      ax.type === "AsymmetricObjectProperty" ||
      ax.type === "ReflexiveObjectProperty" ||
      ax.type === "IrreflexiveObjectProperty" ||
      ax.type === "FunctionalDataProperty"
    ) {
      if (ax.propertyIri) {
        const isData = ax.type === "FunctionalDataProperty";
        ensureNode(ax.propertyIri, isData ? "dataProperty" : "objectProperty");
        const meta = ensurePropertyMeta(ax.propertyIri, isData ? "dataProperty" : "objectProperty");
        const badgeMap: Record<string, string> = {
          FunctionalObjectProperty: "Func",
          FunctionalDataProperty: "Func",
          InverseFunctionalObjectProperty: "InvFunc",
          TransitiveObjectProperty: "Trans",
          SymmetricObjectProperty: "Sym",
          AsymmetricObjectProperty: "Asym",
          ReflexiveObjectProperty: "Refl",
          IrreflexiveObjectProperty: "Irrefl",
        };
        const badge = badgeMap[ax.type];
        if (badge && !meta.characteristics.includes(badge)) {
          meta.characteristics.push(badge);
        }
      }
    } else if (ax.type === "EquivalentClasses" && Array.isArray(ax.classIris) && ax.classIris.length >= 2) {
      for (let i = 0; i < ax.classIris.length - 1; i++) {
        const c1 = ax.classIris[i]!;
        const c2 = ax.classIris[i + 1]!;
        ensureNode(c1, "class");
        ensureNode(c2, "class");
        rawEdgesData.push({
          source: c1,
          target: c2,
          label: "«equivalent» ≡",
          type: "equivalentTo",
          isHorizontalPeer: true,
        });
      }
    } else if (ax.type === "DisjointClasses" && Array.isArray(ax.classIris) && ax.classIris.length >= 2) {
      for (let i = 0; i < ax.classIris.length - 1; i++) {
        const c1 = ax.classIris[i]!;
        const c2 = ax.classIris[i + 1]!;
        ensureNode(c1, "class");
        ensureNode(c2, "class");
        rawEdgesData.push({
          source: c1,
          target: c2,
          label: "«disjoint» ≠",
          type: "disjointWith",
          isHorizontalPeer: true,
        });
      }
    }
  }

  // Append DL reasoner inferred SubClassOf edges (skipping owl:Thing, reflexive, and already-asserted pairs)
  if (options?.inferredSubClassOf) {
    for (const inf of options.inferredSubClassOf) {
      if (
        !inf.subClassIri ||
        !inf.superClassIri ||
        inf.subClassIri === inf.superClassIri ||
        inf.superClassIri === "owl:Thing" ||
        inf.subClassIri === "owl:Nothing"
      ) {
        continue;
      }
      const key = `${inf.subClassIri}→${inf.superClassIri}`;
      if (assertedSubClassPairs.has(key)) continue;
      assertedSubClassPairs.add(key);
      ensureNode(inf.subClassIri, "class");
      ensureNode(inf.superClassIri, "class");
      rawEdgesData.push({
        source: inf.subClassIri,
        target: inf.superClassIri,
        label: "«inferred» subClassOf",
        type: "inferredSubClassOf",
      });
    }
  }

  // Fold DataProperties with a declared domain into the domain class's attributes compartment
  const foldedDataProperties = new Set<string>();
  const foldedDatatypes = new Set<string>();
  for (const [propIri, meta] of propertyMetaMap) {
    if (meta.type === "dataProperty" && meta.domains.length > 0) {
      const rangeLabels =
        meta.ranges.length > 0
          ? meta.ranges.map((r) => (r.startsWith("xsd:") ? r : getShortLabel(r))).join(" | ")
          : "rdfs:Literal";
      const charSuffix = meta.characteristics.length > 0 ? ` [${meta.characteristics.join(",")}]` : "";
      for (const domIri of meta.domains) {
        pushUnique(classAttributes, domIri, `${getShortLabel(propIri)} : ${rangeLabels}${charSuffix}`);
      }
      foldedDataProperties.add(propIri);
      for (const rngIri of meta.ranges) {
        foldedDatatypes.add(rngIri);
      }
    }
  }

  // Fold ObjectProperties with both Domain and Range into direct semantic class-to-class edges in "All" view
  const foldedObjectProperties = new Set<string>();
  const consolidatedObjectEdges: OWL2Relationship[] = [];

  if (isAllView) {
    for (const [propIri, meta] of propertyMetaMap) {
      if (foldedObjectProperties.has(propIri)) continue;
      if (meta.type === "objectProperty" && meta.domains.length > 0 && meta.ranges.length > 0) {
        foldedObjectProperties.add(propIri);
        let label = getShortLabel(propIri);

        // Fold inverse properties that don't have conflicting independent domains/ranges
        const invLabels: string[] = [];
        for (const invIri of meta.inverses) {
          invLabels.push(getShortLabel(invIri));
          const invMeta = propertyMetaMap.get(invIri);
          if (!invMeta || (invMeta.domains.length === 0 && invMeta.ranges.length === 0)) {
            foldedObjectProperties.add(invIri);
          }
        }
        if (invLabels.length > 0) {
          label = `${label} ⇄ ${invLabels.join("/")}`;
        }
        if (meta.characteristics.length > 0) {
          label = `${label} [${meta.characteristics.join(",")}]`;
        }

        for (const domIri of meta.domains) {
          for (const rngIri of meta.ranges) {
            consolidatedObjectEdges.push({
              source: domIri,
              target: rngIri,
              label,
              type: "objectProperty",
            });
          }
        }
      }
    }
  }

  // Populate subtitles and compartment entries on entities
  for (const [iri, entity] of nodesMap) {
    if (entity.type === "class") {
      const attrs = classAttributes.get(iri) ?? [];
      const rests = classRestrictions.get(iri) ?? [];
      const combined = [...attrs, ...rests];
      if (combined.length > 0) {
        entity.compartmentEntries = combined;
      }
    } else if (entity.type === "individual") {
      const types = individualTypes.get(iri) ?? [];
      if (types.length > 0) {
        entity.subtitle = `: ${types.join(", ")}`;
      }
      const facts = individualFacts.get(iri) ?? [];
      if (facts.length > 0) {
        entity.compartmentEntries = facts;
      }
    } else if (entity.type === "objectProperty" || entity.type === "dataProperty") {
      const meta = propertyMetaMap.get(iri);
      if (meta && meta.characteristics.length > 0) {
        entity.subtitle = `[${meta.characteristics.join(", ")}]`;
      }
    }
  }

  // Select entities and edges for the active view
  let filteredEntities = Array.from(nodesMap.values());
  let filteredEdges: OWL2Relationship[] = [];

  if (isTaxonomyView) {
    filteredEntities = filteredEntities.filter((e) => e.type === "class");
    filteredEdges = rawEdgesData.filter(
      (e) =>
        e.type === "subClassOf" ||
        e.type === "inferredSubClassOf" ||
        e.type === "equivalentTo" ||
        e.type === "disjointWith",
    );
  } else if (isPropertiesView) {
    filteredEdges = rawEdgesData.filter((e) => e.type === "domain" || e.type === "range" || e.type === "inverseOf");
    const connectedEndpoints = new Set<string>();
    for (const e of filteredEdges) {
      connectedEndpoints.add(e.source);
      connectedEndpoints.add(e.target);
    }
    filteredEntities = filteredEntities.filter(
      (e) =>
        e.type === "objectProperty" ||
        e.type === "dataProperty" ||
        e.type === "datatype" ||
        connectedEndpoints.has(e.iri),
    );
  } else {
    // "All" view: hide folded ObjectProperty, DataProperty, and Datatype intermediary nodes
    // unless an explicit edge still references them.
    const nonFoldedRawEdges = rawEdgesData.filter((e) => {
      if (e.type === "domain" || e.type === "range") {
        if (foldedObjectProperties.has(e.source) || foldedDataProperties.has(e.source)) {
          return false;
        }
      }
      if (e.type === "inverseOf") {
        if (foldedObjectProperties.has(e.source) || foldedObjectProperties.has(e.target)) {
          return false;
        }
      }
      return true;
    });
    filteredEdges = [...nonFoldedRawEdges, ...consolidatedObjectEdges];

    const referencedByEdge = new Set<string>();
    for (const e of filteredEdges) {
      referencedByEdge.add(e.source);
      referencedByEdge.add(e.target);
    }

    filteredEntities = filteredEntities.filter((e) => {
      if (
        (foldedObjectProperties.has(e.iri) || foldedDataProperties.has(e.iri) || foldedDatatypes.has(e.iri)) &&
        !referencedByEdge.has(e.iri)
      ) {
        return false;
      }
      return true;
    });
  }

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  const typeStyles: Record<string, { fill: string; stroke: string; header: string }> = {
    class: { fill: "#1e293b", stroke: "#e11d48", header: "«owl:Class»" },
    definedClass: { fill: "#1e293b", stroke: "#d97706", header: "«owl:DefinedClass»" },
    objectProperty: { fill: "#1e293b", stroke: "#0284c7", header: "«owl:ObjectProperty»" },
    dataProperty: { fill: "#1e293b", stroke: "#16a34a", header: "«owl:DataProperty»" },
    individual: { fill: "#1e293b", stroke: "#7c3aed", header: "«owl:NamedIndividual»" },
    datatype: { fill: "#1e293b", stroke: "#0891b2", header: "«rdfs:Datatype»" },
  };

  const invisiblePortAttrs = { circle: { r: 0, fill: "transparent", stroke: "transparent" } };
  const portGroups = {
    top: { position: "top", zIndex: 10, attrs: invisiblePortAttrs },
    bottom: { position: "bottom", zIndex: 10, attrs: invisiblePortAttrs },
    left: { position: "left", zIndex: 10, attrs: invisiblePortAttrs },
    right: { position: "right", zIndex: 10, attrs: invisiblePortAttrs },
  };

  for (const entity of filteredEntities) {
    const isDefined = entity.isDefinedClass === true;
    const styleKey = isDefined ? "definedClass" : entity.type;
    const style = typeStyles[styleKey] ?? typeStyles["class"]!;

    const entries = entity.compartmentEntries ?? [];
    const hasEntries = entries.length > 0;
    const subtitle = entity.subtitle ?? "";
    const HEADER_BAND_H = 22;
    const TITLE_SECTION_H = subtitle ? 60 : 48;
    const LINE_H = 16;

    const savedPos = layout?.elements?.[entity.iri] ?? layout?.elements?.[entity.label];
    const maxTextWidth = Math.max(
      entity.label.length * 8.2 + 36,
      style.header.length * 6.8 + 34,
      subtitle ? subtitle.length * 7.0 + 34 : 0,
      ...entries.map((entry) => entry.length * 6.8 + 32),
    );
    const computedWidth = Math.max(176, Math.min(360, Math.ceil(maxTextWidth)));
    const computedHeight = hasEntries ? TITLE_SECTION_H + entries.length * LINE_H + 10 : subtitle ? 62 : 52;

    const width = savedPos?.width ?? computedWidth;
    const height = savedPos?.height ?? computedHeight;
    const x = savedPos?.x ?? 0;
    const y = savedPos?.y ?? 0;
    const autoLayout = !savedPos;
    const rx = entity.type === "individual" ? 12 : 8;

    const invisiblePortMarkup = {
      tagName: "circle",
      attrs: { r: 0, fill: "transparent", stroke: "transparent" },
    };

    const markup: { tagName: string; selector: string }[] = [
      { tagName: "rect", selector: "body" },
      { tagName: "rect", selector: "headerBand" },
      { tagName: "text", selector: "header" },
      { tagName: "text", selector: "label" },
      ...(subtitle ? [{ tagName: "text", selector: "subtitle" }] : []),
      ...(hasEntries ? [{ tagName: "line", selector: "headerSep" }] : []),
    ];

    const attrs: Record<string, Record<string, unknown>> = {
      body: {
        fill: style.fill,
        stroke: style.stroke,
        strokeWidth: isDefined ? 2.25 : 1.75,
        rx,
        ry: rx,
        refWidth: "100%",
        refHeight: "100%",
      },
      headerBand: {
        fill: style.stroke,
        fillOpacity: 0.14,
        stroke: "none",
        rx,
        ry: rx,
        refWidth: "100%",
        height: HEADER_BAND_H,
      },
      header: {
        text: style.header,
        fill: style.stroke,
        fontSize: 9.5,
        fontWeight: "600",
        textAnchor: "middle",
        textVerticalAnchor: "top",
        refX: 0.5,
        refY: 5,
      },
      label: {
        text: entity.label,
        fill: "#f8fafc",
        fontSize: 12.5,
        fontWeight: "700",
        textAnchor: "middle",
        textVerticalAnchor: "top",
        refX: 0.5,
        refY: 26,
      },
      ...(subtitle
        ? {
            subtitle: {
              text: subtitle,
              fill: "#94a3b8",
              fontSize: 10,
              fontStyle: "italic",
              textAnchor: "middle",
              textVerticalAnchor: "top",
              refX: 0.5,
              refY: 43,
            },
          }
        : {}),
      ...(hasEntries
        ? {
            headerSep: {
              x1: 0,
              y1: TITLE_SECTION_H,
              x2: width,
              y2: TITLE_SECTION_H,
              stroke: style.stroke,
              strokeOpacity: 0.45,
              strokeWidth: 1,
            },
          }
        : {}),
    };

    for (let i = 0; i < entries.length; i++) {
      const sel = `entry_${i}`;
      markup.push({ tagName: "text", selector: sel });
      attrs[sel] = {
        text: entries[i]!,
        fill: "#cbd5e1",
        fontSize: 10.5,
        fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
        textAnchor: "start",
        textVerticalAnchor: "top",
        refX: 12,
        refY: TITLE_SECTION_H + 6 + i * LINE_H,
      };
    }

    nodes.push({
      id: entity.iri,
      shape: "rect",
      x,
      y,
      width,
      height,
      angle: 0,
      opacity: 1,
      zIndex: 1,
      autoLayout,
      properties: {
        className: isDefined ? "DefinedClass" : entity.type.charAt(0).toUpperCase() + entity.type.slice(1),
        name: entity.label,
        description: entity.iri,
        parameters: [
          { name: "iri", value: entity.iri, group: "Identification" },
          { name: "type", value: entity.type, group: "Identification" },
          { name: "isDefinedClass", value: String(isDefined), group: "Identification", isBoolean: true },
        ],
      },
      data: {
        type: entity.type,
        kind: entity.type,
      },
      ports: {
        groups: portGroups,
        items: [
          {
            id: "top",
            group: "top",
            args: { x: width / 2, y: 0, angle: 270 },
            markup: invisiblePortMarkup,
          },
          {
            id: "bottom",
            group: "bottom",
            args: { x: width / 2, y: height, angle: 90 },
            markup: invisiblePortMarkup,
          },
          {
            id: "left",
            group: "left",
            args: { x: 0, y: height / 2, angle: 180 },
            markup: invisiblePortMarkup,
          },
          {
            id: "right",
            group: "right",
            args: { x: width, y: height / 2, angle: 0 },
            markup: invisiblePortMarkup,
          },
        ],
      },
      attrs,
      markup,
    });
  }

  let edgeIdx = 0;
  for (const rel of filteredEdges) {
    edgeIdx++;
    const edgeId = `owl_edge_${edgeIdx}_${rel.source}_${rel.target}`;

    let stroke = "#3b82f6";
    let strokeDasharray: string | undefined = undefined;
    let sourceMarker: Record<string, unknown> | undefined = undefined;
    let targetMarker: Record<string, unknown> | undefined = undefined;

    if (rel.type === "subClassOf") {
      stroke = "#3b82f6";
      targetMarker = {
        name: "path",
        d: "M 0 -6 L 11 0 L 0 6 Z",
        fill: "#ffffff",
        stroke: "#3b82f6",
        strokeWidth: 1.75,
      };
    } else if (rel.type === "inferredSubClassOf") {
      stroke = "#a855f7";
      strokeDasharray = "6 3";
      targetMarker = {
        name: "path",
        d: "M 0 -6 L 11 0 L 0 6 Z",
        fill: "#1e1e1e",
        stroke: "#a855f7",
        strokeWidth: 1.75,
      };
    } else if (rel.type === "equivalentTo") {
      stroke = "#d97706";
      strokeDasharray = "6 3";
      sourceMarker = { name: "classic", fill: "#d97706", size: 7 };
      targetMarker = { name: "classic", fill: "#d97706", size: 7 };
    } else if (rel.type === "disjointWith") {
      stroke = "#ef4444";
      strokeDasharray = "5 4";
      sourceMarker = { name: "classic", fill: "#ef4444", size: 7 };
      targetMarker = { name: "classic", fill: "#ef4444", size: 7 };
    } else if (rel.type === "objectProperty") {
      stroke = "#0284c7";
      targetMarker = { name: "classic", fill: "#0284c7" };
    } else if (rel.type === "objectPropertyAssertion") {
      stroke = "#8b5cf6";
      targetMarker = { name: "classic", fill: "#8b5cf6" };
    } else if (rel.type === "domain") {
      stroke = "#16a34a";
      targetMarker = { name: "classic", fill: "#16a34a" };
    } else if (rel.type === "range") {
      stroke = "#ea580c";
      targetMarker = { name: "classic", fill: "#ea580c" };
    } else if (rel.type === "inverseOf") {
      stroke = "#64748b";
      strokeDasharray = "4 4";
      sourceMarker = { name: "classic", fill: "#64748b", size: 7 };
      targetMarker = { name: "classic", fill: "#64748b", size: 7 };
    } else if (rel.type === "classAssertion") {
      stroke = "#7c3aed";
      strokeDasharray = "4 3";
      targetMarker = { name: "classic", fill: "#7c3aed" };
    }

    const isUpwardHierarchy =
      rel.type === "subClassOf" ||
      rel.type === "inferredSubClassOf" ||
      rel.type === "classAssertion" ||
      rel.type === "domain";
    const isDownwardHierarchy = rel.type === "range" || rel.type === "objectProperty";

    const sourcePort = isUpwardHierarchy ? "top" : isDownwardHierarchy ? "bottom" : "right";
    const targetPort = isUpwardHierarchy ? "bottom" : isDownwardHierarchy ? "top" : "left";

    edges.push({
      id: edgeId,
      source: { cell: rel.source, port: sourcePort, anchor: sourcePort, connectionPoint: { name: "boundary" } },
      target: { cell: rel.target, port: targetPort, anchor: targetPort, connectionPoint: { name: "boundary" } },
      zIndex: 0,
      router: { name: "manhattan", args: { padding: 20 } },
      connector: "rounded",
      style: { type: rel.type, isHorizontalPeer: rel.isHorizontalPeer },
      data: { type: rel.type, isHorizontalPeer: rel.isHorizontalPeer },
      labels: [
        {
          attrs: {
            text: {
              text: rel.label,
              fill: rel.type === "inferredSubClassOf" ? "#c084fc" : "#999",
              fontSize: 10,
              fontWeight: rel.type === "objectProperty" || rel.type === "objectPropertyAssertion" ? "600" : "500",
            },
            rect: {
              fill: "#1e1e1e",
              rx: 4,
              ry: 4,
            },
          },
          position: 0.5,
        },
      ],
      attrs: {
        line: {
          stroke,
          strokeWidth: 1.75,
          strokeDasharray,
          ...(sourceMarker ? { sourceMarker } : {}),
          targetMarker,
          "vector-effect": "non-scaling-stroke",
          "pointer-events": "none",
        },
      },
    });
  }

  return {
    nodes,
    edges,
    coordinateSystem: null,
    diagramBackground: null,
    availableViews: [
      { id: "All", label: "All Entities" },
      { id: "Taxonomy", label: "Class Taxonomy" },
      { id: "Properties", label: "Properties & Domains" },
    ],
    activeView: diagramType,
  };
}

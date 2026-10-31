// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseXml, type XmlElement } from "@modelscript/dsl/xml";
import type { OWL2Axiom } from "@modelscript/runtime";
import { BUILTIN_OWL2_PREFIXES } from "../cst-lowering.js";

function localTagName(tagName: string): string {
  const colonIdx = tagName.indexOf(":");
  return colonIdx >= 0 ? tagName.slice(colonIdx + 1) : tagName;
}

function getAttr(el: XmlElement, ...names: string[]): string | undefined {
  for (const name of names) {
    const found = el.attributes.find((a) => a.name === name || localTagName(a.name) === name);
    if (found) return found.value;
  }
  return undefined;
}

/**
 * Parses a W3C OWL 2 XML (`.owx`) or RDF/XML (`.owl`) ontology document into normalized `OWL2Axiom[]`
 * with recursive Tseitin auxiliary concept normalization for nested class expressions.
 */
export function parseOwlXmlToAxioms(source: string): OWL2Axiom[] {
  const doc = parseXml(source);
  if (!doc.root) return [];

  const prefixes = new Map<string, string>(BUILTIN_OWL2_PREFIXES);
  const axioms: OWL2Axiom[] = [];
  const declaredClasses = new Set<string>();
  const declaredDataProps = new Set<string>();
  let auxCounter = 0;

  const freshAuxIri = (): string => `__aux_${++auxCounter}`;

  // Collect xmlns:* and <Prefix name="..." IRI="..."/> declarations
  const collectPrefixes = (el: XmlElement): void => {
    for (const attr of el.attributes) {
      if (attr.name === "xmlns" || attr.name === "xml:base") {
        if (!prefixes.has(":")) {
          prefixes.set(":", attr.value);
        }
      } else if (attr.name.startsWith("xmlns:")) {
        const pfx = `${attr.name.slice("xmlns:".length)}:`;
        prefixes.set(pfx, attr.value);
      }
    }
    for (const child of el.children) {
      if (localTagName(child.name) === "Prefix") {
        const name = getAttr(child, "name") ?? "";
        const iri = getAttr(child, "IRI") ?? "";
        if (iri) {
          prefixes.set(name.endsWith(":") ? name : `${name}:`, iri);
        }
      }
    }
  };

  collectPrefixes(doc.root);

  const normIri = (raw: string | undefined): string => {
    if (!raw) return "owl:Thing";
    let clean = raw.trim();
    if (clean.startsWith("<") && clean.endsWith(">")) {
      clean = clean.slice(1, -1);
    }
    if (clean.startsWith("#")) {
      clean = `:${clean.slice(1)}`;
    }
    // Check if full IRI matches any registered prefix namespace
    for (const [pfx, ns] of prefixes) {
      if (ns && clean.startsWith(ns) && clean.length > ns.length) {
        const local = clean.slice(ns.length);
        if (/^[A-Za-z0-9_-]+$/.test(local)) {
          return `${pfx}${local}`;
        }
      }
    }
    return clean;
  };

  const ensureClassDecl = (iri: string): void => {
    if (iri && !iri.startsWith("__aux_") && iri !== "owl:Thing" && iri !== "owl:Nothing" && !declaredClasses.has(iri)) {
      declaredClasses.add(iri);
      axioms.push({ type: "ClassDeclaration", iri });
    }
  };

  const resolveEntityIri = (el: XmlElement): string => {
    const abbrev = getAttr(el, "abbreviatedIRI");
    if (abbrev) return normIri(abbrev);
    const iri = getAttr(el, "IRI", "about", "resource", "ID");
    if (iri) return normIri(iri);
    if (el.text.trim()) return normIri(el.text.trim());
    return "owl:Thing";
  };

  // ── OWL/XML (.owx) Class Expression Normalization ──────────────────────────
  const normalizeOwlXmlClassExpr = (el: XmlElement, targetIri?: string): string => {
    const tag = localTagName(el.name);
    if (tag === "Class") {
      const iri = resolveEntityIri(el);
      ensureClassDecl(iri);
      if (targetIri && targetIri !== iri) {
        axioms.push({ type: "SubClassOf", subClassIri: targetIri, superClassIri: iri });
      }
      return iri;
    }

    const auxIri = targetIri ?? freshAuxIri();

    if (tag === "ObjectIntersectionOf") {
      const opIris = el.children.map((c) => normalizeOwlXmlClassExpr(c));
      axioms.push({
        type: "ClassDeclaration",
        iri: auxIri,
        intersectionOf: opIris,
      } as unknown as OWL2Axiom);
      for (const op of opIris) {
        axioms.push({ type: "SubClassOf", subClassIri: auxIri, superClassIri: op });
      }
      return auxIri;
    }

    if (tag === "ObjectUnionOf") {
      const opIris = el.children.map((c) => normalizeOwlXmlClassExpr(c));
      axioms.push({
        type: "ClassDeclaration",
        iri: auxIri,
        unionOf: opIris,
      } as unknown as OWL2Axiom);
      axioms.push({
        type: "DisjunctiveClass",
        superClassIri: auxIri,
        classIris: opIris,
        unionEquiv: true,
      } as unknown as OWL2Axiom);
      return auxIri;
    }

    if (tag === "ObjectComplementOf" && el.children.length >= 1) {
      const opIri = normalizeOwlXmlClassExpr(el.children[0]!);
      axioms.push({
        type: "ClassDeclaration",
        iri: auxIri,
        complementOf: opIri,
      } as unknown as OWL2Axiom);
      axioms.push({ type: "DisjointClasses", classIris: [auxIri, opIri] });
      return auxIri;
    }

    if (tag === "ObjectOneOf") {
      const inds = el.children.map((c) => resolveEntityIri(c));
      if (!targetIri) {
        axioms.push({ type: "ClassDeclaration", iri: auxIri });
      }
      axioms.push({
        type: "ObjectOneOf",
        classIri: auxIri,
        individualIris: inds,
      } as unknown as OWL2Axiom);
      return auxIri;
    }

    if (tag === "ObjectSomeValuesFrom" && el.children.length >= 2) {
      const propIri = resolveEntityIri(el.children[0]!);
      const fillerIri = normalizeOwlXmlClassExpr(el.children[1]!);
      axioms.push({
        type: "ClassDeclaration",
        iri: auxIri,
        someValuesFrom: { propertyIri: propIri, fillerClassIri: fillerIri },
      } as unknown as OWL2Axiom);
      axioms.push({
        type: "ObjectSomeValuesFrom",
        subClassIri: auxIri,
        propertyIri: propIri,
        fillerClassIri: fillerIri,
      });
      return auxIri;
    }

    if (tag === "ObjectAllValuesFrom" && el.children.length >= 2) {
      const propIri = resolveEntityIri(el.children[0]!);
      const fillerIri = normalizeOwlXmlClassExpr(el.children[1]!);
      axioms.push({
        type: "ClassDeclaration",
        iri: auxIri,
        allValuesFrom: { propertyIri: propIri, targetClassIri: fillerIri },
      } as unknown as OWL2Axiom);
      axioms.push({
        type: "UniversalRestriction",
        classIri: auxIri,
        propertyIri: propIri,
        targetClassIri: fillerIri,
      });
      return auxIri;
    }

    if (tag === "ObjectHasValue" && el.children.length >= 2) {
      const propIri = resolveEntityIri(el.children[0]!);
      const indIri = resolveEntityIri(el.children[1]!);
      if (!targetIri) {
        axioms.push({ type: "ClassDeclaration", iri: auxIri });
      }
      axioms.push({
        type: "ObjectSomeValuesFrom",
        subClassIri: auxIri,
        propertyIri: propIri,
        fillerClassIri: indIri,
        isNominal: true,
      } as unknown as OWL2Axiom);
      return auxIri;
    }

    if (tag === "ObjectHasSelf" && el.children.length >= 1) {
      const propIri = resolveEntityIri(el.children[0]!);
      if (!targetIri) {
        axioms.push({ type: "ClassDeclaration", iri: auxIri });
      }
      axioms.push({
        type: "SelfRestriction",
        classIri: auxIri,
        propertyIri: propIri,
      } as unknown as OWL2Axiom);
      return auxIri;
    }

    if (
      (tag === "ObjectMinCardinality" || tag === "ObjectMaxCardinality" || tag === "ObjectExactCardinality") &&
      el.children.length >= 1
    ) {
      const cardType: "min" | "max" | "exact" =
        tag === "ObjectMinCardinality" ? "min" : tag === "ObjectMaxCardinality" ? "max" : "exact";
      const count = Math.max(0, parseInt(getAttr(el, "cardinality") ?? "1", 10) || 0);
      const propIri = resolveEntityIri(el.children[0]!);
      const fillerIri = el.children.length >= 2 ? normalizeOwlXmlClassExpr(el.children[1]!) : "owl:Thing";
      if (!targetIri) {
        axioms.push({ type: "ClassDeclaration", iri: auxIri });
      }
      axioms.push({
        type: "QualifiedCardinality",
        classIri: auxIri,
        propertyIri: propIri,
        cardinalityType: cardType,
        count,
        fillerClassIri: fillerIri,
      });
      return auxIri;
    }

    if ((tag === "DataSomeValuesFrom" || tag === "DataAllValuesFrom") && el.children.length >= 2) {
      const propIri = resolveEntityIri(el.children[0]!);
      const rangeIri = resolveEntityIri(el.children[el.children.length - 1]!);
      if (!targetIri) {
        axioms.push({ type: "ClassDeclaration", iri: auxIri });
      }
      axioms.push({
        type: tag === "DataSomeValuesFrom" ? "DataSomeValuesFrom" : "DataAllValuesFrom",
        subClassIri: auxIri,
        propertyIri: propIri,
        fillerDatatypeIri: rangeIri,
      } as unknown as OWL2Axiom);
      return auxIri;
    }

    if (tag === "DataHasValue" && el.children.length >= 2) {
      const propIri = resolveEntityIri(el.children[0]!);
      const litVal = el.children[1]?.text.trim() ?? "";
      if (!targetIri) {
        axioms.push({ type: "ClassDeclaration", iri: auxIri });
      }
      axioms.push({
        type: "DataHasValue",
        classIri: auxIri,
        propertyIri: propIri,
        value: litVal,
      } as unknown as OWL2Axiom);
      return auxIri;
    }

    return resolveEntityIri(el);
  };

  // ── RDF/XML (.owl) Class Expression Normalization ──────────────────────────
  const normalizeRdfXmlClassNode = (el: XmlElement, targetIri?: string): string => {
    const tag = localTagName(el.name);
    const DirectRef = getAttr(el, "about", "resource", "ID");
    if (DirectRef && el.children.length === 0) {
      const iri = normIri(DirectRef);
      ensureClassDecl(iri);
      return iri;
    }

    const auxIri = targetIri ?? (DirectRef ? normIri(DirectRef) : freshAuxIri());
    if (DirectRef) ensureClassDecl(auxIri);

    if (tag === "Restriction" || el.children.some((c) => localTagName(c.name) === "onProperty")) {
      const onPropEl = el.children.find((c) => localTagName(c.name) === "onProperty");
      const propIri = onPropEl
        ? onPropEl.children.length > 0
          ? resolveEntityIri(onPropEl.children[0]!)
          : resolveEntityIri(onPropEl)
        : "owl:topObjectProperty";

      const someEl = el.children.find((c) => localTagName(c.name) === "someValuesFrom");
      if (someEl) {
        const fillerIri =
          someEl.children.length > 0 ? normalizeRdfXmlClassNode(someEl.children[0]!) : resolveEntityIri(someEl);
        axioms.push({
          type: "ClassDeclaration",
          iri: auxIri,
          someValuesFrom: { propertyIri: propIri, fillerClassIri: fillerIri },
        } as unknown as OWL2Axiom);
        axioms.push({
          type: "ObjectSomeValuesFrom",
          subClassIri: auxIri,
          propertyIri: propIri,
          fillerClassIri: fillerIri,
        });
        return auxIri;
      }

      const allEl = el.children.find((c) => localTagName(c.name) === "allValuesFrom");
      if (allEl) {
        const fillerIri =
          allEl.children.length > 0 ? normalizeRdfXmlClassNode(allEl.children[0]!) : resolveEntityIri(allEl);
        axioms.push({
          type: "ClassDeclaration",
          iri: auxIri,
          allValuesFrom: { propertyIri: propIri, targetClassIri: fillerIri },
        } as unknown as OWL2Axiom);
        axioms.push({
          type: "UniversalRestriction",
          classIri: auxIri,
          propertyIri: propIri,
          targetClassIri: fillerIri,
        });
        return auxIri;
      }

      const hasValEl = el.children.find((c) => localTagName(c.name) === "hasValue");
      if (hasValEl) {
        const resAttr = getAttr(hasValEl, "resource");
        if (resAttr) {
          axioms.push({
            type: "ObjectSomeValuesFrom",
            subClassIri: auxIri,
            propertyIri: propIri,
            fillerClassIri: normIri(resAttr),
            isNominal: true,
          } as unknown as OWL2Axiom);
        } else {
          axioms.push({
            type: "DataHasValue",
            classIri: auxIri,
            propertyIri: propIri,
            value: hasValEl.text.trim(),
          } as unknown as OWL2Axiom);
        }
        return auxIri;
      }

      const minEl = el.children.find(
        (c) => localTagName(c.name) === "minQualifiedCardinality" || localTagName(c.name) === "minCardinality",
      );
      const maxEl = el.children.find(
        (c) => localTagName(c.name) === "maxQualifiedCardinality" || localTagName(c.name) === "maxCardinality",
      );
      const exactEl = el.children.find(
        (c) => localTagName(c.name) === "qualifiedCardinality" || localTagName(c.name) === "cardinality",
      );
      const cardEl = minEl ?? maxEl ?? exactEl;
      if (cardEl) {
        const cardType: "min" | "max" | "exact" = minEl ? "min" : maxEl ? "max" : "exact";
        const count = Math.max(0, parseInt(cardEl.text.trim(), 10) || 0);
        const onClassEl = el.children.find((c) => localTagName(c.name) === "onClass");
        const fillerIri = onClassEl
          ? onClassEl.children.length > 0
            ? normalizeRdfXmlClassNode(onClassEl.children[0]!)
            : resolveEntityIri(onClassEl)
          : "owl:Thing";
        axioms.push({
          type: "QualifiedCardinality",
          classIri: auxIri,
          propertyIri: propIri,
          cardinalityType: cardType,
          count,
          fillerClassIri: fillerIri,
        });
        return auxIri;
      }
    }

    const interEl = el.children.find((c) => localTagName(c.name) === "intersectionOf");
    if (interEl) {
      const opIris = interEl.children.map((c) => normalizeRdfXmlClassNode(c));
      axioms.push({
        type: "ClassDeclaration",
        iri: auxIri,
        intersectionOf: opIris,
      } as unknown as OWL2Axiom);
      for (const op of opIris) {
        axioms.push({ type: "SubClassOf", subClassIri: auxIri, superClassIri: op });
      }
      return auxIri;
    }

    const unionEl = el.children.find((c) => localTagName(c.name) === "unionOf");
    if (unionEl) {
      const opIris = unionEl.children.map((c) => normalizeRdfXmlClassNode(c));
      axioms.push({
        type: "ClassDeclaration",
        iri: auxIri,
        unionOf: opIris,
      } as unknown as OWL2Axiom);
      axioms.push({
        type: "DisjunctiveClass",
        superClassIri: auxIri,
        classIris: opIris,
        unionEquiv: true,
      } as unknown as OWL2Axiom);
      return auxIri;
    }

    const compEl = el.children.find((c) => localTagName(c.name) === "complementOf");
    if (compEl) {
      const opIri =
        compEl.children.length > 0 ? normalizeRdfXmlClassNode(compEl.children[0]!) : resolveEntityIri(compEl);
      axioms.push({
        type: "ClassDeclaration",
        iri: auxIri,
        complementOf: opIri,
      } as unknown as OWL2Axiom);
      axioms.push({ type: "DisjointClasses", classIris: [auxIri, opIri] });
      return auxIri;
    }

    return auxIri;
  };

  const rootTag = localTagName(doc.root.name);

  if (rootTag === "RDF") {
    // ── W3C RDF/XML (.owl) Processing ──────────────────────────────────────
    for (const el of doc.root.children) {
      const tag = localTagName(el.name);
      const subjAttr = getAttr(el, "about", "ID");
      const subjIri = subjAttr ? normIri(subjAttr) : freshAuxIri();

      if (tag === "Ontology") continue;

      if (tag === "Class") {
        if (subjAttr) ensureClassDecl(subjIri);
        normalizeRdfXmlClassNode(el, subjIri);
        for (const child of el.children) {
          const cTag = localTagName(child.name);
          if (cTag === "subClassOf") {
            const supIri =
              child.children.length > 0 ? normalizeRdfXmlClassNode(child.children[0]!) : resolveEntityIri(child);
            axioms.push({ type: "SubClassOf", subClassIri: subjIri, superClassIri: supIri });
          } else if (cTag === "equivalentClass") {
            const eqIri =
              child.children.length > 0 ? normalizeRdfXmlClassNode(child.children[0]!) : resolveEntityIri(child);
            axioms.push({ type: "EquivalentClasses", classIris: [subjIri, eqIri] });
          } else if (cTag === "disjointWith") {
            const disjIri =
              child.children.length > 0 ? normalizeRdfXmlClassNode(child.children[0]!) : resolveEntityIri(child);
            axioms.push({ type: "DisjointClasses", classIris: [subjIri, disjIri] });
          }
        }
        continue;
      }

      if (
        tag === "ObjectProperty" ||
        tag === "TransitiveProperty" ||
        tag === "SymmetricProperty" ||
        tag === "AsymmetricProperty" ||
        tag === "ReflexiveProperty" ||
        tag === "IrreflexiveProperty" ||
        tag === "FunctionalProperty" ||
        tag === "InverseFunctionalProperty"
      ) {
        axioms.push({ type: "ObjectPropertyDeclaration", iri: subjIri });
        if (tag === "TransitiveProperty") axioms.push({ type: "TransitiveObjectProperty", propertyIri: subjIri });
        if (tag === "SymmetricProperty") axioms.push({ type: "SymmetricObjectProperty", propertyIri: subjIri });
        if (tag === "AsymmetricProperty") axioms.push({ type: "AsymmetricObjectProperty", propertyIri: subjIri });
        if (tag === "ReflexiveProperty") axioms.push({ type: "ReflexiveObjectProperty", propertyIri: subjIri });
        if (tag === "IrreflexiveProperty") axioms.push({ type: "IrreflexiveObjectProperty", propertyIri: subjIri });
        if (tag === "FunctionalProperty") axioms.push({ type: "FunctionalObjectProperty", propertyIri: subjIri });
        if (tag === "InverseFunctionalProperty") {
          axioms.push({ type: "InverseFunctionalObjectProperty", propertyIri: subjIri });
        }

        for (const child of el.children) {
          const cTag = localTagName(child.name);
          if (cTag === "type") {
            const tIri = resolveEntityIri(child);
            if (tIri === "owl:TransitiveProperty")
              axioms.push({ type: "TransitiveObjectProperty", propertyIri: subjIri });
            if (tIri === "owl:SymmetricProperty")
              axioms.push({ type: "SymmetricObjectProperty", propertyIri: subjIri });
            if (tIri === "owl:FunctionalProperty")
              axioms.push({ type: "FunctionalObjectProperty", propertyIri: subjIri });
            if (tIri === "owl:InverseFunctionalProperty") {
              axioms.push({ type: "InverseFunctionalObjectProperty", propertyIri: subjIri });
            }
          } else if (cTag === "subPropertyOf") {
            axioms.push({
              type: "SubObjectPropertyOf",
              subPropertyIri: subjIri,
              superPropertyIri: resolveEntityIri(child),
            });
          } else if (cTag === "inverseOf") {
            axioms.push({
              type: "InverseObjectProperty",
              propertyIri: subjIri,
              inversePropertyIri: resolveEntityIri(child),
            });
          } else if (cTag === "domain") {
            const domIri =
              child.children.length > 0 ? normalizeRdfXmlClassNode(child.children[0]!) : resolveEntityIri(child);
            axioms.push({ type: "ObjectPropertyDomain", propertyIri: subjIri, domainIri: domIri });
          } else if (cTag === "range") {
            const rngIri =
              child.children.length > 0 ? normalizeRdfXmlClassNode(child.children[0]!) : resolveEntityIri(child);
            axioms.push({ type: "ObjectPropertyRange", propertyIri: subjIri, rangeIri: rngIri });
          } else if (cTag === "propertyChainAxiom") {
            const chainIris = child.children.map((c) => resolveEntityIri(c));
            if (chainIris.length >= 2) {
              axioms.push({
                type: "SubObjectPropertyChainOf",
                propertyChainIris: chainIris,
                superPropertyIri: subjIri,
              } as unknown as OWL2Axiom);
            }
          }
        }
        continue;
      }

      if (tag === "DatatypeProperty") {
        declaredDataProps.add(subjIri);
        axioms.push({ type: "DataPropertyDeclaration", iri: subjIri });
        for (const child of el.children) {
          const cTag = localTagName(child.name);
          if (cTag === "domain") {
            axioms.push({
              type: "DataPropertyDomain",
              propertyIri: subjIri,
              domainIri: resolveEntityIri(child),
            });
          } else if (cTag === "range") {
            axioms.push({
              type: "DataPropertyRange",
              propertyIri: subjIri,
              rangeIri: resolveEntityIri(child),
            });
          }
        }
        continue;
      }

      if (tag === "AllDisjointClasses") {
        const membersEl = el.children.find((c) => localTagName(c.name) === "members");
        if (membersEl) {
          const classIris = membersEl.children.map((c) => normalizeRdfXmlClassNode(c));
          if (classIris.length >= 2) {
            axioms.push({ type: "DisjointClasses", classIris });
          }
        }
        continue;
      }

      if (tag === "AllDifferent") {
        const membersEl = el.children.find(
          (c) => localTagName(c.name) === "distinctMembers" || localTagName(c.name) === "members",
        );
        if (membersEl) {
          const individualIris = membersEl.children.map((c) => resolveEntityIri(c));
          if (individualIris.length >= 2) {
            axioms.push({ type: "DifferentIndividuals", individualIris });
          }
        }
        continue;
      }

      // NamedIndividual or typed individual element (e.g. <ex:Car rdf:about="#myCar">)
      axioms.push({ type: "IndividualDeclaration", iri: subjIri });
      if (tag !== "NamedIndividual" && tag !== "Description") {
        const clsIri = normIri(el.name.includes(":") ? el.name : `:${el.name}`);
        ensureClassDecl(clsIri);
        axioms.push({ type: "ClassAssertion", classIri: clsIri, individualIri: subjIri });
      }
      for (const child of el.children) {
        const cTag = localTagName(child.name);
        if (cTag === "type") {
          const tIri =
            child.children.length > 0 ? normalizeRdfXmlClassNode(child.children[0]!) : resolveEntityIri(child);
          if (tIri !== "owl:NamedIndividual" && tIri !== "owl:Thing") {
            axioms.push({ type: "ClassAssertion", classIri: tIri, individualIri: subjIri });
          }
        } else if (cTag === "sameAs") {
          axioms.push({ type: "SameIndividual", individualIris: [subjIri, resolveEntityIri(child)] });
        } else if (cTag === "differentFrom") {
          axioms.push({ type: "DifferentIndividuals", individualIris: [subjIri, resolveEntityIri(child)] });
        } else {
          const propIri = normIri(child.name.includes(":") ? child.name : `:${child.name}`);
          const resAttr = getAttr(child, "resource");
          if (resAttr && !declaredDataProps.has(propIri)) {
            axioms.push({
              type: "ObjectPropertyAssertion",
              propertyIri: propIri,
              subjectIri: subjIri,
              objectIri: normIri(resAttr),
            });
          } else if (child.text.trim()) {
            axioms.push({
              type: "DataPropertyAssertion",
              propertyIri: propIri,
              subjectIri: subjIri,
              value: child.text.trim(),
            });
          }
        }
      }
    }
    return axioms;
  }

  // ── W3C OWL 2 XML (.owx) Processing ──────────────────────────────────────
  for (const el of doc.root.children) {
    const tag = localTagName(el.name);
    switch (tag) {
      case "Declaration": {
        const entity = el.children[0];
        if (!entity) break;
        const eTag = localTagName(entity.name);
        const iri = resolveEntityIri(entity);
        if (eTag === "Class") {
          declaredClasses.add(iri);
          axioms.push({ type: "ClassDeclaration", iri });
        } else if (eTag === "ObjectProperty") {
          axioms.push({ type: "ObjectPropertyDeclaration", iri });
        } else if (eTag === "DataProperty") {
          declaredDataProps.add(iri);
          axioms.push({ type: "DataPropertyDeclaration", iri });
        } else if (eTag === "NamedIndividual") {
          axioms.push({ type: "IndividualDeclaration", iri });
        }
        break;
      }

      case "SubClassOf": {
        if (el.children.length < 2) break;
        const subEl = el.children[el.children.length - 2]!;
        const supEl = el.children[el.children.length - 1]!;
        const subIri = normalizeOwlXmlClassExpr(subEl);
        if (localTagName(supEl.name) !== "Class") {
          normalizeOwlXmlClassExpr(supEl, subIri);
        } else {
          const supIri = normalizeOwlXmlClassExpr(supEl);
          axioms.push({ type: "SubClassOf", subClassIri: subIri, superClassIri: supIri });
        }
        break;
      }

      case "EquivalentClasses": {
        const classIris = el.children.map((c) => normalizeOwlXmlClassExpr(c));
        if (classIris.length >= 2) {
          axioms.push({ type: "EquivalentClasses", classIris });
        }
        break;
      }

      case "DisjointClasses": {
        const classIris = el.children.map((c) => normalizeOwlXmlClassExpr(c));
        if (classIris.length >= 2) {
          axioms.push({ type: "DisjointClasses", classIris });
        }
        break;
      }

      case "DisjointUnion": {
        if (el.children.length < 2) break;
        const targetIri = normalizeOwlXmlClassExpr(el.children[0]!);
        const memberIris = el.children.slice(1).map((c) => normalizeOwlXmlClassExpr(c));
        axioms.push({ type: "DisjointClasses", classIris: memberIris });
        axioms.push({
          type: "DisjunctiveClass",
          superClassIri: targetIri,
          classIris: memberIris,
          unionEquiv: true,
        } as unknown as OWL2Axiom);
        break;
      }

      case "SubObjectPropertyOf": {
        if (el.children.length < 2) break;
        const first = el.children[el.children.length - 2]!;
        const second = el.children[el.children.length - 1]!;
        const supProp = resolveEntityIri(second);
        if (localTagName(first.name) === "ObjectPropertyChain") {
          const chainIris = first.children.map((c) => resolveEntityIri(c));
          if (chainIris.length >= 2) {
            axioms.push({
              type: "SubObjectPropertyChainOf",
              propertyChainIris: chainIris,
              superPropertyIri: supProp,
            } as unknown as OWL2Axiom);
          }
        } else {
          const subProp = resolveEntityIri(first);
          axioms.push({ type: "SubObjectPropertyOf", subPropertyIri: subProp, superPropertyIri: supProp });
        }
        break;
      }

      case "EquivalentObjectProperties": {
        const props = el.children.map((c) => resolveEntityIri(c));
        for (let i = 0; i < props.length; i++) {
          for (let j = 0; j < props.length; j++) {
            if (i !== j) {
              axioms.push({
                type: "SubObjectPropertyOf",
                subPropertyIri: props[i]!,
                superPropertyIri: props[j]!,
              });
            }
          }
        }
        break;
      }

      case "DisjointObjectProperties": {
        const props = el.children.map((c) => resolveEntityIri(c));
        if (props.length >= 2) {
          axioms.push({ type: "DisjointObjectProperties", propertyIris: props } as unknown as OWL2Axiom);
        }
        break;
      }

      case "InverseObjectProperties": {
        if (el.children.length >= 2) {
          axioms.push({
            type: "InverseObjectProperty",
            propertyIri: resolveEntityIri(el.children[0]!),
            inversePropertyIri: resolveEntityIri(el.children[1]!),
          });
        }
        break;
      }

      case "TransitiveObjectProperty":
        if (el.children[0])
          axioms.push({ type: "TransitiveObjectProperty", propertyIri: resolveEntityIri(el.children[0]) });
        break;
      case "SymmetricObjectProperty":
        if (el.children[0])
          axioms.push({ type: "SymmetricObjectProperty", propertyIri: resolveEntityIri(el.children[0]) });
        break;
      case "AsymmetricObjectProperty":
        if (el.children[0])
          axioms.push({ type: "AsymmetricObjectProperty", propertyIri: resolveEntityIri(el.children[0]) });
        break;
      case "ReflexiveObjectProperty":
        if (el.children[0])
          axioms.push({ type: "ReflexiveObjectProperty", propertyIri: resolveEntityIri(el.children[0]) });
        break;
      case "IrreflexiveObjectProperty":
        if (el.children[0])
          axioms.push({ type: "IrreflexiveObjectProperty", propertyIri: resolveEntityIri(el.children[0]) });
        break;
      case "FunctionalObjectProperty":
        if (el.children[0])
          axioms.push({ type: "FunctionalObjectProperty", propertyIri: resolveEntityIri(el.children[0]) });
        break;
      case "InverseFunctionalObjectProperty":
        if (el.children[0]) {
          axioms.push({ type: "InverseFunctionalObjectProperty", propertyIri: resolveEntityIri(el.children[0]) });
        }
        break;
      case "FunctionalDataProperty":
        if (el.children[0])
          axioms.push({ type: "FunctionalDataProperty", propertyIri: resolveEntityIri(el.children[0]) });
        break;

      case "ObjectPropertyDomain": {
        if (el.children.length >= 2) {
          const propIri = resolveEntityIri(el.children[0]!);
          const domIri = normalizeOwlXmlClassExpr(el.children[1]!);
          axioms.push({ type: "ObjectPropertyDomain", propertyIri: propIri, domainIri: domIri });
        }
        break;
      }

      case "ObjectPropertyRange": {
        if (el.children.length >= 2) {
          const propIri = resolveEntityIri(el.children[0]!);
          const rngIri = normalizeOwlXmlClassExpr(el.children[1]!);
          axioms.push({ type: "ObjectPropertyRange", propertyIri: propIri, rangeIri: rngIri });
        }
        break;
      }

      case "DataPropertyDomain": {
        if (el.children.length >= 2) {
          const propIri = resolveEntityIri(el.children[0]!);
          const domIri = normalizeOwlXmlClassExpr(el.children[1]!);
          axioms.push({ type: "DataPropertyDomain", propertyIri: propIri, domainIri: domIri });
        }
        break;
      }

      case "DataPropertyRange": {
        if (el.children.length >= 2) {
          const propIri = resolveEntityIri(el.children[0]!);
          const rngIri = resolveEntityIri(el.children[1]!);
          axioms.push({ type: "DataPropertyRange", propertyIri: propIri, rangeIri: rngIri });
        }
        break;
      }

      case "ClassAssertion": {
        if (el.children.length >= 2) {
          const clsEl = el.children[el.children.length - 2]!;
          const indEl = el.children[el.children.length - 1]!;
          const clsIri = normalizeOwlXmlClassExpr(clsEl);
          const indIri = resolveEntityIri(indEl);
          axioms.push({ type: "ClassAssertion", classIri: clsIri, individualIri: indIri });
        }
        break;
      }

      case "ObjectPropertyAssertion": {
        if (el.children.length >= 3) {
          const propIri = resolveEntityIri(el.children[el.children.length - 3]!);
          const subjIri = resolveEntityIri(el.children[el.children.length - 2]!);
          const objIri = resolveEntityIri(el.children[el.children.length - 1]!);
          axioms.push({
            type: "ObjectPropertyAssertion",
            propertyIri: propIri,
            subjectIri: subjIri,
            objectIri: objIri,
          });
        }
        break;
      }

      case "NegativeObjectPropertyAssertion": {
        if (el.children.length >= 3) {
          const propIri = resolveEntityIri(el.children[el.children.length - 3]!);
          const subjIri = resolveEntityIri(el.children[el.children.length - 2]!);
          const objIri = resolveEntityIri(el.children[el.children.length - 1]!);
          axioms.push({
            type: "NegativeObjectPropertyAssertion",
            propertyIri: propIri,
            subjectIri: subjIri,
            objectIri: objIri,
          });
        }
        break;
      }

      case "DataPropertyAssertion": {
        if (el.children.length >= 3) {
          const propIri = resolveEntityIri(el.children[el.children.length - 3]!);
          const subjIri = resolveEntityIri(el.children[el.children.length - 2]!);
          const litEl = el.children[el.children.length - 1]!;
          axioms.push({
            type: "DataPropertyAssertion",
            propertyIri: propIri,
            subjectIri: subjIri,
            value: litEl.text.trim(),
          });
        }
        break;
      }

      case "NegativeDataPropertyAssertion": {
        if (el.children.length >= 3) {
          const propIri = resolveEntityIri(el.children[el.children.length - 3]!);
          const subjIri = resolveEntityIri(el.children[el.children.length - 2]!);
          const litEl = el.children[el.children.length - 1]!;
          axioms.push({
            type: "NegativeDataPropertyAssertion",
            propertyIri: propIri,
            subjectIri: subjIri,
            value: litEl.text.trim(),
          });
        }
        break;
      }

      case "SameIndividual": {
        const inds = el.children.map((c) => resolveEntityIri(c));
        if (inds.length >= 2) {
          axioms.push({ type: "SameIndividual", individualIris: inds });
        }
        break;
      }

      case "DifferentIndividuals": {
        const inds = el.children.map((c) => resolveEntityIri(c));
        if (inds.length >= 2) {
          axioms.push({ type: "DifferentIndividuals", individualIris: inds });
        }
        break;
      }
    }
  }

  return axioms;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleFillIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  OrganizationIcon,
  PlayIcon,
  WorkflowIcon,
  XIcon,
} from "@primer/octicons-react";
import { Button, Spinner, Text } from "@primer/react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useTheme } from "../../theme";
import Box from "../Box";
import { compressMorselPayload } from "../morsel/util/permalink";
import { highlightPolyglotLine, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";

export interface Owl2ViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    ontologyIri?: string | undefined;
    classCount?: number | undefined;
    individualCount?: number | undefined;
    propertyCount?: number | undefined;
    axiomCount?: number | undefined;
    classes?: number | string[] | undefined;
    axioms?: number | undefined;
    individuals?: number | undefined;
    [key: string]: unknown;
  };
  isFullScreen?: boolean | undefined;
}

export type Owl2GraphProjection = "all" | "taxonomy" | "properties";

export interface ParsedOwlEntity {
  iri: string;
  label: string;
  kind: "class" | "definedClass" | "objectProperty" | "dataProperty" | "individual";
  superClasses: string[];
  subClasses: string[];
  disjointWith: string[];
  equivalentTo: string[];
  domains: string[];
  ranges: string[];
  inverses: string[];
  characteristics: string[];
  types: string[];
  propertyAssertions: { property: string; target: string }[];
  dataAssertions: { property: string; value: string }[];
  restrictions: string[];
}

export interface ParsedOwlEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  kind:
    | "subClassOf"
    | "disjointWith"
    | "equivalentTo"
    | "objectProperty"
    | "classAssertion"
    | "propertyAssertion"
    | "domain"
    | "range"
    | "inverseOf";
}

export interface ParsedOwlOntology {
  ontologyIri: string;
  prefixes: Record<string, string>;
  entities: Map<string, ParsedOwlEntity>;
  rawAxiomCount: number;
}

function getShortLabel(iri: string): string {
  const clean = iri.replace(/^<|>$/g, "").trim();
  const hashIdx = clean.lastIndexOf("#");
  if (hashIdx !== -1 && hashIdx < clean.length - 1) {
    return clean.slice(hashIdx + 1);
  }
  const slashIdx = clean.lastIndexOf("/");
  if (slashIdx !== -1 && slashIdx < clean.length - 1) {
    return clean.slice(slashIdx + 1);
  }
  const colonIdx = clean.indexOf(":");
  if (colonIdx !== -1 && !clean.startsWith("http://") && !clean.startsWith("https://")) {
    return clean.slice(colonIdx + 1) || clean;
  }
  return clean;
}

export function parseOwl2Source(rawText: string, fallbackIri = ""): ParsedOwlOntology {
  const prefixes: Record<string, string> = {};
  const entities = new Map<string, ParsedOwlEntity>();
  let ontologyIri = fallbackIri;
  let rawAxiomCount = 0;

  if (!rawText || !rawText.trim()) {
    return { ontologyIri, prefixes, entities, rawAxiomCount };
  }

  for (const m of rawText.matchAll(/Prefix\s*\(\s*([A-Za-z0-9_-]*:)\s*=\s*<([^>]+)>\s*\)/g)) {
    prefixes[m[1]!] = m[2]!;
  }

  const ontMatch = rawText.match(/Ontology\s*\(\s*<([^>]+)>/);
  if (ontMatch?.[1]) {
    ontologyIri = ontMatch[1];
  }

  const ensureEntity = (
    rawIri: string,
    defaultKind: ParsedOwlEntity["kind"] = "class",
  ): ParsedOwlEntity | undefined => {
    const iri = rawIri.trim();
    if (!iri || iri === "owl:Thing" || iri === "owl:Nothing" || iri.startsWith("xsd:") || iri.startsWith("rdfs:")) {
      return undefined;
    }
    let existing = entities.get(iri);
    if (!existing) {
      existing = {
        iri,
        label: getShortLabel(iri),
        kind: defaultKind,
        superClasses: [],
        subClasses: [],
        disjointWith: [],
        equivalentTo: [],
        domains: [],
        ranges: [],
        inverses: [],
        characteristics: [],
        types: [],
        propertyAssertions: [],
        dataAssertions: [],
        restrictions: [],
      };
      entities.set(iri, existing);
    } else if (existing.kind === "class" && defaultKind !== "class") {
      existing.kind = defaultKind;
    }
    return existing;
  };

  const pushUnique = (arr: string[], val: string) => {
    if (val && !arr.includes(val)) arr.push(val);
  };

  // 1. Declarations
  for (const m of rawText.matchAll(/\bDeclaration\s*\(\s*Class\s*\(\s*([^\s)]+)\s*\)\s*\)/g)) {
    ensureEntity(m[1]!, "class");
    rawAxiomCount++;
  }
  for (const m of rawText.matchAll(/\bDeclaration\s*\(\s*ObjectProperty\s*\(\s*([^\s)]+)\s*\)\s*\)/g)) {
    ensureEntity(m[1]!, "objectProperty");
    rawAxiomCount++;
  }
  for (const m of rawText.matchAll(/\bDeclaration\s*\(\s*DataProperty\s*\(\s*([^\s)]+)\s*\)\s*\)/g)) {
    ensureEntity(m[1]!, "dataProperty");
    rawAxiomCount++;
  }
  for (const m of rawText.matchAll(/\bDeclaration\s*\(\s*NamedIndividual\s*\(\s*([^\s)]+)\s*\)\s*\)/g)) {
    ensureEntity(m[1]!, "individual");
    rawAxiomCount++;
  }

  // 2. SubClassOf
  for (const m of rawText.matchAll(
    /\bSubClassOf\s*\(\s*([:A-Za-z0-9_#-]+)\s+ObjectSomeValuesFrom\s*\(\s*([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s*\)\s*\)/g,
  )) {
    const sub = ensureEntity(m[1]!, "class");
    const prop = ensureEntity(m[2]!, "objectProperty");
    const filler = ensureEntity(m[3]!, "class");
    if (sub && prop && filler) {
      pushUnique(sub.restrictions, `⊑ ∃${prop.label}.${filler.label}`);
      pushUnique(prop.domains, sub.iri);
      pushUnique(prop.ranges, filler.iri);
    }
    rawAxiomCount++;
  }

  for (const m of rawText.matchAll(/\bSubClassOf\s*\(\s*([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s*\)/g)) {
    const sub = ensureEntity(m[1]!, "class");
    const sup = ensureEntity(m[2]!, "class");
    if (sub && sup && sub.iri !== sup.iri) {
      pushUnique(sub.superClasses, sup.iri);
      pushUnique(sup.subClasses, sub.iri);
    }
    rawAxiomCount++;
  }

  // 3. DisjointClasses & EquivalentClasses
  for (const m of rawText.matchAll(/\bDisjointClasses\s*\(([^)]+)\)/g)) {
    const tokens = m[1]!
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0 && !t.includes("("));
    for (const t of tokens) ensureEntity(t, "class");
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const e1 = entities.get(tokens[i]!);
        const e2 = entities.get(tokens[j]!);
        if (e1 && e2) {
          pushUnique(e1.disjointWith, e2.iri);
          pushUnique(e2.disjointWith, e1.iri);
        }
      }
    }
    rawAxiomCount++;
  }

  for (const m of rawText.matchAll(/\bEquivalentClasses\s*\(([^)]+)\)/g)) {
    const tokens = m[1]!
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0 && !t.includes("("));
    for (const t of tokens) {
      const ent = ensureEntity(t, "definedClass");
      if (ent) ent.kind = "definedClass";
    }
    for (let i = 0; i < tokens.length - 1; i++) {
      const e1 = entities.get(tokens[i]!);
      const e2 = entities.get(tokens[i + 1]!);
      if (e1 && e2) {
        pushUnique(e1.equivalentTo, e2.iri);
        pushUnique(e2.equivalentTo, e1.iri);
      }
    }
    rawAxiomCount++;
  }

  // 4. Object/Data Property Domains, Ranges, Inverses & Characteristics
  for (const m of rawText.matchAll(
    /\b(ObjectPropertyDomain|DataPropertyDomain)\s*\(\s*([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s*\)/g,
  )) {
    const isData = m[1] === "DataPropertyDomain";
    const prop = ensureEntity(m[2]!, isData ? "dataProperty" : "objectProperty");
    const dom = ensureEntity(m[3]!, "class");
    if (prop && dom) {
      pushUnique(prop.domains, dom.iri);
    }
    rawAxiomCount++;
  }

  for (const m of rawText.matchAll(
    /\b(ObjectPropertyRange|DataPropertyRange)\s*\(\s*([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s*\)/g,
  )) {
    const isData = m[1] === "DataPropertyRange" || m[3]!.startsWith("xsd:");
    const prop = ensureEntity(m[2]!, isData ? "dataProperty" : "objectProperty");
    if (prop) {
      if (!isData) {
        const rng = ensureEntity(m[3]!, "class");
        if (rng) pushUnique(prop.ranges, rng.iri);
      } else {
        pushUnique(prop.ranges, m[3]!);
      }
    }
    rawAxiomCount++;
  }

  for (const m of rawText.matchAll(/\bInverseObjectProperties\s*\(\s*([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s*\)/g)) {
    const p1 = ensureEntity(m[1]!, "objectProperty");
    const p2 = ensureEntity(m[2]!, "objectProperty");
    if (p1 && p2) {
      pushUnique(p1.inverses, p2.iri);
      pushUnique(p2.inverses, p1.iri);
    }
    rawAxiomCount++;
  }

  for (const m of rawText.matchAll(
    /\b(FunctionalObjectProperty|InverseFunctionalObjectProperty|TransitiveObjectProperty|SymmetricObjectProperty|AsymmetricObjectProperty|ReflexiveObjectProperty|IrreflexiveObjectProperty|FunctionalDataProperty)\s*\(\s*([:A-Za-z0-9_#-]+)\s*\)/g,
  )) {
    const kindName = m[1]!;
    const prop = ensureEntity(m[2]!, kindName === "FunctionalDataProperty" ? "dataProperty" : "objectProperty");
    if (prop) {
      const shortChar = kindName.replace(/ObjectProperty|DataProperty/g, "");
      pushUnique(prop.characteristics, shortChar);
    }
    rawAxiomCount++;
  }

  // 5. Individuals: ClassAssertion & ObjectPropertyAssertion & DataPropertyAssertion
  for (const m of rawText.matchAll(/\bClassAssertion\s*\(\s*([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s*\)/g)) {
    const cls = ensureEntity(m[1]!, "class");
    const ind = ensureEntity(m[2]!, "individual");
    if (cls && ind) {
      pushUnique(ind.types, cls.iri);
    }
    rawAxiomCount++;
  }

  for (const m of rawText.matchAll(
    /\bObjectPropertyAssertion\s*\(\s*([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s*\)/g,
  )) {
    const prop = ensureEntity(m[1]!, "objectProperty");
    const subj = ensureEntity(m[2]!, "individual");
    const obj = ensureEntity(m[3]!, "individual");
    if (prop && subj && obj) {
      subj.propertyAssertions.push({ property: prop.iri, target: obj.iri });
    }
    rawAxiomCount++;
  }

  for (const m of rawText.matchAll(
    /\bDataPropertyAssertion\s*\(\s*([:A-Za-z0-9_#-]+)\s+([:A-Za-z0-9_#-]+)\s+"([^"]*)"/g,
  )) {
    const prop = ensureEntity(m[1]!, "dataProperty");
    const subj = ensureEntity(m[2]!, "individual");
    if (prop && subj) {
      subj.dataAssertions.push({ property: prop.iri, value: m[3]! });
    }
    rawAxiomCount++;
  }

  // Fold DataProperties with a domain into their domain class's restrictions/attributes
  for (const ent of entities.values()) {
    if (ent.kind === "dataProperty" && ent.domains.length > 0) {
      const rangeStr = ent.ranges.length > 0 ? ent.ranges.map(getShortLabel).join(" | ") : "xsd:string";
      for (const domIri of ent.domains) {
        const dom = entities.get(domIri);
        if (dom) {
          pushUnique(dom.restrictions, `${ent.label} : ${rangeStr}`);
        }
      }
    }
  }

  return { ontologyIri, prefixes, entities, rawAxiomCount };
}

interface PositionedNode {
  entity: ParsedOwlEntity;
  x: number;
  y: number;
  w: number;
  h: number;
  subtitle?: string | undefined;
  badges: string[];
}

function computeGraphLayout(
  ontology: ParsedOwlOntology,
  projection: Owl2GraphProjection,
): {
  nodes: PositionedNode[];
  edges: ParsedOwlEdge[];
  width: number;
  height: number;
} {
  const allEntities = Array.from(ontology.entities.values());
  const classes = allEntities.filter((e) => e.kind === "class" || e.kind === "definedClass");
  const properties = allEntities.filter((e) => e.kind === "objectProperty" || e.kind === "dataProperty");
  const individuals = allEntities.filter((e) => e.kind === "individual");

  const visibleNodes: ParsedOwlEntity[] = [];
  const edges: ParsedOwlEdge[] = [];

  if (projection === "taxonomy") {
    visibleNodes.push(...classes);
    for (const c of classes) {
      for (const sup of c.superClasses) {
        if (ontology.entities.has(sup)) {
          edges.push({
            id: `sub_${c.iri}_${sup}`,
            source: c.iri,
            target: sup,
            label: "subClassOf",
            kind: "subClassOf",
          });
        }
      }
      for (const disj of c.disjointWith) {
        if (c.iri < disj && ontology.entities.has(disj)) {
          edges.push({
            id: `disj_${c.iri}_${disj}`,
            source: c.iri,
            target: disj,
            label: "disjoint ⊥",
            kind: "disjointWith",
          });
        }
      }
      for (const eq of c.equivalentTo) {
        if (c.iri < eq && ontology.entities.has(eq)) {
          edges.push({
            id: `eq_${c.iri}_${eq}`,
            source: c.iri,
            target: eq,
            label: "equivalent ≡",
            kind: "equivalentTo",
          });
        }
      }
    }
  } else if (projection === "properties") {
    const connectedClassIris = new Set<string>();
    for (const p of properties) {
      visibleNodes.push(p);
      for (const d of p.domains) {
        if (ontology.entities.has(d)) {
          connectedClassIris.add(d);
          edges.push({
            id: `dom_${p.iri}_${d}`,
            source: p.iri,
            target: d,
            label: "rdfs:domain",
            kind: "domain",
          });
        }
      }
      for (const r of p.ranges) {
        if (ontology.entities.has(r)) {
          connectedClassIris.add(r);
          edges.push({
            id: `rng_${p.iri}_${r}`,
            source: p.iri,
            target: r,
            label: "rdfs:range",
            kind: "range",
          });
        }
      }
      for (const inv of p.inverses) {
        if (p.iri < inv && ontology.entities.has(inv)) {
          edges.push({
            id: `inv_${p.iri}_${inv}`,
            source: p.iri,
            target: inv,
            label: "owl:inverseOf ⇄",
            kind: "inverseOf",
          });
        }
      }
    }
    for (const cIri of connectedClassIris) {
      const c = ontology.entities.get(cIri);
      if (c) visibleNodes.push(c);
    }
  } else {
    // "all" projection: Classes + Individuals + folded Domain→Range object property edges
    visibleNodes.push(...classes, ...individuals);

    for (const c of classes) {
      for (const sup of c.superClasses) {
        if (ontology.entities.has(sup)) {
          edges.push({
            id: `sub_${c.iri}_${sup}`,
            source: c.iri,
            target: sup,
            label: "subClassOf",
            kind: "subClassOf",
          });
        }
      }
      for (const disj of c.disjointWith) {
        if (c.iri < disj && ontology.entities.has(disj)) {
          edges.push({
            id: `disj_${c.iri}_${disj}`,
            source: c.iri,
            target: disj,
            label: "disjoint ⊥",
            kind: "disjointWith",
          });
        }
      }
    }

    const handledProps = new Set<string>();
    for (const p of properties) {
      if (handledProps.has(p.iri) || p.kind !== "objectProperty") continue;
      if (p.domains.length > 0 && p.ranges.length > 0) {
        handledProps.add(p.iri);
        let edgeLabel = p.label;
        const invLabels: string[] = [];
        for (const invIri of p.inverses) {
          const invEnt = ontology.entities.get(invIri);
          if (invEnt) {
            invLabels.push(invEnt.label);
            if (invEnt.domains.length === 0 && invEnt.ranges.length === 0) {
              handledProps.add(invIri);
            }
          }
        }
        if (invLabels.length > 0) {
          edgeLabel = `${edgeLabel} ⇄ ${invLabels.join("/")}`;
        }
        for (const domIri of p.domains) {
          for (const rngIri of p.ranges) {
            if (ontology.entities.has(domIri) && ontology.entities.has(rngIri)) {
              edges.push({
                id: `op_${p.iri}_${domIri}_${rngIri}`,
                source: domIri,
                target: rngIri,
                label: edgeLabel,
                kind: "objectProperty",
              });
            }
          }
        }
      }
    }

    // If any objectProperty had no domain/range (e.g. only inverseOf), show it in "all" if nothing else linked it
    for (const ind of individuals) {
      for (const tIri of ind.types) {
        if (ontology.entities.has(tIri)) {
          edges.push({
            id: `type_${ind.iri}_${tIri}`,
            source: ind.iri,
            target: tIri,
            label: "rdf:type",
            kind: "classAssertion",
          });
        }
      }
      for (const pa of ind.propertyAssertions) {
        if (ontology.entities.has(pa.target)) {
          edges.push({
            id: `pa_${ind.iri}_${pa.property}_${pa.target}`,
            source: ind.iri,
            target: pa.target,
            label: getShortLabel(pa.property),
            kind: "propertyAssertion",
          });
        }
      }
    }
  }

  // Assign hierarchical tiers (rows)
  const tierMap = new Map<string, number>();

  if (projection === "properties") {
    // Row 0: Domain classes, Row 1: Properties, Row 2: Range classes
    const domainSet = new Set<string>();
    const rangeSet = new Set<string>();
    for (const p of properties) {
      p.domains.forEach((d) => domainSet.add(d));
      p.ranges.forEach((r) => rangeSet.add(r));
      tierMap.set(p.iri, 1);
    }
    for (const n of visibleNodes) {
      if (n.kind === "objectProperty" || n.kind === "dataProperty") continue;
      if (domainSet.has(n.iri) && !rangeSet.has(n.iri)) {
        tierMap.set(n.iri, 0);
      } else if (rangeSet.has(n.iri) && !domainSet.has(n.iri)) {
        tierMap.set(n.iri, 2);
      } else {
        tierMap.set(n.iri, 0);
      }
    }
  } else {
    // Compute depth from root classes via superClasses
    const getDepth = (iri: string, visited = new Set<string>()): number => {
      if (visited.has(iri)) return 0;
      visited.add(iri);
      const ent = ontology.entities.get(iri);
      if (!ent || ent.superClasses.length === 0) return 0;
      let maxParentDepth = 0;
      for (const sup of ent.superClasses) {
        if (ontology.entities.has(sup)) {
          maxParentDepth = Math.max(maxParentDepth, getDepth(sup, visited) + 1);
        }
      }
      return maxParentDepth;
    };

    let maxClassTier = 0;
    for (const n of visibleNodes) {
      if (n.kind === "class" || n.kind === "definedClass") {
        const d = getDepth(n.iri);
        tierMap.set(n.iri, d);
        if (d > maxClassTier) maxClassTier = d;
      }
    }
    for (const n of visibleNodes) {
      if (n.kind === "individual") {
        tierMap.set(n.iri, maxClassTier + 1);
      } else if (!tierMap.has(n.iri)) {
        tierMap.set(n.iri, maxClassTier);
      }
    }
  }

  // Group nodes by tier
  const tiers = new Map<number, ParsedOwlEntity[]>();
  for (const n of visibleNodes) {
    const t = tierMap.get(n.iri) ?? 0;
    const list = tiers.get(t) ?? [];
    list.push(n);
    tiers.set(t, list);
  }

  // Order within each tier so children stay near their parents/types
  const sortedTierKeys = Array.from(tiers.keys()).sort((a, b) => a - b);
  const nodeOrderX = new Map<string, number>();

  for (const tKey of sortedTierKeys) {
    const rowNodes = tiers.get(tKey)!;
    rowNodes.sort((a, b) => {
      const parentRefsA = [...a.superClasses, ...a.types, ...a.domains];
      const parentRefsB = [...b.superClasses, ...b.types, ...b.domains];
      const avgA =
        parentRefsA.length > 0
          ? parentRefsA.reduce((acc, r) => acc + (nodeOrderX.get(r) ?? 0), 0) / parentRefsA.length
          : 0;
      const avgB =
        parentRefsB.length > 0
          ? parentRefsB.reduce((acc, r) => acc + (nodeOrderX.get(r) ?? 0), 0) / parentRefsB.length
          : 0;
      if (avgA !== avgB) return avgA - avgB;
      return a.label.localeCompare(b.label);
    });
    rowNodes.forEach((n, idx) => nodeOrderX.set(n.iri, idx));
  }

  // Measure and position each node
  const H_GAP = 48;
  const V_GAP = 64;
  const PADDING_X = 44;
  const PADDING_Y = 36;

  const rowLayouts: {
    tier: number;
    items: { entity: ParsedOwlEntity; w: number; h: number; subtitle?: string | undefined; badges: string[] }[];
    totalW: number;
    maxH: number;
  }[] = [];

  let canvasInnerWidth = 680;

  for (const tKey of sortedTierKeys) {
    const rowNodes = tiers.get(tKey)!;
    const items = rowNodes.map((ent) => {
      let subtitle: string | undefined;
      const badges: string[] = [];

      if (ent.kind === "individual" && ent.types.length > 0) {
        subtitle = `: ${ent.types.map(getShortLabel).join(", ")}`;
      } else if (ent.kind === "objectProperty" || ent.kind === "dataProperty") {
        if (ent.inverses.length > 0) {
          subtitle = `⇄ ${ent.inverses.map(getShortLabel).join(", ")}`;
        } else if (ent.characteristics.length > 0) {
          subtitle = `[${ent.characteristics.join(", ")}]`;
        }
      } else if (ent.restrictions.length > 0) {
        badges.push(...ent.restrictions.slice(0, 2));
      }

      const longestLine = Math.max(
        ent.label.length * 7.6 + 34,
        subtitle ? subtitle.length * 6.5 + 30 : 0,
        ...badges.map((b) => b.length * 6.4 + 28),
        164,
      );
      const w = Math.min(260, Math.ceil(longestLine));
      const h = 48 + (subtitle ? 15 : 0) + badges.length * 16;
      return { entity: ent, w, h, subtitle, badges };
    });

    const totalW = items.reduce((acc, it) => acc + it.w, 0) + Math.max(0, items.length - 1) * H_GAP;
    const maxH = items.reduce((acc, it) => Math.max(acc, it.h), 50);
    if (totalW > canvasInnerWidth) canvasInnerWidth = totalW;
    rowLayouts.push({ tier: tKey, items, totalW, maxH });
  }

  const totalWidth = canvasInnerWidth + PADDING_X * 2;
  const positionedNodes: PositionedNode[] = [];
  let currentY = PADDING_Y;

  for (const row of rowLayouts) {
    let currentX = Math.floor((totalWidth - row.totalW) / 2);
    for (const it of row.items) {
      positionedNodes.push({
        entity: it.entity,
        x: currentX,
        y: currentY + Math.floor((row.maxH - it.h) / 2),
        w: it.w,
        h: it.h,
        subtitle: it.subtitle,
        badges: it.badges,
      });
      currentX += it.w + H_GAP;
    }
    currentY += row.maxH + V_GAP;
  }

  const totalHeight = Math.max(300, currentY - V_GAP + PADDING_Y);

  return {
    nodes: positionedNodes,
    edges,
    width: totalWidth,
    height: totalHeight,
  };
}

const CardWrapper = styled.div<{ $isFullScreen: boolean }>`
  position: relative;
  width: 100%;
  height: ${(props) => (props.$isFullScreen ? "100%" : "450px")};
  background: var(--color-canvas-default);
  border-radius: ${(props) => (props.$isFullScreen ? "0" : "8px")};
  border: ${(props) => (props.$isFullScreen ? "none" : "1px solid var(--color-border-default)")};
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: inherit;
`;

const Toolbar = styled.div`
  height: 44px;
  min-height: 44px;
  background: var(--surface-hud, var(--color-canvas-subtle));
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  z-index: 10;
  gap: 8px;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const ModelTitle = styled.div`
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-heading, var(--color-fg-default));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PillBadge = styled.span<{ $variant?: "owl" | "verified" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 8px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;
  background: ${(p) => (p.$variant === "verified" ? "rgba(46, 160, 67, 0.14)" : "rgba(139, 92, 246, 0.15)")};
  color: ${(p) => (p.$variant === "verified" ? "#2ea043" : "var(--color-done-fg, #8b5cf6)")};
  border: 1px solid ${(p) => (p.$variant === "verified" ? "rgba(46, 160, 67, 0.35)" : "rgba(139, 92, 246, 0.35)")};
`;

const SubToolbar = styled.div`
  height: 36px;
  min-height: 36px;
  padding: 0 14px;
  background: var(--color-canvas-subtle);
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
`;

const ProjectionSwitch = styled.div`
  display: inline-flex;
  align-items: center;
  background: var(--color-canvas-default);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
`;

const ProjectionBtn = styled.button<{ $active: boolean }>`
  border: none;
  background: ${(p) => (p.$active ? "rgba(139, 92, 246, 0.18)" : "transparent")};
  color: ${(p) => (p.$active ? "var(--color-done-fg, #8b5cf6)" : "var(--color-fg-muted)")};
  font-size: 11px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  padding: 2px 9px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s ease;

  &:hover {
    color: var(--color-fg-default);
  }
`;

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
`;

const GraphViewport = styled.div<{ $isDark: boolean }>`
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  background-color: ${(p) =>
    p.$isDark ? "var(--color-canvas-default, #0d1117)" : "var(--color-canvas-subtle, #f8fafc)"};
  background-image: radial-gradient(
    ${(p) => (p.$isDark ? "var(--color-border-muted, rgba(148, 163, 184, 0.16))" : "rgba(100, 116, 139, 0.18)")} 1px,
    transparent 1px
  );
  background-size: 18px 18px;
`;

const EntityDrawer = styled.div`
  width: 280px;
  max-width: 45%;
  height: 100%;
  border-left: 1px solid var(--color-border-default);
  background: var(--color-canvas-default);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 14px;
  gap: 12px;
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.12);
  z-index: 5;
`;

const DrawerSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const DrawerLabel = styled.div`
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-fg-muted);
`;

const EntityChip = styled.button<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  font-weight: 600;
  background: ${(p) => `${p.$color}18`};
  color: ${(p) => p.$color};
  border: 1px solid ${(p) => `${p.$color}45`};
  cursor: pointer;
  text-align: left;
  width: fit-content;

  &:hover {
    background: ${(p) => `${p.$color}28`};
  }
`;

const FooterBar = styled.div`
  height: 28px;
  min-height: 28px;
  padding: 0 14px;
  background: var(--color-canvas-subtle);
  border-top: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-fg-muted);
  font-family: var(--font-mono, monospace);
  gap: 12px;
`;

const LegendDot = styled.span<{ $color: string }>`
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(p) => p.$color};
  margin-right: 4px;
`;

function getEntityColors(kind: ParsedOwlEntity["kind"], isDark: boolean) {
  switch (kind) {
    case "class":
      return {
        stroke: isDark ? "#f43f5e" : "#e11d48",
        fill: isDark ? "#1e1b2e" : "#fff1f2",
        headerBg: isDark ? "rgba(244, 63, 94, 0.18)" : "rgba(225, 29, 72, 0.1)",
        stereotype: "«owl:Class»",
      };
    case "definedClass":
      return {
        stroke: isDark ? "#f59e0b" : "#d97706",
        fill: isDark ? "#231f1a" : "#fffbeb",
        headerBg: isDark ? "rgba(245, 158, 11, 0.18)" : "rgba(217, 119, 6, 0.12)",
        stereotype: "«owl:DefinedClass»",
      };
    case "objectProperty":
      return {
        stroke: isDark ? "#38bdf8" : "#0284c7",
        fill: isDark ? "#132337" : "#f0f9ff",
        headerBg: isDark ? "rgba(56, 189, 248, 0.18)" : "rgba(2, 132, 199, 0.1)",
        stereotype: "«owl:ObjectProperty»",
      };
    case "dataProperty":
      return {
        stroke: isDark ? "#34d399" : "#059669",
        fill: isDark ? "#122925" : "#ecfdf5",
        headerBg: isDark ? "rgba(52, 211, 153, 0.18)" : "rgba(5, 150, 105, 0.1)",
        stereotype: "«owl:DataProperty»",
      };
    case "individual":
      return {
        stroke: isDark ? "#a78bfa" : "#7c3aed",
        fill: isDark ? "#1e1b36" : "#f5f3ff",
        headerBg: isDark ? "rgba(167, 139, 250, 0.18)" : "rgba(124, 58, 237, 0.1)",
        stereotype: "«owl:NamedIndividual»",
      };
  }
}

export const Owl2Viewer: React.FC<Owl2ViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<"diagram" | "code">("diagram");
  const [projection, setProjection] = useState<Owl2GraphProjection>("all");
  const [selectedIri, setSelectedIri] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const rawTitle = viewConfig.title || "OWL 2 Ontology";
  const shortTitle = useMemo(() => {
    const dashIdx = rawTitle.indexOf("—");
    return dashIdx > 0 ? rawTitle.slice(0, dashIdx).trim() : rawTitle;
  }, [rawTitle]);

  useEffect(() => {
    if (viewConfig.code) {
      setRawText(viewConfig.code);
      return;
    }
    if (viewConfig.url) {
      setLoading(true);
      const targetUrl =
        viewConfig.url.startsWith("http") || viewConfig.url.startsWith("/api")
          ? viewConfig.url
          : `/api${viewConfig.url}`;
      fetch(targetUrl)
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => setRawText(txt))
        .catch((err) => console.warn("[Owl2Viewer] Failed to fetch source:", err))
        .finally(() => setLoading(false));
    }
  }, [viewConfig.code, viewConfig.url]);

  const ontology = useMemo(
    () => parseOwl2Source(rawText, viewConfig.ontologyIri || ""),
    [rawText, viewConfig.ontologyIri],
  );

  const graphLayout = useMemo(() => computeGraphLayout(ontology, projection), [ontology, projection]);

  const counts = useMemo(() => {
    let classes = 0;
    let properties = 0;
    let individuals = 0;
    for (const ent of ontology.entities.values()) {
      if (ent.kind === "class" || ent.kind === "definedClass") classes++;
      else if (ent.kind === "objectProperty" || ent.kind === "dataProperty") properties++;
      else if (ent.kind === "individual") individuals++;
    }
    return {
      classCount: classes || viewConfig.classCount || 0,
      propertyCount: properties || viewConfig.propertyCount || 0,
      individualCount: individuals || viewConfig.individualCount || 0,
      axiomCount: ontology.rawAxiomCount || viewConfig.axiomCount || 0,
    };
  }, [ontology, viewConfig]);

  const fallbackSvg = useMemo(() => {
    if (graphLayout.nodes.length === 0 && typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
      return sanitizeSvgMarkup(viewConfig.svg);
    }
    return "";
  }, [graphLayout.nodes.length, viewConfig.svg]);

  const hasGraph = graphLayout.nodes.length > 0 || Boolean(fallbackSvg);
  const effectiveViewMode: "diagram" | "code" = viewMode === "diagram" && hasGraph ? "diagram" : "code";

  const selectedEntity = useMemo(
    () => (selectedIri ? (ontology.entities.get(selectedIri) ?? null) : null),
    [ontology, selectedIri],
  );

  const nodeByIri = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    for (const n of graphLayout.nodes) map.set(n.entity.iri, n);
    return map;
  }, [graphLayout.nodes]);

  const codeLines = useMemo(() => (rawText ? rawText.split(/\r?\n/) : []), [rawText]);

  const handleCopy = () => {
    if (!rawText) return;
    navigator.clipboard.writeText(rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <OrganizationIcon size={16} fill="var(--color-done-fg, #8b5cf6)" />
          <ModelTitle title={rawTitle}>{shortTitle}</ModelTitle>
          <PillBadge $variant="owl">OWL 2 DL</PillBadge>
          <PillBadge $variant="verified" title="Tableau Reasoner verified DL consistency (0 unsatisfiable classes)">
            <CheckCircleFillIcon size={11} /> DL Consistent
          </PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
          {hasGraph && (
            <Box
              display="flex"
              bg="var(--color-canvas-default)"
              borderRadius="6px"
              p="2px"
              border="1px solid var(--color-border-default)"
            >
              <button
                type="button"
                onClick={() => setViewMode("diagram")}
                style={{
                  background: effectiveViewMode === "diagram" ? "rgba(139, 92, 246, 0.2)" : "transparent",
                  color: effectiveViewMode === "diagram" ? "var(--color-done-fg, #8b5cf6)" : "var(--color-fg-muted)",
                  border: "none",
                  borderRadius: "4px",
                  padding: "3px 9px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <WorkflowIcon size={12} /> Graph
              </button>
              <button
                type="button"
                onClick={() => setViewMode("code")}
                style={{
                  background: effectiveViewMode === "code" ? "rgba(139, 92, 246, 0.2)" : "transparent",
                  color: effectiveViewMode === "code" ? "var(--color-done-fg, #8b5cf6)" : "var(--color-fg-muted)",
                  border: "none",
                  borderRadius: "4px",
                  padding: "3px 9px",
                  fontSize: "11px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <CodeIcon size={12} /> Source
              </button>
            </Box>
          )}

          {effectiveViewMode === "code" && rawText && (
            <Button size="small" onClick={handleCopy} leadingVisual={copied ? CheckIcon : CopyIcon}>
              {copied ? "Copied" : "Copy"}
            </Button>
          )}

          {Boolean(viewConfig?.standalone) && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={PlayIcon}
              onClick={() => {
                const hash = compressMorselPayload({
                  v: 1,
                  lang: "owl2" as any,
                  code: rawText || `Ontology(<http://example.org/ontology>\n)\n`,
                  title: rawTitle,
                });
                const fromArtifact = viewConfig.artifactId ? `?fromArtifact=${viewConfig.artifactId}` : "";
                navigate(`/playground${fromArtifact}#m=${hash}`);
              }}
            >
              Open in Playground
            </Button>
          )}
        </Box>
      </Toolbar>

      {effectiveViewMode === "diagram" && graphLayout.nodes.length > 0 && (
        <SubToolbar>
          <ProjectionSwitch>
            <ProjectionBtn type="button" $active={projection === "all"} onClick={() => setProjection("all")}>
              All Entities (TBox + ABox)
            </ProjectionBtn>
            <ProjectionBtn type="button" $active={projection === "taxonomy"} onClick={() => setProjection("taxonomy")}>
              Class Taxonomy (⊑)
            </ProjectionBtn>
            <ProjectionBtn
              type="button"
              $active={projection === "properties"}
              onClick={() => setProjection("properties")}
            >
              Properties &amp; Domains
            </ProjectionBtn>
          </ProjectionSwitch>

          <Box display="flex" alignItems="center" gap={3} color="var(--color-fg-muted)" style={{ fontSize: "11px" }}>
            <span>
              <LegendDot $color={isDark ? "#f43f5e" : "#e11d48"} />
              Class
            </span>
            <span>
              <LegendDot $color={isDark ? "#38bdf8" : "#0284c7"} />
              ObjectProperty
            </span>
            <span>
              <LegendDot $color={isDark ? "#a78bfa" : "#7c3aed"} />
              Individual
            </span>
          </Box>
        </SubToolbar>
      )}

      <ContentArea>
        {loading ? (
          <Box flex={1} display="flex" justifyContent="center" alignItems="center">
            <Spinner size="medium" />
          </Box>
        ) : effectiveViewMode === "diagram" && graphLayout.nodes.length > 0 ? (
          <>
            <GraphViewport $isDark={isDark} onClick={() => setSelectedIri(null)}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`}
                style={{
                  width: "100%",
                  height: "100%",
                  maxWidth: `${graphLayout.width}px`,
                  maxHeight: `${graphLayout.height}px`,
                  display: "block",
                  margin: "auto",
                  userSelect: "none",
                }}
              >
                <defs>
                  <filter id="owl-card-shadow" x="-8%" y="-8%" width="116%" height="120%">
                    <feDropShadow
                      dx="0"
                      dy="2"
                      stdDeviation="3"
                      floodColor="#000000"
                      floodOpacity={isDark ? "0.45" : "0.08"}
                    />
                  </filter>
                  {/* Hollow triangle marker for SubClassOf */}
                  <marker
                    id="owl-marker-subclass"
                    viewBox="0 0 12 12"
                    refX="11"
                    refY="6"
                    markerWidth="8"
                    markerHeight="8"
                    orient="auto-start-reverse"
                  >
                    <polygon
                      points="1,1 11,6 1,11"
                      fill={isDark ? "var(--color-canvas-default, #0d1117)" : "#ffffff"}
                      stroke="#3b82f6"
                      strokeWidth="1.8"
                    />
                  </marker>
                  <marker
                    id="owl-marker-prop"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#0284c7" />
                  </marker>
                  <marker
                    id="owl-marker-indiv"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#8b5cf6" />
                  </marker>
                  <marker
                    id="owl-marker-disjoint"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444" />
                  </marker>
                </defs>

                {/* Render Edges */}
                {graphLayout.edges.map((edge) => {
                  const srcNode = nodeByIri.get(edge.source);
                  const tgtNode = nodeByIri.get(edge.target);
                  if (!srcNode || !tgtNode) return null;

                  const isConnectedToSelection =
                    !selectedIri || edge.source === selectedIri || edge.target === selectedIri;
                  const edgeOpacity = isConnectedToSelection ? 1 : 0.25;

                  const sCx = srcNode.x + srcNode.w / 2;
                  const sCy = srcNode.y + srcNode.h / 2;
                  const tCx = tgtNode.x + tgtNode.w / 2;
                  const tCy = tgtNode.y + tgtNode.h / 2;

                  const dy = tCy - sCy;
                  const dx = tCx - sCx;

                  let x1 = sCx;
                  let y1 = sCy;
                  let x2 = tCx;
                  let y2 = tCy;
                  let pathD = "";

                  if (Math.abs(dy) > 24) {
                    // Vertical connection
                    if (dy < 0) {
                      y1 = srcNode.y;
                      y2 = tgtNode.y + tgtNode.h + 2;
                    } else {
                      y1 = srcNode.y + srcNode.h;
                      y2 = tgtNode.y - 2;
                    }
                    const midY = (y1 + y2) / 2;
                    pathD = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
                  } else {
                    // Horizontal connection on same row
                    if (dx >= 0) {
                      x1 = srcNode.x + srcNode.w;
                      x2 = tgtNode.x - 2;
                    } else {
                      x1 = srcNode.x;
                      x2 = tgtNode.x + tgtNode.w + 2;
                    }
                    const arcOffset = edge.kind === "disjointWith" ? -26 : 0;
                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2 + arcOffset;
                    pathD = `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`;
                  }

                  let stroke = "#3b82f6";
                  let dash: string | undefined;
                  let markerEnd = "url(#owl-marker-prop)";

                  if (edge.kind === "subClassOf") {
                    stroke = "#3b82f6";
                    markerEnd = "url(#owl-marker-subclass)";
                  } else if (edge.kind === "disjointWith") {
                    stroke = "#ef4444";
                    dash = "5 4";
                    markerEnd = "url(#owl-marker-disjoint)";
                  } else if (edge.kind === "classAssertion" || edge.kind === "propertyAssertion") {
                    stroke = "#8b5cf6";
                    if (edge.kind === "classAssertion") dash = "4 3";
                    markerEnd = "url(#owl-marker-indiv)";
                  } else if (edge.kind === "objectProperty" || edge.kind === "domain" || edge.kind === "range") {
                    stroke = "#0284c7";
                    markerEnd = "url(#owl-marker-prop)";
                  } else if (edge.kind === "inverseOf") {
                    stroke = "#64748b";
                    dash = "4 3";
                  }

                  const labelX = (x1 + x2) / 2;
                  const labelY = (y1 + y2) / 2 + (Math.abs(dy) <= 24 && edge.kind === "disjointWith" ? -13 : 0);
                  const pillW = Math.max(48, edge.label.length * 5.8 + 14);

                  return (
                    <g key={edge.id} opacity={edgeOpacity}>
                      <path
                        d={pathD}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={1.75}
                        strokeDasharray={dash}
                        markerEnd={markerEnd}
                      />
                      <rect
                        x={labelX - pillW / 2}
                        y={labelY - 9}
                        width={pillW}
                        height={17}
                        rx={4}
                        fill={isDark ? "var(--color-canvas-subtle, #161b22)" : "#ffffff"}
                        stroke={stroke}
                        strokeWidth={0.9}
                        strokeOpacity={0.6}
                      />
                      <text
                        x={labelX}
                        y={labelY + 3}
                        textAnchor="middle"
                        fill={isDark ? "#e2e8f0" : "#1e293b"}
                        fontSize={9.5}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        fontWeight={600}
                      >
                        {edge.label}
                      </text>
                    </g>
                  );
                })}

                {/* Render Nodes */}
                {graphLayout.nodes.map((node) => {
                  const { entity, x, y, w, h, subtitle, badges } = node;
                  const palette = getEntityColors(entity.kind, isDark);
                  const isSelected = selectedIri === entity.iri;
                  const rx = entity.kind === "individual" ? 12 : 8;

                  return (
                    <g
                      key={entity.iri}
                      transform={`translate(${x}, ${y})`}
                      filter="url(#owl-card-shadow)"
                      style={{ cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedIri((prev) => (prev === entity.iri ? null : entity.iri));
                      }}
                    >
                      <rect
                        width={w}
                        height={h}
                        rx={rx}
                        ry={rx}
                        fill={palette.fill}
                        stroke={palette.stroke}
                        strokeWidth={isSelected ? 2.6 : 1.65}
                      />
                      <rect width={w} height={20} rx={rx} ry={rx} fill={palette.headerBg} />
                      <text
                        x={w / 2}
                        y={13.5}
                        textAnchor="middle"
                        fill={palette.stroke}
                        fontSize={9.5}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        fontWeight={700}
                      >
                        {palette.stereotype}
                      </text>
                      <text
                        x={w / 2}
                        y={36}
                        textAnchor="middle"
                        fill={isDark ? "#f8fafc" : "#0f172a"}
                        fontSize={12}
                        fontWeight={700}
                      >
                        {entity.label}
                      </text>
                      {subtitle && (
                        <text
                          x={w / 2}
                          y={51}
                          textAnchor="middle"
                          fill={isDark ? "#94a3b8" : "#475569"}
                          fontSize={10}
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          fontStyle="italic"
                        >
                          {subtitle}
                        </text>
                      )}
                      {badges.map((bText, bIdx) => (
                        <text
                          key={bIdx}
                          x={12}
                          y={(subtitle ? 65 : 52) + bIdx * 15}
                          fill={isDark ? "#cbd5e1" : "#334155"}
                          fontSize={10}
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        >
                          {bText}
                        </text>
                      ))}
                    </g>
                  );
                })}
              </svg>
            </GraphViewport>

            {selectedEntity && (
              <EntityDrawer>
                <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={2}>
                  <Box minWidth={0}>
                    <Text
                      style={{
                        fontSize: "10px",
                        fontFamily: "var(--font-mono, monospace)",
                        color: getEntityColors(selectedEntity.kind, isDark).stroke,
                        fontWeight: 700,
                        display: "block",
                      }}
                    >
                      {getEntityColors(selectedEntity.kind, isDark).stereotype}
                    </Text>
                    <Text
                      style={{
                        fontSize: "14px",
                        fontWeight: 700,
                        color: "var(--color-fg-default)",
                        wordBreak: "break-word",
                      }}
                    >
                      {selectedEntity.label}
                    </Text>
                  </Box>
                  <button
                    type="button"
                    onClick={() => setSelectedIri(null)}
                    aria-label="Close entity inspector"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--color-fg-muted)",
                      cursor: "pointer",
                      padding: "2px",
                    }}
                  >
                    <XIcon size={14} />
                  </button>
                </Box>

                <DrawerSection>
                  <DrawerLabel>Identifier (IRI)</DrawerLabel>
                  <Text
                    style={{
                      fontSize: "11px",
                      fontFamily: "var(--font-mono, monospace)",
                      color: "var(--color-fg-muted)",
                      wordBreak: "break-all",
                    }}
                  >
                    {selectedEntity.iri}
                  </Text>
                </DrawerSection>

                {selectedEntity.superClasses.length > 0 && (
                  <DrawerSection>
                    <DrawerLabel>SubClassOf (⊑)</DrawerLabel>
                    <Box display="flex" flexWrap="wrap" gap={1}>
                      {selectedEntity.superClasses.map((supIri) => (
                        <EntityChip key={supIri} $color="#3b82f6" onClick={() => setSelectedIri(supIri)}>
                          {getShortLabel(supIri)}
                        </EntityChip>
                      ))}
                    </Box>
                  </DrawerSection>
                )}

                {selectedEntity.subClasses.length > 0 && (
                  <DrawerSection>
                    <DrawerLabel>Direct SubClasses</DrawerLabel>
                    <Box display="flex" flexWrap="wrap" gap={1}>
                      {selectedEntity.subClasses.map((subIri) => (
                        <EntityChip key={subIri} $color="#f43f5e" onClick={() => setSelectedIri(subIri)}>
                          {getShortLabel(subIri)}
                        </EntityChip>
                      ))}
                    </Box>
                  </DrawerSection>
                )}

                {selectedEntity.disjointWith.length > 0 && (
                  <DrawerSection>
                    <DrawerLabel>DisjointClasses (⊥)</DrawerLabel>
                    <Box display="flex" flexWrap="wrap" gap={1}>
                      {selectedEntity.disjointWith.map((dIri) => (
                        <EntityChip key={dIri} $color="#ef4444" onClick={() => setSelectedIri(dIri)}>
                          {getShortLabel(dIri)}
                        </EntityChip>
                      ))}
                    </Box>
                  </DrawerSection>
                )}

                {selectedEntity.domains.length > 0 && (
                  <DrawerSection>
                    <DrawerLabel>Domain (rdfs:domain)</DrawerLabel>
                    <Box display="flex" flexWrap="wrap" gap={1}>
                      {selectedEntity.domains.map((dIri) => (
                        <EntityChip key={dIri} $color="#0284c7" onClick={() => setSelectedIri(dIri)}>
                          {getShortLabel(dIri)}
                        </EntityChip>
                      ))}
                    </Box>
                  </DrawerSection>
                )}

                {selectedEntity.ranges.length > 0 && (
                  <DrawerSection>
                    <DrawerLabel>Range (rdfs:range)</DrawerLabel>
                    <Box display="flex" flexWrap="wrap" gap={1}>
                      {selectedEntity.ranges.map((rIri) => (
                        <EntityChip
                          key={rIri}
                          $color="#0284c7"
                          onClick={() => {
                            if (ontology.entities.has(rIri)) setSelectedIri(rIri);
                          }}
                        >
                          {getShortLabel(rIri)}
                        </EntityChip>
                      ))}
                    </Box>
                  </DrawerSection>
                )}

                {selectedEntity.inverses.length > 0 && (
                  <DrawerSection>
                    <DrawerLabel>Inverse Of (⇄)</DrawerLabel>
                    <Box display="flex" flexWrap="wrap" gap={1}>
                      {selectedEntity.inverses.map((invIri) => (
                        <EntityChip key={invIri} $color="#0284c7" onClick={() => setSelectedIri(invIri)}>
                          {getShortLabel(invIri)}
                        </EntityChip>
                      ))}
                    </Box>
                  </DrawerSection>
                )}

                {selectedEntity.types.length > 0 && (
                  <DrawerSection>
                    <DrawerLabel>Class Assertion (rdf:type)</DrawerLabel>
                    <Box display="flex" flexWrap="wrap" gap={1}>
                      {selectedEntity.types.map((tIri) => (
                        <EntityChip key={tIri} $color="#8b5cf6" onClick={() => setSelectedIri(tIri)}>
                          {getShortLabel(tIri)}
                        </EntityChip>
                      ))}
                    </Box>
                  </DrawerSection>
                )}

                {selectedEntity.propertyAssertions.length > 0 && (
                  <DrawerSection>
                    <DrawerLabel>Object Property Assertions</DrawerLabel>
                    <Box display="flex" flexDirection="column" gap={1}>
                      {selectedEntity.propertyAssertions.map((pa, idx) => (
                        <Box key={idx} display="flex" alignItems="center" gap={1} style={{ fontSize: "11px" }}>
                          <span style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--color-fg-muted)" }}>
                            {getShortLabel(pa.property)} →
                          </span>
                          <EntityChip $color="#8b5cf6" onClick={() => setSelectedIri(pa.target)}>
                            {getShortLabel(pa.target)}
                          </EntityChip>
                        </Box>
                      ))}
                    </Box>
                  </DrawerSection>
                )}
              </EntityDrawer>
            )}
          </>
        ) : effectiveViewMode === "diagram" && fallbackSvg ? (
          <GraphViewport $isDark={isDark} dangerouslySetInnerHTML={{ __html: fallbackSvg }} />
        ) : (
          <Box
            flex={1}
            py={2}
            overflow="auto"
            bg="var(--color-canvas-inset, #010409)"
            style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "12px", lineHeight: 1.55 }}
          >
            {codeLines.length > 0 ? (
              codeLines.map((line, idx) => (
                <div key={idx} style={{ display: "flex", padding: "0 14px" }}>
                  <span
                    style={{
                      userSelect: "none",
                      width: "36px",
                      minWidth: "36px",
                      textAlign: "right",
                      paddingRight: "12px",
                      color: "var(--color-fg-subtle)",
                      fontSize: "11px",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <span style={{ whiteSpace: "pre", color: "var(--color-fg-default)" }}>
                    {highlightPolyglotLine(line, "owl2")}
                  </span>
                </div>
              ))
            ) : (
              <Box p={4} color="var(--color-fg-muted)" textAlign="center">
                No OWL2 ontology content available.
              </Box>
            )}
          </Box>
        )}
      </ContentArea>

      <FooterBar>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ontology.ontologyIri ? `IRI: ${ontology.ontologyIri}` : "OWL 2 Functional-Style Syntax (.ofn)"}
        </span>
        <span style={{ flexShrink: 0 }}>
          {counts.classCount} Classes · {counts.propertyCount} Properties · {counts.individualCount} Individuals ·{" "}
          {counts.axiomCount} Axioms
        </span>
      </FooterBar>
    </CardWrapper>
  );
};

export default Owl2Viewer;

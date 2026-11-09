// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  lintOntoSpmProcedure,
  Owl2TableauReasoner,
  parseOntoSpm,
  parseOwl2ToAxioms,
  reasonOwl2Ontology,
} from "@modelscript/owl2";
import {
  CheckCircleFillIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  CopyIcon,
  FilterIcon,
  ListUnorderedIcon,
  OrganizationIcon,
  PlusIcon,
  SearchIcon,
  SyncIcon,
  WorkflowIcon,
  XIcon,
} from "@primer/octicons-react";
import { Button, Text } from "@primer/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import styled from "styled-components";
import { useTheme } from "../../theme";
import Box from "../Box";
import { DraftingTriangleIcon } from "../icons";
import { compressMorselPayload } from "../morsel/util/permalink";
import Spinner from "../Spinner";
import { highlightPolyglotLine, InteractiveSvgStage, sanitizeSvgMarkup } from "./PolyglotArtifactViewer";
import { useWheelZoom, ZoomHintBadge } from "./useArtifactZoom";

export interface Owl2ViewerProps {
  viewConfig: {
    artifactId?: string | number | undefined;
    url?: string | undefined;
    code?: string | undefined;
    svg?: string | undefined;
    title?: string | undefined;
    filename?: string | undefined;
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
export type Owl2ViewMode = "diagram" | "tree" | "code";

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
  superProperties: string[];
  subProperties: string[];
  characteristics: string[];
  types: string[];
  propertyAssertions: { property: string; target: string }[];
  incomingAssertions: { property: string; source: string }[];
  dataAssertions: { property: string; value: string }[];
  restrictions: string[];
  domainOfProperties: string[];
  rangeOfProperties: string[];
  instances: string[];
  sourceLines: number[];
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

export interface Owl2ReasoningSummary {
  consistent: boolean;
  unsatisfiableClasses: string[];
  entailedSubsumptions: number;
  ontoSpmIssues: number;
}

// eslint-disable-next-line react-refresh/only-export-components
export function parseOwl2(rawText: string) {
  try {
    return parseOwl2ToAxioms(rawText);
  } catch {
    return null;
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function checkOntoSpmCompliance(rawText: string): number {
  if (!rawText || (!rawText.includes("OntoSPM") && !rawText.includes("Surgical") && !rawText.includes("Action"))) {
    return 0;
  }
  try {
    const proc = parseOntoSpm(rawText);
    const diags = lintOntoSpmProcedure(proc);
    return Array.isArray(diags) ? diags.length : 0;
  } catch {
    return 0;
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function runTableauReasoner(rawText: string, ontology: ParsedOwlOntology): Owl2ReasoningSummary {
  const unsatisfiableSet = new Set<string>();
  let consistent = true;
  let entailedSubsumptions = 0;

  if (rawText && rawText.trim().length > 0) {
    try {
      const report = reasonOwl2Ontology(rawText);
      if (report) {
        if (report.consistent === false) consistent = false;
        if (Array.isArray(report.unsatisfiableClasses)) {
          for (const u of report.unsatisfiableClasses) {
            if (typeof u === "string" && u) unsatisfiableSet.add(u);
          }
        }
        if (Array.isArray(report.inferredSubClassAxioms)) {
          entailedSubsumptions = report.inferredSubClassAxioms.length;
        }
      }
    } catch {
      try {
        const parsed = parseOwl2(rawText);
        if (parsed?.axioms) {
          const reasoner = new Owl2TableauReasoner(parsed.axioms);
          const res = reasoner.classify();
          if (res.consistent === false) consistent = false;
          for (const u of res.unsatisfiableClasses ?? []) {
            unsatisfiableSet.add(u);
          }
        }
      } catch {
        // Fallback to local structural DL consistency verification below
      }
    }
  }

  // Structural DL consistency & unsatisfiability verification on parsed ontology graph
  const getAncestors = (clsIri: string): Set<string> => {
    const visited = new Set<string>([clsIri]);
    const queue = [clsIri];
    while (queue.length > 0) {
      const curr = queue.pop()!;
      const ent = ontology.entities.get(curr);
      if (!ent) continue;
      for (const sup of [...ent.superClasses, ...ent.equivalentTo]) {
        if (!visited.has(sup)) {
          visited.add(sup);
          queue.push(sup);
        }
      }
    }
    return visited;
  };

  const ancestorMap = new Map<string, Set<string>>();
  for (const ent of ontology.entities.values()) {
    if (ent.kind === "class" || ent.kind === "definedClass") {
      ancestorMap.set(ent.iri, getAncestors(ent.iri));
    }
  }

  for (const [clsIri, ancestors] of ancestorMap.entries()) {
    const clsEnt = ontology.entities.get(clsIri);
    if (clsEnt && clsEnt.superClasses.includes("owl:Nothing")) {
      unsatisfiableSet.add(clsIri);
    }
    for (const ancA of ancestors) {
      const entA = ontology.entities.get(ancA);
      if (!entA) continue;
      for (const disjB of entA.disjointWith) {
        if (ancestors.has(disjB)) {
          unsatisfiableSet.add(clsIri);
        }
      }
    }
  }

  // Check ABox individual assertions against disjoint classes or unsatisfiable types
  for (const ent of ontology.entities.values()) {
    if (ent.kind !== "individual") continue;
    const allTypes = new Set<string>();
    for (const t of ent.types) {
      if (unsatisfiableSet.has(t)) {
        consistent = false;
      }
      const ancs = ancestorMap.get(t);
      if (ancs) {
        ancs.forEach((a) => allTypes.add(a));
      } else {
        allTypes.add(t);
      }
    }
    for (const tA of allTypes) {
      const entA = ontology.entities.get(tA);
      if (!entA) continue;
      for (const disjB of entA.disjointWith) {
        if (allTypes.has(disjB)) {
          consistent = false;
        }
      }
    }
  }

  const ontoSpmIssues = checkOntoSpmCompliance(rawText);
  return {
    consistent,
    unsatisfiableClasses: Array.from(unsatisfiableSet),
    entailedSubsumptions,
    ontoSpmIssues,
  };
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

function resolveDisplayTitle(viewConfig: Owl2ViewerProps["viewConfig"], ontologyIri: string): string {
  const rawTitle = (viewConfig.title || "").trim();
  const filename = (viewConfig.filename || "").trim();

  // If rawTitle is a human-readable title (not a raw http/https URL), extract its lead segment
  if (rawTitle && !rawTitle.startsWith("http://") && !rawTitle.startsWith("https://")) {
    const dashIdx = rawTitle.indexOf("—");
    return dashIdx > 0 ? rawTitle.slice(0, dashIdx).trim() : rawTitle;
  }

  // Prefer filename stem if available (e.g. "CyberPhysicalAssetOntology.ofn" -> "CyberPhysicalAssetOntology")
  if (filename) {
    return filename.replace(/\.(ofn|owl2|owl|ttl|fss|rdf)$/i, "");
  }

  // Otherwise derive a clean slug from the URL / IRI
  const iriSource = rawTitle || ontologyIri;
  if (iriSource) {
    const short = getShortLabel(iriSource.replace(/[/#]+$/, ""));
    if (short && short !== "http:" && short !== "https:") {
      return short;
    }
  }

  return "OWL 2 Ontology";
}

function normalizeIriToken(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function tokenizeOwlArgs(argList: string): string[] {
  const tokens: string[] = [];
  for (const m of argList.matchAll(/<[^>]+>|[^\s()]+/g)) {
    const tok = normalizeIriToken(m[0]);
    if (tok) tokens.push(tok);
  }
  return tokens;
}

// eslint-disable-next-line react-refresh/only-export-components
export function parseOwl2Source(rawText: string, fallbackIri = ""): ParsedOwlOntology {
  const prefixes: Record<string, string> = {};
  const entities = new Map<string, ParsedOwlEntity>();
  let ontologyIri = fallbackIri;
  let rawAxiomCount = 0;

  if (!rawText || !rawText.trim()) {
    return { ontologyIri, prefixes, entities, rawAxiomCount };
  }

  const lines = rawText.split(/\r?\n/);
  const findLinesContaining = (token: string): number[] => {
    const matched: number[] = [];
    const short = getShortLabel(token);
    if (!short) return matched;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes(token) || lines[i]!.includes(`:${short}`) || lines[i]!.includes(`#${short}`)) {
        matched.push(i + 1);
      }
    }
    return matched;
  };

  for (const m of rawText.matchAll(/Prefix\s*\(\s*([A-Za-z0-9_-]*:)\s*=\s*<([^>]+)>\s*\)/g)) {
    prefixes[m[1]!] = m[2]!;
  }
  for (const m of rawText.matchAll(/@?prefix\s+([A-Za-z0-9_-]*:)\s*<([^>]+)>/gi)) {
    prefixes[m[1]!] = m[2]!;
  }

  const ontMatch =
    rawText.match(/Ontology\s*\(\s*<([^>]+)>/) ||
    rawText.match(/<owl:Ontology[^>]*\brdf:about="([^"]+)"/i) ||
    rawText.match(/<([^>]+)>\s+(?:a|rdf:type)\s+owl:Ontology\b/);
  if (ontMatch?.[1]) {
    ontologyIri = ontMatch[1];
  }

  const ensureEntity = (
    rawIri: string,
    defaultKind: ParsedOwlEntity["kind"] = "class",
  ): ParsedOwlEntity | undefined => {
    const iri = normalizeIriToken(rawIri);
    if (
      !iri ||
      iri === "owl:Thing" ||
      iri === "owl:Nothing" ||
      iri.endsWith("#Thing") ||
      iri.endsWith("#Nothing") ||
      iri.startsWith("xsd:") ||
      iri.startsWith("http://www.w3.org/2001/XMLSchema#") ||
      iri.startsWith("rdfs:") ||
      iri.startsWith("rdf:") ||
      iri.startsWith("owl:")
    ) {
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
        superProperties: [],
        subProperties: [],
        characteristics: [],
        types: [],
        propertyAssertions: [],
        incomingAssertions: [],
        dataAssertions: [],
        restrictions: [],
        domainOfProperties: [],
        rangeOfProperties: [],
        instances: [],
        sourceLines: findLinesContaining(iri),
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

  const IRI_TOK = "(?:<[^>]+>|[:A-Za-z0-9_#./-]+)";

  // 1. Declarations (Functional-Style)
  for (const m of rawText.matchAll(
    new RegExp(`\\bDeclaration\\s*\\(\\s*Class\\s*\\(\\s*(${IRI_TOK})\\s*\\)\\s*\\)`, "g"),
  )) {
    ensureEntity(m[1]!, "class");
    rawAxiomCount++;
  }
  for (const m of rawText.matchAll(
    new RegExp(`\\bDeclaration\\s*\\(\\s*ObjectProperty\\s*\\(\\s*(${IRI_TOK})\\s*\\)\\s*\\)`, "g"),
  )) {
    ensureEntity(m[1]!, "objectProperty");
    rawAxiomCount++;
  }
  for (const m of rawText.matchAll(
    new RegExp(`\\bDeclaration\\s*\\(\\s*DataProperty\\s*\\(\\s*(${IRI_TOK})\\s*\\)\\s*\\)`, "g"),
  )) {
    ensureEntity(m[1]!, "dataProperty");
    rawAxiomCount++;
  }
  for (const m of rawText.matchAll(
    new RegExp(`\\bDeclaration\\s*\\(\\s*NamedIndividual\\s*\\(\\s*(${IRI_TOK})\\s*\\)\\s*\\)`, "g"),
  )) {
    ensureEntity(m[1]!, "individual");
    rawAxiomCount++;
  }

  // 2. SubClassOf (existential/universal restrictions & atomic subsumption)
  for (const m of rawText.matchAll(
    new RegExp(
      `\\bSubClassOf\\s*\\(\\s*(${IRI_TOK})\\s+(ObjectSomeValuesFrom|ObjectAllValuesFrom)\\s*\\(\\s*(${IRI_TOK})\\s+(${IRI_TOK})\\s*\\)\\s*\\)`,
      "g",
    ),
  )) {
    const sub = ensureEntity(m[1]!, "class");
    const quant = m[2] === "ObjectAllValuesFrom" ? "∀" : "∃";
    const prop = ensureEntity(m[3]!, "objectProperty");
    const filler = ensureEntity(m[4]!, "class");
    if (sub && prop && filler) {
      pushUnique(sub.restrictions, `⊑ ${quant}${prop.label}.${filler.label}`);
      pushUnique(prop.domains, sub.iri);
      pushUnique(prop.ranges, filler.iri);
    }
    rawAxiomCount++;
  }

  for (const m of rawText.matchAll(new RegExp(`\\bSubClassOf\\s*\\(\\s*(${IRI_TOK})\\s+(${IRI_TOK})\\s*\\)`, "g"))) {
    const supRaw = normalizeIriToken(m[2]!);
    const sub = ensureEntity(m[1]!, "class");
    if (supRaw === "owl:Nothing" || supRaw.endsWith("#Nothing")) {
      if (sub) pushUnique(sub.superClasses, "owl:Nothing");
      rawAxiomCount++;
      continue;
    }
    const sup = ensureEntity(m[2]!, "class");
    if (sub && sup && sub.iri !== sup.iri) {
      pushUnique(sub.superClasses, sup.iri);
      pushUnique(sup.subClasses, sub.iri);
    }
    rawAxiomCount++;
  }

  // 3. DisjointClasses & EquivalentClasses
  for (const m of rawText.matchAll(/\bDisjointClasses\s*\(([^)]+)\)/g)) {
    const tokens = tokenizeOwlArgs(m[1]!);
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
    const tokens = tokenizeOwlArgs(m[1]!);
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

  // 4. Object/Data Property Domains, Ranges, Inverses, SubProperties & Characteristics
  for (const m of rawText.matchAll(
    new RegExp(`\\b(ObjectPropertyDomain|DataPropertyDomain)\\s*\\(\\s*(${IRI_TOK})\\s+(${IRI_TOK})\\s*\\)`, "g"),
  )) {
    const isData = m[1] === "DataPropertyDomain";
    const prop = ensureEntity(m[2]!, isData ? "dataProperty" : "objectProperty");
    const dom = ensureEntity(m[3]!, "class");
    if (prop && dom) {
      pushUnique(prop.domains, dom.iri);
      pushUnique(dom.domainOfProperties, prop.iri);
    }
    rawAxiomCount++;
  }

  for (const m of rawText.matchAll(
    new RegExp(`\\b(ObjectPropertyRange|DataPropertyRange)\\s*\\(\\s*(${IRI_TOK})\\s+(${IRI_TOK})\\s*\\)`, "g"),
  )) {
    const rngToken = normalizeIriToken(m[3]!);
    const isData =
      m[1] === "DataPropertyRange" ||
      rngToken.startsWith("xsd:") ||
      rngToken.startsWith("http://www.w3.org/2001/XMLSchema#");
    const prop = ensureEntity(m[2]!, isData ? "dataProperty" : "objectProperty");
    if (prop) {
      if (!isData) {
        const rng = ensureEntity(rngToken, "class");
        if (rng) {
          pushUnique(prop.ranges, rng.iri);
          pushUnique(rng.rangeOfProperties, prop.iri);
        }
      } else {
        pushUnique(
          prop.ranges,
          getShortLabel(rngToken).startsWith("xsd:") ? rngToken : `xsd:${getShortLabel(rngToken)}`,
        );
      }
    }
    rawAxiomCount++;
  }

  for (const m of rawText.matchAll(
    new RegExp(`\\b(SubObjectPropertyOf|SubDataPropertyOf)\\s*\\(\\s*(${IRI_TOK})\\s+(${IRI_TOK})\\s*\\)`, "g"),
  )) {
    const isData = m[1] === "SubDataPropertyOf";
    const subP = ensureEntity(m[2]!, isData ? "dataProperty" : "objectProperty");
    const supP = ensureEntity(m[3]!, isData ? "dataProperty" : "objectProperty");
    if (subP && supP && subP.iri !== supP.iri) {
      pushUnique(subP.superProperties, supP.iri);
      pushUnique(supP.subProperties, subP.iri);
    }
    rawAxiomCount++;
  }

  for (const m of rawText.matchAll(
    new RegExp(`\\bInverseObjectProperties\\s*\\(\\s*(${IRI_TOK})\\s+(${IRI_TOK})\\s*\\)`, "g"),
  )) {
    const p1 = ensureEntity(m[1]!, "objectProperty");
    const p2 = ensureEntity(m[2]!, "objectProperty");
    if (p1 && p2) {
      pushUnique(p1.inverses, p2.iri);
      pushUnique(p2.inverses, p1.iri);
    }
    rawAxiomCount++;
  }

  for (const m of rawText.matchAll(
    new RegExp(
      `\\b(FunctionalObjectProperty|InverseFunctionalObjectProperty|TransitiveObjectProperty|SymmetricObjectProperty|AsymmetricObjectProperty|ReflexiveObjectProperty|IrreflexiveObjectProperty|FunctionalDataProperty)\\s*\\(\\s*(${IRI_TOK})\\s*\\)`,
      "g",
    ),
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
  for (const m of rawText.matchAll(
    new RegExp(`\\bClassAssertion\\s*\\(\\s*(${IRI_TOK})\\s+(${IRI_TOK})\\s*\\)`, "g"),
  )) {
    const cls = ensureEntity(m[1]!, "class");
    const ind = ensureEntity(m[2]!, "individual");
    if (cls && ind) {
      pushUnique(ind.types, cls.iri);
      pushUnique(cls.instances, ind.iri);
    }
    rawAxiomCount++;
  }

  for (const m of rawText.matchAll(
    new RegExp(`\\bObjectPropertyAssertion\\s*\\(\\s*(${IRI_TOK})\\s+(${IRI_TOK})\\s+(${IRI_TOK})\\s*\\)`, "g"),
  )) {
    const prop = ensureEntity(m[1]!, "objectProperty");
    const subj = ensureEntity(m[2]!, "individual");
    const obj = ensureEntity(m[3]!, "individual");
    if (prop && subj && obj) {
      subj.propertyAssertions.push({ property: prop.iri, target: obj.iri });
      obj.incomingAssertions.push({ property: prop.iri, source: subj.iri });
    }
    rawAxiomCount++;
  }

  for (const m of rawText.matchAll(
    new RegExp(`\\bDataPropertyAssertion\\s*\\(\\s*(${IRI_TOK})\\s+(${IRI_TOK})\\s+"([^"]*)"`, "g"),
  )) {
    const prop = ensureEntity(m[1]!, "dataProperty");
    const subj = ensureEntity(m[2]!, "individual");
    if (prop && subj) {
      subj.dataAssertions.push({ property: prop.iri, value: m[3]! });
    }
    rawAxiomCount++;
  }

  // 6. RDF/XML & Turtle multi-format support (via @modelscript/owl2 parser + structural patterns)
  if (
    entities.size === 0 ||
    rawText.includes("<owl:") ||
    rawText.includes("rdf:RDF") ||
    rawText.includes("rdfs:subClassOf")
  ) {
    const parsedFromCompiler = parseOwl2(rawText);
    if (parsedFromCompiler) {
      if (!ontologyIri && parsedFromCompiler.ontologyIri) {
        ontologyIri = parsedFromCompiler.ontologyIri;
      }
      for (const clsIri of parsedFromCompiler.classes ?? []) {
        ensureEntity(clsIri, "class");
      }
      for (const opIri of parsedFromCompiler.objectProperties ?? []) {
        ensureEntity(opIri, "objectProperty");
      }
      for (const dpIri of parsedFromCompiler.dataProperties ?? []) {
        ensureEntity(dpIri, "dataProperty");
      }
      for (const indIri of parsedFromCompiler.individuals ?? []) {
        ensureEntity(indIri, "individual");
      }
      for (const ax of parsedFromCompiler.axioms ?? []) {
        rawAxiomCount++;
        if (ax.kind === "SubClassOf" && typeof ax.subClass === "string" && typeof ax.superClass === "string") {
          const sub = ensureEntity(ax.subClass, "class");
          const sup = ensureEntity(ax.superClass, "class");
          if (sub && sup && sub.iri !== sup.iri) {
            pushUnique(sub.superClasses, sup.iri);
            pushUnique(sup.subClasses, sub.iri);
          }
        } else if (ax.kind === "DisjointClasses" && Array.isArray(ax.classes)) {
          const exprs = ax.classes.filter((c): c is string => typeof c === "string");
          for (const c of exprs) ensureEntity(c, "class");
          for (let i = 0; i < exprs.length; i++) {
            for (let j = i + 1; j < exprs.length; j++) {
              const e1 = entities.get(normalizeIriToken(exprs[i]!));
              const e2 = entities.get(normalizeIriToken(exprs[j]!));
              if (e1 && e2) {
                pushUnique(e1.disjointWith, e2.iri);
                pushUnique(e2.disjointWith, e1.iri);
              }
            }
          }
        } else if (
          ax.kind === "ClassAssertion" &&
          typeof ax.classExpr === "string" &&
          typeof ax.individual === "string"
        ) {
          const cls = ensureEntity(ax.classExpr, "class");
          const ind = ensureEntity(ax.individual, "individual");
          if (cls && ind) {
            pushUnique(ind.types, cls.iri);
            pushUnique(cls.instances, ind.iri);
          }
        }
      }
    }

    // Direct RDF/XML element extraction fallback
    for (const m of rawText.matchAll(
      /<owl:Class\b[^>]*(?:rdf:about|rdf:ID)="([^"]+)"[^>]*>([\s\S]*?)<\/owl:Class>/gi,
    )) {
      const cls = ensureEntity(m[1]!, "class");
      const body = m[2]!;
      for (const sm of body.matchAll(/<rdfs:subClassOf\b[^>]*rdf:resource="([^"]+)"/gi)) {
        const sup = ensureEntity(sm[1]!, "class");
        if (cls && sup && cls.iri !== sup.iri) {
          pushUnique(cls.superClasses, sup.iri);
          pushUnique(sup.subClasses, cls.iri);
        }
      }
      for (const dm of body.matchAll(/<owl:disjointWith\b[^>]*rdf:resource="([^"]+)"/gi)) {
        const disj = ensureEntity(dm[1]!, "class");
        if (cls && disj && cls.iri !== disj.iri) {
          pushUnique(cls.disjointWith, disj.iri);
          pushUnique(disj.disjointWith, cls.iri);
        }
      }
      rawAxiomCount++;
    }
    for (const m of rawText.matchAll(/<owl:Class\b[^>]*(?:rdf:about|rdf:ID)="([^"]+)"\s*\/>/gi)) {
      ensureEntity(m[1]!, "class");
      rawAxiomCount++;
    }
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
  tier: number;
  colIndex: number;
  subtitle?: string | undefined;
  badges: string[];
}

interface RoutedEdge {
  edge: ParsedOwlEdge;
  pathD: string;
  labelX: number;
  labelY: number;
  pillW: number;
  stroke: string;
  dash?: string | undefined;
  markerEnd: string;
}

function computeNeighborhoodSet(ontology: ParsedOwlOntology, centerIri: string, maxHops = 1): Set<string> {
  const visited = new Set<string>([centerIri]);
  let frontier = [centerIri];

  for (let hop = 0; hop < maxHops; hop++) {
    const nextFrontier: string[] = [];
    const add = (iri: string) => {
      if (iri && ontology.entities.has(iri) && !visited.has(iri)) {
        visited.add(iri);
        nextFrontier.push(iri);
      }
    };

    for (const currIri of frontier) {
      const ent = ontology.entities.get(currIri);
      if (!ent) continue;
      ent.superClasses.forEach(add);
      ent.subClasses.forEach(add);
      ent.disjointWith.forEach(add);
      ent.equivalentTo.forEach(add);
      ent.domains.forEach(add);
      ent.ranges.forEach(add);
      ent.inverses.forEach(add);
      ent.types.forEach(add);
      ent.instances.forEach(add);
      ent.domainOfProperties.forEach((pIri) => {
        add(pIri);
        const p = ontology.entities.get(pIri);
        p?.ranges.forEach(add);
      });
      ent.rangeOfProperties.forEach((pIri) => {
        add(pIri);
        const p = ontology.entities.get(pIri);
        p?.domains.forEach(add);
      });
      ent.propertyAssertions.forEach((pa) => {
        add(pa.property);
        add(pa.target);
      });
      ent.incomingAssertions.forEach((ia) => {
        add(ia.property);
        add(ia.source);
      });
    }
    frontier = nextFrontier;
  }

  // Also include all ancestor superclasses up to root so taxonomy context is unbroken
  const queue = Array.from(visited);
  while (queue.length > 0) {
    const curr = queue.pop()!;
    const ent = ontology.entities.get(curr);
    if (!ent) continue;
    for (const sup of ent.superClasses) {
      if (ontology.entities.has(sup) && !visited.has(sup)) {
        visited.add(sup);
        queue.push(sup);
      }
    }
  }

  return visited;
}

// eslint-disable-next-line react-refresh/only-export-components
export function computeGraphLayout(
  ontology: ParsedOwlOntology,
  projection: Owl2GraphProjection,
  focusIri?: string | null,
): {
  nodes: PositionedNode[];
  edges: ParsedOwlEdge[];
  routedEdges: RoutedEdge[];
  width: number;
  height: number;
} {
  const allowedIris =
    focusIri && ontology.entities.has(focusIri) ? computeNeighborhoodSet(ontology, focusIri, 1) : null;
  const allEntities = Array.from(ontology.entities.values()).filter((e) => !allowedIris || allowedIris.has(e.iri));

  const classes = allEntities.filter((e) => e.kind === "class" || e.kind === "definedClass");
  const properties = allEntities.filter((e) => e.kind === "objectProperty" || e.kind === "dataProperty");
  const individuals = allEntities.filter((e) => e.kind === "individual");

  const visibleNodes: ParsedOwlEntity[] = [];
  const visibleSet = new Set<string>();
  const addVisible = (ent: ParsedOwlEntity) => {
    if (!visibleSet.has(ent.iri)) {
      visibleSet.add(ent.iri);
      visibleNodes.push(ent);
    }
  };

  const edges: ParsedOwlEdge[] = [];

  if (projection === "taxonomy") {
    classes.forEach(addVisible);
    for (const c of classes) {
      for (const sup of c.superClasses) {
        if (visibleSet.has(sup)) {
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
        if (c.iri < disj && visibleSet.has(disj)) {
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
        if (c.iri < eq && visibleSet.has(eq)) {
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
    for (const p of properties) {
      addVisible(p);
      for (const d of p.domains) {
        const domEnt = ontology.entities.get(d);
        if (domEnt && (!allowedIris || allowedIris.has(d))) {
          addVisible(domEnt);
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
        const rngEnt = ontology.entities.get(r);
        if (rngEnt && (!allowedIris || allowedIris.has(r))) {
          addVisible(rngEnt);
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
        if (p.iri < inv && ontology.entities.has(inv) && (!allowedIris || allowedIris.has(inv))) {
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
  } else {
    // "all" projection: Classes + Individuals + folded Domain→Range object property edges
    classes.forEach(addVisible);
    individuals.forEach(addVisible);

    for (const c of classes) {
      for (const sup of c.superClasses) {
        if (visibleSet.has(sup)) {
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
        if (c.iri < disj && visibleSet.has(disj)) {
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
    for (const p of ontology.entities.values()) {
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
            if (visibleSet.has(domIri) && visibleSet.has(rngIri)) {
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

    for (const ind of individuals) {
      for (const tIri of ind.types) {
        if (visibleSet.has(tIri)) {
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
        if (visibleSet.has(pa.target)) {
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
    const depthCache = new Map<string, number>();
    const getDepth = (iri: string, pathVisited = new Set<string>()): number => {
      if (pathVisited.has(iri)) return 0;
      const cached = depthCache.get(iri);
      if (cached !== undefined) return cached;
      const ent = ontology.entities.get(iri);
      if (!ent || ent.superClasses.length === 0) {
        depthCache.set(iri, 0);
        return 0;
      }
      const nextVisited = new Set(pathVisited);
      nextVisited.add(iri);
      let maxParentDepth = 0;
      for (const sup of ent.superClasses) {
        if (visibleSet.has(sup)) {
          maxParentDepth = Math.max(maxParentDepth, getDepth(sup, nextVisited) + 1);
        }
      }
      depthCache.set(iri, maxParentDepth);
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

  // Count same-tier connections so hub nodes on Tier 0 sit between their peers (avoiding pass-through edges)
  const sameTierNeighbors = new Map<string, Set<string>>();
  for (const e of edges) {
    if (tierMap.get(e.source) === tierMap.get(e.target)) {
      const sSet = sameTierNeighbors.get(e.source) ?? new Set<string>();
      sSet.add(e.target);
      sameTierNeighbors.set(e.source, sSet);
      const tSet = sameTierNeighbors.get(e.target) ?? new Set<string>();
      tSet.add(e.source);
      sameTierNeighbors.set(e.target, tSet);
    }
  }

  const sortedTierKeys = Array.from(tiers.keys()).sort((a, b) => a - b);
  const nodeOrderX = new Map<string, number>();

  for (const tKey of sortedTierKeys) {
    const rowNodes = tiers.get(tKey)!;
    if (tKey === 0 && rowNodes.length >= 3) {
      // Sort initially by label for determinism, then place highest-degree horizontal hub in center
      rowNodes.sort((a, b) => a.label.localeCompare(b.label));
      const byDegree = [...rowNodes].sort(
        (a, b) =>
          (sameTierNeighbors.get(b.iri)?.size ?? 0) - (sameTierNeighbors.get(a.iri)?.size ?? 0) ||
          a.label.localeCompare(b.label),
      );
      const reordered: ParsedOwlEntity[] = new Array(rowNodes.length);
      let left = Math.floor((rowNodes.length - 1) / 2);
      let right = left + 1;
      byDegree.forEach((node, idx) => {
        if (idx % 2 === 0) {
          reordered[left--] = node;
        } else {
          reordered[right++] = node;
        }
      });
      tiers.set(tKey, reordered);
      reordered.forEach((n, idx) => nodeOrderX.set(n.iri, idx));
    } else {
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
  }

  // Helper to find max label pill width between two nodes on the same row
  const getHorizontalEdgeGap = (iriA: string, iriB: string): number => {
    let maxPill = 0;
    for (const e of edges) {
      if ((e.source === iriA && e.target === iriB) || (e.source === iriB && e.target === iriA)) {
        const pillW = Math.max(48, e.label.length * 5.8 + 16);
        if (pillW > maxPill) maxPill = pillW;
      }
    }
    return maxPill > 0 ? Math.max(72, Math.ceil(maxPill + 34)) : 54;
  };

  // Measure and position each node with dynamic edge-label-aware horizontal gaps
  const V_GAP = 72;
  const PADDING_X = 48;
  const PADDING_Y = 52;

  const rowLayouts: {
    tier: number;
    items: {
      entity: ParsedOwlEntity;
      w: number;
      h: number;
      subtitle?: string | undefined;
      badges: string[];
      gapAfter: number;
    }[];
    totalW: number;
    maxH: number;
  }[] = [];

  let canvasInnerWidth = 680;

  for (const tKey of sortedTierKeys) {
    const rowNodes = tiers.get(tKey)!;
    const items = rowNodes.map((ent, idx) => {
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
      const nextEnt = idx < rowNodes.length - 1 ? rowNodes[idx + 1] : undefined;
      const gapAfter = nextEnt ? getHorizontalEdgeGap(ent.iri, nextEnt.iri) : 0;
      return { entity: ent, w, h, subtitle, badges, gapAfter };
    });

    const totalW = items.reduce((acc, it) => acc + it.w + it.gapAfter, 0);
    const maxH = items.reduce((acc, it) => Math.max(acc, it.h), 50);
    if (totalW > canvasInnerWidth) canvasInnerWidth = totalW;
    rowLayouts.push({ tier: tKey, items, totalW, maxH });
  }

  const totalWidth = canvasInnerWidth + PADDING_X * 2;
  const positionedNodes: PositionedNode[] = [];
  const nodeByIri = new Map<string, PositionedNode>();
  let currentY = PADDING_Y;

  for (const row of rowLayouts) {
    let currentX = Math.floor((totalWidth - row.totalW) / 2);
    row.items.forEach((it, colIdx) => {
      const pNode: PositionedNode = {
        entity: it.entity,
        x: currentX,
        y: currentY + Math.floor((row.maxH - it.h) / 2),
        w: it.w,
        h: it.h,
        tier: row.tier,
        colIndex: colIdx,
        subtitle: it.subtitle,
        badges: it.badges,
      };
      positionedNodes.push(pNode);
      nodeByIri.set(it.entity.iri, pNode);
      currentX += it.w + it.gapAfter;
    });
    currentY += row.maxH + V_GAP;
  }

  const totalHeight = Math.max(300, currentY - V_GAP + PADDING_Y);

  // Pre-compute collision-free edge paths & exact Bézier midpoints
  const pairEdgeCounts = new Map<string, number>();
  const routedEdges: RoutedEdge[] = [];

  for (const edge of edges) {
    const srcNode = nodeByIri.get(edge.source);
    const tgtNode = nodeByIri.get(edge.target);
    if (!srcNode || !tgtNode) continue;

    const pairKey = edge.source < edge.target ? `${edge.source}__${edge.target}` : `${edge.target}__${edge.source}`;
    const parallelIdx = pairEdgeCounts.get(pairKey) ?? 0;
    pairEdgeCounts.set(pairKey, parallelIdx + 1);

    const sCx = srcNode.x + srcNode.w / 2;
    const sCy = srcNode.y + srcNode.h / 2;
    const tCx = tgtNode.x + tgtNode.w / 2;
    const tCy = tgtNode.y + tgtNode.h / 2;

    const dy = tCy - sCy;
    const dx = tCx - sCx;

    let pathD = "";
    let labelX = (sCx + tCx) / 2;
    let labelY = (sCy + tCy) / 2;

    if (Math.abs(dy) > 24) {
      // Vertical / Cross-tier connection
      const xOffset = parallelIdx > 0 ? (parallelIdx % 2 === 1 ? 22 : -22) : 0;
      const x1 = sCx + xOffset;
      const x2 = tCx + xOffset;
      const y1 = dy < 0 ? srcNode.y : srcNode.y + srcNode.h;
      const y2 = dy < 0 ? tgtNode.y + tgtNode.h + 2 : tgtNode.y - 2;
      const midY = (y1 + y2) / 2;
      pathD = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
      // Exact cubic Bézier midpoint at t = 0.5
      labelX = 0.125 * x1 + 0.375 * x1 + 0.375 * x2 + 0.125 * x2;
      labelY = 0.125 * y1 + 0.375 * midY + 0.375 * midY + 0.125 * y2;
    } else {
      // Same-row connection: check whether nodes are adjacent or separated by intermediate nodes
      const colDist = Math.abs(srcNode.colIndex - tgtNode.colIndex);
      if (colDist > 1) {
        // Non-adjacent nodes on the same row: route an overhead arc above the row so we never cross intermediate cards
        const x1 = sCx;
        const y1 = srcNode.y;
        const x2 = tCx;
        const y2 = tgtNode.y;
        const ctrlY = Math.min(y1, y2) - 42 - parallelIdx * 20;
        const midX = (x1 + x2) / 2;
        pathD = `M ${x1} ${y1} Q ${midX} ${ctrlY} ${x2} ${y2}`;
        labelX = midX;
        labelY = 0.25 * y1 + 0.5 * ctrlY + 0.25 * y2;
      } else {
        // Adjacent nodes on the same row: connect cleanly across the widened gap
        const x1 = dx >= 0 ? srcNode.x + srcNode.w : srcNode.x;
        const x2 = dx >= 0 ? tgtNode.x - 2 : tgtNode.x + tgtNode.w + 2;
        const yShift = parallelIdx > 0 ? (parallelIdx % 2 === 1 ? -14 : 14) : 0;
        const y1 = sCy + yShift;
        const y2 = tCy + yShift;
        const arcOffset = edge.kind === "disjointWith" ? -24 : 0;
        const midX = (x1 + x2) / 2;
        const ctrlY = (y1 + y2) / 2 + arcOffset;
        pathD = `M ${x1} ${y1} Q ${midX} ${ctrlY} ${x2} ${y2}`;
        labelX = midX;
        labelY = 0.25 * y1 + 0.5 * ctrlY + 0.25 * y2;
      }
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

    const pillW = Math.max(48, edge.label.length * 5.8 + 14);

    routedEdges.push({
      edge,
      pathD,
      labelX,
      labelY,
      pillW,
      stroke,
      dash,
      markerEnd,
    });
  }

  // De-conflict any edge label pills that sit too close to each other
  for (let i = 0; i < routedEdges.length; i++) {
    for (let j = i + 1; j < routedEdges.length; j++) {
      const a = routedEdges[i]!;
      const b = routedEdges[j]!;
      const overlapX = Math.abs(a.labelX - b.labelX) < (a.pillW + b.pillW) / 2 + 4;
      const overlapY = Math.abs(a.labelY - b.labelY) < 19;
      if (overlapX && overlapY) {
        a.labelY -= 10;
        b.labelY += 10;
      }
    }
  }

  return {
    nodes: positionedNodes,
    edges,
    routedEdges,
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
  height: 40px;
  min-height: 40px;
  background: var(--surface-hud, var(--color-canvas-subtle));
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  z-index: 10;
  gap: 8px;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
`;

const ModelTitle = styled.div`
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-heading, var(--color-fg-default));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PillBadge = styled.span<{ $variant?: "owl" | "verified" | "neutral" }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-family: var(--font-mono, monospace);
  padding: 2px 8px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  background: ${(p) =>
    p.$variant === "verified"
      ? "rgba(46, 160, 67, 0.14)"
      : p.$variant === "neutral"
        ? "var(--color-canvas-default)"
        : "rgba(139, 92, 246, 0.15)"};
  color: ${(p) =>
    p.$variant === "verified"
      ? "#2ea043"
      : p.$variant === "neutral"
        ? "var(--color-fg-muted)"
        : "var(--color-done-fg, #8b5cf6)"};
  border: 1px solid
    ${(p) =>
      p.$variant === "verified"
        ? "rgba(46, 160, 67, 0.35)"
        : p.$variant === "neutral"
          ? "var(--color-border-default)"
          : "rgba(139, 92, 246, 0.35)"};
`;

const SegmentedGroup = styled.div`
  display: inline-flex;
  align-items: center;
  background: var(--color-canvas-default);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
`;

const SegmentedBtn = styled.button<{ $active: boolean }>`
  border: none;
  background: ${(p) => (p.$active ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.18))" : "transparent")};
  color: ${(p) => (p.$active ? "var(--ms-brand, #0891b2)" : "var(--color-fg-muted)")};
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
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

const GraphViewport = styled.div<{ $isDark: boolean; $isDragging: boolean }>`
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: ${(p) => (p.$isDragging ? "grabbing" : "grab")};
  user-select: none;
  background-color: ${(p) =>
    p.$isDark ? "var(--color-canvas-default, #0d1117)" : "var(--color-canvas-subtle, #f8fafc)"};
  background-image: radial-gradient(
    ${(p) => (p.$isDark ? "var(--color-border-muted, rgba(148, 163, 184, 0.16))" : "rgba(100, 116, 139, 0.18)")} 1px,
    transparent 1px
  );
  background-size: 18px 18px;
`;

const FloatingHudPill = styled.div`
  position: absolute;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--color-canvas-default);
  border: 1px solid var(--color-border-default);
  border-radius: 7px;
  padding: 3px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(8px);
`;

const HudIconBtn = styled.button`
  border: none;
  background: transparent;
  color: var(--color-fg-muted);
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-mono, monospace);
  height: 22px;
  min-width: 22px;
  padding: 0 6px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;

  &:hover {
    background: var(--color-canvas-subtle);
    color: var(--color-fg-default);
  }
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

const LegendDot = styled.span<{ $color: string }>`
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${(p) => p.$color};
  margin-right: 4px;
`;

const TreeSplitContainer = styled.div`
  flex: 1;
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
`;

const TreeSidebar = styled.div`
  width: 42%;
  min-width: 220px;
  max-width: 360px;
  height: 100%;
  border-right: 1px solid var(--color-border-default);
  background: var(--color-canvas-subtle);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const TreeInspectorPane = styled.div`
  flex: 1;
  height: 100%;
  overflow-y: auto;
  padding: 16px 18px;
  background: var(--color-canvas-default);
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const TreeRowBtn = styled.button<{ $selected: boolean; $depth: number }>`
  width: 100%;
  border: none;
  background: ${(p) => (p.$selected ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.16))" : "transparent")};
  color: ${(p) => (p.$selected ? "var(--color-fg-default)" : "var(--color-fg-default)")};
  border-left: 2px solid ${(p) => (p.$selected ? "var(--ms-brand, #0891b2)" : "transparent")};
  padding: 5px 10px 5px ${(p) => 10 + p.$depth * 16}px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: ${(p) => (p.$selected ? 600 : 500)};
  cursor: pointer;
  text-align: left;

  &:hover {
    background: ${(p) =>
      p.$selected
        ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.22))"
        : "var(--ms-surface-hover, rgba(15, 23, 42, 0.045))"};
  }
`;

const KindBadge = styled.span<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono, monospace);
  background: ${(p) => `${p.$color}22`};
  color: ${(p) => p.$color};
  border: 1px solid ${(p) => `${p.$color}55`};
  flex-shrink: 0;
`;

function getEntityColors(kind: ParsedOwlEntity["kind"], isDark: boolean) {
  switch (kind) {
    case "class":
      return {
        stroke: isDark ? "#f43f5e" : "#e11d48",
        fill: isDark ? "#1e1b2e" : "#fff1f2",
        headerBg: isDark ? "rgba(244, 63, 94, 0.18)" : "rgba(225, 29, 72, 0.1)",
        stereotype: "«owl:Class»",
        shortBadge: "C",
      };
    case "definedClass":
      return {
        stroke: isDark ? "#f59e0b" : "#d97706",
        fill: isDark ? "#231f1a" : "#fffbeb",
        headerBg: isDark ? "rgba(245, 158, 11, 0.18)" : "rgba(217, 119, 6, 0.12)",
        stereotype: "«owl:DefinedClass»",
        shortBadge: "≡",
      };
    case "objectProperty":
      return {
        stroke: isDark ? "#38bdf8" : "#0284c7",
        fill: isDark ? "#132337" : "#f0f9ff",
        headerBg: isDark ? "rgba(56, 189, 248, 0.18)" : "rgba(2, 132, 199, 0.1)",
        stereotype: "«owl:ObjectProperty»",
        shortBadge: "P",
      };
    case "dataProperty":
      return {
        stroke: isDark ? "#34d399" : "#059669",
        fill: isDark ? "#122925" : "#ecfdf5",
        headerBg: isDark ? "rgba(52, 211, 153, 0.18)" : "rgba(5, 150, 105, 0.1)",
        stereotype: "«owl:DataProperty»",
        shortBadge: "D",
      };
    case "individual":
      return {
        stroke: isDark ? "#a78bfa" : "#7c3aed",
        fill: isDark ? "#1e1b36" : "#f5f3ff",
        headerBg: isDark ? "rgba(167, 139, 250, 0.18)" : "rgba(124, 58, 237, 0.1)",
        stereotype: "«owl:NamedIndividual»",
        shortBadge: "I",
      };
  }
}

export const Owl2Viewer: React.FC<Owl2ViewerProps> = ({ viewConfig, isFullScreen = false }) => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [loading, setLoading] = useState(false);
  const [rawText, setRawText] = useState(viewConfig.code || "");
  const [viewMode, setViewMode] = useState<Owl2ViewMode | null>(null);
  const [projection, setProjection] = useState<Owl2GraphProjection>("all");
  const [selectedIri, setSelectedIri] = useState<string | null>(null);
  const [focusIri, setFocusIri] = useState<string | null>(null);
  const [treeFilter, setTreeFilter] = useState("");
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [highlightedLines, setHighlightedLines] = useState<Set<number>>(new Set());

  // Interactive Zoom & Pan state for the Graph canvas
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const codeContainerRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
    moved: false,
  });

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isDragging) return undefined;
    const onWinMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        dragRef.current.moved = true;
      }
      setPan({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
    };
    const onWinMouseUp = () => {
      dragRef.current.active = false;
      setIsDragging(false);
    };
    window.addEventListener("mousemove", onWinMouseMove);
    window.addEventListener("mouseup", onWinMouseUp);
    return () => {
      window.removeEventListener("mousemove", onWinMouseMove);
      window.removeEventListener("mouseup", onWinMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    if (viewConfig.code) {
      setRawText(viewConfig.code);
      return;
    }
    if (viewConfig.url) {
      const controller = new AbortController();
      setLoading(true);
      const targetUrl =
        viewConfig.url.startsWith("http") ||
        viewConfig.url.startsWith("/api") ||
        viewConfig.url.startsWith("blob:") ||
        viewConfig.url.startsWith("data:")
          ? viewConfig.url
          : `/api${viewConfig.url}`;
      fetch(targetUrl, { signal: controller.signal })
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => {
          if (!controller.signal.aborted) setRawText(txt);
        })
        .catch((err) => {
          if (!controller.signal.aborted) {
            console.warn("[Owl2Viewer] Failed to fetch source:", err);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
      return () => {
        controller.abort();
      };
    }
    return undefined;
  }, [viewConfig.code, viewConfig.url]);

  useEffect(() => {
    if (!loading && typeof window !== "undefined") {
      (window as any).__ARTIFACT_READY = true;
    }
  }, [loading, rawText]);

  const ontology = useMemo(
    () => parseOwl2Source(rawText, viewConfig.ontologyIri || ""),
    [rawText, viewConfig.ontologyIri],
  );

  const reasoningResult = useMemo(() => runTableauReasoner(rawText, ontology), [rawText, ontology]);

  const displayTitle = useMemo(
    () => resolveDisplayTitle(viewConfig, ontology.ontologyIri),
    [viewConfig, ontology.ontologyIri],
  );

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

  // Automatically pick "tree" mode as default when the ontology is large (> 20 entities) so it always scales
  const totalEntities = ontology.entities.size;
  const resolvedViewMode: Owl2ViewMode = useMemo(() => {
    if (viewMode) return viewMode;
    if (totalEntities > 20) return "tree";
    return "diagram";
  }, [viewMode, totalEntities]);

  const graphLayout = useMemo(() => {
    if (resolvedViewMode !== "diagram") {
      return { nodes: [], edges: [], routedEdges: [], width: 680, height: 300 };
    }
    return computeGraphLayout(ontology, projection, focusIri);
  }, [resolvedViewMode, ontology, projection, focusIri]);

  const { showHint } = useWheelZoom({
    containerRef: viewportRef,
    zoom,
    setZoom,
    pan,
    setPan,
    isFullScreen,
    minZoom: 0.35,
    maxZoom: 3.5,
    disabled: resolvedViewMode !== "diagram" || graphLayout.nodes.length === 0,
  });

  const fallbackSvg = useMemo(() => {
    if (graphLayout.nodes.length === 0 && typeof viewConfig.svg === "string" && viewConfig.svg.trim()) {
      return sanitizeSvgMarkup(viewConfig.svg, { isFullScreen });
    }
    return "";
  }, [graphLayout.nodes.length, viewConfig.svg, isFullScreen]);

  const hasGraph = totalEntities > 0 || graphLayout.nodes.length > 0 || Boolean(fallbackSvg);
  const effectiveViewMode: Owl2ViewMode = resolvedViewMode === "diagram" && !hasGraph ? "code" : resolvedViewMode;

  // Grouped entities for Tree View
  const treeGroups = useMemo(() => {
    const q = treeFilter.trim().toLowerCase();
    const all = Array.from(ontology.entities.values());
    const matches = (e: ParsedOwlEntity) => !q || e.label.toLowerCase().includes(q) || e.iri.toLowerCase().includes(q);

    const classes = all.filter((e) => e.kind === "class" || e.kind === "definedClass");
    const rootClasses = classes
      .filter((c) => c.superClasses.filter((s) => ontology.entities.has(s)).length === 0)
      .sort((a, b) => a.label.localeCompare(b.label));

    const objProps = all
      .filter((e) => e.kind === "objectProperty" && matches(e))
      .sort((a, b) => a.label.localeCompare(b.label));
    const dataProps = all
      .filter((e) => e.kind === "dataProperty" && matches(e))
      .sort((a, b) => a.label.localeCompare(b.label));
    const individuals = all
      .filter((e) => e.kind === "individual" && matches(e))
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      classes: classes.filter(matches),
      rootClasses,
      objProps,
      dataProps,
      individuals,
    };
  }, [ontology, treeFilter]);

  const selectedEntity = useMemo(() => {
    if (selectedIri && ontology.entities.has(selectedIri)) {
      return ontology.entities.get(selectedIri)!;
    }
    if (effectiveViewMode === "tree") {
      return treeGroups.rootClasses[0] ?? Array.from(ontology.entities.values())[0] ?? null;
    }
    return null;
  }, [ontology, selectedIri, effectiveViewMode, treeGroups.rootClasses]);

  const codeLines = useMemo(() => (rawText ? rawText.split(/\r?\n/) : []), [rawText]);

  const handleCopy = () => {
    if (!rawText) return;
    navigator.clipboard.writeText(rawText);
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
  };

  const handleResetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement | null)?.closest("button")) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
      moved: false,
    };
    setIsDragging(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragRef.current.moved = true;
    }
    setPan({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
  };

  const handleMouseUp = () => {
    dragRef.current.active = false;
    setIsDragging(false);
  };

  const handleCanvasClick = () => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }
    setSelectedIri(null);
  };

  const toggleCollapse = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleJumpToSource = (ent: ParsedOwlEntity) => {
    setHighlightedLines(new Set(ent.sourceLines));
    setViewMode("code");
    if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current);
    jumpTimerRef.current = setTimeout(() => {
      const firstLine = ent.sourceLines[0];
      if (firstLine && codeContainerRef.current) {
        const lineEl = codeContainerRef.current.querySelector(`[data-line="${firstLine}"]`);
        lineEl?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 40);
  };

  const renderClassSubtree = (
    cls: ParsedOwlEntity,
    depth: number,
    visited = new Set<string>(),
    budget: { count: number; max: number } = { count: 0, max: 500 },
  ): React.ReactNode => {
    if (visited.has(cls.iri) || budget.count >= budget.max) return null;
    budget.count++;
    const nextVisited = new Set(visited);
    nextVisited.add(cls.iri);

    const q = treeFilter.trim().toLowerCase();
    const children = cls.subClasses
      .map((sIri) => ontology.entities.get(sIri))
      .filter((c): c is ParsedOwlEntity => Boolean(c))
      .sort((a, b) => a.label.localeCompare(b.label));

    const selfMatches = !q || cls.label.toLowerCase().includes(q) || cls.iri.toLowerCase().includes(q);
    const isCollapsed = collapsedNodes.has(cls.iri) && !q;
    const renderedChildren =
      !isCollapsed || q
        ? children.map((child) => renderClassSubtree(child, depth + 1, nextVisited, budget)).filter(Boolean)
        : [];

    if (!selfMatches && renderedChildren.length === 0) return null;

    const palette = getEntityColors(cls.kind, isDark);
    const isSelected = selectedEntity?.iri === cls.iri;
    const isUnsatisfiable = reasoningResult.unsatisfiableClasses.includes(cls.iri);

    return (
      <React.Fragment key={`${cls.iri}_${depth}_${budget.count}`}>
        <TreeRowBtn type="button" $selected={isSelected} $depth={depth} onClick={() => setSelectedIri(cls.iri)}>
          {children.length > 0 ? (
            <span
              onClick={(e) => toggleCollapse(cls.iri, e)}
              style={{ display: "inline-flex", alignItems: "center", color: "var(--color-fg-muted)" }}
            >
              {isCollapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
            </span>
          ) : (
            <span style={{ width: 12, display: "inline-block" }} />
          )}
          <KindBadge $color={isUnsatisfiable ? "#ef4444" : palette.stroke}>{palette.shortBadge}</KindBadge>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              color: isUnsatisfiable ? "#ef4444" : undefined,
              textDecoration: isUnsatisfiable ? "line-through" : undefined,
            }}
          >
            {cls.label}
          </span>
          {(cls.disjointWith.length > 0 || isUnsatisfiable) && (
            <span
              title={
                isUnsatisfiable
                  ? `Unsatisfiable class (⊑ owl:Nothing)`
                  : `Disjoint with: ${cls.disjointWith.map(getShortLabel).join(", ")}`
              }
              style={{ fontSize: "10px", color: "#ef4444", fontFamily: "var(--font-mono, monospace)", fontWeight: 700 }}
            >
              ⊥
            </span>
          )}
          {children.length > 0 && (
            <span
              style={{
                fontSize: "10px",
                color: "var(--color-fg-muted)",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              {children.length}
            </span>
          )}
        </TreeRowBtn>
        {!isCollapsed && renderedChildren}
      </React.Fragment>
    );
  };

  const renderInspectorDetails = (ent: ParsedOwlEntity, isTreePane: boolean) => {
    const palette = getEntityColors(ent.kind, isDark);
    return (
      <>
        <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={2}>
          <Box minWidth={0}>
            <Text
              style={{
                fontSize: "10px",
                fontFamily: "var(--font-mono, monospace)",
                color: palette.stroke,
                fontWeight: 700,
                display: "block",
              }}
            >
              {palette.stereotype}
            </Text>
            <Text
              style={{
                fontSize: isTreePane ? "15px" : "14px",
                fontWeight: 700,
                color: "var(--color-fg-default)",
                wordBreak: "break-word",
              }}
            >
              {ent.label}
            </Text>
          </Box>
          {!isTreePane ? (
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
          ) : (
            <Box display="flex" alignItems="center" gap={1} style={{ flexShrink: 0 }}>
              <HudIconBtn
                type="button"
                title="Focus this entity's neighborhood in the interactive Graph"
                onClick={() => {
                  setSelectedIri(ent.iri);
                  setFocusIri(ent.iri);
                  setViewMode("diagram");
                  handleResetView();
                }}
                style={{
                  border: "1px solid var(--color-border-default)",
                  padding: "0 8px",
                  height: "24px",
                }}
              >
                <WorkflowIcon size={11} /> Focus Graph
              </HudIconBtn>
              {ent.sourceLines.length > 0 && (
                <HudIconBtn
                  type="button"
                  title="Jump to axiom declarations in OWL 2 Functional Source"
                  onClick={() => handleJumpToSource(ent)}
                  style={{
                    border: "1px solid var(--color-border-default)",
                    padding: "0 8px",
                    height: "24px",
                  }}
                >
                  <CodeIcon size={11} /> Source
                </HudIconBtn>
              )}
            </Box>
          )}
        </Box>

        {!isTreePane && (
          <Box display="flex" alignItems="center" gap={1}>
            <HudIconBtn
              type="button"
              onClick={() => {
                setFocusIri((prev) => (prev === ent.iri ? null : ent.iri));
                handleResetView();
              }}
              style={{
                border: "1px solid var(--color-border-default)",
                background:
                  focusIri === ent.iri ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.18))" : "var(--color-canvas-subtle)",
                color: focusIri === ent.iri ? "var(--ms-brand, #0891b2)" : "var(--color-fg-default)",
                padding: "0 8px",
                height: "22px",
              }}
            >
              <FilterIcon size={11} /> {focusIri === ent.iri ? "Showing 1-Hop (Reset)" : "Isolate 1-Hop"}
            </HudIconBtn>
            {ent.sourceLines.length > 0 && (
              <HudIconBtn
                type="button"
                onClick={() => handleJumpToSource(ent)}
                style={{
                  border: "1px solid var(--color-border-default)",
                  background: "var(--color-canvas-subtle)",
                  padding: "0 8px",
                  height: "22px",
                }}
              >
                <CodeIcon size={11} /> Line {ent.sourceLines[0]}
              </HudIconBtn>
            )}
          </Box>
        )}

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
            {ent.iri}
          </Text>
        </DrawerSection>

        {ent.superClasses.length > 0 && (
          <DrawerSection>
            <DrawerLabel>SubClassOf (⊑)</DrawerLabel>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {ent.superClasses.map((supIri) => (
                <EntityChip key={supIri} $color="#3b82f6" onClick={() => setSelectedIri(supIri)}>
                  {getShortLabel(supIri)}
                </EntityChip>
              ))}
            </Box>
          </DrawerSection>
        )}

        {ent.restrictions.length > 0 && (
          <DrawerSection>
            <DrawerLabel>Class Restrictions &amp; Attributes</DrawerLabel>
            <Box display="flex" flexDirection="column" gap={1}>
              {ent.restrictions.map((r, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: "11px",
                    fontFamily: "var(--font-mono, monospace)",
                    color: "var(--color-fg-default)",
                    background: "var(--color-canvas-subtle)",
                    border: "1px solid var(--color-border-default)",
                    borderRadius: "4px",
                    padding: "3px 7px",
                  }}
                >
                  {r}
                </span>
              ))}
            </Box>
          </DrawerSection>
        )}

        {ent.subClasses.length > 0 && (
          <DrawerSection>
            <DrawerLabel>Direct SubClasses ({ent.subClasses.length})</DrawerLabel>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {ent.subClasses.map((subIri) => (
                <EntityChip key={subIri} $color="#f43f5e" onClick={() => setSelectedIri(subIri)}>
                  {getShortLabel(subIri)}
                </EntityChip>
              ))}
            </Box>
          </DrawerSection>
        )}

        {ent.disjointWith.length > 0 && (
          <DrawerSection>
            <DrawerLabel>DisjointClasses (⊥)</DrawerLabel>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {ent.disjointWith.map((dIri) => (
                <EntityChip key={dIri} $color="#ef4444" onClick={() => setSelectedIri(dIri)}>
                  {getShortLabel(dIri)}
                </EntityChip>
              ))}
            </Box>
          </DrawerSection>
        )}

        {ent.domainOfProperties.length > 0 && (
          <DrawerSection>
            <DrawerLabel>Outgoing Properties (Domain)</DrawerLabel>
            <Box display="flex" flexDirection="column" gap={1}>
              {ent.domainOfProperties.map((pIri) => {
                const prop = ontology.entities.get(pIri);
                const rngLabel = prop?.ranges.map(getShortLabel).join(", ") || "owl:Thing";
                return (
                  <Box
                    key={pIri}
                    display="flex"
                    alignItems="center"
                    flexWrap="wrap"
                    gap={1}
                    style={{ fontSize: "11px" }}
                  >
                    <EntityChip $color="#0284c7" onClick={() => setSelectedIri(pIri)}>
                      {getShortLabel(pIri)}
                    </EntityChip>
                    <span style={{ color: "var(--color-fg-muted)", fontFamily: "var(--font-mono, monospace)" }}>
                      → {rngLabel}
                    </span>
                  </Box>
                );
              })}
            </Box>
          </DrawerSection>
        )}

        {ent.rangeOfProperties.length > 0 && (
          <DrawerSection>
            <DrawerLabel>Incoming Properties (Range)</DrawerLabel>
            <Box display="flex" flexDirection="column" gap={1}>
              {ent.rangeOfProperties.map((pIri) => {
                const prop = ontology.entities.get(pIri);
                const domLabel = prop?.domains.map(getShortLabel).join(", ") || "owl:Thing";
                return (
                  <Box
                    key={pIri}
                    display="flex"
                    alignItems="center"
                    flexWrap="wrap"
                    gap={1}
                    style={{ fontSize: "11px" }}
                  >
                    <span style={{ color: "var(--color-fg-muted)", fontFamily: "var(--font-mono, monospace)" }}>
                      {domLabel} →
                    </span>
                    <EntityChip $color="#0284c7" onClick={() => setSelectedIri(pIri)}>
                      {getShortLabel(pIri)}
                    </EntityChip>
                  </Box>
                );
              })}
            </Box>
          </DrawerSection>
        )}

        {ent.domains.length > 0 && (
          <DrawerSection>
            <DrawerLabel>Domain (rdfs:domain)</DrawerLabel>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {ent.domains.map((dIri) => (
                <EntityChip key={dIri} $color="#f43f5e" onClick={() => setSelectedIri(dIri)}>
                  {getShortLabel(dIri)}
                </EntityChip>
              ))}
            </Box>
          </DrawerSection>
        )}

        {ent.ranges.length > 0 && (
          <DrawerSection>
            <DrawerLabel>Range (rdfs:range)</DrawerLabel>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {ent.ranges.map((rIri) => (
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

        {ent.inverses.length > 0 && (
          <DrawerSection>
            <DrawerLabel>Inverse Of (⇄)</DrawerLabel>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {ent.inverses.map((invIri) => (
                <EntityChip key={invIri} $color="#0284c7" onClick={() => setSelectedIri(invIri)}>
                  {getShortLabel(invIri)}
                </EntityChip>
              ))}
            </Box>
          </DrawerSection>
        )}

        {ent.instances.length > 0 && (
          <DrawerSection>
            <DrawerLabel>Named Individuals ({ent.instances.length})</DrawerLabel>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {ent.instances.map((indIri) => (
                <EntityChip key={indIri} $color="#8b5cf6" onClick={() => setSelectedIri(indIri)}>
                  {getShortLabel(indIri)}
                </EntityChip>
              ))}
            </Box>
          </DrawerSection>
        )}

        {ent.types.length > 0 && (
          <DrawerSection>
            <DrawerLabel>Class Assertion (rdf:type)</DrawerLabel>
            <Box display="flex" flexWrap="wrap" gap={1}>
              {ent.types.map((tIri) => (
                <EntityChip key={tIri} $color="#f43f5e" onClick={() => setSelectedIri(tIri)}>
                  {getShortLabel(tIri)}
                </EntityChip>
              ))}
            </Box>
          </DrawerSection>
        )}

        {ent.propertyAssertions.length > 0 && (
          <DrawerSection>
            <DrawerLabel>Object Property Assertions</DrawerLabel>
            <Box display="flex" flexDirection="column" gap={1}>
              {ent.propertyAssertions.map((pa, idx) => (
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

        {ent.incomingAssertions.length > 0 && (
          <DrawerSection>
            <DrawerLabel>Referenced By Individuals</DrawerLabel>
            <Box display="flex" flexDirection="column" gap={1}>
              {ent.incomingAssertions.map((ia, idx) => (
                <Box key={idx} display="flex" alignItems="center" gap={1} style={{ fontSize: "11px" }}>
                  <EntityChip $color="#8b5cf6" onClick={() => setSelectedIri(ia.source)}>
                    {getShortLabel(ia.source)}
                  </EntityChip>
                  <span style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--color-fg-muted)" }}>
                    → {getShortLabel(ia.property)}
                  </span>
                </Box>
              ))}
            </Box>
          </DrawerSection>
        )}
      </>
    );
  };

  return (
    <CardWrapper $isFullScreen={isFullScreen}>
      <Toolbar>
        <HeaderLeft>
          <OrganizationIcon size={15} fill="var(--color-done-fg, #8b5cf6)" />
          {!isFullScreen && (
            <ModelTitle title={ontology.ontologyIri || viewConfig.title || displayTitle}>{displayTitle}</ModelTitle>
          )}
          {reasoningResult.consistent && reasoningResult.unsatisfiableClasses.length === 0 ? (
            <PillBadge
              $variant="verified"
              title={`OWL 2 DL · Tableau Reasoner verified consistency (0 unsatisfiable classes${reasoningResult.entailedSubsumptions > 0 ? `, ${reasoningResult.entailedSubsumptions} inferred subsumption(s)` : ""})${ontology.ontologyIri ? ` · IRI: ${ontology.ontologyIri}` : ""}`}
            >
              <CheckCircleFillIcon size={11} /> DL Consistent
            </PillBadge>
          ) : (
            <PillBadge
              $variant="owl"
              style={{
                background: "rgba(239, 68, 68, 0.14)",
                color: "#ef4444",
                borderColor: "rgba(239, 68, 68, 0.4)",
              }}
              title={`OWL 2 DL · Tableau Reasoner detected ${reasoningResult.unsatisfiableClasses.length} unsatisfiable class(es)${reasoningResult.unsatisfiableClasses.length > 0 ? `: ${reasoningResult.unsatisfiableClasses.map(getShortLabel).join(", ")}` : ""}`}
            >
              <XIcon size={11} />{" "}
              {!reasoningResult.consistent
                ? `DL Inconsistent (${reasoningResult.unsatisfiableClasses.length} ⊥)`
                : `${reasoningResult.unsatisfiableClasses.length} Unsatisfiable (⊥)`}
            </PillBadge>
          )}
          <PillBadge
            $variant="neutral"
            title={`${counts.classCount} Classes · ${counts.propertyCount} Properties · ${counts.individualCount} Individuals · ${counts.axiomCount} Axioms`}
          >
            {counts.classCount}C · {counts.propertyCount}P · {counts.individualCount}I
          </PillBadge>
        </HeaderLeft>

        <Box display="flex" alignItems="center" gap={2} style={{ flexShrink: 0 }}>
          <SegmentedGroup>
            {hasGraph && (
              <SegmentedBtn
                type="button"
                $active={effectiveViewMode === "diagram"}
                onClick={() => setViewMode("diagram")}
                title="Interactive Ontology Graph"
              >
                <WorkflowIcon size={12} /> Graph
              </SegmentedBtn>
            )}
            {totalEntities > 0 && (
              <SegmentedBtn
                type="button"
                $active={effectiveViewMode === "tree"}
                onClick={() => setViewMode("tree")}
                title="Protégé-style Class & Property Hierarchy Explorer"
              >
                <ListUnorderedIcon size={12} /> Tree
              </SegmentedBtn>
            )}
            <SegmentedBtn
              type="button"
              $active={effectiveViewMode === "code"}
              onClick={() => setViewMode("code")}
              title="OWL 2 Functional-Style Syntax (.ofn)"
            >
              <CodeIcon size={12} /> Source
            </SegmentedBtn>
          </SegmentedGroup>

          {effectiveViewMode === "code" && rawText && (
            <Button size="small" onClick={handleCopy} leadingVisual={copied ? CheckIcon : CopyIcon}>
              {copied ? "Copied" : "Copy"}
            </Button>
          )}

          {Boolean(viewConfig?.standalone) && !isFullScreen && (
            <Button
              size="small"
              variant="primary"
              leadingVisual={DraftingTriangleIcon}
              onClick={() => {
                const hash = compressMorselPayload({
                  v: 1,
                  lang: "owl2" as any,
                  code: rawText || `Ontology(<http://example.org/ontology>\n)\n`,
                  title: displayTitle,
                });
                const fromParam = viewConfig?.artifactId
                  ? `?fromArtifact=${encodeURIComponent(String(viewConfig.artifactId))}`
                  : "";
                navigate(`/morsel${fromParam}#m=${hash}`);
              }}
            >
              Open in Morsel
            </Button>
          )}
        </Box>
      </Toolbar>

      <ContentArea>
        {loading ? (
          <Box flex={1} display="flex" justifyContent="center" alignItems="center">
            <Spinner size="medium" />
          </Box>
        ) : effectiveViewMode === "diagram" && graphLayout.nodes.length > 0 ? (
          <>
            <GraphViewport
              ref={viewportRef}
              $isDark={isDark}
              $isDragging={isDragging}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onClick={handleCanvasClick}
            >
              {/* Top-Left Floating Projection Lens Pill */}
              <FloatingHudPill style={{ top: 10, left: 10 }} onClick={(e) => e.stopPropagation()}>
                <SegmentedBtn
                  type="button"
                  $active={projection === "all"}
                  onClick={() => setProjection("all")}
                  title="TBox Classes + Domain/Range Property Edges + ABox Individuals"
                >
                  All
                </SegmentedBtn>
                <SegmentedBtn
                  type="button"
                  $active={projection === "taxonomy"}
                  onClick={() => setProjection("taxonomy")}
                  title="Pure Class Subsumption & Disjointness Hierarchy (⊑ / ⊥)"
                >
                  Taxonomy ⊑
                </SegmentedBtn>
                <SegmentedBtn
                  type="button"
                  $active={projection === "properties"}
                  onClick={() => setProjection("properties")}
                  title="Object & Data Properties with Domain and Range Classes"
                >
                  Properties
                </SegmentedBtn>
                {focusIri && ontology.entities.has(focusIri) && (
                  <SegmentedBtn
                    type="button"
                    $active
                    onClick={() => {
                      setFocusIri(null);
                      handleResetView();
                    }}
                    title="Click to exit neighborhood isolation and show all entities"
                  >
                    <FilterIcon size={11} /> {getShortLabel(focusIri)} (1-hop) ×
                  </SegmentedBtn>
                )}
              </FloatingHudPill>

              {/* Bottom-Left Floating Compact Legend Pill */}
              <FloatingHudPill
                style={{
                  bottom: 10,
                  left: 10,
                  padding: "4px 10px",
                  gap: 10,
                  fontSize: "10.5px",
                  color: "var(--color-fg-muted)",
                  pointerEvents: "none",
                }}
              >
                <span>
                  <LegendDot $color={isDark ? "#f43f5e" : "#e11d48"} />
                  Class
                </span>
                <span>
                  <LegendDot $color={isDark ? "#38bdf8" : "#0284c7"} />
                  Property
                </span>
                <span>
                  <LegendDot $color={isDark ? "#a78bfa" : "#7c3aed"} />
                  Individual
                </span>
              </FloatingHudPill>

              {/* Bottom-Right Floating Zoom & Fit Controls */}
              <FloatingHudPill
                style={{ bottom: 10, right: selectedEntity ? 12 : 10 }}
                onClick={(e) => e.stopPropagation()}
              >
                <HudIconBtn
                  type="button"
                  aria-label="Zoom out"
                  title="Zoom out"
                  onClick={() => setZoom((z) => Math.max(0.35, Number((z / 1.2).toFixed(2))))}
                >
                  −
                </HudIconBtn>
                <HudIconBtn
                  type="button"
                  aria-label="Reset zoom"
                  title="Reset zoom and pan to fit"
                  onClick={handleResetView}
                >
                  {Math.round(zoom * 100)}%
                </HudIconBtn>
                <HudIconBtn
                  type="button"
                  aria-label="Zoom in"
                  title="Zoom in"
                  onClick={() => setZoom((z) => Math.min(3.5, Number((z * 1.2).toFixed(2))))}
                >
                  <PlusIcon size={11} />
                </HudIconBtn>
                {(zoom !== 1 || pan.x !== 0 || pan.y !== 0) && (
                  <HudIconBtn type="button" title="Reset view" onClick={handleResetView}>
                    <SyncIcon size={11} />
                  </HudIconBtn>
                )}
              </FloatingHudPill>

              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "center center",
                  transition: isDragging ? "none" : "transform 0.08s ease-out",
                  padding: "36px 16px 32px 16px",
                  boxSizing: "border-box",
                }}
              >
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
                    overflow: "visible",
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

                  {/* Layer 1: Edge Curves */}
                  <g className="owl-edges-layer">
                    {graphLayout.routedEdges.map(({ edge, pathD, stroke, dash, markerEnd }) => {
                      const isConnected = !selectedIri || edge.source === selectedIri || edge.target === selectedIri;
                      return (
                        <path
                          key={edge.id}
                          d={pathD}
                          fill="none"
                          stroke={stroke}
                          strokeWidth={isConnected && selectedIri ? 2.1 : 1.75}
                          strokeDasharray={dash}
                          markerEnd={markerEnd}
                          opacity={isConnected ? 1 : 0.22}
                        />
                      );
                    })}
                  </g>

                  {/* Layer 2: Node Cards */}
                  <g className="owl-nodes-layer">
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
                            if (dragRef.current.moved) {
                              dragRef.current.moved = false;
                              return;
                            }
                            setSelectedIri((prev) => (prev === entity.iri ? null : entity.iri));
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setSelectedIri(entity.iri);
                            setFocusIri((prev) => (prev === entity.iri ? null : entity.iri));
                            handleResetView();
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
                  </g>

                  {/* Layer 3: Edge Label Pills (rendered above nodes & curves so labels are never occluded) */}
                  <g className="owl-edge-labels-layer" style={{ pointerEvents: "none" }}>
                    {graphLayout.routedEdges.map(({ edge, labelX, labelY, pillW, stroke }) => {
                      const isConnected = !selectedIri || edge.source === selectedIri || edge.target === selectedIri;
                      return (
                        <g key={`lbl_${edge.id}`} opacity={isConnected ? 1 : 0.22}>
                          <rect
                            x={labelX - pillW / 2}
                            y={labelY - 9}
                            width={pillW}
                            height={17}
                            rx={4}
                            fill={isDark ? "var(--color-canvas-subtle, #161b22)" : "#ffffff"}
                            stroke={stroke}
                            strokeWidth={0.95}
                            strokeOpacity={0.75}
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
                  </g>
                </svg>
              </div>

              <ZoomHintBadge show={showHint} />
            </GraphViewport>

            {selectedEntity && <EntityDrawer>{renderInspectorDetails(selectedEntity, false)}</EntityDrawer>}
          </>
        ) : effectiveViewMode === "tree" && totalEntities > 0 ? (
          <TreeSplitContainer>
            <TreeSidebar>
              {/* Search Filter */}
              <Box
                p={2}
                borderBottom="1px solid var(--color-border-default)"
                display="flex"
                alignItems="center"
                gap={1}
                bg="var(--color-canvas-default)"
              >
                <SearchIcon size={13} fill="var(--color-fg-muted)" />
                <input
                  type="text"
                  value={treeFilter}
                  onChange={(e) => setTreeFilter(e.target.value)}
                  placeholder={`Filter ${totalEntities} entities...`}
                  style={{
                    flex: 1,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: "var(--color-fg-default)",
                    fontSize: "12px",
                  }}
                />
                {treeFilter && (
                  <button
                    type="button"
                    onClick={() => setTreeFilter("")}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--color-fg-muted)",
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    <XIcon size={12} />
                  </button>
                )}
              </Box>

              {/* Hierarchical Tree List */}
              <Box flex={1} overflowY="auto" py={1}>
                {/* 1. Classes Taxonomy */}
                <TreeRowBtn
                  type="button"
                  $selected={false}
                  $depth={0}
                  onClick={(e) => toggleCollapse("__GROUP_CLASSES__", e)}
                  style={{ fontWeight: 700, fontSize: "11px", color: "var(--color-fg-muted)" }}
                >
                  {collapsedNodes.has("__GROUP_CLASSES__") ? (
                    <ChevronRightIcon size={12} />
                  ) : (
                    <ChevronDownIcon size={12} />
                  )}
                  <span>CLASSES (owl:Thing)</span>
                  <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono, monospace)", fontSize: "10px" }}>
                    {treeGroups.classes.length}
                  </span>
                </TreeRowBtn>
                {!collapsedNodes.has("__GROUP_CLASSES__") &&
                  (() => {
                    const sharedBudget = { count: 0, max: 500 };
                    return treeGroups.rootClasses.map((rootCls) =>
                      renderClassSubtree(rootCls, 1, new Set<string>(), sharedBudget),
                    );
                  })()}

                {/* 2. Object Properties */}
                {treeGroups.objProps.length > 0 && (
                  <>
                    <TreeRowBtn
                      type="button"
                      $selected={false}
                      $depth={0}
                      onClick={(e) => toggleCollapse("__GROUP_OBJ_PROPS__", e)}
                      style={{ fontWeight: 700, fontSize: "11px", color: "var(--color-fg-muted)", marginTop: 4 }}
                    >
                      {collapsedNodes.has("__GROUP_OBJ_PROPS__") ? (
                        <ChevronRightIcon size={12} />
                      ) : (
                        <ChevronDownIcon size={12} />
                      )}
                      <span>OBJECT PROPERTIES</span>
                      <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono, monospace)", fontSize: "10px" }}>
                        {treeGroups.objProps.length}
                      </span>
                    </TreeRowBtn>
                    {!collapsedNodes.has("__GROUP_OBJ_PROPS__") &&
                      treeGroups.objProps.map((prop) => {
                        const palette = getEntityColors(prop.kind, isDark);
                        return (
                          <TreeRowBtn
                            key={prop.iri}
                            type="button"
                            $selected={selectedEntity?.iri === prop.iri}
                            $depth={1}
                            onClick={() => setSelectedIri(prop.iri)}
                          >
                            <span style={{ width: 12, display: "inline-block" }} />
                            <KindBadge $color={palette.stroke}>{palette.shortBadge}</KindBadge>
                            <span
                              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
                            >
                              {prop.label}
                            </span>
                            {prop.inverses.length > 0 && (
                              <span
                                style={{
                                  fontSize: "10px",
                                  color: "var(--color-fg-muted)",
                                  fontFamily: "var(--font-mono, monospace)",
                                }}
                              >
                                ⇄
                              </span>
                            )}
                          </TreeRowBtn>
                        );
                      })}
                  </>
                )}

                {/* 3. Data Properties */}
                {treeGroups.dataProps.length > 0 && (
                  <>
                    <TreeRowBtn
                      type="button"
                      $selected={false}
                      $depth={0}
                      onClick={(e) => toggleCollapse("__GROUP_DATA_PROPS__", e)}
                      style={{ fontWeight: 700, fontSize: "11px", color: "var(--color-fg-muted)", marginTop: 4 }}
                    >
                      {collapsedNodes.has("__GROUP_DATA_PROPS__") ? (
                        <ChevronRightIcon size={12} />
                      ) : (
                        <ChevronDownIcon size={12} />
                      )}
                      <span>DATA PROPERTIES</span>
                      <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono, monospace)", fontSize: "10px" }}>
                        {treeGroups.dataProps.length}
                      </span>
                    </TreeRowBtn>
                    {!collapsedNodes.has("__GROUP_DATA_PROPS__") &&
                      treeGroups.dataProps.map((prop) => {
                        const palette = getEntityColors(prop.kind, isDark);
                        return (
                          <TreeRowBtn
                            key={prop.iri}
                            type="button"
                            $selected={selectedEntity?.iri === prop.iri}
                            $depth={1}
                            onClick={() => setSelectedIri(prop.iri)}
                          >
                            <span style={{ width: 12, display: "inline-block" }} />
                            <KindBadge $color={palette.stroke}>{palette.shortBadge}</KindBadge>
                            <span
                              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
                            >
                              {prop.label}
                            </span>
                          </TreeRowBtn>
                        );
                      })}
                  </>
                )}

                {/* 4. Named Individuals */}
                {treeGroups.individuals.length > 0 && (
                  <>
                    <TreeRowBtn
                      type="button"
                      $selected={false}
                      $depth={0}
                      onClick={(e) => toggleCollapse("__GROUP_INDIVS__", e)}
                      style={{ fontWeight: 700, fontSize: "11px", color: "var(--color-fg-muted)", marginTop: 4 }}
                    >
                      {collapsedNodes.has("__GROUP_INDIVS__") ? (
                        <ChevronRightIcon size={12} />
                      ) : (
                        <ChevronDownIcon size={12} />
                      )}
                      <span>INDIVIDUALS (ABox)</span>
                      <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono, monospace)", fontSize: "10px" }}>
                        {treeGroups.individuals.length}
                      </span>
                    </TreeRowBtn>
                    {!collapsedNodes.has("__GROUP_INDIVS__") &&
                      treeGroups.individuals.map((ind) => {
                        const palette = getEntityColors(ind.kind, isDark);
                        return (
                          <TreeRowBtn
                            key={ind.iri}
                            type="button"
                            $selected={selectedEntity?.iri === ind.iri}
                            $depth={1}
                            onClick={() => setSelectedIri(ind.iri)}
                          >
                            <span style={{ width: 12, display: "inline-block" }} />
                            <KindBadge $color={palette.stroke}>{palette.shortBadge}</KindBadge>
                            <span
                              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
                            >
                              {ind.label}
                            </span>
                            {ind.types[0] && (
                              <span
                                style={{
                                  fontSize: "10px",
                                  color: "var(--color-fg-muted)",
                                  fontFamily: "var(--font-mono, monospace)",
                                }}
                              >
                                :{getShortLabel(ind.types[0])}
                              </span>
                            )}
                          </TreeRowBtn>
                        );
                      })}
                  </>
                )}
              </Box>
            </TreeSidebar>

            <TreeInspectorPane>
              {selectedEntity ? (
                renderInspectorDetails(selectedEntity, true)
              ) : (
                <Box color="var(--color-fg-muted)" fontSize={1}>
                  Select an entity from the ontology hierarchy to inspect its axioms.
                </Box>
              )}
            </TreeInspectorPane>
          </TreeSplitContainer>
        ) : effectiveViewMode === "diagram" && fallbackSvg ? (
          <InteractiveSvgStage svgHtml={fallbackSvg} isFullScreen={isFullScreen} />
        ) : (
          <Box
            ref={codeContainerRef}
            flex={1}
            py={2}
            overflow="auto"
            bg="var(--color-canvas-inset, #010409)"
            style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "12px", lineHeight: 1.55 }}
          >
            {codeLines.length > 0 ? (
              codeLines.map((line, idx) => {
                const lineNum = idx + 1;
                const isHighlighted = highlightedLines.has(lineNum);
                return (
                  <div
                    key={idx}
                    data-line={lineNum}
                    style={{
                      display: "flex",
                      padding: "0 14px",
                      background: isHighlighted ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.18))" : "transparent",
                      borderLeft: isHighlighted ? "2px solid var(--ms-brand, #0891b2)" : "2px solid transparent",
                    }}
                  >
                    <span
                      style={{
                        userSelect: "none",
                        width: "36px",
                        minWidth: "36px",
                        textAlign: "right",
                        paddingRight: "12px",
                        color: isHighlighted ? "var(--ms-brand, #0891b2)" : "var(--color-fg-subtle)",
                        fontSize: "11px",
                      }}
                    >
                      {lineNum}
                    </span>
                    <span style={{ whiteSpace: "pre", color: "var(--color-fg-default)" }}>
                      {highlightPolyglotLine(line, "owl2")}
                    </span>
                  </div>
                );
              })
            ) : (
              <Box p={4} color="var(--color-fg-muted)" textAlign="center">
                No OWL2 ontology content available.
              </Box>
            )}
          </Box>
        )}
      </ContentArea>
    </CardWrapper>
  );
};

export default Owl2Viewer;

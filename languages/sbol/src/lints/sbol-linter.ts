// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbol — Pre-flight Genetic Circuit & Sequence Ontology Linter.
 *
 * Implements OpenModelica-style diagnostic codes (M9501 - M9510) for SBOL3 models.
 */

import { type DiagnosticItem, SbolErrorCode } from "../errors.js";
import { SEQUENCE_ONTOLOGY, type SbolComponent, type SbolDocument, type SbolRange, type SbolRole } from "../types.js";

const VALID_IUPAC_NUCLEOTIDES = new Set(["A", "C", "G", "T", "U", "N", "a", "c", "g", "t", "u", "n"]);
const VALID_START_CODONS = new Set(["ATG", "AUG", "GTG", "GUG", "TTG", "UUG"]);
const VALID_STOP_CODONS = new Set(["TAA", "TAG", "TGA", "UAA", "UAG", "UGA"]);

interface OrderedGeneticElement {
  displayId: string;
  roles: SbolRole[];
  start?: number | undefined;
  end?: number | undefined;
  sequenceId?: string | undefined;
  orderIndex: number;
  range?: SbolRange | undefined;
}

function isValidCdsSequence(elements: string): boolean {
  if (elements.length === 0 || elements.length % 3 !== 0) {
    return false;
  }
  if (elements.length >= 6) {
    const startCodon = elements.slice(0, 3).toUpperCase();
    const stopCodon = elements.slice(elements.length - 3).toUpperCase();
    if (!VALID_START_CODONS.has(startCodon) || !VALID_STOP_CODONS.has(stopCodon)) {
      return false;
    }
  }
  return true;
}

export function lintSbol(doc: SbolDocument): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];

  const seqById = new Map<string, (typeof doc.sequences)[number]>();
  const compById = new Map<string, SbolComponent>();
  const allKnownIds = new Set<string>();

  // M9509: Duplicate displayId check across top-level entities in the document namespace
  const seenTopIds = new Set<string>();
  const checkDuplicateTopId = (id: string, ns: string, range?: SbolRange): void => {
    if (!id) return;
    const key = `${ns}::${id}`;
    if (seenTopIds.has(key)) {
      diagnostics.push({
        code: SbolErrorCode.DUPLICATE_DISPLAY_ID.code,
        rule: SbolErrorCode.DUPLICATE_DISPLAY_ID.rule,
        severity: SbolErrorCode.DUPLICATE_DISPLAY_ID.severity,
        message: SbolErrorCode.DUPLICATE_DISPLAY_ID.message(id, ns),
        range,
      });
    } else {
      seenTopIds.add(key);
    }
  };

  for (const seq of doc.sequences) {
    checkDuplicateTopId(seq.displayId, seq.namespace ?? doc.namespace, seq.range);
    seqById.set(seq.displayId, seq);
    allKnownIds.add(seq.displayId);
  }

  for (const comp of doc.components) {
    checkDuplicateTopId(comp.displayId, comp.namespace ?? doc.namespace, comp.range);
    compById.set(comp.displayId, comp);
    allKnownIds.add(comp.displayId);
    for (const sub of comp.subComponents) {
      if (sub.displayId) allKnownIds.add(sub.displayId);
    }
    for (const feat of comp.features) {
      if (feat.displayId) allKnownIds.add(feat.displayId);
    }
  }

  for (const inter of doc.interactions) {
    // Top-level interactions may also exist in comp.interactions; only check once per object reference
    checkDuplicateTopId(inter.displayId, doc.namespace, inter.range);
  }

  // M9501: Invalid nucleotide sequence
  for (const seq of doc.sequences) {
    const clean = seq.elements.trim();
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i] ?? "";
      if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") continue;
      if (!VALID_IUPAC_NUCLEOTIDES.has(ch)) {
        diagnostics.push({
          code: SbolErrorCode.INVALID_NUCLEOTIDE_SEQUENCE.code,
          rule: SbolErrorCode.INVALID_NUCLEOTIDE_SEQUENCE.rule,
          severity: SbolErrorCode.INVALID_NUCLEOTIDE_SEQUENCE.severity,
          message: SbolErrorCode.INVALID_NUCLEOTIDE_SEQUENCE.message(seq.displayId, ch),
          range: seq.range,
        });
        break;
      }
    }
  }

  // Component-level checks: M9502, M9503, M9504, M9505, M9510
  for (const comp of doc.components) {
    // Check if standalone CDS component has a sequence whose length is not a multiple of 3 or lacks start/stop codon (M9503)
    if (comp.roles.includes(SEQUENCE_ONTOLOGY.CDS) && comp.sequences.length > 0) {
      for (const seqId of comp.sequences) {
        const seq = seqById.get(seqId);
        if (seq && seq.elements.length > 0 && !isValidCdsSequence(seq.elements)) {
          diagnostics.push({
            code: SbolErrorCode.CDS_LENGTH_NOT_MULTIPLE_OF_THREE.code,
            rule: SbolErrorCode.CDS_LENGTH_NOT_MULTIPLE_OF_THREE.rule,
            severity: SbolErrorCode.CDS_LENGTH_NOT_MULTIPLE_OF_THREE.severity,
            message: SbolErrorCode.CDS_LENGTH_NOT_MULTIPLE_OF_THREE.message(comp.displayId, seq.elements.length),
            range: comp.range,
          });
        }
      }
    }

    // M9504: Unresolved SubComponent reference
    for (const sub of comp.subComponents) {
      if (!sub.instanceOf || !compById.has(sub.instanceOf)) {
        diagnostics.push({
          code: SbolErrorCode.UNRESOLVED_SUBCOMPONENT_REFERENCE.code,
          rule: SbolErrorCode.UNRESOLVED_SUBCOMPONENT_REFERENCE.rule,
          severity: SbolErrorCode.UNRESOLVED_SUBCOMPONENT_REFERENCE.severity,
          message: SbolErrorCode.UNRESOLVED_SUBCOMPONENT_REFERENCE.message(
            sub.displayId,
            comp.displayId,
            sub.instanceOf || "<empty>",
          ),
          range: sub.range ?? comp.range,
        });
      }
    }

    // Assemble ordered genetic elements (features + subComponents) for range, CDS length, TU order, and RBS checks
    const elements: OrderedGeneticElement[] = [];
    let orderCounter = 0;

    for (const sub of comp.subComponents) {
      const targetComp = compById.get(sub.instanceOf);
      const effectiveRoles = sub.roles && sub.roles.length > 0 ? sub.roles : (targetComp?.roles ?? []);
      elements.push({
        displayId: sub.displayId,
        roles: effectiveRoles,
        start: sub.start,
        end: sub.end,
        sequenceId: sub.sequenceId,
        orderIndex: orderCounter++,
        range: sub.range ?? comp.range,
      });
    }

    for (const feat of comp.features) {
      elements.push({
        displayId: feat.displayId,
        roles: feat.roles,
        start: feat.start,
        end: feat.end,
        sequenceId: feat.sequenceId,
        orderIndex: orderCounter++,
        range: feat.range ?? comp.range,
      });
    }

    // M9502 & feature-level M9503
    for (const el of elements) {
      const targetSeqId = el.sequenceId ?? comp.sequences[0];
      const targetSeq = targetSeqId ? seqById.get(targetSeqId) : undefined;

      if (el.start !== undefined && el.end !== undefined) {
        const seqLen = targetSeq ? targetSeq.elements.length : undefined;
        if (el.start < 1 || el.end < el.start || (seqLen !== undefined && el.end > seqLen)) {
          diagnostics.push({
            code: SbolErrorCode.SEQUENCE_RANGE_OUT_OF_BOUNDS.code,
            rule: SbolErrorCode.SEQUENCE_RANGE_OUT_OF_BOUNDS.rule,
            severity: SbolErrorCode.SEQUENCE_RANGE_OUT_OF_BOUNDS.severity,
            message: SbolErrorCode.SEQUENCE_RANGE_OUT_OF_BOUNDS.message(
              el.displayId,
              el.start,
              el.end,
              targetSeq?.displayId ?? targetSeqId ?? "unknown",
              seqLen ?? 0,
            ),
            range: el.range,
          });
        } else if (el.roles.includes(SEQUENCE_ONTOLOGY.CDS)) {
          const spanLen = el.end - el.start + 1;
          let cdsValid = spanLen % 3 === 0;
          if (cdsValid && targetSeq && targetSeq.elements.length >= el.end) {
            const subSeq = targetSeq.elements.slice(el.start - 1, el.end);
            cdsValid = isValidCdsSequence(subSeq);
          }
          if (!cdsValid) {
            diagnostics.push({
              code: SbolErrorCode.CDS_LENGTH_NOT_MULTIPLE_OF_THREE.code,
              rule: SbolErrorCode.CDS_LENGTH_NOT_MULTIPLE_OF_THREE.rule,
              severity: SbolErrorCode.CDS_LENGTH_NOT_MULTIPLE_OF_THREE.severity,
              message: SbolErrorCode.CDS_LENGTH_NOT_MULTIPLE_OF_THREE.message(el.displayId, spanLen),
              range: el.range,
            });
          }
        }
      }
    }

    // Sort elements by start coordinate if available, or apply "precedes" constraints, else declaration order
    const sortedElements = [...elements].sort((a, b) => {
      for (const c of comp.constraints) {
        if (c.restriction === "precedes") {
          if (c.subject === a.displayId && c.object === b.displayId) return -1;
          if (c.subject === b.displayId && c.object === a.displayId) return 1;
        }
      }
      if (a.start !== undefined && b.start !== undefined && a.start !== b.start) {
        return a.start - b.start;
      }
      return a.orderIndex - b.orderIndex;
    });

    // M9505: Invalid transcriptional unit order (terminator upstream of promoter without an intervening CDS)
    for (let i = 0; i < sortedElements.length; i++) {
      const current = sortedElements[i];
      if (!current || !current.roles.includes(SEQUENCE_ONTOLOGY.TERMINATOR)) continue;

      // Check if any CDS appeared before this terminator
      let hasUpstreamCds = false;
      for (let k = 0; k < i; k++) {
        if (sortedElements[k]?.roles.includes(SEQUENCE_ONTOLOGY.CDS)) {
          hasUpstreamCds = true;
          break;
        }
      }

      if (!hasUpstreamCds) {
        // Look for a downstream promoter
        for (let j = i + 1; j < sortedElements.length; j++) {
          const downstream = sortedElements[j];
          if (downstream?.roles.includes(SEQUENCE_ONTOLOGY.CDS)) {
            break;
          }
          if (downstream?.roles.includes(SEQUENCE_ONTOLOGY.PROMOTER)) {
            diagnostics.push({
              code: SbolErrorCode.INVALID_TRANSCRIPTIONAL_UNIT_ORDER.code,
              rule: SbolErrorCode.INVALID_TRANSCRIPTIONAL_UNIT_ORDER.rule,
              severity: SbolErrorCode.INVALID_TRANSCRIPTIONAL_UNIT_ORDER.severity,
              message: SbolErrorCode.INVALID_TRANSCRIPTIONAL_UNIT_ORDER.message(
                comp.displayId,
                current.displayId,
                downstream.displayId,
              ),
              range: current.range ?? comp.range,
            });
            break;
          }
        }
      }
    }

    // M9510: Missing CDS ribosome binding site (SO:0000139) in bacterial transcriptional unit
    if (sortedElements.length > 0) {
      for (let i = 0; i < sortedElements.length; i++) {
        const el = sortedElements[i];
        if (!el || !el.roles.includes(SEQUENCE_ONTOLOGY.CDS)) continue;

        let hasUpstreamRbs = false;
        for (let k = 0; k < i; k++) {
          if (sortedElements[k]?.roles.includes(SEQUENCE_ONTOLOGY.RBS)) {
            hasUpstreamRbs = true;
            break;
          }
        }

        if (!hasUpstreamRbs) {
          diagnostics.push({
            code: SbolErrorCode.MISSING_CDS_RIBOSOME_BINDING_SITE.code,
            rule: SbolErrorCode.MISSING_CDS_RIBOSOME_BINDING_SITE.rule,
            severity: SbolErrorCode.MISSING_CDS_RIBOSOME_BINDING_SITE.severity,
            message: SbolErrorCode.MISSING_CDS_RIBOSOME_BINDING_SITE.message(comp.displayId, el.displayId),
            range: el.range ?? comp.range,
          });
        }
      }
    }
  }

  // M9506 & M9507: Interaction participant and role checks
  for (const inter of doc.interactions) {
    for (const part of inter.participants) {
      if (!part.participant || !allKnownIds.has(part.participant)) {
        diagnostics.push({
          code: SbolErrorCode.DANGLING_INTERACTION_PARTICIPANT.code,
          rule: SbolErrorCode.DANGLING_INTERACTION_PARTICIPANT.rule,
          severity: SbolErrorCode.DANGLING_INTERACTION_PARTICIPANT.severity,
          message: SbolErrorCode.DANGLING_INTERACTION_PARTICIPANT.message(
            inter.displayId,
            part.participant || "<empty>",
          ),
          range: part.range ?? inter.range,
        });
      }

      if (!part.roles || part.roles.length === 0 || part.roles.every((r) => !r.trim())) {
        diagnostics.push({
          code: SbolErrorCode.MISSING_INTERACTION_ROLE.code,
          rule: SbolErrorCode.MISSING_INTERACTION_ROLE.rule,
          severity: SbolErrorCode.MISSING_INTERACTION_ROLE.severity,
          message: SbolErrorCode.MISSING_INTERACTION_ROLE.message(part.participant || "<anonymous>", inter.displayId),
          range: part.range ?? inter.range,
        });
      }
    }
  }

  // M9508: Circular SubComponent containment hierarchy check
  const reportedCycleComps = new Set<string>();
  for (const startComp of doc.components) {
    const visited = new Set<string>();
    const hasCycleFrom = (currId: string): boolean => {
      if (currId === startComp.displayId && visited.size > 0) {
        return true;
      }
      if (visited.has(currId)) {
        return false;
      }
      visited.add(currId);
      const currComp = compById.get(currId);
      if (!currComp) return false;
      for (const sub of currComp.subComponents) {
        if (hasCycleFrom(sub.instanceOf)) {
          return true;
        }
      }
      return false;
    };

    if (hasCycleFrom(startComp.displayId) && !reportedCycleComps.has(startComp.displayId)) {
      reportedCycleComps.add(startComp.displayId);
      diagnostics.push({
        code: SbolErrorCode.CIRCULAR_COMPONENT_HIERARCHY.code,
        rule: SbolErrorCode.CIRCULAR_COMPONENT_HIERARCHY.rule,
        severity: SbolErrorCode.CIRCULAR_COMPONENT_HIERARCHY.severity,
        message: SbolErrorCode.CIRCULAR_COMPONENT_HIERARCHY.message(startComp.displayId),
        range: startComp.range,
      });
    }
  }

  return diagnostics;
}

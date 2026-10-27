// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Nelson-Oppen Requirement Entailment Verifier.
 *
 * Couples parsed ReqIF requirement hierarchies and contracts with
 * @modelscript/runtime's EntailmentTheoryOracle to formally prove
 * V-Model decomposition completeness:
 *   ⋀ R_child,i ⊨ R_parent
 */

import { EntailmentTheoryOracle, type DigitalThreadProofManifest } from "@modelscript/runtime";
import type { ReqIfDocument, ReqIfEntailmentResult, ReqIfSpecHierarchy } from "../types.js";

export interface ReqIfEntailmentReport {
  totalQueries: number;
  certifiedCount: number;
  gapCount: number;
  results: ReqIfEntailmentResult[];
  manifests: DigitalThreadProofManifest[];
}

export function verifyReqIfEntailment(doc: ReqIfDocument): ReqIfEntailmentReport {
  const oracle = new EntailmentTheoryOracle();
  let litId = 1;

  // 1. Assert all contracted requirements into the oracle
  for (const obj of doc.specObjects.values()) {
    if (obj.contract) {
      const op = obj.contract.comparator === "!=" ? "<=" : obj.contract.comparator;
      oracle.assertLiteral({
        id: litId++,
        predicate: "requirement",
        args: [obj.identifier, obj.contract.variable, op, obj.contract.limitValue],
      });
    }
  }

  // 2. Discover parent-child decomposition queries
  const queries: { parentId: string; childIds: string[] }[] = [];

  // 2a. From SPEC-HIERARCHY trees
  function collectHierarchicalQueries(h: ReqIfSpecHierarchy) {
    if (h.children.length > 0) {
      const parentId = h.objectRef;
      const childIds = h.children.map((c) => c.objectRef).filter((id) => doc.specObjects.has(id));
      if (parentId && childIds.length > 0) {
        queries.push({ parentId, childIds });
      }
      for (const child of h.children) {
        collectHierarchicalQueries(child);
      }
    }
  }

  for (const spec of doc.specifications) {
    for (const h of spec.children) {
      collectHierarchicalQueries(h);
    }
  }

  // 2b. From SPEC-RELATIONS (refines, derives)
  const relationChildren = new Map<string, string[]>();
  for (const rel of doc.specRelations) {
    if (rel.relationType === "refines" || rel.relationType === "derives") {
      const parentId = rel.targetId;
      const childId = rel.sourceId;
      if (parentId && childId) {
        const existing = relationChildren.get(parentId) || [];
        existing.push(childId);
        relationChildren.set(parentId, existing);
      }
    }
  }

  for (const [parentId, childIds] of relationChildren) {
    queries.push({ parentId, childIds });
  }

  // 3. Evaluate each entailment query
  const results: ReqIfEntailmentResult[] = [];
  const manifests: DigitalThreadProofManifest[] = [];

  for (const q of queries) {
    const parentObj = doc.specObjects.get(q.parentId);
    const parentContract = parentObj?.contract;
    if (!parentObj || !parentContract) continue;

    const validChildren = q.childIds.filter((cid) => {
      const c = doc.specObjects.get(cid);
      return c && c.contract && c.contract.variable === parentContract.variable;
    });

    if (validChildren.length === 0) continue;

    oracle.pushLevel();
    oracle.assertLiteral({
      id: litId++,
      predicate: "entailment",
      args: [q.parentId, validChildren],
    });

    const satResult = oracle.checkSat();
    if (satResult.isSat) {
      const proofManifests = oracle.getCertifiedManifests();
      const manifestId = proofManifests[0]?.manifestId;
      if (proofManifests[0]) {
        manifests.push(proofManifests[0]);
      }
      results.push({
        isEntailed: true,
        parentReqId: q.parentId,
        childReqIds: validChildren,
        proofManifestId: manifestId,
      });
    } else {
      results.push({
        isEntailed: false,
        parentReqId: q.parentId,
        childReqIds: validChildren,
        diagnosticMessage: satResult.conflict?.explanation || "Entailment contract violation",
      });
    }
    oracle.popLevel();
  }

  const certifiedCount = results.filter((r) => r.isEntailed).length;
  const gapCount = results.filter((r) => !r.isEntailed).length;

  return {
    totalQueries: results.length,
    certifiedCount,
    gapCount,
    results,
    manifests,
  };
}

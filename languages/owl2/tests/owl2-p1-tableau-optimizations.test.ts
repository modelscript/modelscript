// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Owl2TableauReasoner } from "../src/reasoner/tableau.js";

describe("P1: Tableau GCI Absorption, Syntactic ⊥-Locality Modules & Dependency-Directed Backjumping", () => {
  it("extracts minimal syntactic ⊥-locality modules and preserves exact subsumption on 200+ class TBoxes", () => {
    const lines: string[] = ["Prefix(:=<http://ex.org/>)", "Ontology(<http://ex.org/modular>"];

    // 10 completely disconnected domain clusters of 20 classes each (200 classes)
    for (let d = 0; d < 10; d++) {
      for (let i = 0; i < 20; i++) {
        lines.push(`Declaration(Class(:D${d}_C${i}))`);
        if (i > 0) {
          lines.push(`SubClassOf(:D${d}_C${i} :D${d}_C${i - 1})`);
        }
      }
      // Binary absorbed GCI inside each cluster: D{d}_C19 ⊓ D{d}_C18 ⊑ D{d}_Target
      lines.push(`Declaration(Class(:D${d}_Target))`);
      lines.push(`SubClassOf(ObjectIntersectionOf(:D${d}_C19 :D${d}_C18) :D${d}_Target)`);
    }
    lines.push(")");

    const reasoner = new Owl2TableauReasoner(lines.join("\n"));

    // Extract ⊥-locality module for just :D0_C19 and :D0_Target
    const mod = reasoner.extractLocalityModule([":D0_C19", ":D0_Target"]);
    assert.ok(
      mod.subClassAxioms.length <= 25,
      `Expected small locality module (<= 25 axioms), got ${mod.subClassAxioms.length} of ${reasoner.subClassAxioms.length}`,
    );
    assert.ok(!mod.signature.has(":D5_C0"), "Unrelated domain D5 must not leak into D0 module");

    // Verify subsumption via module-scoped + binary-absorbed tableau
    assert.equal(reasoner.isSubClassOf(":D0_C19", ":D0_C0"), true);
    assert.equal(reasoner.isSubClassOf(":D0_C19", ":D0_Target"), true);
    assert.equal(reasoner.isSubClassOf(":D0_C19", ":D5_C0"), false);
  });

  it("performs dependency-directed backjumping over independent disjunctions", () => {
    const lines: string[] = ["Prefix(:=<http://ex.org/>)", "Ontology(<http://ex.org/backjump>"];
    // Root forces 12 independent disjunctions P_i ⊔ Q_i, PLUS a guaranteed contradiction A ⊔ B where both A and B clash!
    const parts: string[] = [];
    for (let i = 0; i < 12; i++) {
      lines.push(`Declaration(Class(:P${i}))`);
      lines.push(`Declaration(Class(:Q${i}))`);
      parts.push(`ObjectUnionOf(:P${i} :Q${i})`);
    }
    lines.push("Declaration(Class(:A))", "Declaration(Class(:B))", "Declaration(Class(:C))", "Declaration(Class(:D))");
    lines.push("SubClassOf(:A :C)", "SubClassOf(:A ObjectComplementOf(:C))");
    lines.push("SubClassOf(:B :D)", "SubClassOf(:B ObjectComplementOf(:D))");
    parts.push("ObjectUnionOf(:A :B)");

    lines.push("Declaration(Class(:Root))");
    lines.push(`SubClassOf(:Root ObjectIntersectionOf(${parts.join(" ")}))`);
    lines.push(")");

    const reasoner = new Owl2TableauReasoner(lines.join("\n"));
    const t0 = performance.now();
    const sat = reasoner.isClassSatisfiable(":Root");
    const elapsedMs = performance.now() - t0;

    assert.equal(sat, false, "Root must be unsatisfiable");
    assert.ok(
      reasoner.lastBackjumpCount > 0,
      `Expected dependency-directed backjumping to skip irrelevant choice points (got ${reasoner.lastBackjumpCount})`,
    );
    assert.ok(elapsedMs < 200, `Backjumping should close 2^12 search space in < 200ms, took ${elapsedMs.toFixed(1)}ms`);
  });
});

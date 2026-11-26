// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SAFETY_CRITICAL_REGEX,
  segmentProseForZonotope,
  splitIntoSentences,
} from "../src/workbench/util/zonotope-prose-helpers.js";
import type { ZonotopePendingOverride } from "../src/workbench/util/zonotope-workbench-state.js";

describe("zonotope-prose-helpers", () => {
  describe("SAFETY_CRITICAL_REGEX", () => {
    it("matches safety requirement modals and numeric safety thresholds", () => {
      const sample =
        "The actuator SHALL NOT jam; it MUST NOT drift during FAIL-SAFE mode, SHALL trip in <= 50 ms (or ≤ 50 ms), MUST NEVER exceed CRITICAL limits, and maintain >= 2.0 bar and ≤ 100.";
      const matches = Array.from(sample.matchAll(SAFETY_CRITICAL_REGEX)).map((m) => m[0]);

      assert.ok(matches.includes("SHALL NOT"));
      assert.ok(matches.includes("MUST NOT"));
      assert.ok(matches.includes("FAIL-SAFE"));
      assert.ok(matches.includes("SHALL"));
      assert.ok(matches.includes("<= 50 ms"));
      assert.ok(matches.includes("≤ 50 ms"));
      assert.ok(matches.includes("MUST NEVER"));
      assert.ok(matches.includes("CRITICAL"));
      assert.ok(matches.includes(">= 2.0 bar"));
      assert.ok(matches.includes("≤ 100"));
    });
  });

  describe("segmentProseForZonotope", () => {
    it("preserves exact original input text when concatenating segments and maintains contiguous offsets", () => {
      const text =
        "During FAIL-SAFE shutdown, resistor R1 SHALL NOT exceed ≤ 50 ms while capacitor C1 balances R10 and wall_thickness.";
      const record = {
        spans: [
          {
            groupId: 1,
            relTypeId: 1,
            relSign: 1,
            symbolName: "R1",
            text: "R1",
            ontologyIri: "owl:Resistor",
          },
          {
            groupId: 2,
            relTypeId: 4,
            relSign: 1,
            symbolName: "C1",
            text: "C1",
          },
          {
            groupId: 3,
            relTypeId: 6,
            relSign: 1,
            symbolName: "wall_thickness",
            text: "wall_thickness",
          },
        ],
      };

      const segments = segmentProseForZonotope(text, record, []);
      assert.equal(segments.map((s) => s.text).join(""), text);

      let expectedOffset = 0;
      for (const seg of segments) {
        assert.equal(seg.start, expectedOffset);
        assert.equal(seg.end, expectedOffset + seg.text.length);
        assert.equal(text.slice(seg.start, seg.end), seg.text);
        expectedOffset = seg.end;
      }
      assert.equal(expectedOffset, text.length);

      // Word boundary check: R10 must NOT be split by symbol R1
      const r1Matches = segments.filter((s) => s.kind === "symbol" && s.symbolName === "R1");
      assert.equal(r1Matches.length, 1);
      assert.equal(r1Matches[0]?.text, "R1");
    });

    it("returns empty array for empty input and a single plain segment when nothing matches", () => {
      assert.deepEqual(segmentProseForZonotope("", null, []), []);

      const plainText = "Ambient operating environment remains nominal.";
      const segs = segmentProseForZonotope(plainText, null, []);
      assert.equal(segs.length, 1);
      assert.deepEqual(segs[0], {
        text: plainText,
        start: 0,
        end: plainText.length,
        kind: "plain",
      });
    });

    it("auto-locks safety-critical phrases (SHALL NOT, FAIL-SAFE, ≤ 50 ms) to groupId = 0", () => {
      const text = "The controller SHALL NOT enter fault state; FAIL-SAFE trip latency is ≤ 50 ms.";
      const segments = segmentProseForZonotope(text, null, []);

      assert.equal(segments.map((s) => s.text).join(""), text);

      const safetySegments = segments.filter((s) => s.kind === "safety");
      assert.deepEqual(
        safetySegments.map((s) => s.text),
        ["SHALL NOT", "FAIL-SAFE", "≤ 50 ms"],
      );
      for (const seg of safetySegments) {
        assert.equal(seg.groupId, 0);
        assert.equal(seg.relTypeId, 0);
        assert.equal(seg.relSign, 0);
        assert.equal(seg.badge, "🔒 LOCK");
      }
    });

    it("highlights matched hypergraph symbols with ontology and group metadata", () => {
      const text = "Connect R1 in series with L1 and verify flow_in conservation.";
      const record = {
        spans: [
          { groupId: 0, relTypeId: 0, relSign: 0, text: "Connect" },
          {
            groupId: 1,
            relTypeId: 3,
            relSign: 1,
            symbolName: "R1",
            text: "R1",
            ontologyIri: "http://example.org/elec#Resistor",
          },
          {
            groupId: 2,
            relTypeId: 1,
            relSign: 1,
            symbolName: "L1",
            text: "L1",
          },
          {
            groupId: 3,
            relTypeId: 4,
            relSign: 1,
            symbolName: "flow_in",
            text: "flow_in",
          },
        ],
      };

      const segments = segmentProseForZonotope(text, record, []);
      assert.equal(segments.map((s) => s.text).join(""), text);

      const r1 = segments.find((s) => s.text === "R1");
      assert.ok(r1);
      assert.equal(r1.kind, "symbol");
      assert.equal(r1.groupId, 1);
      assert.equal(r1.ontologyIri, "http://example.org/elec#Resistor");
      assert.equal(r1.badge, "⊑ OWL:Resistor");

      const l1 = segments.find((s) => s.text === "L1");
      assert.ok(l1);
      assert.equal(l1.kind, "symbol");
      assert.equal(l1.groupId, 2);
      assert.equal(l1.badge, "↔ L1");

      const flow = segments.find((s) => s.text === "flow_in");
      assert.ok(flow);
      assert.equal(flow.kind, "symbol");
      assert.equal(flow.groupId, 3);
      assert.equal(flow.badge, "FLOW ±1");

      // Locked syntax token without ontologyIri should not be falsely highlighted in prose
      const connectSeg = segments.find((s) => s.text.includes("Connect"));
      assert.ok(connectSeg);
      assert.equal(connectSeg.kind, "plain");
    });

    it("applies pendingOverrides including locked and inverse-coupled sign overrides with longest-first precedence", () => {
      const text = "When thermal load rises, supply pressure and return pressure move oppositely around R1.";
      const record = {
        spans: [
          {
            groupId: 1,
            relTypeId: 1,
            relSign: 1,
            symbolName: "R1",
            text: "R1",
            ontologyIri: "qudt:Resistance",
          },
        ],
      };

      const overrides: ZonotopePendingOverride[] = [
        {
          id: "ov-1",
          textSnippet: "supply pressure",
          groupId: 4,
          relTypeId: 2,
          relSign: -1,
          modality: "text",
        },
        {
          id: "ov-2",
          textSnippet: "return pressure",
          groupId: 4,
          relTypeId: 2,
          relSign: -1,
          modality: "text",
        },
        {
          id: "ov-3",
          symbolName: "R1",
          textSnippet: "R1",
          groupId: 0,
          relTypeId: 0,
          relSign: 0,
          modality: "text",
        },
      ];

      const segments = segmentProseForZonotope(text, record, overrides);
      assert.equal(segments.map((s) => s.text).join(""), text);

      const supply = segments.find((s) => s.text === "supply pressure");
      assert.ok(supply);
      assert.equal(supply.kind, "override");
      assert.equal(supply.groupId, 4);
      assert.equal(supply.relTypeId, 2);
      assert.equal(supply.relSign, -1);

      const ret = segments.find((s) => s.text === "return pressure");
      assert.ok(ret);
      assert.equal(ret.kind, "override");
      assert.equal(ret.groupId, 4);
      assert.equal(ret.relTypeId, 2);
      assert.equal(ret.relSign, -1);

      // User override locking R1 supersedes hypergraph record's groupId = 1
      const r1 = segments.find((s) => s.text === "R1");
      assert.ok(r1);
      assert.equal(r1.kind, "override");
      assert.equal(r1.groupId, 0);
      assert.equal(r1.relSign, 0);
      assert.equal(r1.badge, "🔒 0");
      assert.equal(r1.ontologyIri, "qudt:Resistance");
    });
  });

  describe("splitIntoSentences", () => {
    it("handles Markdown headings, bullet items, multi-sentence paragraphs, decimals, and code fences", () => {
      const markdown = [
        "# Thermal & Electrical Safety Spec",
        "",
        "## Primary Constraints",
        "",
        "- The resistor `R1` SHALL NOT exceed 125.5 °C during operation.",
        "- Recovery latency MUST be <= 50 ms. Check `motor.R1` after fault clearance.",
        "1. Maintain **wall_thickness** >= 2.0 mm (e.g. per Fig. 3).",
        "",
        "```modelica",
        "model IgnoredCode",
        "  parameter Real R1 = 100.0;",
        "end IgnoredCode;",
        "```",
        "",
        "The valve pressure must remain at most 2.5 bar across steady state.",
        "If pressure exceeds 3.0 bar, the FAIL-SAFE actuator trips immediately! Is telemetry logged?",
        "",
        "---",
      ].join("\n");

      const sentences = splitIntoSentences(markdown);

      assert.deepEqual(sentences, [
        "Thermal & Electrical Safety Spec",
        "Primary Constraints",
        "The resistor R1 SHALL NOT exceed 125.5 °C during operation.",
        "Recovery latency MUST be <= 50 ms.",
        "Check motor.R1 after fault clearance.",
        "Maintain wall_thickness >= 2.0 mm (e.g. per Fig. 3).",
        "The valve pressure must remain at most 2.5 bar across steady state.",
        "If pressure exceeds 3.0 bar, the FAIL-SAFE actuator trips immediately!",
        "Is telemetry logged?",
      ]);
    });

    it("returns empty array for blank or code-only markdown", () => {
      assert.deepEqual(splitIntoSentences("   \n\n  "), []);
      assert.deepEqual(splitIntoSentences("```ts\nconst x = 1;\n```"), []);
    });
  });
});

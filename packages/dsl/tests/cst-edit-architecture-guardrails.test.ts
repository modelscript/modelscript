// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const MIGRATED_CST_EDIT_FILES = [
  "languages/pscad/src/edit/edit-engine.ts",
  "languages/pscad/src/edit/diagram-actions.ts",
  "languages/pscad/src/drop-edits.ts",
  "languages/pscad/src/tgg/pscad-ieee-sync.ts",
  "languages/simulink/src/diagram-backend.ts",
  "languages/simulink/src/tgg/simulink-sync.ts",
  "languages/opendrive/src/diagram-backend.ts",
  "languages/ssp/src/diagram.ts",
  "languages/spice/src/diagram-backend.ts",
  "languages/owl2/src/diagram/edits.ts",
  "languages/olga/src/lints/quick-fixes.ts",
  "languages/autosar/src/tgg/autosar-sync.ts",
  "languages/reqif/src/tgg/reqif-sync.ts",
  "languages/urdf/src/tgg/urdf-sync.ts",
];

describe("CST + Unparser Edit Architecture Guardrails", () => {
  it("forbids raw XML tag/attribute regex patching and manual </Tag> lastIndexOf splicing in migrated backends", () => {
    const forbiddenPatterns: Array<{ name: string; re: RegExp }> = [
      {
        name: "dynamic XML element/tag regex",
        re: /new\s+RegExp\(\s*[`"'][^`"']*<(?:Block|road|junction|Line|User|Wire|Component|Declaration|P|link|successor|\$\{)/i,
      },
      {
        name: "raw </Tag> lastIndexOf XML splice",
        re: /\.lastIndexOf\(\s*["']<\/(?:Block|System|OpenDRIVE|Ontology|schematic|definitions|project)>/i,
      },
      {
        name: "legacy @modelscript/dsl/xml raw splice helpers",
        re: /\b(?:setAttributeSplice|appendChildSplice|removeElementSplice)\b/,
      },
    ];

    for (const relPath of MIGRATED_CST_EDIT_FILES) {
      const absPath = path.join(REPO_ROOT, relPath);
      const src = fs.readFileSync(absPath, "utf-8");
      for (const { name, re } of forbiddenPatterns) {
        const m = re.exec(src);
        assert.equal(m, null, `Architectural guardrail violation in ${relPath}: found forbidden ${name}: ${m?.[0]}`);
      }
    }
  });

  it("ensures migrated backends import CstDocumentSession / CstTransaction from @modelscript/dsl/unparser", () => {
    for (const relPath of MIGRATED_CST_EDIT_FILES) {
      const absPath = path.join(REPO_ROOT, relPath);
      const src = fs.readFileSync(absPath, "utf-8");
      assert.match(
        src,
        /@modelscript\/dsl\/unparser/,
        `Expected ${relPath} to use @modelscript/dsl/unparser CST edit primitives`,
      );
    }
  });
});

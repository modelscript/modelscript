// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver";
import { hasWorkspaceLinter, runWorkspaceLinterForDocument } from "../src/services/workspace-linter-dispatch.js";

const ALL_30_WORKSPACE_LANGS = [
  "cgmes",
  "psse",
  "pslf",
  "pscad",
  "opendss",
  "scl",
  "spice",
  "atp",
  "verilog-a",
  "ssp",
  "oscal",
  "autosar",
  "automationml",
  "plcopen",
  "simulink",
  "usd",
  "urdf",
  "scad",
  "c",
  "fortran",
  "ampl",
  "modflow",
  "hec-ras",
  "eclipse",
  "energyplus",
  "topas",
  "cellml",
  "antimony",
  "sedml",
  "sbol",
];

test("hasWorkspaceLinter covers all 30 cross-file languages", () => {
  for (const langId of ALL_30_WORKSPACE_LANGS) {
    assert.equal(hasWorkspaceLinter(langId), true, `Expected workspace linter for ${langId}`);
  }
  assert.equal(hasWorkspaceLinter("unknown-lang"), false);
});

test("runWorkspaceLinterForDocument emits cross-file diagnostics and avoids duplicates", async () => {
  const diagsMissing: Diagnostic[] = [];
  await runWorkspaceLinterForDocument(
    "antimony",
    {
      "file:///proj/main.ant": 'import "missing.ant"\nmodel main()\nend\n',
    },
    "file:///proj/main.ant",
    diagsMissing,
  );
  assert.equal(
    diagsMissing.some((d) => d.code === "AN3001" && d.severity === DiagnosticSeverity.Error),
    true,
  );

  // Calling again on the same diagnostics array should not duplicate AN3001
  const countBefore = diagsMissing.length;
  await runWorkspaceLinterForDocument(
    "antimony",
    {
      "file:///proj/main.ant": 'import "missing.ant"\nmodel main()\nend\n',
    },
    "file:///proj/main.ant",
    diagsMissing,
  );
  assert.equal(diagsMissing.length, countBefore);

  // When the imported file is present in workspaceDocs, AN3001 disappears
  const diagsResolved: Diagnostic[] = [];
  await runWorkspaceLinterForDocument(
    "antimony",
    {
      "file:///proj/main.ant": 'import "sub.ant"\nmodel main()\nend\n',
      "file:///proj/sub.ant": "model sub()\nend\n",
    },
    "file:///proj/main.ant",
    diagsResolved,
  );
  assert.equal(
    diagsResolved.some((d) => d.code === "AN3001"),
    false,
  );
});

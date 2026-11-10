// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { getDiagnostics, getDocumentSymbols, hecHmsLanguage, HmsWorkspaceIndex } from "../src/index.js";

const TEST_BASIN = `Basin: Sample Basin
  Unit System: Metric
End:

Subbasin: Sub1
  Area: 15.0
  Downstream: Reach1
  Loss: SCS
End:

Subbasin-Loss: Sub1
  Curve Number: 78.0
End:

Reach: Reach1
  Downstream: Outlet
  Route: Muskingum
End:

Sink: Outlet
End:
`;

test("HEC-HMS LSP & Workspace Index: generates outline symbols and indexes documents", () => {
  const symbols = getDocumentSymbols(TEST_BASIN);
  assert.equal(symbols.length, 2, "Should have 2 root categories: Subbasins, Reaches");

  const subbasinGroup = symbols.find((s) => s.name === "Subbasins")!;
  assert.ok(subbasinGroup);
  assert.equal(subbasinGroup.children?.length, 1);

  const diags = getDiagnostics(TEST_BASIN);
  assert.equal(diags.length, 0, "Clean basin should produce zero diagnostics");

  const index = new HmsWorkspaceIndex();
  index.indexDocument("file:///sample.basin", TEST_BASIN);
  const model = index.getModel("file:///sample.basin");
  assert.ok(model);
  assert.equal(model.basin.subbasins.size, 1);
});

test("HEC-HMS Language Plugin: executes language actions", async () => {
  assert.equal(hecHmsLanguage.name, "hec-hms");
  const simAction = hecHmsLanguage.actions?.find((a) => a.id === "simulate_hms_runoff");
  assert.ok(simAction);

  const result = await simAction.execute({} as any, { documentText: TEST_BASIN, precipitationMm: 50.0 });
  assert.ok(result);
  assert.ok((result as any).peakDischarge > 0, "Simulation should compute positive peak discharge");

  const exportAction = hecHmsLanguage.actions?.find((a) => a.id === "export_hms_to_hecras");
  assert.ok(exportAction);
  const u01Deck = await exportAction.execute({} as any, { documentText: TEST_BASIN });
  assert.ok(typeof u01Deck === "string");
  assert.ok(u01Deck.includes("Flow Hydrograph"));
});

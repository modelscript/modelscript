// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allBlockingIssues, visibleSteps } from "../src/components/compose/attach/engine";
import { vegaAttachProfile } from "../src/components/compose/attach/profiles/VegaProfile";
import {
  buildVegaResult,
  compileVegaSpec,
  isVegaSourceArtifact,
  openVegaDraft,
  selectVegaTable,
  validateVegaEncodings,
  type VegaAttachDraft,
} from "../src/components/compose/attach/profiles/vega-model";
import { findDeriveProfile, registerAttachProfile } from "../src/components/compose/attach/registry";
import { VEGA_LITE_TEMPLATES } from "../src/components/compose/vega-wizard-templates";

const CSV = "time,v_c1,v_c2,branch\n0.0,0.1,0.0,L1\n0.1,0.4,0.2,L1\n0.2,0.8,0.5,L2\n0.3,1.2,0.9,L2\n";

const csvView = (config: Record<string, unknown> = {}) => ({
  artifact_type: "csv",
  title: "chua_circuit.csv",
  view_config: { rawData: CSV, url: "/uploads/chua.csv", ...config },
});

async function openDraft(config: Record<string, unknown> = {}): Promise<VegaAttachDraft> {
  return (await openVegaDraft(csvView(config))).draft;
}

describe("Vega attach profile: deriving a chart from a table", () => {
  it("matches tabular artifacts (and existing charts) but not other kinds", () => {
    assert.equal(isVegaSourceArtifact(csvView()), true);
    assert.equal(isVegaSourceArtifact({ artifact_type: "json-table", view_config: { rawData: "[]" } }), true);
    assert.equal(isVegaSourceArtifact({ artifact_type: "cad-step", title: "bracket.step", view_config: {} }), false);
    assert.equal(isVegaSourceArtifact({ artifact_type: "qif", view_config: {} }), false);
  });

  it("is only reachable through derive: it never claims files and is discoverable from a table", () => {
    const undo = registerAttachProfile(vegaAttachProfile);
    try {
      assert.deepEqual(vegaAttachProfile.match.extensions, []);
      assert.equal(findDeriveProfile(csvView())?.id, "vega");
      assert.equal(findDeriveProfile({ artifact_type: "picture", view_config: {} }), undefined);
    } finally {
      undo();
    }
  });

  it("opens with smart defaults and a data summary", async () => {
    const analysis = await openVegaDraft(csvView());
    assert.deepEqual(
      analysis.chips.map((c) => c.label),
      ["CSV", "4 rows", "4 columns"],
    );
    assert.equal(analysis.issues.length, 0);
    assert.equal(analysis.draft.config.xField, "time");
    assert.equal(analysis.draft.config.yField, "v_c1");
    assert.equal(analysis.draft.config.colorField, "branch");
    assert.equal(analysis.draft.config.templateId, "line");
    assert.equal(analysis.draft.sourceUrl, "/uploads/chua.csv");
  });

  it("restores a saved wizard configuration over the inferred defaults", async () => {
    const draft = await openDraft({ wizardConfig: { templateId: "scatter", title: "Saved chart", yField: "v_c2" } });
    assert.equal(draft.config.templateId, "scatter");
    assert.equal(draft.config.title, "Saved chart");
    assert.equal(draft.config.yField, "v_c2");
    assert.equal(draft.config.xField, "time", "unspecified fields still come from inference");
  });

  it("reports an empty table as a blocking issue instead of opening a useless wizard", async () => {
    const analysis = await openVegaDraft({
      artifact_type: "csv",
      title: "empty.csv",
      view_config: { rawData: "a,b\n" },
    });
    assert.equal(analysis.issues[0]?.severity, "error");
    assert.ok(allBlockingIssues(vegaAttachProfile, analysis.draft, analysis.issues).length > 0);
  });

  it("compiles a valid Vega-Lite v5 spec for every template (parity with the old modal)", async () => {
    const draft = await openDraft();
    for (const tpl of VEGA_LITE_TEMPLATES) {
      const spec = compileVegaSpec({ ...draft, config: { ...draft.config, templateId: tpl.id } });
      assert.ok(spec, `spec for ${tpl.id}`);
      assert.equal(spec["$schema"], "https://vega.github.io/schema/vega-lite/v5.json");
    }
  });

  it("validates axis encodings; a histogram needs no Y axis", async () => {
    const draft = await openDraft();
    assert.equal(validateVegaEncodings(draft).length, 0);
    assert.equal(validateVegaEncodings({ ...draft, config: { ...draft.config, xField: "nope" } }).length, 1);
    assert.equal(validateVegaEncodings({ ...draft, config: { ...draft.config, yField: "" } }).length, 1);
    assert.equal(
      validateVegaEncodings({ ...draft, config: { ...draft.config, templateId: "histogram", yField: "" } }).length,
      0,
    );
  });

  it("shows all three steps with the encodings step gating Continue", async () => {
    const draft = await openDraft();
    const steps = visibleSteps(vegaAttachProfile, draft);
    assert.deepEqual(
      steps.map((s) => s.id),
      ["template", "encodings", "style"],
    );
    const broken = { ...draft, config: { ...draft.config, xField: "" } };
    assert.equal(allBlockingIssues(vegaAttachProfile, broken, []).length, 1);
  });

  it("builds a new vega-plot artifact with the same payload shape as before", async () => {
    const draft = await openDraft();
    const titled = { ...draft, config: { ...draft.config, title: "Chua Voltages" } };
    const built = buildVegaResult(titled);
    assert.equal(built.artifact_type, "vega-plot");
    assert.equal(built.title, "📊 Chua Voltages");
    assert.equal(built.displayTitle, "Chua Voltages");
    const cfg = built.view_config;
    assert.equal(cfg["title"], "Chua Voltages");
    assert.equal(cfg["format"], "csv");
    assert.equal(cfg["rowCount"], 4);
    assert.equal(cfg["columnCount"], 4);
    assert.deepEqual(cfg["columns"], ["time", "v_c1", "v_c2", "branch"]);
    assert.equal(cfg["sourceUrl"], "/uploads/chua.csv");
    assert.equal((cfg["data"] as unknown[]).length, 4);
    assert.equal((cfg["wizardConfig"] as { title: string }).title, "Chua Voltages");
    assert.ok(cfg["spec"]);
  });

  it("falls back to '<dataset> Visualization' for a blank title and refuses to build without data", async () => {
    const draft = await openDraft();
    assert.equal(
      buildVegaResult({ ...draft, config: { ...draft.config, title: "  " } }).displayTitle,
      "chua_circuit Visualization",
    );
    const empty: VegaAttachDraft = { ...draft, dataset: { ...draft.dataset, rows: [] } };
    assert.throws(() => buildVegaResult(empty), /can't be built/);
  });

  it("switching tables re-infers encodings for that table", async () => {
    const draft = await openDraft();
    const second = {
      id: "t2",
      name: "second",
      columns: [
        { name: "n", vegaType: "quantitative", uniqueCount: 3, isMonotonic: true },
        { name: "m", vegaType: "quantitative", uniqueCount: 3, isMonotonic: false },
      ],
      rows: [
        { n: 1, m: 5 },
        { n: 2, m: 6 },
        { n: 3, m: 7 },
      ],
    } as unknown as VegaAttachDraft["dataset"]["tables"][number];
    const multi: VegaAttachDraft = {
      ...draft,
      dataset: { ...draft.dataset, tables: [...draft.dataset.tables, second] },
    };
    const switched = selectVegaTable(multi, "t2");
    assert.equal(switched.dataset.activeTableId, "t2");
    assert.equal(switched.config.xField, "n");
    assert.equal(selectVegaTable(multi, "missing"), multi, "unknown table ids are ignored");
  });
});

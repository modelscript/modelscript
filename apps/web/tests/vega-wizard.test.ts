// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildVegaLiteSpec,
  inferInitialWizardConfig,
  VEGA_LITE_TEMPLATES,
} from "../src/components/compose/vega-wizard-templates";
import {
  isTabularDataArtifact,
  loadTabularDatasetFromArtifactView,
  parseBinaryHdf5Buffer,
  parseTabularDataInput,
} from "../src/util/tabular-data-parser";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Vega-Lite Visualization Wizard & Multi-Format Tabular Data Parser", () => {
  it("parses CSV and TSV datasets with numeric, boolean, and categorical column type inference", () => {
    const csvText = [
      "# Simulation output telemetry",
      "time,voltage,current,phase,fault_active",
      "0.0,230.0,12.5,A,false",
      "0.1,231.2,12.8,A,false",
      "0.2,185.4,45.2,B,true",
      "0.3,229.8,12.4,C,false",
    ].join("\n");

    const dataset = parseTabularDataInput(csvText, "grid_telemetry.csv");
    assert.equal(dataset.format, "csv");
    assert.equal(dataset.rows.length, 4);
    assert.equal(dataset.columns.length, 5);

    const timeCol = dataset.columns.find((c) => c.name === "time")!;
    assert.equal(timeCol.vegaType, "quantitative");
    assert.equal(timeCol.isMonotonic, true);
    assert.equal(timeCol.min, 0.0);
    assert.equal(timeCol.max, 0.3);

    const voltageCol = dataset.columns.find((c) => c.name === "voltage")!;
    assert.equal(voltageCol.vegaType, "quantitative");
    assert.equal(typeof dataset.rows[0]!.voltage, "number");

    const phaseCol = dataset.columns.find((c) => c.name === "phase")!;
    assert.equal(phaseCol.vegaType, "nominal");
    assert.equal(phaseCol.uniqueCount, 3);

    const faultCol = dataset.columns.find((c) => c.name === "fault_active")!;
    assert.equal(faultCol.dataType, "boolean");
    assert.equal(faultCol.vegaType, "nominal");
  });

  it("parses JSON (array of objects and columnar arrays), YAML, XML, multi-table HDF5, and binary HDF5 (.h5) buffers", () => {
    // 1. Columnar JSON
    const columnarJson = JSON.stringify({
      rpm: [1000, 2000, 3000, 4000],
      torque_nm: [140.5, 210.0, 245.2, 220.8],
      efficiency: [0.82, 0.89, 0.93, 0.9],
    });
    const jsonDs = parseTabularDataInput(columnarJson, "motor_map.json");
    assert.equal(jsonDs.format, "json");
    assert.equal(jsonDs.rows.length, 4);
    assert.equal(jsonDs.columns.length, 3);

    // 2. Tabular YAML
    const yamlText = [
      "- altitude_km: 0",
      "  pressure_kpa: 101.3",
      "  stage: booster",
      "- altitude_km: 10",
      "  pressure_kpa: 26.5",
      "  stage: booster",
      "- altitude_km: 50",
      "  pressure_kpa: 0.08",
      "  stage: upper",
    ].join("\n");
    const yamlDs = parseTabularDataInput(yamlText, "atmosphere.yaml");
    assert.equal(yamlDs.format, "yaml");
    assert.equal(yamlDs.rows.length, 3);
    assert.equal(yamlDs.columns.find((c) => c.name === "pressure_kpa")?.vegaType, "quantitative");

    // 3. Tabular XML
    const xmlText = [
      "<measurements>",
      '  <sample t="0.0" temp="293.15" sensor="S1" />',
      '  <sample t="1.0" temp="310.40" sensor="S1" />',
      '  <sample t="2.0" temp="325.00" sensor="S2" />',
      "</measurements>",
    ].join("\n");
    const xmlDs = parseTabularDataInput(xmlText, "thermocouples.xml");
    assert.equal(xmlDs.format, "xml");
    assert.equal(xmlDs.rows.length, 3);
    assert.equal(xmlDs.columns.find((c) => c.name === "temp")?.vegaType, "quantitative");

    // 4. Multi-group HDF5 dataset structure
    const hdf5Data = {
      rotor_dynamics: {
        time: [0, 1, 2],
        omega: [0.0, 150.0, 300.0],
      },
      bearing_loads: {
        time: [0, 1, 2],
        force_x: [12.0, 45.0, 82.0],
        force_y: [5.0, 18.0, 39.0],
      },
    };
    const h5Ds = parseTabularDataInput(hdf5Data, "turbine_run.h5", "hdf5");
    assert.equal(h5Ds.format, "hdf5");
    assert.equal(h5Ds.tables.length, 2);
    assert.equal(h5Ds.rows.length, 3);

    // 5. Binary HDF5 (.h5) buffer with 8-byte superblock magic (\x89HDF\r\n\x1a\n), local heap symbols, and IEEE-754 Float64 arrays
    const buf = new ArrayBuffer(64);
    const u8 = new Uint8Array(buf);
    u8.set([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    // Write null-terminated symbol names "time\0" and "velocity\0" at offset 8 (16 bytes total)
    const symBytes = new TextEncoder().encode("time\0velocity\0\0\0");
    u8.set(symBytes, 8);
    // Write 4 IEEE-754 float64 values (2 for time: [0.0, 1.0], 2 for velocity: [10.5, 25.0]) starting at offset 24
    const dv = new DataView(buf);
    dv.setFloat64(24, 0.0, true);
    dv.setFloat64(32, 1.0, true);
    dv.setFloat64(40, 10.5, true);
    dv.setFloat64(48, 25.0, true);
    dv.setFloat64(56, Number.NaN, true);

    const parsedBinH5 = parseBinaryHdf5Buffer(buf, "flight_telemetry.h5");
    assert.equal(parsedBinH5.format, "hdf5");
    assert.equal(parsedBinH5.rows.length, 2);
    assert.deepEqual(
      parsedBinH5.columns.map((c) => c.name),
      ["time", "velocity"],
    );
    assert.equal(parsedBinH5.rows[1]?.velocity, 25.0);
  });

  it("detects tabular data artifacts accurately via isTabularDataArtifact", () => {
    assert.equal(isTabularDataArtifact({ view_type: "csv", title: "results.csv" }), true);
    assert.equal(isTabularDataArtifact({ view_type: "dataset-table", title: "telemetry.h5" }), true);
    assert.equal(isTabularDataArtifact({ view_type: "json-table", title: "sweep.json" }), true);
    assert.equal(
      isTabularDataArtifact({
        view_type: "vega-plot",
        view_config: JSON.stringify({ spec: { mark: "line" }, data: [{ x: 1, y: 2 }] }),
      }),
      true,
    );
    assert.equal(isTabularDataArtifact({ view_type: "cad-step", title: "bracket.step" }), false);
  });

  it("infers smart initial wizard config and compiles valid Vega-Lite v5 specs for all templates", async () => {
    const viewObj = {
      view_type: "csv",
      title: "chua_circuit.csv",
      view_config: JSON.stringify({
        rawData: "time,v_c1,v_c2,branch\n0.0,0.1,0.0,L1\n0.1,0.4,0.2,L1\n0.2,0.8,0.5,L2\n0.3,1.2,0.9,L2\n",
      }),
    };

    const dataset = await loadTabularDatasetFromArtifactView(viewObj);
    const initialConfig = inferInitialWizardConfig(dataset);

    assert.equal(initialConfig.xField, "time");
    assert.equal(initialConfig.yField, "v_c1");
    assert.equal(initialConfig.y2Field, "v_c2");
    assert.equal(initialConfig.colorField, "branch");
    assert.equal(initialConfig.templateId, "line");

    for (const tpl of VEGA_LITE_TEMPLATES) {
      const spec = buildVegaLiteSpec({ ...initialConfig, templateId: tpl.id }, dataset);
      assert.equal(spec.$schema, "https://vega.github.io/schema/vega-lite/v5.json");
      assert.ok(spec.data, `Expected data property in compiled spec for template ${tpl.id}`);
    }
  });

  it("integrates quick visualization prompt banner, notebook cell button, template gallery, and table/chart toggle", () => {
    const attachedSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/components/compose/ComposeAttachedArtifact.tsx"),
      "utf-8",
    );
    assert.ok(attachedSrc.includes('data-testid="vega-quick-viz-prompt"'));
    assert.ok(attachedSrc.includes("Choose Vega-Lite Template"));
    assert.ok(attachedSrc.includes("VegaWizardModal"));

    const notebookEditorSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/components/compose/ComposeNotebookCellsEditor.tsx"),
      "utf-8",
    );
    assert.ok(notebookEditorSrc.includes("Data Visualization (Vega-Lite)"));
    assert.ok(notebookEditorSrc.includes("notebook-cell-vega-btn-"));
    assert.ok(notebookEditorSrc.includes("onReplaceArtifactCell"));

    const wizardSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/components/compose/VegaWizardModal.tsx"),
      "utf-8",
    );
    assert.ok(wizardSrc.includes('data-testid="vega-template-gallery"'));
    assert.ok(wizardSrc.includes('data-testid="vega-wizard-apply-btn"'));
    assert.ok(wizardSrc.includes("Apply Visualization to Post"));

    const vegaViewerSrc = fs.readFileSync(
      path.resolve(__dirname, "../src/components/artifacts/VegaViewer.tsx"),
      "utf-8",
    );
    assert.ok(vegaViewerSrc.includes("CsvViewer"));
    assert.ok(vegaViewerSrc.includes("hasTabularData"));
  });
});

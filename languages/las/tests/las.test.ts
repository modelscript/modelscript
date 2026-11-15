// SPDX-License-Identifier: AGPL-3.0-or-later
import { computeHistogram, computeLinearRegression, computeVariableStats } from "@modelscript/simulate/charts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { datasetToLas, lasToDataset, lasWorkspaceHooks, lintLas, parseLas, parseLasToModelica } from "../src/index.js";

const SAMPLE_LAS_2 = `~VERSION INFORMATION
 VERS.                          2.0 : CWLS LOG ASCII STANDARD - VERSION 2.0
 WRAP.                          NO  : ONE LINE PER DEPTH STEP
~WELL INFORMATION
 STRT.M                       1000.0 : START DEPTH
 STOP.M                       1001.5 : STOP DEPTH
 STEP.M                          0.5 : STEP
 NULL.                       -999.25 : NULL VALUE
 WELL.                      TEST-01  : WELL NAME
~CURVE INFORMATION
 DEPT.M                              : DEPTH
 GR  .GAPI                           : GAMMA RAY
 RHOB.G/C3                           : BULK DENSITY
 NPHI.V/V                            : NEUTRON POROSITY
~PARAMETER INFORMATION
 BHT .DEGC                      78.5 : BOTTOM HOLE TEMP
~OTHER
 Sample synthetic carbonate interval
~ASCII
 1000.0  45.0  2.40  0.18
 1000.5  55.0 -999.25 0.21
 1001.0  65.0  2.55  0.14
 1001.5  75.0  2.60  0.12
`;

const SAMPLE_LAS_WRAPPED = `~V
 VERS. 1.2 : CWLS 1.2
 WRAP. YES : WRAPPED LINES
~W
 NULL. -999.25 : NULL VALUE
~C
 DEPT.M : DEPTH
 GR.GAPI : GAMMA RAY
 RHOB.G/C3 : BULK DENSITY
~A
 2000.0
 30.0 2.45
 2000.5 40.0
 2.50
`;

const SAMPLE_LAS_3_COMMA = `~Version
 VERS. 3.0 : CWLS LAS 3.0
 WRAP. NO  : ONE LINE PER DEPTH
 DLM . COMMA : COMMA DELIMITED
~Well
 NULL. -999.25 : NULL
 WELL. CARBONATE-3 : WELL
~Curve
 DEPT.M : DEPTH
 DT.US/M : SONIC
~Core_Definition
 CDEPTH.M : CORE DEPTH
 K.MD : PERMEABILITY
~Core_Data | Core_Definition
 1000.0,12.5
 1001.0,48.0
~ASCII
 1000.0,190.5
 1001.0,210.0
`;

describe("@modelscript/las", () => {
  it("parses LAS 2.0 headers, units, null values, and converts to IndexedDataset", () => {
    const doc = parseLas(SAMPLE_LAS_2);
    assert.equal(doc.version, "2.0");
    assert.equal(doc.wrap, false);
    assert.equal(doc.nullValue, -999.25);
    assert.equal(doc.well["WELL"]?.value, "TEST-01");
    assert.equal(doc.params["BHT"]?.value, "78.5");
    assert.equal(doc.curves.length, 4);
    assert.equal(doc.rows.length, 4);
    assert.ok(Number.isNaN(doc.rows[1]![2]!));

    const ds = lasToDataset(doc);
    assert.equal(ds.sourceFormat, "las");
    assert.equal(ds.title, "TEST-01");
    assert.equal(ds.indexAxis.key, "DEPT");
    assert.equal(ds.indexAxis.unit, "M");
    assert.equal(ds.indexAxis.inverted, true);
    assert.deepEqual(ds.indexValues, [1000.0, 1000.5, 1001.0, 1001.5]);

    const stats = computeVariableStats(ds);
    const rhob = stats.find((s) => s.name === "RHOB")!;
    assert.equal(rhob.count, 3);
    assert.equal(rhob.min, 2.4);
    assert.equal(rhob.max, 2.6);

    const gr = ds.series.find((s) => s.name === "GR")!;
    const hist = computeHistogram(gr.values, { binCount: 2, nullValue: ds.indexAxis.nullValue });
    assert.equal(hist.totalCount, 4);

    const reg = computeLinearRegression(ds.indexValues, gr.values, ds.indexAxis.nullValue);
    assert.ok(reg !== null && Math.abs(reg.r2 - 1) < 1e-9);
  });

  it("parses wrapped LAS 1.2 records and LAS 3.0 comma-delimited multi-sections", () => {
    const wrapped = parseLas(SAMPLE_LAS_WRAPPED);
    assert.equal(wrapped.version, "1.2");
    assert.equal(wrapped.wrap, true);
    assert.equal(wrapped.rows.length, 2);
    assert.deepEqual(wrapped.rows[0], [2000.0, 30.0, 2.45]);
    assert.deepEqual(wrapped.rows[1], [2000.5, 40.0, 2.5]);

    const las3 = parseLas(SAMPLE_LAS_3_COMMA);
    assert.equal(las3.version, "3.0");
    assert.equal(las3.delimiter, ",");
    assert.equal(las3.rows.length, 2);
    assert.deepEqual(las3.rows[0], [1000.0, 190.5]);
    assert.deepEqual(las3.rows[1], [1001.0, 210.0]);
    assert.equal(las3.sections["Core"]?.curves.length, 2);
    assert.deepEqual(las3.sections["Core"]?.rows[1], [1001.0, 48.0]);
  });

  it("round-trips IndexedDataset via datasetToLas and generates Modelica packages", () => {
    const ds = lasToDataset(parseLas(SAMPLE_LAS_2));
    const serialized = datasetToLas(ds, { version: "2.0" });
    const reparsed = parseLas(serialized);
    assert.equal(reparsed.curves.length, 4);
    assert.equal(reparsed.rows.length, 4);
    assert.ok(Number.isNaN(reparsed.rows[1]![2]!));

    const mo = parseLasToModelica(SAMPLE_LAS_2, "CarbonateWell");
    assert.ok(mo.includes("package CarbonateWell"));
    assert.ok(mo.includes('constant Real GR(unit = "GAPI")[4]'));
    assert.ok(mo.includes("end CarbonateWell;"));
  });

  it("lints LAS structural, duplicate curve, numeric, and monotonicity diagnostics", () => {
    assert.equal(lintLas(SAMPLE_LAS_2).length, 0);

    const broken = `~W
 WELL. BAD
~C
 DEPT.M : DEPTH
 GR.GAPI : GAMMA
 GR.GAPI : DUPLICATE GAMMA
~A
 100.0 45.0 50.0
 100.0 bad_num
 99.0 40.0 41.0
`;
    const diags = lintLas(broken);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("LAS1001"), "missing ~V");
    assert.ok(codes.has("LAS1006"), "duplicate curve");
    assert.ok(codes.has("LAS1004"), "column count mismatch");
    assert.ok(codes.has("LAS1005"), "invalid numeric");
    assert.ok(codes.has("LAS1007"), "non-monotonic depth");
  });

  it("indexes virtual curve components via lasWorkspaceHooks", () => {
    const sym = lasWorkspaceHooks.indexResource!("file:///wells/TestWell.las", { text: SAMPLE_LAS_2 });
    assert.ok(sym);
    assert.equal(sym.name, "TestWell");
    const names = (sym.children ?? []).map((c) => c.name);
    assert.ok(names.includes("numRows"));
    assert.ok(names.includes("DEPT"));
    assert.ok(names.includes("GR"));
  });
});

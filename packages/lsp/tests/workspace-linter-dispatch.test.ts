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

test("XML WASM CST workspace linters detect and resolve cross-file references", async () => {
  const cases: Array<{
    lang: string;
    missingDocs: Record<string, string>;
    root: string;
    expectedCode: string;
    resolvedDocs: Record<string, string>;
  }> = [
    {
      lang: "cgmes",
      root: "eq.xml",
      expectedCode: "C1011",
      missingDocs: {
        "eq.xml":
          '<rdf:RDF><cim:Terminal rdf:ID="T1"><cim:Terminal.ConnectivityNode rdf:resource="#CN_MISSING"/></cim:Terminal></rdf:RDF>',
      },
      resolvedDocs: {
        "eq.xml":
          '<rdf:RDF><cim:Terminal rdf:ID="T1"><cim:Terminal.ConnectivityNode rdf:resource="#CN1"/></cim:Terminal></rdf:RDF>',
        "tp.xml": '<rdf:RDF><cim:ConnectivityNode rdf:ID="CN1"/></rdf:RDF>',
      },
    },
    {
      lang: "scl",
      root: "sub.scd",
      expectedCode: "SC3002",
      missingDocs: {
        "sub.scd":
          '<SCL><IED name="IED1"><AccessPoint><Server><LDevice><LN><Inputs><ExtRef iedName="IED_MISSING"/></Inputs></LN></LDevice></Server></AccessPoint></IED></SCL>',
      },
      resolvedDocs: {
        "sub.scd":
          '<SCL><IED name="IED1"><AccessPoint><Server><LDevice><LN><Inputs><ExtRef iedName="IED2"/></Inputs></LN></LDevice></Server></AccessPoint></IED></SCL>',
        "ied2.icd": '<SCL><IED name="IED2"/></SCL>',
      },
    },
    {
      lang: "cellml",
      root: "main.cellml",
      expectedCode: "CM3001",
      missingDocs: {
        "main.cellml": '<model name="main"><import xlink:href="missing.cellml"/></model>',
      },
      resolvedDocs: {
        "main.cellml": '<model name="main"><import xlink:href="sub.cellml"/></model>',
        "sub.cellml": '<model name="sub"/>',
      },
    },
    {
      lang: "sedml",
      root: "exp.sedml",
      expectedCode: "SD3001",
      missingDocs: {
        "exp.sedml":
          '<sedML level="1" version="4"><listOfModels><model id="m1" source="missing.xml"/></listOfModels></sedML>',
      },
      resolvedDocs: {
        "exp.sedml":
          '<sedML level="1" version="4"><listOfModels><model id="m1" source="model.xml"/></listOfModels></sedML>',
        "model.xml": "<sbml/>",
      },
    },
    {
      lang: "sbol",
      root: "a.sbol",
      expectedCode: "SB3001",
      missingDocs: {
        "a.sbol":
          '<rdf:RDF><sbol:Component rdf:about="https://ex.org/c"><sbol:hasFeature rdf:resource="https://ex.org/missing"/></sbol:Component></rdf:RDF>',
      },
      resolvedDocs: {
        "a.sbol":
          '<rdf:RDF><sbol:Component rdf:about="https://ex.org/c"><sbol:hasFeature rdf:resource="https://ex.org/f1"/></sbol:Component></rdf:RDF>',
        "b.sbol": '<rdf:RDF><sbol:Feature rdf:about="https://ex.org/f1"/></rdf:RDF>',
      },
    },
    {
      lang: "urdf",
      root: "robot.xacro",
      expectedCode: "UR3001",
      missingDocs: {
        "robot.xacro": '<robot name="r"><xacro:include filename="missing.xacro"/></robot>',
      },
      resolvedDocs: {
        "robot.xacro": '<robot name="r"><xacro:include filename="arm.xacro"/></robot>',
        "arm.xacro": '<robot name="arm"/>',
      },
    },
    {
      lang: "plcopen",
      root: "main.xml",
      expectedCode: "PO3001",
      missingDocs: {
        "main.xml":
          '<project><types><pous><pou name="Main"><interface><localVars><variable name="fb"><type><derived name="MissingFB"/></type></variable></localVars></interface></pou></pous></types></project>',
      },
      resolvedDocs: {
        "main.xml":
          '<project><types><pous><pou name="Main"><interface><localVars><variable name="fb"><type><derived name="MyFB"/></type></variable></localVars></interface></pou></pous></types></project>',
        "lib.xml": '<project><types><pous><pou name="MyFB"/></pous></types></project>',
      },
    },
    {
      lang: "automationml",
      root: "plant.aml",
      expectedCode: "AM3001",
      missingDocs: {
        "plant.aml":
          '<CAEXFile FileName="plant.aml"><ExternalReference Path="missing_lib.aml" Alias="Lib"/></CAEXFile>',
      },
      resolvedDocs: {
        "plant.aml": '<CAEXFile FileName="plant.aml"><ExternalReference Path="lib.aml" Alias="Lib"/></CAEXFile>',
        "lib.aml": '<CAEXFile FileName="lib.aml"/>',
      },
    },
    {
      lang: "autosar",
      root: "app.arxml",
      expectedCode: "AU3001",
      missingDocs: {
        "app.arxml":
          '<AUTOSAR><AR-PACKAGE><SHORT-NAME>App</SHORT-NAME><ELEMENTS><SWC><TYPE-TREF DEST="APPLICATION-SW-COMPONENT-TYPE">/Pkg/MissingType</TYPE-TREF></SWC></ELEMENTS></AR-PACKAGE></AUTOSAR>',
      },
      resolvedDocs: {
        "app.arxml":
          '<AUTOSAR><AR-PACKAGE><SHORT-NAME>App</SHORT-NAME><ELEMENTS><SWC><TYPE-TREF DEST="APPLICATION-SW-COMPONENT-TYPE">/Pkg/MyType</TYPE-TREF></SWC></ELEMENTS></AR-PACKAGE></AUTOSAR>',
        "types.arxml":
          "<AUTOSAR><AR-PACKAGE><SHORT-NAME>Pkg</SHORT-NAME><ELEMENTS><APPLICATION-SW-COMPONENT-TYPE><SHORT-NAME>MyType</SHORT-NAME></APPLICATION-SW-COMPONENT-TYPE></ELEMENTS></AR-PACKAGE></AUTOSAR>",
      },
    },
  ];

  for (const c of cases) {
    const missingDiags: Diagnostic[] = [];
    await runWorkspaceLinterForDocument(c.lang, c.missingDocs, c.root, missingDiags);
    assert.equal(
      missingDiags.some((d) => d.code === c.expectedCode),
      true,
      `Expected ${c.expectedCode} for ${c.lang} missing case, got: ${JSON.stringify(missingDiags)}`,
    );

    const resolvedDiags: Diagnostic[] = [];
    await runWorkspaceLinterForDocument(c.lang, c.resolvedDocs, c.root, resolvedDiags);
    assert.equal(
      resolvedDiags.some((d) => d.code === c.expectedCode),
      false,
      `Did not expect ${c.expectedCode} for ${c.lang} resolved case, got: ${JSON.stringify(resolvedDiags)}`,
    );
  }
});

test("WASM CST workspace linters detect and resolve cross-file references across non-XML formats", async () => {
  const cases: Array<{
    lang: string;
    missingDocs: Record<string, string>;
    root: string;
    expectedCode: string;
    resolvedDocs: Record<string, string>;
  }> = [
    {
      lang: "spice",
      root: "main.cir",
      expectedCode: "SP3001",
      missingDocs: { "main.cir": '.include "models.lib"\nR1 1 0 1k\n.end\n' },
      resolvedDocs: { "main.cir": '.include "models.lib"\nR1 1 0 1k\n.end\n', "models.lib": "* lib\n" },
    },
    {
      lang: "atp",
      root: "main.atp",
      expectedCode: "AT3001",
      missingDocs: { "main.atp": '$INCLUDE, "branch.atp"\nC comment\n' },
      resolvedDocs: { "main.atp": '$INCLUDE, "branch.atp"\nC comment\n', "branch.atp": "C branch\n" },
    },
    {
      lang: "eclipse",
      root: "CASE.DATA",
      expectedCode: "EC3001",
      missingDocs: { "CASE.DATA": "RUNSPEC\nINCLUDE\n  'grid.inc' /\n" },
      resolvedDocs: { "CASE.DATA": "RUNSPEC\nINCLUDE\n  'grid.inc' /\n", "grid.inc": "DIMENS\n  1 1 1 /\n" },
    },
    {
      lang: "modflow",
      root: "mfsim.nam",
      expectedCode: "MF3001",
      missingDocs: { "mfsim.nam": "BEGIN PACKAGES\n  DIS6 11 model.dis\nEND PACKAGES\n" },
      resolvedDocs: {
        "mfsim.nam": "BEGIN PACKAGES\n  DIS6 11 model.dis\nEND PACKAGES\n",
        "model.dis": "BEGIN OPTIONS\nEND OPTIONS\n",
      },
    },
    {
      lang: "ampl",
      root: "solve.run",
      expectedCode: "AMPL3002",
      missingDocs: { "solve.run": 'model "model.mod";\n' },
      resolvedDocs: { "solve.run": 'model "model.mod";\n', "model.mod": "var x >= 0;\n" },
    },
    {
      lang: "fortran",
      root: "main.f90",
      expectedCode: "F3002",
      missingDocs: { "main.f90": "program main\nuse missing_mod\nend program\n" },
      resolvedDocs: {
        "main.f90": "program main\nuse helper_mod\nend program\n",
        "helper.f90": "module helper_mod\nend module\n",
      },
    },
    {
      lang: "scad",
      root: "main.scad",
      expectedCode: "SCAD3001",
      missingDocs: { "main.scad": "include <lib.scad>\ncube(1);\n" },
      resolvedDocs: { "main.scad": "include <lib.scad>\ncube(1);\n", "lib.scad": "module m() {}\n" },
    },
    {
      lang: "energyplus",
      root: "in.idf",
      expectedCode: "EP3001",
      missingDocs: { "in.idf": "Schedule:File, Sched1, Any, weather.csv, 1;\n" },
      resolvedDocs: { "in.idf": "Schedule:File, Sched1, Any, weather.csv, 1;\n", "weather.csv": "a,b\n1,2\n" },
    },
    {
      lang: "c",
      root: "main.c",
      expectedCode: "C3001",
      missingDocs: { "main.c": '#include "defs.h"\nint main() { return 0; }\n' },
      resolvedDocs: { "main.c": '#include "defs.h"\nint main() { return 0; }\n', "defs.h": "#define X 1\n" },
    },
    {
      lang: "verilog-a",
      root: "res.va",
      expectedCode: "VA3001",
      missingDocs: { "res.va": '`include "custom.vams"\nmodule r(p,n); endmodule\n' },
      resolvedDocs: { "res.va": '`include "custom.vams"\nmodule r(p,n); endmodule\n', "custom.vams": "// hdr\n" },
    },
    {
      lang: "hec-ras",
      root: "proj.prj",
      expectedCode: "HR3001",
      missingDocs: { "proj.prj": "Geom File=g01\n" },
      resolvedDocs: { "proj.prj": "Geom File=g01\n", "proj.g01": "Geom Title=G1\n" },
    },
    {
      lang: "opendss",
      root: "main.dss",
      expectedCode: "D3001",
      missingDocs: { "main.dss": 'Redirect "lines.dss"\nClear\n' },
      resolvedDocs: { "main.dss": 'Redirect "lines.dss"\nClear\n', "lines.dss": "! lines\n" },
    },
    {
      lang: "topas",
      root: "main.txt",
      expectedCode: "TP3001",
      missingDocs: { "main.txt": 'includeFile = "world.txt"\ni:Ts/NumberOfThreads = 1\n' },
      resolvedDocs: {
        "main.txt": 'includeFile = "world.txt"\ni:Ts/NumberOfThreads = 1\n',
        "world.txt": "i:Ge/World/B = 1\n",
      },
    },
    {
      lang: "usd",
      root: "root.usda",
      expectedCode: "US3001",
      missingDocs: { "root.usda": "#usda 1.0\n(\n  subLayers = [@layer.usda@]\n)\n" },
      resolvedDocs: { "root.usda": "#usda 1.0\n(\n  subLayers = [@layer.usda@]\n)\n", "layer.usda": "#usda 1.0\n" },
    },
    {
      lang: "pscad",
      root: "case.pscx",
      expectedCode: "M6020",
      missingDocs: { "case.pscx": '<project name="c"><SourceFile path="helper.f90"/></project>' },
      resolvedDocs: {
        "case.pscx": '<project name="c"><SourceFile path="helper.f90"/></project>',
        "helper.f90": "! f\n",
      },
    },
    {
      lang: "simulink",
      root: "top.xml",
      expectedCode: "SL3002",
      missingDocs: { "top.xml": '<Model><P Name="DataDictionary">params.sldd</P></Model>' },
      resolvedDocs: { "top.xml": '<Model><P Name="DataDictionary">params.sldd</P></Model>', "params.sldd": "" },
    },
    {
      lang: "ssp",
      root: "SystemStructure.ssd",
      expectedCode: "SSP3001",
      missingDocs: {
        "SystemStructure.ssd":
          '<ssd:SystemStructureDescription version="1.0" name="S"><ssd:System name="Sys"><ssd:Elements><ssd:Component name="c1" source="sub.fmu"/></ssd:Elements></ssd:System></ssd:SystemStructureDescription>',
      },
      resolvedDocs: {
        "SystemStructure.ssd":
          '<ssd:SystemStructureDescription version="1.0" name="S"><ssd:System name="Sys"><ssd:Elements><ssd:Component name="c1" source="sub.fmu"/></ssd:Elements></ssd:System></ssd:SystemStructureDescription>',
        "sub.fmu": "",
      },
    },
    {
      lang: "oscal",
      root: "profile.json",
      expectedCode: "O3001",
      missingDocs: { "profile.json": '{"profile":{"imports":[{"href":"catalog.json"}]}}' },
      resolvedDocs: {
        "profile.json": '{"profile":{"imports":[{"href":"catalog.json"}]}}',
        "catalog.json": '{"catalog":{"uuid":"1"}}',
      },
    },
  ];

  for (const c of cases) {
    const missingDiags: Diagnostic[] = [];
    await runWorkspaceLinterForDocument(c.lang, c.missingDocs, c.root, missingDiags);
    assert.equal(
      missingDiags.some((d) => d.code === c.expectedCode),
      true,
      `Expected ${c.expectedCode} for ${c.lang} missing case, got: ${JSON.stringify(missingDiags)}`,
    );

    const resolvedDiags: Diagnostic[] = [];
    await runWorkspaceLinterForDocument(c.lang, c.resolvedDocs, c.root, resolvedDiags);
    assert.equal(
      resolvedDiags.some((d) => d.code === c.expectedCode),
      false,
      `Did not expect ${c.expectedCode} for ${c.lang} resolved case, got: ${JSON.stringify(resolvedDiags)}`,
    );
  }
});

test("runWorkspaceLinterForDocument preserves full attribute value range for SSP3001", async () => {
  const ssd = `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription" name="DriveSystem" version="1.0">
  <ssd:System name="Root">
    <ssd:Elements>
      <ssd:Component name="Controller" source="resources/Controller.fmu" />
      <ssd:Component name="Plant" source="resources/Plant.fmu" />
    </ssd:Elements>
  </ssd:System>
</ssd:SystemStructureDescription>
`;
  const diags: Diagnostic[] = [];
  await runWorkspaceLinterForDocument("ssp", { "file:///document.ssd": ssd }, "file:///document.ssd", diags);
  const sspDiags = diags.filter((d) => d.code === "SSP3001");
  assert.equal(sspDiags.length, 2);

  const lines = ssd.split("\n");
  for (const [idx, expectedVal] of ["resources/Controller.fmu", "resources/Plant.fmu"].entries()) {
    const d = sspDiags[idx]!;
    assert.equal(d.range.start.line, 4 + idx);
    assert.equal(d.range.end.line, 4 + idx);
    const slice = lines[d.range.start.line]!.slice(d.range.start.character, d.range.end.character);
    assert.equal(slice, expectedVal);
  }
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { ValidationService } from "../src/services/validation-service.js";

function createTestValidationService() {
  const diagnosticsByUri = new Map<string, any[]>();

  const mockConnection: any = {
    console: {
      info: () => {},
      warn: () => {},
      error: () => {},
      log: () => {},
    },
    sendDiagnostics: (params: { uri: string; diagnostics: any[] }) => {
      diagnosticsByUri.set(params.uri, params.diagnostics);
    },
    sendNotification: () => {},
  };

  const docManager: any = {
    documents: {
      get: () => null,
      all: () => [],
      keys: () => [],
    },
    documentTrees: new Map(),
    lazyLibTrees: new Map(),
  };

  const wsManager: any = {
    stepWorkspaceIndex: {
      parseStepFile: async () => ({}),
    },
    unifiedWorkspace: {
      toUnifiedPartial: () => ({
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      }),
    },
    getWorkspaceIndex: () => null,
  };

  const parserService: any = {
    getParser: () => null,
  };

  const service = new ValidationService(mockConnection, docManager, wsManager, parserService);
  return { service, diagnosticsByUri };
}

function sliceRange(doc: TextDocument, range: any): string {
  return doc.getText(range);
}

describe("Polyglot End-to-End LSP Narrow Diagnostic Ranges", () => {
  it("OpenSCAD (.scad): underlines only the offending identifier, vector element, or method name", async () => {
    const { service, diagnosticsByUri } = createTestValidationService();
    const scadSource = `x = missing_var + 5;
cube([10, -5, 20]).bad_method(1);
`;
    const uri = "file:///test/part.scad";
    const doc = TextDocument.create(uri, "scad", 1, scadSource);
    await service.validateTextDocument(doc);

    const diags = diagnosticsByUri.get(uri) ?? [];
    const undefVar = diags.find((d) => d.code === "SCAD_UNDEFINED_VARIABLE");
    assert.ok(undefVar, "Expected SCAD_UNDEFINED_VARIABLE");
    assert.strictEqual(sliceRange(doc, undefVar.range), "missing_var");

    const badDim = diags.find((d) => d.code === "SCAD_INVALID_DIMENSION");
    assert.ok(badDim, "Expected SCAD_INVALID_DIMENSION");
    assert.strictEqual(sliceRange(doc, badDim.range), "-5");

    const badMethod = diags.find((d) => d.code === "SCAD_UNKNOWN_METHOD");
    assert.ok(badMethod, "Expected SCAD_UNKNOWN_METHOD");
    assert.strictEqual(sliceRange(doc, badMethod.range), "bad_method");
  });

  it("SSP (.ssd): underlines only the offending XML attribute values in connections and experiment bounds", async () => {
    const { service, diagnosticsByUri } = createTestValidationService();
    const ssdSource = `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription name="Sys" version="1.0">
  <ssd:System name="Sys">
    <ssd:Elements>
      <ssd:Component name="Ctrl" source="resources/Ctrl.fmu">
        <ssd:Connectors>
          <ssd:Connector name="u" kind="output"><ssc:Real /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="Plant" source="resources/Plant.fmu">
        <ssd:Connectors>
          <ssd:Connector name="flag" kind="input"><ssc:Boolean /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
    </ssd:Elements>
    <ssd:Connections>
      <ssd:Connection startElement="MissingComp" startConnector="u" endElement="Plant" endConnector="flag" />
      <ssd:Connection startElement="Ctrl" startConnector="missingPort" endElement="Plant" endConnector="flag" />
      <ssd:Connection startElement="Ctrl" startConnector="u" endElement="Plant" endConnector="flag" />
    </ssd:Connections>
  </ssd:System>
  <ssd:DefaultExperiment startTime="20.0" stopTime="10.0" />
</ssd:SystemStructureDescription>`;

    const uri = "file:///test/SystemStructure.ssd";
    const doc = TextDocument.create(uri, "ssp", 1, ssdSource);
    await service.validateTextDocument(doc);

    const diags = diagnosticsByUri.get(uri) ?? [];
    const unresolvedEl = diags.find((d) => d.code === "SSP_UNRESOLVED_ELEMENT");
    assert.ok(unresolvedEl, "Expected SSP_UNRESOLVED_ELEMENT");
    assert.strictEqual(sliceRange(doc, unresolvedEl.range), "MissingComp");

    const unresolvedConn = diags.find((d) => d.code === "SSP_UNRESOLVED_CONNECTOR");
    assert.ok(unresolvedConn, "Expected SSP_UNRESOLVED_CONNECTOR");
    assert.strictEqual(sliceRange(doc, unresolvedConn.range), "missingPort");

    const typeMismatch = diags.find((d) => d.code === "SSP_CONNECTOR_TYPE_MISMATCH");
    assert.ok(typeMismatch, "Expected SSP_CONNECTOR_TYPE_MISMATCH");
    assert.strictEqual(sliceRange(doc, typeMismatch.range), "flag");

    const expBounds = diags.find((d) => d.code === "SSP_INVALID_EXPERIMENT_BOUNDS");
    assert.ok(expBounds, "Expected SSP_INVALID_EXPERIMENT_BOUNDS");
    assert.strictEqual(sliceRange(doc, expBounds.range), "10.0");
  });

  it("SSV (.ssv): underlines only duplicate parameter names and invalid typed values", async () => {
    const { service, diagnosticsByUri } = createTestValidationService();
    const ssvSource = `<?xml version="1.0" encoding="UTF-8"?>
<ssv:ParameterSet version="1.0" name="Params">
  <ssv:Parameters>
    <ssv:Parameter name="kp"><ssv:Real value="1.0" /></ssv:Parameter>
    <ssv:Parameter name="kp"><ssv:Real value="bad_float" /></ssv:Parameter>
    <ssv:Parameter name="enabled"><ssv:Boolean value="invalid_bool" /></ssv:Parameter>
  </ssv:Parameters>
</ssv:ParameterSet>`;

    const uri = "file:///test/params.ssv";
    const doc = TextDocument.create(uri, "ssv", 1, ssvSource);
    await service.validateTextDocument(doc);

    const diags = diagnosticsByUri.get(uri) ?? [];
    const dupParam = diags.find((d) => d.code === "SSV_DUPLICATE_PARAMETER");
    assert.ok(dupParam, "Expected SSV_DUPLICATE_PARAMETER");
    assert.strictEqual(sliceRange(doc, dupParam.range), "kp");

    const badReal = diags.find((d) => d.code === "SSV_INVALID_REAL_VALUE");
    assert.ok(badReal, "Expected SSV_INVALID_REAL_VALUE");
    assert.strictEqual(sliceRange(doc, badReal.range), "bad_float");

    const badBool = diags.find((d) => d.code === "SSV_INVALID_BOOLEAN_VALUE");
    assert.ok(badBool, "Expected SSV_INVALID_BOOLEAN_VALUE");
    assert.strictEqual(sliceRange(doc, badBool.range), "invalid_bool");
  });

  it("CSV (.csv): underlines only duplicate header cells, excess columns, and invalid numeric cells", async () => {
    const { service, diagnosticsByUri } = createTestValidationService();
    const csvSource = `time,temp,temp\n0.0,20.0,20.0\n1.0,not_num,21.0,overflow_cell\n`;
    const uri = "file:///test/telemetry.csv";
    const doc = TextDocument.create(uri, "csv", 1, csvSource);
    await service.validateTextDocument(doc);

    const diags = diagnosticsByUri.get(uri) ?? [];
    const dupHeader = diags.find((d) => d.code === "CSV_DUPLICATE_HEADER");
    assert.ok(dupHeader, "Expected CSV_DUPLICATE_HEADER");
    assert.strictEqual(sliceRange(doc, dupHeader.range), "temp");

    const colMismatch = diags.find((d) => d.code === "CSV_COLUMN_COUNT_MISMATCH");
    assert.ok(colMismatch, "Expected CSV_COLUMN_COUNT_MISMATCH");
    assert.strictEqual(sliceRange(doc, colMismatch.range), "overflow_cell");

    const badNum = diags.find((d) => d.code === "CSV_INVALID_NUMERIC_CELL");
    assert.ok(badNum, "Expected CSV_INVALID_NUMERIC_CELL");
    assert.strictEqual(sliceRange(doc, badNum.range), "not_num");
  });

  it("STEP (.step): underlines only the entity type token or unresolved entity reference", async () => {
    const { service, diagnosticsByUri } = createTestValidationService();
    const stepSource = `ISO-10303-21;
HEADER;
ENDSEC;
DATA;
#10 = CARTESIAN_POINT('pt');
#20 = UNKNOWN_STEP_ENTITY(#999);
ENDSEC;
END-ISO-10303-21;
`;
    const uri = "file:///test/part.step";
    const doc = TextDocument.create(uri, "step", 1, stepSource);
    await service.validateTextDocument(doc);

    const diags = diagnosticsByUri.get(uri) ?? [];
    const undefRef = diags.find((d) => d.message.includes("#999"));
    assert.ok(undefRef, "Expected undefined entity reference #999");
    assert.strictEqual(sliceRange(doc, undefRef.range), "#999");

    const schemaViolation = diags.find((d) => d.message.includes("Schema violation for CARTESIAN_POINT"));
    assert.ok(schemaViolation, "Expected schema violation for CARTESIAN_POINT");
    assert.strictEqual(sliceRange(doc, schemaViolation.range), "CARTESIAN_POINT");

    const unknownType = diags.find((d) => d.message.includes("Undefined STEP entity type"));
    assert.ok(unknownType, "Expected undefined STEP entity type");
    assert.strictEqual(sliceRange(doc, unknownType.range), "UNKNOWN_STEP_ENTITY");
  });

  it("PSCAD (.pscx): underlines only the offending bus name and parameter name", async () => {
    const { service, diagnosticsByUri } = createTestValidationService();
    const pscxSource = `<?xml version="1.0" encoding="UTF-8"?>
<project name="Grid" version="5.0.0">
  <definitions>
    <definition name="Main" type="module">
      <schematic>
        <Bus name="FloatingBus" id="B_Float" x="800" y="100" length="40" vbase="69.0" />
        <User classid="UserCmp" defn="master:resistor" id="R1" x="100" y="100">
          <paramlist>
            <param name="R" value="-5.0" />
          </paramlist>
        </User>
      </schematic>
    </definition>
  </definitions>
</project>`;
    const uri = "file:///test/grid.pscx";
    const doc = TextDocument.create(uri, "pscad", 1, pscxSource);
    await service.validateTextDocument(doc);

    const diags = diagnosticsByUri.get(uri) ?? [];
    const floatingDiag = diags.find((d) => d.code === "M6001");
    assert.ok(floatingDiag, "Expected M6001 floating bus diagnostic");
    assert.strictEqual(floatingDiag.range.start.line, 5);
    assert.strictEqual(sliceRange(doc, floatingDiag.range), "FloatingBus");

    const paramDiag = diags.find((d) => d.code === "M6003");
    assert.ok(paramDiag, "Expected M6003 invalid parameter diagnostic");
    assert.strictEqual(paramDiag.range.start.line, 8);
    assert.strictEqual(sliceRange(doc, paramDiag.range), "R");
  });

  it("Fortran (.f90): validates undeclared variables and reports diagnostic ranges", async () => {
    const { service, diagnosticsByUri } = createTestValidationService();
    const fortranSource = `SUBROUTINE compute()
  IMPLICIT NONE
  X = 10.0
END SUBROUTINE
`;
    const uri = "file:///test/compute.f90";
    const doc = TextDocument.create(uri, "fortran", 1, fortranSource);
    await service.validateTextDocument(doc);

    const diags = diagnosticsByUri.get(uri) ?? [];
    const undeclaredDiag = diags.find((d) => d.code === "M4070");
    assert.ok(undeclaredDiag, "Expected M4070 undeclared variable diagnostic");
    assert.strictEqual(undeclaredDiag.range.start.line, 2);
    assert.strictEqual(undeclaredDiag.source, "fortran");
  });

  it("EASY5 (.ez5): validates algebraic loops, disconnected ports, and reports diagnostics", async () => {
    const { service, diagnosticsByUri } = createTestValidationService();
    const ez5Source = `MODEL: DirectLoop
COMPONENTS:
  GA01 TYPE=GP/GA
    XP: K=2.0
  SJ01 TYPE=GP/SJ
    XP: SGN1=1.0, SGN2=1.0

CONNECTIONS:
  GA01.OUT -> SJ01.IN1
  SJ01.OUT -> GA01.IN
`;
    const uri = "file:///test/model.ez5";
    const doc = TextDocument.create(uri, "easy5", 1, ez5Source);
    await service.validateTextDocument(doc);

    const diags = diagnosticsByUri.get(uri) ?? [];
    const loopDiag = diags.find((d) => d.code === "M7002");
    assert.ok(loopDiag, "Expected M7002 direct algebraic loop diagnostic");
    assert.strictEqual(loopDiag.source, "easy5");
  });

  it("ROCETS (.roc): validates propulsion decks, valve schedules, and reports diagnostics", async () => {
    const { service, diagnosticsByUri } = createTestValidationService();
    const rocSource = `DECK: TestDeck
COMPONENTS:
  VALV01 TYPE=VALVE
    PARAMS: CV=0.005, POSITION=1.8
`;
    const uri = "file:///test/engine.roc";
    const doc = TextDocument.create(uri, "rocets", 1, rocSource);
    await service.validateTextDocument(doc);

    const diags = diagnosticsByUri.get(uri) ?? [];
    const valveDiag = diags.find((d) => d.code === "M8008");
    assert.ok(valveDiag, "Expected M8008 invalid valve schedule diagnostic");
    assert.strictEqual(valveDiag.source, "rocets");
  });
});

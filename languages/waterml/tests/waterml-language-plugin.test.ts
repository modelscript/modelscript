// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { watermlLanguage } from "../src/language.js";
import { getWaterMlDiagnostics, getWaterMlDocumentSymbols } from "../src/lsp.js";
import { WaterMlWorkspaceIndex } from "../src/workspace-index.js";

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<wml2:Collection xmlns:wml2="http://www.opengis.net/waterml/2.0"
                 xmlns:gml="http://www.opengis.net/gml/3.2"
                 xmlns:om="http://www.opengis.net/om/2.0"
                 xmlns:xlink="http://www.w3.org/1999/xlink"
                 gml:id="COLLECTION_TEST_01">
  <wml2:observationMember>
    <om:OM_Observation gml:id="OBS_01">
      <om:observedProperty xlink:title="Discharge"/>
      <om:featureOfInterest>
        <wml2:MonitoringPoint gml:id="MP_01">
          <gml:identifier>GAGE_01</gml:identifier>
          <gml:name>Gage Station 1</gml:name>
        </wml2:MonitoringPoint>
      </om:featureOfInterest>
      <om:result>
        <wml2:MeasurementTimeseries gml:id="TS_01">
          <wml2:defaultPointMetadata>
            <wml2:DefaultTVPMeasurementMetadata>
              <wml2:uom code="m3/s"/>
              <wml2:interpolationType xlink:title="Instantaneous"/>
            </wml2:DefaultTVPMeasurementMetadata>
          </wml2:defaultPointMetadata>
          <wml2:point>
            <wml2:MeasurementTVP>
              <wml2:time>2026-05-01T00:00:00Z</wml2:time>
              <wml2:value>45.0</wml2:value>
            </wml2:MeasurementTVP>
          </wml2:point>
        </wml2:MeasurementTimeseries>
      </om:result>
    </om:OM_Observation>
  </wml2:observationMember>
</wml2:Collection>`;

describe("WaterML Language Plugin & LSP Services", () => {
  it("indexes WaterML documents in workspace index", () => {
    const index = new WaterMlWorkspaceIndex();
    index.indexDocument("file:///test/gage.xml", SAMPLE_XML);

    const model = index.getModel("file:///test/gage.xml");
    assert.ok(model !== undefined);
    assert.equal(model?.docId, "COLLECTION_TEST_01");
    assert.ok(model?.stationIds.includes("GAGE_01"));
    assert.ok(model?.observedProperties.includes("Discharge"));
    assert.equal(model?.timeSeriesCount, 1);

    assert.equal(index.getAllModels().length, 1);
    index.clear();
    assert.equal(index.getAllModels().length, 0);
  });

  it("extracts hierarchical LSP document symbols", () => {
    const symbols = getWaterMlDocumentSymbols(SAMPLE_XML);
    assert.equal(symbols.length, 1);
    const root = symbols[0]!;
    assert.equal(root.name, "COLLECTION_TEST_01");
    assert.ok(root.children !== undefined);
    assert.ok(root.children!.length >= 1);
  });

  it("generates LSP diagnostics", () => {
    const diagnostics = getWaterMlDiagnostics(SAMPLE_XML);
    assert.equal(diagnostics.filter((d) => d.severity === 1).length, 0);
  });

  it("executes language actions (fit rating, DAE lowering, HEC-RAS projection)", async () => {
    const actions = watermlLanguage.actions;
    assert.ok(actions.length >= 4);

    const daeAction = actions.find((a) => a.id === "lower_waterml_dae");
    assert.ok(daeAction !== undefined);
    const daeResult = (await daeAction!.execute({} as any, { documentText: SAMPLE_XML })) as {
      variableCount: number;
      equationCount: number;
    };
    assert.ok(daeResult.variableCount > 0);
    assert.ok(daeResult.equationCount > 0);

    const hecRasAction = actions.find((a) => a.id === "project_waterml_hecras");
    assert.ok(hecRasAction !== undefined);
    const hecRasResult = await hecRasAction!.execute({} as any, { documentText: SAMPLE_XML });
    assert.equal(typeof hecRasResult, "string");
    assert.ok((hecRasResult as string).includes("Flow Hydrograph"));

    const fitAction = actions.find((a) => a.id === "fit_waterml_rating_curve");
    assert.ok(fitAction !== undefined);
    const fitResult = (await fitAction!.execute({} as any, {
      pairs: [
        { stageM: 1.0, dischargeM3S: 10 },
        { stageM: 2.0, dischargeM3S: 40 },
        { stageM: 3.0, dischargeM3S: 90 },
      ],
    })) as any;
    assert.equal(fitResult.converged, true);
    assert.ok(fitResult.equation.a > 0);
  });
});

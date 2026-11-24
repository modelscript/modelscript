// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseEmx, parseEmxz, parseSidops, parseTwentySim } from "../src/parser/index.js";

const SAMPLE_EMX = `<?xml version="1.0" encoding="UTF-8"?>
<Document version="5.1">
  <Model name="MassSpringDamper">
    <Submodels>
      <Submodel name="F" type="Se" x="60" y="120">
        <Parameters>
          <Parameter name="effort" value="10.0" unit="N"/>
        </Parameters>
      </Submodel>
      <Submodel name="j1" type="1" x="180" y="120"/>
      <Submodel name="m" type="I" x="300" y="60">
        <Parameters>
          <Parameter name="i" value="2.0" unit="kg"/>
        </Parameters>
      </Submodel>
      <Submodel name="b" type="R" x="300" y="120">
        <Parameters>
          <Parameter name="r" value="1.5" unit="N*s/m"/>
        </Parameters>
      </Submodel>
      <Submodel name="k" type="C" x="300" y="180">
        <Parameters>
          <Parameter name="c" value="0.25" unit="m/N"/>
        </Parameters>
      </Submodel>
    </Submodels>
    <Connections>
      <Connection id="b1" type="bond" from="F.p" to="j1.p"/>
      <Connection id="b2" type="bond" from="j1.p" to="m.p"/>
      <Connection id="b3" type="bond" from="j1.p" to="b.p"/>
      <Connection id="b4" type="bond" from="j1.p" to="k.p"/>
    </Connections>
    <Experiment startTime="0" finishTime="5" stepSize="0.01" method="RungeKutta4"/>
  </Model>
</Document>
`;

describe("20-sim .emx, .emxz, and SIDOPS Parser", () => {
  it("parses a 20-sim .emx XML bond graph model", () => {
    const model = parseEmx(SAMPLE_EMX);
    assert.strictEqual(model.name, "MassSpringDamper");
    assert.strictEqual(model.sourceKind, "emx");
    assert.strictEqual(model.version, "5.1");
    assert.strictEqual(model.parseIssues.length, 0);
    assert.strictEqual(model.root.submodels.length, 5);
    assert.strictEqual(model.root.connections.length, 4);
    assert.strictEqual(model.experiment?.finishTime, 5);
    assert.strictEqual(model.experiment?.method, "RungeKutta4");

    const mass = model.root.submodels.find((s) => s.name === "m");
    assert.ok(mass);
    assert.strictEqual(mass.elementKind, "I");
    assert.strictEqual(mass.parameters[0]?.value, 2.0);
    assert.strictEqual(mass.position?.x, 300);
  });

  it("parses an .emxz ZIP archive containing an .emx file", () => {
    const zip = new AdmZip();
    zip.addFile("MassSpringDamper.emx", Buffer.from(SAMPLE_EMX, "utf-8"));
    const buf = zip.toBuffer();

    const model = parseEmxz(buf);
    assert.strictEqual(model.sourceKind, "emxz");
    assert.strictEqual(model.name, "MassSpringDamper");
    assert.strictEqual(model.root.submodels.length, 5);

    const auto = parseTwentySim(buf);
    assert.strictEqual(auto.sourceKind, "emxz");
    assert.strictEqual(auto.root.connections.length, 4);
  });

  it("parses embedded SIDOPS SpecificationCode inside .emx CDATA", () => {
    const xmlWithSidops = `<?xml version="1.0"?>
<Document version="5.0">
  <Model name="CustomResistor">
    <SpecificationCode><![CDATA[
      parameters
        real R = 100.0 {Ohm};
      ports
        power p;
      equations
        p.e = R * p.f;
    ]]></SpecificationCode>
  </Model>
</Document>`;
    const model = parseEmx(xmlWithSidops);
    assert.strictEqual(model.parseIssues.length, 0);
    assert.strictEqual(model.root.parameters.length, 1);
    assert.strictEqual(model.root.parameters[0]?.name, "R");
    assert.strictEqual(model.root.parameters[0]?.value, 100);
    assert.strictEqual(model.root.parameters[0]?.unit, "Ohm");
    assert.strictEqual(model.root.ports.length, 1);
    assert.strictEqual(model.root.equations.length, 1);
  });

  it("parses standalone SIDOPS (.sid) models with submodels, connections, and ddt/int", () => {
    const sid = `
model HarmonicOscillator
  parameters
    real omega = 2.0 {rad/s};
  variables
    real x = 1.0;
    real v = 0.0;
  equations
    x = int(v, 1.0);
    ddt(v) = -omega^2 * x;
end HarmonicOscillator;
`;
    const { submodel, issues } = parseSidops(sid);
    assert.strictEqual(issues.length, 0);
    assert.strictEqual(submodel.name, "HarmonicOscillator");
    assert.strictEqual(submodel.parameters.length, 1);
    assert.strictEqual(submodel.variables.length, 2);
    assert.strictEqual(submodel.equations.length, 2);
  });
});

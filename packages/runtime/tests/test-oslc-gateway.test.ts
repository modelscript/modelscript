// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import { after, before, describe, it } from "node:test";
import { DigitalThreadHypergraph, OslcGateway, ReqIfParser, ThreadDomain } from "../src/index.js";

describe("OSLC Core 3.0 Linked Data Gateway (RM, QM, AM)", () => {
  let gateway: OslcGateway;
  let serverPort: number;

  before(async () => {
    gateway = new OslcGateway("http://localhost:8080");

    // Seed test data
    gateway.registerRequirement({
      identifier: "REQ-TORQUE-01",
      title: "Motor Peak Torque",
      description: "Motor torque must achieve 300 Nm within 0.5 seconds",
      status: "Approved",
      satisfiedBy: ["http://localhost:8080/oslc/am/elements/CAD_Motor_01"],
      verifiedBy: ["http://localhost:8080/oslc/qm/results/TR-TORQUE-01"],
      attributes: { asil: "ASIL-C", limit: 300 },
    });

    gateway.registerTestResult({
      identifier: "TR-TORQUE-01",
      title: "Dyno Step Verification Test",
      status: "Passed",
      verifiesRequirements: ["http://localhost:8080/oslc/rm/requirements/REQ-TORQUE-01"],
      executionDurationMs: 420,
      metricValues: { peakTorque: 312.4, settlingTime: 0.38 },
      details: "Torque reached 312.4 Nm with 0.38s settling time",
    });

    gateway.registerArchitectureElement({
      identifier: "CAD_Motor_01",
      title: "Electric Drive Motor Assembly",
      elementType: "CADComponent",
      domain: "CAD",
      format: "model/step",
      allocates: ["http://localhost:8080/oslc/am/elements/Modelica_Motor_01"],
      satisfiedRequirements: ["http://localhost:8080/oslc/rm/requirements/REQ-TORQUE-01"],
    });

    serverPort = await gateway.startServer(0, "127.0.0.1");
  });

  after(async () => {
    await gateway.stopServer();
  });

  it("should export W3C RDF Turtle serialization with standard OSLC prefixes", () => {
    const turtle = gateway.exportTurtle("all");

    assert.ok(turtle.includes("@prefix oslc: <http://open-services.net/ns/core#> ."));
    assert.ok(turtle.includes("@prefix oslc_rm: <http://open-services.net/ns/rm#> ."));
    assert.ok(turtle.includes("@prefix oslc_qm: <http://open-services.net/ns/qm#> ."));
    assert.ok(turtle.includes("@prefix oslc_am: <http://open-services.net/ns/am#> ."));
    assert.ok(turtle.includes("@prefix dcterms: <http://purl.org/dc/terms/> ."));

    // Check RM Requirement
    assert.ok(turtle.includes("a oslc_rm:Requirement, oslc:Resource ;"));
    assert.ok(turtle.includes('dcterms:identifier "REQ-TORQUE-01" ;'));
    assert.ok(turtle.includes('dcterms:title "Motor Peak Torque" ;'));

    // Check QM TestResult
    assert.ok(turtle.includes("a oslc_qm:TestResult, oslc:Resource ;"));
    assert.ok(turtle.includes('oslc_qm:status "Passed" ;'));
    assert.ok(turtle.includes("oslc_qm:executionDuration 420 ;"));

    // Check AM Architecture Element
    assert.ok(turtle.includes("a oslc_am:Resource, oslc:Resource ;"));
    assert.ok(turtle.includes('dcterms:identifier "CAD_Motor_01" ;'));
  });

  it("should export JSON-LD serialization with proper @context and @graph", () => {
    const jsonLd: any = gateway.exportJsonLd("all");

    assert.ok(jsonLd["@context"]);
    assert.strictEqual(jsonLd["@context"].oslc_rm, "http://open-services.net/ns/rm#");
    assert.strictEqual(jsonLd["@context"].oslc_qm, "http://open-services.net/ns/qm#");
    assert.ok(Array.isArray(jsonLd["@graph"]));
    assert.strictEqual(jsonLd["@graph"].length, 3);

    const req = jsonLd["@graph"].find((x: any) => x["dcterms:identifier"] === "REQ-TORQUE-01");
    assert.ok(req);
    assert.ok(req["@type"].includes("oslc_rm:Requirement"));

    const tr = jsonLd["@graph"].find((x: any) => x["dcterms:identifier"] === "TR-TORQUE-01");
    assert.ok(tr);
    assert.strictEqual(tr["oslc_qm:status"], "Passed");
  });

  it("should import ReqIF specifications into OSLC-RM requirements", () => {
    const reqifXml = `<?xml version="1.0" encoding="UTF-8"?>
    <REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
      <CORE-CONTENT>
        <REQ-IF-CONTENT>
          <SPEC-OBJECTS>
            <SPEC-OBJECT IDENTIFIER="REQ-SPEED-99">
              <VALUES>
                <ATTRIBUTE-VALUE-STRING THE-VALUE="Max Vehicle Speed">
                  <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>req_name</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
                </ATTRIBUTE-VALUE-STRING>
                <ATTRIBUTE-VALUE-STRING THE-VALUE="Top speed capped at 250 km/h.">
                  <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>req_text</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>
                </ATTRIBUTE-VALUE-STRING>
              </VALUES>
            </SPEC-OBJECT>
          </SPEC-OBJECTS>
        </REQ-IF-CONTENT>
      </CORE-CONTENT>
    </REQ-IF>`;

    const spec = ReqIfParser.parse(reqifXml);
    gateway.importReqIf(spec);

    const imported = gateway.getRequirement("REQ-SPEED-99");
    assert.ok(imported);
    assert.strictEqual(imported!.title, "Max Vehicle Speed");
    assert.strictEqual(imported!.description, "Top speed capped at 250 km/h.");
  });

  it("should import digital thread hypergraph into OSLC-AM architecture resources", () => {
    const hypergraph = new DigitalThreadHypergraph();
    const slot = hypergraph.createThread(1001);
    hypergraph.bindDomainNode(slot, ThreadDomain.SysML2, 42);
    hypergraph.bindDomainNode(slot, ThreadDomain.Modelica, 108);

    gateway.importHypergraph(hypergraph, (domain, nodeId) => {
      if (domain === ThreadDomain.SysML2) {
        return { name: "SysML_InverterBlock", type: "BlockDef" };
      }
      return { name: "Modelica_InverterCircuit", type: "ModelicaModel" };
    });

    const sysmlElem = gateway.getArchitectureElement("SysML2_42");
    assert.ok(sysmlElem);
    assert.strictEqual(sysmlElem!.title, "SysML_InverterBlock");

    const moElem = gateway.getArchitectureElement("Modelica_108");
    assert.ok(moElem);
    assert.strictEqual(moElem!.title, "Modelica_InverterCircuit");

    // Both should allocate each other as thread siblings
    assert.ok(sysmlElem!.allocates.includes(moElem!.uri));
    assert.ok(moElem!.allocates.includes(sysmlElem!.uri));
  });

  it("should serve OSLC Service Provider Catalog over HTTP", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/oslc/catalog`);
    assert.strictEqual(res.status, 200);

    const data = await res.json();
    assert.ok(data["@id"].includes("/oslc/catalog"));
    assert.ok(Array.isArray(data["oslc:serviceProvider"]));
    assert.strictEqual(data["oslc:serviceProvider"].length, 3);
  });

  it("should support content negotiation (Turtle vs JSON-LD) on HTTP REST endpoints", async () => {
    // 1. Request Turtle
    const resTurtle = await fetch(`http://127.0.0.1:${serverPort}/oslc/rm/requirements`, {
      headers: { Accept: "text/turtle" },
    });
    assert.strictEqual(resTurtle.status, 200);
    assert.ok(resTurtle.headers.get("content-type")?.includes("text/turtle"));
    const turtleBody = await resTurtle.text();
    assert.ok(turtleBody.includes("@prefix oslc_rm:"));
    assert.ok(turtleBody.includes("REQ-TORQUE-01"));

    // 2. Request JSON-LD
    const resJsonLd = await fetch(`http://127.0.0.1:${serverPort}/oslc/rm/requirements`, {
      headers: { Accept: "application/ld+json" },
    });
    assert.strictEqual(resJsonLd.status, 200);
    assert.ok(resJsonLd.headers.get("content-type")?.includes("application/ld+json"));
    const jsonLdBody = await resJsonLd.json();
    assert.ok(jsonLdBody["@context"]);
    assert.ok(Array.isArray(jsonLdBody["@graph"]));
  });
});

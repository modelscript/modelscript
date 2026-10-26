// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { getArtifactRegistry } from "../src/artifacts/index.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import {
  extractModelicaComponentsFromSource,
  extractModelicaEquations,
  extractSysmlComponentsFromSource,
  inspectClassSource,
} from "../src/util/class-source-inspector.js";

test("Artifact Viewer, Search Completions, and RDF Metadata REST Routes", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-search-test-"));
  const db = new LibraryDatabase(tmpDir);
  const app = createApp({ database: db });
  const artifactRegistry = getArtifactRegistry();

  t.after(() => {
    try {
      db.db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  // Seed sample user and package
  const user = db.createUser("cad_dev", "cad@modelscript.test", "hash_pw", "CAD Developer");
  const { id: pkgId } = db.getOrCreatePackage("MechanicalComponents");
  assert.ok(user && pkgId);

  await t.test("Artifacts: GET /api/v1/artifacts/types returns registered artifact handlers", async () => {
    const res = await request(app).get("/api/v1/artifacts/types");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.types));
    const types = res.body.types.map((t: any) => t.type);
    assert.ok(types.includes("cad"), "Should include CAD artifact handler");
    assert.ok(types.includes("fmu"), "Should include FMU artifact handler");
    assert.ok(types.includes("dataset"), "Should include Dataset artifact handler");
    assert.ok(types.includes("vega"), "Should include Vega artifact handler");
    assert.ok(types.includes("mermaid"), "Should include Mermaid artifact handler");
    assert.ok(types.includes("sysml"), "Should include SysML v2 artifact handler");
  });

  await t.test("Artifacts: compound extension detection (.vl.json, .vg.json, .cfd.json, .kerml)", async () => {
    assert.strictEqual(artifactRegistry.detectType("plots/response.vl.json"), "vega");
    assert.strictEqual(artifactRegistry.detectType("plots/bode.vg.json"), "vega");
    assert.strictEqual(artifactRegistry.detectType("sim/melt_front.cfd.json"), "cfd-animation");
    assert.strictEqual(artifactRegistry.detectType("arch/system.kerml"), "sysml");
    assert.strictEqual(artifactRegistry.detectType("data/table.tsv"), "dataset");
    assert.strictEqual(artifactRegistry.detectType("data/table.csv"), "dataset");
  });

  await t.test("Artifacts: SysML, Vega, and Mermaid handlers extract rich viewer descriptors", async () => {
    const sysmlCode = `package ThermalControl {
  requirement <'REQ-01'> MaxTempReq {
    doc /* Battery cell temperature shall not exceed 328 K */
  }
  part def CoolingLoop {
    port inlet : FluidPort;
    port outlet : FluidPort;
  }
  part primaryLoop : CoolingLoop[2];
  part radiator : HeatExchanger;
  satisfy MaxTempReq by primaryLoop;
  connect primaryLoop.outlet to radiator.inlet;
}`;
    const sysmlMeta = await artifactRegistry.extractMetadata(
      "sysml",
      Buffer.from(sysmlCode, "utf-8"),
      "arch/thermal.sysml",
    );
    assert.ok(sysmlMeta);
    const sysmlView = artifactRegistry.getHandler("sysml")?.getViewDescriptor(sysmlMeta);
    assert.strictEqual(sysmlView?.viewer, "sysml-architecture-viewer");
    assert.strictEqual(sysmlView?.config.systemName, "ThermalControl");
    assert.ok(Array.isArray(sysmlView?.config.parts));
    assert.ok((sysmlView?.config.parts as any[]).length >= 2);
    assert.ok(Array.isArray(sysmlView?.config.requirements));
    assert.strictEqual((sysmlView?.config.requirements as any[])[0]?.id, "REQ-01");
    assert.strictEqual((sysmlView?.config.requirements as any[])[0]?.status, "satisfied");
    assert.ok(Array.isArray(sysmlView?.config.connections));
    assert.strictEqual((sysmlView?.config.connections as any[]).length, 1);

    // Vega handler
    const vegaSpec = {
      $schema: "https://vega.github.io/schema/vega-lite/v5.json",
      title: "Step Response",
      mark: "line",
    };
    const vegaMeta = await artifactRegistry.extractMetadata(
      "vega",
      Buffer.from(JSON.stringify(vegaSpec), "utf-8"),
      "plots/step.vl.json",
    );
    assert.ok(vegaMeta);
    const vegaView = artifactRegistry.getHandler("vega")?.getViewDescriptor(vegaMeta);
    assert.strictEqual(vegaView?.viewer, "vega-plot");
    assert.strictEqual(vegaView?.config.title, "Step Response");
    assert.deepStrictEqual(vegaView?.config.spec, vegaSpec);

    // Mermaid handler
    const mmdCode = "flowchart LR\n  A[Sensor] --> B[Controller]";
    const mmdMeta = await artifactRegistry.extractMetadata("mermaid", Buffer.from(mmdCode, "utf-8"), "docs/flow.mmd");
    assert.ok(mmdMeta);
    const mmdView = artifactRegistry.getHandler("mermaid")?.getViewDescriptor(mmdMeta);
    assert.strictEqual(mmdView?.viewer, "mermaid-diagram");
    assert.strictEqual(mmdView?.config.code, mmdCode);
  });

  await t.test(
    "Artifacts: Scoped package GET /api/v1/packages/:scope/:name/:version/artifacts injects resourceUrl",
    async () => {
      const { id: scopedPkgId } = db.getOrCreatePackage("@alice/PropulsionPkg", "alice");
      const verId = db.storePackageVersion(
        scopedPkgId,
        "1.0.0",
        "/tmp/fake.tgz",
        "abc123hash",
        null,
        1024,
        "{}",
        null,
        user.id,
      );
      db.storeArtifact(
        verId,
        "mermaid",
        "diagrams/control.mmd",
        JSON.stringify({
          diagramType: "flowchart",
          lineCount: 2,
          code: "flowchart TD\n  X-->Y",
          title: "control",
        }),
      );

      const res = await request(app).get("/api/v1/packages/@alice/PropulsionPkg/1.0.0/artifacts");
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.artifacts.length, 1);
      assert.strictEqual(res.body.artifacts[0].viewer.viewer, "mermaid-diagram");
      assert.strictEqual(res.body.artifacts[0].viewer.config.packageName, "@alice/PropulsionPkg");
      assert.strictEqual(
        res.body.artifacts[0].viewer.config.resourceUrl,
        "/api/v1/libraries/%40alice/PropulsionPkg/1.0.0/resources/diagrams/control.mmd",
      );
    },
  );

  await t.test("Javadoc Inspector: extracts Modelica equations, parameters, ports, and SysML parts", async () => {
    const moSource = `model RCFilter "First-order RC low-pass filter"
  parameter Real R(unit="Ohm") = 100.0 "Series resistance";
  parameter Real C(unit="F") = 1e-3 "Filter capacitance";
  Modelica.Blocks.Interfaces.RealInput u "Input voltage";
  Modelica.Blocks.Interfaces.RealOutput y "Filtered output voltage";
  Resistor r1(R=R) "Main resistor";
equation
  connect(u, r1.p);
  C * der(y) = (u - y) / R;
  annotation(Documentation(info="<html><p>Low-pass filter.</p></html>"));
end RCFilter;`;

    const eqs = extractModelicaEquations(moSource);
    assert.strictEqual(eqs.length, 2);
    assert.ok(eqs.some((e) => e.includes("connect(u, r1.p)")));
    assert.ok(eqs.some((e) => e.includes("C * der(y) = (u - y) / R")));

    const comps = extractModelicaComponentsFromSource(moSource);
    assert.ok(comps.length >= 5);
    const rParam = comps.find((c) => c.component_name === "R");
    assert.strictEqual(rParam?.variability, "parameter");
    assert.ok(rParam?.modifiers.some((m) => m.modifier_name === "unit" && m.modifier_value === "Ohm"));
    assert.ok(rParam?.modifiers.some((m) => m.modifier_name === "value" && m.modifier_value === "100.0"));

    // Write to temporary extracted dir and test inspectClassSource
    const pkgDir = path.join(tmpDir, "extracted-pkg");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "RCFilter.mo"), moSource, "utf-8");

    const inspected = inspectClassSource(pkgDir, "TestLib", "1.0.0", "RCFilter", "model");
    assert.strictEqual(inspected.sourceFile, "RCFilter.mo");
    assert.ok(inspected.sourceCode?.includes("model RCFilter"));
    assert.strictEqual(inspected.equations.length, 2);
    assert.ok(inspected.extractedComponents.length >= 5);

    const sysmlComps = extractSysmlComponentsFromSource(`part def Rover {
      attribute mass : Real = 45.0;
      port powerIn : PowerPort;
      part chassis : AluminumFrame;
    }`);
    assert.strictEqual(sysmlComps.length, 3);
    assert.strictEqual(sysmlComps[0]?.variability, "parameter");
    assert.strictEqual(sysmlComps[1]?.causality, "connector");
  });

  await t.test("Artifacts: GET /api/v1/cad/convert validates query parameters", async () => {
    const res = await request(app).get("/api/v1/cad/convert");
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  await t.test("Artifacts: GET /api/v1/packages/:name/:version/artifacts handles non-existent packages", async () => {
    const res = await request(app).get("/api/v1/packages/NonExistent/1.0.0/artifacts");
    assert.strictEqual(res.status, 404);
  });

  await t.test("Search: GET /api/v1/search/completions returns empty structure on empty query", async () => {
    const res = await request(app).get("/api/v1/search/completions");
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { topics: [], users: [], packages: [], repositories: [] });
  });

  await t.test("Search: GET /api/v1/search/completions finds seeded user and package", async () => {
    const res = await request(app).get("/api/v1/search/completions?q=cad");
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.users));
    assert.ok(Array.isArray(res.body.packages));
    const foundUser = res.body.users.some((u: any) => u.username === "cad_dev");
    assert.ok(foundUser, "Search should return seeded user");
  });

  await t.test("RDF: GET /api/v1/libraries/:name/:version/rdf returns 404 for missing package", async () => {
    const res = await request(app).get("/api/v1/libraries/MissingPackage/1.0.0/rdf");
    assert.strictEqual(res.status, 404);
  });

  await t.test("RDF: GET /api/v1/libraries/:name/:version/rdf serializes Turtle triples", async () => {
    db.db
      .prepare(
        `INSERT INTO classes (library_name, library_version, class_name, class_kind, description)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run("MechanicalComponents", "1.0.0", "Motor", "model", "DC Electric Motor");

    const res = await request(app).get("/api/v1/libraries/MechanicalComponents/1.0.0/rdf").set("Accept", "text/turtle");

    assert.strictEqual(res.status, 200);
    assert.ok(res.headers["content-type"].includes("text/turtle"));
    assert.ok(res.text.includes("MechanicalComponents"));
    assert.ok(res.text.includes("Motor"));
  });

  await t.test("RDF: GET /api/v1/libraries/:name/:version/rdf serializes N-Triples format", async () => {
    const res = await request(app)
      .get("/api/v1/libraries/MechanicalComponents/1.0.0/rdf")
      .set("Accept", "application/n-triples");

    assert.strictEqual(res.status, 200);
    assert.ok(res.headers["content-type"].includes("application/n-triples"));
    assert.ok(res.text.includes("urn:modelica:MechanicalComponents:1.0.0:Motor"));
  });

  await t.test(
    "Storage: POST /api/v1/storage/upload categorizes engineering formats into dedicated view_types",
    async () => {
      const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET);

      const testCases = [
        { filename: "microgrid.pscx", expected: "pscad" },
        { filename: "grid_sim.psout", expected: "psout" },
        { filename: "powerflow.raw", expected: "psse" },
        { filename: "pipeline.opi", expected: "olga" },
        { filename: "control_system.ez5", expected: "easy5" },
        { filename: "ssme_powerhead.roc", expected: "rocets" },
        { filename: "gas_network.lps", expected: "lps" },
        { filename: "semi_submersible.sima", expected: "sima" },
        { filename: "cylinder_engine.gtm", expected: "gtsuite" },
        { filename: "bracket_stress.inp", expected: "fea-deck" },
        { filename: "airfoil_turb.cfg", expected: "cfd-config" },
        { filename: "drivetrain.ssp", expected: "ssp" },
        { filename: "chua_circuit.fmu", expected: "fmu" },
        { filename: "cad_bracket.step", expected: "cad-step" },
        { filename: "ontology.owl", expected: "owl2" },
        { filename: "column.aspen", expected: "aspen" },
        { filename: "drainage.swmm", expected: "swmm" },
        { filename: "filter.s2p", expected: "touchstone" },
        { filename: "buffer.ibs", expected: "ibis" },
        { filename: "feeder.dss", expected: "opendss" },
        { filename: "cut_in.xosc", expected: "openscenario" },
        { filename: "primary_loop.r5", expected: "relap5" },
        { filename: "black_oil.data", expected: "eclipse" },
        { filename: "glycolysis.sbml", expected: "sbml" },
        { filename: "c172.jsbsim", expected: "jsbsim" },
      ];

      for (const { filename, expected } of testCases) {
        const res = await request(app)
          .post("/api/v1/storage/upload")
          .set("Authorization", `Bearer ${token}`)
          .attach("file", Buffer.from("test-content"), filename);

        assert.strictEqual(res.status, 200, `Upload failed for ${filename}`);
        assert.strictEqual(res.body.view_type, expected, `Expected view_type ${expected} for ${filename}`);
        assert.strictEqual(res.body.filename, filename);
      }
    },
  );
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import jwt from "jsonwebtoken";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import request from "supertest";

process.env["NODE_ENV"] = "test";

import { createApp } from "../src/app.js";
import { LibraryDatabase } from "../src/database.js";
import { JWT_SECRET } from "../src/middleware/auth-middleware.js";
import { pregenerateServerSvgThumbnail } from "../src/services/artifact-preprocessor.js";
import { preprocessModelicaArtifact } from "../src/services/modelica-artifact-renderer.js";

test("Modelica Post Artifact 4-Stage Fallback Pipeline (Diagram -> Icon -> Simulation -> Code)", async (t) => {
  await t.test("Stage 1: Renders Modelica diagram when class has placed components & connections", async () => {
    const diagramCode = `model CoupledMasses
  model BlockComp
    annotation(Icon(graphics={Rectangle(extent={{-100,-100},{100,100}}, lineColor={0,0,127}, fillColor={255,255,255}, fillPattern=FillPattern.Solid)}));
  end BlockComp;
  BlockComp b1 annotation(Placement(transformation(extent={{-60,-20},{-20,20}})));
  BlockComp b2 annotation(Placement(transformation(extent={{20,-20},{60,20}})));
equation
  connect(b1, b2) annotation(Line(points={{-20,0},{20,0}}, color={0,0,127}));
end CoupledMasses;`;

    const res = await preprocessModelicaArtifact(diagramCode, "CoupledMasses");
    assert.strictEqual(res.previewMode, "diagram");
    assert.ok(res.svg.includes('data-preview-mode="diagram"'));
    assert.ok(res.svg.includes('class="diagram-nodes"'));
    assert.strictEqual(res.metadata["previewMode"], "diagram");
    assert.strictEqual(res.metadata["nodeCount"], 2);
  });

  await t.test("Stage 2: Renders Modelica icon when diagram is empty and class has an Icon", async () => {
    const iconCode = `model CustomResistor "Shared electrical resistor component"
  parameter Real R = 10.0;
  annotation(Icon(coordinateSystem(extent={{-100,-100},{100,100}}), graphics={
    Rectangle(extent={{-70,-30},{70,30}}, lineColor={0,0,255}, fillColor={255,255,255}, fillPattern=FillPattern.Solid),
    Line(points={{-100,0},{-70,0}}, color={0,0,255}),
    Line(points={{70,0},{100,0}}, color={0,0,255}),
    Text(extent={{-100,-60},{100,-100}}, textString="R=%R")
  }));
end CustomResistor;`;

    const res = await preprocessModelicaArtifact(iconCode, "CustomResistor");
    assert.strictEqual(res.previewMode, "icon");
    assert.ok(res.svg.includes('data-preview-mode="icon"'));
    assert.ok(res.svg.includes("MODEL ICON"));
    assert.strictEqual(res.metadata["previewMode"], "icon");
  });

  await t.test(
    "Stage 3: Renders Simulation trajectory thumbnail when simulatable and no diagram/icon exists",
    async () => {
      const mySystemCode = `model MySystem
  // Interactive Modelica System
  parameter Real k = 10.0;
  parameter Real m = 1.0;
  parameter Real d = 0.5;
  Real x(start = 1.0);
  Real v(start = 0.0);
equation
  der(x) = v;
  m * der(v) = -k * x - d * v;
  annotation(experiment(StopTime = 5.0, StepSize = 0.01));
end MySystem;`;

      const res = await preprocessModelicaArtifact(mySystemCode, "MySystem");
      assert.strictEqual(res.previewMode, "simulation");
      assert.ok(res.svg.includes('data-preview-mode="simulation"'));
      assert.ok(res.svg.includes('class="simulation-curves"'));
      assert.ok(res.svg.includes("<polyline"));
      assert.ok(!res.svg.includes("k : Real"), "Should never render parameter k as a diagram box");
      assert.ok(!res.svg.includes("m : Real"), "Should never render parameter m as a diagram box");
      assert.strictEqual(res.metadata["previewMode"], "simulation");
      assert.ok(Number(res.metadata["stepCount"]) >= 50);
    },
  );

  await t.test(
    "Stage 4: Falls back to syntax-highlighted Code snippet thumbnail when partial or not simulatable",
    async () => {
      const partialCode = `partial model PartialTwoPin "Base class for two-pin components"
  Real v "Voltage drop between pins";
  Real i "Current into positive pin";
equation
  v = 0;
end PartialTwoPin;`;

      const res = await preprocessModelicaArtifact(partialCode, "PartialTwoPin");
      assert.strictEqual(res.previewMode, "code");
      assert.ok(res.svg.includes('data-preview-mode="code"'));
      assert.ok(res.svg.includes("PARTIAL MODEL · CODE"));
      assert.ok(res.svg.includes("PartialTwoPin"));
      assert.strictEqual(res.metadata["previewMode"], "code");
      assert.strictEqual(res.metadata["isPartial"], true);
    },
  );

  await t.test("End-to-end POST /api/v1/social/artifact-views enriches morsel and modelica-diagram posts", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "modelica-artifact-e2e-"));
    const db = new LibraryDatabase(tmpDir);
    const app = createApp({ database: db });

    try {
      const author = db.createUser("dana", "dana@modelscript.test", "hashed_pwd", { emailVerified: true });
      const token = jwt.sign({ id: author.id, username: author.username, email: author.email }, JWT_SECRET);

      const mySystemCode = `model MySystem
  parameter Real k = 10.0;
  parameter Real m = 1.0;
  parameter Real d = 0.5;
  Real x(start = 1.0);
  Real v(start = 0.0);
equation
  der(x) = v;
  m * der(v) = -k * x - d * v;
  annotation(experiment(StopTime = 5.0, StepSize = 0.01));
end MySystem;`;

      const postArtRes = await request(app)
        .post("/api/v1/social/artifact-views")
        .set("Authorization", `Bearer ${token}`)
        .send({
          artifact_type: "modelica-diagram",
          view_config: JSON.stringify({ code: mySystemCode, dialect: "modelica", title: "test" }),
          title: "test",
        });

      assert.strictEqual(postArtRes.status, 201);
      assert.ok(postArtRes.body.id);
      assert.ok(postArtRes.body.thumbnail_url, "Should return generated thumbnail_url");

      const getRes = await request(app).get(`/api/v1/social/artifact-views/${postArtRes.body.id}`);
      assert.strictEqual(getRes.status, 200);
      const cfg = JSON.parse(getRes.body.artifactView.view_config);
      assert.strictEqual(cfg.previewMode, "simulation");
      assert.ok(typeof cfg.svg === "string" && cfg.svg.includes('data-preview-mode="simulation"'));
      assert.ok(typeof cfg.thumbnail_url === "string" && cfg.thumbnail_url.endsWith(".thumb.svg"));

      // Also verify pregenerateServerSvgThumbnail directly on a temp file
      const tmpFile = path.join(tmpDir, "PartialModel.mo");
      fs.writeFileSync(tmpFile, "partial model PartialBase\n  Real x;\nend PartialBase;", "utf-8");
      const pregen = await pregenerateServerSvgThumbnail(tmpFile, "modelica-diagram", "PartialBase.mo", tmpDir);
      assert.ok(pregen.svg?.includes('data-preview-mode="code"'));
      assert.strictEqual(pregen.metadata?.["previewMode"], "code");
    } finally {
      try {
        db.db.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  });
});

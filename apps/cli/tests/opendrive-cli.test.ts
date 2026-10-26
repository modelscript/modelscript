// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { OpenDriveCommand } from "../src/commands/opendrive.js";

const SAMPLE_XODR = `<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <header revMajor="1" revMinor="6" name="Highway_Section" version="1.0" vendor="ModelScript"/>
  <road name="North_Expressway" length="250.0" id="1" junction="-1">
    <planView>
      <geometry s="0.0" x="0.0" y="0.0" hdg="0.0" length="150.0">
        <line/>
      </geometry>
      <geometry s="150.0" x="150.0" y="0.0" hdg="0.0" length="100.0">
        <arc curvature="0.01"/>
      </geometry>
    </planView>
    <elevationProfile>
      <elevation s="0.0" a="10.0" b="0.02" c="0.0" d="0.0"/>
    </elevationProfile>
    <lateralProfile>
      <superelevation s="0.0" a="0.03" b="0.0" c="0.0" d="0.0"/>
    </lateralProfile>
    <lanes>
      <laneSection s="0.0">
        <center><lane id="0" type="none"/></center>
        <right><lane id="-1" type="driving"><width sOffset="0.0" a="3.5" b="0" c="0" d="0"/></lane></right>
      </laneSection>
    </lanes>
    <signals>
      <signal s="50.0" t="3.5" id="s1" name="Speed_100" dynamic="no" orientation="+" zOffset="0" country="USA" type="100"/>
    </signals>
  </road>
</OpenDRIVE>`;

test("OpenDRIVE CLI Commands (msx opendrive inspect, lint, track, to-gensys, to-dae, render)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "languages/opendrive/tests/scratch_opendrive_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const xodrFile = path.join(tmpDir, "highway.xodr");
  fs.writeFileSync(xodrFile, SAMPLE_XODR, "utf-8");

  await t.test("msx opendrive inspect", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OpenDriveCommand.handler as any)({
        action: "inspect",
        files: [xodrFile],
      });
      assert.ok(logs.some((l) => l.includes("ASAM OpenDRIVE Road Network: Highway_Section")));
      assert.ok(logs.some((l) => l.includes("North_Expressway")));
      assert.ok(logs.some((l) => l.includes("250.0 m")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx opendrive lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OpenDriveCommand.handler as any)({
        action: "lint",
        files: [xodrFile],
      });
      assert.ok(logs.some((l) => l.includes("0 diagnostics reported")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx opendrive track", async () => {
    const outFile = path.join(tmpDir, "track.json");

    await (OpenDriveCommand.handler as any)({
      action: "track",
      files: [xodrFile],
      out: outFile,
      step: 25.0,
    });

    assert.ok(fs.existsSync(outFile));
    const data = JSON.parse(fs.readFileSync(outFile, "utf-8"));
    assert.strictEqual(data.length, 1);
    assert.strictEqual(data[0].roadId, "1");
    assert.ok(data[0].points.length >= 10);
  });

  await t.test("msx opendrive to-gensys", async () => {
    const outFile = path.join(tmpDir, "highway.trax");

    await (OpenDriveCommand.handler as any)({
      action: "to-gensys",
      files: [xodrFile],
      out: outFile,
      step: 25.0,
    });

    assert.ok(fs.existsSync(outFile));
    const content = fs.readFileSync(outFile, "utf-8");
    assert.ok(content.includes("! GENSYS Track / Road Geometry Deck"));
    assert.ok(content.includes("track_data ="));
  });

  await t.test("msx opendrive to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (OpenDriveCommand.handler as any)({
        action: "to-dae",
        files: [xodrFile],
      });
      assert.ok(logs.some((l) => l.includes("Variables: 8")));
      assert.ok(logs.some((l) => l.includes("Equations: 9")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx opendrive render", async () => {
    const outFile = path.join(tmpDir, "highway.svg");

    await (OpenDriveCommand.handler as any)({
      action: "render",
      files: [xodrFile],
      out: outFile,
      step: 10.0,
      theme: "dark",
    });

    assert.ok(fs.existsSync(outFile));
    const svg = fs.readFileSync(outFile, "utf-8");
    assert.ok(svg.includes("<svg"));
    assert.ok(svg.includes("<polygon"));
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

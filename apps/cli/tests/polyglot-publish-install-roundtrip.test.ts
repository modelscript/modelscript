// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import Database from "better-sqlite3";
import jwt from "jsonwebtoken";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { createApp } from "../../api/src/app.js";
import { LibraryDatabase } from "../../api/src/database.js";
import { JobQueue } from "../../api/src/jobs.js";
import { JWT_SECRET } from "../../api/src/middleware/auth-middleware.js";
import { LibraryStorage } from "../../api/src/storage.js";
import { Install } from "../src/commands/install.js";
import { Pack } from "../src/commands/pack.js";
import { buildPolyglotIndex } from "../src/commands/polyglot.js";
import { Publish } from "../src/commands/publish.js";

process.env["NODE_ENV"] = "test";

describe("Polyglot Package End-to-End: Pack, Publish, Index, Install & Parity Verification", () => {
  let tmpRoot: string;
  let server: http.Server;
  let serverUrl: string;
  let db: LibraryDatabase;
  let storage: LibraryStorage;
  let jobQueue: JobQueue;
  let aliceToken: string;

  let pkgDir: string;
  let consumerDir: string;
  let offlineConsumerDir: string;
  let packedZipPath: string;

  const pkgName = "@acme/drone-avionics";
  const pkgVersion = "1.0.0";

  let origLog: typeof console.log;
  let origError: typeof console.error;
  let origWrite: typeof process.stdout.write;

  before(async () => {
    origLog = console.log;
    origError = console.error;
    origWrite = process.stdout.write;
    console.log = () => {};
    console.error = () => {};
    (process.stdout as any).write = () => true;

    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "polyglot-e2e-"));
    const dbDir = path.join(tmpRoot, "registry-db");
    const storageDir = path.join(tmpRoot, "registry-storage");
    fs.mkdirSync(dbDir, { recursive: true });
    fs.mkdirSync(storageDir, { recursive: true });

    db = new LibraryDatabase(dbDir);
    storage = new LibraryStorage(storageDir);
    jobQueue = new JobQueue();

    const app = createApp({ database: db, storage, jobQueue });
    server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    const alice = db.createUser("alice_engineer", "alice@acme.corp", "supersecret123", { emailVerified: true });
    aliceToken = jwt.sign({ id: alice.id, username: alice.username }, JWT_SECRET);

    // Register organization 'acme' owned by alice
    db.createOrganization({
      slug: "acme",
      name: "ACME Corp",
      description: "Autonomous Cyber-Physical Systems",
      createdBy: alice.id,
    });

    // ── Create Source Polyglot Package Directory ──
    pkgDir = path.join(tmpRoot, "acme-drone-avionics-source");
    fs.mkdirSync(path.join(pkgDir, "models"), { recursive: true });
    fs.mkdirSync(path.join(pkgDir, "sysml"), { recursive: true });
    fs.mkdirSync(path.join(pkgDir, "cad"), { recursive: true });
    fs.mkdirSync(path.join(pkgDir, "data"), { recursive: true });

    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify(
        {
          name: pkgName,
          version: pkgVersion,
          description: "Multi-domain cyber-physical drone avionics package",
          files: ["models", "sysml", "cad", "data"],
        },
        null,
        2,
      ),
      "utf-8",
    );

    // 1. Modelica: Physical dynamics model with twin and CAD annotations
    fs.writeFileSync(
      path.join(pkgDir, "models/FlightDynamics.mo"),
      `model FlightDynamics
  parameter Real mass = 1.25;
  Real altitude(start = 0.0, fixed = true);
  Real velocity(start = 0.0, fixed = true);
  Real motorSpeed annotation(twin="AvionicsArchitecture::Motor::maxRpm");
  part chassis annotation(CAD(uri="cad://MotorChassis.step", part="frame_mount"));
equation
  der(altitude) = velocity;
  der(velocity) = -9.81;
end FlightDynamics;`,
      "utf-8",
    );

    // 2. SysML v2: Architecture specification with twin attribute and CAD link
    fs.writeFileSync(
      path.join(pkgDir, "sysml/Avionics.sysml"),
      `package AvionicsArchitecture {
  part def Motor {
    attribute maxRpm : Real = 8500.0;
    attribute cadBinding = "cad://MotorChassis.step#100";
  }
}`,
      "utf-8",
    );

    // 3. STEP CAD: Product definitions for frame mount and rotor arm
    fs.writeFileSync(
      path.join(pkgDir, "cad/MotorChassis.step"),
      `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Drone Chassis'),'2;1');
FILE_NAME('MotorChassis.step','2026-10-09',('Author'),('Org'),'Preprocessor','OriginatingSystem','');
FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));
ENDSEC;
DATA;
#100 = PRODUCT('frame_mount','Drone Frame Mount','',(#101));
#101 = PRODUCT_CONTEXT('',#102,'mechanical');
#102 = APPLICATION_CONTEXT('mechanical design');
#200 = MANIFOLD_SOLID_BREP('rotor_arm',#201);
ENDSEC;
END-ISO-10303-21;
`,
      "utf-8",
    );

    // 4. CSV Telemetry data
    fs.writeFileSync(
      path.join(pkgDir, "data/telemetry.csv"),
      `time,rpm,thrust\n0.0,0.0,0.0\n1.0,4200.0,12.5\n2.0,8500.0,28.0\n`,
      "utf-8",
    );

    // ── Setup Consumer Workspace Directories ──
    consumerDir = path.join(tmpRoot, "consumer-workspace");
    fs.mkdirSync(path.join(consumerDir, "models"), { recursive: true });
    fs.writeFileSync(
      path.join(consumerDir, "package.json"),
      JSON.stringify(
        {
          name: "autonomous-drone-app",
          version: "0.1.0",
          dependencies: {},
        },
        null,
        2,
      ),
      "utf-8",
    );

    offlineConsumerDir = path.join(tmpRoot, "consumer-offline");
    fs.mkdirSync(offlineConsumerDir, { recursive: true });
    fs.writeFileSync(
      path.join(offlineConsumerDir, "package.json"),
      JSON.stringify(
        {
          name: "offline-drone-app",
          version: "0.1.0",
          dependencies: {},
        },
        null,
        2,
      ),
      "utf-8",
    );
  });

  after(async () => {
    console.log = origLog;
    console.error = origError;
    process.stdout.write = origWrite;
    try {
      if (server) {
        server.closeAllConnections?.();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      jobQueue.clear();
      db.db.close();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  test("1. `msx pack` creates valid multi-domain distribution archive (.msx.zip)", async () => {
    const originalCwd = process.cwd();
    process.chdir(pkgDir);

    try {
      await (Pack.handler as any)({
        path: ".",
        out: pkgDir,
        dryRun: false,
        json: false,
      });

      packedZipPath = path.join(pkgDir, "acme-drone-avionics-1.0.0.msx.zip");
      assert.ok(fs.existsSync(packedZipPath), "Distribution archive must exist");

      const zip = new AdmZip(packedZipPath);
      const entries = zip.getEntries().map((e) => e.entryName);

      assert.ok(entries.includes("package.json"), "Archive must contain package.json");
      assert.ok(entries.includes("models/FlightDynamics.mo"), "Archive must contain Modelica model");
      assert.ok(entries.includes("sysml/Avionics.sysml"), "Archive must contain SysML v2 model");
      assert.ok(entries.includes("cad/MotorChassis.step"), "Archive must contain STEP CAD geometry");
      assert.ok(entries.includes("data/telemetry.csv"), "Archive must contain CSV telemetry dataset");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("2. `msx publish` uploads package to registry with CAS content hash", async () => {
    process.env.MODELSCRIPT_API_URL = serverUrl;
    process.env.MODELSCRIPT_API_TOKEN = aliceToken;

    const originalCwd = process.cwd();
    process.chdir(pkgDir);

    try {
      await (Publish.handler as any)({
        path: pkgDir,
        dryRun: false,
        noVerify: false,
        tag: "latest",
      });

      assert.ok(storage.exists(pkgName, pkgVersion), "Storage must record package release");

      const releases = db.getLibraryReleases(pkgName);
      assert.equal(releases.length, 1);
      assert.equal(releases[0]?.library_version, pkgVersion);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("3. Background worker indexes polyglot assets into `salsa-index.db`", async () => {
    const jobKey = `${pkgName}@${pkgVersion}`;
    for (let i = 0; i < 40; i++) {
      const status = jobQueue.getStatus(jobKey);
      if (status?.status === "completed" || status?.status === "failed") break;
      await new Promise((r) => setTimeout(r, 250));
    }

    const finalStatus = jobQueue.getStatus(jobKey);
    assert.equal(finalStatus?.status, "completed", `Job must complete cleanly: ${finalStatus?.error}`);

    const indexPath = storage.getIndexPath(pkgName, pkgVersion);
    assert.ok(fs.existsSync(indexPath), "salsa-index.db must exist in registry storage");

    const sqlite = new Database(indexPath);
    const rows = sqlite.prepare("SELECT id, data FROM symbols").all() as { id: number; data: string }[];
    assert.ok(rows.length > 0, "Symbols table in salsa-index.db must contain indexed symbols");

    const symbols = rows.map((r) => JSON.parse(r.data));

    // Verify presence of symbols across all 3 domains
    const hasFlightDynamics = symbols.some((s) => s.name === "FlightDynamics");
    const hasAvionicsArch = symbols.some((s) => s.name === "AvionicsArchitecture");
    const hasMotor = symbols.some((s) => s.name === "Motor");
    const hasFrameMount = symbols.some((s) => s.name === "frame_mount");
    const hasRotorArm = symbols.some((s) => s.name === "rotor_arm");

    assert.ok(hasFlightDynamics, "Must index Modelica FlightDynamics");
    assert.ok(hasAvionicsArch, "Must index SysML v2 package AvionicsArchitecture");
    assert.ok(hasMotor, "Must index SysML v2 definition Motor");
    assert.ok(hasFrameMount, "Must index STEP CAD product frame_mount");
    assert.ok(hasRotorArm, "Must index STEP CAD product rotor_arm");

    sqlite.close();
  });

  test("4. `msx install` downloads package and caches pre-compiled `salsa-index.db`", async () => {
    process.env.MODELSCRIPT_API_URL = serverUrl;
    delete process.env.MODELSCRIPT_API_TOKEN; // Test public package download

    const originalCwd = process.cwd();
    process.chdir(consumerDir);

    try {
      await (Install.handler as any)({
        package: pkgName,
        save: true,
      });

      const installedLibDir = path.join(consumerDir, "libraries", "@acme__drone-avionics");
      assert.ok(fs.existsSync(installedLibDir), "Installed library directory must exist");

      // Verify all polyglot files were extracted
      assert.ok(fs.existsSync(path.join(installedLibDir, "models/FlightDynamics.mo")));
      assert.ok(fs.existsSync(path.join(installedLibDir, "sysml/Avionics.sysml")));
      assert.ok(fs.existsSync(path.join(installedLibDir, "cad/MotorChassis.step")));
      assert.ok(fs.existsSync(path.join(installedLibDir, "data/telemetry.csv")));

      // Verify pre-compiled salsa-index.db was downloaded and cached
      const cachedDbPath = path.join(installedLibDir, ".modelscript/salsa-index.db");
      assert.ok(fs.existsSync(cachedDbPath), "Pre-compiled salsa-index.db must be cached locally");
      assert.ok(fs.statSync(cachedDbPath).size > 0, "Cached salsa-index.db must not be empty");

      // Verify package.json dependency was registered
      const consumerPkg = JSON.parse(fs.readFileSync(path.join(consumerDir, "package.json"), "utf-8"));
      assert.equal(consumerPkg.dependencies[pkgName], `^${pkgVersion}`);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("5. Consumer workspace resolves cross-language symbols and verifies twin parity", () => {
    // Modelica model in consumer workspace referencing installed polyglot library
    fs.writeFileSync(
      path.join(consumerDir, "models/MissionPlan.mo"),
      `model MissionPlan
  part motorRef: AvionicsArchitecture::Motor;
  Real planSpeed annotation(twin="AvionicsArchitecture::Motor::maxRpm");
end MissionPlan;`,
      "utf-8",
    );

    const ws = buildPolyglotIndex([], consumerDir);
    assert.ok(ws.files.length >= 4, "Workspace should index consumer and library files");

    // 1. Cross-domain resolution: Resolve SysML2 Motor definition from workspace
    const motorSymId = ws.queryEngine.resolvePolyglotSymbol("AvionicsArchitecture::Motor");
    assert.ok(motorSymId !== null && motorSymId !== undefined, "Must resolve AvionicsArchitecture::Motor");
    const motorEntry = ws.queryEngine.resolveEntry(motorSymId!)!;
    assert.equal(motorEntry.name, "Motor");

    // 2. Resolve STEP CAD product #100 (frame_mount)
    const cadSymId = ws.queryEngine.resolvePolyglotSymbol("frame_mount");
    assert.ok(cadSymId !== null && cadSymId !== undefined, "Must resolve STEP product frame_mount");

    // 3. Resolve Modelica FlightDynamics class
    const flightSymId = ws.queryEngine.resolvePolyglotSymbol("FlightDynamics");
    assert.ok(flightSymId !== null && flightSymId !== undefined, "Must resolve Modelica FlightDynamics");

    // 4. Validate twin linkage and physical quantity compatibility
    const maxRpmSymId = ws.queryEngine.resolvePolyglotSymbol("AvionicsArchitecture::Motor::maxRpm");
    const planSpeedSymId = ws.queryEngine.resolvePolyglotSymbol("MissionPlan::planSpeed");
    assert.ok(maxRpmSymId !== null && maxRpmSymId !== undefined);
    assert.ok(planSpeedSymId !== null && planSpeedSymId !== undefined);

    const parity = ws.queryEngine.physicalQuantityParity(planSpeedSymId!, maxRpmSymId!);
    assert.equal(parity.compatible, true, "Physical quantities must be compatible");
  });

  test("6. Local offline installation via `msx install <archive.msx.zip>` unpacks correctly", async () => {
    const originalCwd = process.cwd();
    process.chdir(offlineConsumerDir);

    try {
      await (Install.handler as any)({
        package: packedZipPath,
        save: true,
      });

      const installedLibDir = path.join(offlineConsumerDir, "libraries", "@acme__drone-avionics");
      assert.ok(fs.existsSync(installedLibDir), "Offline installed library directory must exist");
      assert.ok(fs.existsSync(path.join(installedLibDir, "models/FlightDynamics.mo")));
      assert.ok(fs.existsSync(path.join(installedLibDir, "sysml/Avionics.sysml")));
      assert.ok(fs.existsSync(path.join(installedLibDir, "cad/MotorChassis.step")));

      const offlinePkg = JSON.parse(fs.readFileSync(path.join(offlineConsumerDir, "package.json"), "utf-8"));
      assert.ok(offlinePkg.dependencies[pkgName], "package.json must record file: dependency");
    } finally {
      process.chdir(originalCwd);
    }
  });
});

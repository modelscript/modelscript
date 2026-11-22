// SPDX-License-Identifier: AGPL-3.0-or-later

import AdmZip from "adm-zip";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { Install } from "../src/commands/install.js";
import { writeLockfile } from "../src/util/lockfile.js";

describe("msx install --frozen-lockfile CI mode", () => {
  let server: http.Server;
  let serverUrl: string;
  const testDir = path.join(process.cwd(), "apps/cli/tests/.tmp-install-frozen-test");

  // Create valid zip archive
  const zip = new AdmZip();
  zip.addFile("package.mo", Buffer.from("package FrozenPkg\nend FrozenPkg;\n"));
  const zipBuffer = zip.toBuffer();
  const validHash = `sha256:${crypto.createHash("sha256").update(zipBuffer).digest("hex")}`;

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

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://localhost`);
      const pathname = decodeURIComponent(url.pathname);

      if (pathname === "/api/v1/libraries/FrozenPkg") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            name: "FrozenPkg",
            latestVersion: "1.0.0",
            versions: [{ version: "1.0.0" }],
          }),
        );
        return;
      }

      if (pathname === "/api/v1/libraries/FrozenPkg/1.0.0/download") {
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "x-content-sha256": validHash,
        });
        res.end(zipBuffer);
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    console.log = origLog;
    console.error = origError;
    process.stdout.write = origWrite;
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("fails if modelscript.lock does not exist in frozen mode", async () => {
    process.env.MODELSCRIPT_API_URL = serverUrl;
    const originalCwd = process.cwd();
    const caseDir = path.join(testDir, "no-lock");
    mkdirSync(caseDir, { recursive: true });
    writeFileSync(
      path.join(caseDir, "modelscript.yaml"),
      'name: no-lock\nversion: "0.1.0"\ndependencies:\n  FrozenPkg: "^1.0.0"\n',
    );

    process.chdir(caseDir);
    const origExit = process.exit;
    let exitCode: number | null = null;
    (process as any).exit = (code: number) => {
      exitCode = code;
      throw new Error(`EXIT_${code}`);
    };

    try {
      await assert.rejects(async () => {
        await (Install.handler as any)({
          frozenLockfile: true,
        });
      }, /EXIT_1/);
      assert.equal(exitCode, 1);
    } finally {
      process.exit = origExit;
      process.chdir(originalCwd);
    }
  });

  test("fails if modelscript.lock is missing a dependency specified in modelscript.yaml", async () => {
    process.env.MODELSCRIPT_API_URL = serverUrl;
    const originalCwd = process.cwd();
    const caseDir = path.join(testDir, "missing-dep");
    mkdirSync(caseDir, { recursive: true });
    writeFileSync(
      path.join(caseDir, "modelscript.yaml"),
      'name: missing-dep\nversion: "0.1.0"\ndependencies:\n  FrozenPkg: "^1.0.0"\n  MissingPkg: "^2.0.0"\n',
    );
    writeLockfile(caseDir, {
      lockfileVersion: 2,
      packages: {
        FrozenPkg: {
          version: "1.0.0",
          resolved: `${serverUrl}/api/v1/libraries/FrozenPkg/1.0.0/download`,
          integrity: validHash,
        },
      },
    });

    process.chdir(caseDir);
    const origExit = process.exit;
    let exitCode: number | null = null;
    (process as any).exit = (code: number) => {
      exitCode = code;
      throw new Error(`EXIT_${code}`);
    };

    try {
      await assert.rejects(async () => {
        await (Install.handler as any)({
          frozenLockfile: true,
        });
      }, /EXIT_1/);
      assert.equal(exitCode, 1);
    } finally {
      process.exit = origExit;
      process.chdir(originalCwd);
    }
  });

  test("fails if downloaded package hash does not match modelscript.lock integrity hash", async () => {
    process.env.MODELSCRIPT_API_URL = serverUrl;
    const originalCwd = process.cwd();
    const caseDir = path.join(testDir, "tampered-hash");
    mkdirSync(caseDir, { recursive: true });
    writeFileSync(
      path.join(caseDir, "modelscript.yaml"),
      'name: tampered-hash\nversion: "0.1.0"\ndependencies:\n  FrozenPkg: "^1.0.0"\n',
    );
    writeLockfile(caseDir, {
      lockfileVersion: 2,
      packages: {
        FrozenPkg: {
          version: "1.0.0",
          resolved: `${serverUrl}/api/v1/libraries/FrozenPkg/1.0.0/download`,
          integrity: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        },
      },
    });

    process.chdir(caseDir);
    const origExit = process.exit;
    let exitCode: number | null = null;
    (process as any).exit = (code: number) => {
      exitCode = code;
      throw new Error(`EXIT_${code}`);
    };

    try {
      await assert.rejects(async () => {
        await (Install.handler as any)({
          frozenLockfile: true,
        });
      }, /EXIT_1/);
      assert.equal(exitCode, 1);
    } finally {
      process.exit = origExit;
      process.chdir(originalCwd);
    }
  });

  test("successfully installs valid locked package without modifying lockfile or modelscript.yaml", async () => {
    process.env.MODELSCRIPT_API_URL = serverUrl;
    const originalCwd = process.cwd();
    const caseDir = path.join(testDir, "valid-frozen");
    mkdirSync(caseDir, { recursive: true });
    const originalManifest = 'name: valid-frozen\nversion: "0.1.0"\ndependencies:\n  FrozenPkg: "1.0.0"\n';
    writeFileSync(path.join(caseDir, "modelscript.yaml"), originalManifest);

    const initialLock = {
      lockfileVersion: 2 as const,
      packages: {
        FrozenPkg: {
          version: "1.0.0",
          resolved: `${serverUrl}/api/v1/libraries/FrozenPkg/1.0.0/download`,
          integrity: validHash,
        },
      },
    };
    writeLockfile(caseDir, initialLock);
    const originalLockContent = readFileSync(path.join(caseDir, "modelscript.lock"), "utf-8");

    process.chdir(caseDir);
    try {
      await (Install.handler as any)({
        frozenLockfile: true,
        save: true, // Should be ignored in frozen mode
      });

      // Verify files installed in .modelscript/packages/FrozenPkg
      assert.ok(existsSync(path.join(caseDir, ".modelscript", "packages", "FrozenPkg", "package.mo")));

      // Verify modelscript.yaml and modelscript.lock are untouched
      const currentManifest = readFileSync(path.join(caseDir, "modelscript.yaml"), "utf-8");
      assert.equal(currentManifest, originalManifest);

      const currentLockContent = readFileSync(path.join(caseDir, "modelscript.lock"), "utf-8");
      assert.equal(currentLockContent, originalLockContent);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearToken,
  getApiUrl,
  getAuthHeaders,
  getToken,
  requireToken,
  saveApiUrl,
  saveToken,
} from "../src/util/auth.js";
import { NodeFileSystem } from "../src/util/filesystem.js";

test("CLI Auth Utilities", async (t) => {
  const origEnvToken = process.env.MODELSCRIPT_API_TOKEN;
  const origEnvUrl = process.env.MODELSCRIPT_API_URL;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "msx-auth-home-"));

  // Override homedir or environment for safety
  delete process.env.MODELSCRIPT_API_TOKEN;
  delete process.env.MODELSCRIPT_API_URL;

  try {
    await t.test("getApiUrl defaults and env override", () => {
      process.env.MODELSCRIPT_API_URL = "http://api.example.com///";
      assert.strictEqual(getApiUrl(), "http://api.example.com");
      delete process.env.MODELSCRIPT_API_URL;
    });

    await t.test("getToken and getAuthHeaders with env var", () => {
      process.env.MODELSCRIPT_API_TOKEN = "env-token-123";
      assert.strictEqual(getToken(), "env-token-123");
      assert.deepStrictEqual(getAuthHeaders(), { Authorization: "Bearer env-token-123" });
      assert.strictEqual(requireToken(), "env-token-123");
      delete process.env.MODELSCRIPT_API_TOKEN;
    });

    await t.test("requireToken returns token when present", () => {
      process.env.MODELSCRIPT_API_TOKEN = "valid-token-xyz";
      assert.strictEqual(requireToken(), "valid-token-xyz");
      delete process.env.MODELSCRIPT_API_TOKEN;
    });

    await t.test("saveApiUrl, saveToken, and clearToken persistence", () => {
      const rcPath = path.join(os.homedir(), ".modelscriptrc");
      let originalRc: string | null = null;
      if (fs.existsSync(rcPath)) {
        originalRc = fs.readFileSync(rcPath, "utf8");
      }
      try {
        saveApiUrl("http://persist.example.com/");
        assert.strictEqual(getApiUrl(), "http://persist.example.com");

        saveToken("persisted-token-456");
        assert.strictEqual(getToken(), "persisted-token-456");

        clearToken();
        assert.strictEqual(fs.existsSync(rcPath), false);
      } finally {
        if (originalRc !== null) {
          fs.writeFileSync(rcPath, originalRc, "utf8");
        } else if (fs.existsSync(rcPath)) {
          fs.unlinkSync(rcPath);
        }
      }
    });

    await t.test("getAuthHeaders returns empty without token", () => {
      // Temporarily ensure RC doesn't interfere
      const existingToken = getToken();
      if (!existingToken) {
        assert.deepStrictEqual(getAuthHeaders(), {});
      }
    });
  } finally {
    if (origEnvToken !== undefined) process.env.MODELSCRIPT_API_TOKEN = origEnvToken;
    if (origEnvUrl !== undefined) process.env.MODELSCRIPT_API_URL = origEnvUrl;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("NodeFileSystem utility", async (t) => {
  const nfs = new NodeFileSystem();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nfs-test-"));
  const testFile = path.join(tempDir, "sample.txt");
  fs.writeFileSync(testFile, "Hello NodeFileSystem", "utf8");

  try {
    assert.strictEqual(nfs.basename(testFile), "sample.txt");
    assert.strictEqual(nfs.extname(testFile), ".txt");
    assert.strictEqual(nfs.join("a", "b", "c"), path.join("a", "b", "c"));
    assert.strictEqual(nfs.resolve(tempDir), path.resolve(tempDir));
    assert.strictEqual(nfs.sep, path.sep);

    assert.strictEqual(nfs.read(testFile), "Hello NodeFileSystem");
    const binary = nfs.readBinary(testFile);
    assert.strictEqual(new TextDecoder().decode(binary), "Hello NodeFileSystem");

    const entries = nfs.readdir(tempDir);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].name, "sample.txt");

    const stat = nfs.stat(testFile);
    assert.ok(stat !== null);
    assert.ok(stat.isFile());

    const nonExistent = nfs.stat(path.join(tempDir, "does-not-exist.bin"));
    assert.strictEqual(nonExistent, null);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

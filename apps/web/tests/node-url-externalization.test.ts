// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, format, pathToFileURL } from "../src/util/node-url-shim.js";

describe("Browser node:url shim & Vite bundle resolution", () => {
  it("fileURLToPath correctly decodes file URLs in browser environment", () => {
    assert.strictEqual(fileURLToPath("file:///home/user/model.mo"), "/home/user/model.mo");
    assert.strictEqual(fileURLToPath(new URL("file:///home/user/model.mo")), "/home/user/model.mo");
    assert.strictEqual(fileURLToPath("file:///c:/path/with%20spaces/model.mo"), "/c:/path/with spaces/model.mo");
  });

  it("fileURLToPath handles web URLs and relative paths gracefully", () => {
    assert.strictEqual(fileURLToPath("http://localhost:3001/assets/model.mo"), "/assets/model.mo");
    assert.strictEqual(fileURLToPath("/local/path/model.mo"), "/local/path/model.mo");
    assert.strictEqual(fileURLToPath(""), "");
  });

  it("pathToFileURL creates a valid file URL object", () => {
    const url = pathToFileURL("/home/user/model.mo");
    assert.strictEqual(url.protocol, "file:");
    assert.strictEqual(url.pathname, "/home/user/model.mo");
  });

  it("format formats URL objects and strings", () => {
    const url = new URL("https://ansatz.social/explore");
    assert.strictEqual(format(url), "https://ansatz.social/explore");
    assert.strictEqual(format("https://ansatz.social"), "https://ansatz.social");
  });

  it("vite.config.ts configures alias for node:url and url modules", () => {
    const viteConfigPath = path.resolve(import.meta.dirname, "../vite.config.ts");
    const content = fs.readFileSync(viteConfigPath, "utf-8");
    assert.match(content, /node-url-shim/);
    assert.match(content, /\^node:url\$/);
    assert.match(content, /\^url\$/);
    assert.match(content, /node-shims/);
    assert.match(content, /\^node:child_process\$/);
    assert.match(content, /\^child_process\$/);
    assert.match(content, /\^node:fs\$/);
    assert.match(content, /\^fs\$/);
    assert.match(content, /\^node:os\$/);
    assert.match(content, /\^os\$/);
    assert.match(content, /\^node:path\$/);
    assert.match(content, /\^path\$/);
  });

  it("node-shims provides browser-safe stubs without throwing on access", async () => {
    const nodeShims = await import("../src/util/node-shims.js");
    assert.strictEqual(typeof nodeShims.spawn, "function");
    assert.strictEqual(typeof nodeShims.execSync, "function");
    assert.strictEqual(typeof nodeShims.existsSync, "function");
    assert.strictEqual(typeof nodeShims.readFileSync, "function");
    assert.strictEqual(typeof nodeShims.join, "function");
    assert.strictEqual(typeof nodeShims.resolve, "function");
    assert.strictEqual(nodeShims.existsSync("/any/path"), false);
    assert.strictEqual(nodeShims.join("a", "b"), "a/b");
    const child = nodeShims.spawn("olga");
    assert.strictEqual(typeof child.on, "function");
  });
});

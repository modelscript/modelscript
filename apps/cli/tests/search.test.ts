// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before, describe } from "node:test";
import { Search, searchRegistryPackages } from "../src/commands/search.js";

describe("msx search CLI command", () => {
  let server: http.Server;
  let serverUrl: string;
  let failPrimary = false;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");

      if (url.pathname === "/api/v1/libraries") {
        if (failPrimary) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Service unavailable" }));
          return;
        }
        const q = (url.searchParams.get("q") || "").toLowerCase();
        const catalog = [
          {
            name: "Modelica",
            latestVersion: "4.1.0",
            description: "Modelica Standard Library",
            domains: ["modelica", "physical"],
            totalDownloads: 1200,
          },
          {
            name: "@acausal/thermo",
            latestVersion: "2.3.1",
            description: "Thermodynamic fluid networks",
            domains: ["modelica", "fluid"],
            totalDownloads: 340,
          },
          {
            name: "ThermalControl",
            latestVersion: "1.0.0",
            description: "PID thermal control blocks",
            domains: ["control"],
            totalDownloads: 85,
          },
        ];
        const filtered = catalog.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            p.domains.some((d) => d.includes(q)),
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ packages: filtered }));
        return;
      }

      if (url.pathname === "/api/v1/npm/-/v1/search") {
        const text = (url.searchParams.get("text") || "").toLowerCase();
        const objects = [
          {
            package: {
              name: "FallbackPkg",
              version: "0.9.0",
              description: "Returned from npm-compatible fallback search",
              date: "2026-01-01T00:00:00.000Z",
            },
          },
        ].filter(
          (o) => o.package.name.toLowerCase().includes(text) || o.package.description.toLowerCase().includes(text),
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ objects, total: objects.length }));
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("queries /api/v1/libraries?q=... and respects --limit", async () => {
    failPrimary = false;
    const res = await searchRegistryPackages("modelica", { apiUrl: serverUrl, limit: 1, token: null });
    assert.strictEqual(res.source, "libraries");
    assert.strictEqual(res.total, 2);
    assert.strictEqual(res.results.length, 1);
    assert.strictEqual(res.results[0]?.name, "Modelica");
    assert.strictEqual(res.results[0]?.version, "4.1.0");
  });

  test("falls back gracefully to /api/v1/npm/-/v1/search when /api/v1/libraries fails", async () => {
    failPrimary = true;
    try {
      const res = await searchRegistryPackages("fallback", { apiUrl: serverUrl, limit: 10, token: null });
      assert.strictEqual(res.source, "npm");
      assert.strictEqual(res.total, 1);
      assert.strictEqual(res.results[0]?.name, "FallbackPkg");
      assert.strictEqual(res.results[0]?.version, "0.9.0");
    } finally {
      failPrimary = false;
    }
  });

  test("handler prints valid JSON in --json mode and formatted table in default mode", async () => {
    failPrimary = false;
    const prevUrl = process.env["MODELSCRIPT_API_URL"];
    process.env["MODELSCRIPT_API_URL"] = serverUrl;

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await Search.handler({
        _: ["search"],
        $0: "msx",
        query: "thermo",
        limit: 5,
        json: true,
      });

      const parsed = JSON.parse(logs.join("\n")) as {
        query: string;
        source: string;
        results: Array<{ name: string; version: string }>;
      };
      assert.strictEqual(parsed.query, "thermo");
      assert.strictEqual(parsed.source, "libraries");
      assert.strictEqual(parsed.results[0]?.name, "@acausal/thermo");

      logs.length = 0;
      await Search.handler({
        _: ["search"],
        $0: "msx",
        query: "thermo",
        limit: 5,
        json: false,
      });
      const tableOut = logs.join("\n");
      assert.ok(tableOut.includes("PACKAGE"), "Should print table header");
      assert.ok(tableOut.includes("@acausal/thermo"), "Should include matching package name");
      assert.ok(tableOut.includes("2.3.1"), "Should include package version");
    } finally {
      console.log = origLog;
      if (prevUrl === undefined) {
        delete process.env["MODELSCRIPT_API_URL"];
      } else {
        process.env["MODELSCRIPT_API_URL"] = prevUrl;
      }
    }
  });
});

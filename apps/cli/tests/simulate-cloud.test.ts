// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { describe } from "node:test";
import { simulateCloud } from "../src/commands/simulate-cloud.js";
import type { SimulateArgs } from "../src/commands/simulate.js";

describe("CLI Cloud Bursting (msx simulate --cloud)", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "msx-cloud-test-"));
  const modelFile = path.join(tempDir, "SimpleRLC.mo");
  fs.writeFileSync(
    modelFile,
    `
model SimpleRLC
  Real x(start=1.0);
equation
  der(x) = -x;
end SimpleRLC;
    `.trim(),
    "utf-8",
  );

  test("fails fast if no authentication token is available", async () => {
    const origToken = process.env.MODELSCRIPT_API_TOKEN;
    delete process.env.MODELSCRIPT_API_TOKEN;

    const args: SimulateArgs = {
      name: "SimpleRLC",
      paths: [modelFile],
      cloud: true,
      format: "csv",
      solver: "dopri5",
      engine: "js",
      jacobian: "sparse",
    };

    await assert.rejects(async () => {
      await simulateCloud(args, { exitOnError: false });
    }, /Authentication required for cloud bursting/);

    if (origToken) process.env.MODELSCRIPT_API_TOKEN = origToken;
  });

  test("submits simulation job with proper headers and payload", async () => {
    process.env.MODELSCRIPT_API_TOKEN = "test-token-12345";

    let receivedHeaders: http.IncomingHttpHeaders = {};
    let receivedBody = "";

    const server = http.createServer(async (req, res) => {
      receivedHeaders = req.headers;
      if (req.method === "POST" && req.url === "/api/v1/simulate") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          receivedBody = body;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jobId: "job-test-999" }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const apiUrl = `http://127.0.0.1:${port}`;

    try {
      const args: SimulateArgs = {
        name: "SimpleRLC",
        paths: [modelFile],
        cloud: true,
        async: true,
        profile: "gpu-a100",
        apiUrl,
        format: "csv",
        solver: "dopri5",
        engine: "js",
        jacobian: "sparse",
      };

      const result = await simulateCloud(args, { exitOnError: false });
      assert.equal(result.jobId, "job-test-999");

      assert.equal(receivedHeaders.authorization, "Bearer test-token-12345");
      assert.equal(receivedHeaders["content-type"], "application/json");

      const parsed = JSON.parse(receivedBody);
      assert.equal(parsed.modelName, "SimpleRLC");
      assert.equal(parsed.profile, "gpu-a100");
      assert.ok(parsed.modelSource.includes("model SimpleRLC"));
    } finally {
      server.close();
    }
  });

  test("handles 402 Payment Required when compute credits are insufficient", async () => {
    process.env.MODELSCRIPT_API_TOKEN = "test-token-12345";

    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/v1/simulate") {
        res.writeHead(402, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Payment Required: Insufficient Compute Credits",
            message: "User wallet has 0.10 credits, but profile 'hpc-mpi-64' requires 15.00 credits.",
            balance: 0.1,
            required: 15.0,
            profile: "hpc-mpi-64",
          }),
        );
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const apiUrl = `http://127.0.0.1:${port}`;

    try {
      const args: SimulateArgs = {
        name: "SimpleRLC",
        paths: [modelFile],
        cloud: true,
        profile: "hpc-mpi-64",
        apiUrl,
        format: "csv",
        solver: "dopri5",
        engine: "js",
        jacobian: "sparse",
      };

      await assert.rejects(async () => {
        await simulateCloud(args, { exitOnError: false });
      }, /Payment Required \(402\) - Insufficient Compute Credits/);
    } finally {
      server.close();
    }
  });

  test("polls job until SUCCESS, downloads result and saves to disk", async () => {
    process.env.MODELSCRIPT_API_TOKEN = "test-token-12345";

    let pollCount = 0;
    const csvContent = "time,x\n0.0,1.0\n0.1,0.9048\n0.2,0.8187\n";

    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/v1/simulate") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jobId: "job-sync-100" }));
      } else if (req.method === "GET" && req.url === "/api/v1/simulate/job-sync-100") {
        pollCount++;
        if (pollCount === 1) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "QUEUED" }));
        } else if (pollCount === 2) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "RUNNING" }));
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "SUCCESS",
              usage: { costCredits: 0.25, exitCode: 0 },
            }),
          );
        }
      } else if (req.method === "GET" && req.url === "/api/v1/simulate/job-sync-100/result") {
        res.writeHead(200, { "Content-Type": "text/csv" });
        res.end(csvContent);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const apiUrl = `http://127.0.0.1:${port}`;
    const outDir = path.join(tempDir, "out-results");

    try {
      const args: SimulateArgs = {
        name: "SimpleRLC",
        paths: [modelFile],
        cloud: true,
        async: false,
        pollInterval: 10,
        outputDir: outDir,
        apiUrl,
        format: "csv",
        solver: "dopri5",
        engine: "js",
        jacobian: "sparse",
      };

      const result = await simulateCloud(args, { exitOnError: false });
      assert.equal(result.jobId, "job-sync-100");
      assert.equal(result.costCredits, 0.25);
      assert.ok(result.resultPath && fs.existsSync(result.resultPath));
      assert.equal(fs.readFileSync(result.resultPath, "utf-8"), csvContent);
    } finally {
      server.close();
    }
  });
});

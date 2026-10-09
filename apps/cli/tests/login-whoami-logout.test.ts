// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { Login } from "../src/commands/login.js";
import { Logout } from "../src/commands/logout.js";
import { WhoAmI } from "../src/commands/whoami.js";
import { clearToken, getToken } from "../src/util/auth.js";

describe("msx login, whoami, and logout CLI commands", () => {
  let server: http.Server;
  let serverUrl: string;

  const originalRcPath = path.join(os.homedir(), ".modelscriptrc");
  let originalRcContent: string | null = null;
  const originalApiToken = process.env.MODELSCRIPT_API_TOKEN;
  const originalAuthToken = process.env.MODELSCRIPT_AUTH_TOKEN;

  before(async () => {
    delete process.env.MODELSCRIPT_API_TOKEN;
    delete process.env.MODELSCRIPT_AUTH_TOKEN;

    if (fs.existsSync(originalRcPath)) {
      originalRcContent = fs.readFileSync(originalRcPath, "utf8");
    }

    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://localhost");

      // GET /api/v1/auth/me
      if (url.pathname === "/api/v1/auth/me") {
        const auth = req.headers.authorization;
        if (auth === "Bearer valid-token-alice" || auth === "Bearer 2fa-session-token") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              user: {
                id: 101,
                username: "alice",
                email: "alice@example.com",
                display_name: "Alice Engineer",
                role: "user",
                totp_enabled: false,
              },
            }),
          );
          return;
        }

        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or expired token" }));
        return;
      }

      // POST /api/v1/auth/login
      if (url.pathname === "/api/v1/auth/login" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const payload = JSON.parse(body);
          if (payload.email === "alice@example.com" && payload.password === "correct-password") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                token: "valid-token-alice",
                user: { username: "alice", email: "alice@example.com" },
              }),
            );
            return;
          }

          if (payload.email === "bob@example.com" && payload.password === "2fa-password") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                requires2FA: true,
                tempToken: "temp-2fa-token-bob",
                message: "Two-factor authentication code required",
              }),
            );
            return;
          }

          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid email or password" }));
        });
        return;
      }

      // POST /api/v1/auth/2fa/challenge
      if (url.pathname === "/api/v1/auth/2fa/challenge" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const payload = JSON.parse(body);
          if (payload.tempToken === "temp-2fa-token-bob" && payload.code === "123456") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                token: "2fa-session-token",
                user: { username: "bob", email: "bob@example.com" },
              }),
            );
            return;
          }

          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid two-factor code" }));
        });
        return;
      }

      // POST /api/v1/auth/logout
      if (url.pathname === "/api/v1/auth/logout" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address();
        if (typeof addr === "object" && addr !== null) {
          serverUrl = `http://localhost:${addr.port}`;
        }
        resolve();
      });
    });
  });

  after(() => {
    server?.close();
    clearToken();
    if (originalRcContent !== null) {
      fs.writeFileSync(originalRcPath, originalRcContent, "utf8");
    }
    if (originalApiToken !== undefined) process.env.MODELSCRIPT_API_TOKEN = originalApiToken;
    if (originalAuthToken !== undefined) process.env.MODELSCRIPT_AUTH_TOKEN = originalAuthToken;
  });

  test("msx login --token stores credentials directly", async () => {
    clearToken();

    // Invoke Login handler with direct token
    await (Login.handler as any)({
      token: "valid-token-alice",
      registry: serverUrl,
    });

    assert.strictEqual(getToken(), "valid-token-alice");
  });

  test("msx whoami prints user profile and JSON output", async () => {
    // Intercept console.log
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      // 1. Human-readable format
      await (WhoAmI.handler as any)({
        registry: serverUrl,
      });

      const humanOutput = logs.join("\n");
      assert.ok(humanOutput.includes("alice"), "Output should contain username");
      assert.ok(humanOutput.includes("alice@example.com"), "Output should contain email");
      assert.ok(humanOutput.includes("Alice Engineer"), "Output should contain display name");

      // 2. JSON format
      logs.length = 0;
      await (WhoAmI.handler as any)({
        registry: serverUrl,
        json: true,
      });

      const parsed = JSON.parse(logs.join(""));
      assert.strictEqual(parsed.authenticated, true);
      assert.strictEqual(parsed.user.username, "alice");
      assert.strictEqual(parsed.user.email, "alice@example.com");
    } finally {
      console.log = origLog;
    }
  });

  test("msx login with email and password", async () => {
    clearToken();

    await (Login.handler as any)({
      email: "alice@example.com",
      password: "correct-password",
      registry: serverUrl,
    });

    assert.strictEqual(getToken(), "valid-token-alice");
  });

  test("msx login with 2FA challenge flow", async () => {
    clearToken();

    await (Login.handler as any)({
      email: "bob@example.com",
      password: "2fa-password",
      otp: "123456",
      registry: serverUrl,
    });

    assert.strictEqual(getToken(), "2fa-session-token");
  });

  test("msx logout invalidates and clears credentials", async () => {
    assert.ok(getToken(), "Token should exist before logout");

    await (Logout.handler as any)({
      registry: serverUrl,
    });

    assert.strictEqual(getToken(), undefined, "Token should be cleared after logout");
  });
});

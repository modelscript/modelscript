// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import { AlmConnectorRegistry, normalizeRemoteDependency } from "@modelscript/runtime";
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import {
  ENTERPRISE_DESKTOP_BRIDGE_CONFIGS,
  generateLicenseKeyPair,
  registerEnterpriseDesktopConnectors,
  signEnterpriseLicense,
} from "../src/index.js";

describe("Enterprise-Only Desktop & Licensed Bridge Adapters", () => {
  let server: http.Server;
  let baseUrl: string;
  const origEdition = process.env["MSX_EDITION"];
  const origLicense = process.env["MSX_LICENSE_KEY"];
  const origPubKey = process.env["MSX_LICENSE_PUBLIC_KEY"];

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ version: "Creo 11.0 J-Link" }));
        return;
      }
      if (url.pathname === "/artifacts") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            artifacts: [{ externalId: "ASM-001", title: "Battery Enclosure", status: "Released", revision: "C" }],
            links: [{ sourceId: "ASM-001", targetId: "PART-002", relation: "derivesFrom" }],
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (origEdition === undefined) delete process.env["MSX_EDITION"];
    else process.env["MSX_EDITION"] = origEdition;
    if (origLicense === undefined) delete process.env["MSX_LICENSE_KEY"];
    else process.env["MSX_LICENSE_KEY"] = origLicense;
    if (origPubKey === undefined) delete process.env["MSX_LICENSE_PUBLIC_KEY"];
    else process.env["MSX_LICENSE_PUBLIC_KEY"] = origPubKey;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("blocks desktop bridges when MSX_EDITION=ce or license is missing", async () => {
    const reg = new AlmConnectorRegistry();
    const registered = registerEnterpriseDesktopConnectors(reg);
    assert.equal(registered.length, ENTERPRISE_DESKTOP_BRIDGE_CONFIGS.length);
    assert.ok(reg.has("creo"));
    assert.ok(reg.has("nx"));
    assert.ok(reg.has("solidworks"));
    assert.ok(reg.has("solidworks-pdm"));
    assert.ok(reg.has("doors-classic"));
    assert.ok(reg.has("volta"));
    assert.ok(reg.has("mathematica"));

    process.env["MSX_EDITION"] = "ce";
    const creo = reg.get("creo")!;
    const spec = { ...normalizeRemoteDependency(`creo+${baseUrl}`)!, packageName: "@cad/creo" };
    await assert.rejects(() => creo.fetchDelta(spec, {}), /requires ModelScript Enterprise Edition/);
  });

  it("allows desktop bridge sync with a valid Enterprise plm_connectors license", async () => {
    const keys = generateLicenseKeyPair();
    const token = signEnterpriseLicense(
      {
        iss: "modelscript.org",
        sub: "acme-aero",
        org: "Acme Aerospace",
        tier: "enterprise",
        features: ["plm_connectors"],
        seats: 25,
        iat: Math.floor(Date.now() / 1000) - 60,
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      keys.privateKeyPem,
    );
    process.env["MSX_EDITION"] = "ee";
    process.env["MSX_LICENSE_PUBLIC_KEY"] = keys.publicKeyPem;
    process.env["MSX_LICENSE_KEY"] = token;

    const reg = new AlmConnectorRegistry();
    registerEnterpriseDesktopConnectors(reg);
    const creo = reg.get("creo")!;
    const spec = { ...normalizeRemoteDependency(`creo+${baseUrl}`)!, packageName: "@cad/creo" };

    const caps = await creo.discover(spec, {});
    assert.equal(caps.protocol, "creo");
    assert.equal(caps.serverVersion, "Creo 11.0 J-Link");

    const delta = await creo.fetchDelta(spec, {});
    assert.equal(delta.upserted.length, 1);
    assert.equal(delta.upserted[0]!.externalId, "ASM-001");
    assert.equal(delta.links[0]!.targetId, "PART-002");
  });
});

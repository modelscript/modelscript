// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import express from "express";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { mountEnterpriseHpcAndBilling } from "../src/hpc-billing/hpc-governance.js";
import { requireEnterpriseFeature } from "../src/license/middleware.js";

async function withServer(app: express.Express, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("Enterprise HPC & Billing Route Prefix Enforcement", () => {
  const noop: express.RequestHandler = (_req, _res, next) => next();

  it("mounts cleanly when all routes match guarded /cae, /cloud, /hpc, and /billing prefixes", () => {
    const app = express();
    const caeRouter = express.Router();
    caeRouter.get("/cae/profiles", (_req, res) => res.json({ ok: true }));

    const cloudRouter = express.Router();
    cloudRouter.post(["/cloud/jobs", "/hpc/jobs"], (_req, res) => res.json({ ok: true }));

    const billingRouter = express.Router();
    billingRouter.get("/billing/wallet", (_req, res) => res.json({ ok: true }));

    assert.doesNotThrow(() =>
      mountEnterpriseHpcAndBilling(app, {
        optionalAuthMiddleware: noop,
        caeFeatureGuard: noop,
        billingFeatureGuard: noop,
        caeRouter,
        cloudRouter,
        billingRouter,
      }),
    );
  });

  it("throws at startup if a sub-route would bypass slurm_hpc license middleware", () => {
    const app = express();
    const caeRouter = express.Router();
    const cloudRouter = express.Router();
    cloudRouter.post("/unprotected/jobs", (_req, res) => res.json({ ok: true }));
    const billingRouter = express.Router();

    assert.throws(
      () =>
        mountEnterpriseHpcAndBilling(app, {
          optionalAuthMiddleware: noop,
          caeFeatureGuard: noop,
          billingFeatureGuard: noop,
          caeRouter,
          cloudRouter,
          billingRouter,
        }),
      /would bypass slurm_hpc license enforcement/,
    );
  });

  it("requireEnterpriseFeature exemptPaths allows exact /cluster/status and blocks /evil/cluster/status", async () => {
    const prevEnforce = process.env["MSX_LICENSE_ENFORCE"];
    const prevKey = process.env["MSX_LICENSE_KEY"];
    const prevFile = process.env["MSX_LICENSE_FILE"];
    process.env["MSX_LICENSE_ENFORCE"] = "true";
    delete process.env["MSX_LICENSE_KEY"];
    delete process.env["MSX_LICENSE_FILE"];

    try {
      const app = express();
      app.use("/api/v1/cae", requireEnterpriseFeature("slurm_hpc", { exemptPaths: ["/cluster/status"] }));
      app.get("/api/v1/cae/cluster/status", (_req, res) => res.status(200).json({ status: "ok" }));
      app.get("/api/v1/cae/evil/cluster/status", (_req, res) => res.status(200).json({ status: "bypassed" }));

      await withServer(app, async (baseUrl) => {
        const exemptRes = await fetch(`${baseUrl}/api/v1/cae/cluster/status`);
        assert.equal(exemptRes.status, 200);
        const exemptBody = (await exemptRes.json()) as { status: string };
        assert.equal(exemptBody.status, "ok");

        const evilRes = await fetch(`${baseUrl}/api/v1/cae/evil/cluster/status`);
        assert.equal(evilRes.status, 402, "Prefix-bypass path /evil/cluster/status must be blocked by license guard");
        const evilBody = (await evilRes.json()) as { code: string };
        assert.equal(evilBody.code, "EE_LICENSE_INVALID");
      });
    } finally {
      if (prevEnforce === undefined) delete process.env["MSX_LICENSE_ENFORCE"];
      else process.env["MSX_LICENSE_ENFORCE"] = prevEnforce;
      if (prevKey === undefined) delete process.env["MSX_LICENSE_KEY"];
      else process.env["MSX_LICENSE_KEY"] = prevKey;
      if (prevFile === undefined) delete process.env["MSX_LICENSE_FILE"];
      else process.env["MSX_LICENSE_FILE"] = prevFile;
    }
  });

  it("mountEnterpriseHpcAndBilling exempts /webhook from billingFeatureGuard so Stripe webhook POSTs reach billingRouter", async () => {
    const prevEnforce = process.env["MSX_LICENSE_ENFORCE"];
    const prevKey = process.env["MSX_LICENSE_KEY"];
    const prevFile = process.env["MSX_LICENSE_FILE"];
    delete process.env["MSX_LICENSE_ENFORCE"];
    delete process.env["MSX_LICENSE_KEY"];
    delete process.env["MSX_LICENSE_FILE"];

    try {
      const app = express();
      app.use(express.json());

      const caeRouter = express.Router();
      caeRouter.get("/cae/profiles", (_req, res) => res.json({ ok: true }));

      const cloudRouter = express.Router();
      cloudRouter.post("/cloud/jobs", (_req, res) => res.json({ ok: true }));

      const billingRouter = express.Router();
      billingRouter.post("/billing/webhook", (_req, res) => res.status(200).json({ received: true }));
      billingRouter.get("/billing/wallet", (_req, res) => res.status(200).json({ ok: true }));

      // Simulate a feature guard that returns 404 when billing UI/API flag is disabled
      const blockingBillingGuard: express.RequestHandler = (_req, res) => {
        res.status(404).json({ error: "Feature not enabled" });
      };

      mountEnterpriseHpcAndBilling(app, {
        optionalAuthMiddleware: noop,
        caeFeatureGuard: noop,
        billingFeatureGuard: blockingBillingGuard,
        caeRouter,
        cloudRouter,
        billingRouter,
      });

      await withServer(app, async (baseUrl) => {
        const webhookRes = await fetch(`${baseUrl}/api/v1/billing/webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: "evt_test_1", type: "payment_intent.succeeded" }),
        });
        assert.equal(webhookRes.status, 200, "POST /api/v1/billing/webhook must bypass billingFeatureGuard");
        const webhookBody = (await webhookRes.json()) as { received: boolean };
        assert.equal(webhookBody.received, true);

        const walletRes = await fetch(`${baseUrl}/api/v1/billing/wallet`);
        assert.equal(walletRes.status, 404, "Non-webhook billing routes must still be gated by billingFeatureGuard");
      });
    } finally {
      if (prevEnforce === undefined) delete process.env["MSX_LICENSE_ENFORCE"];
      else process.env["MSX_LICENSE_ENFORCE"] = prevEnforce;
      if (prevKey === undefined) delete process.env["MSX_LICENSE_KEY"];
      else process.env["MSX_LICENSE_KEY"] = prevKey;
      if (prevFile === undefined) delete process.env["MSX_LICENSE_FILE"];
      else process.env["MSX_LICENSE_FILE"] = prevFile;
    }
  });
});

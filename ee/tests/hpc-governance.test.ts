// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise

import express from "express";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mountEnterpriseHpcAndBilling } from "../src/hpc-billing/hpc-governance.js";

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
});

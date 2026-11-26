// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  api,
  createCheckoutSession,
  createPaymentIntent,
  fetchInvoiceHtml,
  getJobTemplates,
  getUnifiedUserJobs,
  getUserHpcJobs,
} from "../src/api";
import { BUILTIN_HPC_TEMPLATES } from "../src/components/cloud-sim/hpcTemplates";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, "../src");

interface CapturedRequest {
  method: string;
  url: string;
  data?: unknown;
  config?: {
    headers?: Record<string, string>;
    params?: Record<string, unknown>;
    responseType?: string;
  };
}

describe("Billing & HPC Web UI — Production Readiness Remediation Suite", () => {
  const originalGet = api.get.bind(api);
  const originalPost = api.post.bind(api);
  let capturedRequests: CapturedRequest[] = [];

  beforeEach(() => {
    capturedRequests = [];
  });

  afterEach(() => {
    (api as unknown as Record<string, unknown>)["get"] = originalGet;
    (api as unknown as Record<string, unknown>)["post"] = originalPost;
  });

  function mockApiGet(handler: (url: string, config?: CapturedRequest["config"]) => Promise<unknown> | unknown) {
    (api as unknown as Record<string, unknown>)["get"] = async (url: string, config?: CapturedRequest["config"]) => {
      capturedRequests.push({ method: "get", url, config });
      const data = await handler(url, config);
      return { data };
    };
  }

  function mockApiPost(
    handler: (url: string, data?: unknown, config?: CapturedRequest["config"]) => Promise<unknown> | unknown,
  ) {
    (api as unknown as Record<string, unknown>)["post"] = async (
      url: string,
      body?: unknown,
      config?: CapturedRequest["config"],
    ) => {
      capturedRequests.push({ method: "post", url, data: body, config });
      const data = await handler(url, body, config);
      return { data };
    };
  }

  describe("1. Billing API Client (apps/web/src/api/billing.ts)", () => {
    it("createPaymentIntent sends an auto-generated Idempotency-Key header and returns PaymentIntentResult with paymentIntentId", async () => {
      mockApiPost(() => ({
        success: true,
        clientSecret: "pi_3ABC_secret_xyz",
        paymentIntentId: "pi_3ABC",
        amountCents: 20000,
        requires3DS: false,
        status: "requires_payment_method",
      }));

      const result = await createPaymentIntent(200);

      assert.equal(capturedRequests.length, 1);
      const req = capturedRequests[0]!;
      assert.equal(req.method, "post");
      assert.equal(req.url, "/billing/payment-intent");
      assert.deepEqual(req.data, { amount: 200 });
      const idempotencyKey = req.config?.headers?.["Idempotency-Key"];
      assert.equal(typeof idempotencyKey, "string", "Idempotency-Key header must be a string");
      assert.ok(idempotencyKey && idempotencyKey.length > 0, "Idempotency-Key header must be non-empty");

      assert.equal(result.success, true);
      assert.equal(result.paymentIntentId, "pi_3ABC");
      assert.equal(result.clientSecret, "pi_3ABC_secret_xyz");
      assert.equal(result.amountCents, 20000);
    });

    it("createPaymentIntent preserves a caller-supplied Idempotency-Key", async () => {
      mockApiPost(() => ({
        success: true,
        clientSecret: "pi_custom_secret",
        paymentIntentId: "pi_custom",
        amountCents: 5000,
        requires3DS: true,
        status: "requires_action",
      }));

      const result = await createPaymentIntent(50, "idem-key-fixed-123");

      assert.equal(capturedRequests[0]?.config?.headers?.["Idempotency-Key"], "idem-key-fixed-123");
      assert.equal(result.paymentIntentId, "pi_custom");
      assert.equal(result.requires3DS, true);
    });

    it("createCheckoutSession sends an Idempotency-Key header and forwards orgId, successUrl, and cancelUrl", async () => {
      mockApiPost(() => ({
        success: true,
        sessionId: "cs_test_987654",
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_987654",
        amountCredits: 500,
        amountCents: 50000,
        automaticTax: true,
      }));

      const session = await createCheckoutSession(500, 42, {
        idempotencyKey: "checkout-idem-42",
        successUrl: "https://ansatz.social/settings/billing?checkout=success",
        cancelUrl: "https://ansatz.social/settings/billing?checkout=cancelled",
      });

      assert.equal(capturedRequests.length, 1);
      const req = capturedRequests[0]!;
      assert.equal(req.method, "post");
      assert.equal(req.url, "/billing/checkout-session");
      assert.equal(req.config?.headers?.["Idempotency-Key"], "checkout-idem-42");
      assert.deepEqual(req.data, {
        amount: 500,
        orgId: 42,
        successUrl: "https://ansatz.social/settings/billing?checkout=success",
        cancelUrl: "https://ansatz.social/settings/billing?checkout=cancelled",
      });
      assert.equal(session.sessionId, "cs_test_987654");
      assert.equal(session.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_test_987654");
    });

    it("createCheckoutSession auto-generates an Idempotency-Key when options are omitted", async () => {
      mockApiPost(() => ({
        success: true,
        sessionId: "cs_test_auto",
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_auto",
        amountCredits: 50,
        amountCents: 5000,
        automaticTax: false,
      }));

      await createCheckoutSession(50);

      const req = capturedRequests[0]!;
      assert.deepEqual(req.data, { amount: 50 });
      const key = req.config?.headers?.["Idempotency-Key"];
      assert.equal(typeof key, "string");
      assert.ok(key && key.length > 0, "Auto-generated Idempotency-Key must be non-empty");
    });

    it("fetchInvoiceHtml calls /billing/invoices/:txId via authenticated Axios client with responseType: 'text'", async () => {
      const sampleHtml = "<!doctype html><html><body><h1>Invoice #1042</h1></body></html>";
      mockApiGet(() => sampleHtml);

      const html = await fetchInvoiceHtml(1042);

      assert.equal(capturedRequests.length, 1);
      const req = capturedRequests[0]!;
      assert.equal(req.method, "get");
      assert.equal(req.url, "/billing/invoices/1042");
      assert.equal(req.config?.responseType, "text");
      assert.ok(
        req.config?.headers?.["Accept"]?.includes("text/html"),
        "fetchInvoiceHtml must request text/html via Accept header",
      );
      assert.equal(html, sampleHtml);
    });

    it("fetchInvoiceHtml URL-encodes special characters in txId", async () => {
      mockApiGet(() => "<html>OK</html>");
      await fetchInvoiceHtml("tx/2026#99");
      assert.equal(capturedRequests[0]?.url, "/billing/invoices/tx%2F2026%2399");
    });
  });

  describe("2. Compute API Client (apps/web/src/api/compute.ts)", () => {
    it("getUnifiedUserJobs maps CAE 'CANCELLED' -> 'cancelled' and 'PENDING' -> 'queued' (not 'running')", async () => {
      mockApiGet((url) => {
        if (url === "/cloud/jobs") {
          return {
            jobs: [
              {
                jobId: "cloud-1",
                dbJobId: 100,
                name: "Cloud Sim",
                domain: "modelica",
                profile: "standard",
                status: "completed",
              },
            ],
          };
        }
        if (url === "/cae/user-jobs") {
          return {
            jobs: [
              // Duplicate of dbJobId 100 should be deduplicated
              { id: 100, name: "Duplicate Cloud Sim", solver: "cvode", status: "COMPLETED" },
              { id: 101, name: "Cancelled FEA Job", solver: "calculix", status: "CANCELLED" },
              { id: 102, name: "US-Spelling Canceled CFD Job", solver: "su2", status: "CANCELED" },
              { id: 103, name: "Pending Queue Job", solver: "su2", status: "PENDING" },
              { id: 104, name: "Queued Job", solver: "calculix", status: "QUEUED" },
              { id: 105, name: "Active Running Job", solver: "su2", status: "RUNNING" },
              { id: 106, name: "Failed Job", solver: "calculix", status: "FAILED" },
              { id: 107, name: "Succeeded Job", solver: "su2", status: "SUCCESS" },
            ],
          };
        }
        return {};
      });

      const jobs = await getUnifiedUserJobs(50);

      assert.equal(jobs.length, 8, "Should deduplicate matching dbJobId and keep 8 distinct jobs");
      const byId = new Map(jobs.map((j) => [j.id, j]));

      assert.equal(byId.get(101)?.status, "cancelled", "CAE CANCELLED must map to 'cancelled'");
      assert.equal(byId.get(102)?.status, "cancelled", "CAE CANCELED must map to 'cancelled'");
      assert.equal(byId.get(103)?.status, "queued", "CAE PENDING must map to 'queued', not 'running'");
      assert.equal(byId.get(104)?.status, "queued", "CAE QUEUED must map to 'queued'");
      assert.equal(byId.get(105)?.status, "running", "CAE RUNNING must map to 'running'");
      assert.equal(byId.get(106)?.status, "failed", "CAE FAILED must map to 'failed'");
      assert.equal(byId.get(107)?.status, "completed", "CAE SUCCESS must map to 'completed'");
    });

    it("getUserHpcJobs propagates HTTP errors instead of swallowing them into []", async () => {
      const httpError = Object.assign(new Error("Request failed with status code 503"), {
        isAxiosError: true,
        response: { status: 503, data: { error: "HPC database unavailable" } },
      });
      mockApiGet(() => {
        throw httpError;
      });

      await assert.rejects(
        () => getUserHpcJobs(20),
        (err: unknown) => {
          assert.equal(err, httpError);
          return true;
        },
        "getUserHpcJobs must reject when the API call fails instead of returning []",
      );
    });

    it("getUserHpcJobs returns jobs array on success", async () => {
      mockApiGet(() => ({
        jobs: [{ id: 7, name: "Airfoil SU2", status: "COMPLETED", solver: "su2", computeProfile: "standard" }],
        count: 1,
      }));

      const jobs = await getUserHpcJobs(15);
      assert.equal(capturedRequests[0]?.url, "/cae/user-jobs");
      assert.deepEqual(capturedRequests[0]?.config?.params, { limit: 15 });
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]?.name, "Airfoil SU2");
    });

    it("getJobTemplates normalizes { studyDefinition } wrapper responses safely", async () => {
      mockApiGet(() => ({
        templates: [
          {
            id: 42,
            studyDefinition: {
              slug: "wrapped-cfd-sweep",
              name: "Wrapped CFD Sweep",
              kind: "parameter-sweep",
              category: "Fluid Dynamics (CFD)",
              execution: { recommendedProfile: "hpc-mpi-64", estimatedCredits: 2.5 },
            },
          },
          {
            id: "99",
            slug: "flat-dae-sim",
            name: "Flat DAE Sim",
            kind: "simulation",
            category: "System Dynamics",
          },
          // Malformed entries that should be skipped safely
          null,
          {},
          { id: 123, studyDefinition: {} },
        ],
      }));

      const res = await getJobTemplates({ domain: "cfd" });

      assert.equal(capturedRequests[0]?.url, "/jobs/templates");
      assert.deepEqual(capturedRequests[0]?.config?.params, { domain: "cfd" });
      assert.equal(res.templates.length, 2, "Malformed entries must be skipped safely");

      const first = res.templates[0]!;
      assert.equal(first.slug, "wrapped-cfd-sweep");
      assert.equal(first.name, "Wrapped CFD Sweep");
      assert.equal(first.dbId, 42);
      assert.equal(first.id, "42");
      assert.equal(first.studyDefinition?.slug, "wrapped-cfd-sweep");
      assert.equal(first.execution?.recommendedProfile, "hpc-mpi-64");

      const second = res.templates[1]!;
      assert.equal(second.slug, "flat-dae-sim");
      assert.equal(second.dbId, 99);
      assert.equal(second.studyDefinition?.slug, "flat-dae-sim");

      assert.equal(res.studyDefinitions?.length, 2);
      assert.equal(res.studyDefinitions?.[0]?.slug, "wrapped-cfd-sweep");
    });
  });

  describe("3. Billing UI Regression Guards", () => {
    it("BillingTab.tsx reads rawObj['balance'] in normalizeBillingSummary and does not read pi.id", () => {
      const billingTabPath = path.resolve(WEB_SRC_DIR, "pages/settings/tabs/BillingTab.tsx");
      const content = fs.readFileSync(billingTabPath, "utf-8");

      assert.ok(
        content.includes('wallet?.["balance"] ?? rawObj["balance"] ?? rawObj["creditBalance"]'),
        "normalizeBillingSummary must read rawObj['balance'] for org wallet payloads",
      );
      assert.ok(!/\bpi\.id\b/.test(content), "BillingTab.tsx must not read legacy pi.id");
    });

    it("BillingTab.tsx handles ?checkout=success and ?checkout=cancelled return query params", () => {
      const billingTabPath = path.resolve(WEB_SRC_DIR, "pages/settings/tabs/BillingTab.tsx");
      const content = fs.readFileSync(billingTabPath, "utf-8");

      assert.ok(
        content.includes('searchParams.get("checkout")'),
        "BillingTab.tsx must inspect the 'checkout' URL search parameter",
      );
      assert.ok(
        content.includes('checkoutParam !== "success" && checkoutParam !== "cancelled"'),
        "BillingTab.tsx must handle both ?checkout=success and ?checkout=cancelled",
      );
      assert.ok(
        content.includes('checkoutParam === "cancelled"'),
        "BillingTab.tsx must render a cancelled notice for ?checkout=cancelled",
      );
    });

    it("BillingTab.tsx uses $1.00 / credit pricing and does not wire a $29 plan to charge 200 credits", () => {
      const billingTabPath = path.resolve(WEB_SRC_DIR, "pages/settings/tabs/BillingTab.tsx");
      const content = fs.readFileSync(billingTabPath, "utf-8");

      assert.ok(
        content.includes("$1.00 USD = 1.00 Compute Credit") && content.includes("$1.00 / credit"),
        "BillingTab.tsx must display consistent $1.00 / credit pricing",
      );
      assert.ok(
        content.includes("+50 cr — $50.00") &&
          content.includes("+200 cr — $200.00") &&
          content.includes("+500 cr — $500.00"),
        "BillingTab.tsx quick top-up buttons must reflect $1.00 per credit",
      );
      // Pro/Team cards must route through real Stripe Subscription checkout, not a 200-credit pack
      assert.ok(
        content.includes("createSubscriptionCheckoutSession(") &&
          content.includes('startSubscriptionCheckout("pro")') &&
          content.includes('startSubscriptionCheckout("team")'),
        "Pro/Team tiers must use real Stripe Subscription checkout instead of charging a credit pack",
      );
      assert.ok(
        !content.includes("Upgrade to Pro") && !content.includes('createCreditCheckout("pro"'),
        "BillingTab.tsx must not wire a $29 Pro button to a 200-credit charge",
      );
    });

    it("BillingTab.tsx gates sandbox toggle on admin/DEV and fetches invoices via authenticated API", () => {
      const billingTabPath = path.resolve(WEB_SRC_DIR, "pages/settings/tabs/BillingTab.tsx");
      const content = fs.readFileSync(billingTabPath, "utf-8");

      assert.ok(
        content.includes("const isDev = import.meta.env.DEV;") &&
          content.includes("const canUseSandboxToggle = Boolean(isAdmin) || isDev;"),
        "BillingTab.tsx must derive canUseSandboxToggle from isAdmin or import.meta.env.DEV",
      );
      assert.ok(
        content.includes("{canUseSandboxToggle && (") && content.includes("onClick={toggleSandboxBilling}"),
        "BillingTab.tsx must gate the sandbox toggle button on canUseSandboxToggle",
      );
      assert.ok(
        content.includes("if (!canUseSandboxToggle) return;"),
        "toggleSandboxBilling must be a no-op when canUseSandboxToggle is false",
      );
      assert.ok(
        content.includes("downloadBillingInvoice(txId)") || content.includes("fetchInvoiceHtml(txId)"),
        "BillingTab.tsx must fetch invoices via authenticated API helper",
      );
      assert.ok(
        !/<a\b[^>]*href=[^>]*\/api\/v1\/billing\/invoices\//.test(content) &&
          !content.includes("getInvoiceDownloadUrl"),
        "BillingTab.tsx must not render unauthenticated <a href='/api/v1/billing/invoices/...'> links",
      );
    });

    it("AppShell.tsx displays (amt * 1.0).toFixed(2) and routes non-DEV top-up through createCheckoutSession", () => {
      const appShellPath = path.resolve(WEB_SRC_DIR, "components/AppShell.tsx");
      const content = fs.readFileSync(appShellPath, "utf-8");

      assert.ok(
        content.includes("${(amt * 1.0).toFixed(2)}"),
        "AppShell.tsx must display $1.00/cr pricing using (amt * 1.0).toFixed(2)",
      );
      assert.ok(!content.includes("amt * 0.1"), "AppShell.tsx must not display stale 0.1 ($0.10/cr) pricing");
      assert.ok(
        content.includes("if (!isDev)") &&
          content.includes("await createCheckoutSession(amt)") &&
          content.includes("window.location.assign(session.checkoutUrl)"),
        "AppShell.tsx must route non-DEV credit top-ups through createCheckoutSession",
      );
    });
  });

  describe("4. HPC UI Regression Guards", () => {
    it("CloudSimulationModal.tsx and ProfileSelector.tsx use 0.05 (3-min) minimum escrow calculation", () => {
      const modalPath = path.resolve(WEB_SRC_DIR, "components/cloud-sim/CloudSimulationModal.tsx");
      const selectorPath = path.resolve(WEB_SRC_DIR, "components/cloud-sim/ProfileSelector.tsx");
      const modalContent = fs.readFileSync(modalPath, "utf-8");
      const selectorContent = fs.readFileSync(selectorPath, "utf-8");

      assert.ok(
        modalContent.includes("const minEscrow = (currentProfile?.costCreditsPerHour ?? 10) * 0.05;"),
        "CloudSimulationModal.tsx must calculate 3-minute minimum escrow with * 0.05",
      );
      assert.ok(
        selectorContent.includes("const minEscrow = (currentProfile?.costCreditsPerHour ?? 0) * 0.05;"),
        "ProfileSelector.tsx must calculate 3-minute minimum escrow with * 0.05",
      );
      assert.ok(
        selectorContent.includes("Min Escrow (3 min):"),
        "ProfileSelector.tsx must label minimum escrow as 3 min",
      );
    });

    it("HPC templates and ProfileSelector use valid COMPUTE_PROFILES IDs (no cpu-small/cpu-medium/cpu-large)", () => {
      const validProfileIds = new Set(["standard", "high-memory", "gpu-a100", "hpc-mpi-64", "emt-distributed-cluster"]);

      assert.ok(BUILTIN_HPC_TEMPLATES.length > 0, "BUILTIN_HPC_TEMPLATES must not be empty");
      for (const tpl of BUILTIN_HPC_TEMPLATES) {
        assert.ok(
          validProfileIds.has(tpl.recommendedProfile),
          `Template '${tpl.id}' has invalid recommendedProfile '${tpl.recommendedProfile}'`,
        );
        for (const preset of tpl.presets) {
          assert.ok(
            validProfileIds.has(preset.recommendedProfile),
            `Template '${tpl.id}' preset '${preset.id}' has invalid recommendedProfile '${preset.recommendedProfile}'`,
          );
        }
      }

      const selectorPath = path.resolve(WEB_SRC_DIR, "components/cloud-sim/ProfileSelector.tsx");
      const templatesPath = path.resolve(WEB_SRC_DIR, "components/cloud-sim/hpcTemplates.ts");
      const selectorContent = fs.readFileSync(selectorPath, "utf-8");
      const templatesContent = fs.readFileSync(templatesPath, "utf-8");

      for (const legacyId of ["cpu-small", "cpu-medium", "cpu-large"]) {
        assert.ok(
          !selectorContent.includes(legacyId),
          `ProfileSelector.tsx must not reference legacy profile ID '${legacyId}'`,
        );
        assert.ok(
          !templatesContent.includes(legacyId),
          `hpcTemplates.ts must not reference legacy profile ID '${legacyId}'`,
        );
      }
    });

    it("CloudSimulationModal.tsx tracks dispatchTarget for /cloud/jobs/:id polling, gates polling on isOpen, and includes Cancel Job", () => {
      const modalPath = path.resolve(WEB_SRC_DIR, "components/cloud-sim/CloudSimulationModal.tsx");
      const content = fs.readFileSync(modalPath, "utf-8");

      assert.ok(
        content.includes('const [dispatchTarget, setDispatchTarget] = useState<DispatchTarget>("simulate");'),
        "CloudSimulationModal.tsx must track dispatchTarget state",
      );
      assert.ok(
        content.includes('setDispatchTarget("cloud")') && content.includes('setDispatchTarget("simulate")'),
        "CloudSimulationModal.tsx must set dispatchTarget on both cloud and simulate launch paths",
      );
      assert.ok(
        content.includes('dispatchTarget === "cloud"') &&
          content.includes("await getCloudJobStatus(jobId)") &&
          content.includes("await getCloudJobResult(jobId)"),
        "CloudSimulationModal.tsx must poll /cloud/jobs/:id via getCloudJobStatus and fetch result via getCloudJobResult when dispatchTarget is 'cloud'",
      );
      assert.ok(
        content.includes('if (!isOpen || !jobId || phase !== "running") return;'),
        "CloudSimulationModal.tsx must gate status polling on isOpen",
      );
      assert.ok(
        content.includes('if (!isOpen || (phase !== "running" && phase !== "submitting")) return;'),
        "CloudSimulationModal.tsx must gate elapsed timer on isOpen",
      );
      assert.ok(
        content.includes("const handleCancelJob = async () =>") &&
          content.includes("await cancelCloudJob(jobId)") &&
          content.includes("await cancelJob(jobId)") &&
          content.includes('"Cancel Job"'),
        "CloudSimulationModal.tsx must provide a Cancel Job action wired to cancelCloudJob / cancelJob",
      );
    });

    it("SimulationProgressSteps.tsx and SimulationResultsView.tsx contain no fabricated telemetry or fallback metrics", () => {
      const progressPath = path.resolve(WEB_SRC_DIR, "components/cloud-sim/SimulationProgressSteps.tsx");
      const resultsPath = path.resolve(WEB_SRC_DIR, "components/cloud-sim/SimulationResultsView.tsx");
      const progressContent = fs.readFileSync(progressPath, "utf-8");
      const resultsContent = fs.readFileSync(resultsPath, "utf-8");

      assert.ok(
        !progressContent.includes("SLURM LIVE WORKER STREAM"),
        "SimulationProgressSteps.tsx must not fabricate a 'SLURM LIVE WORKER STREAM' banner",
      );
      assert.ok(
        progressContent.includes("WORKER LOGS") && progressContent.includes("CLUSTER JOB STATUS"),
        "SimulationProgressSteps.tsx must display real WORKER LOGS or honest CLUSTER JOB STATUS",
      );

      assert.ok(
        !resultsContent.includes("0.42") && !resultsContent.includes("0.01"),
        "SimulationResultsView.tsx must not display fabricated 0.42s or 0.01 fallback metrics",
      );
      assert.ok(
        resultsContent.includes('typeof jobStatus?.usage?.cpuSeconds === "number"') &&
          resultsContent.includes('typeof jobStatus?.usage?.costCredits === "number"'),
        "SimulationResultsView.tsx must guard usage metrics and render '—' when unavailable",
      );
    });
  });
});

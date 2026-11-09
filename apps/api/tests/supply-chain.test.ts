// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import assert from "node:assert";
import { describe, it } from "node:test";
import { supplyChainRouter } from "../src/routes/supply-chain.js";
import { DigiKeyConnector } from "../src/services/supply-chain/digikey-connector.js";
import { MouserConnector } from "../src/services/supply-chain/mouser-connector.js";
import { NexarConnector } from "../src/services/supply-chain/nexar-connector.js";
import { SupplyChainOrchestrator } from "../src/services/supply-chain/orchestrator.js";
import type { BOMComponentInput } from "../src/services/supply-chain/types.js";

describe("Hybrid Multi-Tier Supply Chain & Sourcing Service", () => {
  it("queries mock quotes across Nexar, Digi-Key, and Mouser connectors", async () => {
    const nexar = new NexarConnector({ mockMode: true });
    const digikey = new DigiKeyConnector({ mockMode: true });
    const mouser = new MouserConnector({ mockMode: true });

    const [nexarQuotes, dkQuotes, mouserQuotes] = await Promise.all([
      nexar.searchPart("STM32H743IIT6"),
      digikey.searchPart("STM32H743IIT6"),
      mouser.searchPart("STM32H743IIT6"),
    ]);

    assert(nexarQuotes.length > 0);
    assert.strictEqual(nexarQuotes[0]!.mpn, "STM32H743IIT6");
    assert(nexarQuotes[0]!.stockAvailable > 0);

    assert(dkQuotes.length > 0);
    assert.strictEqual(dkQuotes[0]!.distributor, "DigiKey");
    assert.strictEqual(dkQuotes[0]!.packaging, "Cut Tape");

    assert(mouserQuotes.length > 0);
    assert.strictEqual(mouserQuotes[0]!.distributor, "Mouser");
    assert(mouserQuotes[0]!.priceBreaks.length > 0);
  });

  it("orchestrates multi-tier sourcing, caches results, and optimizes price breaks for build volumes", async () => {
    const orchestrator = new SupplyChainOrchestrator({
      cacheTtlMs: 5000,
      nexarConnector: new NexarConnector({ mockMode: true }),
      digiKeyConnector: new DigiKeyConnector({ mockMode: true }),
      mouserConnector: new MouserConnector({ mockMode: true }),
    });

    // 1. Initial query populates cache
    const quotes1 = await orchestrator.getQuotesForPart("GRM188R71C105KA12D");
    assert(quotes1.length >= 3, "Should aggregate quotes across all 3 distributors");

    // 2. Second query should hit cache immediately
    const quotes2 = await orchestrator.getQuotesForPart("GRM188R71C105KA12D");
    assert.strictEqual(quotes1, quotes2, "Should return cached reference");

    // 3. BOM scrubbing for 5,000 units
    const bom: BOMComponentInput[] = [
      {
        refDes: "U1",
        mpn: "STM32H743IIT6",
        footprint: "LQFP-176",
        approvedAlternates: ["STM32H753IIT6"],
      },
      {
        refDes: "C1,C2,C3,C4",
        mpn: "GRM188R71C105KA12D",
        footprint: "0603",
      },
      {
        refDes: "R1",
        mpn: "RC0603FR-0710KL",
        footprint: "0603",
      },
    ];

    const result = await orchestrator.scrubBOM(bom, 5000);

    assert.strictEqual(result.targetBuildQuantity, 5000);
    assert.strictEqual(result.uniqueParts, 3);
    assert(result.totalExtendedPrice > 0);
    assert(result.overallHealthScore >= 70, "Healthy BOM should have high score");

    // Check alternate qualification for U1
    const u1Plan = result.componentPlans.find((p) => p.requestedMpn === "STM32H743IIT6")!;
    assert(u1Plan.qualifiedAlternates.length > 0);
    assert.strictEqual(u1Plan.qualifiedAlternates[0]!.mpn, "STM32H753IIT6");
    assert.strictEqual(u1Plan.qualifiedAlternates[0]!.qualificationStatus, "DROP_IN_QUALIFIED");

    // Check single-sourced detection on C1..C4
    const capPlan = result.componentPlans.find((p) => p.requestedMpn === "GRM188R71C105KA12D")!;
    assert(capPlan.riskFlags.includes("SINGLE_SOURCED"));
  });

  it("detects Out-of-Stock and EOL risks correctly", async () => {
    const orchestrator = new SupplyChainOrchestrator({
      nexarConnector: new NexarConnector({ mockMode: true }),
      digiKeyConnector: new DigiKeyConnector({ mockMode: true }),
      mouserConnector: new MouserConnector({ mockMode: true }),
    });

    const riskyBOM: BOMComponentInput[] = [
      { refDes: "U1", mpn: "PART-OOS-CHIP" },
      { refDes: "U2", mpn: "PART-EOL-IC" },
    ];

    const result = await orchestrator.scrubBOM(riskyBOM, 100);

    assert(result.riskSummary.outOfStockCount >= 1, "Should flag out of stock part");
    assert(result.riskSummary.eolCount >= 1, "Should flag EOL part");
    assert(result.overallHealthScore < 70, "Unhealthy BOM should incur score penalties");
  });

  it("handles REST API requests for BOM scrubbing and part search", async () => {
    const orchestrator = new SupplyChainOrchestrator({
      nexarConnector: new NexarConnector({ mockMode: true }),
      digiKeyConnector: new DigiKeyConnector({ mockMode: true }),
      mouserConnector: new MouserConnector({ mockMode: true }),
    });

    const app = express();
    app.use(express.json());
    app.use("/api/v1/supply-chain", supplyChainRouter(orchestrator));

    const server = app.listen(0);
    const address = server.address() as any;
    const port = address.port;
    const baseUrl = `http://127.0.0.1:${port}/api/v1/supply-chain`;

    try {
      // 1. GET /part/:mpn
      const partRes = await fetch(`${baseUrl}/part/STM32H743IIT6`);
      assert.strictEqual(partRes.status, 200);
      const partData = (await partRes.json()) as any;
      assert.strictEqual(partData.mpn, "STM32H743IIT6");
      assert(partData.totalQuotes > 0);

      // 2. POST /scrub-bom
      const scrubRes = await fetch(`${baseUrl}/scrub-bom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          components: [
            { refDes: "U1", mpn: "STM32H743IIT6" },
            { refDes: "C1", mpn: "100nF-CAP" },
          ],
          targetQuantity: 500,
        }),
      });

      assert.strictEqual(scrubRes.status, 200);
      const scrubData = (await scrubRes.json()) as any;
      assert.strictEqual(scrubData.targetBuildQuantity, 500);
      assert.strictEqual(scrubData.uniqueParts, 2);
      assert(typeof scrubData.overallHealthScore === "number");
    } finally {
      server.close();
    }
  });
});

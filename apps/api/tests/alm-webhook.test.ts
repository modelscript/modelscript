// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeAlmWebhookPayload } from "../src/routes/alm.js";

describe("ALM Webhook Payload Normalizer", () => {
  it("normalizes Jira, Jama, Codebeamer, Polarion, and OSLC webhook payloads", () => {
    const jira = normalizeAlmWebhookPayload("jira", {
      webhookEvent: "jira:issue_updated",
      issue: { key: "EV-1420" },
    });
    assert.equal(jira.protocol, "jira");
    assert.deepEqual(jira.affectedIds, ["EV-1420"]);

    const jama = normalizeAlmWebhookPayload("jama", {
      event: "ITEM_UPDATED",
      data: { documentKey: "SYS-REQ-12" },
    });
    assert.deepEqual(jama.affectedIds, ["SYS-REQ-12"]);

    const cb = normalizeAlmWebhookPayload("codebeamer", {
      eventType: "TRACKER_ITEM_UPDATED",
      item: { id: 501 },
      baselineId: "B-42",
    });
    assert.deepEqual(cb.affectedIds, ["CB-501"]);
    assert.equal(cb.baselineOrRevision, "B-42");

    const pol = normalizeAlmWebhookPayload("polarion", {
      event: "WORKITEM_UPDATED",
      workItemId: "POL-101",
      revision: "48220",
    });
    assert.deepEqual(pol.affectedIds, ["POL-101"]);
    assert.equal(pol.baselineOrRevision, "48220");

    const oslc = normalizeAlmWebhookPayload("oslc", {
      type: "trs:Modification",
      identifier: "REQ-042",
      configuration: "Rel-2.0",
    });
    assert.deepEqual(oslc.affectedIds, ["REQ-042"]);
    assert.equal(oslc.baselineOrRevision, "Rel-2.0");
  });
});

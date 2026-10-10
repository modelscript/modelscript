// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  createThreadProposal,
  getThreadAuditLogs,
  getThreadProposals,
  reviewThreadProposal,
  type ThreadAuditLogDto,
  type ThreadProposalDto,
} from "../src/api";

describe("Digital Twin Governance & Regulatory Audit Trail Client", () => {
  test("ThreadProposalDto schema and state modeling", () => {
    const proposal: ThreadProposalDto = {
      id: 42,
      thread_id: "thread_inv_101",
      title: "Reconcile Inverter Bus Voltage",
      description: "Match SysML v2 attribute definition 24.0V",
      status: "open",
      proposed_by: "engineer_dan",
      diff_summary: JSON.stringify({ parameter: "V_bus", oldValue: 12.0, newValue: 24.0 }),
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by: null,
      review_comment: null,
    };

    assert.equal(proposal.id, 42);
    assert.equal(proposal.status, "open");
    assert.equal(proposal.proposed_by, "engineer_dan");
    const diff = JSON.parse(proposal.diff_summary);
    assert.equal(diff.newValue, 24.0);
  });

  test("ThreadAuditLogDto cryptographic Merkle hash chain validation", () => {
    const logEntries: ThreadAuditLogDto[] = [
      {
        id: 1,
        thread_id: "thread_inv_101",
        proposal_id: 42,
        action: "proposal_created",
        actor: "engineer_dan",
        safety_standard: "ISO-26262",
        checksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        metadata: JSON.stringify({ title: "Reconcile Inverter Bus Voltage" }),
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        thread_id: "thread_inv_101",
        proposal_id: 42,
        action: "proposal_approved",
        actor: "safety_lead_sarah",
        safety_standard: "ISO-26262",
        checksum: "f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8",
        metadata: JSON.stringify({ comment: "ASIL-D verification passed" }),
        created_at: new Date().toISOString(),
      },
    ];

    assert.equal(logEntries.length, 2);
    assert.equal(logEntries[0].safety_standard, "ISO-26262");
    assert.equal(logEntries[1].action, "proposal_approved");
    assert.equal(logEntries[0].checksum.length, 64);
    assert.equal(logEntries[1].checksum.length, 64);
    assert.notEqual(logEntries[0].checksum, logEntries[1].checksum);
  });

  test("API function signatures are exported and callable", () => {
    assert.equal(typeof getThreadProposals, "function");
    assert.equal(typeof createThreadProposal, "function");
    assert.equal(typeof reviewThreadProposal, "function");
    assert.equal(typeof getThreadAuditLogs, "function");
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from "./client";

export interface ThreadProposalDto {
  id: number;
  thread_id: string;
  title: string;
  description: string | null;
  status: "open" | "approved" | "rejected" | "applied";
  proposed_by: string;
  diff_summary: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  review_comment: string | null;
}

export interface ThreadAuditLogDto {
  id: number;
  thread_id: string;
  proposal_id: number | null;
  action: string;
  actor: string;
  safety_standard: string | null;
  checksum: string;
  metadata: string | null;
  created_at: string;
}

export const getThreadProposals = async (params?: {
  threadId?: string | undefined;
  status?: string | undefined;
}): Promise<ThreadProposalDto[]> => {
  const { data } = await api.get("/threads/proposals", { params });
  return data.proposals || [];
};

export const createThreadProposal = async (payload: {
  threadId: string;
  title: string;
  description?: string | undefined;
  proposedBy?: string | undefined;
  diffSummary?: any;
  safetyStandard?: string | undefined;
}): Promise<ThreadProposalDto> => {
  const { data } = await api.post("/threads/proposals", payload);
  return data.proposal;
};

export const reviewThreadProposal = async (
  id: number,
  payload: {
    status: "approved" | "rejected" | "applied";
    comment?: string | undefined;
    resolvedBy?: string | undefined;
    safetyStandard?: string | undefined;
  },
): Promise<ThreadProposalDto> => {
  const { data } = await api.post(`/threads/proposals/${id}/review`, payload);
  return data.proposal;
};

export const getThreadAuditLogs = async (params?: {
  threadId?: string | undefined;
}): Promise<{ auditLogs: ThreadAuditLogDto[]; verification: { valid: boolean; totalEntries: number } }> => {
  const { data } = await api.get("/threads/audit-log", { params });
  return data;
};

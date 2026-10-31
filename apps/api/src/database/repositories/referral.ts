// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UserReferralRow, WaitlistSubmissionRow } from "../types.js";
import { BaseRepository } from "./base.js";

export class ReferralRepository extends BaseRepository {
  getUserOnboardingStatus(userId: number): {
    completed: boolean;
    persona: string | null;
    invitesRemaining: number;
  } {
    const row = this.get<{
      onboarding_completed?: number;
      engineering_persona?: string | null;
      invites_remaining?: number;
    }>(`SELECT onboarding_completed, engineering_persona, invites_remaining FROM users WHERE id = ?`, userId);
    return {
      completed: Boolean(row?.onboarding_completed),
      persona: row?.engineering_persona ?? null,
      invitesRemaining: row?.invites_remaining ?? 0,
    };
  }

  completeUserOnboarding(userId: number, persona?: string): boolean {
    const res = this.run(
      `UPDATE users SET onboarding_completed = 1, engineering_persona = COALESCE(?, engineering_persona) WHERE id = ?`,
      persona || null,
      userId,
    );
    return res.changes > 0;
  }

  recordUserReferral(
    referrerId: number,
    refereeId: number,
    inviteId: number | null = null,
    rewardAmount = 50.0,
  ): UserReferralRow {
    const res = this.run(
      `INSERT INTO user_referrals (referrer_id, referee_id, invite_id, reward_granted, reward_amount, created_at)
       VALUES (?, ?, ?, 0, ?, datetime('now'))`,
      referrerId,
      refereeId,
      inviteId,
      rewardAmount,
    );

    return {
      id: Number(res.lastInsertRowid),
      referrer_id: referrerId,
      referee_id: refereeId,
      invite_id: inviteId,
      reward_granted: false,
      reward_amount: rewardAmount,
      created_at: new Date().toISOString(),
    };
  }

  getUserReferrals(referrerId: number): UserReferralRow[] {
    const rows = this.all<UserReferralRow & { reward_granted: number }>(
      `SELECT r.*, u1.username as referrer_username, u2.username as referee_username
       FROM user_referrals r
       JOIN users u1 ON r.referrer_id = u1.id
       JOIN users u2 ON r.referee_id = u2.id
       WHERE r.referrer_id = ?
       ORDER BY r.id DESC`,
      referrerId,
    );
    return rows.map((r) => ({
      ...r,
      reward_granted: Boolean(r.reward_granted),
    }));
  }

  getReferralByReferee(refereeId: number): UserReferralRow | undefined {
    const row = this.get<UserReferralRow & { reward_granted: number }>(
      `SELECT * FROM user_referrals WHERE referee_id = ?`,
      refereeId,
    );
    if (!row) return undefined;
    return {
      ...row,
      reward_granted: Boolean(row.reward_granted),
    };
  }

  grantReferralReward(refereeId: number): boolean {
    const referral = this.get<UserReferralRow>(
      `SELECT * FROM user_referrals WHERE referee_id = ? AND reward_granted = 0`,
      refereeId,
    );
    if (!referral) return false;

    const reward = Number(referral.reward_amount || 50.0);
    this.transaction(() => {
      this.run(`UPDATE user_referrals SET reward_granted = 1 WHERE id = ?`, referral.id);
      this.facade.adjustUserCreditsForAdmin(referral.referrer_id, reward, "Peer referral reward bonus");
      this.facade.adjustUserCreditsForAdmin(referral.referee_id, reward, "Welcome referral bonus");
    });
    return true;
  }

  generateUserGoldenTicket(userId: number, note?: string, initialCredits = 100) {
    const user = this.facade.getUserById(userId);
    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }
    const remaining = typeof user.invites_remaining === "number" ? user.invites_remaining : 5;
    if (remaining <= 0) {
      throw new Error("No golden tickets / invites remaining for this account");
    }

    return this.transaction(() => {
      this.run(`UPDATE users SET invites_remaining = MAX(0, invites_remaining - 1) WHERE id = ?`, userId);
      return this.facade.createInstanceInvite({
        createdBy: userId,
        maxUses: 1,
        initialCredits,
        note: note || `Golden ticket from @${user.username}`,
      });
    });
  }

  getUserInvites(userId: number) {
    const rows = this.all<{
      id: number;
      code: string;
      created_by: number | null;
      creator_username: string | null;
      max_uses: number;
      used_count: number;
      initial_credits: number;
      assigned_role: string;
      note: string | null;
      expires_at: string | null;
      revoked_at: string | null;
      created_at: string;
    }>(
      `SELECT i.*, u.username as creator_username
       FROM instance_invites i
       LEFT JOIN users u ON i.created_by = u.id
       WHERE i.created_by = ?
       ORDER BY i.id DESC`,
      userId,
    );
    return rows.map((r) => ({
      ...r,
      createdBy: r.created_by,
      maxUses: r.max_uses,
      usesCount: r.used_count,
      expiresAt: r.expires_at,
      revoked: Boolean(r.revoked_at),
      createdAt: r.created_at,
    }));
  }

  createWaitlistSubmission(data: {
    email: string;
    full_name?: string | null;
    organization?: string | null;
    discipline?: string | null;
    portfolio_url?: string | null;
    statement?: string | null;
    ip_address?: string | null;
  }): WaitlistSubmissionRow {
    const cleanEmail = data.email.trim().toLowerCase();
    const existing = this.getWaitlistSubmissionByEmail(cleanEmail);
    if (existing) {
      return existing;
    }

    const res = this.run(
      `INSERT INTO waitlist_submissions (email, full_name, organization, discipline, portfolio_url, statement, status, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))`,
      cleanEmail,
      data.full_name?.trim() || null,
      data.organization?.trim() || null,
      data.discipline?.trim() || null,
      data.portfolio_url?.trim() || null,
      data.statement?.trim() || null,
      data.ip_address || null,
    );

    return {
      id: Number(res.lastInsertRowid),
      email: cleanEmail,
      full_name: data.full_name?.trim() || null,
      organization: data.organization?.trim() || null,
      discipline: data.discipline?.trim() || null,
      portfolio_url: data.portfolio_url?.trim() || null,
      statement: data.statement?.trim() || null,
      status: "pending",
      ip_address: data.ip_address || null,
      created_at: new Date().toISOString(),
    };
  }

  getWaitlistSubmissions(options?: {
    status?: "pending" | "approved" | "rejected";
    limit?: number;
    offset?: number;
  }): WaitlistSubmissionRow[] {
    let sql = `SELECT * FROM waitlist_submissions`;
    const params: unknown[] = [];

    if (options?.status) {
      sql += ` WHERE status = ?`;
      params.push(options.status);
    }
    sql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
    params.push(Math.max(1, options?.limit ?? 50), Math.max(0, options?.offset ?? 0));

    return this.all<WaitlistSubmissionRow>(sql, ...params);
  }

  getWaitlistSubmissionById(id: number): WaitlistSubmissionRow | undefined {
    return this.get<WaitlistSubmissionRow>(`SELECT * FROM waitlist_submissions WHERE id = ?`, id);
  }

  getWaitlistSubmissionByEmail(email: string): WaitlistSubmissionRow | undefined {
    return this.get<WaitlistSubmissionRow>(
      `SELECT * FROM waitlist_submissions WHERE LOWER(email) = LOWER(?)`,
      email.trim(),
    );
  }

  approveWaitlistSubmission(
    id: number,
    approvedBy: number | null = null,
  ): {
    success: boolean;
    submission?: WaitlistSubmissionRow | undefined;
    inviteCode?: string | undefined;
  } {
    const sub = this.getWaitlistSubmissionById(id);
    if (!sub) {
      return { success: false };
    }
    if (sub.status === "approved" && sub.invite_code_id) {
      const invite = this.get<{ code: string }>(`SELECT code FROM instance_invites WHERE id = ?`, sub.invite_code_id);
      return { success: true, submission: sub, inviteCode: invite?.code };
    }

    const invite = this.facade.createInstanceInvite({
      createdBy: approvedBy,
      maxUses: 1,
      initialCredits: 150,
      note: `Waitlist approval for ${sub.email}`,
    });

    this.run(
      `UPDATE waitlist_submissions SET status = 'approved', approved_by = ?, invite_code_id = ?, reviewed_at = datetime('now') WHERE id = ?`,
      approvedBy,
      invite.id,
      id,
    );

    const updated = this.getWaitlistSubmissionById(id);
    return {
      success: true,
      submission: updated,
      inviteCode: invite.code,
    };
  }

  rejectWaitlistSubmission(id: number, approvedBy: number | null = null, reason: string | null = null): boolean {
    const res = this.run(
      `UPDATE waitlist_submissions SET status = 'rejected', approved_by = ?, rejection_reason = COALESCE(?, rejection_reason), reviewed_at = datetime('now') WHERE id = ?`,
      approvedBy,
      reason,
      id,
    );
    return res.changes > 0;
  }
}

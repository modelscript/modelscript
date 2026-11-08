// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LibraryDatabase } from "../database.js";
import { SEED_PERSONAS } from "./personas.js";

function minutesAgoSqliteTimestamp(minutesAgo: number): string {
  const ms = Date.now() - Math.max(0, minutesAgo) * 60_000;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

export interface SeedInboxSummary {
  notificationsSeeded: number;
  bookmarksSeeded: number;
  outboxJobsSeeded: number;
}

/**
 * Seeds rich, realistic engineering Inbox data for local development accounts (`omar`, `admin`,
 * and any local human/admin users) so the unified Inbox (`Inbox`, `Saved`, `Outbox`, `Archive`)
 * and all 5 domain filter pills (`All`, `Engineering`, `Packages`, `Social`, `System`) are
 * populated out of the box rather than showing an empty state.
 *
 * Idempotent: tracks seeded notifications via `metadata.seedKey` and checks existing bookmarks
 * and completed HPC/CAE jobs per recipient before inserting.
 */
export function seedPolyglotInbox(
  db: LibraryDatabase,
  userIds: Map<string, number>,
  options?: { force?: boolean | undefined },
): SeedInboxSummary {
  let notificationsSeeded = 0;
  let bookmarksSeeded = 0;
  let outboxJobsSeeded = 0;

  const backgroundPersonas = new Set(
    SEED_PERSONAS.map((p) => p.username).filter((u) => u !== "omar" && u !== "elena_vance" && u !== "marcus_chen"),
  );

  // Resolve target recipient user IDs (omar, admin, any admin accounts, custom local users, and top dev personas)
  const recipientIds = new Set<number>();
  for (const uname of ["omar", "admin", "elena_vance", "marcus_chen"]) {
    const uid = userIds.get(uname) ?? db.getUserByUsername(uname)?.id;
    if (uid) recipientIds.add(uid);
  }

  try {
    const allActiveUsers = db.db
      .prepare(
        `SELECT id, username, account_type FROM users
         WHERE status = 'active'
         ORDER BY id ASC LIMIT 50`,
      )
      .all() as { id: number; username: string; account_type: string }[];
    for (const u of allActiveUsers) {
      if (u.account_type === "admin" || !backgroundPersonas.has(u.username)) {
        recipientIds.add(u.id);
      }
    }
  } catch {}

  if (recipientIds.size === 0) {
    return { notificationsSeeded: 0, bookmarksSeeded: 0, outboxJobsSeeded: 0 };
  }

  const getActorId = (username: string, fallbackId: number): number => {
    const id = userIds.get(username) ?? db.getUserByUsername(username)?.id;
    return id && id !== fallbackId ? id : fallbackId;
  };

  // Discover showcase posts in the DB to attach to social notifications & bookmarks
  let showcasePosts: { id: number; author_id: number; title?: string | null }[] = [];
  try {
    showcasePosts = db.db
      .prepare(
        `SELECT p.id, p.author_id, a.title
         FROM posts p
         LEFT JOIN artifact_views a ON p.artifact_view_id = a.id
         WHERE p.reply_to_id IS NULL
         ORDER BY CASE WHEN a.title LIKE 'ElectroHydrostaticActuator%' THEN 0 ELSE 1 END, p.id ASC
         LIMIT 12`,
      )
      .all() as { id: number; author_id: number; title?: string | null }[];
  } catch {}

  let replyPosts: { id: number; author_id: number; reply_to_id: number }[] = [];
  try {
    replyPosts = db.db
      .prepare(
        `SELECT id, author_id, reply_to_id
         FROM posts
         WHERE reply_to_id IS NOT NULL
         ORDER BY id ASC
         LIMIT 8`,
      )
      .all() as { id: number; author_id: number; reply_to_id: number }[];
  } catch {}

  const primaryPostId = showcasePosts[0]?.id ?? null;
  const secondaryPostId = showcasePosts[1]?.id ?? primaryPostId;
  const tertiaryPostId = showcasePosts[2]?.id ?? primaryPostId;
  const firstReplyId = replyPosts[0]?.id ?? secondaryPostId;
  const secondReplyId = replyPosts[1]?.id ?? tertiaryPostId;

  const insertBookmarkStmt = db.db.prepare(
    `INSERT OR IGNORE INTO bookmarks (user_id, post_id, created_at) VALUES (?, ?, ?)`,
  );

  const checkSeededNotifStmt = db.db.prepare(
    `SELECT id FROM notifications WHERE user_id = ? AND metadata LIKE ? LIMIT 1`,
  );

  const insertNotifStmt = db.db.prepare(
    `INSERT INTO notifications (user_id, actor_id, type, post_id, metadata, read, archived, starred, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const targetUserId of recipientIds) {
    // ─────────────────────────────────────────────────────────────────────────
    // 1. OUTBOX: Seed Completed CAE / HPC Cluster Jobs for the recipient
    // ─────────────────────────────────────────────────────────────────────────
    const existingUserJobs = db.getUserCompletedHpcJobs(targetUserId, 10);
    if (existingUserJobs.length < 3 || options?.force) {
      const outboxSpecs = [
        {
          name: "CAE [MODELICA]: AetherDynamics.Actuators.ElectroHydrostaticActuator — 500-Run Sobol UQ",
          type: "SIMULATE",
          profile: "standard",
          solver: "modelica",
          cpuSeconds: 14.8,
          gpuSeconds: 0,
          peakMemoryMb: 512,
          costCredits: 0.85,
          minutesAgo: 12,
        },
        {
          name: "CAE [CALCULIX]: eVTOL Wing Root Ti-6Al-4V Lug — Nonlinear Static & Modal Stress",
          type: "ADHOC",
          profile: "high-memory",
          solver: "calculix",
          cpuSeconds: 34.8,
          gpuSeconds: 0,
          peakMemoryMb: 4096,
          costCredits: 1.45,
          minutesAgo: 95,
        },
        {
          name: "CAE [OPENFOAM]: Subsea Production Manifold 3D Conjugate Heat Transfer & Erosion",
          type: "ADHOC",
          profile: "gpu-a100",
          solver: "openfoam",
          cpuSeconds: 86.2,
          gpuSeconds: 28.4,
          peakMemoryMb: 12288,
          costCredits: 3.1,
          minutesAgo: 210,
        },
        {
          name: "CAE [SU2]: Supercritical Transonic Wing Section RANS Polar (Mach 0.78, Re 6.5e6)",
          type: "ADHOC",
          profile: "hpc-mpi-64",
          solver: "su2",
          cpuSeconds: 142.6,
          gpuSeconds: 0,
          peakMemoryMb: 8192,
          costCredits: 4.2,
          minutesAgo: 540,
        },
      ];

      for (const jSpec of outboxSpecs) {
        const exists = existingUserJobs.some((j) => j.name === jSpec.name);
        if (exists && !options?.force) continue;

        const jobId = db.createJob(
          jSpec.name,
          "SUCCESS",
          jSpec.type,
          "ide",
          null,
          {
            solver: jSpec.solver,
            profile: jSpec.profile,
            seedKey: `outbox-${jSpec.solver}`,
          },
          targetUserId,
        );
        db.updateJobAccounting(jobId, {
          computeProfile: jSpec.profile,
          cpuSeconds: jSpec.cpuSeconds,
          gpuSeconds: jSpec.gpuSeconds,
          peakMemoryMb: jSpec.peakMemoryMb,
          costCredits: jSpec.costCredits,
        });
        db.updateJobStatus(jobId, "SUCCESS");
        try {
          const ts = minutesAgoSqliteTimestamp(jSpec.minutesAgo);
          db.db.prepare(`UPDATE jobs SET started_at = ?, completed_at = ? WHERE id = ?`).run(ts, ts, jobId);
        } catch {}
        outboxJobsSeeded++;
      }
    }

    const userJobsAfter = db.getUserCompletedHpcJobs(targetUserId, 10);
    const ehaJobId = userJobsAfter[0]?.id ?? 1;
    const cfdJobId = userJobsAfter[1]?.id ?? 2;

    // ─────────────────────────────────────────────────────────────────────────
    // 2. SAVED: Seed Bookmarks on Showcase Polyglot Artifacts
    // ─────────────────────────────────────────────────────────────────────────
    const existingBookmarkCount =
      (
        db.db.prepare(`SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ?`).get(targetUserId) as
          | { count: number }
          | undefined
      )?.count ?? 0;
    if (existingBookmarkCount < 3 || options?.force) {
      for (const [idx, post] of showcasePosts.slice(0, 5).entries()) {
        const res = insertBookmarkStmt.run(targetUserId, post.id, minutesAgoSqliteTimestamp(30 + idx * 75));
        if (res.changes > 0) {
          bookmarksSeeded++;
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. INBOX, SAVED (STARRED), & ARCHIVE: Seed Multi-Domain Notifications
    // ─────────────────────────────────────────────────────────────────────────
    const alreadySeeded = checkSeededNotifStmt.get(targetUserId, '%"seedKey":"inbox-sim-eha-completed"%');
    if (alreadySeeded && !options?.force) {
      continue;
    }

    const elenaId = getActorId("elena_vance", targetUserId);
    const marcusId = getActorId("marcus_chen", targetUserId);
    const astridId = getActorId("astrid_solberg", targetUserId);
    const claireId = getActorId("claire_dubois", targetUserId);
    const kenjiId = getActorId("kenji_takahashi", targetUserId);
    const priyaId = getActorId("priya_nair", targetUserId);
    const vikramId = getActorId("vikram_patel", targetUserId);
    const mateoId = getActorId("mateo_silva", targetUserId);

    interface SeedNotifSpec {
      seedKey: string;
      actorId: number;
      type: string;
      postId: number | null;
      metadata: Record<string, unknown> | null;
      read: 0 | 1;
      archived: 0 | 1;
      starred: 0 | 1;
      minutesAgo: number;
    }

    const notifSpecs: SeedNotifSpec[] = [
      // ── ENGINEERING (Simulation Completed / Failed) ──
      {
        seedKey: "inbox-sim-eha-completed",
        actorId: elenaId,
        type: "simulation_completed",
        postId: primaryPostId,
        metadata: {
          seedKey: "inbox-sim-eha-completed",
          name: "AetherDynamics.Actuators.ElectroHydrostaticActuator",
          solver: "DASSL (Radau IIA 5th-Order)",
          profile: "standard (16 vCPU)",
          duration: "14.8",
          costCredits: 0.85,
          jobId: ehaJobId,
        },
        read: 0,
        archived: 0,
        starred: 1, // Appears in Inbox AND Saved
        minutesAgo: 12,
      },
      {
        seedKey: "inbox-sim-lox-failed",
        actorId: astridId,
        type: "simulation_failed",
        postId: null,
        metadata: {
          seedKey: "inbox-sim-lox-failed",
          name: "NordicSubsea.Cryogenic.LOXFeedline_Cavitation",
          solver: "SUNDIALS IDA / BDF",
          profile: "high-cpu (64-Core EPYC)",
          duration: "42.3",
          costCredits: 0,
          jobId: cfdJobId,
          error:
            "[IDA_CONV_FAIL at t = 1.84209 s] Nonlinear Newton iteration failed to converge in two-phase flashing choke valve 'V_jt01': Jacobian singular near vapor quality x = 0.998 (dP/drho -> 0). Suggest enabling homotopy continuation or reducing maxStep to 1e-4 s.",
        },
        read: 0,
        archived: 0,
        starred: 0,
        minutesAgo: 34,
      },
      {
        seedKey: "inbox-sim-hvdc-completed",
        actorId: marcusId,
        type: "simulation_completed",
        postId: secondaryPostId,
        metadata: {
          seedKey: "inbox-sim-hvdc-completed",
          name: "TerraGrid.IEEE2800.MMC_HVDC_FaultRideThrough",
          solver: "EMT Trapezoidal-BDF2 (dt = 25 µs)",
          profile: "gpu-a100 (NVIDIA A100 80GB)",
          duration: "86.2",
          costCredits: 3.1,
          jobId: cfdJobId,
        },
        read: 1,
        archived: 0,
        starred: 0,
        minutesAgo: 195,
      },
      {
        seedKey: "inbox-sim-brayton-archived",
        actorId: vikramId,
        type: "simulation_completed",
        postId: null,
        metadata: {
          seedKey: "inbox-sim-brayton-archived",
          name: "Propulsion.Thermodynamics.ClosedLoopBrayton_sCO2",
          solver: "DASSL",
          profile: "standard",
          duration: "8.4",
          costCredits: 0.35,
          jobId: ehaJobId,
        },
        read: 1,
        archived: 1, // Appears in Archive tab
        starred: 0,
        minutesAgo: 2880,
      },

      // ── PACKAGES (Published / Yanked) ──
      {
        seedKey: "inbox-pkg-ieee2800-published",
        actorId: marcusId,
        type: "package_published",
        postId: null,
        metadata: {
          seedKey: "inbox-pkg-ieee2800-published",
          packageName: "@terragrid/ieee2800-grid-forming",
          packageVersion: "2.4.0",
          distTag: "latest",
          totalFiles: 48,
        },
        read: 0,
        archived: 0,
        starred: 1, // Appears in Inbox AND Saved
        minutesAgo: 24,
      },
      {
        seedKey: "inbox-pkg-actuators-published",
        actorId: elenaId,
        type: "package_published",
        postId: null,
        metadata: {
          seedKey: "inbox-pkg-actuators-published",
          packageName: "@aether-dynamics/flight-actuators",
          packageVersion: "1.9.2",
          distTag: "stable",
          totalFiles: 34,
        },
        read: 1,
        archived: 0,
        starred: 0,
        minutesAgo: 380,
      },
      {
        seedKey: "inbox-pkg-fmi1-yanked",
        actorId: kenjiId,
        type: "package_yanked",
        postId: null,
        metadata: {
          seedKey: "inbox-pkg-fmi1-yanked",
          packageName: "@modelscript/fmi1-legacy-bridge",
          packageVersion: "0.8.1",
          distTag: "deprecated",
          reason: "Superseded by FMI 2.0/3.0 zero-copy shared memory bridge in @modelscript/exchange@2.1.0.",
        },
        read: 1,
        archived: 0,
        starred: 0,
        minutesAgo: 1080,
      },
      {
        seedKey: "inbox-pkg-thermo-archived",
        actorId: claireId,
        type: "package_published",
        postId: null,
        metadata: {
          seedKey: "inbox-pkg-thermo-archived",
          packageName: "@modelscript/thermo-fluid-props",
          packageVersion: "3.1.0",
          distTag: "latest",
          totalFiles: 62,
        },
        read: 1,
        archived: 1, // Appears in Archive tab
        starred: 0,
        minutesAgo: 4320,
      },

      // ── SOCIAL (Mentions, Replies, Grouped Likes, Grouped Reposts, Follows) ──
      {
        seedKey: "inbox-social-mention-eha",
        actorId: elenaId,
        type: "mention",
        postId: primaryPostId,
        metadata: { seedKey: "inbox-social-mention-eha" },
        read: 0,
        archived: 0,
        starred: 1,
        minutesAgo: 18,
      },
      {
        seedKey: "inbox-social-reply-review",
        actorId: claireId,
        type: "reply",
        postId: firstReplyId,
        metadata: { seedKey: "inbox-social-reply-review" },
        read: 0,
        archived: 0,
        starred: 0,
        minutesAgo: 46,
      },
      // 4 likes on the same post to demonstrate multi-actor grouped rollups in the stream
      {
        seedKey: "inbox-social-like-1",
        actorId: elenaId,
        type: "like",
        postId: primaryPostId,
        metadata: { seedKey: "inbox-social-like-1" },
        read: 0,
        archived: 0,
        starred: 0,
        minutesAgo: 70,
      },
      {
        seedKey: "inbox-social-like-2",
        actorId: marcusId,
        type: "like",
        postId: primaryPostId,
        metadata: { seedKey: "inbox-social-like-2" },
        read: 0,
        archived: 0,
        starred: 0,
        minutesAgo: 72,
      },
      {
        seedKey: "inbox-social-like-3",
        actorId: kenjiId,
        type: "like",
        postId: primaryPostId,
        metadata: { seedKey: "inbox-social-like-3" },
        read: 0,
        archived: 0,
        starred: 0,
        minutesAgo: 75,
      },
      {
        seedKey: "inbox-social-like-4",
        actorId: priyaId,
        type: "like",
        postId: primaryPostId,
        metadata: { seedKey: "inbox-social-like-4" },
        read: 0,
        archived: 0,
        starred: 0,
        minutesAgo: 78,
      },
      // 2 reposts on secondary post
      {
        seedKey: "inbox-social-repost-1",
        actorId: astridId,
        type: "repost",
        postId: secondaryPostId,
        metadata: { seedKey: "inbox-social-repost-1" },
        read: 1,
        archived: 0,
        starred: 0,
        minutesAgo: 250,
      },
      {
        seedKey: "inbox-social-repost-2",
        actorId: vikramId,
        type: "repost",
        postId: secondaryPostId,
        metadata: { seedKey: "inbox-social-repost-2" },
        read: 1,
        archived: 0,
        starred: 0,
        minutesAgo: 255,
      },
      {
        seedKey: "inbox-social-follow-priya",
        actorId: priyaId,
        type: "follow",
        postId: null,
        metadata: { seedKey: "inbox-social-follow-priya" },
        read: 1,
        archived: 0,
        starred: 0,
        minutesAgo: 420,
      },
      {
        seedKey: "inbox-social-reply-archived",
        actorId: mateoId,
        type: "reply",
        postId: secondReplyId,
        metadata: { seedKey: "inbox-social-reply-archived" },
        read: 1,
        archived: 1, // Appears in Archive tab
        starred: 0,
        minutesAgo: 3600,
      },

      // ── SYSTEM (Security Alerts & Compute Credit Warnings) ──
      {
        seedKey: "inbox-sys-security-key-audit",
        actorId: elenaId,
        type: "security_alert",
        postId: null,
        metadata: {
          seedKey: "inbox-sys-security-key-audit",
          reason:
            "Hardware-backed Ed25519 signing key attestation verified for primary workstation key (SHA256:9f84c2e1...b70a). 1 personal access token has not been rotated in 90 days — review active credentials in Security Settings.",
          skipEmail: true,
        },
        read: 0,
        archived: 0,
        starred: 0,
        minutesAgo: 55,
      },
      {
        seedKey: "inbox-sys-credit-quota",
        actorId: marcusId,
        type: "credit_warning",
        postId: null,
        metadata: {
          seedKey: "inbox-sys-credit-quota",
          balance: 42.5,
          message:
            "Monthly HPC cluster allocation for 'Aether Dynamics Aerospace' reached 80% utilization (340 / 425 compute credits consumed across 18 Slurm jobs).",
        },
        read: 1,
        archived: 0,
        starred: 0,
        minutesAgo: 720,
      },
      {
        seedKey: "inbox-sys-security-archived",
        actorId: elenaId,
        type: "security_alert",
        postId: null,
        metadata: {
          seedKey: "inbox-sys-security-archived",
          reason:
            "Automated supply-chain dependency audit completed across 14 workspace packages: 0 critical or high vulnerabilities detected.",
          skipEmail: true,
        },
        read: 1,
        archived: 1, // Appears in Archive tab
        starred: 0,
        minutesAgo: 5760,
      },
    ];

    db.transaction(() => {
      for (const spec of notifSpecs) {
        insertNotifStmt.run(
          targetUserId,
          spec.actorId,
          spec.type,
          spec.postId,
          spec.metadata ? JSON.stringify(spec.metadata) : null,
          spec.read,
          spec.archived,
          spec.starred,
          minutesAgoSqliteTimestamp(spec.minutesAgo),
        );
        notificationsSeeded++;
      }
    });
  }

  return {
    notificationsSeeded,
    bookmarksSeeded,
    outboxJobsSeeded,
  };
}

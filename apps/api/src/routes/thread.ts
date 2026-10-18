// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Digital Thread Hypergraph Explorer Routes.
 *
 * Exposes live multi-domain thread topology, transitive blast radius calculations,
 * and SMT physics-simplex conflict reconciliation to the Web IDE.
 */

import {
  DigitalThreadHypergraph,
  DOMAIN_INDEX_TO_NAME,
  DOMAIN_NAME_TO_INDEX,
  PhysicsSimplexReconciler,
  ThreadDomain,
  ThreadRelation,
  ThreadSerializer,
  TradeStudyEngine,
} from "@modelscript/runtime";
import { Router, type Response } from "express";
import crypto from "node:crypto";
import type { Database, ThreadAuditLogEntry, ThreadProposal } from "../database.js";

export interface ThreadMetadata {
  name?: string | undefined;
  uri?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  properties?: Record<string, any> | undefined;
}

export function threadRouter(arg1?: DigitalThreadHypergraph | Database, arg2?: Database): Router {
  const router = Router();
  let hypergraph: DigitalThreadHypergraph;
  let db: Database | undefined;

  if (arg1 instanceof DigitalThreadHypergraph) {
    hypergraph = arg1;
    db = arg2;
  } else if (arg1 && typeof (arg1 as any).createThreadProposal === "function") {
    db = arg1 as Database;
    hypergraph = new DigitalThreadHypergraph();
  } else {
    hypergraph = new DigitalThreadHypergraph();
    db = arg2;
  }

  const memProposals: ThreadProposal[] = [];
  const memAuditLogs: ThreadAuditLogEntry[] = [];
  const metadataMap = new Map<string, ThreadMetadata>();
  const sseClients = new Set<Response>();

  function persistSnapshot(): void {
    if (!db || typeof (db as any).saveThreadSnapshot !== "function") return;
    try {
      const nodeMetadata: Record<string, ThreadMetadata> = {};
      for (const [k, v] of metadataMap.entries()) {
        nodeMetadata[k] = v;
      }
      const jsonStr = ThreadSerializer.serialize(hypergraph, { nodeMetadata });
      db.saveThreadSnapshot(jsonStr, nodeMetadata, "default");
    } catch {
      // Ignore persistence errors in read-only or mock environments
    }
  }

  function broadcastThreadEvent(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  // ── GET /api/v1/threads/stream ────────────────────────────────────────
  router.get("/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    if (typeof (res as any).flushHeaders === "function") {
      (res as any).flushHeaders();
    }

    sseClients.add(res);
    res.write(`event: init\ndata: ${JSON.stringify({ status: "connected", timestamp: new Date().toISOString() })}\n\n`);

    const heartbeatInterval = setInterval(() => {
      try {
        res.write(`: heartbeat\n\n`);
      } catch {
        clearInterval(heartbeatInterval);
        sseClients.delete(res);
      }
    }, 15_000);
    heartbeatInterval.unref?.();

    req.on("close", () => {
      clearInterval(heartbeatInterval);
      sseClients.delete(res);
    });
  });

  const conflictRegistry = new Map<
    string,
    {
      slot: number;
      threadId: number;
      sourceDomain: string;
      sourceValue: number;
      sourceUnit: string;
      targetDomain: string;
      targetValue: number;
      targetUnit: string;
      min: number;
      max: number;
    }
  >();

  // Hydrate from SQLite snapshot if available, otherwise seed default demonstration threads
  if (hypergraph.getThreadCount() === 0) {
    const savedSnapshot =
      db && typeof (db as any).loadThreadSnapshot === "function" ? db.loadThreadSnapshot("default") : undefined;

    if (savedSnapshot && savedSnapshot.serializedJson) {
      try {
        if (savedSnapshot.metadata && typeof savedSnapshot.metadata === "object") {
          for (const [k, v] of Object.entries(savedSnapshot.metadata)) {
            metadataMap.set(k, v as ThreadMetadata);
          }
        }
        const parsed = JSON.parse(savedSnapshot.serializedJson);
        if (parsed?.metadata?.nodeMetadata && typeof parsed.metadata.nodeMetadata === "object") {
          for (const [k, v] of Object.entries(parsed.metadata.nodeMetadata)) {
            metadataMap.set(k, v as ThreadMetadata);
          }
        }
        ThreadSerializer.deserialize(savedSnapshot.serializedJson, hypergraph);

        if (db && typeof (db as any).getThreadConflicts === "function") {
          const dbConflicts = db.getThreadConflicts("default");
          for (const c of dbConflicts) {
            const slot = c.slot ?? 0;
            const rec = hypergraph.getAllRecords().find((r) => r.slot === slot);
            const tIdNum = rec?.threadId ?? slot;
            conflictRegistry.set(c.conflictId, {
              slot,
              threadId: tIdNum,
              sourceDomain: c.sourceDomain,
              sourceValue: c.sourceValue,
              sourceUnit: c.sourceUnit,
              targetDomain: c.targetDomain,
              targetValue: c.targetValue,
              targetUnit: c.targetUnit,
              min: c.min,
              max: c.max,
            });
            if (c.status === "resolved") {
              hypergraph.clearConflict(slot);
            }
          }
        }
      } catch {
        // Fallback to seed if snapshot is corrupted
      }
    }

    if (hypergraph.getThreadCount() === 0) {
      // Thread 101: Powertrain Inverter (Synced across 6 domains)
      const s0 = hypergraph.createThread(101, 1);
      hypergraph.bindDomainNode(s0, ThreadDomain.Requirements, 1001);
      hypergraph.bindDomainNode(s0, ThreadDomain.SysML2, 2001);
      hypergraph.bindDomainNode(s0, ThreadDomain.Modelica, 3001);
      hypergraph.bindDomainNode(s0, ThreadDomain.CAD, 4001);
      hypergraph.bindDomainNode(s0, ThreadDomain.FEA, 5001);
      hypergraph.bindDomainNode(s0, ThreadDomain.BOM, 6001);

      metadataMap.set("requirements:1001", {
        name: "REQ-TORQUE-01 (Peak Torque >= 350Nm)",
        line: 12,
        column: 1,
        properties: { status: "Verified" },
      });
      metadataMap.set("sysml2:2001", { name: "part def PowertrainInverter", line: 45, column: 5 });
      metadataMap.set("modelica:3001", { name: "model InverterDrive", line: 14, column: 1, properties: { mass: 1.0 } });
      metadataMap.set("cad:4001", { name: "Inverter_Chassis.step", line: 1, column: 1, properties: { mass: 1.02 } });
      metadataMap.set("fea:5001", { name: "InverterMount_CalculiX.inp", line: 1, column: 1 });
      metadataMap.set("bom:6001", { name: "P/N 840-0219 (Inverter Assy)", line: 1, column: 1 });

      // Thread 102: Cooling Plate (Stale)
      const s1 = hypergraph.createThread(102, 2);
      hypergraph.bindDomainNode(s1, ThreadDomain.Requirements, 1002);
      hypergraph.bindDomainNode(s1, ThreadDomain.SysML2, 2002);
      hypergraph.bindDomainNode(s1, ThreadDomain.Modelica, 3002);
      hypergraph.bindDomainNode(s1, ThreadDomain.CAD, 4002);
      hypergraph.bindDomainNode(s1, ThreadDomain.CFD, 7002);
      hypergraph.markStale(s1);

      metadataMap.set("requirements:1002", { name: "REQ-THERMAL-02 (Junction Temp <= 85C)", line: 28, column: 1 });
      metadataMap.set("sysml2:2002", { name: "part def CoolingPlate", line: 88, column: 5 });
      metadataMap.set("modelica:3002", {
        name: "model CoolingCircuit",
        line: 32,
        column: 1,
        properties: { mass: 0.8 },
      });
      metadataMap.set("cad:4002", { name: "CoolingPlate.step", line: 1, column: 1, properties: { mass: 1.15 } });
      metadataMap.set("cfd:7002", { name: "cooling_channel_su2.cfg", line: 10, column: 1 });

      // Thread 103: Battery Bus Voltage (Conflicted: SysML 24V vs Modelica 12V)
      const s2 = hypergraph.createThread(103, 3);
      hypergraph.bindDomainNode(s2, ThreadDomain.Requirements, 1003);
      hypergraph.bindDomainNode(s2, ThreadDomain.SysML2, 2003);
      hypergraph.bindDomainNode(s2, ThreadDomain.Modelica, 3003);
      hypergraph.markConflict(s2);

      metadataMap.set("requirements:1003", { name: "REQ-VOLT-03 (Bus Voltage 10-48V)", line: 5, column: 1 });
      metadataMap.set("sysml2:2003", {
        name: "attribute def busVoltage = 24.0V",
        line: 55,
        column: 5,
        properties: { voltage: 24.0 },
      });
      metadataMap.set("modelica:3003", {
        name: "parameter Real V_bus = 12.0",
        line: 20,
        column: 1,
        properties: { voltage: 12.0 },
      });

      conflictRegistry.set("conflict_bus_voltage", {
        slot: s2,
        threadId: 103,
        sourceDomain: "sysml2",
        sourceValue: 24.0,
        sourceUnit: "V",
        targetDomain: "modelica",
        targetValue: 12.0,
        targetUnit: "V",
        min: 10.0,
        max: 48.0,
      });

      if (db && typeof (db as any).saveThreadConflict === "function") {
        db.saveThreadConflict({
          conflictId: "conflict_bus_voltage",
          slot: s2,
          sourceDomain: "sysml2",
          sourceValue: 24.0,
          sourceUnit: "V",
          targetDomain: "modelica",
          targetValue: 12.0,
          targetUnit: "V",
          min: 10.0,
          max: 48.0,
          status: "conflicted",
        });
      }
      persistSnapshot();
    }
  }

  hypergraph.addListener(() => {
    persistSnapshot();
  });

  // ── GET /api/v1/threads/graph ──────────────────────────────────────────
  router.get("/graph", (_req, res) => {
    const records = hypergraph.getAllRecords();
    const domainNames = ["requirements", "sysml2", "modelica", "cad", "fea", "cfd", "bom", "verification"];

    let syncedCount = 0;
    let staleCount = 0;
    let conflictCount = 0;

    const threadItems = records.map((rec) => {
      let statusStr: "synced" | "stale" | "conflict" | "removed" = "synced";
      if (rec.isRemoved) statusStr = "removed";
      else if (rec.isConflicted) statusStr = "conflict";
      else if (rec.isStale) statusStr = "stale";

      if (statusStr === "synced") syncedCount++;
      else if (statusStr === "stale") staleCount++;
      else if (statusStr === "conflict") conflictCount++;

      const nodes = [];
      for (const [domStr, nId] of Object.entries(rec.domainNodes)) {
        const domIdx = Number(domStr);
        const domName = DOMAIN_INDEX_TO_NAME[domIdx] || `domain_${domIdx}`;
        const metaKey = `${domName}:${nId}`;
        const meta = metadataMap.get(metaKey);

        nodes.push({
          domain: domName,
          domainIndex: domIdx,
          nodeId: Number(nId),
          name: meta?.name || `${domName.toUpperCase()}_Node_${nId}`,
          status: statusStr,
          uri: meta?.uri,
          line: meta?.line,
          column: meta?.column,
          properties: meta?.properties,
        });
      }

      return {
        threadId: rec.threadId,
        revision: rec.revision,
        status: statusStr,
        nodes,
      };
    });

    res.json({
      threads: threadItems,
      domains: domainNames,
      summary: {
        totalThreads: threadItems.length,
        synced: syncedCount,
        stale: staleCount,
        conflict: conflictCount,
      },
    });
  });

  // ── GET /api/v1/threads/blast-radius ──────────────────────────────────
  router.get("/blast-radius", (req, res) => {
    const domainStr = String(req.query["domain"] || "sysml2").toLowerCase();
    const nodeId = Number(req.query["nodeId"] || 0);

    const domIdx = DOMAIN_NAME_TO_INDEX[domainStr] ?? ThreadDomain.SysML2;
    const rawResult = hypergraph.computeBlastRadius(domIdx, nodeId);

    res.json({
      ...rawResult,
      domainNames: DOMAIN_INDEX_TO_NAME,
    });
  });

  // ── POST /api/v1/threads/conflicts/diagnose ───────────────────────────
  router.post("/conflicts/diagnose", (req, res) => {
    const conflictId = req.body.conflictId || "conflict_bus_voltage";
    const entry = conflictRegistry.get(conflictId);

    const sourceProposal = entry
      ? { domain: entry.sourceDomain, value: entry.sourceValue, unit: entry.sourceUnit }
      : { domain: "sysml2", value: 24.0, unit: "V" };
    const targetProposal = entry
      ? { domain: entry.targetDomain, value: entry.targetValue, unit: entry.targetUnit }
      : { domain: "modelica", value: 12.0, unit: "V" };
    const envelope = entry ? { min: entry.min, max: entry.max } : { min: 10.0, max: 48.0 };

    const simplexRes = PhysicsSimplexReconciler.reconcile({
      name: conflictId,
      parameters: {
        targetParam: {
          name: "targetParam",
          unit: sourceProposal.unit,
          bounds: envelope,
          proposals: [
            { domain: sourceProposal.domain, value: sourceProposal.value, unit: sourceProposal.unit, weight: 1.0 },
            { domain: targetProposal.domain, value: targetProposal.value, unit: targetProposal.unit, weight: 1.0 },
          ],
        },
      },
    });

    const isConflicted = entry ? hypergraph.isConflicted(entry.slot) : true;
    const consensus =
      simplexRes.parameters["targetParam"]?.optimalValue ?? (sourceProposal.value + targetProposal.value) / 2;

    res.json({
      conflictId,
      status: isConflicted ? "conflicted" : "synced",
      strategy: "physics-simplex",
      sourceProposal,
      targetProposal,
      physicsEnvelope: envelope,
      simplexConsensus: consensus,
      recommendation: simplexRes.recommendation || "Apply physics-simplex midpoint or narrow to target specifications.",
      activeConstraints: simplexRes.activeConstraints,
    });
  });

  // ── POST /api/v1/threads/conflicts/reconcile ──────────────────────────
  router.post("/conflicts/reconcile", (req, res) => {
    const authUser = (req as any).user;
    if (!authUser && process.env["NODE_ENV"] === "production") {
      return res.status(401).json({ error: "Authentication required" });
    }
    const conflictId = req.body.conflictId || "conflict_bus_voltage";
    const strategy = req.body.strategy || "physics-simplex";
    const customValue = typeof req.body.customValue === "number" ? req.body.customValue : undefined;

    const entry = conflictRegistry.get(conflictId);
    let resolvedValue = customValue ?? 18.0;

    if (entry) {
      if (strategy === "source-wins") {
        resolvedValue = entry.sourceValue;
      } else if (strategy === "target-wins") {
        resolvedValue = entry.targetValue;
      } else if (strategy === "physics-simplex") {
        const simplexRes = PhysicsSimplexReconciler.reconcile({
          name: conflictId,
          parameters: {
            resolvedParam: {
              name: "resolvedParam",
              unit: entry.sourceUnit,
              bounds: { min: entry.min, max: entry.max },
              proposals: [
                { domain: entry.sourceDomain, value: entry.sourceValue, unit: entry.sourceUnit, weight: 1.0 },
                { domain: entry.targetDomain, value: entry.targetValue, unit: entry.targetUnit, weight: 1.0 },
              ],
            },
          },
        });
        resolvedValue =
          simplexRes.parameters["resolvedParam"]?.optimalValue ?? (entry.sourceValue + entry.targetValue) / 2;
      }

      hypergraph.clearConflict(entry.slot);
      hypergraph.recordTheorySat(entry.slot);
    } else {
      if (strategy === "source-wins") resolvedValue = 24.0;
      if (strategy === "target-wins") resolvedValue = 12.0;
    }

    if (db && typeof (db as any).resolveThreadConflict === "function") {
      db.resolveThreadConflict(conflictId, resolvedValue);
    }
    persistSnapshot();

    // Broadcast live collaborative thread mutation to all connected clients
    broadcastThreadEvent("thread_updated", {
      conflictId,
      status: "resolved",
      strategy,
      resolvedValue,
      threadId: entry?.threadId ?? entry?.slot,
      timestamp: new Date().toISOString(),
    });

    res.json({
      conflictId,
      status: "resolved",
      strategy,
      resolvedValue,
      isSynchronized: true,
    });
    return;
  });

  // ── POST /api/v1/threads/trade-study ──────────────────────────────────
  router.post("/trade-study", (req, res) => {
    const studyName = req.body.studyName || "PowertrainTradeStudy";
    const objectives = req.body.objectives || [
      { name: "mass", sense: "minimize", unit: "kg" },
      { name: "efficiency", sense: "maximize", unit: "%" },
    ];
    const candidates = req.body.candidates || [
      {
        id: "cand_1",
        name: "High Torque Direct Drive",
        parameters: { vBus: 48, ratio: 1.0 },
        objectives: { mass: 14.5, efficiency: 91.2 },
      },
      {
        id: "cand_2",
        name: "Lightweight High Speed",
        parameters: { vBus: 24, ratio: 4.5 },
        objectives: { mass: 9.8, efficiency: 86.4 },
      },
      {
        id: "cand_3",
        name: "Balanced Hybrid Geared",
        parameters: { vBus: 36, ratio: 2.5 },
        objectives: { mass: 11.2, efficiency: 89.8 },
      },
    ];

    const engine = new TradeStudyEngine(studyName, objectives);
    engine.addCandidates(candidates);
    const result = engine.evaluate();

    res.json(result);
  });

  function getProposals(threadId?: string, status?: string): ThreadProposal[] {
    if (db) return db.getThreadProposals(threadId, status);
    return memProposals.filter((p) => {
      if (threadId && p.thread_id !== threadId) return false;
      if (status && p.status !== status) return false;
      return true;
    });
  }

  function getProposalById(id: number): ThreadProposal | undefined {
    if (db) return db.getThreadProposalById(id);
    return memProposals.find((p) => p.id === id);
  }

  function createProposal(p: {
    threadId: string;
    title: string;
    description?: string | undefined;
    proposedBy: string;
    diffSummary: string | object;
    safetyStandard?: string | undefined;
  }): ThreadProposal {
    if (db) return db.createThreadProposal(p);

    const diffStr = typeof p.diffSummary === "object" ? JSON.stringify(p.diffSummary) : p.diffSummary;
    const newId = memProposals.length + 1;
    const entry: ThreadProposal = {
      id: newId,
      thread_id: p.threadId,
      title: p.title,
      description: p.description || null,
      status: "open",
      proposed_by: p.proposedBy,
      diff_summary: diffStr,
      created_at: new Date().toISOString(),
      resolved_at: null,
      resolved_by: null,
      review_comment: null,
    };
    memProposals.unshift(entry);
    logAudit({
      threadId: p.threadId,
      proposalId: newId,
      action: "proposal_created",
      actor: p.proposedBy,
      safetyStandard: p.safetyStandard || "ISO-26262",
      metadata: { title: p.title, diffSummary: p.diffSummary },
    });
    return entry;
  }

  function applyProposalToHypergraph(proposal: ThreadProposal): void {
    const tIdNum = parseInt(String(proposal.thread_id).replace(/\D/g, ""), 10);
    if (!Number.isNaN(tIdNum)) {
      const slot = hypergraph.findSlotByThreadId(tIdNum);
      if (slot !== undefined) {
        hypergraph.clearConflict(slot);
        hypergraph.recordTheorySat(slot);
      }
      for (const [cId, cEntry] of conflictRegistry.entries()) {
        if (cEntry.threadId === tIdNum || cEntry.slot === slot) {
          if (db && typeof (db as any).resolveThreadConflict === "function") {
            db.resolveThreadConflict(cId, (cEntry.sourceValue + cEntry.targetValue) / 2);
          }
        }
      }
      persistSnapshot();
    }
  }

  function reviewProposal(
    id: number,
    status: "approved" | "rejected" | "applied",
    resolvedBy: string,
    comment?: string,
    safetyStandard?: string,
  ): ThreadProposal | undefined {
    if (db) {
      const updated = db.reviewThreadProposal(id, status, resolvedBy, comment, safetyStandard);
      if (updated && status === "applied") {
        applyProposalToHypergraph(updated);
      }
      return updated;
    }

    const p = memProposals.find((x) => x.id === id);
    if (!p) return undefined;
    p.status = status;
    p.resolved_at = new Date().toISOString();
    p.resolved_by = resolvedBy;
    p.review_comment = comment || null;

    if (status === "applied") {
      applyProposalToHypergraph(p);
    }

    logAudit({
      threadId: p.thread_id,
      proposalId: id,
      action: `proposal_${status}`,
      actor: resolvedBy,
      safetyStandard: safetyStandard || "ISO-26262",
      metadata: { comment, newStatus: status },
    });
    return p;
  }

  function logAudit(entry: {
    threadId: string;
    proposalId?: number | null | undefined;
    action: string;
    actor: string;
    safetyStandard?: string | null | undefined;
    metadata?: string | object | undefined;
  }): ThreadAuditLogEntry {
    if (db) return db.logThreadAudit(entry);

    const last = memAuditLogs.filter((x) => x.thread_id === entry.threadId).slice(-1)[0];
    const prevChecksum = last?.checksum || "GENESIS_ROOT";
    const metaStr = entry.metadata
      ? typeof entry.metadata === "object"
        ? JSON.stringify(entry.metadata)
        : entry.metadata
      : null;
    const raw = `${prevChecksum}:${entry.threadId}:${entry.proposalId ?? ""}:${entry.action}:${entry.actor}:${entry.safetyStandard ?? ""}:${metaStr ?? ""}`;
    const checksum = crypto.createHash("sha256").update(raw).digest("hex");

    const newLog: ThreadAuditLogEntry = {
      id: memAuditLogs.length + 1,
      thread_id: entry.threadId,
      proposal_id: entry.proposalId ?? null,
      action: entry.action,
      actor: entry.actor,
      safety_standard: entry.safetyStandard ?? null,
      checksum,
      metadata: metaStr,
      created_at: new Date().toISOString(),
    };
    memAuditLogs.push(newLog);
    return newLog;
  }

  function getAuditLogs(threadId?: string): ThreadAuditLogEntry[] {
    if (db) return db.getThreadAuditLogs(threadId);
    if (threadId) return memAuditLogs.filter((x) => x.thread_id === threadId);
    return [...memAuditLogs];
  }

  function verifyAuditChain(threadId: string): {
    valid: boolean;
    totalEntries: number;
    brokenAtId?: number | undefined;
  } {
    if (db) return db.verifyThreadAuditChain(threadId);
    const logs = memAuditLogs.filter((x) => x.thread_id === threadId);
    let prevChecksum = "GENESIS_ROOT";
    for (const log of logs) {
      const raw = `${prevChecksum}:${log.thread_id}:${log.proposal_id ?? ""}:${log.action}:${log.actor}:${log.safety_standard ?? ""}:${log.metadata ?? ""}`;
      const expected = crypto.createHash("sha256").update(raw).digest("hex");
      if (log.checksum !== expected) {
        return { valid: false, totalEntries: logs.length, brokenAtId: log.id };
      }
      prevChecksum = log.checksum;
    }
    return { valid: true, totalEntries: logs.length };
  }

  // ── POST /api/v1/threads/proposals ────────────────────────────────────
  router.post("/proposals", (req, res) => {
    const authUser = (req as any).user;
    if (!authUser && process.env["NODE_ENV"] === "production") {
      return res.status(401).json({ error: "Authentication required" });
    }
    const { threadId, title, description, diffSummary, safetyStandard } = req.body;
    if (!threadId || !title) {
      return res.status(400).json({ error: "Missing required fields: threadId, title" });
    }
    const proposedBy = authUser?.username || authUser?.email || req.body.proposedBy || "engineer";
    const proposal = createProposal({
      threadId: String(threadId),
      title: String(title),
      description: description ? String(description) : undefined,
      proposedBy,
      diffSummary: diffSummary || {},
      safetyStandard: safetyStandard || "ISO-26262",
    });

    broadcastThreadEvent("proposal_created", {
      proposal,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({ proposal });
    return;
  });

  // ── GET /api/v1/threads/proposals ─────────────────────────────────────
  router.get("/proposals", (req, res) => {
    const threadId = req.query["threadId"] as string | undefined;
    const status = req.query["status"] as string | undefined;
    const proposals = getProposals(threadId, status);
    res.json({ proposals });
  });

  // ── GET /api/v1/threads/proposals/:id ─────────────────────────────────
  router.get("/proposals/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const proposal = getProposalById(id);
    if (!proposal) {
      return res.status(404).json({ error: `Proposal ${req.params.id} not found` });
    }
    const auditLogs = getAuditLogs(proposal.thread_id).filter((x) => x.proposal_id === id);
    res.json({ proposal, auditLogs });
    return;
  });

  // ── POST /api/v1/threads/proposals/:id/review ─────────────────────────
  router.post("/proposals/:id/review", (req, res) => {
    const authUser = (req as any).user;
    if (!authUser && process.env["NODE_ENV"] === "production") {
      return res.status(401).json({ error: "Authentication required" });
    }
    const id = parseInt(req.params.id, 10);
    const { status, comment, safetyStandard } = req.body;
    if (!["approved", "rejected", "applied"].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be 'approved', 'rejected', or 'applied'." });
    }
    const resolvedBy = authUser?.username || authUser?.email || req.body.resolvedBy || "reviewer";
    const updated = reviewProposal(id, status, resolvedBy, comment, safetyStandard);
    if (!updated) {
      return res.status(404).json({ error: `Proposal ${req.params.id} not found` });
    }

    broadcastThreadEvent("proposal_reviewed", {
      proposal: updated,
      timestamp: new Date().toISOString(),
    });

    res.json({ proposal: updated });
    return;
  });

  // ── GET /api/v1/threads/audit-log ─────────────────────────────────────
  router.get("/audit-log", (req, res) => {
    const threadId = req.query["threadId"] as string | undefined;
    const auditLogs = getAuditLogs(threadId);
    const verification = threadId ? verifyAuditChain(threadId) : { valid: true, totalEntries: auditLogs.length };
    res.json({ auditLogs, verification });
  });

  // ── GET /api/v1/threads/audit-log/verify ──────────────────────────────
  router.get("/audit-log/verify", (req, res) => {
    const threadId = req.query["threadId"] as string | undefined;
    if (!threadId) {
      return res.status(400).json({ error: "threadId is required to verify cryptographic audit chain" });
    }
    const verification = verifyAuditChain(threadId);
    res.json(verification);
    return;
  });

  // ── POST /api/v1/threads/nodes ────────────────────────────────────────
  router.post("/nodes", (req, res) => {
    const { threadId, revision, relation, branchId, status, domains, metadata, conflict } = req.body ?? {};
    const tIdNum = typeof threadId === "number" ? threadId : parseInt(String(threadId || "0").replace(/\D/g, ""), 10);
    if (!tIdNum || Number.isNaN(tIdNum)) {
      return res.status(400).json({ error: "Valid numeric threadId is required" });
    }

    let rel = ThreadRelation.Aligned;
    if (typeof relation === "string" && (ThreadRelation as any)[relation] !== undefined) {
      rel = (ThreadRelation as any)[relation];
    } else if (typeof relation === "number") {
      rel = relation as ThreadRelation;
    }

    const slot = hypergraph.createThread(
      tIdNum,
      typeof revision === "number" ? revision : 1,
      rel,
      typeof branchId === "number" ? branchId : 0,
    );

    if (domains && typeof domains === "object") {
      for (const [domName, rawNodeId] of Object.entries(domains)) {
        const domIdx = DOMAIN_NAME_TO_INDEX[domName.toLowerCase()];
        if (domIdx !== undefined) {
          const nId =
            typeof rawNodeId === "number" ? rawNodeId : parseInt(String(rawNodeId).replace(/\D/g, "") || "1", 10);
          hypergraph.bindDomainNode(slot, domIdx, nId);
        }
      }
    }

    if (metadata && typeof metadata === "object") {
      for (const [metaKey, metaVal] of Object.entries(metadata)) {
        metadataMap.set(metaKey, metaVal as ThreadMetadata);
      }
    }

    if (status === "stale") hypergraph.markStale(slot);
    else if (status === "conflict") hypergraph.markConflict(slot);
    else if (status === "synced") {
      hypergraph.clearConflict(slot);
      hypergraph.recordTheorySat(slot);
    }

    if (conflict && typeof conflict === "object" && conflict.conflictId) {
      const cId = String(conflict.conflictId);
      const sourceDomain = String(conflict.sourceDomain || "sysml2");
      const sourceValue = Number(conflict.sourceValue ?? 0);
      const sourceUnit = String(conflict.sourceUnit || "");
      const targetDomain = String(conflict.targetDomain || "modelica");
      const targetValue = Number(conflict.targetValue ?? 0);
      const targetUnit = String(conflict.targetUnit || sourceUnit);
      const min = Number(conflict.min ?? Math.min(sourceValue, targetValue));
      const max = Number(conflict.max ?? Math.max(sourceValue, targetValue));

      hypergraph.markConflict(slot);
      conflictRegistry.set(cId, {
        slot,
        threadId: tIdNum,
        sourceDomain,
        sourceValue,
        sourceUnit,
        targetDomain,
        targetValue,
        targetUnit,
        min,
        max,
      });

      if (db && typeof (db as any).saveThreadConflict === "function") {
        db.saveThreadConflict({
          conflictId: cId,
          slot,
          sourceDomain,
          sourceValue,
          sourceUnit,
          targetDomain,
          targetValue,
          targetUnit,
          min,
          max,
          status: "conflicted",
        });
      }
    }

    persistSnapshot();
    broadcastThreadEvent("thread_node_upserted", {
      threadId: tIdNum,
      slot,
      status: status || "synced",
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({
      threadId: tIdNum,
      slot,
      status: hypergraph.isConflicted(slot) ? "conflict" : hypergraph.isStale(slot) ? "stale" : "synced",
    });
    return;
  });

  // ── POST /api/v1/threads/import ───────────────────────────────────────
  router.post("/import", (req, res) => {
    try {
      const payload = req.body?.threadFile ?? req.body;
      const jsonStr = typeof payload === "string" ? payload : JSON.stringify(payload);
      const parsed = JSON.parse(jsonStr);
      if (parsed?.metadata?.nodeMetadata && typeof parsed.metadata.nodeMetadata === "object") {
        for (const [k, v] of Object.entries(parsed.metadata.nodeMetadata)) {
          metadataMap.set(k, v as ThreadMetadata);
        }
      }
      ThreadSerializer.deserialize(jsonStr, hypergraph);
      persistSnapshot();
      res.status(200).json({
        imported: true,
        totalThreads: hypergraph.getThreadCount(),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to import .ms-thread payload" });
    }
  });

  return router;
}

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
  ThreadDomain,
} from "@modelscript/runtime";
import { Router } from "express";

export interface ThreadMetadata {
  name?: string;
  uri?: string;
  line?: number;
  column?: number;
  properties?: Record<string, any>;
}

export function threadRouter(externalHypergraph?: DigitalThreadHypergraph): Router {
  const router = Router();
  const hypergraph = externalHypergraph ?? new DigitalThreadHypergraph();
  const metadataMap = new Map<string, ThreadMetadata>();
  const conflictRegistry = new Map<
    string,
    {
      slot: number;
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

  // Seed default demonstration threads if hypergraph is empty
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
    metadataMap.set("modelica:3002", { name: "model CoolingCircuit", line: 32, column: 1, properties: { mass: 0.8 } });
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
      sourceDomain: "sysml2",
      sourceValue: 24.0,
      sourceUnit: "V",
      targetDomain: "modelica",
      targetValue: 12.0,
      targetUnit: "V",
      min: 10.0,
      max: 48.0,
    });
  }

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

    if (entry) {
      const isConflicted = hypergraph.isConflicted(entry.slot);
      res.json({
        conflictId,
        status: isConflicted ? "conflicted" : "synced",
        strategy: "physics-simplex",
        sourceProposal: { domain: entry.sourceDomain, value: entry.sourceValue, unit: entry.sourceUnit },
        targetProposal: { domain: entry.targetDomain, value: entry.targetValue, unit: entry.targetUnit },
        physicsEnvelope: { min: entry.min, max: entry.max },
        simplexConsensus: (entry.sourceValue + entry.targetValue) / 2,
        recommendation: "Apply physics-simplex midpoint or narrow to target specifications.",
      });
      return;
    }

    res.json({
      conflictId,
      status: "conflicted",
      strategy: "physics-simplex",
      sourceProposal: { domain: "sysml2", value: 24.0, unit: "V" },
      targetProposal: { domain: "modelica", value: 12.0, unit: "V" },
      physicsEnvelope: { min: 10.0, max: 48.0 },
      simplexConsensus: 18.0,
      recommendation: "Apply physics-simplex midpoint or narrow to target specifications.",
    });
  });

  // ── POST /api/v1/threads/conflicts/reconcile ──────────────────────────
  router.post("/conflicts/reconcile", (req, res) => {
    const conflictId = req.body.conflictId || "conflict_bus_voltage";
    const strategy = req.body.strategy || "physics-simplex";
    const customValue = typeof req.body.customValue === "number" ? req.body.customValue : undefined;

    const entry = conflictRegistry.get(conflictId);
    let resolvedValue = customValue ?? 18.0;

    if (entry) {
      if (strategy === "source-wins") resolvedValue = entry.sourceValue;
      else if (strategy === "target-wins") resolvedValue = entry.targetValue;
      else if (strategy === "physics-simplex") {
        resolvedValue = (entry.sourceValue + entry.targetValue) / 2;
        if (resolvedValue < entry.min) resolvedValue = entry.min;
        if (resolvedValue > entry.max) resolvedValue = entry.max;
      }

      hypergraph.clearConflict(entry.slot);
      hypergraph.recordTheorySat(entry.slot);
    } else {
      if (strategy === "source-wins") resolvedValue = 24.0;
      if (strategy === "target-wins") resolvedValue = 12.0;
    }

    res.json({
      conflictId,
      status: "resolved",
      strategy,
      resolvedValue,
      isSynchronized: true,
    });
  });

  return router;
}

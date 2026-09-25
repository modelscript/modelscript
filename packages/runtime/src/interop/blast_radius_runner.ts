// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Multi-Scale Blast Radius Regression CI/CD Runner.
 *
 * Connects git changesets to the 16-domain DigitalThreadHypergraph, traverses transitive
 * dependencies via `computeBlastRadius`, and schedules only stale downstream simulation,
 * verification, and CAE solver jobs, eliminating redundant whole-system re-computations.
 */

import { DigitalThreadHypergraph, ThreadDomain } from "./thread_hypergraph.js";

export interface ChangedFile {
  path: string;
  changeType: "added" | "modified" | "deleted";
}

export interface VerificationJob {
  id: string;
  domain: ThreadDomain;
  domainName: string;
  targetRef: string;
  reason: string;
  estimatedDurationSec: number;
}

export interface BlastRadiusRegressionPlan {
  changedFiles: string[];
  affectedRootNodes: { domain: ThreadDomain; nodeId: number; name: string }[];
  staleThreadSlots: number[];
  staleDomains: ThreadDomain[];
  scheduledJobs: VerificationJob[];
  skippedJobsCount: number;
  estimatedComputeSavedSec: number;
}

export class BlastRadiusRegressionRunner {
  private fileToDomainNode = new Map<string, { domain: ThreadDomain; nodeId: number; name: string }>();

  public registerMapping(patternOrPath: string, domain: ThreadDomain, nodeId: number, name: string): void {
    this.fileToDomainNode.set(patternOrPath, { domain, nodeId, name });
  }

  /**
   * Evaluates a git changeset against the hypergraph and generates a minimal selective CI plan.
   */
  public plan(
    hypergraph: DigitalThreadHypergraph,
    changedFiles: ChangedFile[],
    branchId: number = 0,
  ): BlastRadiusRegressionPlan {
    const rootNodes: { domain: ThreadDomain; nodeId: number; name: string }[] = [];
    const changedPaths: string[] = [];

    for (const cf of changedFiles) {
      changedPaths.push(cf.path);

      // Match path against registered mappings
      let matched = this.fileToDomainNode.get(cf.path);
      if (!matched) {
        // Fallback file extension heuristic
        if (cf.path.endsWith(".mo")) {
          matched = { domain: ThreadDomain.Modelica, nodeId: this.hash(cf.path), name: cf.path };
        } else if (cf.path.endsWith(".sysml")) {
          matched = { domain: ThreadDomain.SysML2, nodeId: this.hash(cf.path), name: cf.path };
        } else if (cf.path.endsWith(".scad") || cf.path.endsWith(".step") || cf.path.endsWith(".stp")) {
          matched = { domain: ThreadDomain.CAD, nodeId: this.hash(cf.path), name: cf.path };
        } else if (cf.path.endsWith(".inp")) {
          matched = { domain: ThreadDomain.FEA, nodeId: this.hash(cf.path), name: cf.path };
        } else if (cf.path.endsWith(".cfg")) {
          matched = { domain: ThreadDomain.CFD, nodeId: this.hash(cf.path), name: cf.path };
        }
      }

      if (matched) {
        rootNodes.push(matched);
      }
    }

    // Transitively accumulate all stale thread slots
    const allStaleSlots = new Set<number>();
    for (const root of rootNodes) {
      const radius = hypergraph.computeBlastRadius(root.domain, root.nodeId, { branchId });
      for (const node of radius.impactedNodes) {
        allStaleSlots.add(node.slot);
      }
    }

    // Determine which domains are stale
    const staleDomainsSet = new Set<ThreadDomain>();
    for (const slot of allStaleSlots) {
      for (let d = 0; d < 16; d++) {
        const nodeId = hypergraph.getDomainNode(slot, d);
        if (nodeId > 0) {
          staleDomainsSet.add(d as ThreadDomain);
        }
      }
    }

    // Generate schedule jobs
    const jobs: VerificationJob[] = [];
    let savedSec = 0;

    for (const d of staleDomainsSet) {
      const dName = ThreadDomain[d] ?? `Domain_${d}`;

      if (d === ThreadDomain.FEA) {
        jobs.push({
          id: `job_fea_${jobs.length + 1}`,
          domain: d,
          domainName: dName,
          targetRef: "StructuralStressAnalysis",
          reason: "CAD geometry or mechanical loads modified",
          estimatedDurationSec: 120,
        });
      } else if (d === ThreadDomain.CFD) {
        jobs.push({
          id: `job_cfd_${jobs.length + 1}`,
          domain: d,
          domainName: dName,
          targetRef: "AerodynamicPressureDrop",
          reason: "Airfoil or fluid duct geometry modified",
          estimatedDurationSec: 300,
        });
      } else if (d === ThreadDomain.Modelica) {
        jobs.push({
          id: `job_sim_${jobs.length + 1}`,
          domain: d,
          domainName: dName,
          targetRef: "SystemDynamicTransientSimulation",
          reason: "Upstream parameter or architecture modified",
          estimatedDurationSec: 45,
        });
      } else if (d === ThreadDomain.Safety) {
        jobs.push({
          id: `job_safety_${jobs.length + 1}`,
          domain: d,
          domainName: dName,
          targetRef: "ISO26262FaultTreeAnalysis",
          reason: "Component failure modes or safety mechanisms affected",
          estimatedDurationSec: 15,
        });
      } else if (d === ThreadDomain.Verification) {
        jobs.push({
          id: `job_verif_${jobs.length + 1}`,
          domain: d,
          domainName: dName,
          targetRef: "ComplianceMatrixRegeneration",
          reason: "Requirements or verified evidence modified",
          estimatedDurationSec: 10,
        });
      }
    }

    // Estimated saved compute: each domain not scheduled saves typical full run time
    if (!staleDomainsSet.has(ThreadDomain.CFD)) savedSec += 600;
    if (!staleDomainsSet.has(ThreadDomain.FEA)) savedSec += 300;
    if (!staleDomainsSet.has(ThreadDomain.Surrogate)) savedSec += 180;

    const totalPossibleDomains = 8;
    const skippedCount = Math.max(0, totalPossibleDomains - staleDomainsSet.size);

    return {
      changedFiles: changedPaths,
      affectedRootNodes: rootNodes,
      staleThreadSlots: Array.from(allStaleSlots),
      staleDomains: Array.from(staleDomainsSet),
      scheduledJobs: jobs,
      skippedJobsCount: skippedCount,
      estimatedComputeSavedSec: savedSec,
    };
  }

  private hash(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h << 5) - h + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h) % 100000;
  }
}

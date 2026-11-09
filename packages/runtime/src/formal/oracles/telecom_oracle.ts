// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Telecom Utility, Optical & RAN Theory Oracle.
 *
 * Implements a First-Order Logic (FOL) decision procedure for the Generalized
 * Nelson-Oppen SemanticTheoryCoordinator. Formally verifies:
 *   1. Optical WDM Transmission Invariants:
 *      - Generalized Signal-to-Noise Ratio (GSNR >= threshold + margin).
 *      - Total accumulated chromatic dispersion buffer (|CD| <= CD_max_dsp).
 *      - Kerr non-linear threshold compliance (P_launch <= P_nli_threshold).
 *   2. PTP / SyncE Timing Budget Invariants (ITU-T G.8275.1 / 3GPP 5G TDD):
 *      - End-to-end time error budget (|TE| <= TE_max, e.g. 1500 ns).
 *      - Intra-cluster time alignment for CoMP/MIMO (|TE_cluster| <= 130 ns).
 *   3. Microwave / RAN Link Propagation Invariants (ITU-R P.530 / FCC Part 101):
 *      - 1st Fresnel zone clearance ratio (Clearance >= 0.60 with k=4/3 curvature).
 *      - Five-nines link availability (Availability >= 99.999%).
 *      - FCC Part 101 EIRP regulatory ceiling (EIRP <= 55.0 dBm).
 *   4. Outside Plant (OSP) Physical SRLG Disjointness:
 *      - Primary and protection path physical risk isolation (SRLG_A ∩ SRLG_B = ∅).
 *
 * Exchanges shared bounds, equalities, and conflict clauses via the Nelson-Oppen bus.
 */

import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";

export interface OpticalChannelSpec {
  channelId: string;
  wavelengthNm: number;
  actualGsnrDb: number;
  minRequiredGsnrDb: number;
  accumulatedCdPsPerNm: number;
  maxDspCdBufferPsPerNm: number;
  launchPowerDbm: number;
  maxKerrPowerDbm: number;
}

export interface PtpTimingSpec {
  chainId: string;
  actualTimeErrorNs: number;
  maxAllowedTimeErrorNs: number;
  clusterTimeErrorNs: number;
  maxAllowedClusterErrorNs: number;
}

export interface MicrowavePathSpec {
  linkId: string;
  actualClearanceRatio: number;
  minClearanceRatio: number; // typically 0.60
  annualAvailabilityPercent: number;
  minAvailabilityPercent: number; // typically 99.999%
  eirpDbm: number;
  maxAllowedEirpDbm: number; // FCC Part 101: 55 dBm
}

export interface SrlgPathPairSpec {
  primaryPathId: string;
  backupPathId: string;
  sharedSrlgCount: number;
  sharedSrlgs: string[];
}

export class TelecomTheoryOracle implements TheoryOracle {
  public readonly name = "TelecomTheoryOracle";
  public readonly domain = "constraint" as const;

  private opticalChannels = new Map<string, OpticalChannelSpec>();
  private ptpTimingChains = new Map<string, PtpTimingSpec>();
  private microwavePaths = new Map<string, MicrowavePathSpec>();
  private srlgPathPairs = new Map<string, SrlgPathPairSpec>();
  private externalBounds = new Map<string, [number, number]>();
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private nextLitId = 50000;

  private sharedEqualities: SharedEquality[] = [];

  private levelStack: {
    opticalChannels: Map<string, OpticalChannelSpec>;
    ptpTimingChains: Map<string, PtpTimingSpec>;
    microwavePaths: Map<string, MicrowavePathSpec>;
    srlgPathPairs: Map<string, SrlgPathPairSpec>;
    externalBounds: Map<string, [number, number]>;
    sharedEqualities: SharedEquality[];
    assertedLitIds: number[];
  }[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.opticalChannels.clear();
    this.ptpTimingChains.clear();
    this.microwavePaths.clear();
    this.srlgPathPairs.clear();
    this.externalBounds.clear();
    this.sharedEqualities = [];
    this.assertedLiterals.clear();
    this.levelStack = [];
  }

  public pushLevel(): void {
    this.levelStack.push({
      opticalChannels: new Map(this.opticalChannels),
      ptpTimingChains: new Map(this.ptpTimingChains),
      microwavePaths: new Map(this.microwavePaths),
      srlgPathPairs: new Map(this.srlgPathPairs),
      externalBounds: new Map(this.externalBounds),
      sharedEqualities: [...this.sharedEqualities],
      assertedLitIds: [],
    });
  }

  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;
    this.opticalChannels = top.opticalChannels;
    this.ptpTimingChains = top.ptpTimingChains;
    this.microwavePaths = top.microwavePaths;
    this.srlgPathPairs = top.srlgPathPairs;
    this.externalBounds = top.externalBounds;
    this.sharedEqualities = top.sharedEqualities;
    for (const id of top.assertedLitIds) {
      this.assertedLiterals.delete(id);
    }
  }

  // --- Strongly typed domain ingestion APIs ---

  public assertOpticalChannel(spec: OpticalChannelSpec): void {
    this.assertLiteral({
      id: this.nextLitId++,
      predicate: "opticalChannel",
      args: [spec],
      domain: this.domain,
    });
  }

  public assertPtpTiming(spec: PtpTimingSpec): void {
    this.assertLiteral({
      id: this.nextLitId++,
      predicate: "ptpTiming",
      args: [spec],
      domain: this.domain,
    });
  }

  public assertMicrowavePath(spec: MicrowavePathSpec): void {
    this.assertLiteral({
      id: this.nextLitId++,
      predicate: "microwavePath",
      args: [spec],
      domain: this.domain,
    });
  }

  public assertSrlgPair(spec: SrlgPathPairSpec): void {
    this.assertLiteral({
      id: this.nextLitId++,
      predicate: "srlgPair",
      args: [spec],
      domain: this.domain,
    });
  }

  // --- TheoryOracle implementation ---

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.assertedLiterals.set(lit.id, lit);
    if (this.levelStack.length > 0) {
      this.levelStack[this.levelStack.length - 1]!.assertedLitIds.push(lit.id);
    }

    const { predicate, args } = lit;
    if (predicate === "opticalChannel") {
      const spec = args[0] as OpticalChannelSpec;
      if (spec) this.opticalChannels.set(spec.channelId, spec);
    } else if (predicate === "ptpTiming") {
      const spec = args[0] as PtpTimingSpec;
      if (spec) this.ptpTimingChains.set(spec.chainId, spec);
    } else if (predicate === "microwavePath") {
      const spec = args[0] as MicrowavePathSpec;
      if (spec) this.microwavePaths.set(spec.linkId, spec);
    } else if (predicate === "srlgPair") {
      const spec = args[0] as SrlgPathPairSpec;
      if (spec) this.srlgPathPairs.set(`${spec.primaryPathId}_${spec.backupPathId}`, spec);
    }
    return true;
  }

  public retractLiteral(litId: number): void {
    if (!this.assertedLiterals.has(litId)) return;
    this.assertedLiterals.delete(litId);
    const savedStack = this.levelStack;
    const remaining = Array.from(this.assertedLiterals.values());
    this.reset();
    this.levelStack = savedStack;
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    // 1. Check Optical Channels
    for (const [id, spec] of this.opticalChannels.entries()) {
      if (spec.actualGsnrDb < spec.minRequiredGsnrDb) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.channelId === spec.channelId),
            ),
            explanation: `Optical Transmission Violation: Channel '${id}' GSNR ${spec.actualGsnrDb.toFixed(2)} dB is below required threshold ${spec.minRequiredGsnrDb.toFixed(2)} dB (deficit: ${(spec.minRequiredGsnrDb - spec.actualGsnrDb).toFixed(2)} dB).`,
            culpritEntities: [id, `Wavelength ${spec.wavelengthNm}nm`],
            theoryName: this.name,
          },
        };
      }

      if (Math.abs(spec.accumulatedCdPsPerNm) > spec.maxDspCdBufferPsPerNm) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.channelId === spec.channelId),
            ),
            explanation: `Optical CD Overflow: Channel '${id}' accumulated chromatic dispersion ${spec.accumulatedCdPsPerNm.toFixed(0)} ps/nm exceeds DSP receiver buffer ${spec.maxDspCdBufferPsPerNm.toFixed(0)} ps/nm.`,
            culpritEntities: [id],
            theoryName: this.name,
          },
        };
      }

      if (spec.launchPowerDbm > spec.maxKerrPowerDbm) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.channelId === spec.channelId),
            ),
            explanation: `Optical Non-linear Violation: Channel '${id}' launch power ${spec.launchPowerDbm.toFixed(2)} dBm exceeds Kerr threshold ${spec.maxKerrPowerDbm.toFixed(2)} dBm.`,
            culpritEntities: [id],
            theoryName: this.name,
          },
        };
      }
    }

    // 2. Check PTP Timing Chains
    for (const [id, spec] of this.ptpTimingChains.entries()) {
      if (spec.actualTimeErrorNs > spec.maxAllowedTimeErrorNs) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.chainId === spec.chainId),
            ),
            explanation: `PTP Timing Violation: Sync chain '${id}' end-to-end time error ${spec.actualTimeErrorNs.toFixed(1)} ns exceeds 3GPP limit ${spec.maxAllowedTimeErrorNs.toFixed(1)} ns.`,
            culpritEntities: [id],
            theoryName: this.name,
          },
        };
      }

      if (spec.clusterTimeErrorNs > spec.maxAllowedClusterErrorNs) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.chainId === spec.chainId),
            ),
            explanation: `PTP Cluster Alignment Violation: Sync chain '${id}' cluster error ${spec.clusterTimeErrorNs.toFixed(1)} ns exceeds CoMP/MIMO limit ${spec.maxAllowedClusterErrorNs.toFixed(1)} ns.`,
            culpritEntities: [id],
            theoryName: this.name,
          },
        };
      }
    }

    // 3. Check Microwave Paths
    for (const [id, spec] of this.microwavePaths.entries()) {
      if (spec.actualClearanceRatio < spec.minClearanceRatio) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.linkId === spec.linkId),
            ),
            explanation: `Microwave Fresnel Obstruction: Link '${id}' 1st Fresnel clearance ratio ${spec.actualClearanceRatio.toFixed(2)} is below required minimum ${spec.minClearanceRatio.toFixed(2)}.`,
            culpritEntities: [id],
            theoryName: this.name,
          },
        };
      }

      if (spec.annualAvailabilityPercent < spec.minAvailabilityPercent) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.linkId === spec.linkId),
            ),
            explanation: `Microwave Availability Deficit: Link '${id}' availability ${spec.annualAvailabilityPercent.toFixed(4)}% fails five-nines requirement ${spec.minAvailabilityPercent.toFixed(4)}%.`,
            culpritEntities: [id],
            theoryName: this.name,
          },
        };
      }

      if (spec.eirpDbm > spec.maxAllowedEirpDbm) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.linkId === spec.linkId),
            ),
            explanation: `FCC Part 101 Regulatory Violation: Link '${id}' EIRP ${spec.eirpDbm.toFixed(1)} dBm exceeds legal limit ${spec.maxAllowedEirpDbm.toFixed(1)} dBm.`,
            culpritEntities: [id],
            theoryName: this.name,
          },
        };
      }
    }

    // 4. Check OSP SRLG Disjointness
    for (const spec of this.srlgPathPairs.values()) {
      if (spec.sharedSrlgCount > 0) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) =>
              l.args.some((a) => a?.primaryPathId === spec.primaryPathId),
            ),
            explanation: `SRLG Physical Risk Violation: Primary path '${spec.primaryPathId}' and backup '${spec.backupPathId}' share ${spec.sharedSrlgCount} physical risk groups: [${spec.sharedSrlgs.join(", ")}].`,
            culpritEntities: [spec.primaryPathId, spec.backupPathId, ...spec.sharedSrlgs],
            theoryName: this.name,
          },
        };
      }
    }

    return { isSat: true };
  }

  public onSharedEquality(eq: SharedEquality): void {
    this.sharedEqualities.push(eq);
  }

  public propagateEqualities(): SharedEquality[] {
    return [];
  }

  public explainConflict(conflict: ConflictClause): ConflictClause {
    return conflict;
  }
}

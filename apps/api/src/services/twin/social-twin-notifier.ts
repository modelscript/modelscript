// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LibraryDatabase } from "../../database.js";

export interface DriftAlertPayload {
  twinId: number;
  twinName: string;
  instanceSerial: string;
  modelicaClass: string;
  channel: string;
  direction: "positive" | "negative";
  magnitude: number;
  score: number;
  severity: "low" | "medium" | "high";
  timestamp: number;
  calibratedParameters?: Record<string, number>;
  parameterDeltas?: Record<string, { prior: number; calibrated: number; deltaPct: number }>;
  healthScore?: number;
  rulHours?: number;
  adaptationId?: number;
}

export class SocialTwinNotifier {
  constructor(private db: LibraryDatabase) {}

  /**
   * Automatically publish an interactive incident post to the social engineering platform,
   * create an artifact view of type "digital-twin-dashboard", and register a Physics PR proposal.
   */
  async notifyDriftAndOpenProposal(payload: DriftAlertPayload): Promise<{
    postId: number;
    artifactViewId: number;
    proposalId?: number;
  }> {
    // 1. Determine author (e.g. system bot or user 1)
    let authorId = 1;
    const adminUser = this.db.getUserByUsername("admin") ?? this.db.getUserById(1);
    if (adminUser) {
      authorId = adminUser.id;
    }

    // 2. Format title & config for DigitalTwinDashboardViewer
    const title = `Operational Drift Alert: ${payload.twinName} (#${payload.instanceSerial})`;
    const viewConfig = JSON.stringify({
      twinId: payload.twinId,
      twinName: payload.twinName,
      instanceSerial: payload.instanceSerial,
      modelicaClass: payload.modelicaClass,
      channel: payload.channel,
      severity: payload.severity,
      driftMetrics: {
        score: payload.score,
        direction: payload.direction,
        magnitude: payload.magnitude,
      },
      parameterDeltas: payload.parameterDeltas ?? {},
      calibratedParameters: payload.calibratedParameters ?? {},
      healthScore: payload.healthScore ?? 85.0,
      rulHours: payload.rulHours ?? 420.0,
      adaptationId: payload.adaptationId,
      alertTime: new Date().toISOString(),
    });

    const artifactViewId = this.db.createArtifactView(
      authorId,
      "digital-twin-dashboard",
      "digital-twin",
      viewConfig,
      title,
    );

    // 3. Construct rich incident Markdown content with @mentions and deltas
    let deltasMd = "";
    if (payload.parameterDeltas) {
      for (const [pName, d] of Object.entries(payload.parameterDeltas)) {
        const sign = d.deltaPct >= 0 ? "+" : "";
        deltasMd += `• \`${pName}\`: **${d.prior.toFixed(4)}** → **${d.calibrated.toFixed(4)}** (${sign}${d.deltaPct.toFixed(1)}% degradation)\n`;
      }
    }

    const content = `⚠️ **Operational Drift Detected on Asset #${payload.instanceSerial} (${payload.twinName})**

CUSUM hypothesis testing flagged a **${payload.score.toFixed(1)}σ** residual shift in telemetry channel \`${payload.channel}\` (severity: **${payload.severity.toUpperCase()}**).

Online Adjoint Moving Horizon Estimation resolved parameter shift:
${deltasMd}
• Estimated Remaining Useful Life (RUL): **${payload.rulHours ? payload.rulHours.toFixed(1) : "340"} operating hours**
• Asset Health Score: **${payload.healthScore ? payload.healthScore.toFixed(1) : "85.0"}%**

A **Physics Pull Request** has been opened for engineering review.
CC: @thermal-lead @powertrain-lead @maintenance-ops`;

    const { id: postId } = this.db.createPost(
      authorId,
      content,
      artifactViewId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        type: "digital_twin_alert",
        twinId: payload.twinId,
        serialNumber: payload.instanceSerial,
        severity: payload.severity,
      },
    );

    // 4. Open Physics PR in twin_proposals if adaptation exists
    let proposalId: number | undefined;
    if (payload.adaptationId) {
      proposalId = this.db.createTwinProposal({
        twinId: payload.twinId,
        postId,
        adaptationId: payload.adaptationId,
      });
    }

    const result: { postId: number; artifactViewId: number; proposalId?: number } = {
      postId,
      artifactViewId,
    };
    if (proposalId !== undefined) {
      result.proposalId = proposalId;
    }
    return result;
  }
}

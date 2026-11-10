// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * NESC Table 235-5 Vertical Clearances & Joint-Use Make-Ready Engineering Engine.
 *
 * Implements:
 * - NESC ANSI C2-2023 Table 235-5 vertical separation on poles (Power vs. Communication)
 * - Communication Worker Safety Zone (CWSZ): 40" from secondary, 48" from primary, 30" from drip loops
 * - NESC Rule 235H: 12" minimum separation between separate communication attachments
 * - NESC Rule 232: Mid-span vertical ground clearances (roads, highways, railroads, pedestrian)
 * - Automated Make-Ready Work Order and Joint-Use Permit Application exhibit generation
 */

export type AttachmentUtilityType =
  | "electric-primary" // > 750V up to 22kV
  | "electric-secondary" // 0 - 750V triplex / neutral
  | "electric-equipment" // Transformers, capacitors, drip loops
  | "streetlight" // Luminaire bracket / power supply
  | "telco-incumbent" // Incumbent telephone carrier messenger
  | "catv-coax" // Cable TV coaxial / fiber bundle
  | "third-party-fiber" // Proposed new FTTH / backhaul attachment
  | "traffic-signal";

export interface PoleAttachmentPosition {
  id: string;
  ownerName: string;
  utilityType: AttachmentUtilityType;
  heightAboveGroundFeet: number;
  outerDiameterInches?: number | undefined;
  midSpanSagFeet?: number | undefined;
}

export type CrossingEnvironment = "roadway" | "highway" | "railroad" | "pedestrian-only";

export const NESC_GROUND_CLEARANCE_STANDARDS: Record<CrossingEnvironment, number> = {
  roadway: 15.5, // 15.5 ft over residential streets, roads, and alleys
  highway: 18.0, // 18.0 ft over state highways and interstates
  railroad: 24.0, // 24.0 ft over railroad tracks
  "pedestrian-only": 9.5, // 9.5 ft over spaces accessible only to pedestrians
};

export interface ClearanceViolation {
  violationCode: "CWSZ_SECONDARY" | "CWSZ_PRIMARY" | "CWSZ_DRIP_LOOP" | "COMMS_SEPARATION" | "MIDSPAN_GROUND";
  severity: "error" | "warning";
  description: string;
  measuredSeparationInches: number;
  requiredSeparationInches: number;
  deficiencyInches: number;
  involvedAttachmentIds: string[];
}

export interface MakeReadyRecommendation {
  actionType: "NO_ACTION" | "LOWER_EXISTING_COMMS" | "RAISE_EXISTING_COMMS" | "POLE_REPLACEMENT";
  description: string;
  targetAttachmentId: string;
  currentHeightFeet: number;
  recommendedHeightFeet: number;
  isComplexMakeReady: boolean;
}

export interface MakeReadyAuditReport {
  poleId: string;
  proposedAttachmentId: string;
  proposedHeightFeet: number;
  isPermitApprovedWithoutChanges: boolean;
  clearanceViolations: ClearanceViolation[];
  makeReadyRecommendations: MakeReadyRecommendation[];
  attachmentSchedule: Array<{
    id: string;
    owner: string;
    type: AttachmentUtilityType;
    heightFeet: number;
    zone: "Supply Space" | "Safety Zone" | "Communication Space";
  }>;
  jointUseExhibitText: string;
}

/**
 * Audits a pole's vertical attachments against NESC Table 235-5 and generates make-ready engineering exhibits.
 */
export function auditPoleMakeReady(
  poleId: string,
  existingAttachments: PoleAttachmentPosition[],
  proposedAttachment: PoleAttachmentPosition,
  options?: {
    crossing?: CrossingEnvironment | undefined;
    spanLengthFeet?: number | undefined;
  },
): MakeReadyAuditReport {
  const all = [...existingAttachments, proposedAttachment].sort(
    (a, b) => b.heightAboveGroundFeet - a.heightAboveGroundFeet,
  );

  const violations: ClearanceViolation[] = [];
  const recommendations: MakeReadyRecommendation[] = [];

  // 1. Identify lowest supply item and highest communication item
  let lowestSupply: PoleAttachmentPosition | undefined;
  let lowestDripLoop: PoleAttachmentPosition | undefined;

  for (const att of all) {
    if (att.utilityType === "electric-primary") {
      if (!lowestSupply || att.heightAboveGroundFeet < lowestSupply.heightAboveGroundFeet) {
        lowestSupply = att;
      }
    } else if (att.utilityType === "electric-secondary") {
      if (!lowestSupply || att.heightAboveGroundFeet < lowestSupply.heightAboveGroundFeet) {
        lowestSupply = att;
      }
    } else if (att.utilityType === "electric-equipment") {
      if (!lowestDripLoop || att.heightAboveGroundFeet < lowestDripLoop.heightAboveGroundFeet) {
        lowestDripLoop = att;
      }
    }
  }

  // 2. Audit Communication Worker Safety Zone (CWSZ) for the proposed attachment
  const propHInches = proposedAttachment.heightAboveGroundFeet * 12.0;

  if (lowestSupply) {
    const supplyHInches = lowestSupply.heightAboveGroundFeet * 12.0;
    const separationInches = supplyHInches - propHInches;

    const requiredInches = lowestSupply.utilityType === "electric-primary" ? 48.0 : 40.0;
    if (separationInches < requiredInches) {
      const code = lowestSupply.utilityType === "electric-primary" ? "CWSZ_PRIMARY" : "CWSZ_SECONDARY";
      violations.push({
        violationCode: code,
        severity: "error",
        description: `Communication Worker Safety Zone violation: ${separationInches.toFixed(1)}" clearance from ${lowestSupply.ownerName} (${lowestSupply.utilityType}) is less than NESC Table 235-5 required ${requiredInches}".`,
        measuredSeparationInches: Math.round(separationInches * 10) / 10,
        requiredSeparationInches: requiredInches,
        deficiencyInches: Math.round((requiredInches - separationInches) * 10) / 10,
        involvedAttachmentIds: [lowestSupply.id, proposedAttachment.id],
      });
    }
  }

  if (lowestDripLoop) {
    const dripInches = lowestDripLoop.heightAboveGroundFeet * 12.0;
    const separationInches = dripInches - propHInches;
    if (separationInches < 30.0) {
      violations.push({
        violationCode: "CWSZ_DRIP_LOOP",
        severity: "error",
        description: `Clearance to electric equipment/drip loop is ${separationInches.toFixed(1)}", violating NESC Rule 238 required 30" clearance.`,
        measuredSeparationInches: Math.round(separationInches * 10) / 10,
        requiredSeparationInches: 30.0,
        deficiencyInches: Math.round((30.0 - separationInches) * 10) / 10,
        involvedAttachmentIds: [lowestDripLoop.id, proposedAttachment.id],
      });
    }
  }

  // 3. Audit 12" inter-communication separation (NESC Rule 235H)
  const comms = all.filter((a) => ["telco-incumbent", "catv-coax", "third-party-fiber"].includes(a.utilityType));
  for (let i = 0; i < comms.length; i++) {
    for (let j = i + 1; j < comms.length; j++) {
      const a1 = comms[i]!;
      const a2 = comms[j]!;
      const sepInches = Math.abs(a1.heightAboveGroundFeet - a2.heightAboveGroundFeet) * 12.0;
      if (sepInches < 12.0) {
        violations.push({
          violationCode: "COMMS_SEPARATION",
          severity: "error",
          description: `Inter-communication vertical spacing between ${a1.ownerName} (#${a1.id}) and ${a2.ownerName} (#${a2.id}) is ${sepInches.toFixed(1)}", violating NESC Rule 235H required 12" separation.`,
          measuredSeparationInches: Math.round(sepInches * 10) / 10,
          requiredSeparationInches: 12.0,
          deficiencyInches: Math.round((12.0 - sepInches) * 10) / 10,
          involvedAttachmentIds: [a1.id, a2.id],
        });
      }
    }
  }

  // 4. Audit Mid-span ground clearance if crossing environment is specified
  if (options?.crossing && proposedAttachment.midSpanSagFeet !== undefined) {
    const minGroundReq = NESC_GROUND_CLEARANCE_STANDARDS[options.crossing];
    const midspanClearance = proposedAttachment.heightAboveGroundFeet - proposedAttachment.midSpanSagFeet;
    if (midspanClearance < minGroundReq) {
      violations.push({
        violationCode: "MIDSPAN_GROUND",
        severity: "error",
        description: `Mid-span ground clearance over ${options.crossing} is ${midspanClearance.toFixed(1)} ft, violating NESC Table 232-1 required ${minGroundReq.toFixed(1)} ft.`,
        measuredSeparationInches: Math.round(midspanClearance * 12 * 10) / 10,
        requiredSeparationInches: minGroundReq * 12,
        deficiencyInches: Math.round((minGroundReq - midspanClearance) * 12 * 10) / 10,
        involvedAttachmentIds: [proposedAttachment.id],
      });
    }
  }

  // 5. Generate Make-Ready Recommendations
  if (violations.length > 0) {
    // If the proposed attachment violates the CWSZ, can we lower the proposed attachment or lower existing comms?
    const hasCwszViolation = violations.some((v) => v.violationCode.startsWith("CWSZ"));
    const hasCommsSepViolation = violations.some((v) => v.violationCode === "COMMS_SEPARATION");

    if (hasCwszViolation) {
      // Lower proposed attachment if ground clearance permits
      const maxDeficiency = Math.max(...violations.filter((v) => v.violationCode.startsWith("CWSZ")).map((v) => v.deficiencyInches));
      const recommendedH = proposedAttachment.heightAboveGroundFeet - maxDeficiency / 12.0;
      recommendations.push({
        actionType: "LOWER_EXISTING_COMMS",
        description: `Lower proposed attachment by ${maxDeficiency.toFixed(1)}" to ${recommendedH.toFixed(2)} ft AGL to clear Communication Worker Safety Zone.`,
        targetAttachmentId: proposedAttachment.id,
        currentHeightFeet: proposedAttachment.heightAboveGroundFeet,
        recommendedHeightFeet: Math.round(recommendedH * 100) / 100,
        isComplexMakeReady: false,
      });
    } else if (hasCommsSepViolation) {
      const existingComms = existingAttachments.filter((a) => ["telco-incumbent", "catv-coax"].includes(a.utilityType));
      if (existingComms.length > 0) {
        const lowestExisting = existingComms.reduce((min, c) => (c.heightAboveGroundFeet < min.heightAboveGroundFeet ? c : min));
        const newH = lowestExisting.heightAboveGroundFeet - 1.0;
        recommendations.push({
          actionType: "LOWER_EXISTING_COMMS",
          description: `Relocate incumbent ${lowestExisting.ownerName} attachment down 12" to ${newH.toFixed(2)} ft AGL to accommodate new fiber attachment.`,
          targetAttachmentId: lowestExisting.id,
          currentHeightFeet: lowestExisting.heightAboveGroundFeet,
          recommendedHeightFeet: Math.round(newH * 100) / 100,
          isComplexMakeReady: false,
        });
      }
    }
  }

  // Build classified attachment schedule
  const schedule = all.map((a) => {
    let zone: "Supply Space" | "Safety Zone" | "Communication Space" = "Communication Space";
    if (a.utilityType.startsWith("electric")) zone = "Supply Space";
    return {
      id: a.id,
      owner: a.ownerName,
      type: a.utilityType,
      heightFeet: a.heightAboveGroundFeet,
      zone,
    };
  });

  // Build Joint-Use Permit Exhibit Text
  const exhibitLines: string[] = [
    `================================================================`,
    `JOINT-USE POLE ATTACHMENT MAKE-READY AUDIT EXHIBIT`,
    `Pursuant to NESC ANSI C2-2023 Rule 235 & FCC Form 601 Schedule I`,
    `================================================================`,
    `Pole Identifier:       ${poleId}`,
    `Proposed Attacher:     ${proposedAttachment.ownerName} (${proposedAttachment.utilityType})`,
    `Proposed Height:       ${proposedAttachment.heightAboveGroundFeet.toFixed(2)} ft AGL`,
    `Total Attachments:     ${all.length}`,
    `Compliance Verdict:    ${violations.length === 0 ? "✓ APPROVED (Zero Make-Ready Required)" : "⚠ MAKE-READY WORK ORDER REQUIRED"}`,
    `----------------------------------------------------------------`,
    `POLE ATTACHMENT SCHEDULE (TOP TO BOTTOM):`,
  ];

  for (const s of schedule) {
    const isProposed = s.id === proposedAttachment.id ? " [PROPOSED]" : "";
    exhibitLines.push(
      `  ${s.heightFeet.toFixed(2)} ft AGL | ${s.zone.padEnd(19)} | ${s.owner} (${s.type})${isProposed}`,
    );
  }

  if (violations.length > 0) {
    exhibitLines.push(`----------------------------------------------------------------`);
    exhibitLines.push(`DETECTED NESC CLEARANCE DEFICIENCIES:`);
    for (const v of violations) {
      exhibitLines.push(`  ⚠ [${v.violationCode}] ${v.description}`);
    }
  }

  if (recommendations.length > 0) {
    exhibitLines.push(`----------------------------------------------------------------`);
    exhibitLines.push(`RECOMMENDED MAKE-READY ACTIONS:`);
    for (const r of recommendations) {
      exhibitLines.push(
        `  -> ${r.description} (Target: ${r.targetAttachmentId}, ${r.currentHeightFeet.toFixed(2)}' -> ${r.recommendedHeightFeet.toFixed(2)}')`,
      );
    }
  }
  exhibitLines.push(`================================================================\n`);

  return {
    poleId,
    proposedAttachmentId: proposedAttachment.id,
    proposedHeightFeet: proposedAttachment.heightAboveGroundFeet,
    isPermitApprovedWithoutChanges: violations.length === 0,
    clearanceViolations: violations,
    makeReadyRecommendations: recommendations,
    attachmentSchedule: schedule,
    jointUseExhibitText: exhibitLines.join("\n"),
  };
}

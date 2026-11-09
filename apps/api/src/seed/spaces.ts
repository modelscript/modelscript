// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LibraryDatabase, SpaceChannelRecord } from "../database.js";
import { commitFilesToBareGitVault, ensureSpaceGitVaultInitialized } from "../services/spaces/space-git-vault.js";

function hoursAgoSqliteTimestamp(hoursAgo: number): string {
  const ms = Date.now() - Math.max(0, hoursAgo) * 3_600_000;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

export interface SeedSpacesSummary {
  organizationsSeeded: number;
  spacesSeeded: number;
  messagesSeeded: number;
  docsSeeded: number;
  ecosSeeded: number;
  issuesSeeded: number;
  gitCommitsSeeded: number;
}

/**
 * Seeds sample organizations, polymorphic Spaces (both organization and user profile containers),
 * real-time chat channels, multi-participant conversations with bot execution and thread replies,
 * Git-backed Living Docs (CMS), and PLM Engineering Change Orders (ECOs) with cryptographic approvals.
 */
export function seedPolyglotSpaces(db: LibraryDatabase, userIds: Map<string, number>): SeedSpacesSummary {
  const adminId = userIds.get("omar") ?? 1;

  let organizationsSeeded = 0;
  let spacesSeeded = 0;
  let messagesSeeded = 0;
  let docsSeeded = 0;
  let ecosSeeded = 0;
  let issuesSeeded = 0;
  let gitCommitsSeeded = 0;

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. SAMPLE ORGANIZATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  interface OrgSeedDef {
    slug: string;
    name: string;
    description: string;
    location: string;
    website: string;
    industryPreset: string;
    avatarUrl: string;
    bannerUrl: string;
    creatorUsername: string;
    members: { username: string; role: "owner" | "maintainer" | "contributor" }[];
  }

  const sampleOrgs: OrgSeedDef[] = [
    {
      slug: "aether-dynamics",
      name: "Aether Dynamics Aerospace",
      description:
        "Next-generation electric vertical takeoff & landing (eVTOL) airframes, fly-by-wire flight control & multi-domain avionics digital twins.",
      location: "Toulouse, France & Munich, Germany",
      website: "https://aether-dynamics.aerospace",
      industryPreset: "aerospace_cad",
      avatarUrl: "https://images.unsplash.com/photo-1541185933-ef5d8ed016c2?auto=format&fit=crop&w=256&q=80",
      bannerUrl: "https://images.unsplash.com/photo-1517976487541-7105a5a9e334?auto=format&fit=crop&w=1200&q=80",
      creatorUsername: "elena_vance",
      members: [
        { username: "elena_vance", role: "owner" },
        { username: "vikram_patel", role: "maintainer" },
        { username: "claire_dubois", role: "maintainer" },
        { username: "omar", role: "contributor" },
      ],
    },
    {
      slug: "terragrid",
      name: "TerraGrid Energy Alliance",
      description:
        "Multi-gigawatt renewable interconnection, MMC HVDC converter stations, BESS grid-forming inverters & IEEE 2800 compliance verification.",
      location: "Austin, TX & Zurich, Switzerland",
      website: "https://terragrid.energy",
      industryPreset: "power_rf_grid",
      avatarUrl: "https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=256&q=80",
      bannerUrl: "https://images.unsplash.com/photo-1466611653911-95081537e5b7?auto=format&fit=crop&w=1200&q=80",
      creatorUsername: "marcus_chen",
      members: [
        { username: "marcus_chen", role: "owner" },
        { username: "omar", role: "maintainer" },
        { username: "astrid_solberg", role: "contributor" },
      ],
    },
    {
      slug: "nordic-subsea",
      name: "Nordic Dynamics Offshore",
      description:
        "Deepwater subsea flow assurance, transient multiphase slugging mitigation, and floating offshore wind mooring digital twins.",
      location: "Trondheim & Stavanger, Norway",
      website: "https://nordic-subsea.offshore",
      industryPreset: "oil_gas_process",
      avatarUrl: "https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=256&q=80",
      bannerUrl: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
      creatorUsername: "astrid_solberg",
      members: [
        { username: "astrid_solberg", role: "owner" },
        { username: "henrik_lindqvist", role: "maintainer" },
        { username: "priya_nair", role: "contributor" },
      ],
    },
  ];

  const orgIdBySlug = new Map<string, number>();

  for (const orgDef of sampleOrgs) {
    let org = db.getOrganizationBySlug(orgDef.slug);
    const creatorId = userIds.get(orgDef.creatorUsername) ?? adminId;

    if (!org) {
      org = db.createOrganization({
        slug: orgDef.slug,
        name: orgDef.name,
        description: orgDef.description,
        avatarUrl: orgDef.avatarUrl,
        createdBy: creatorId,
      });
      organizationsSeeded++;
    }

    db.updateOrganization(org.id, {
      name: orgDef.name,
      description: orgDef.description,
      location: orgDef.location,
      website: orgDef.website,
      avatar_url: orgDef.avatarUrl,
      banner_url: orgDef.bannerUrl,
      industry_preset: orgDef.industryPreset,
    });

    // Mark as verified organization
    db.db.prepare("UPDATE organizations SET is_verified = 1 WHERE id = ?").run(org.id);

    // Sync organization members
    for (const m of orgDef.members) {
      const memUserId = userIds.get(m.username);
      if (memUserId) {
        db.addOrganizationMember(org.id, memUserId, m.role);
      }
    }

    orgIdBySlug.set(orgDef.slug, org.id);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. SAMPLE SPACES (ORGANIZATION & PERSONAL CONTAINERS)
  // ─────────────────────────────────────────────────────────────────────────────

  interface SpaceSeedDef {
    ownerType: "organization" | "user";
    ownerSlug: string;
    slug: string;
    name: string;
    tagline: string;
    description: string;
    domainPreset: string;
    creatorUsername: string;
    avatarUrl: string;
    bannerUrl: string;
    members: {
      username: string;
      role: "owner" | "lead_engineer" | "approver" | "contributor" | "reviewer" | "viewer";
    }[];
    followers: string[];
    extraChannels?: {
      slug: string;
      name: string;
      topic: string;
      kind: "text" | "announcement" | "bot_feed" | "telemetry" | "ecr_review";
    }[];
    conversations: {
      channelSlug: string;
      messages: {
        username?: string | undefined;
        senderType?: "user" | "bot" | "telemetry_hook" | "ci_runner" | undefined;
        senderName?: string | undefined;
        content: string;
        hoursAgo: number;
        reactions?: Record<string, string[]> | undefined;
        replies?:
          | {
              username: string;
              content: string;
              hoursAgo: number;
              reactions?: Record<string, string[]> | undefined;
            }[]
          | undefined;
      }[];
    }[];
    livingDocs: {
      slug: string;
      title: string;
      summary: string;
      authorUsername: string;
      contentMarkdown: string;
    }[];
    ecos: {
      title: string;
      description: string;
      severity: "minor" | "standard" | "major" | "safety_critical";
      authorUsername: string;
      sourceBranch: string;
      impactedModels: string[];
      status: "open" | "in_review" | "approved";
      approvals?: { username: string; decision: "approved" | "changes_requested"; comment: string }[] | undefined;
    }[];
    issues?: {
      title: string;
      description: string;
      severity?: "minor" | "standard" | "major" | "safety_critical";
      authorUsername: string;
      impactedModels?: string[];
      status?: "open" | "closed";
      linkedPrNumber?: number | null;
      comments?: { username: string; content: string; hoursAgo?: number }[];
    }[];
    gitCommits?: {
      branch?: string;
      message: string;
      authorName?: string;
      authorEmail?: string;
      timestampHoursAgo?: number;
      files: Record<string, string>;
    }[];
  }

  const sampleSpaces: SpaceSeedDef[] = [
    // ── Space 1: @aether-dynamics/evtol-flight-dynamics ────────────────────────
    {
      ownerType: "organization",
      ownerSlug: "aether-dynamics",
      slug: "evtol-flight-dynamics",
      name: "eVTOL 6-DOF Flight Dynamics & Flight Control",
      tagline:
        "Full-envelope 6-DOF rigid body flight dynamics, aero coefficients, and battery thermal runaway protection loop.",
      description:
        "Comprehensive cyber-physical twin combining JSBSim aerodynamics, Modelica tilt-rotor kinematics, and DO-178C DAL-A flight control laws with real-time HIL telemetry.",
      domainPreset: "aerospace_cad",
      creatorUsername: "elena_vance",
      avatarUrl: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=256&q=80",
      bannerUrl: "https://images.unsplash.com/photo-1517976487541-7105a5a9e334?auto=format&fit=crop&w=1200&q=80",
      members: [
        { username: "elena_vance", role: "owner" },
        { username: "vikram_patel", role: "lead_engineer" },
        { username: "claire_dubois", role: "approver" },
        { username: "omar", role: "reviewer" },
        { username: "kenji_takahashi", role: "contributor" },
      ],
      followers: ["elena_vance", "vikram_patel", "claire_dubois", "omar", "kenji_takahashi", "marcus_chen"],
      extraChannels: [
        {
          slug: "aero-controls",
          name: "aero-controls",
          topic: "JSBSim & Modelica 6-DOF control laws, gain scheduling & tilt-wing transition",
          kind: "text",
        },
      ],
      conversations: [
        {
          channelSlug: "general",
          messages: [
            {
              username: "elena_vance",
              content:
                "Good morning team! We just updated the 6-DOF transition envelope model from hover (0 kts) to cruise (120 kts). The tilt-wing nacelle rate limit was causing a slight pitch excursion at 45 kts.",
              hoursAgo: 6,
              reactions: { "👀": ["vikram_patel", "claire_dubois"] },
            },
            {
              username: "vikram_patel",
              content:
                "Thanks @elena_vance. I verified the aerodynamic pitching moment derivative \\(C_{m_\\alpha}\\) across the transition corridor. Slew rate increase from 35 deg/s to 48 deg/s resolves the attitude overshoot cleanly.",
              hoursAgo: 5.5,
              reactions: { "🚀": ["elena_vance", "claire_dubois", "omar"], "👍": ["omar"] },
              replies: [
                {
                  username: "claire_dubois",
                  content:
                    "Requirement REQ-AERO-0842 in our SysML v2 model requires max pitch excursion < 2.5 deg during nacelle rotation. Can we trigger an automated simulation run?",
                  hoursAgo: 5.2,
                  reactions: { "🎯": ["vikram_patel"] },
                },
                {
                  username: "elena_vance",
                  content:
                    "Running CVODE solver benchmark on the updated nacelle model right now:\n\n/run Modelica.Mechanics.MultiBody.Examples.Rotational3D",
                  hoursAgo: 5.0,
                  reactions: { "🔥": ["vikram_patel"] },
                },
              ],
            },
            {
              senderType: "bot",
              senderName: "ModelScript Simulation Runner",
              content:
                "**[Simulation Runner]** `Modelica.Mechanics.MultiBody.Examples.Rotational3D` completed successfully.\n- Solver: `CVODE BDF` (adaptive order 1-5, relative tolerance \\(10^{-5}\\))\n- Variable count: 86 DAE states, 214 algebraic equations\n- Maximum pitch excursion: **1.82 deg** *(Requirement REQ-AERO-0842 satisfied: < 2.5 deg)*\n- Wall clock time: `142ms`",
              hoursAgo: 4.9,
              reactions: { "✅": ["claire_dubois", "elena_vance", "vikram_patel"] },
            },
            {
              username: "claire_dubois",
              content:
                "Excellent! I've opened and approved ECO-1 to lock in the 48 deg/s nacelle slew rate and linked the simulation evidence to the airworthiness certification binder.",
              hoursAgo: 4.5,
              reactions: { "🎉": ["elena_vance", "vikram_patel", "omar"] },
            },
          ],
        },
        {
          channelSlug: "ci-telemetry",
          messages: [
            {
              senderType: "telemetry_hook",
              senderName: "Flight Test HIL Rig #3",
              content:
                "**HIL Telemetry Batch #842 Report**\n- Test Case: `DO-160G Section 8 Gust Profile`\n- Rig: dSPACE SCALEXIO Hard Real-Time 1 kHz\n- Max Actuator Current: 42.4A (limit: 55A)\n- Bus Voltage Sag: 2.1V on 800V DC rail\n- Result: **PASSED (142/142 vectors)**",
              hoursAgo: 3.5,
              reactions: { "📊": ["elena_vance"] },
            },
          ],
        },
      ],
      livingDocs: [
        {
          slug: "architecture-specification",
          title: "ARP4754A / DO-178C Flight Control Architecture Specification",
          summary:
            "Triple-redundant flight control computer, sensor voting logic, and fail-operational actuator drive specifications for eVTOL transition flight.",
          authorUsername: "elena_vance",
          contentMarkdown: `# eVTOL Flight Control Architecture Specification

## 1. Safety & Certification Objectives
This document establishes the system architecture and software allocation complying with **FAA 14 CFR Part 23 / EASA SC-VTOL.2510** and **RTCA DO-178C / DO-254 Development Assurance Level A (DAL-A)**.

### 1.1 Hazard Classification
- Loss of pitch/roll authority during nacelle transition: **Catastrophic (DAL-A, \\(10^{-9}\\) / flight hr)**
- Asymmetric thrust loss on forward rotor bank: **Catastrophic (DAL-A)**
- Uncommanded flight mode transition: **Hazardous (DAL-B, \\(10^{-7}\\) / flight hr)**

## 2. Redundancy & Bus Topology
\`\`\`
                  ┌─────────────────────────────────────┐
                  │ Triplex Flight Control Computer     │
                  │ (PPC5554 / Lockstep RISC-V Cores)   │
                  └───────┬──────────────┬──────────────┘
                          │              │
              Dual CAN-FD │              │ ARINC 429
                          ▼              ▼
           ┌──────────────────────┐   ┌──────────────────────┐
           │ Actuator Drive Units │   │ Air Data / IMU AHRS  │
           │ (FOC Inverter 800V)  │   │ (Honeywell HG4930)   │
           └──────────────────────┘   └──────────────────────┘
\`\`\`

## 3. Dynamic Equations of Motion
The 6-DOF equations governing the rigid body dynamics are expressed in body-fixed frame \\(F_b\\):

$$\\mathbf{F}_b = m (\\mathbf{\\dot{v}}_b + \\boldsymbol{\\omega}_b \\times \\mathbf{v}_b)$$

$$\\mathbf{M}_b = \\mathbf{I} \\boldsymbol{\\dot{\\omega}}_b + \\boldsymbol{\\omega}_b \\times (\\mathbf{I} \\boldsymbol{\\omega}_b)$$

Where:
- \\(\\mathbf{F}_b\\): Aerodynamic, gravitational, and rotor thrust vector summation
- \\(\\mathbf{I}\\): Inertia tensor with nacelle rotation cross-coupling
- \\(\\boldsymbol{\\omega}_b\\): Angular velocity vector \\([p, q, r]^T\\)
`,
        },
        {
          slug: "battery-thermal-mitigation",
          title: "High-Density Battery Thermal Runaway Mitigation & DO-311A Compliance",
          summary:
            "Phase change material (PCM) heat sink sizing, glycol-water cooling channel geometry, and single-cell propagation containment.",
          authorUsername: "vikram_patel",
          contentMarkdown: `# Battery Thermal Runaway Containment & Sizing

## 1. Compliance Scope
Compliant with **RTCA DO-311A (Minimum Operational Performance Standards for Rechargeable Lithium Batteries)** Section 2.4 (Thermal Runaway Containment).

## 2. Cooling Circuit Design Parameters
- Cell Chemistry: NMC 811 Cylindrical (21700 format, 5.0 Ah)
- Module Configuration: 192S 8P (800V nominal, 32 kWh)
- Max Continuous Discharge: 4C (128 kW per pack)
- Coolant: 50/50 Water-Ethylene Glycol (WEG) at 45 L/min
`,
        },
      ],
      ecos: [
        {
          title: "Tilt-Wing Actuator Slew Rate Limit Increase for Gust Alleviation",
          description:
            "Increase electro-mechanical actuator slew limit from 35 deg/s to 48 deg/s to satisfy FAR Part 23 gust response criteria and maintain transition pitch excursion < 2.5 deg.",
          severity: "major",
          authorUsername: "vikram_patel",
          sourceBranch: "eco/gust-alleviation-actuator",
          impactedModels: [
            "Modelica.Mechanics.MultiBody.Examples.Rotational3D",
            "AetherDynamics.FlightControl.ActuatorDrive",
          ],
          status: "approved",
          approvals: [
            {
              username: "elena_vance",
              decision: "approved",
              comment: "Simulation verified with CVODE BDF at relTol 1e-5. No structural resonance identified.",
            },
            {
              username: "claire_dubois",
              decision: "approved",
              comment: "Traceability verified against ReqIF system requirement REQ-AERO-0842.",
            },
          ],
        },
        {
          title: "Dual-Redundant CAN-FD Gateway for High-Rate BMS Cell Telemetry",
          description:
            "Migrate 100Hz cell temperature sensing from legacy CAN 2.0B to CAN-FD to support real-time state-of-health estimation and early thermal anomaly detection.",
          severity: "standard",
          authorUsername: "elena_vance",
          sourceBranch: "eco/can-fd-bms-gateway",
          impactedModels: ["AetherDynamics.Avionics.BmsBusGateway"],
          status: "open",
        },
      ],
      issues: [
        {
          title: "Inverter DC-Link Bus Voltage Ripple Exceeds 2.5% during Max Power Climb",
          description:
            "Under rapid nacelle rotation in hover-to-cruise transition, dynamic current draw causes 2.8% voltage ripple on the 800V DC rail, violating DO-160G Section 16 requirements. Increasing actuator slew rate to 48 deg/s and tuning the capacitor bank resolves this.",
          severity: "major",
          authorUsername: "vikram_patel",
          impactedModels: [
            "Modelica.Mechanics.MultiBody.Examples.Rotational3D",
            "AetherDynamics.FlightControl.ActuatorDrive",
          ],
          status: "closed",
          linkedPrNumber: 1,
          comments: [
            {
              username: "claire_dubois",
              content: "Validated against SysML v2 vehicle power model. Closing as resolved via ECO-1.",
              hoursAgo: 4.4,
            },
          ],
        },
        {
          title: "CAN-FD Bus Message Jitter Exceeds 1.2ms under Heavy Telemetry Load",
          description:
            "High-rate cell temperature sensing packets from the BMS saturate the bus queue during rapid telemetry dumps. Migration to dedicated dual-redundant CAN-FD channels proposed in PR #2.",
          severity: "standard",
          authorUsername: "elena_vance",
          impactedModels: ["AetherDynamics.Avionics.BmsBusGateway"],
          status: "open",
          linkedPrNumber: 2,
          comments: [
            {
              username: "kenji_takahashi",
              content:
                "Bench testing on SCALEXIO rig confirms arbitration priority inversion with standard ID frames. Dual CAN-FD with BRS should fix this.",
              hoursAgo: 2.1,
            },
          ],
        },
      ],
      gitCommits: [
        {
          branch: "main",
          message: "feat(aero): initialize 6-DOF eVTOL flight dynamics, SysML architecture & OpenSCAD wing",
          authorName: "Elena Vance",
          authorEmail: "elena_vance@aether-dynamics.aerospace",
          timestampHoursAgo: 48,
          files: {
            "README.md": `# Aether Dynamics eVTOL 6-DOF Flight Dynamics & Flight Control

This repository houses the cyber-physical digital twin and continuous flight control algorithms for the **Aether Dynamics A-250 eVTOL (Electric Vertical Takeoff & Landing)** passenger aircraft.

## Architecture Overview
- **Aero & 6-DOF Equations:** High-fidelity aerodynamic moment and force coefficients coupled with tilt-wing nacelle kinematics.
- **Flight Control Laws:** DO-178C DAL-A compliant attitude control, rate damping, and transition corridor gain scheduling.
- **Avionics & Bus Architecture:** SysML v2 vehicle architecture linked with triple-redundant lockstep RISC-V flight computers and dual CAN-FD sensor buses.

## Repository Contents
- \`models/FlightDynamics6DOF.mo\`: 6-DOF rigid body equations of motion with tilt-wing aerodynamics.
- \`control/PitchRollTransitionController.mo\`: Full flight envelope transition gain scheduling block.
- \`architecture/VehicleArchitecture.sysml\`: OMG SysML v2 airframe structural and avionics architecture.
- \`cad/WingAirfoilNacelle.scad\`: Parametric OpenSCAD wing airfoil with motor nacelle pivot geometry.
- \`package.mo\`: Modelica package declaration.

## Simulation & Instantiation
Flatten and simulate directly using ModelScript:
\`\`\`bash
msx flatten models/FlightDynamics6DOF.mo
msx simulate models/FlightDynamics6DOF.mo --stop-time=120 --solver=cvode
\`\`\`
`,
            "package.mo": `within ;
package AetherDynamics "Aether Dynamics eVTOL Flight Dynamics & Control Suite"
  constant String version = "2.4.0";
  annotation(
    Documentation(info="<html><p>Aether Dynamics cyber-physical flight dynamics digital twin.</p></html>")
  );
end AetherDynamics;
`,
            "models/FlightDynamics6DOF.mo": `within AetherDynamics;
model FlightDynamics6DOF "6-DOF rigid body eVTOL airframe dynamics with tilt-wing aerodynamics"
  // Mass and inertial properties
  parameter Real mass = 2400.0 "Total aircraft takeoff mass (kg)";
  parameter Real Ixx = 4800.0 "Roll moment of inertia (kg.m2)";
  parameter Real Iyy = 6200.0 "Pitch moment of inertia (kg.m2)";
  parameter Real Izz = 9500.0 "Yaw moment of inertia (kg.m2)";
  parameter Real wingArea = 18.5 "Reference wing area (m2)";
  parameter Real wingSpan = 12.4 "Wing span (m)";
  parameter Real airDensity = 1.225 "Air density at sea level (kg/m3)";

  // Control inputs
  input Real nacelleTiltAngle(start = 0.0) "Nacelle tilt: 0 rad (vertical hover) to 1.5708 rad (forward cruise)";
  input Real collectivePitch(start = 0.5) "Rotor collective blade pitch (rad)";
  input Real elevatorDeflection(start = 0.0) "Elevator surface deflection (rad)";

  // Dynamic state variables
  Real u(start = 0.0) "Body longitudinal velocity (m/s)";
  Real v(start = 0.0) "Body lateral velocity (m/s)";
  Real w(start = 0.0) "Body normal velocity (m/s)";
  Real p(start = 0.0) "Roll angular velocity (rad/s)";
  Real q(start = 0.0) "Pitch angular velocity (rad/s)";
  Real r(start = 0.0) "Yaw angular velocity (rad/s)";

  Real airspeed "True airspeed (m/s)";
  Real dynamicPressure "Dynamic pressure (Pa)";
  Real liftForce "Aerodynamic lift force (N)";
  Real dragForce "Aerodynamic drag force (N)";
  Real thrustForce "Total distributed rotor thrust (N)";

equation
  airspeed = sqrt(u^2 + v^2 + w^2 + 1e-4);
  dynamicPressure = 0.5 * airDensity * airspeed^2;

  liftForce = dynamicPressure * wingArea * (0.28 + 4.2 * (w / (airspeed + 1e-3)));
  dragForce = dynamicPressure * wingArea * (0.025 + 0.045 * (liftForce / (dynamicPressure * wingArea + 1e-3))^2);
  thrustForce = collectivePitch * 32000.0;

  // Longitudinal translational acceleration
  der(u) = (thrustForce * cos(nacelleTiltAngle) - dragForce) / mass - q * w + r * v;
  der(w) = (thrustForce * sin(nacelleTiltAngle) + liftForce - mass * 9.81) / mass - p * v + q * u;
  der(v) = -p * w + r * u;

  // Rotational angular acceleration (principal axes)
  der(p) = ((Iyy - Izz) * q * r) / Ixx;
  der(q) = (mass * 9.81 * 0.12 * elevatorDeflection + (Izz - Ixx) * p * r) / Iyy;
  der(r) = ((Ixx - Iyy) * p * q) / Izz;
end FlightDynamics6DOF;
`,
            "control/PitchRollTransitionController.mo": `within AetherDynamics;
block PitchRollTransitionController "Attitude rate damper and nacelle slew rate limiter"
  parameter Real kp_pitch = 4.2 "Proportional pitch attitude gain";
  parameter Real kd_pitch = 1.8 "Derivative pitch attitude damping gain";
  parameter Real max_slew_rate = 0.610865 "Max nacelle slew rate: 35 deg/s in radians/s";

  input Real commandedPitch;
  input Real actualPitch;
  input Real pitchRate;
  output Real actuatorCommand;

equation
  actuatorCommand = kp_pitch * (commandedPitch - actualPitch) - kd_pitch * pitchRate;
end PitchRollTransitionController;
`,
            "architecture/VehicleArchitecture.sysml": `package VehicleArchitecture {
  doc /* Aether Dynamics eVTOL Aircraft Top-Level Physical & Logical Architecture */

  part def EvtolAirframe {
    attribute grossTakeoffMass: Real = 2400.0;
    attribute maxCruiseSpeedKts: Real = 135.0;
    attribute operationalCeilingFt: Real = 10000.0;
  }

  part def FlightControlComputer {
    attribute dalAssuranceLevel: String = "DAL-A";
    attribute redundancyTopology: String = "Triplex Lockstep RISC-V";
    attribute sensorBusProtocol: String = "Dual CAN-FD 5Mbps";
  }

  part def DistributedElectricPropulsion {
    attribute motorCount: Integer = 8;
    attribute busVoltageNominal: Real = 800.0;
    attribute totalContinuousPowerKw: Real = 720.0;
  }

  part evtolSystem: EvtolAirframe {
    part fcc: FlightControlComputer;
    part propulsion: DistributedElectricPropulsion;
  }
}
`,
            "cad/WingAirfoilNacelle.scad": `// Aether Dynamics eVTOL Parametric Wing & Nacelle Assembly
$fn = 64;

module naca0012_airfoil(chord = 1200, span = 3500) {
  linear_extrude(height = span, center = true) {
    scale([chord, chord * 0.12]) {
      circle(r = 0.5);
    }
  }
}

module tilt_nacelle(radius = 180, length = 950) {
  rotate([0, 90, 0]) {
    cylinder(r = radius, h = length, center = true);
  }
}

module complete_wing_assembly() {
  color([0.2, 0.4, 0.8, 0.9])
    naca0012_airfoil(1200, 3500);

  color([0.3, 0.3, 0.35, 1.0])
    translate([300, 1200, 0])
      tilt_nacelle(180, 950);
}

complete_wing_assembly();
`,
          },
        },
        {
          branch: "eco/gust-alleviation-actuator",
          message: "feat(control): increase nacelle slew rate to 48 deg/s for gust alleviation (ECO-1)",
          authorName: "Vikram Patel",
          authorEmail: "vikram_patel@aether-dynamics.aerospace",
          timestampHoursAgo: 5,
          files: {
            "control/PitchRollTransitionController.mo": `within AetherDynamics;
block PitchRollTransitionController "Attitude rate damper and nacelle slew rate limiter"
  parameter Real kp_pitch = 4.2 "Proportional pitch attitude gain";
  parameter Real kd_pitch = 1.8 "Derivative pitch attitude damping gain";
  parameter Real max_slew_rate = 0.837758 "Max nacelle slew rate: 48 deg/s in radians/s (ECO-1 approved)";

  input Real commandedPitch;
  input Real actualPitch;
  input Real pitchRate;
  output Real actuatorCommand;

equation
  actuatorCommand = kp_pitch * (commandedPitch - actualPitch) - kd_pitch * pitchRate;
end PitchRollTransitionController;
`,
          },
        },
      ],
    },

    // ── Space 2: @terragrid/hvdc-interconnection ───────────────────────────────
    {
      ownerType: "organization",
      ownerSlug: "terragrid",
      slug: "hvdc-interconnection",
      name: "Pacific Northwest HVDC Intertie EMT Twin",
      tagline:
        "500kV MMC VSC-HVDC bipolar transmission line with IEEE 2800-2022 fault ride-through and sub-synchronous resonance damping.",
      description:
        "High-fidelity electromagnetic transient (EMT) and small-signal stability model of a 2,000 MW modular multilevel converter (MMC) link integrating offshore wind and grid-scale storage.",
      domainPreset: "power_rf_grid",
      creatorUsername: "marcus_chen",
      avatarUrl: "https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=256&q=80",
      bannerUrl: "https://images.unsplash.com/photo-1466611653911-95081537e5b7?auto=format&fit=crop&w=1200&q=80",
      members: [
        { username: "marcus_chen", role: "owner" },
        { username: "omar", role: "lead_engineer" },
        { username: "astrid_solberg", role: "contributor" },
      ],
      followers: ["marcus_chen", "omar", "astrid_solberg", "elena_vance"],
      conversations: [
        {
          channelSlug: "general",
          messages: [
            {
              username: "marcus_chen",
              content:
                "Uploaded the 500kV MMC submodule arm inductor parameters calibrated against the BPA field measurements. The grid-forming virtual synchronous machine (VSM) droop is damping the 0.25 Hz inter-area mode effectively.",
              hoursAgo: 8,
              reactions: { "⚡": ["omar", "astrid_solberg"] },
            },
            {
              username: "omar",
              content:
                "Checked the WebGPU batched EMT solver performance on the 400-submodule bridge. It solves in 12 microseconds per step, enabling real-time hardware-in-the-loop emulation with zero latency penalty.",
              hoursAgo: 7,
              reactions: { "🚀": ["marcus_chen"] },
              replies: [
                {
                  username: "marcus_chen",
                  content:
                    "That's a 30x speedup over standard CPU EMT solvers! We can now run full Monte Carlo parameter sweeps over SCR ranging from 1.2 to 5.0.",
                  hoursAgo: 6.8,
                  reactions: { "🙌": ["omar"] },
                },
              ],
            },
          ],
        },
      ],
      livingDocs: [
        {
          slug: "ieee-2800-compliance-matrix",
          title: "IEEE 2800-2022 Section 5 Compliance & High Voltage Ride-Through Matrix",
          summary:
            "Active and reactive current injection trajectories during symmetrical and asymmetrical transmission grid faults.",
          authorUsername: "marcus_chen",
          contentMarkdown: `# IEEE 2800-2022 Interconnection Compliance Matrix

## 1. Standard Purpose
Specifies the minimum technical requirements for the interconnection and interoperability of Inverter-Based Resources (IBRs) interconnecting with Bulk Power Systems (BPS).

## 2. Voltage Ride-Through (VRT) Trajectory
- Point of Interconnection (POI): 500 kV
- Low Voltage Ride-Through (LVRT): Zero voltage ride-through for 150 ms (9 cycles)
- Fast Fault Current Injection: \\(I_q \\ge 2.0 \\times \\Delta V\\) within 20 ms
`,
        },
      ],
      ecos: [
        {
          title: "Grid-Forming Virtual Synchronous Generator Inertia Parameter Calibration",
          description:
            "Tune virtual inertia H from 3.2s to 4.5s to damp low-frequency inter-area oscillations (0.25 Hz mode) under weak grid conditions (SCR < 1.5).",
          severity: "standard",
          authorUsername: "marcus_chen",
          sourceBranch: "eco/vsm-inertia-tuning",
          impactedModels: ["TerraGrid.MMC.Control.VirtualSynchronousMachine"],
          status: "approved",
          approvals: [
            {
              username: "marcus_chen",
              decision: "approved",
              comment: "PSCAD EMT and small-signal eigenvalue analysis confirmed stable damping ratio > 8%.",
            },
            {
              username: "omar",
              decision: "approved",
              comment: "Verified with sparse DAE BLT solver.",
            },
          ],
        },
      ],
      issues: [
        {
          title: "Sub-synchronous Resonance Detected in 0.25 Hz Inter-Area Mode under Weak Grid (SCR < 1.5)",
          description:
            "Small-signal eigenvalue scan revealed negative damping ratio (-1.2%) for the 0.25 Hz inter-area oscillation when Short Circuit Ratio drops below 1.5 at the Point of Interconnection.",
          severity: "major",
          authorUsername: "marcus_chen",
          impactedModels: ["TerraGrid.MMC.Control.VirtualSynchronousMachine"],
          status: "closed",
          linkedPrNumber: 1,
          comments: [
            {
              username: "omar",
              content: "Fixed by retuning virtual inertia H to 4.5s in PR #1.",
              hoursAgo: 6.5,
            },
          ],
        },
        {
          title: "High Voltage Ride-Through Active Power Recovery Exceeds 150ms Limit (IEEE 2800 Clause 5.2.3)",
          description:
            "During 1.2 p.u. overvoltage transient tests, active power recovery took 185ms instead of the required 150ms window. Outer P-Q loop current limiter limits require recalibration.",
          severity: "standard",
          authorUsername: "astrid_solberg",
          impactedModels: ["TerraGrid.MMC.Control.VirtualSynchronousMachine"],
          status: "open",
          comments: [
            {
              username: "marcus_chen",
              content:
                "I'll prepare a PR to adjust the reactive current priority logic in the dq-frame current controller.",
              hoursAgo: 4.2,
            },
          ],
        },
      ],
      gitCommits: [
        {
          branch: "main",
          message: "feat(hvdc): initialize 500kV MMC VSC station, VSM controller & SPICE netlist",
          authorName: "Marcus Chen",
          authorEmail: "marcus_chen@terragrid.energy",
          timestampHoursAgo: 72,
          files: {
            "README.md": `# TerraGrid Pacific Northwest HVDC Intertie EMT Twin

High-fidelity electromagnetic transient (EMT) and small-signal stability digital twin of a **500kV 2,000 MW Modular Multilevel Converter (MMC) VSC-HVDC** transmission link.

## Compliance
- **IEEE 2800-2022:** Interconnection and Interoperability of Inverter-Based Resources (IBRs).
- **NERC PRC-024-3:** Generator and Bulk Power System Frequency & Voltage Protection.

## Repository Contents
- \`models/MmcVscConverter.mo\`: 400-submodule MMC converter arm dynamics and capacitor balancing.
- \`control/VirtualSynchronousMachine.mo\`: Grid-forming VSM droop and virtual inertia controller.
- \`circuits/InverterBridge.sp\`: SPICE netlist for IGBT switching losses.
- \`grid/IEEE_39_Bus.raw\`: PSS/E 39-bus New England bulk power transmission test case.
- \`package.mo\`: Modelica package definition.

## Simulation & Instantiation
\`\`\`bash
msx flatten models/MmcVscConverter.mo
msx simulate models/MmcVscConverter.mo --solver=cvode --stop-time=2.0
\`\`\`
`,
            "package.mo": `within ;
package TerraGrid "TerraGrid HVDC & Renewable Interconnection Models"
  constant String version = "1.8.0";
  annotation(Documentation(info="<html><p>500kV MMC VSC-HVDC bulk transmission models.</p></html>"));
end TerraGrid;
`,
            "models/MmcVscConverter.mo": `within TerraGrid;
model MmcVscConverter "Modular Multilevel Converter 500kV VSC Station"
  parameter Real Vdc = 500e3 "Nominal DC pole-to-pole voltage (V)";
  parameter Real S_rated = 2000e6 "Rated apparent power (VA)";
  parameter Real L_arm = 45e-3 "Arm inductance (H)";
  parameter Real R_arm = 0.85 "Arm parasitic resistance (Ohm)";
  parameter Real C_sm = 10e-3 "Submodule capacitance (F)";
  parameter Integer N_sm = 400 "Number of submodules per arm";

  input Real i_ac_a "Phase A AC grid current (A)";
  input Real v_ac_a "Phase A AC grid voltage (V)";
  output Real v_arm_upper "Upper arm synthesized voltage (V)";
  output Real v_arm_lower "Lower arm synthesized voltage (V)";

  Real i_arm_upper;
  Real i_arm_lower;
  Real energy_arm_upper(start = 2.5e6);

equation
  i_arm_upper = 0.5 * (S_rated / Vdc) + 0.5 * i_ac_a;
  i_arm_lower = 0.5 * (S_rated / Vdc) - 0.5 * i_ac_a;

  v_arm_upper = 0.5 * Vdc - v_ac_a - L_arm * der(i_arm_upper) - R_arm * i_arm_upper;
  v_arm_lower = 0.5 * Vdc + v_ac_a - L_arm * der(i_arm_lower) - R_arm * i_arm_lower;

  der(energy_arm_upper) = v_arm_upper * i_arm_upper;
end MmcVscConverter;
`,
            "control/VirtualSynchronousMachine.mo": `within TerraGrid;
block VirtualSynchronousMachine "Grid-forming virtual synchronous generator control"
  parameter Real H = 3.2 "Virtual inertia constant (seconds)";
  parameter Real D = 20.0 "Damping factor (p.u.)";
  parameter Real Droop_P = 0.05 "Active power frequency droop (5%)";
  parameter Real omega_0 = 376.9911 "Nominal grid frequency (60 Hz in rad/s)";

  input Real P_meas "Measured active power injection (p.u.)";
  input Real P_ref "Reference active power command (p.u.)";
  input Real omega_grid "Measured grid frequency (rad/s)";
  output Real theta_vsm "Synthesized internal voltage angle (rad)";

  Real omega_vsm(start = 376.9911);

equation
  der(omega_vsm) = (P_ref - P_meas - D * (omega_vsm - omega_grid) - (1.0 / Droop_P) * (omega_vsm / omega_0 - 1.0)) / (2.0 * H);
  der(theta_vsm) = omega_vsm;
end VirtualSynchronousMachine;
`,
            "circuits/InverterBridge.sp": `* TerraGrid 500kV MMC IGBT Submodule Power Stage SPICE Netlist
.subckt MMC_SUBMODULE P_IN N_OUT GATE_DRIVE
C_SM P_IN N_OUT 10mF IC=1250V
S_TOP P_IN MID GATE_DRIVE 0 SW_IGBT
D_TOP MID P_IN D_FREEWHEEL
S_BOT MID N_OUT 0 GATE_DRIVE SW_IGBT
D_BOT N_OUT MID D_FREEWHEEL
.model SW_IGBT VSWITCH (Ron=1.5m Roff=1Meg Von=15V Voff=0V)
.model D_FREEWHEEL D (IS=1e-9 RS=2m BV=3300V)
.ends MMC_SUBMODULE
`,
            "grid/IEEE_39_Bus.raw": `0, 100.0, 33, 0, 1, 60.0 / IEEE 39-Bus New England Test System
1, 'BUS-01     ', 345.0, 1, 1, 1, 1, 1.0000, 0.0000
2, 'BUS-02     ', 345.0, 1, 1, 1, 1, 1.0000, 0.0000
3, 'BUS-03     ', 345.0, 1, 1, 1, 1, 1.0000, 0.0000
0 / END OF BUS DATA
`,
          },
        },
        {
          branch: "eco/vsm-inertia-tuning",
          message: "feat(control): tune virtual inertia H to 4.5s for weak grid stability (ECO-1)",
          authorName: "Marcus Chen",
          authorEmail: "marcus_chen@terragrid.energy",
          timestampHoursAgo: 8,
          files: {
            "control/VirtualSynchronousMachine.mo": `within TerraGrid;
block VirtualSynchronousMachine "Grid-forming virtual synchronous generator control"
  parameter Real H = 4.5 "Virtual inertia constant (seconds) [calibrated for SCR < 1.5]";
  parameter Real D = 20.0 "Damping factor (p.u.)";
  parameter Real Droop_P = 0.05 "Active power frequency droop (5%)";
  parameter Real omega_0 = 376.9911 "Nominal grid frequency (60 Hz in rad/s)";

  input Real P_meas "Measured active power injection (p.u.)";
  input Real P_ref "Reference active power command (p.u.)";
  input Real omega_grid "Measured grid frequency (rad/s)";
  output Real theta_vsm "Synthesized internal voltage angle (rad)";

  Real omega_vsm(start = 376.9911);

equation
  der(omega_vsm) = (P_ref - P_meas - D * (omega_vsm - omega_grid) - (1.0 / Droop_P) * (omega_vsm / omega_0 - 1.0)) / (2.0 * H);
  der(theta_vsm) = omega_vsm;
end VirtualSynchronousMachine;
`,
          },
        },
      ],
    },

    // ── Space 3: @nordic-subsea/troll-field-multiphase ─────────────────────────
    {
      ownerType: "organization",
      ownerSlug: "nordic-subsea",
      slug: "troll-field-multiphase",
      name: "Troll Field Subsea Tieback Flow Assurance",
      tagline: "OLGA transient multiphase thermal-hydraulic model: hydrodynamic slugging mitigation & MEG injection.",
      description:
        "Coupled subsea pipeline and vertical riser system with dynamic pigging schedules, wax deposition kinetics, and topside slug catcher inflow control.",
      domainPreset: "oil_gas_process",
      creatorUsername: "astrid_solberg",
      avatarUrl: "https://images.unsplash.com/photo-1518837695005-2083093ee35b?auto=format&fit=crop&w=256&q=80",
      bannerUrl: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
      members: [
        { username: "astrid_solberg", role: "owner" },
        { username: "henrik_lindqvist", role: "contributor" },
        { username: "priya_nair", role: "reviewer" },
      ],
      followers: ["astrid_solberg", "henrik_lindqvist", "priya_nair"],
      conversations: [
        {
          channelSlug: "general",
          messages: [
            {
              username: "astrid_solberg",
              content:
                "We completed the transient ramp-up simulation for the 34 km tieback. Severe slugging is anticipated between 18% and 32% choke opening during cold startup.",
              hoursAgo: 12,
              reactions: { "🌊": ["priya_nair"] },
            },
            {
              username: "priya_nair",
              content:
                "Consider stepping the topside control valve dynamically based on riser base pressure \\(P_{rb}\\). That smoothed the liquid slug arrival rate by 40% in our North Sea field model.",
              hoursAgo: 11,
              reactions: { "💡": ["astrid_solberg"] },
            },
          ],
        },
      ],
      livingDocs: [
        {
          slug: "slug-catcher-sizing-criteria",
          title: "Transient Slugging Volume & Topside Separator Inflow Design Basis",
          summary:
            "Design basis for 250 m³ slug catcher volume under transient pigging arrival and ramp-up conditions.",
          authorUsername: "astrid_solberg",
          contentMarkdown: `# Troll Field Subsea Slugging & Flow Assurance Basis

## 1. System Overview
- Tieback Length: 34.2 km
- Internal Diameter: 24 inch (0.584 m)
- Water Depth: 320 m to topside deck (+28 m LAT)
- Seabed Temperature: 4.0 °C
`,
        },
      ],
      ecos: [
        {
          title: "Automated Slug Choke PI Controller Anti-Surge Tuning",
          description:
            "Implement active topside choke feedback from subsea riser-base pressure to suppress slugging cycles during low-rate winter production.",
          severity: "standard",
          authorUsername: "astrid_solberg",
          sourceBranch: "eco/slug-choke-pi-tuning",
          impactedModels: ["NordicSubsea.FlowAssurance.TopsideChokeController"],
          status: "open",
        },
      ],
      issues: [
        {
          title: "Severe Hydrodynamic Slugging at Riser Base during Turndown Rate (< 60 kg/s)",
          description:
            "Transient simulation at low gas-oil ratio indicates liquid slug lengths exceeding 250m accumulating at the 320m vertical riser base, risking topside separator overflow.",
          severity: "major",
          authorUsername: "astrid_solberg",
          impactedModels: ["NordicSubsea.FlowAssurance.TopsideChokeController"],
          status: "open",
          linkedPrNumber: 1,
          comments: [
            {
              username: "henrik_lindqvist",
              content:
                "We need active choke opening modulation to stabilize the riser base pressure. Testing with the anti-slugging PI controller in PR #1.",
              hoursAgo: 12,
            },
          ],
        },
      ],
      gitCommits: [
        {
          branch: "main",
          message: "feat(flow): initialize Troll Field 34km tieback multiphase pipeline & topside choke",
          authorName: "Astrid Solberg",
          authorEmail: "astrid_solberg@nordic-subsea.offshore",
          timestampHoursAgo: 96,
          files: {
            "README.md": `# Nordic Dynamics Troll Field Subsea Tieback Flow Assurance

Transient multiphase thermal-hydraulic model for the **Troll Field 34.2 km subsea tieback** to the topside processing facility.

## Scope
- Hydrodynamic and terrain slugging prediction during ramp-up and turndown.
- Hydrate formation risk margin and Mono-Ethylene Glycol (MEG) dosage scheduling.
- Topside slug catcher inflow suppression via active riser-base pressure feedback choke control.

## Repository Contents
- \`models/TiebackMultiphasePipeline.mo\`: 1D discretized transient two-phase subsea pipeline.
- \`control/AntiSluggingTopsideChoke.mo\`: Active PI choke controller for slug mitigation.
- \`pipeline/TiebackHydraulics.opi\`: Industrial process flow diagram (OPI XML format).
- \`package.mo\`: Modelica package definition.

## Simulation & Instantiation
\`\`\`bash
msx flatten models/TiebackMultiphasePipeline.mo
msx simulate models/TiebackMultiphasePipeline.mo --solver=cvode --stop-time=3600
\`\`\`
`,
            "package.mo": `within ;
package NordicSubsea "Nordic Dynamics Subsea Flow Assurance Suite"
  constant String version = "3.1.0";
  annotation(Documentation(info="<html><p>Subsea multiphase pipeline & slugging models.</p></html>"));
end NordicSubsea;
`,
            "models/TiebackMultiphasePipeline.mo": `within NordicSubsea;
model TiebackMultiphasePipeline "1D discretized transient two-phase subsea pipeline"
  parameter Real length = 34200.0 "Pipeline total length (m)";
  parameter Real diameter = 0.584 "Internal pipeline diameter (m)";
  parameter Real roughness = 4.5e-5 "Pipe internal roughness (m)";
  parameter Real ambientTempSeabed = 277.15 "Seabed water temperature (K)";

  input Real inletMassFlowGas(start = 45.0) "Wellhead gas mass flow (kg/s)";
  input Real inletMassFlowOil(start = 120.0) "Wellhead oil mass flow (kg/s)";
  input Real topsideChokeOpening(start = 0.25) "Topside control choke fraction (0 to 1)";

  output Real riserBasePressure "Subsea riser base pressure (bar)";
  output Real topsideArrivalLiquidRate "Instantaneous liquid arrival rate (m3/hr)";

  Real pressureGradient;
  Real mixtureVelocity;
  Real holdupLiquid(start = 0.32);

equation
  mixtureVelocity = (inletMassFlowGas / 40.0 + inletMassFlowOil / 850.0) / (3.14159 * (diameter / 2)^2);
  pressureGradient = (0.018 * 850.0 * mixtureVelocity^2) / (2.0 * diameter);
  riserBasePressure = 110.0 - (pressureGradient * length) / 1e5 - 28.0 * (1.0 - topsideChokeOpening);
  der(holdupLiquid) = (inletMassFlowOil / 850.0 - topsideArrivalLiquidRate / 3600.0) / (length * 0.268);
  topsideArrivalLiquidRate = topsideChokeOpening * 1400.0 * sqrt(max(0.1, riserBasePressure - 18.0));
end TiebackMultiphasePipeline;
`,
            "control/AntiSluggingTopsideChoke.mo": `within NordicSubsea;
block AntiSluggingTopsideChoke "Active PI choke controller for slug mitigation"
  parameter Real setpointPressure = 72.0 "Target riser base pressure setpoint (bar)";
  parameter Real Kp = 0.045 "Proportional choke gain (1/bar)";
  parameter Real Ti = 120.0 "Integral time constant (seconds)";

  input Real measuredRiserBasePressure;
  output Real chokeCommand;

  Real error;
  Real integralState(start = 0.25);

equation
  error = measuredRiserBasePressure - setpointPressure;
  der(integralState) = error / Ti;
  chokeCommand = max(0.05, min(1.0, 0.25 + Kp * error + integralState));
end AntiSluggingTopsideChoke;
`,
            "pipeline/TiebackHydraulics.opi": `<?xml version="1.0" encoding="UTF-8"?>
<display typeId="org.csstudio.opibuilder.Display" version="1.0.0">
  <name>Troll Subsea Tieback Hydraulics</name>
  <widget typeId="org.csstudio.opibuilder.widgets.linkingContainer">
    <name>Tieback Pipeline Choke Skid</name>
    <pv_name>Troll:RiserBase:Pressure</pv_name>
  </widget>
</display>
`,
          },
        },
        {
          branch: "eco/slug-choke-pi-tuning",
          message: "feat(choke): tune PI choke feedback for severe slugging suppression (ECO-1)",
          authorName: "Astrid Solberg",
          authorEmail: "astrid_solberg@nordic-subsea.offshore",
          timestampHoursAgo: 12,
          files: {
            "control/AntiSluggingTopsideChoke.mo": `within NordicSubsea;
block AntiSluggingTopsideChoke "Active PI choke controller for slug mitigation"
  parameter Real setpointPressure = 74.5 "Target riser base pressure setpoint (bar) [ECO-1 optimized]";
  parameter Real Kp = 0.062 "Proportional choke gain (1/bar)";
  parameter Real Ti = 95.0 "Integral time constant (seconds)";

  input Real measuredRiserBasePressure;
  output Real chokeCommand;

  Real error;
  Real integralState(start = 0.28);

equation
  error = measuredRiserBasePressure - setpointPressure;
  der(integralState) = error / Ti;
  chokeCommand = max(0.05, min(1.0, 0.28 + Kp * error + integralState));
end AntiSluggingTopsideChoke;
`,
          },
        },
      ],
    },

    // ── Space 4: @marcus_chen/microgrid-lab (Personal User Space) ──────────────
    {
      ownerType: "user",
      ownerSlug: "marcus_chen",
      slug: "microgrid-lab",
      name: "Islanded Microgrid Dynamics Lab",
      tagline: "BESS + Solar PV islanded microgrid stability under 100% renewable penetration.",
      description:
        "Personal research playground for testing droop control, seamless islanding transitions, and black-start coordination with battery inverters.",
      domainPreset: "power_rf_grid",
      creatorUsername: "marcus_chen",
      avatarUrl: "https://images.unsplash.com/photo-1509391365360-2e959784a276?auto=format&fit=crop&w=256&q=80",
      bannerUrl: "https://images.unsplash.com/photo-1497440001374-f26997328c1b?auto=format&fit=crop&w=1200&q=80",
      members: [
        { username: "marcus_chen", role: "owner" },
        { username: "omar", role: "contributor" },
      ],
      followers: ["marcus_chen", "omar", "elena_vance"],
      conversations: [
        {
          channelSlug: "general",
          messages: [
            {
              username: "marcus_chen",
              content:
                "Setting up a 10 MW / 40 MWh grid-forming battery storage inverter simulation. Testing frequency recovery following an unexpected 4 MW step load pickup.",
              hoursAgo: 16,
              reactions: { "🔋": ["omar"] },
            },
          ],
        },
      ],
      livingDocs: [
        {
          slug: "droop-vs-virtual-inertia",
          title: "Frequency Droop vs. Virtual Synchronous Machine (VSM) Stability Tradeoffs",
          summary:
            "Comparative analysis of \\(P/f\\) droop control versus synthetic inertia in low-inertia islanded grids.",
          authorUsername: "marcus_chen",
          contentMarkdown: `# Microgrid Frequency Control Dynamics

In a 100% inverter-based microgrid, system frequency \\(f\\) is synthesized by the power-frequency control loop:

$$P - P_0 = -K_p (f - f_0) - D \\frac{df}{dt}$$
`,
        },
      ],
      ecos: [],
      gitCommits: [
        {
          branch: "main",
          message:
            "feat(microgrid): initialize 10MW/40MWh BESS model, PV array generator & secondary frequency restoration",
          authorName: "Marcus Chen",
          authorEmail: "marcus_chen@terragrid.energy",
          timestampHoursAgo: 120,
          files: {
            "README.md": `# Islanded Microgrid Dynamics Lab

Personal research sandbox for testing **100% inverter-based islanded microgrid stability**, black-start coordination, and battery storage energy management.

## Components
- \`models/BatteryEnergyStorage.mo\`: 10 MW / 40 MWh utility-scale battery energy storage system with SoC tracking.
- \`models/PvArrayGenerator.mo\`: Solar PV array with irradiance temperature derating.
- \`control/MicrogridEnergyManager.mo\`: Secondary frequency and voltage restoration controller.
- \`package.mo\`: Modelica package definition.

## Run Simulation
\`\`\`bash
msx simulate models/BatteryEnergyStorage.mo --stop-time=1800
\`\`\`
`,
            "package.mo": `within ;
package MicrogridLab "Islanded Microgrid Research Lab"
  constant String version = "1.0.0";
end MicrogridLab;
`,
            "models/BatteryEnergyStorage.mo": `within MicrogridLab;
model BatteryEnergyStorage "10 MW / 40 MWh Utility-Scale BESS Model"
  parameter Real capacityKWh = 40000.0 "Battery energy capacity (kWh)";
  parameter Real nominalVoltage = 800.0 "Pack nominal DC voltage (V)";
  parameter Real internalResistance = 0.012 "Internal cell resistance (Ohm)";

  input Real powerCommandKW "Charge (negative) or discharge (positive) command (kW)";
  output Real stateOfCharge "State of charge (0 to 1)";
  output Real terminalVoltage "DC bus terminal voltage (V)";

  Real batteryCurrent;

equation
  batteryCurrent = (powerCommandKW * 1000.0) / nominalVoltage;
  terminalVoltage = nominalVoltage - batteryCurrent * internalResistance;
  der(stateOfCharge) = -batteryCurrent / (capacityKWh * 3600.0 / nominalVoltage);
end BatteryEnergyStorage;
`,
            "models/PvArrayGenerator.mo": `within MicrogridLab;
model PvArrayGenerator "Solar PV string with Maximum Power Point Tracking (MPPT)"
  parameter Real peakPowerKW = 5000.0 "Peak PV array output (kW)";
  parameter Real irradianceSTC = 1000.0 "Standard test condition solar irradiance (W/m2)";

  input Real solarIrradiance(start = 850.0) "Incoming solar irradiance (W/m2)";
  input Real ambientTemperatureC(start = 25.0) "Cell temperature (deg C)";
  output Real generatedPowerKW "Output electrical power (kW)";

equation
  generatedPowerKW = peakPowerKW * (solarIrradiance / irradianceSTC) * (1.0 - 0.004 * (ambientTemperatureC - 25.0));
end PvArrayGenerator;
`,
            "control/MicrogridEnergyManager.mo": `within MicrogridLab;
block MicrogridEnergyManager "Secondary frequency and voltage restoration controller"
  parameter Real f_nominal = 60.0 "Nominal microgrid frequency (Hz)";
  parameter Real V_nominal = 480.0 "Nominal line-to-line voltage (V)";
  parameter Real K_f = 120.0 "Frequency integral restoration gain";
  parameter Real K_v = 45.0 "Voltage integral restoration gain";

  input Real measuredFrequency;
  input Real measuredVoltage;
  output Real powerCorrectionCommand;
  output Real varCorrectionCommand;

  Real intFreqError(start = 0.0);
  Real intVoltError(start = 0.0);

equation
  der(intFreqError) = f_nominal - measuredFrequency;
  der(intVoltError) = V_nominal - measuredVoltage;

  powerCorrectionCommand = K_f * intFreqError;
  varCorrectionCommand = K_v * intVoltError;
end MicrogridEnergyManager;
`,
          },
        },
      ],
    },

    // ── Space 5: @claire_dubois/mbse-digital-thread (Personal User Space) ───────
    {
      ownerType: "user",
      ownerSlug: "claire_dubois",
      slug: "mbse-digital-thread",
      name: "SysML v2 & OSLC Digital Thread Studio",
      tagline:
        "End-to-end traceability from ReqIF stakeholder requirements to Modelica continuous plant models and STEP geometry.",
      description:
        "Exploring automated verification of system requirements against continuous simulation models using ModelScript polyglot queries.",
      domainPreset: "systems_general",
      creatorUsername: "claire_dubois",
      avatarUrl: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=256&q=80",
      bannerUrl: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80",
      members: [
        { username: "claire_dubois", role: "owner" },
        { username: "elena_vance", role: "contributor" },
        { username: "omar", role: "reviewer" },
      ],
      followers: ["claire_dubois", "elena_vance", "omar"],
      conversations: [
        {
          channelSlug: "general",
          messages: [
            {
              username: "claire_dubois",
              content:
                "Connected our OMG SysML v2 systems specification directly to ModelScript's Salsa query engine. Requirement verification rules now re-evaluate automatically whenever continuous plant parameters change!",
              hoursAgo: 20,
              reactions: { "✨": ["omar", "elena_vance"], "👏": ["omar"] },
            },
          ],
        },
      ],
      livingDocs: [
        {
          slug: "traceability-metamodel",
          title: "Formal Traceability Metamodel: ReqIF to SysML v2 to Continuous DAE Verification",
          summary: "Architecture framework for automated continuous verification of safety and mission requirements.",
          authorUsername: "claire_dubois",
          contentMarkdown: `# Digital Thread Traceability Metamodel

## 1. Formal Relationship Taxonomy
- \`satisfies\`: Maps SysML v2 architectural parts to ReqIF system requirements.
- \`verifies\`: Maps Modelica continuous simulation assertions to requirement constraints.
- \`refines\`: Maps high-level stakeholder intents to detailed engineering tolerances.
`,
        },
      ],
      ecos: [],
      gitCommits: [
        {
          branch: "main",
          message:
            "feat(mbse): initialize SysML v2 spacecraft architecture, ReqIF requirements & continuous thermal DAE",
          authorName: "Claire Dubois",
          authorEmail: "claire_dubois@aether-dynamics.aerospace",
          timestampHoursAgo: 140,
          files: {
            "README.md": `# SysML v2 & OSLC Digital Thread Studio

Traceability framework linking **ReqIF requirements, OMG SysML v2 system structures, and Modelica continuous DAE simulations**.

## Repository Contents
- \`sysml/SpacecraftBus.sysml\`: OMG SysML v2 spacecraft bus physical and electrical architecture.
- \`requirements/MissionRequirements.reqif\`: Formal XML ReqIF requirements definitions.
- \`models/ThermalControlSubsystem.mo\`: Continuous DAE thermal radiative balance model verifying REQ-SYS-001.
- \`package.mo\`: Modelica package definition.
`,
            "package.mo": `within ;
package DigitalThread "MBSE Digital Thread Verification Models"
  constant String version = "1.0.0";
end DigitalThread;
`,
            "sysml/SpacecraftBus.sysml": `package SpacecraftBusArchitecture {
  doc /* Deep Space SmallSat Bus Physical Architecture */

  part def PowerSubsystem {
    attribute solarArrayPowerW: Real = 450.0;
    attribute batteryCapacityWh: Real = 320.0;
  }

  part def ThermalControlSubsystem {
    attribute maxOperatingTempC: Real = 45.0;
    attribute minOperatingTempC: Real = -10.0;
  }

  part def SmallSatBus {
    part power: PowerSubsystem;
    part thermal: ThermalControlSubsystem;
  }
}
`,
            "requirements/MissionRequirements.reqif": `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-SYS-001">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="The satellite bus shall maintain avionics bay temperature between -10C and +45C in all orbital sun/eclipse phases."/>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>
`,
            "models/ThermalControlSubsystem.mo": `within DigitalThread;
model ThermalControlSubsystem "Satellite bus passive/active thermal equilibrium model"
  parameter Real busMass = 120.0 "Bus structural thermal mass (kg)";
  parameter Real specificHeat = 900.0 "Aluminum thermal capacity (J/kg.K)";
  parameter Real radiatorArea = 1.2 "Active radiator area (m2)";
  parameter Real emissivity = 0.88 "Radiator optical emissivity";
  parameter Real sigma = 5.670374e-8 "Stefan-Boltzmann constant (W/m2.K4)";

  input Real internalDissipationWatts(start = 180.0) "Avionics internal heat dissipation (W)";
  input Real solarFluxWatts(start = 450.0) "Direct incident solar heat flux (W)";
  output Real busTemperatureC "Bus equilibrium temperature (deg C)";

  Real temperatureKelvin(start = 293.15);

equation
  busMass * specificHeat * der(temperatureKelvin) = internalDissipationWatts + solarFluxWatts - radiatorArea * emissivity * sigma * (temperatureKelvin^4 - 2.7^4);
  busTemperatureC = temperatureKelvin - 273.15;
end ThermalControlSubsystem;
`,
          },
        },
      ],
    },
  ];

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. EXECUTE SPACE SEEDING
  // ─────────────────────────────────────────────────────────────────────────────

  for (const sDef of sampleSpaces) {
    const creatorId = userIds.get(sDef.creatorUsername) ?? adminId;

    let targetOrgId: number | null = null;
    let targetUserId: number | null = null;

    if (sDef.ownerType === "organization") {
      targetOrgId = orgIdBySlug.get(sDef.ownerSlug) ?? null;
      if (!targetOrgId) continue;
    } else {
      targetUserId = userIds.get(sDef.ownerSlug) ?? null;
      if (!targetUserId) continue;
    }

    const namespace = sDef.ownerSlug;
    let space = db.getSpaceByNamespaceAndSlug(namespace, sDef.slug);

    if (!space) {
      space = db.createSpace({
        slug: sDef.slug,
        name: sDef.name,
        tagline: sDef.tagline,
        description: sDef.description,
        ownerType: sDef.ownerType,
        organizationId: targetOrgId ?? undefined,
        userId: targetUserId ?? undefined,
        creatorUserId: creatorId,
        domainPreset: sDef.domainPreset,
        avatarUrl: sDef.avatarUrl,
        bannerUrl: sDef.bannerUrl,
        visibility: "public",
      });
      spacesSeeded++;
    } else {
      // Update visual presentation if already present
      db.updateSpace(space.id, {
        name: sDef.name,
        tagline: sDef.tagline,
        description: sDef.description,
        domainPreset: sDef.domainPreset,
        avatarUrl: sDef.avatarUrl,
        bannerUrl: sDef.bannerUrl,
      });
    }

    // Sync Space Members
    for (const mem of sDef.members) {
      const mId = userIds.get(mem.username);
      if (mId) {
        db.upsertSpaceMember(space.id, mId, mem.role);
      }
    }

    // Sync Space Followers
    for (const fUsername of sDef.followers) {
      const fId = userIds.get(fUsername);
      if (fId) {
        db.followSpace(space.id, fId);
      }
    }

    // Add extra channels if defined
    if (sDef.extraChannels) {
      for (const ch of sDef.extraChannels) {
        const existingCh = db.getSpaceChannelBySlug(space.id, ch.slug);
        if (!existingCh) {
          db.createSpaceChannel({
            spaceId: space.id,
            slug: ch.slug,
            name: ch.name,
            topic: ch.topic,
            kind: ch.kind,
          });
        }
      }
    }

    const channels = db.getSpaceChannels(space.id);
    const channelMap = new Map<string, SpaceChannelRecord>(channels.map((c) => [c.slug, c]));

    // Seed Conversations
    for (const conv of sDef.conversations) {
      const ch = channelMap.get(conv.channelSlug);
      if (!ch) continue;

      const existingMsgs = db.getSpaceMessages(ch.id, { limit: 10 });
      // Only seed conversation if this channel doesn't already have user conversations
      if (existingMsgs.length <= 1) {
        for (const msgDef of conv.messages) {
          const authorId = msgDef.username ? (userIds.get(msgDef.username) ?? null) : null;
          const msg = db.createSpaceMessage({
            channelId: ch.id,
            spaceId: space.id,
            authorId,
            senderType: msgDef.senderType ?? "user",
            senderName: msgDef.senderName ?? null,
            content: msgDef.content,
          });
          messagesSeeded++;

          // Backdate message timestamp
          const msgTime = hoursAgoSqliteTimestamp(msgDef.hoursAgo);
          db.db.prepare("UPDATE space_messages SET created_at = ? WHERE id = ?").run(msgTime, msg.id);

          // Add reactions
          if (msgDef.reactions) {
            for (const [emoji, usernames] of Object.entries(msgDef.reactions)) {
              for (const u of usernames) {
                db.toggleSpaceMessageReaction(msg.id, u, emoji);
              }
            }
          }

          // Thread replies
          if (msgDef.replies) {
            for (const rDef of msgDef.replies) {
              const rAuthorId = userIds.get(rDef.username) ?? null;
              const rMsg = db.createSpaceMessage({
                channelId: ch.id,
                spaceId: space.id,
                authorId: rAuthorId,
                content: rDef.content,
                replyToId: msg.id,
              });
              messagesSeeded++;

              const replyTime = hoursAgoSqliteTimestamp(rDef.hoursAgo);
              db.db.prepare("UPDATE space_messages SET created_at = ? WHERE id = ?").run(replyTime, rMsg.id);

              if (rDef.reactions) {
                for (const [emoji, usernames] of Object.entries(rDef.reactions)) {
                  for (const u of usernames) {
                    db.toggleSpaceMessageReaction(rMsg.id, u, emoji);
                  }
                }
              }
            }
          }
        }
      }
    }

    // Seed Living Docs
    for (const docDef of sDef.livingDocs) {
      const docAuthorId = userIds.get(docDef.authorUsername) ?? adminId;
      db.upsertSpacePage({
        spaceId: space.id,
        slug: docDef.slug,
        title: docDef.title,
        summary: docDef.summary,
        authorUserId: docAuthorId,
        contentMarkdown: docDef.contentMarkdown,
      });
      docsSeeded++;
    }

    // Seed ECO Proposals & Approvals
    const existingEcos = db.getSpaceEcoProposals(space.id);
    for (const ecoDef of sDef.ecos) {
      if (existingEcos.some((e) => e.title === ecoDef.title)) continue;
      const ecoAuthorId = userIds.get(ecoDef.authorUsername) ?? adminId;
      const eco = db.createSpaceEcoProposal({
        spaceId: space.id,
        title: ecoDef.title,
        description: ecoDef.description,
        severity: ecoDef.severity,
        sourceBranch: ecoDef.sourceBranch,
        targetBranch: "main",
        authorId: ecoAuthorId,
        impactedModels: ecoDef.impactedModels,
      });
      ecosSeeded++;

      if (ecoDef.approvals) {
        for (const app of ecoDef.approvals) {
          const appUserId = userIds.get(app.username);
          if (appUserId) {
            db.reviewSpaceEcoProposal({
              ecoId: eco.id,
              spaceId: space.id,
              userId: appUserId,
              decision: app.decision,
              comment: app.comment,
            });
          }
        }
      }
    }

    // Seed Issues (Problem Reports / ECRs)
    if (sDef.issues) {
      const existingIssues = db.getSpaceIssues(space.id);
      for (const issDef of sDef.issues) {
        if (existingIssues.some((i) => i.title === issDef.title)) continue;
        const issAuthorId = userIds.get(issDef.authorUsername) ?? adminId;
        const issue = db.createSpaceIssue({
          spaceId: space.id,
          title: issDef.title,
          description: issDef.description,
          severity: issDef.severity,
          authorId: issAuthorId,
          impactedModels: issDef.impactedModels,
          linkedPrNumber: issDef.linkedPrNumber,
        });
        issuesSeeded++;

        if (issDef.status === "closed") {
          db.updateSpaceIssue({
            spaceId: space.id,
            issueId: issue.id,
            status: "closed",
          });
        }

        if (issDef.comments) {
          for (const cDef of issDef.comments) {
            const cUserId = userIds.get(cDef.username) ?? adminId;
            const cComment = db.addSpaceIssueComment({
              issueId: issue.id,
              userId: cUserId,
              content: cDef.content,
            });
            if (cDef.hoursAgo !== undefined) {
              const cTime = hoursAgoSqliteTimestamp(cDef.hoursAgo);
              db.db.prepare("UPDATE space_issue_comments SET created_at = ? WHERE id = ?").run(cTime, cComment.id);
            }
          }
        }
      }
    }

    // Seed Git Vault Commits & Files
    if (sDef.gitCommits) {
      const vault = ensureSpaceGitVaultInitialized({
        dbDir: db.dbDir,
        namespace: space.owner_namespace,
        slug: space.slug,
        name: space.name,
        domainPreset: space.domain_preset,
        defaultBranch: space.default_branch || "main",
      });
      const repoPath = vault.repoPath;
      if (repoPath) {
        for (const commitDef of sDef.gitCommits) {
          const authorUser = commitDef.authorName ? commitDef.authorName : sDef.creatorUsername;
          const authorEmail =
            commitDef.authorEmail || `${authorUser.toLowerCase().replace(/[^a-z0-9_]/g, "")}@modelscript.org`;
          const commitTime =
            commitDef.timestampHoursAgo !== undefined
              ? Date.now() - commitDef.timestampHoursAgo * 3_600_000
              : undefined;

          const sha = commitFilesToBareGitVault({
            repoPath,
            branch: commitDef.branch || "main",
            message: commitDef.message,
            authorName: authorUser,
            authorEmail,
            timestamp: commitTime,
            files: commitDef.files,
          });

          if (sha) {
            gitCommitsSeeded++;
          }
        }
      }
    }
  }

  return {
    organizationsSeeded,
    spacesSeeded,
    messagesSeeded,
    docsSeeded,
    ecosSeeded,
    issuesSeeded,
    gitCommitsSeeded,
  };
}

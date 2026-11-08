// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LibraryDatabase, SpaceChannelRecord } from "../database.js";

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
  }

  return {
    organizationsSeeded,
    spacesSeeded,
    messagesSeeded,
    docsSeeded,
    ecosSeeded,
  };
}

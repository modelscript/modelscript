// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SeedPostSpec } from "../types.js";

export const SYSTEMS_ONTOLOGICAL_POSTS: SeedPostSpec[] = [
  // 1. modelica
  {
    languageId: "modelica",
    author: "elena_vance",
    title: "ElectroHydrostaticActuator — Primary Aileron EHA Servo Loop",
    filename: "ElectroHydrostaticActuator.mo",
    viewType: "modelica-diagram",
    hoursAgo: 2,
    postContent:
      "Published the updated Modelica 3.5 multi-domain Electro-Hydrostatic Flight Actuator (EHA) model for primary flight control surfaces. Couples a permanent-magnet synchronous motor drive, bidirectional fixed-displacement axial piston pump, differential hydraulic cylinder with fluid compressibility (bulk modulus β = 1.45 GPa), and cascaded position/pressure damping loop. Achieves 42 rad/s bandwidth under 38 kN aerodynamic hinge load with zero steady-state leakage. #modelica #aerospace #hydraulics #fmi3 #multiphysics",
    code: `model ElectroHydrostaticActuator "Primary flight control Electro-Hydrostatic Actuator (EHA)"
  parameter Real Kp_pos = 1.80e4 "Position loop proportional gain (rad/(s.m))";
  parameter Real Kv_vel = 1.42 "Velocity feedback damping gain (s)";
  parameter Real D_pump = 2.8e-6 "Axial piston pump displacement (m3/rad)";
  parameter Real A_piston = 0.00145 "Effective symmetrical piston area (m2)";
  parameter Real M_load = 48.0 "Reflected control surface inertia mass (kg)";
  parameter Real B_viscous = 620.0 "Cylinder viscous friction coefficient (N.s/m)";
  parameter Real V_chamber = 1.8e-4 "Nominal hydraulic chamber volume (m3)";
  parameter Real beta_oil = 1.20e9 "Skydrol LD-4 effective bulk modulus (Pa)";
  parameter Real C_leak = 2.10e-12 "Internal cross-port laminar leakage coeff (m3/(s.Pa))";
  parameter Real F_aero_step = 18500.0 "External aerodynamic hinge step load (N)";

  Real x_cmd "Commanded actuator stroke (m)";
  Real x_pos(start = 0.0, fixed = true) "Measured piston position (m)";
  Real v_pos(start = 0.0, fixed = true) "Piston velocity (m/s)";
  Real omega_pump(start = 0.0, fixed = true) "Servo-pump shaft speed (rad/s)";
  Real tau_motor "Electromagnetic motor torque (N.m)";
  Real p_diff(start = 0.0, fixed = true) "Differential load pressure Pa - Pb (Pa)";
  Real q_pump "Ideal volumetric pump flow (m3/s)";
  Real q_leak "Internal cross-chamber leakage flow (m3/s)";
  Real F_hyd "Hydraulic actuation force (N)";
  Real F_ext "External aerodynamic hinge load (N)";

equation
  // Command profile & external gust load at t = 0.25s
  x_cmd = if time < 0.05 then 0.0 else 0.035 * (1.0 - exp(-18.0 * (time - 0.05)));
  F_ext = if time < 0.25 then 2400.0 else F_aero_step;

  // Cascaded position + velocity servo law driving PMSM shaft dynamics
  der(omega_pump) = (Kp_pos * (x_cmd - x_pos) - Kv_vel * v_pos - omega_pump) / 0.0032;

  // Hydraulic continuity & effective bulk modulus compressibility
  q_pump = D_pump * omega_pump;
  q_leak = C_leak * p_diff;
  (V_chamber / (2.0 * beta_oil)) * der(p_diff) = q_pump - A_piston * v_pos - q_leak;

  // Mechanical translational Newton-Euler balance
  F_hyd = A_piston * p_diff;
  tau_motor = D_pump * p_diff;
  der(x_pos) = v_pos;
  M_load * der(v_pos) = F_hyd - B_viscous * v_pos - F_ext;

  annotation(
    Icon(coordinateSystem(extent={{-100,-100},{100,100}})),
    Diagram(coordinateSystem(extent={{-120,-80},{120,80}}))
  );
end ElectroHydrostaticActuator;`,
    extraViewConfig: {
      dialect: "modelica",
      standalone: true,
      previewMode: "diagram",
    },
    comments: [
      {
        author: "claire_dubois",
        content:
          "The stiffness margin with β = 1.45 GPa easily clears our DAL-A requirement `REQ-FCS-014` (< 2.5% dynamic overshoot under 18.5 kN gust step). Linking this DAE directly to the SysML v2 verification case now.",
        replies: [
          {
            author: "elena_vance",
            content:
              "Thanks Claire! I also exported the FMI 3.0 Co-Simulation binary so you can drop it straight into the SSP thermal-hydraulic harness.",
          },
        ],
      },
      {
        author: "vikram_patel",
        content:
          "Nice treatment of cross-port laminar leakage `C_leak`. That passive damping term saves having to over-gain the pressure feedback filter near the hydraulic natural frequency.",
      },
    ],
    likedBy: [
      "omar",
      "claire_dubois",
      "vikram_patel",
      "lukas_weber",
      "david_kowalski",
      "alex_rivera",
      "kenji_takahashi",
      "sofia_rossi",
      "alice",
    ],
    repostedBy: ["omar", "claire_dubois"],
    bookmarkedBy: ["omar", "vikram_patel", "claire_dubois"],
  },

  // 2. modelscript
  {
    languageId: "modelscript",
    author: "omar",
    title: "TiltRotorTransitionController — Hybrid eVTOL Corridor Flight Dynamics",
    filename: "TiltRotorTransitionController.msx",
    viewType: "modelscript",
    hoursAgo: 4,
    postContent:
      "Demonstrating native ModelScript (`.msx`) for an eVTOL tilt-rotor transition corridor controller! Couples continuous longitudinal 3-DOF aero-propulsion equations with synchronous nacelle tilt scheduling (`theta_nacelle` from 90° hover to 0° cruise) and formal safety invariant contracts ensuring angle-of-attack α stays strictly below the 13.5° wing stall boundary throughout conversion. #modelscript #evtol #flightcontrol #formalmethods #dae",
    code: `// ModelScript (.msx) — Hybrid eVTOL Tilt-Rotor Conversion Corridor Model
model TiltRotorTransitionController {
  parameter Real m_aircraft = 2150.0;      // Gross takeoff mass (kg)
  parameter Real S_wing = 14.8;            // Reference wing area (m2)
  parameter Real rho_air = 1.225;          // Sea-level air density (kg/m3)
  parameter Real T_max_total = 28500.0;    // Peak 6-rotor combined thrust (N)
  parameter Real v_stall_clean = 36.5;     // Wingborne stall speed (m/s)
  parameter Real k_tilt_rate = 0.22;       // Nacelle conversion rate (rad/s)

  Real vx(start = 1.5, fixed = true);      // Forward airspeed (m/s)
  Real vz(start = 0.0, fixed = true);      // Vertical climb rate (m/s)
  Real theta_nac(start = 1.5708, fixed = true); // Nacelle tilt angle (rad, pi/2 = hover)
  Real alpha_deg;                          // Wing angle of attack (deg)
  Real L_wing;                             // Aerodynamic wing lift (N)
  Real D_aero;                             // Total parasitic + induced drag (N)
  Real T_cmd;                              // Total rotor thrust command (N)

  connector FlightStateBus {
    Real airspeed_mps;
    Real nacelle_rad;
    Real lift_share_ratio;
  }

  FlightStateBus telemetry;

equation
  // Smooth conversion schedule from hover (pi/2) to forward cruise (0.05 rad)
  der(theta_nac) = -k_tilt_rate * (theta_nac - (if vx < 12.0 then 1.5708 else if vx > 44.0 then 0.05 else 1.5708 * (1.0 - (vx - 12.0) / 32.0)));

  alpha_deg = 4.2 + 3.5 * sin(theta_nac);
  L_wing = 0.5 * rho_air * (vx * vx + 1.0) * S_wing * (0.28 + 0.085 * alpha_deg);
  D_aero = 0.5 * rho_air * (vx * vx + 1.0) * S_wing * (0.034 + 0.042 * (0.28 + 0.085 * alpha_deg) * (0.28 + 0.085 * alpha_deg));

  // Altitude-hold thrust allocation compensating wing lift build-up
  T_cmd = min(T_max_total, max(3200.0, (m_aircraft * 9.80665 - L_wing - 1800.0 * vz) / max(0.25, sin(theta_nac) + 0.35 * cos(theta_nac))));

  m_aircraft * der(vx) = T_cmd * cos(theta_nac) - D_aero;
  m_aircraft * der(vz) = T_cmd * sin(theta_nac) + L_wing - m_aircraft * 9.80665;

  telemetry.airspeed_mps = vx;
  telemetry.nacelle_rad = theta_nac;
  telemetry.lift_share_ratio = L_wing / (m_aircraft * 9.80665);
}`,
    extraViewConfig: {
      dialect: "msx",
      standalone: true,
      previewMode: "diagram",
    },
    comments: [
      {
        author: "sofia_rossi",
        content:
          "The transition corridor between 12 m/s and 44 m/s is super clean. Watching `telemetry.lift_share_ratio` smoothly cross 0.85 before the nacelles lock down prevents any altitude dip.",
      },
      {
        author: "elena_vance",
        content:
          "Zero intermediate AST allocations when lowering `.msx` to the DAE arena makes parameter sweeps across gross weights instantaneous!",
      },
    ],
    likedBy: [
      "elena_vance",
      "marcus_chen",
      "claire_dubois",
      "henrik_lindqvist",
      "astrid_solberg",
      "vikram_patel",
      "kenji_takahashi",
      "sarah_lin",
      "lukas_weber",
      "david_kowalski",
      "sofia_rossi",
      "alex_rivera",
      "alice",
      "bob",
    ],
    repostedBy: ["elena_vance", "sofia_rossi", "claire_dubois"],
    bookmarkedBy: ["elena_vance", "sofia_rossi", "alex_rivera"],
  },

  // 3. sysml2
  {
    languageId: "sysml2",
    author: "claire_dubois",
    title: "ArtemisLunarLanderGNC — OMG SysML v2 Descent & Touchdown Architecture",
    filename: "ArtemisLunarLanderGNC.sysml",
    viewType: "sysml2",
    hoursAgo: 7,
    postContent:
      "Here is our OMG SysML v2 architecture model for the Artemis Lunar Lander Powered Descent & Hazard Avoidance GNC subsystem. Includes typed `part def` decompositions, conjugated propellant & SpaceWire buses, modal descent state machines, and formal `requirement def` verification constraints for touchdown vertical/lateral velocity limits. #sysmlv2 #mbse #aerospace #gnc #kerml",
    code: `package ArtemisLunarLanderGNC {
  doc /* OMG SysML v2 Architecture for Lunar Lander Powered Descent & Touchdown GNC */

  attribute def MassKg;
  attribute def VelocityMps;
  attribute def ThrustKn;

  port def SpaceWireTelemetryPort {
    out attribute altitudeMeters;
    out attribute surfaceVelocityMps;
    out attribute hazardMapConfidence;
  }

  port def GimbalActuationPort {
    out attribute pitchGimbalDeg;
    out attribute yawGimbalDeg;
    out attribute throttlePct;
  }

  part def TerrainRelativeNavSensor {
    port trnOut : SpaceWireTelemetryPort;
  }

  part def DescentFlightComputer {
    port sensorIn : ~SpaceWireTelemetryPort;
    port engineCmd : GimbalActuationPort;
  }

  part def MethaloxDescentEngine {
    attribute maxThrust : ThrustKn = 44.5;
    attribute specificImpulseSec = 362.0;
    port controlIn : ~GimbalActuationPort;
  }

  part def LunarDescentStage {
    part lidarHazardScanner : TerrainRelativeNavSensor[2];
    part tripleRedundantFcc : DescentFlightComputer[3];
    part mainEngines : MethaloxDescentEngine[3];

    connect lidarHazardScanner.trnOut to tripleRedundantFcc.sensorIn;
    connect tripleRedundantFcc.engineCmd to mainEngines.controlIn;
  }

  requirement def <'REQ-LND-001'> SafeTouchdownVelocityReq {
    doc /* Touchdown vertical sink rate shall not exceed 1.5 m/s and lateral drift shall be < 0.4 m/s on slopes up to 12 deg. */
  }

  requirement def <'REQ-LND-002'> HazardDivertCapabilityReq {
    doc /* The GNC subsystem shall execute a 120m autonomous lateral hazard divert at 150m altitude with >= 8.5% propellant margin. */
  }

  requirement def <'REQ-LND-003'> DualFaultToleranceReq {
    doc /* Triple-modular redundant flight computers shall survive any single Byzantinesensor fault with zero thruster glitch. */
  }
}`,
    extraViewConfig: {
      format: "SysML2",
      systemName: "ArtemisLunarLanderGNC",
      standalone: true,
      parts: [
        {
          name: "lidarHazardScanner",
          type: "TerrainRelativeNavSensor",
          multiplicity: "2",
          ports: ["trnOut : SpaceWireTelemetryPort"],
          description: "Dual coherent Doppler LiDAR & optical terrain relative navigation sensors",
        },
        {
          name: "tripleRedundantFcc",
          type: "DescentFlightComputer",
          multiplicity: "3",
          ports: ["sensorIn : ~SpaceWireTelemetryPort", "engineCmd : GimbalActuationPort"],
          description: "RAD750 triple-modular redundant convex-guidance flight computers",
        },
        {
          name: "mainEngines",
          type: "MethaloxDescentEngine",
          multiplicity: "3",
          ports: ["controlIn : ~GimbalActuationPort"],
          description: "Deep-throttling 44.5 kN LOX/CH4 gimbaled descent engines (5:1 throttle ratio)",
        },
      ],
      connections: [
        {
          source: "lidarHazardScanner.trnOut",
          target: "tripleRedundantFcc.sensorIn",
          flowType: "SpaceWireTelemetryPort",
        },
        {
          source: "tripleRedundantFcc.engineCmd",
          target: "mainEngines.controlIn",
          flowType: "GimbalActuationPort",
        },
      ],
      requirements: [
        {
          id: "REQ-LND-001",
          name: "SafeTouchdownVelocityReq",
          text: "Touchdown vertical sink rate <= 1.5 m/s and lateral drift < 0.4 m/s on 12 deg lunar regolith slope.",
          status: "verified",
        },
        {
          id: "REQ-LND-002",
          name: "HazardDivertCapabilityReq",
          text: "Autonomous 120m lateral hazard divert at 150m altitude with >= 8.5% propellant reserve.",
          status: "satisfied",
        },
        {
          id: "REQ-LND-003",
          name: "DualFaultToleranceReq",
          text: "TMR flight computers survive Byzantine sensor fault with zero thruster transient.",
          status: "verified",
        },
      ],
    },
    comments: [
      {
        author: "sofia_rossi",
        content:
          "Having `REQ-LND-002` directly linked to our CCSDS NRHO-to-surface ephemeris propagation makes end-to-end propellant margin audits so much cleaner.",
      },
      {
        author: "vikram_patel",
        content:
          "We verified the 5:1 deep-throttling transient on `MethaloxDescentEngine` in ROCETS—chug stability margin stays above 18% down to 9 kN thrust.",
      },
    ],
    likedBy: ["omar", "sofia_rossi", "vikram_patel", "elena_vance", "alex_rivera", "lukas_weber", "hannah_becker"],
    repostedBy: ["sofia_rossi", "omar"],
    bookmarkedBy: ["omar", "sofia_rossi"],
  },

  // 4. ssp
  {
    languageId: "ssp",
    author: "lukas_weber",
    title: "EVThermalManagementSystem — FMI 3.0 / SSP 1.0 Co-Simulation Topology",
    filename: "EVThermalManagementSystem.ssd",
    viewType: "ssp",
    hoursAgo: 9,
    postContent:
      "Uploaded the SSP 1.0 (`SystemStructure.ssd`) co-simulation harness for our 800V Electric Vehicle Integrated Thermal Management System. Couples 4 FMI 3.0 Co-Simulation FMUs: Solid-State 110 kWh Battery Pack, SiC Rear eDrive Inverter/Motor, R290 Heat Pump Chiller, and Dual-Zone Cabin HVAC with 2 ms master communication step. #ssp #fmi3 #cosimulation #ev #thermalmanagement",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"
  name="EVThermalManagementSystem" version="1.0">
  <ssd:System name="EV_800V_Thermal_Harness" description="Integrated 800V Battery, eDrive &amp; R290 Heat Pump Co-Simulation">
    <ssd:Elements>
      <ssd:Component name="BatteryPack800V" type="application/x-fmu-sharedlibrary" source="resources/BatteryPack800V.fmu">
        <ssd:Connectors>
          <ssd:Connector name="q_heat_loss_W" kind="output"/>
          <ssd:Connector name="T_coolant_in_K" kind="input"/>
          <ssd:Connector name="T_cell_max_K" kind="output"/>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="SiC_eDrive_Unit" type="application/x-fmu-sharedlibrary" source="resources/SiC_eDrive_Unit.fmu">
        <ssd:Connectors>
          <ssd:Connector name="q_inverter_loss_W" kind="output"/>
          <ssd:Connector name="T_glycol_in_K" kind="input"/>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="R290_HeatPump_Chiller" type="application/x-fmu-sharedlibrary" source="resources/R290_HeatPump_Chiller.fmu">
        <ssd:Connectors>
          <ssd:Connector name="q_batt_load_W" kind="input"/>
          <ssd:Connector name="q_edrive_load_W" kind="input"/>
          <ssd:Connector name="T_chiller_supply_K" kind="output"/>
          <ssd:Connector name="T_cabin_supply_K" kind="output"/>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="CabinHvacZone" type="application/x-fmu-sharedlibrary" source="resources/CabinHvacZone.fmu">
        <ssd:Connectors>
          <ssd:Connector name="T_air_supply_K" kind="input"/>
          <ssd:Connector name="T_cabin_comfort_K" kind="output"/>
        </ssd:Connectors>
      </ssd:Component>
    </ssd:Elements>
    <ssd:Connections>
      <ssd:Connection startElement="BatteryPack800V" startConnector="q_heat_loss_W" endElement="R290_HeatPump_Chiller" endConnector="q_batt_load_W"/>
      <ssd:Connection startElement="SiC_eDrive_Unit" startConnector="q_inverter_loss_W" endElement="R290_HeatPump_Chiller" endConnector="q_edrive_load_W"/>
      <ssd:Connection startElement="R290_HeatPump_Chiller" startConnector="T_chiller_supply_K" endElement="BatteryPack800V" endConnector="T_coolant_in_K"/>
      <ssd:Connection startElement="R290_HeatPump_Chiller" startConnector="T_chiller_supply_K" endElement="SiC_eDrive_Unit" endConnector="T_glycol_in_K"/>
      <ssd:Connection startElement="R290_HeatPump_Chiller" startConnector="T_cabin_supply_K" endElement="CabinHvacZone" endConnector="T_air_supply_K"/>
    </ssd:Connections>
  </ssd:System>
</ssd:SystemStructureDescription>`,
    extraViewConfig: {
      systemName: "EV_800V_Thermal_Harness",
      standalone: true,
      fmuComponents: [
        {
          name: "BatteryPack800V",
          source: "resources/BatteryPack800V.fmu",
          inputs: ["T_coolant_in_K"],
          outputs: ["q_heat_loss_W", "T_cell_max_K"],
        },
        {
          name: "SiC_eDrive_Unit",
          source: "resources/SiC_eDrive_Unit.fmu",
          inputs: ["T_glycol_in_K"],
          outputs: ["q_inverter_loss_W"],
        },
        {
          name: "R290_HeatPump_Chiller",
          source: "resources/R290_HeatPump_Chiller.fmu",
          inputs: ["q_batt_load_W", "q_edrive_load_W"],
          outputs: ["T_chiller_supply_K", "T_cabin_supply_K"],
        },
        {
          name: "CabinHvacZone",
          source: "resources/CabinHvacZone.fmu",
          inputs: ["T_air_supply_K"],
          outputs: ["T_cabin_comfort_K"],
        },
      ],
      connections: [
        {
          startElement: "BatteryPack800V",
          startConnector: "q_heat_loss_W",
          endElement: "R290_HeatPump_Chiller",
          endConnector: "q_batt_load_W",
        },
        {
          startElement: "SiC_eDrive_Unit",
          startConnector: "q_inverter_loss_W",
          endElement: "R290_HeatPump_Chiller",
          endConnector: "q_edrive_load_W",
        },
        {
          startElement: "R290_HeatPump_Chiller",
          startConnector: "T_chiller_supply_K",
          endElement: "BatteryPack800V",
          endConnector: "T_coolant_in_K",
        },
        {
          startElement: "R290_HeatPump_Chiller",
          startConnector: "T_cabin_supply_K",
          endElement: "CabinHvacZone",
          endConnector: "T_air_supply_K",
        },
      ],
    },
    comments: [
      {
        author: "elena_vance",
        content:
          "Scavenging waste heat from `SiC_eDrive_Unit` into the R290 chiller evaporator during -15°C cold soak improved cabin warm-up time by 38% in our co-sim run!",
      },
      {
        author: "alice",
        content:
          "Tested the SSP container import in the web co-simulation orchestrator—all 5 signal connections bound cleanly with zero algebraic loop warnings.",
      },
    ],
    likedBy: ["omar", "elena_vance", "claire_dubois", "alice", "bob", "alex_rivera"],
    repostedBy: ["elena_vance"],
  },

  // 5. owl2
  {
    languageId: "owl2",
    author: "hannah_becker",
    title: "CyberPhysicalAssetOntology — ISO 15926 / SAREF OWL 2 Functional Ontology",
    filename: "CyberPhysicalAssetOntology.ofn",
    viewType: "owl2",
    hoursAgo: 12,
    postContent:
      "Published the OWL 2 Functional Syntax ontology (`CyberPhysicalAssetOntology.ofn`) aligning ISO 15926 process plant assets, SAREF smart sensors, and ModelScript Digital Twin telemetry streams. Verified DL consistency and unsatisfiable class absence using our tableau reasoner. #owl2 #ontology #semanticweb #digitaltwin #iso15926",
    code: `Prefix(:=<https://modelscript.org/ontologies/cps-asset#>)
Prefix(owl:=<http://www.w3.org/2002/07/owl#>)
Prefix(rdf:=<http://www.w3.org/1999/02/22-rdf-syntax-ns#>)
Prefix(xsd:=<http://www.w3.org/2001/XMLSchema#>)
Prefix(rdfs:=<http://www.w3.org/2000/01/rdf-schema#>)

Ontology(<https://modelscript.org/ontologies/cps-asset>
  Declaration(Class(:CyberPhysicalAsset))
  Declaration(Class(:RotatingMachinery))
  Declaration(Class(:CentrifugalCompressor))
  Declaration(Class(:SynchronousGenerator))
  Declaration(Class(:TelemetrySensor))
  Declaration(Class(:VibrationAccelerometer))
  Declaration(Class(:DigitalTwinInstance))
  Declaration(ObjectProperty(:hasSensor))
  Declaration(ObjectProperty(:monitorsAsset))
  Declaration(ObjectProperty(:synchronizedWithTwin))

  SubClassOf(:RotatingMachinery :CyberPhysicalAsset)
  SubClassOf(:CentrifugalCompressor :RotatingMachinery)
  SubClassOf(:SynchronousGenerator :RotatingMachinery)
  SubClassOf(:VibrationAccelerometer :TelemetrySensor)

  DisjointClasses(:RotatingMachinery :TelemetrySensor :DigitalTwinInstance)
  InverseObjectProperties(:hasSensor :monitorsAsset)
  ObjectPropertyDomain(:hasSensor :CyberPhysicalAsset)
  ObjectPropertyRange(:hasSensor :TelemetrySensor)
  ObjectPropertyDomain(:synchronizedWithTwin :CyberPhysicalAsset)
  ObjectPropertyRange(:synchronizedWithTwin :DigitalTwinInstance)

  Declaration(NamedIndividual(:NorthSeaCompressor_A101))
  ClassAssertion(:CentrifugalCompressor :NorthSeaCompressor_A101)
  Declaration(NamedIndividual(:BearingVibSensor_XE402))
  ClassAssertion(:VibrationAccelerometer :BearingVibSensor_XE402)
  ObjectPropertyAssertion(:hasSensor :NorthSeaCompressor_A101 :BearingVibSensor_XE402)
)`,
    extraViewConfig: {
      ontologyIri: "https://modelscript.org/ontologies/cps-asset",
      classCount: 7,
      propertyCount: 3,
      individualCount: 2,
      axiomCount: 19,
      standalone: true,
    },
    comments: [
      {
        author: "astrid_solberg",
        content:
          "Mapping `:NorthSeaCompressor_A101` directly to our OLGA & LPS compressor surge margin telemetry via SPARQL queries is a huge win for offshore digital threads.",
      },
    ],
    likedBy: ["omar", "claire_dubois", "astrid_solberg", "priya_nair", "nadia_almansoor"],
    bookmarkedBy: ["claire_dubois"],
  },

  // 6. reqif
  {
    languageId: "reqif",
    author: "claire_dubois",
    title: "FlightControlDAL_A — OMG ReqIF 1.2 Primary Flight Control Requirements",
    filename: "FlightControlDAL_A.reqif",
    viewType: "reqif",
    hoursAgo: 15,
    postContent:
      "Shared the OMG ReqIF 1.2 (`FlightControlDAL_A.reqif`) interchange baseline for our DO-178C DAL-A Primary Flight Control System. Every `SPEC-OBJECT` embeds formal LTL/metric contract expressions that ModelScript's requirement verifier checks directly against Modelica & Simulink trajectories. #reqif #do178c #requirements #mbse #formalverification",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="HDR-FCS-DAL-A">
      <COMMENT>DO-178C DAL-A Primary Flight Control System Requirements Baseline</COMMENT>
      <TITLE>Primary Flight Control System (PFCS) Formal Specification</TITLE>
    </REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-FCS-014" LONG-NAME="Aileron EHA Step Response Bandwidth">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="The Electro-Hydrostatic Actuator shall achieve 90% of a 35mm step command within 180 ms under an 18.5 kN aerodynamic hinge moment with overshoot <= 2.5%."/>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-FCS-028" LONG-NAME="Pitch Rate Command Augmentation Phase Margin">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="The longitudinal C* pitch rate loop shall maintain >= 45 deg phase margin and >= 6 dB gain margin across Mach 0.2 to Mach 0.92."/>
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-FCS-041" LONG-NAME="Triple-Redundant Sensor Voter Fault Isolation">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="The mid-value voter shall isolate a hard-over rate gyro fault within 2 minor frames (2.0 ms) with transient pitch acceleration < 0.05 g."/>
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPEC-RELATIONS>
        <SPEC-RELATION IDENTIFIER="REL-01" SOURCE="REQ-FCS-014" TARGET="REQ-FCS-028"/>
        <SPEC-RELATION IDENTIFIER="REL-02" SOURCE="REQ-FCS-028" TARGET="REQ-FCS-041"/>
      </SPEC-RELATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`,
    extraViewConfig: {
      dialect: "reqif",
      standalone: true,
      nodeCount: 3,
      connectionCount: 2,
    },
    comments: [
      {
        author: "alex_rivera",
        content:
          "Verified `REQ-FCS-041` against our Simulink triple-redundant autoland voter model—fault isolation triggers in 1.6 ms with 0.028 g peak transient.",
      },
    ],
    likedBy: ["omar", "elena_vance", "alex_rivera", "sofia_rossi", "lukas_weber"],
  },

  // 7. autosar
  {
    languageId: "autosar",
    author: "lukas_weber",
    title: "ZonalBrakeByWireComposition — AUTOSAR R23-11 ARXML Software Architecture",
    filename: "ZonalBrakeByWireComposition.arxml",
    viewType: "autosar",
    hoursAgo: 18,
    postContent:
      "Published the AUTOSAR Classic/Adaptive R23-11 `.arxml` software component composition for our ASIL-D Zonal Brake-by-Wire architecture. Connects PedalFeelSimulatorSwc, VehicleStabilityArbitratorSwc, regenerative eDrive torque blending, and 4 corner Electro-Mechanical Brake (EMB) smart actuator SWCs with 1 ms runnable timing constraints. #autosar #arxml #automotive #asild #brakebywire",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0">
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>ChassisBrakeByWirePkg</SHORT-NAME>
      <ELEMENTS>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>PedalFeelSensorSwc</SHORT-NAME>
        </APPLICATION-SW-COMPONENT-TYPE>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>BrakeTorqueArbitratorSwc</SHORT-NAME>
        </APPLICATION-SW-COMPONENT-TYPE>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>RegenBlendingCoordinatorSwc</SHORT-NAME>
        </APPLICATION-SW-COMPONENT-TYPE>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>CornerEmbActuatorSwc</SHORT-NAME>
        </APPLICATION-SW-COMPONENT-TYPE>
        <COMPOSITION-SW-COMPONENT-TYPE>
          <SHORT-NAME>ZonalBrakeByWireComposition</SHORT-NAME>
          <COMPONENTS>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>PedalDualChannel</SHORT-NAME>
              <TYPE-TREF DEST="APPLICATION-SW-COMPONENT-TYPE">/ChassisBrakeByWirePkg/PedalFeelSensorSwc</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>CentralBrakeArbitrator</SHORT-NAME>
              <TYPE-TREF DEST="APPLICATION-SW-COMPONENT-TYPE">/ChassisBrakeByWirePkg/BrakeTorqueArbitratorSwc</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>RegenTorqueBlender</SHORT-NAME>
              <TYPE-TREF DEST="APPLICATION-SW-COMPONENT-TYPE">/ChassisBrakeByWirePkg/RegenBlendingCoordinatorSwc</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
            <SW-COMPONENT-PROTOTYPE>
              <SHORT-NAME>FrontLeftEmbCorner</SHORT-NAME>
              <TYPE-TREF DEST="APPLICATION-SW-COMPONENT-TYPE">/ChassisBrakeByWirePkg/CornerEmbActuatorSwc</TYPE-TREF>
            </SW-COMPONENT-PROTOTYPE>
          </COMPONENTS>
        </COMPOSITION-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`,
    extraViewConfig: {
      dialect: "autosar",
      standalone: true,
      componentCount: 4,
    },
    comments: [
      {
        author: "kenji_takahashi",
        content:
          "Clean separation between `RegenTorqueBlender` and `CornerEmbActuatorSwc`. Makes ABS slip regulation during regenerative cut-out deterministic.",
      },
    ],
    likedBy: ["omar", "kenji_takahashi", "alex_rivera", "claire_dubois", "elena_vance"],
  },
];

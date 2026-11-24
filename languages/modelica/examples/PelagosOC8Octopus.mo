// SPDX-License-Identifier: AGPL-3.0-or-later

model PelagosOC8SubseaOctopus "Pelagos OC-8 8-arm subsea robotic octopus — coupled multi-body + 7-piston swashplate fluid siphon starter template"

  // ── Acausal Physical Connectors ──────────────────────────────────────────

  connector FluidPort "Acausal incompressible seawater hydraulic port"
    Real p "Static seawater pressure [Pa]";
    flow Real m_flow "Seawater mass flow rate into component [kg/s]";
  end FluidPort;

  connector RotationalShaft "Acausal 1D rotational drive flange for the 7-piston swashplate shaft"
    Real phi "Shaft rotation angle [rad]";
    flow Real tau "Shaft torque into component [N*m]";
  end RotationalShaft;

  connector SurgeFlange "Acausal 1D multi-body hydrodynamic surge coupling (swim axis)"
    Real s "Forward surge displacement [m]";
    flow Real f "Axial propulsion / reaction force [N]";
  end SurgeFlange;

  connector HeaveFlange "Acausal 1D multi-body hydrodynamic heave coupling (depth axis)"
    Real z "Subsea operating depth below surface [m]";
    flow Real f_z "Vertical ballast / heave force [N]";
  end HeaveFlange;

  connector ArmMountFlange "Acausal multi-body arm-to-mantle roll torque coupling (supports Arm 3 magnetic detach)"
    Real roll "Mantle roll attitude angle [rad]";
    flow Real tau_roll "Net arm-chain roll reaction torque on mantle [N*m]";
  end ArmMountFlange;

  // ── Subsystem Models ─────────────────────────────────────────────────────

  model SeawaterIntake "Ambient hydrostatic seawater intake boundary"
    FluidPort port_out "Suction outlet to 7-piston swashplate pump";
    input Real depthM "Instantaneous vehicle depth [m]";
    parameter Real p_atm = 101325.0 "Sea-level atmospheric pressure [Pa]";
    parameter Real rhoSea = 1025.0 "Ambient seawater density [kg/m3]";
    parameter Real g = 9.81 "Gravitational acceleration [m/s2]";
  equation
    port_out.p = p_atm + rhoSea * g * max(0.0, depthM);
  end SeawaterIntake;

  model BrushlessPumpDrive "Servo-regulated brushless swashplate pump motor drive"
    RotationalShaft flange "Mechanical shaft output flange";
    input Real omegaCmd "Target swashplate angular speed [rad/s]";
    parameter Real J_motor = 0.004 "Motor rotor inertia [kg*m2]";
    parameter Real Kp_speed = 0.28 "Proportional shaft speed controller gain [N*m*s/rad]";
    parameter Real tau_max = 18.0 "Peak brushless motor torque limit [N*m]";
    Real omega(start = 47.12, fixed = true) "Motor shaft angular speed [rad/s]";
    Real tau_em "Electromagnetic drive torque [N*m]";
    Real elecPowerW "Electrical drive power [W]";
  equation
    omega = der(flange.phi);
    tau_em = max(-tau_max, min(tau_max, Kp_speed * (omegaCmd - omega)));
    J_motor * der(omega) = tau_em + flange.tau;
    elecPowerW = abs(tau_em * omega);
  end BrushlessPumpDrive;

  model SwashplatePump7Piston "Internal 7-piston axial swashplate seawater pump with core thermal balance"
    FluidPort port_in "Ambient seawater suction port";
    FluidPort port_out "Pressurized discharge manifold to siphon nozzle";
    RotationalShaft shaft "Mechanical drive input from brushless motor";

    parameter Integer nPistons = 7 "Axial piston cylinder count";
    parameter Real swashplateTiltRad = 0.28 "Swashplate tilt angle [rad]";
    parameter Real pitchRadius = 0.042 "Piston pitch-circle radius [m]";
    parameter Real pistonArea = 5.5e-4 "Individual piston bore area [m2]";
    parameter Real etaVol = 0.94 "Volumetric efficiency";
    parameter Real rhoSea = 1025.0 "Seawater density [kg/m3]";
    parameter Real J_barrel = 0.004 "Cylinder barrel inertia [kg*m2]";
    parameter Real b_viscous = 0.0022 "Rotary viscous friction [N*m*s/rad]";
    parameter Real T_seaC = 18.0 "Ambient seawater temperature [degC]";
    parameter Real C_pump = 28.0 "Pump core thermal capacitance [J/K]";
    parameter Real G_hull = 12.0 "Mantle-to-seawater thermal conductance [W/K]";

    Real theta(start = 0.0, fixed = true) "Swashplate barrel rotation angle [rad]";
    Real omega(start = 47.12, fixed = true) "Swashplate angular speed [rad/s]";
    Real tempC(start = 23.0, fixed = true) "7-piston pump core temperature [degC]";
    Real strokeAmp "Single-piston axial stroke amplitude [m]";
    Real piston1Disp "Piston 1 axial stroke displacement [m]";
    Real piston2Disp "Piston 2 axial stroke displacement [m]";
    Real piston3Disp "Piston 3 axial stroke displacement [m]";
    Real piston4Disp "Piston 4 axial stroke displacement [m]";
    Real piston5Disp "Piston 5 axial stroke displacement [m]";
    Real piston6Disp "Piston 6 axial stroke displacement [m]";
    Real piston7Disp "Piston 7 axial stroke displacement [m]";
    Real flowRate "Volumetric seawater discharge rate [m3/s]";
    Real flowLpm "Volumetric seawater discharge rate [L/min]";
    Real deltaP "Discharge pressure rise across pump [Pa]";
    Real hydraulicPowerW "Delivered fluid hydraulic power [W]";
    Real heatLossW "Viscous & motor Joule heat dissipation [W]";
  equation
    shaft.phi = theta;
    der(theta) = omega;

    // 7-piston axial swashplate kinematics (2*pi/7 = 0.8975979 rad spacing)
    strokeAmp = pitchRadius * tan(swashplateTiltRad);
    piston1Disp = strokeAmp * sin(theta + 0.0000000);
    piston2Disp = strokeAmp * sin(theta + 0.8975979);
    piston3Disp = strokeAmp * sin(theta + 1.7951958);
    piston4Disp = strokeAmp * sin(theta + 2.6927937);
    piston5Disp = strokeAmp * sin(theta + 3.5903916);
    piston6Disp = strokeAmp * sin(theta + 4.4879895);
    piston7Disp = strokeAmp * sin(theta + 5.3855874);

    // Positive-displacement mass conservation
    flowRate = max(0.0, etaVol * nPistons * pistonArea * (2.0 * strokeAmp) * (omega / (2.0 * 3.14159265)));
    flowLpm = flowRate * 60000.0;
    port_in.m_flow = rhoSea * flowRate;
    port_in.m_flow + port_out.m_flow = 0.0;

    // Hydraulic load torque & thermal core balance
    deltaP = max(0.0, port_out.p - port_in.p);
    hydraulicPowerW = flowRate * deltaP;
    J_barrel * der(omega) = shaft.tau - b_viscous * omega - hydraulicPowerW / max(1.0, omega);

    heatLossW = 42.0 + 0.35 * hydraulicPowerW + 0.0018 * omega * omega;
    C_pump * der(tempC) = heatLossW - G_hull * (tempC - T_seaC);
  end SwashplatePump7Piston;

  model SiphonJetNozzle "Vectored siphon water-jet thruster nozzle (2.68 m/s peak, 6.0 N burst)"
    FluidPort port_in "Pressurized seawater supply from 7-piston pump";
    SurgeFlange flange_hull "Mechanical reaction thrust transmitted to mantle hull";
    input Real depthM "Vehicle operating depth for ambient back-pressure [m]";

    parameter Real nozzleArea = 8.15e-4 "Convergent siphon nozzle exit area [m2]";
    parameter Real Cd_nozzle = 0.96 "Nozzle discharge coefficient";
    parameter Real p_atm = 101325.0 "Sea-level atmospheric pressure [Pa]";
    parameter Real rhoSea = 1025.0 "Ambient seawater density [kg/m3]";
    parameter Real g = 9.81 "Gravitational acceleration [m/s2]";
    parameter Real maxJetVelocity = 2.68 "Peak rated siphon exit velocity [m/s]";
    parameter Real maxThrust = 6.0 "Peak rated siphon burst thrust [N]";

    Real p_amb "Ambient seawater static pressure at nozzle exit [Pa]";
    Real Q_jet "Nozzle volumetric jet discharge [m3/s]";
    Real jetVelocity "Siphon nozzle exit jet velocity [m/s]";
    Real thrust "Water-jet momentum thrust [N]";
    Real jetLoad "Normalized propulsion load [%]";
    Real jetLoadFrac "Normalized propulsion load fraction [0..1]";
  equation
    p_amb = p_atm + rhoSea * g * max(0.0, depthM);
    Q_jet = max(0.0, port_in.m_flow / rhoSea);
    jetVelocity = min(maxJetVelocity, Q_jet / nozzleArea);

    // Bernoulli convergent nozzle pressure drop
    port_in.p - p_amb = 0.5 * rhoSea * (jetVelocity / Cd_nozzle) * (jetVelocity / Cd_nozzle);

    // Momentum jet reaction force applied acausally to hull surge flange
    thrust = min(maxThrust, port_in.m_flow * jetVelocity);
    flange_hull.f = -thrust;
    jetLoadFrac = thrust / maxThrust;
    jetLoad = 100.0 * jetLoadFrac;
  end SiphonJetNozzle;

  model BallastDepthActuator "Hydrostatic variable-buoyancy ballast trim actuator"
    HeaveFlange flange_heave "Vertical ballast force applied to mantle hull";
    input Real depthTarget "Commanded dive depth setpoint [m]";
    parameter Real k_depth = 38.0 "Ballast depth-hold proportional gain [N/m]";
  equation
    flange_heave.f_z = -k_depth * (depthTarget - flange_heave.z);
  end BallastDepthActuator;

  model MantleRigidBody "Coupled 4-DOF ceramic mantle multi-body hull (surge, heave, pitch, roll)"
    SurgeFlange flange_surge "Siphon water-jet axial propulsion flange";
    HeaveFlange flange_heave "Variable-buoyancy ballast vertical flange";
    ArmMountFlange flange_arms "8-arm multi-body reaction coupling flange";

    parameter Real m_hull = 6.2 "Dry + flooded ceramic mantle structural mass [kg]";
    parameter Real m_added_x = 1.6 "Hydrodynamic surge added mass [kg]";
    parameter Real m_added_z = 8.3 "Hydrodynamic heave added mass [kg]";
    parameter Real CdA_surge = 0.00163 "Streamlined surge drag area (6.0 N at 2.68 m/s) [m2]";
    parameter Real rhoSea = 1025.0 "Ambient seawater density [kg/m3]";
    parameter Real c_heave = 36.0 "Vertical hydrodynamic heave damping [N*s/m]";
    parameter Real I_pitch = 0.42 "Mantle pitch inertia [kg*m2]";
    parameter Real k_pitch = 3.2 "Hydrostatic righting pitch stiffness [N*m/rad]";
    parameter Real d_pitch = 1.8 "Hydrodynamic pitch damping [N*m*s/rad]";
    parameter Real I_roll = 0.36 "Mantle roll inertia [kg*m2]";
    parameter Real k_roll = 2.8 "Hydrostatic righting roll stiffness [N*m/rad]";
    parameter Real d_roll = 1.5 "Hydrodynamic roll damping [N*m*s/rad]";

    Real x(start = 0.0, fixed = true) "Surge travel distance [m]";
    Real vx(start = 0.25, fixed = true) "Forward swim velocity [m/s]";
    Real z(start = 4.0, fixed = true) "Subsea operating depth [m]";
    Real vz(start = 0.0, fixed = true) "Vertical dive/ascent velocity [m/s]";
    Real pitch(start = 0.0, fixed = true) "Pitch attitude angle [rad]";
    Real q_pitch(start = 0.0, fixed = true) "Pitch angular rate [rad/s]";
    Real roll(start = 0.0, fixed = true) "Roll attitude angle [rad]";
    Real p_roll(start = 0.0, fixed = true) "Roll angular rate [rad/s]";
    Real pitchDeg "Pitch attitude angle [deg]";
    Real rollDeg "Roll attitude angle [deg]";
  equation
    flange_surge.s = x;
    flange_heave.z = z;
    flange_arms.roll = roll;

    // Coupled surge propulsion vs quadratic hydrodynamic drag
    der(x) = vx;
    (m_hull + m_added_x) * der(vx) = flange_surge.f - 0.5 * rhoSea * CdA_surge * vx * abs(vx);

    // Coupled heave ballast dynamics
    der(z) = vz;
    (m_hull + m_added_z) * der(vz) = flange_heave.f_z - c_heave * vz;

    // Coupled pitch & roll rigid-body dynamics (with siphon pitch moment & arm roll reaction)
    der(pitch) = q_pitch;
    I_pitch * der(q_pitch) = 0.095 * flange_surge.f - 0.14 * vz - k_pitch * pitch - d_pitch * q_pitch;

    der(roll) = p_roll;
    I_roll * der(p_roll) = flange_arms.tau_roll - k_roll * roll - d_roll * p_roll;

    pitchDeg = pitch * 57.2957795;
    rollDeg = roll * 57.2957795;
  end MantleRigidBody;

  model ArticulatedArmBank "8 independent robotic arm chains (202 links, 489 wheels) with autonomous Arm 3 magnetic detach"
    ArmMountFlange flange_mantle "Mechanical roll reaction flange attached to ceramic mantle";
    input Real jetLoadFrac "Normalized siphon burst load fraction [0..1]";
    input Real arm3DetachCmd "Autonomous Arm 3 collar release command (1=detach, 0=dock)";

    parameter Integer nArms = 8 "Independently articulated robotic arm count";
    parameter Integer nSegments = 202 "Total linked arm segments (2*26 + 6*25)";
    parameter Integer nWheels = 489 "Total traction rollers (404 ventral + 85 dorsal)";
    parameter Real tau_arm = 0.32 "Tendon curl actuation lag [s]";
    parameter Real tau_collar = 0.40 "Magnetic collar separation/docking time constant [s]";
    parameter Real detachSpanM = 0.24 "Free-floating Arm 3 sampling separation distance [m]";

    Real arm1Curl(start = 70.0, fixed = true) "Arm 1 curl actuation [%]";
    Real arm2Curl(start = 84.0, fixed = true) "Arm 2 curl actuation [%]";
    Real arm3Curl(start = 87.0, fixed = true) "Arm 3 curl actuation (autonomous specimen arm) [%]";
    Real arm4Curl(start = 76.0, fixed = true) "Arm 4 curl actuation [%]";
    Real arm5Curl(start = 60.0, fixed = true) "Arm 5 curl actuation [%]";
    Real arm6Curl(start = 52.0, fixed = true) "Arm 6 curl actuation [%]";
    Real arm7Curl(start = 57.0, fixed = true) "Arm 7 curl actuation [%]";
    Real arm8Curl(start = 73.0, fixed = true) "Arm 8 curl actuation [%]";
    Real arm3DetachOffset(start = 0.0, fixed = true) "Arm 3 collar separation distance [m]";
    Real arm3Attached "Arm 3 magnetic collar status (1=docked, 0=detached)";
  equation
    arm3Attached = if arm3DetachCmd > 0.5 then 0.0 else 1.0;
    tau_collar * der(arm3DetachOffset) = arm3DetachCmd * detachSpanM - arm3DetachOffset;

    // 8 independent biomimetic arm curl trajectories with jet-burst hydrodynamic tuck
    tau_arm * der(arm1Curl) = (70.0 + 18.0 * sin(1.35 * time + 0.00) - 28.0 * jetLoadFrac) - arm1Curl;
    tau_arm * der(arm2Curl) = (70.0 + 18.0 * sin(1.35 * time + 0.92) - 28.0 * jetLoadFrac) - arm2Curl;
    tau_arm * der(arm3Curl) = (if arm3Attached < 0.5 then 88.0 + 8.0 * sin(2.40 * time)
                               else 70.0 + 18.0 * sin(1.35 * time + 1.84) - 28.0 * jetLoadFrac) - arm3Curl;
    tau_arm * der(arm4Curl) = (70.0 + 18.0 * sin(1.35 * time + 2.76) - 28.0 * jetLoadFrac) - arm4Curl;
    tau_arm * der(arm5Curl) = (70.0 + 18.0 * sin(1.35 * time + 3.68) - 28.0 * jetLoadFrac) - arm5Curl;
    tau_arm * der(arm6Curl) = (70.0 + 18.0 * sin(1.35 * time + 4.60) - 28.0 * jetLoadFrac) - arm6Curl;
    tau_arm * der(arm7Curl) = (70.0 + 18.0 * sin(1.35 * time + 5.52) - 28.0 * jetLoadFrac) - arm7Curl;
    tau_arm * der(arm8Curl) = (70.0 + 18.0 * sin(1.35 * time + 6.44) - 28.0 * jetLoadFrac) - arm8Curl;

    // Asymmetric roll reaction torque when Arm 3 detaches from the port-side collar
    flange_mantle.tau_roll = -(0.22 * sin(0.95 * time) - 0.34 * (1.0 - arm3Attached));
  end ArticulatedArmBank;

  model MissionAutonomyController "25-second 4-phase subsea mission sequencer (Dive, Arm 3 Detach, Jet Burst, Surface)"
    output Real omegaPumpCmd "Commanded 7-piston swashplate speed [rad/s]";
    output Real depthTarget "Commanded mission operating depth [m]";
    output Real arm3DetachCmd "Arm 3 magnetic collar detach trigger (1=detach, 0=dock)";
    output Real missionPhase "Active phase index (0=DIVE, 1=DETACH, 2=JET, 3=SURFACE)";

    parameter Real detachStartTime = 6.0 "Arm 3 magnetic collar release time [s]";
    parameter Real reconnectTime = 12.8 "Arm 3 inductive dock reconnect time [s]";
    parameter Real burstStartTime = 13.0 "Siphon jet-assist burst start time [s]";
    parameter Real burstEndTime = 20.0 "Siphon jet-assist burst end time [s]";
    parameter Real omegaPumpCruise = 47.12 "Cruise pump speed (450 RPM) [rad/s]";
    parameter Real omegaPumpBurst = 164.0 "Burst pump speed (1566 RPM) [rad/s]";
  equation
    omegaPumpCmd = if (time >= burstStartTime) and (time <= burstEndTime)
                   then omegaPumpBurst * (0.96 + 0.04 * sin(6.0 * time))
                   else (if time > burstEndTime then 24.0 else omegaPumpCruise);

    arm3DetachCmd = if (time >= detachStartTime) and (time <= reconnectTime) then 1.0 else 0.0;

    depthTarget = if time < detachStartTime then 4.0 + 34.0 * (time / detachStartTime)
                  else (if time < burstStartTime then 38.0
                  else (if time < burstEndTime then 38.0 - 14.0 * ((time - burstStartTime) / (burstEndTime - burstStartTime))
                  else 24.0 - 20.0 * ((time - burstEndTime) / 5.0)));

    missionPhase = if time < detachStartTime then 0.0
                   else (if time < burstStartTime then 1.0
                   else (if time < burstEndTime then 2.0 else 3.0));
  end MissionAutonomyController;

  // ── System-Level Mechanical Inventory Parameters ─────────────────────────

  parameter Integer nArms = 8 "Independently articulated robotic arms";
  parameter Integer nSegments = 202 "Total linked arm segments (2*26 + 6*25)";
  parameter Integer nWheels = 489 "Ventral (404) + dorsal (85) traction rollers";
  parameter Integer nPistons = 7 "Internal axial swashplate pump cylinders";
  parameter Real maxJetVelocity = 2.68 "Peak siphon water-jet velocity [m/s]";
  parameter Real maxThrust = 6.0 "Peak siphon burst thrust [N]";

  // ── Connected Multi-Body + Fluid Siphon Subsystem Instances ──────────────

  MissionAutonomyController mission
    annotation(Placement(transformation(extent = {{-96, 36}, {-64, 68}})));

  SeawaterIntake intake
    annotation(Placement(transformation(extent = {{-96, -18}, {-68, 10}})));

  BrushlessPumpDrive motor
    annotation(Placement(transformation(extent = {{-44, 36}, {-16, 64}})));

  SwashplatePump7Piston pump
    annotation(
      Placement(transformation(extent = {{-44, -20}, {-12, 12}})),
      CAD(uri = "procedural://pelagos-oc8/pump-core", position = {0, 0.07, 0}, scale = {0.11, 0.12, 0.11})
    );

  SiphonJetNozzle siphon
    annotation(
      Placement(transformation(extent = {{10, -20}, {42, 12}})),
      CAD(uri = "procedural://pelagos-oc8/siphon", position = {0, 0.015, -0.17}, scale = {0.07, 0.07, 0.14})
    );

  BallastDepthActuator ballast
    annotation(Placement(transformation(extent = {{12, 36}, {42, 64}})));

  MantleRigidBody hull
    annotation(
      Placement(transformation(extent = {{64, 4}, {96, 40}})),
      CAD(uri = "procedural://pelagos-oc8/mantle", position = {0, 0.21, 0}, scale = {0.22, 0.28, 0.22})
    );

  ArticulatedArmBank arms
    annotation(
      Placement(transformation(extent = {{64, -58}, {96, -24}})),
      CAD(uri = "procedural://pelagos-oc8/arm-chains", position = {0.33, -0.02, 0.14}, scale = {0.42, 0.08, 0.42})
    );

  // ── Top-Level Telemetry & 3D Field-Simulator Channels ────────────────────

  Real pumpOmega "7-piston swashplate angular speed [rad/s]";
  Real pumpFlowLpm "7-piston seawater flow rate [L/min]";
  Real pumpTempC "7-piston pump core temperature [degC]";
  Real jetVelocity "Siphon exit jet velocity [m/s]";
  Real siphonThrust "Siphon water-jet thrust [N]";
  Real jetLoad "Normalized siphon propulsion load [%]";
  Real surgeVelocity "Pelagos OC-8 forward swim velocity [m/s]";
  Real depthM "Operating depth below sea surface [m]";
  Real pitchDeg "Mantle pitch attitude [deg]";
  Real rollDeg "Mantle roll attitude [deg]";
  Real arm3Attached "Arm 3 magnetic collar state (1=docked, 0=detached)"
    annotation(CAD(uri = "procedural://pelagos-oc8/arm3-collar", position = {0.18, -0.02, 0.18}, scale = {0.06, 0.06, 0.06}));
  Real arm3DetachOffset "Arm 3 free-floating separation distance [m]";

equation
  // Acausal hydraulic seawater loop: SeawaterIntake -> 7-Piston Pump -> Siphon Jet Nozzle
  connect(intake.port_out, pump.port_in)
    annotation(Line(points = {{-68, -4}, {-44, -4}}, color = {6, 182, 212}));
  connect(pump.port_out, siphon.port_in)
    annotation(Line(points = {{-12, -4}, {10, -4}}, color = {2, 132, 199}));

  // Acausal mechanical shaft & multi-body force/torque couplings
  connect(motor.flange, pump.shaft)
    annotation(Line(points = {{-30, 36}, {-30, 12}}, color = {16, 185, 129}));
  connect(siphon.flange_hull, hull.flange_surge)
    annotation(Line(points = {{42, -4}, {54, -4}, {54, 16}, {64, 16}}, color = {249, 115, 22}));
  connect(ballast.flange_heave, hull.flange_heave)
    annotation(Line(points = {{42, 50}, {54, 50}, {54, 30}, {64, 30}}, color = {16, 185, 129}));
  connect(arms.flange_mantle, hull.flange_arms)
    annotation(Line(points = {{80, -24}, {80, 4}}, color = {168, 85, 247}));

  // Closed-loop mission control & ambient depth coupling
  motor.omegaCmd = mission.omegaPumpCmd;
  ballast.depthTarget = mission.depthTarget;
  arms.arm3DetachCmd = mission.arm3DetachCmd;
  arms.jetLoadFrac = siphon.jetLoadFrac;
  intake.depthM = hull.z;
  siphon.depthM = hull.z;

  // Top-level telemetry aliases matching Pelagos OC-8 Field HUD & VR Rotunda channels
  pumpOmega = pump.omega;
  pumpFlowLpm = pump.flowLpm;
  pumpTempC = pump.tempC;
  jetVelocity = siphon.jetVelocity;
  siphonThrust = siphon.thrust;
  jetLoad = siphon.jetLoad;
  surgeVelocity = hull.vx;
  depthM = hull.z;
  pitchDeg = hull.pitchDeg;
  rollDeg = hull.rollDeg;
  arm3Attached = arms.arm3Attached;
  arm3DetachOffset = arms.arm3DetachOffset;

  annotation(experiment(StartTime = 0, StopTime = 25, Interval = 0.1));
end PelagosOC8SubseaOctopus;

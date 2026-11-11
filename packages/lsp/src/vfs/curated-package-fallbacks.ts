// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Curated stdlib catalog entries and standalone fallback source bundles so
 * Ansatz Hub packages mount deterministically even in offline/browser-only
 * workspaces where local `.zip` archives or registry endpoints are unavailable.
 */

export interface CuratedCatalogMeta {
  packageName: string;
  version: string;
  filename: string;
  language: string;
  files: Record<string, string>;
  icons?: Record<string, string>;
}

const SVG_ATTRS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"';

export const CURATED_PACKAGE_FALLBACKS: Record<string, CuratedCatalogMeta> = {
  PlanarMechanics: {
    packageName: "PlanarMechanics",
    version: "1.6.1",
    filename: "PlanarMechanics-1.6.1.zip",
    language: "modelica",
    files: {
      "PlanarMechanics/package.mo": `package PlanarMechanics "2D planar multi-body mechanical systems library"
  connector Frame "2D planar mechanical coordinate frame"
    Real x "Horizontal position [m]";
    Real y "Vertical position [m]";
    Real phi "Planar orientation angle [rad]";
    flow Real fx "Horizontal force [N]";
    flow Real fy "Vertical force [N]";
    flow Real t "Planar torque [N.m]";
  end Frame;

  package Parts "Rigid planar bodies and point masses"
    model Fixed "Fixed planar frame origin"
      parameter Real r[2] = {0, 0} "Fixed origin [m]";
      PlanarMechanics.Frame frame_b;
    equation
      frame_b.x = r[1];
      frame_b.y = r[2];
      frame_b.phi = 0;
    end Fixed;

    model BodyCylinder "Rigid planar link with mass and rotational inertia"
      parameter Real m = 1.0 "Mass [kg]";
      parameter Real I = 0.1 "Moment of inertia [kg.m2]";
      parameter Real length = 0.5 "Link length [m]";
      PlanarMechanics.Frame frame_a;
      PlanarMechanics.Frame frame_b;
    equation
      frame_b.x = frame_a.x + length * cos(frame_a.phi);
      frame_b.y = frame_a.y + length * sin(frame_a.phi);
      frame_b.phi = frame_a.phi;
      frame_a.fx + frame_b.fx = m * der(der(frame_a.x));
      frame_a.fy + frame_b.fy = m * der(der(frame_a.y));
      frame_a.t + frame_b.t = I * der(der(frame_a.phi));
    end BodyCylinder;
  end Parts;

  package Joints "Planar kinematic joints"
    model Revolute "Planar 1-DOF revolute pin joint"
      PlanarMechanics.Frame frame_a;
      PlanarMechanics.Frame frame_b;
      Real phi(start = 0) "Relative rotation angle [rad]";
      Real w(start = 0) "Relative angular velocity [rad/s]";
    equation
      w = der(phi);
      frame_b.x = frame_a.x;
      frame_b.y = frame_a.y;
      frame_b.phi = frame_a.phi + phi;
      frame_a.fx + frame_b.fx = 0;
      frame_a.fy + frame_b.fy = 0;
      frame_b.t = 0;
      frame_a.t = 0;
    end Revolute;

    model Prismatic "Planar 1-DOF translational slider joint"
      PlanarMechanics.Frame frame_a;
      PlanarMechanics.Frame frame_b;
      Real s(start = 0) "Relative displacement [m]";
    equation
      frame_b.x = frame_a.x + s * cos(frame_a.phi);
      frame_b.y = frame_a.y + s * sin(frame_a.phi);
      frame_b.phi = frame_a.phi;
      frame_a.fx + frame_b.fx = 0;
      frame_a.fy + frame_b.fy = 0;
      frame_a.t + frame_b.t = 0;
    end Prismatic;
  end Joints;

  package Examples "Runnable multi-body planar mechanism examples"
    model DoublePendulum "Coupled two-link planar pendulum under gravity"
      PlanarMechanics.Parts.Fixed fixed(r = {0, 0}) annotation(Placement(transformation(extent={{-90,-10},{-70,10}})));
      PlanarMechanics.Joints.Revolute rev1(phi(start = 0.6)) annotation(Placement(transformation(extent={{-46,-10},{-26,10}})));
      PlanarMechanics.Parts.BodyCylinder link1(m = 1.2, length = 0.5) annotation(Placement(transformation(extent={{-4,-10},{20,10}})));
      PlanarMechanics.Joints.Revolute rev2(phi(start = -0.4)) annotation(Placement(transformation(extent={{42,-10},{62,10}})));
      PlanarMechanics.Parts.BodyCylinder link2(m = 0.8, length = 0.4) annotation(Placement(transformation(extent={{82,-10},{106,10}})));
    equation
      connect(fixed.frame_b, rev1.frame_a) annotation(Line(points={{-70,0},{-46,0}}, color={37,99,235}));
      connect(rev1.frame_b, link1.frame_a) annotation(Line(points={{-26,0},{-4,0}}, color={37,99,235}));
      connect(link1.frame_b, rev2.frame_a) annotation(Line(points={{20,0},{42,0}}, color={37,99,235}));
      connect(rev2.frame_b, link2.frame_a) annotation(Line(points={{62,0},{82,0}}, color={37,99,235}));
    end DoublePendulum;
  end Examples;
end PlanarMechanics;
`,
    },
    icons: {
      "PlanarMechanics.Joints.Revolute": `<svg ${SVG_ATTRS}><line x1="6" y1="32" x2="22" y2="32" stroke="#2563eb" stroke-width="3"/><line x1="42" y1="32" x2="58" y2="32" stroke="#2563eb" stroke-width="3"/><circle cx="32" cy="32" r="11" stroke="#1e293b" stroke-width="2.5" fill="#e0f2fe"/><circle cx="32" cy="32" r="4" fill="#2563eb"/><path d="M22 17 A15 15 0 0 1 42 17" stroke="#0891b2" stroke-width="2" fill="none"/></svg>`,
      "PlanarMechanics.Parts.BodyCylinder": `<svg ${SVG_ATTRS}><rect x="12" y="24" width="40" height="16" rx="8" stroke="#1e293b" stroke-width="2.5" fill="#dbeafe"/><circle cx="18" cy="32" r="3.5" fill="#2563eb"/><circle cx="46" cy="32" r="3.5" fill="#2563eb"/><line x1="4" y1="32" x2="12" y2="32" stroke="#2563eb" stroke-width="2.5"/><line x1="52" y1="32" x2="60" y2="32" stroke="#2563eb" stroke-width="2.5"/></svg>`,
      "PlanarMechanics.Parts.Fixed": `<svg ${SVG_ATTRS}><line x1="16" y1="40" x2="48" y2="40" stroke="#1e293b" stroke-width="3"/><line x1="20" y1="40" x2="14" y2="50" stroke="#64748b" stroke-width="2"/><line x1="28" y1="40" x2="22" y2="50" stroke="#64748b" stroke-width="2"/><line x1="36" y1="40" x2="30" y2="50" stroke="#64748b" stroke-width="2"/><line x1="44" y1="40" x2="38" y2="50" stroke="#64748b" stroke-width="2"/><line x1="32" y1="40" x2="32" y2="20" stroke="#2563eb" stroke-width="2.5"/><rect x="28" y="14" width="8" height="8" stroke="#2563eb" stroke-width="2"/></svg>`,
    },
  },

  Buildings: {
    packageName: "Buildings",
    version: "11.0.0",
    filename: "Buildings-11.0.0.zip",
    language: "modelica",
    files: {
      "Buildings/package.mo": `package Buildings "LBNL Modelica Buildings Library — HVAC, district energy & building envelope"
  connector FluidPort "Thermofluid port for HVAC piping networks"
    Real p(start = 101325) "Absolute pressure [Pa]";
    flow Real m_flow "Mass flow rate [kg/s]";
  end FluidPort;

  package Fluid "Hydronic and air-side thermofluid HVAC components"
    package Movers "Pumps and fans"
      model FlowControlled_m_flow "Centrifugal pump or fan with prescribed mass flow rate"
        parameter Real m_flow_nominal = 1.0 "Nominal mass flow rate [kg/s]";
        Buildings.FluidPort port_a;
        Buildings.FluidPort port_b;
        Real dp "Pressure rise [Pa]";
      equation
        port_a.m_flow = m_flow_nominal;
        port_a.m_flow + port_b.m_flow = 0;
        dp = port_b.p - port_a.p;
      end FlowControlled_m_flow;
    end Movers;

    package MixingVolumes "Lumped fluid control volumes"
      model MixingVolume "Well-mixed thermofluid tank or room air volume"
        parameter Real V = 1.0 "Volume [m3]";
        parameter Real T_start = 293.15 "Initial temperature [K]";
        Buildings.FluidPort port_a;
        Buildings.FluidPort port_b;
        Real T(start = T_start) "Fluid temperature [K]";
      equation
        port_a.p = port_b.p;
        port_a.m_flow + port_b.m_flow = 0;
        V * 1.2 * 1005 * der(T) = 0;
      end MixingVolume;
    end MixingVolumes;

    package Actuators "Control valves and dampers"
      model TwoWayEqualPercentage "Two-way equal-percentage hydronic control valve"
        parameter Real kFixed = 0.5 "Flow coefficient";
        Buildings.FluidPort port_a;
        Buildings.FluidPort port_b;
        input Real y = 1.0 "Normalized valve opening [0..1]";
      equation
        port_a.m_flow + port_b.m_flow = 0;
        port_a.m_flow = y * kFixed * (port_a.p - port_b.p);
      end TwoWayEqualPercentage;
    end Actuators;
  end Fluid;

  package Examples "Runnable HVAC hydronic & zone thermal examples"
    model HydronicHeatingLoop "Closed hydronic circulation loop with pump, modulating valve & thermal zone volume"
      Buildings.Fluid.Movers.FlowControlled_m_flow pump(m_flow_nominal = 1.2) annotation(Placement(transformation(extent={{-75,15},{-51,39}})));
      Buildings.Fluid.Actuators.TwoWayEqualPercentage valve(kFixed = 0.6) annotation(Placement(transformation(extent={{-12,15},{12,39}})));
      Buildings.Fluid.MixingVolumes.MixingVolume zoneTank(V = 2.5, T_start = 294.15) annotation(Placement(transformation(extent={{52,-12},{80,18}})));
    equation
      pump.port_a.p = 101325;
      connect(pump.port_b, valve.port_a) annotation(Line(points={{-51,27},{-12,27}}, color={2,132,199}));
      connect(valve.port_b, zoneTank.port_a) annotation(Line(points={{12,27},{52,27},{52,3}}, color={2,132,199}));
      connect(zoneTank.port_b, pump.port_a) annotation(Line(points={{80,3},{92,3},{92,-30},{-88,-30},{-88,27},{-75,27}}, color={2,132,199}));
    end HydronicHeatingLoop;
  end Examples;
end Buildings;
`,
    },
    icons: {
      "Buildings.Fluid.Movers.FlowControlled_m_flow": `<svg ${SVG_ATTRS}><line x1="4" y1="32" x2="16" y2="32" stroke="#0284c7" stroke-width="3"/><line x1="48" y1="32" x2="60" y2="32" stroke="#0284c7" stroke-width="3"/><circle cx="32" cy="32" r="16" stroke="#0369a1" stroke-width="2.5" fill="#e0f2fe"/><polygon points="25,21 45,32 25,43" fill="#0284c7"/></svg>`,
      "Buildings.Fluid.MixingVolumes.MixingVolume": `<svg ${SVG_ATTRS}><rect x="14" y="12" width="36" height="40" rx="5" stroke="#0369a1" stroke-width="2.5" fill="#e0f2fe"/><path d="M16 32 Q24 28 32 32 T48 32 L48 50 L16 50 Z" fill="#38bdf8" opacity="0.45"/><line x1="4" y1="24" x2="14" y2="24" stroke="#0284c7" stroke-width="3"/><line x1="50" y1="40" x2="60" y2="40" stroke="#0284c7" stroke-width="3"/></svg>`,
      "Buildings.Fluid.Actuators.TwoWayEqualPercentage": `<svg ${SVG_ATTRS}><line x1="4" y1="36" x2="16" y2="36" stroke="#0284c7" stroke-width="3"/><line x1="48" y1="36" x2="60" y2="36" stroke="#0284c7" stroke-width="3"/><polygon points="16,24 32,36 16,48" stroke="#1e293b" stroke-width="2.2" fill="#bae6fd"/><polygon points="48,24 32,36 48,48" stroke="#1e293b" stroke-width="2.2" fill="#bae6fd"/><line x1="32" y1="36" x2="32" y2="16" stroke="#1e293b" stroke-width="2.2"/><path d="M22 16 A10 8 0 0 1 42 16 Z" stroke="#1e293b" stroke-width="2" fill="#94a3b8"/></svg>`,
    },
  },

  "SPICE-Standard": {
    packageName: "SPICE-Standard",
    version: "1.0.0",
    filename: "SPICE-Standard-1.0.0.zip",
    language: "spice",
    files: {
      "SPICE/package.mo": `package SPICE "Standard discrete semiconductor, BJT, MOSFET & op-amp behavioral models"
  connector Pin "Electrical node pin"
    Real v "Node potential [V]";
    flow Real i "Pin current [A]";
  end Pin;

  package Semiconductors "Discrete diodes and transistors"
    model Diode1N4148 "High-speed silicon switching diode (1N4148)"
      parameter Real Is = 2.52e-9 "Saturation current [A]";
      parameter Real Vt = 0.02585 "Thermal voltage [V]";
      SPICE.Pin p;
      SPICE.Pin n;
    equation
      p.i + n.i = 0;
      p.i = Is * (exp((p.v - n.v) / (1.752 * Vt)) - 1);
    end Diode1N4148;

    model Transistor2N2222 "General-purpose NPN bipolar junction transistor (2N2222)"
      parameter Real Bf = 200 "Forward current gain";
      SPICE.Pin c;
      SPICE.Pin b;
      SPICE.Pin e;
    equation
      c.i = Bf * b.i;
      c.i + b.i + e.i = 0;
      b.v - e.v = 0.7;
    end Transistor2N2222;

    model MOSFET_NMOS "Enhancement-mode N-channel MOSFET behavioral device"
      parameter Real Vth = 1.5 "Threshold voltage [V]";
      parameter Real Kp = 2e-3 "Transconductance parameter [A/V2]";
      SPICE.Pin d;
      SPICE.Pin g;
      SPICE.Pin s;
    equation
      g.i = 0;
      d.i + s.i = 0;
      d.i = if g.v - s.v > Vth then 0.5 * Kp * (g.v - s.v - Vth) ^ 2 else 0;
    end MOSFET_NMOS;
  end Semiconductors;

  package OpAmps "Operational amplifier macromodels"
    model LM741 "Classic general-purpose operational amplifier macromodel"
      parameter Real Av = 200000 "Open-loop voltage gain";
      SPICE.Pin in_p;
      SPICE.Pin in_n;
      SPICE.Pin out;
    equation
      in_p.i = 0;
      in_n.i = 0;
      out.v = Av * (in_p.v - in_n.v);
    end LM741;
  end OpAmps;

  package Examples "Runnable analog & mixed-signal SPICE stages"
    model ActiveClampStage "NMOS switching stage with 1N4148 clamp diode and LM741 buffer"
      SPICE.Semiconductors.MOSFET_NMOS nmos1(Vth = 1.5) annotation(Placement(transformation(extent={{-68,-14},{-42,14}})));
      SPICE.Semiconductors.Diode1N4148 clampDiode annotation(Placement(transformation(extent={{-10,14},{14,34}})));
      SPICE.OpAmps.LM741 bufferAmp annotation(Placement(transformation(extent={{44,-14},{74,14}})));
    equation
      nmos1.s.v = 0;
      nmos1.g.v = 3.3 * sin(62.83 * time);
      clampDiode.n.v = 5.0;
      connect(nmos1.d, clampDiode.p) annotation(Line(points={{-42,8},{-24,8},{-24,24},{-10,24}}, color={37,99,235}));
      connect(nmos1.d, bufferAmp.in_p) annotation(Line(points={{-42,8},{44,-6}}, color={37,99,235}));
      connect(bufferAmp.out, bufferAmp.in_n) annotation(Line(points={{74,0},{86,0},{86,26},{32,26},{32,6},{44,6}}, color={37,99,235}));
    end ActiveClampStage;
  end Examples;
end SPICE;
`,
    },
    icons: {
      "SPICE.Semiconductors.Diode1N4148": `<svg ${SVG_ATTRS}><line x1="6" y1="32" x2="22" y2="32" stroke="#2563eb" stroke-width="2.5"/><polygon points="22,18 42,32 22,46" stroke="#2563eb" stroke-width="2.5" fill="#dbeafe"/><line x1="42" y1="18" x2="42" y2="46" stroke="#2563eb" stroke-width="3"/><line x1="42" y1="32" x2="58" y2="32" stroke="#2563eb" stroke-width="2.5"/></svg>`,
      "SPICE.Semiconductors.Transistor2N2222": `<svg ${SVG_ATTRS}><circle cx="34" cy="32" r="20" stroke="#64748b" stroke-width="1.8"/><line x1="8" y1="32" x2="26" y2="32" stroke="#2563eb" stroke-width="2.5"/><line x1="26" y1="18" x2="26" y2="46" stroke="#1e293b" stroke-width="3"/><line x1="26" y1="25" x2="44" y2="12" stroke="#2563eb" stroke-width="2.5"/><line x1="26" y1="39" x2="44" y2="52" stroke="#2563eb" stroke-width="2.5"/><polygon points="43,51 35,50 40,44" fill="#2563eb"/></svg>`,
      "SPICE.Semiconductors.MOSFET_NMOS": `<svg ${SVG_ATTRS}><line x1="8" y1="40" x2="22" y2="40" stroke="#2563eb" stroke-width="2.5"/><line x1="22" y1="20" x2="22" y2="44" stroke="#1e293b" stroke-width="2.5"/><line x1="28" y1="18" x2="28" y2="46" stroke="#1e293b" stroke-width="2.5" stroke-dasharray="6 3"/><line x1="28" y1="22" x2="48" y2="22" stroke="#2563eb" stroke-width="2.5"/><line x1="48" y1="22" x2="48" y2="10" stroke="#2563eb" stroke-width="2.5"/><line x1="28" y1="42" x2="48" y2="42" stroke="#2563eb" stroke-width="2.5"/><line x1="48" y1="42" x2="48" y2="54" stroke="#2563eb" stroke-width="2.5"/></svg>`,
      "SPICE.OpAmps.LM741": `<svg ${SVG_ATTRS}><polygon points="14,12 52,32 14,52" stroke="#2563eb" stroke-width="2.5" fill="#eff6ff"/><line x1="4" y1="24" x2="14" y2="24" stroke="#2563eb" stroke-width="2.5"/><line x1="4" y1="40" x2="14" y2="40" stroke="#2563eb" stroke-width="2.5"/><line x1="52" y1="32" x2="60" y2="32" stroke="#2563eb" stroke-width="2.5"/><text x="18" y="28" font-size="12" fill="#ef4444" font-family="monospace">-</text><text x="18" y="44" font-size="12" fill="#2563eb" font-family="monospace">+</text></svg>`,
    },
  },

  "IEEE-Test-Feeders": {
    packageName: "IEEE-Test-Feeders",
    version: "1.0.0",
    filename: "IEEE-Test-Feeders-1.0.0.zip",
    language: "opendss",
    files: {
      "IEEEFeeders/package.mo": `package IEEEFeeders "IEEE 13-Bus, 34-Bus & 123-Bus distribution test feeders"
  model IEEE13Node "IEEE 13-Node unbalanced radial distribution feeder (4.16 kV)"
    parameter Real Vbase_kV = 4.16 "Nominal line-to-line voltage [kV]";
    Real Vpu(start = 1.0) "Substation bus voltage [p.u.]";
  equation
    der(Vpu) = 0;
  end IEEE13Node;

  model IEEE34Node "IEEE 34-Node long lightly-loaded rural feeder (24.9 kV)"
    parameter Real Vbase_kV = 24.9 "Nominal line-to-line voltage [kV]";
    Real Vpu(start = 1.02) "Regulated bus voltage [p.u.]";
  equation
    der(Vpu) = 0;
  end IEEE34Node;

  model IEEE123Node "IEEE 123-Node meshed/radial distribution feeder benchmark"
    parameter Real Vbase_kV = 4.16 "Nominal line-to-line voltage [kV]";
    Real Vpu(start = 1.0) "Feeder head voltage [p.u.]";
  equation
    der(Vpu) = 0;
  end IEEE123Node;
end IEEEFeeders;
`,
    },
  },

  "PSSE-Standard-Dynamics": {
    packageName: "PSSE-Standard-Dynamics",
    version: "1.0.0",
    filename: "PSSE-Standard-Dynamics-1.0.0.zip",
    language: "psse",
    files: {
      "PSSEDynamics/package.mo": `package PSSEDynamics "Standard IEEE/WECC synchronous machine, exciter, governor & IBR dynamic models"
  model GENROU "Round-rotor synchronous generator dynamic model"
    parameter Real H = 4.5 "Inertia constant [s]";
    parameter Real D = 1.0 "Damping factor [p.u.]";
    Real delta(start = 0.4) "Rotor angle [rad]";
    Real omega(start = 0.0) "Rotor speed deviation [p.u.]";
  equation
    der(delta) = 376.991 * omega;
    2 * H * der(omega) = -D * omega;
  end GENROU;

  model EXST1 "IEEE Type ST1 potential-source controlled-rectifier excitation system"
    parameter Real Ka = 200.0 "Regulator gain";
    parameter Real Ta = 0.02 "Regulator time constant [s]";
    Real Efd(start = 1.5) "Field voltage [p.u.]";
  equation
    Ta * der(Efd) + Efd = 1.5;
  end EXST1;

  model REGC_A "WECC renewable energy generator/converter Type-A grid-following model"
    parameter Real Tg = 0.02 "Converter current control time constant [s]";
    Real Ip(start = 0.8) "Active current command [p.u.]";
  equation
    Tg * der(Ip) + Ip = 0.8;
  end REGC_A;
end PSSEDynamics;
`,
    },
  },

  "IEEE-Transmission-Benchmarks": {
    packageName: "IEEE-Transmission-Benchmarks",
    version: "1.0.0",
    filename: "IEEE-Transmission-Benchmarks-1.0.0.zip",
    language: "psse",
    files: {
      "IEEETransmission/package.mo": `package IEEETransmission "IEEE 14, 30, 57 & 118-bus transmission benchmark grids"
  model IEEE14Bus "IEEE 14-Bus transmission test system"
    parameter Integer nBuses = 14;
    Real freqHz(start = 60.0) "System frequency [Hz]";
  equation
    der(freqHz) = 0;
  end IEEE14Bus;

  model IEEE118Bus "IEEE 118-Bus bulk power transmission benchmark"
    parameter Integer nBuses = 118;
    Real freqHz(start = 60.0) "System frequency [Hz]";
  equation
    der(freqHz) = 0;
  end IEEE118Bus;
end IEEETransmission;
`,
    },
  },

  "Standard-Robots": {
    packageName: "Standard-Robots",
    version: "1.0.0",
    filename: "Standard-Robots-1.0.0.zip",
    language: "urdf",
    files: {
      "StandardRobots/package.mo": `package StandardRobots "Industrial and collaborative articulated robot kinematic & dynamic models"
  model UR5 "Universal Robots UR5 6-DOF collaborative manipulator"
    parameter Integer dof = 6;
    Real q1(start = 0) "Base shoulder pan angle [rad]";
    Real q2(start = -1.57) "Shoulder lift angle [rad]";
  equation
    der(q1) = 0.2;
    der(q2) = 0;
  end UR5;

  model FrankaPanda "Franka Emika Panda 7-DOF torque-controlled research robot"
    parameter Integer dof = 7;
    Real q1(start = 0) "Joint 1 angle [rad]";
  equation
    der(q1) = 0;
  end FrankaPanda;

  model KukaIIWA14 "KUKA LBR iiwa 14 R820 7-axis lightweight robot"
    parameter Integer dof = 7;
    Real q1(start = 0) "Joint 1 angle [rad]";
  equation
    der(q1) = 0;
  end KukaIIWA14;
end StandardRobots;
`,
    },
  },

  "AUTOSAR-Metamodels": {
    packageName: "AUTOSAR-Metamodels",
    version: "4.4.0",
    filename: "AUTOSAR-Metamodels-4.4.0.zip",
    language: "autosar",
    files: {
      "AUTOSAR/package.mo": `package AUTOSAR "AUTOSAR Classic & Adaptive software component architecture definitions"
  block ApplicationSwComponentType "AUTOSAR Atomic Application Software Component"
    input Real RPort_VehicleSpeed = 0.0 "Receiver port vehicle speed [m/s]";
    output Real PPort_TorqueRequest "Provider port torque request [N.m]";
  equation
    PPort_TorqueRequest = 12.5 * (20.0 - RPort_VehicleSpeed);
  end ApplicationSwComponentType;
end AUTOSAR;
`,
    },
  },

  "EPANET-Benchmark-Networks": {
    packageName: "EPANET-Benchmark-Networks",
    version: "2.2.0",
    filename: "EPANET-Benchmark-Networks-2.2.0.zip",
    language: "epanet",
    files: {
      "EPANET/package.mo": `package EPANET "EPA pressurized municipal water distribution benchmark networks"
  model PressurizedPipe "Hazen-Williams / Darcy-Weisbach pressurized water main"
    parameter Real length = 500.0 "Pipe length [m]";
    parameter Real diameter = 0.3 "Internal diameter [m]";
    Real Q_flow(start = 0.08) "Volumetric flow rate [m3/s]";
  equation
    der(Q_flow) = 0;
  end PressurizedPipe;

  model Net3Municipal "EPANET Net3 dual-source municipal water system with storage tanks"
    Real tankHead(start = 42.0) "Elevated tank hydraulic head [m]";
  equation
    der(tankHead) = -0.01;
  end Net3Municipal;
end EPANET;
`,
    },
  },

  "SWMM-Reference-Networks": {
    packageName: "SWMM-Reference-Networks",
    version: "5.2.0",
    filename: "SWMM-Reference-Networks-5.2.0.zip",
    language: "swmm",
    files: {
      "SWMM/package.mo": `package SWMM "EPA stormwater runoff, detention basin & open-channel hydraulic models"
  model SubcatchmentRunoff "Nonlinear reservoir urban catchment runoff model"
    parameter Real area_ha = 12.5 "Subcatchment area [ha]";
    Real depth(start = 0.0) "Surface ponding depth [m]";
  equation
    der(depth) = 0;
  end SubcatchmentRunoff;
end SWMM;
`,
    },
  },

  "STEP-Fasteners": {
    packageName: "STEP-Fasteners",
    version: "1.0.0",
    filename: "STEP-Fasteners-1.0.0.zip",
    language: "step",
    files: {
      "STEPFasteners/package.mo": `package STEPFasteners "ISO 4762, ISO 4017 & ISO 4032 standard mechanical fasteners"
  record M8x30_SocketCapScrew "ISO 4762 M8x30 hexagon socket head cap screw"
    parameter Real nominalDiameter_mm = 8.0;
    parameter Real length_mm = 30.0;
    parameter Real headDiameter_mm = 13.0;
  end M8x30_SocketCapScrew;

  record M8_HexNut "ISO 4032 M8 hexagon regular nut"
    parameter Real nominalDiameter_mm = 8.0;
    parameter Real thickness_mm = 6.8;
  end M8_HexNut;
end STEPFasteners;
`,
    },
  },
};

export function findCuratedPackageFallback(name: string): CuratedCatalogMeta | undefined {
  const lower = name.trim().toLowerCase();
  for (const [key, meta] of Object.entries(CURATED_PACKAGE_FALLBACKS)) {
    if (key.toLowerCase() === lower || meta.packageName.toLowerCase() === lower) {
      return meta;
    }
  }
  return undefined;
}

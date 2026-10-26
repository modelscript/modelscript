// SPDX-License-Identifier: AGPL-3.0-or-later

export interface HeroExample {
  id: string;
  name: string;
  lang: "modelica" | "sysml2" | "owl2";
  code: string;
}

export const HERO_EXAMPLES: HeroExample[] = [
  {
    id: "bouncing-ball",
    name: "Bouncing Ball (Physics / Hybrid DAE)",
    lang: "modelica",
    code: `model BouncingBall "Classic hybrid physics simulation with impact restitution"
  parameter Real g = 9.81 "Gravity acceleration";
  parameter Real c = 0.85 "Restitution coefficient";
  parameter Real radius = 0.1 "Ball radius";
  Real h(start = 1.0, fixed = true) "Height of ball center";
  Real v(start = 0.0, fixed = true) "Velocity";
equation
  der(h) = v;
  der(v) = -g;

  when h <= radius and v < 0 then
    reinit(v, -c * v);
  end when;
  
  annotation(experiment(StopTime = 3.0, StepSize = 0.005));
end BouncingBall;`,
  },
  {
    id: "rlc-filter",
    name: "RLC Low-Pass Filter (Analog Electronics)",
    lang: "modelica",
    code: `model RLCFilter "Second-order resonant circuit"
  parameter Real R = 10.0 "Resistor [Ohm]";
  parameter Real L = 0.01 "Inductor [H]";
  parameter Real C = 0.001 "Capacitor [F]";
  parameter Real V_in = 5.0 "Step input voltage [V]";
  
  Real v_c(start = 0.0, fixed = true) "Capacitor voltage";
  Real i_l(start = 0.0, fixed = true) "Inductor current";
equation
  der(v_c) = i_l / C;
  der(i_l) = (V_in - v_c - R * i_l) / L;
  
  annotation(experiment(StopTime = 0.1, StepSize = 0.0001));
end RLCFilter;`,
  },
  {
    id: "chua-circuit",
    name: "Chua Chaotic Oscillator (Nonlinear Dynamics)",
    lang: "modelica",
    code: `model ChuaCircuit "Double-scroll chaotic attractor circuit"
  parameter Real a = 15.6;
  parameter Real b = 28.0;
  parameter Real m0 = -1.143;
  parameter Real m1 = -0.714;
  
  Real x(start = 0.1, fixed = true);
  Real y(start = 0.0, fixed = true);
  Real z(start = 0.0, fixed = true);
  Real g;
equation
  g = m1 * x + 0.5 * (m0 - m1) * (abs(x + 1) - abs(x - 1));
  der(x) = a * (y - x - g);
  der(y) = x - y + z;
  der(z) = -b * y;

  annotation(experiment(StopTime = 50.0, StepSize = 0.01));
end ChuaCircuit;`,
  },
  {
    id: "sysml2-powertrain",
    name: "SysML v2 Electric Vehicle Powertrain",
    lang: "sysml2",
    code: `package ElectricVehicleArchitecture {
  part def BatterySubsystem {
    port powerOut: HighVoltagePort;
  }

  part def InverterSubsystem {
    port dcIn: HighVoltagePort;
    port acOut: ThreePhasePort;
  }

  part def TractionMotor {
    port acIn: ThreePhasePort;
    port torqueOut: MechanicalShaftPort;
  }

  part evPowertrain {
    part battery: BatterySubsystem;
    part inverter: InverterSubsystem;
    part motor: TractionMotor;

    connection b2i connect battery.powerOut to inverter.dcIn;
    connection i2m connect inverter.acOut to motor.acIn;
  }
}`,
  },
];

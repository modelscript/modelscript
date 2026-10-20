// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated automatically by ModelScript PSCAD-to-Modelica Projection

model Microgrid_IBR
  "Translated electrical network from PSCAD project Microgrid_IBR"

  Modelica.Electrical.Analog.Basic.Ground ground;
  Modelica.Electrical.Analog.Interfaces.PositivePin bus_B1;
  Modelica.Electrical.Analog.Interfaces.PositivePin bus_B2;
  Modelica.Electrical.Analog.Interfaces.PositivePin bus_B3;
  Modelica.Electrical.Analog.Interfaces.PositivePin bus_Node_1;
  Modelica.Electrical.Analog.Sources.SineVoltage Utility_Grid_250MVA(V = 16500.0, f = 60, phase = 0.0000);
  Modelica.Electrical.Analog.Basic.Resistor CB1(R = 0.001);
  // Transformer T1: 16.5kV -> 230kV (n=0.0717, Yg-Yg), 250 MVA
  Modelica.Electrical.Analog.Basic.Inductor T1_leakage(L = 1.6639e-4);
  Modelica.Electrical.Analog.Basic.IdealTransformer T1_ideal(n = 0.0717);
  // Transmission Line L1: 50 km (bergeron)
  Modelica.Electrical.Analog.Basic.Resistor L1_R(R = 1.7500);
  Modelica.Electrical.Analog.Basic.Inductor L1_L(L = 6.0000e-2);
  Modelica.Electrical.Analog.Basic.Capacitor L1_C1(C = 3.0000e-7);
  Modelica.Electrical.Analog.Basic.Capacitor L1_C2(C = 3.0000e-7);
  // CSMF Control Blocks
  Modelica.Blocks.Sources.Constant V_Ref(k = 1);
  Modelica.Blocks.Math.Gain Droop_Gain(k = 2.5);
  Modelica.Blocks.Continuous.PI Q_Controller(k = 1.2, T = 0.02);
  Modelica.Blocks.Nonlinear.Limiter Current_Limiter(uMax = 1.2, uMin = -1.2);

equation
  connect(Utility_Grid_250MVA.p, bus_B1);
  connect(Utility_Grid_250MVA.n, ground.p);
  connect(bus_B2, CB1.p);
  connect(CB1.n, bus_Node_1);
  connect(bus_B1, T1_leakage.p);
  connect(T1_leakage.n, T1_ideal.p1);
  connect(T1_ideal.n1, ground.p);
  connect(T1_ideal.p2, bus_B2);
  connect(T1_ideal.n2, ground.p);
  connect(bus_Node_1, L1_R.p);
  connect(L1_R.n, L1_L.p);
  connect(L1_L.n, bus_B3);
  connect(L1_C1.p, L1_R.p);
  connect(L1_C1.n, ground.p);
  connect(L1_C2.p, L1_L.n);
  connect(L1_C2.n, ground.p);
  connect(V_Ref.y, Droop_Gain.u);
  connect(Droop_Gain.y, Q_Controller.u);
  connect(Q_Controller.y, Current_Limiter.u);
  // Ground references

end Microgrid_IBR;

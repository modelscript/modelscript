// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated automatically by ModelScript PSCAD-to-Modelica Projection

model IEEE9Bus_IBR
  "Translated electrical network from PSCAD project IEEE9Bus_IBR"

  Modelica.Electrical.Analog.Basic.Ground ground;
  Modelica.Electrical.Analog.Interfaces.PositivePin bus_B1;
  Modelica.Electrical.Analog.Interfaces.PositivePin bus_B2;
  Modelica.Electrical.Analog.Interfaces.PositivePin bus_B3;
  // Transformer T1: 16.5kV -> 230kV, 250 MVA
  Modelica.Electrical.Analog.Basic.Inductor T1_leakage(L = 1.6639e-4);
  // Transmission Line L1: 50 km
  Modelica.Electrical.Analog.Basic.Resistor L1_R(R = 1.7500);
  Modelica.Electrical.Analog.Basic.Inductor L1_L(L = 6.0000e-2);
  Modelica.Electrical.Analog.Basic.Capacitor L1_C1(C = 3.0000e-7);
  Modelica.Electrical.Analog.Basic.Capacitor L1_C2(C = 3.0000e-7);

equation
  connect(bus_B1, T1_leakage.p);
  connect(T1_leakage.n, bus_B2);
  connect(bus_B2, L1_R.p);
  connect(L1_R.n, L1_L.p);
  connect(L1_L.n, bus_B3);
  connect(L1_C1.p, L1_R.p);
  connect(L1_C1.n, ground.p);
  connect(L1_C2.p, L1_L.n);
  connect(L1_C2.n, ground.p);
  // Ground references

end IEEE9Bus_IBR;

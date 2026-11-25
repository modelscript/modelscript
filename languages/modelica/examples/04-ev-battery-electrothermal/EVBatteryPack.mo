model EVBatteryPack "Coupled 800V EV traction battery electro-thermal pack model"
  parameter Integer n_series = 216 "Cells in series (nominal 800V)";
  parameter Integer n_parallel = 2 "Strings in parallel";
  parameter Real Q_cell(unit="A.s") = 50.0 * 3600.0 "Cell capacity (50 Ah)";
  parameter Real R0_ref(unit="Ohm") = 0.0018 "Ohmic resistance per cell at 25 degC";
  parameter Real R1(unit="Ohm") = 0.0012 "Fast RC polarization resistance";
  parameter Real C1(unit="F") = 2500.0 "Fast RC polarization capacitance";
  parameter Real C_th(unit="J/K") = 380000.0 "Pack thermal mass";
  parameter Real hA_cool(unit="W/K") = 180.0 "Liquid cooling plate conductance";
  parameter Real T_cool(unit="K") = 298.15 "Coolant inlet temperature";
  parameter Real P_load(unit="W") = 150000.0 "Constant traction discharge power (150 kW)";

  Real soc(start=0.85, fixed=true) "Pack state of charge [0..1]";
  Real v_rc1(unit="V", start=0.0, fixed=true) "Cell RC polarization voltage";
  Real T_pack(unit="K", start=298.15, fixed=true) "Pack core temperature";
  Real V_oc_cell(unit="V") "Open-circuit voltage per cell";
  Real R0_cell(unit="Ohm") "Temperature-dependent ohmic resistance";
  Real I_pack(unit="A") "Pack discharge current";
  Real I_cell(unit="A") "Per-cell discharge current";
  Real V_pack(unit="V") "Pack terminal voltage";
  Real Q_gen(unit="W") "Total Joule heat generation";

equation
  V_oc_cell = 3.25 + 0.85 * soc + 0.08 * soc * soc;
  R0_cell = R0_ref * (1.0 + 0.004 * (298.15 - T_pack));
  I_cell = I_pack / n_parallel;
  C1 * der(v_rc1) = I_cell - v_rc1 / R1;
  V_pack = n_series * (V_oc_cell - I_cell * R0_cell - v_rc1);
  P_load = V_pack * I_pack;
  der(soc) = -I_cell / Q_cell;
  Q_gen = n_series * n_parallel * (I_cell * I_cell * R0_cell + v_rc1 * v_rc1 / R1);
  C_th * der(T_pack) = Q_gen - hA_cool * (T_pack - T_cool);

  annotation(
    experiment(StartTime=0, StopTime=900, Tolerance=1e-6)
  );
end EVBatteryPack;

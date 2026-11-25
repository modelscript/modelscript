within WindDrivetrain;
model WindTurbine "5 MW horizontal-axis wind turbine drivetrain assembly"
  parameter Real J_rotor(unit="kg.m2") = 3.54e7 "Aerodynamic rotor inertia";
  parameter Real rho(unit="kg/m3") = 1.225 "Air density";
  parameter Real R_blade(unit="m") = 63.0 "Rotor blade radius";
  parameter Real Cp = 0.45 "Aerodynamic power coefficient";
  parameter Real v_wind(unit="m/s") = 11.4 "Rated hub-height wind speed";
  constant Real pi = 3.141592653589793;

  Real omega_rotor(unit="rad/s", start=1.24, fixed=true) "Low-speed rotor angular velocity";
  Real tau_aero(unit="N.m") "Aerodynamic rotor torque";
  Real P_aero(unit="W") "Aerodynamic rotor power";

  Gearbox gearbox;
  Generator generator;

equation
  P_aero = 0.5 * rho * pi * R_blade * R_blade * Cp * v_wind * v_wind * v_wind;
  tau_aero = P_aero / max(omega_rotor, 0.1);
  J_rotor * der(omega_rotor) = tau_aero - gearbox.tau_low;

  gearbox.omega_low = omega_rotor;
  gearbox.omega_high = generator.omega_gen;
  generator.tau_mech = gearbox.tau_high;

  annotation(
    experiment(StartTime=0, StopTime=30, Tolerance=1e-6)
  );
end WindTurbine;

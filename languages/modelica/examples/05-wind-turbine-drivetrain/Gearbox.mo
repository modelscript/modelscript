within WindDrivetrain;
model Gearbox "Compliant planetary step-up gearbox with torsional stiffness and damping"
  parameter Real ratio = 97.0 "Gear step-up ratio";
  parameter Real k_shaft(unit="N.m/rad") = 8.67e8 "Low-speed shaft torsional stiffness";
  parameter Real c_shaft(unit="N.m.s/rad") = 6.21e6 "Low-speed shaft torsional damping";
  parameter Real eta = 0.965 "Mechanical transmission efficiency";

  input Real omega_low(unit="rad/s") "Rotor shaft angular speed";
  input Real omega_high(unit="rad/s") "Generator shaft angular speed";
  output Real tau_low(unit="N.m") "Low-speed shaft reaction torque";
  output Real tau_high(unit="N.m") "High-speed shaft driving torque";

  Real theta_twist(unit="rad", start=0.0, fixed=true) "Shaft torsional twist angle";

equation
  der(theta_twist) = omega_low - omega_high / ratio;
  tau_low = k_shaft * theta_twist + c_shaft * (omega_low - omega_high / ratio);
  tau_high = eta * tau_low / ratio;
end Gearbox;

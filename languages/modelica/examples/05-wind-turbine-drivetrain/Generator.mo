within WindDrivetrain;
model Generator "Permanent-magnet synchronous generator with electromagnetic torque control"
  parameter Real J_gen(unit="kg.m2") = 534.0 "Generator rotor inertia";
  parameter Real k_opt(unit="N.m.s2/rad2") = 2.33 "Optimal MPPT torque gain";
  parameter Real eta_elec = 0.94 "Power electronics and stator efficiency";

  input Real tau_mech(unit="N.m") "Driving mechanical torque from gearbox";
  output Real omega_gen(unit="rad/s") "Generator angular speed";
  output Real P_elec(unit="W") "Delivered electrical power";

  Real omega(unit="rad/s", start=120.0, fixed=true) "Generator speed state";
  Real tau_em(unit="N.m") "Electromagnetic braking torque";

equation
  tau_em = k_opt * omega * omega;
  J_gen * der(omega) = tau_mech - tau_em;
  omega_gen = omega;
  P_elec = eta_elec * tau_em * omega;
end Generator;

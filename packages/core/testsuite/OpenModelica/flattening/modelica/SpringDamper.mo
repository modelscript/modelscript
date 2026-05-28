model SpringDamper "Mass-spring-damper system for parameter calibration"
  parameter Real m = 1.0 "Mass [kg]";
  parameter Real k = 50.0 "Spring stiffness [N/m] (to calibrate)";
  parameter Real c = 2.0 "Damping coefficient [Ns/m] (to calibrate)";
  Real x(start = 1.0) "Displacement [m]";
  Real v(start = 0.0) "Velocity [m/s]";
equation
  der(x) = v;
  m * der(v) = -k * x - c * v;
end SpringDamper;

// Result:
// class SpringDamper
//   parameter Real m = 1.0;
//   parameter Real k = 50.0;
//   parameter Real c = 2.0;
//   Real x(start = 1.0);
//   Real v(start = 0.0);
// equation
//   der(x) = v;
//   m * der(v) = -k * x - c * v;
// end SpringDamper;
// endResult

model DroneSimulation "Drone flight dynamics linked to SysML v2, CAD, FEA, and CFD"
  // Multi-domain parameterization via TGG & Nelson-Oppen Theory Coordination:
  parameter Real m = 1.2 "Total mass [kg] (FEA structural oracle)"
    annotation(twin = "SysML2::DroneReachabilitySystem::DroneAssembly.totalMass");
  parameter Real A = 0.03 "Frontal area [m²] (CAD procedural geometry)"
    annotation(twin = "SysML2::DroneReachabilitySystem::DroneAssembly.totalFrontalArea");
  parameter Real Cd = 0.80 "Drag coefficient (CFD surface pressure simulation)"
    annotation(twin = "SysML2::DroneReachabilitySystem::DroneAssembly.aeroDragCoeff");
  parameter Real rho = 1.225 "Air density [kg/m³]";

  // Closed-loop flight ceiling climb autopilot:
  parameter Real z_target = 11.0 "Ceiling altitude setpoint [m]"
    annotation(twin = "SysML2::DroneReachabilitySystem::FlightCeilingRequirement.z_target");
  parameter Real kz = 3.1 "Altitude feedback gain [N/m]";
  parameter Real kv = 1.35 "Velocity damping gain [N/(m/s)]";

  Real z(start = 0.0, fixed = true) "Altitude [m]";
  Real v(start = 0.0, fixed = true) "Vertical climb velocity [m/s]";
  input Real w(start = 0.0) "Wind gust disturbance force in [-w_max, w_max] [N]";

equation
  der(z) = v;
  der(v) = (kz * (z_target - z) - kv * v - 0.5 * Cd * rho * A * v * abs(v) + w) / m;
end DroneSimulation;

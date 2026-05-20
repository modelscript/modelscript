// Cross-Domain Contradiction Detection
// This model intentionally creates a contradiction by extending
// two disjoint device categories.

model ElectricalDevice
  "Base class for all electrical components"
  parameter Real V_nominal = 220 "Nominal voltage [V]";
end ElectricalDevice;

model MechanicalDevice
  "Base class for all mechanical components"
  parameter Real J = 0.01 "Moment of inertia [kg.m2]";
end MechanicalDevice;

model Motor
  "Motor extends BOTH device types — this violates the disjointness
   constraint defined in constraints.owl"
  extends ElectricalDevice(V_nominal = 380);
  extends MechanicalDevice(J = 0.05);
  parameter Real P_rated = 5000 "Rated power [W]";
  parameter Real eta = 0.92 "Efficiency [-]";
  Real omega "Angular velocity [rad/s]";
  Real tau "Torque [N.m]";
equation
  P_rated * eta = tau * omega;
end Motor;

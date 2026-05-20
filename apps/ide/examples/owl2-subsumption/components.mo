// Actuator component library for subsumption reasoning

model Actuator
  "Base class for all actuators"
  parameter Real V_supply = 24 "Supply voltage [V]";
  parameter Real I_max = 10 "Maximum current [A]";
end Actuator;

model ServoMotor
  "High-precision servo motor — high voltage"
  extends Actuator(V_supply = 380, I_max = 5);
  parameter Real resolution = 0.001 "Angular resolution [rad]";
  parameter Real tau_max = 15 "Maximum torque [N.m]";
end ServoMotor;

model StepperMotor
  "Stepper motor — low voltage"
  extends Actuator(V_supply = 48, I_max = 3);
  parameter Integer steps_per_rev = 200 "Steps per revolution";
  parameter Real tau_hold = 2.5 "Holding torque [N.m]";
end StepperMotor;

model LinearActuator
  "Linear actuator — medium voltage"
  extends Actuator(V_supply = 120, I_max = 8);
  parameter Real stroke = 0.3 "Maximum stroke [m]";
  parameter Real F_max = 500 "Maximum force [N]";
end LinearActuator;

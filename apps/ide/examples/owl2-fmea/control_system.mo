// Fault Propagation Analysis — Control System
// Demonstrates transitive closure of connect() for FMEA

connector SignalPort
  Real signal;
end SignalPort;

model Sensor
  "Temperature sensor with failure mode"
  SignalPort output_port;
  parameter Real noise_std = 0.01 "Measurement noise [K]";
equation
  output_port.signal = 300 + noise_std; // simplified
end Sensor;

model Controller
  "PID controller"
  SignalPort input_port;
  SignalPort output_port;
  parameter Real Kp = 1.0 "Proportional gain";
  parameter Real setpoint = 350 "Temperature setpoint [K]";
  Real error;
equation
  error = setpoint - input_port.signal;
  output_port.signal = Kp * error;
end Controller;

model Actuator
  "Heating element actuator"
  SignalPort input_port;
  SignalPort output_port;
  parameter Real P_max = 1000 "Maximum power [W]";
equation
  output_port.signal = max(0, min(P_max, input_port.signal));
end Actuator;

model Plant
  "Thermal plant being controlled"
  SignalPort input_port;
  parameter Real C = 1000 "Thermal capacitance [J/K]";
  Real T(start = 300) "Temperature [K]";
equation
  C * der(T) = input_port.signal;
end Plant;

model ControlSystem
  "Full control loop — faults propagate sensor → controller → actuator → plant"
  Sensor sensor1;
  Controller controller1;
  Actuator actuator1;
  Plant plant1;
equation
  connect(sensor1.output_port, controller1.input_port);
  connect(controller1.output_port, actuator1.input_port);
  connect(actuator1.output_port, plant1.input_port);
end ControlSystem;

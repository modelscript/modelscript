// Semantic Unit Verification — Deliberate unit mismatch
// This model connects a pressure output to a temperature input

connector PressurePort
  Real p "Pressure [Pa]";
end PressurePort;

connector TemperaturePort
  Real T "Temperature [K]";
end TemperaturePort;

model PressureSensor
  "Outputs pressure in Pascals"
  PressurePort output_port;
equation
  output_port.p = 101325; // atmospheric pressure
end PressureSensor;

model TemperatureController
  "Expects temperature input in Kelvins"
  TemperaturePort input_port;
  parameter Real setpoint = 350 "Target temperature [K]";
  Real error;
equation
  error = setpoint - input_port.T;
end TemperatureController;

model BadSystem
  "Connects pressure output to temperature input — unit mismatch!"
  PressureSensor pressureSensor;
  TemperatureController tempController;
equation
  // This is semantically wrong: Pa != K
  tempController.input_port.T = pressureSensor.output_port.p;
end BadSystem;

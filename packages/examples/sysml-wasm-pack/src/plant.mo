model StepPlant
  parameter Real tau = 0.2 "Time constant (s)";
  parameter Real target = 1.0 "Step target";
  Real y(start = 0.0);
equation
  tau * der(y) + y = target;
end StepPlant;

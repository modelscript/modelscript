model HelloWorld "A simple Modelica model"
  Real x(start = 1);
  parameter Real a = -1;
equation
  der(x) = a * x;
end HelloWorld;

model Dahlquist
  parameter Real k = 1.0;
  Real x(start=1.0);
equation
  der(x) = -k * x;
end Dahlquist;

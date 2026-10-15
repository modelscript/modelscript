model TimeDependent
  Real x(start = 1.0);
  Real y;
equation
  der(x) = 2.0;
  y = 10.0 * time;
end TimeDependent;

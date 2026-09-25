model B2BTestModel
  Real x(start = 1.0);
  output Real y;
equation
  der(x) = -x;
  y = x;
end B2BTestModel;

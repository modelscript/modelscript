// name: OptimicaBasic
// status: correct

optimization OptimicaBasic(objective = cost(finalTime), startTime = 0, finalTime = 10)
  Real x(start = 1);
  Real cost(start = 0);
equation
  der(x) = -x;
  der(cost) = x^2;
constraint
  x >= 0.5;
  x <= 2.0;
end OptimicaBasic;

// Result:
// optimization OptimicaBasic(objective = cost(finalTime), startTime = 0.0, finalTime = 10.0)
//   Real x(start = 1.0);
//   Real cost(start = 0.0);
// equation
//   der(x) = -x;
//   der(cost) = x ^ 2.0;
// constraint
//   x >= 0.5;
//   x <= 2.0;
// end OptimicaBasic;
// endResult

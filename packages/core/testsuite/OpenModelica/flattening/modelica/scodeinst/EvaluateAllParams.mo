// name: EvaluateAllParams
// keywords:
// status: correct
//

model EvaluateAllParams
  parameter Real p = 10;
  Real x;
equation
  x = time * p;
end EvaluateAllParams;

// Result:
// class EvaluateAllParams
//   parameter Real p = 10.0;
//   Real x;
// equation
//   x = time * p;
// end EvaluateAllParams;
// endResult

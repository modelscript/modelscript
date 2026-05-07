// name: FunctionVariability
// keywords: function variability
// status: incorrect

function f
  constant input Real x;
  output Real y;
algorithm
  y := x;
end f;

model FunctionVariability
  Real a, b = f(a);
end FunctionVariability;

// Result:
// function f
//   input Real x;
//   output Real y;
// algorithm
//   y := x;
// end f;
//
// class FunctionVariability
//   Real a;
//   Real b = f(a);
// end FunctionVariability;
// endResult

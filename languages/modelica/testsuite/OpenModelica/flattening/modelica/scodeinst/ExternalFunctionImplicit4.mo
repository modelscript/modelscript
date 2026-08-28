// name: ExternalFunctionImplicit4
// keywords:
// status: correct
//
//

function f
  input Real x;
  output Real y[3];
  external;
end f;

model ExternalFunctionImplicit4
  Real y[3];
algorithm
  y := f(1.0);
end ExternalFunctionImplicit4;

// Result:
// impure function f
//   input Real x;
//   output Real[3] y;
//
//   external "C" f(x, y, size(y, 1));
// end f;
//
// class ExternalFunctionImplicit4
//   Real y[1];
//   Real y[2];
//   Real y[3];
// algorithm
//   y := f(1.0);
// end ExternalFunctionImplicit4;
// endResult

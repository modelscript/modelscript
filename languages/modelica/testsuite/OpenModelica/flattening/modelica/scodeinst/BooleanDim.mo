// name: BooleanDim.mo
// keywords:
// status: correct
// xfail:    true
//

model BooleanDim
  Real x[Boolean];
end BooleanDim;

// Result:
// class BooleanDim
//   Real x[false];
//   Real x[true];
// end BooleanDim;
// endResult

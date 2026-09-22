// name: ErrorUnknownDimension
// status: incorrect
// xfail:    true

model ErrorUnknownDimension
  Real r[:];
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end ErrorUnknownDimension;
// Result:
// class ErrorUnknownDimension
//   Real r[1];
// end ErrorUnknownDimension;
// endResult

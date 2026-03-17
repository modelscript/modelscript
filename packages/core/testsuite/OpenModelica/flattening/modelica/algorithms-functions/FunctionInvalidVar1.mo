// name:     FunctionInvalidVar1
// keywords: function
// status:   incorrect
//
// Checks restrictions on function variable types.
//

model M
  Real r;
end M;

function F
  input M m;
end F;

model FunctionInvalidVar1
  M m;
algorithm
  F(m);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end FunctionInvalidVar1;

// Result:
// [flattening/modelica/algorithms-functions/FunctionInvalidVar1.mo:13:11-13:12] Error: [M4010] Invalid type .M for function component m.
// endResult

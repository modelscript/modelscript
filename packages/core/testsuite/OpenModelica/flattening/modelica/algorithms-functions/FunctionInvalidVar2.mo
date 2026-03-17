// name:     FunctionInvalidVar2
// keywords: function
// status:   incorrect
//
// Checks restrictions on function variable types.
//

connector C
  Real r;
  flow Real f;
end C;

function F
  input C c;
end F;

model FunctionInvalidVar2
  C c;
algorithm
  F(c);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end FunctionInvalidVar2;

// Result:
// [flattening/modelica/algorithms-functions/FunctionInvalidVar2.mo:14:11-14:12] Error: [M4010] Invalid type .C for function component c.
// endResult

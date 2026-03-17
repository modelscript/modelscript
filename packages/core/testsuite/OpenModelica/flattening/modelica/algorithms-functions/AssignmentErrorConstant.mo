// name: AssignmentErrorConstant
// status: incorrect

model AssignmentErrorConstant
  constant Real r = 5.0;
algorithm
  r := 3.0;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end AssignmentErrorConstant;

// Result:
// [flattening/modelica/algorithms-functions/AssignmentErrorConstant.mo:7:3-7:12] Error: [M5008] Trying to assign to constant component 'r'.
// endResult

// name:     RedeclareFlowEffort
// keywords: modification
// status:   incorrect
//
// Redeclaration that changes flow/non-flow is not allowed.
//

connector Connector
  flow Real f;
  replaceable Real e;
end Connector;

class RedeclareFlowEffort
  Connector c1, c2(redeclare flow Real e);
equation
  connect(c1, c2);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end RedeclareFlowEffort;
// Result:
// Error processing file: RedeclareFlowEffort.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/redeclare/RedeclareFlowEffort.mo:16:3-16:18:writable] Error: Cannot connect flow component c2.e to non-flow component c1.e.
// [OpenModelica/flattening/modelica/redeclare/RedeclareFlowEffort.mo:16:3-16:18:writable] Error: The type of variables 
// c1 type:
// connector Connector
//   Real e;
//   flow Real f;
// end Connector; and 
// c2 type:
// connector Connector$c2
//   flow Real e;
//   flow Real f;
// end Connector$c2;
// are inconsistent in connect equations.
// Error: Error occurred while flattening model RedeclareFlowEffort
//
// Execution failed!
// endResult

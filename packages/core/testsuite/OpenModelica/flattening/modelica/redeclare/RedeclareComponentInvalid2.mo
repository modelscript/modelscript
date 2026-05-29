// name:     RedeclareComponentInvalid2
// keywords: redeclare component
// status:   incorrect
//
// Tests that only inherited components can be redeclared.
//

class RedeclareComponentInvalid2
  replaceable Real r;
  redeclare Real r(start = 1.0);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end RedeclareComponentInvalid2;

// Result:
// Error processing file: RedeclareComponentInvalid2.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/redeclare/RedeclareComponentInvalid2.mo:10:3-10:32:writable] Error: Illegal redeclare of element r, no inherited element with that name exists.
// Error: Error occurred while flattening model RedeclareComponentInvalid2
//
// Execution failed!
// endResult

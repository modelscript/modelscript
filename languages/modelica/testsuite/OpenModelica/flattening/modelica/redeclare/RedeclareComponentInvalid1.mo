// name:     RedeclareComponentInvalid1
// keywords: redeclare component
// status:   incorrect
//
// Tests that a component redeclaration needs a corresponding inherited
// component to redeclare.
//

class RedeclareComponentInvalid1
  redeclare Real r;
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end RedeclareComponentInvalid1;

// Result:
// Error processing file: RedeclareComponentInvalid1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/redeclare/RedeclareComponentInvalid1.mo:10:3-10:19:writable] Error: Illegal redeclare of element r, no inherited element with that name exists.
// Error: Error occurred while flattening model RedeclareComponentInvalid1
//
// Execution failed!
// endResult

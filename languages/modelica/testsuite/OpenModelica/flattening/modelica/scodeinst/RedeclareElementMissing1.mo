// name: RedeclareElementMissing1
// keywords:
// status: incorrect
//

model RedeclareElementMissing1
  redeclare Real x = 2.0;
end RedeclareElementMissing1;  

// Result:
// Error processing file: RedeclareElementMissing1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/RedeclareElementMissing1.mo:7:3-7:25:writable] Error: Illegal redeclare of element x, no inherited element with that name exists.
//
// Execution failed!
// endResult

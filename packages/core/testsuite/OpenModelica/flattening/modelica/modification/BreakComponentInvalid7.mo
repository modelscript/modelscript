// name:     BreakComponentInvalid7
// keywords: modification break
// status:   incorrect
//

model A
  Real x[3];
end A;

model BreakComponentInvalid7
  extends A(break a[2]);
end BreakComponentInvalid7;

// Result:
// Error processing file: BreakComponentInvalid7.mo
// [OpenModelica/flattening/modelica/modification/BreakComponentInvalid7.mo:11:20-11:20:writable] Error: Missing token: ')'
// Error: Failed to load package BreakComponentInvalid7 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class BreakComponentInvalid7 not found in scope <top>.
// Error: Error occurred while flattening model BreakComponentInvalid7
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

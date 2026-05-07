// name:     Constant9
// keywords: constant, package
// status:   incorrect
//
// Lookup of variables in packages must result in variable being constant. Parameters and variables
// are not allowed to look up in packages.


package A
  parameter Real x=1;
end A;

model test
  Real x=A.x;
end test;
// Result:
// Error processing file: Constant9.mo
// Error: Failed to load package Constant9 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Constant9 not found in scope <top>.
// Error: Error occurred while flattening model Constant9
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

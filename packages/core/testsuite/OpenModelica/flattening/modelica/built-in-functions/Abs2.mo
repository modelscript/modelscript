// name:     Abs2
// keywords: abs operator
// status:   incorrect
//
//  The abs operator
//


model Abs
  Boolean b;
equation
  b=abs(b);
end Abs;

// Result:
// Error processing file: Abs2.mo
// Error: Failed to load package Abs2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Abs2 not found in scope <top>.
// Error: Error occurred while flattening model Abs2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

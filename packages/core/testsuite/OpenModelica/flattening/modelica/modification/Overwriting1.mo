// name:     Overwriting1
// keywords: modification,equation
// status:   correct
//
// The modification does not overwrite the equation

partial class A
  Real x, u;
equation
  x = 2.0 * u;
end A;

class Overwriting1 = A(x = 5.0) 

// Result:
// Error processing file: Overwriting1.mo
// [OpenModelica/flattening/modelica/modification/Overwriting1.mo:23:0-23:0:writable] Error: Missing token: SEMICOLON
// Error: Failed to load package Overwriting1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Overwriting1 not found in scope <top>.
// Error: Error occurred while flattening model Overwriting1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

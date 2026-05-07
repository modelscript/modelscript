// name: FunctionSections4
// keywords:
// status: incorrect
//
//

partial function base_f
  input Real x;
  output Real y;
external "C";
end base_f;

function f
  extends base_f;
external "C";
end f;

model FunctionSections3
  Real x = f(time);
end FunctionSections3;

// Result:
// Error processing file: FunctionSections4.mo
// Error: Failed to load package FunctionSections4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class FunctionSections4 not found in scope <top>.
// Error: Error occurred while flattening model FunctionSections4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

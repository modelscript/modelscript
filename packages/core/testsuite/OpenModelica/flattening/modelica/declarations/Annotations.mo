// name:     Annotations
// keywords: declaration annotations comments
// status:   correct
//
// Checks that annotations are output correctly on the flat code when
// +showAnnotations is used.
//

function f "Some comment"
  input Real x "comment";
  output Real y annotation(key = value);
algorithm
  y := x;
  annotation(key = value);
end f;

class c
  Real x "x" annotation(key = value);
equation
  x = f(time);
  annotation(key = value);
end c;

// Result:
// Error processing file: Annotations.mo
// Error: Failed to load package Annotations (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Annotations not found in scope <top>.
// Error: Error occurred while flattening model Annotations
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

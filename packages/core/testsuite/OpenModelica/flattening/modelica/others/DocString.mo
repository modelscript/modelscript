// name: DocString.mo
// keywords: comment, documentation string
// status: correct
//
// This file tests ""-documentation strings in various places
//

model DocString "DocString"
  Real x = 2 "Real named x";
  Real y "Real named y";
equation
  y = f(x) "y is the value of the function f of x";
end DocString;

function f "Function f"
  input Real x "input Real named x";
  output Real y "output Real named y";
algorithm
  y := x + 2 "the result is 2 added to x";
end f;

// Result:
// Error processing file: DocString.mo
// Error: Class DocString.mo not found in scope <top>.
// Error: Error occurred while flattening model DocString.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

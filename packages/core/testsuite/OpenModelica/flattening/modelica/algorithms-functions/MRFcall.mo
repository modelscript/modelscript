// name:     MultipleResultsFunction
// keywords: multiple results
// status:   correct
//
// Multipe results from a function
//


function MultipleResultsFunction
  input Real x;
  input Real y;
  output Real r1;
  output Real r2;
  output Real r3;
algorithm
  r1 := x + y;
  r2 := x * y;
  r3 := x - y;
end MultipleResultsFunction;

class MRFcall
  Real a, b, c;
equation
  (a, b, c) = MultipleResultsFunction(2.0, 1.0);
end MRFcall;

// Result:
// Error processing file: MRFcall.mo
// [OpenModelica/flattening/modelica/algorithms-functions/MRFcall.mo:9:1-19:28:writable] Error: Cannot instantiate MultipleResultsFunction due to class specialization function.
// Error: Error occurred while flattening model MultipleResultsFunction
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

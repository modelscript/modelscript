// name:     Array7
// keywords: array,array of components
// status:   correct
//
// This demonstrates how a modifier is split
// among a an array of componets.
//
// It also demonstrates heterogenous arrays (a.x).
//
model Array7
  model A
    parameter Integer n;
    parameter Real x[n,n];
  end A;
  A a[2](n={1,2});
end Array7;

// Result:
// Error processing file: Array7.mo
// [OpenModelica/flattening/modelica/arrays/Array7.mo:13:5-13:26:writable] Error: Parameter a[1].x has neither value nor start value, and is fixed during initialization (fixed=true).
// Error: Error occurred while flattening model Array7
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

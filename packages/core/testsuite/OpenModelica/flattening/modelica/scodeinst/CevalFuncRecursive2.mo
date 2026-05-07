// name: CevalFuncRecursive2
// keywords:
// status: incorrect
//
//

function f
  input Real x;
  output Real y;
algorithm
  y := f(x + 1);
end f;

model CevalFuncRecursive2
  constant Real x = f(3.0);
end CevalFuncRecursive2;

// Result:
// Error processing file: CevalFuncRecursive2.mo
// [OpenModelica/flattening/modelica/scodeinst/CevalFuncRecursive2.mo:7:1-12:6:writable] Error: The recursion limit (--evalRecursionLimit=256) was exceeded during evaluation of f.
// Error: Error occurred while flattening model CevalFuncRecursive2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

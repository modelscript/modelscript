// name: Time3
// keywords:
// status: incorrect
//

function f
  output Real x;
algorithm
  x := time;
end f;

model Time3
  Real x = f();
end Time3;

// Result:
// Error processing file: Time3.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/Time3.mo:9:3-9:12:writable] Error: time is not allowed in a function.
//
// Execution failed!
// endResult

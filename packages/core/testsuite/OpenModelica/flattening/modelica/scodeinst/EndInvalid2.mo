// name: EndInvalid2
// keywords:
// status: incorrect
//
//

model EndInvalid2
  Real x;
equation
  x[end] = 1;
end EndInvalid2;

// Result:
// Error processing file: EndInvalid2.mo
// [OpenModelica/flattening/modelica/scodeinst/EndInvalid2.mo:10:3-10:13:writable] Error: Wrong number of subscripts in x[end] (1 subscripts for 0 dimensions).
// Error: Error occurred while flattening model EndInvalid2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

// name: AssertInvalid3
// keywords:
// status: incorrect
//

model AssertInvalid3
equation
  assert(false, "message", 1);
end AssertInvalid3;

// Result:
// Error processing file: AssertInvalid3.mo
// [OpenModelica/flattening/modelica/scodeinst/AssertInvalid3.mo:8:3-8:30:writable] Error: Type mismatch for positional argument 3 in assert(level=1). The argument has type:
//   Integer
// expected type:
//   enumeration AssertionLevel(warning, error)
// Error: Error occurred while flattening model AssertInvalid3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

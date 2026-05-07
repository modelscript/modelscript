// name: BuiltinTimeSubscripted
// keywords:
// status: incorrect
//
//

model BuiltinTimeSubscripted
  Real x = time[2];
end BuiltinTimeSubscripted;

// Result:
// Error processing file: BuiltinTimeSubscripted.mo
// [OpenModelica/flattening/modelica/scodeinst/BuiltinTimeSubscripted.mo:8:3-8:19:writable] Error: Wrong number of subscripts in time[2] (1 subscripts for 0 dimensions).
// Error: Error occurred while flattening model BuiltinTimeSubscripted
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

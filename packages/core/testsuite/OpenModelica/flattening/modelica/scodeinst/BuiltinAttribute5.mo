// name: BuiltinAttribute5
// keywords:
// status: incorrect
//

model BuiltinAttribute5
  Real x(start = "fish");
end BuiltinAttribute5;

// Result:
// Error processing file: BuiltinAttribute5.mo
// [OpenModelica/flattening/modelica/scodeinst/BuiltinAttribute5.mo:7:10-7:24:writable] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/BuiltinAttribute5.mo:7:3-7:25:writable] Error: Type mismatch in binding start = "fish", expected subtype of Real, got type String.
// Error: Error occurred while flattening model BuiltinAttribute5
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

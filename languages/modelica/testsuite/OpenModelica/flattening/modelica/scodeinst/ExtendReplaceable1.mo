// name: ExtendReplaceable1
// keywords:
// status: incorrect
//

model ExtendReplaceable1
  replaceable model M
    Real x;
  end M;

  extends M;
end ExtendReplaceable1;

// Result:
// Error processing file: ExtendReplaceable1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/ExtendReplaceable1.mo:7:15-9:8:writable] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/ExtendReplaceable1.mo:11:3-11:12:writable] Error: Class 'M' in 'extends M' is replaceable, the base class name must be transitively non-replaceable.
//
// Execution failed!
// endResult

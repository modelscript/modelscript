// name: Each3
// keywords:
// status: incorrect
//

model A
  Real n[2];
end A;

model Each3
  A a(each n(fixed=true));
end Each3;

// Result:
// Error processing file: Each3.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/Each3.mo:11:14-11:24:writable] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/Each3.mo:7:3-7:12:writable] Error: Non-array modification 'true' for array component 'fixed', possibly due to missing 'each'.
//
// Execution failed!
// endResult

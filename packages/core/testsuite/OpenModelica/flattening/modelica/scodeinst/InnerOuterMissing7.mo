// name: InnerOuterMissing7
// keywords:
// status: incorrect
//

model A
  outer Real x;
end A;

model InnerOuterMissing7
  A a;
  Real x;
end InnerOuterMissing7;

// Result:
// Error processing file: InnerOuterMissing7.mo
// [OpenModelica/flattening/modelica/scodeinst/InnerOuterMissing7.mo:12:3-12:9:writable] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/InnerOuterMissing7.mo:7:3-7:15:writable] Error: An inner declaration for outer element 'x' could not be found, and could not be automatically generated due to an existing declaration of that name.
// Error: Error occurred while flattening model InnerOuterMissing7
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

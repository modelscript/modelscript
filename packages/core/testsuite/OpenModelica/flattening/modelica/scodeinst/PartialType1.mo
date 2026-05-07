// name: PartialType1
// keywords:
// status: incorrect
//

partial model A
  Real x;
end A;

model PartialType1
  A a;
end PartialType1;

// Result:
// Error processing file: PartialType1.mo
// [OpenModelica/flattening/modelica/scodeinst/PartialType1.mo:6:1-8:6:writable] Notification: From here:
// [OpenModelica/flattening/modelica/scodeinst/PartialType1.mo:11:3-11:6:writable] Error: Component 'a' has partial type 'A'.
// Error: Error occurred while flattening model PartialType1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

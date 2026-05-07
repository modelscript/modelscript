// name: InnerOuterInvalidMod1
// keywords: 
// status: incorrect
//

model A
  outer Real x = 1.0;
end A;

model InnerOuterInvalidMod1
  inner Real x = 2.0;
  A a;
end InnerOuterInvalidMod1;

// Result:
// Error processing file: InnerOuterInvalidMod1.mo
// [OpenModelica/flattening/modelica/scodeinst/InnerOuterInvalidMod1.mo:7:3-7:21:writable] Error: Modifier ' = 1.0' found on outer element x.
// Error: Error occurred while flattening model InnerOuterInvalidMod1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

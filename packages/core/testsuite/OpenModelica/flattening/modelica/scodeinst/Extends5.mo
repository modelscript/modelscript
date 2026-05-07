// name: Extends5.mo
// keywords:
// status: correct
//
// Checks that the lookup finds the correct element when the component scope has
// the same name as the extended class.
//

model A
  Real x;
end A;

model B
  extends A;
end B;

model Extends5
  B A;
end Extends5;

// Result:
// Error processing file: Extends5.mo
// Error: Class Extends5.mo not found in scope <top>.
// Error: Error occurred while flattening model Extends5.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

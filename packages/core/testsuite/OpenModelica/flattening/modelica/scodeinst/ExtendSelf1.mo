// name: ExtendSelf1.mo
// keywords:
// status: correct
//
// Checks that a class can extend a local class via itself.
//

model ExtendSelf1
  encapsulated model A
    Real x = 1;
  end A;

  extends ExtendSelf1.A;
end ExtendSelf1;

// Result:
// Error processing file: ExtendSelf1.mo
// Error: Class ExtendSelf1.mo not found in scope <top>.
// Error: Error occurred while flattening model ExtendSelf1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

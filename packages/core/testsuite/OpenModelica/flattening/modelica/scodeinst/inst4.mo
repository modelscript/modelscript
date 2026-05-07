// name: inst4.mo
// keywords:
// status: incorrect
//
//


type B
  Real x;
end B;

class MyReal
  extends Real;
  extends B;
end MyReal;

model A
  MyReal r;
end A;

// Result:
// Error processing file: inst4.mo
// [<interactive>:12:1-15:11:writable] Error: A class extending from builtin type Real may not have other elements.
// Error: Error occurred while flattening model A
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

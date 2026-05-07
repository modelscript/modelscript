// name: usertype6.mo
// keywords:
// status: incorrect
//

type MyReal
  extends Real;
  Real y;
end MyReal;

model M
  MyReal x;
end M;

// Result:
// Error processing file: usertype6.mo
// [<interactive>:6:1-9:11:writable] Error: A class extending from builtin type Real may not have other elements.
// Error: Error occurred while flattening model M
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

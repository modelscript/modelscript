// name: RecursiveExtends3
// keywords:
// status: incorrect
//
// Checks that the compiler catches recursive extends.
//

model A
  Real x;
end A;

model RecursiveExtends3
  model A = A;
  A a;
end RecursiveExtends3;

// Result:
// Error processing file: RecursiveExtends3.mo
// [OpenModelica/flattening/modelica/scodeinst/RecursiveExtends3.mo:13:3-13:14:writable] Error: Recursive short class definition of A in terms of A.
// Error: Error occurred while flattening model RecursiveExtends3
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

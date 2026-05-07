// name: RecursiveExtends2
// keywords:
// status: incorrect
//
// Checks that the compiler catches recursive extends.
//

model A
  model B
    extends A;
    Real x;
  end B;

  B b;
end A;

model RecursiveExtends2
  extends A.B;
end RecursiveExtends2;

// Result:
// Error processing file: RecursiveExtends2.mo
// [OpenModelica/flattening/modelica/scodeinst/RecursiveExtends2.mo:10:5-10:14:writable] Error: extends A causes an instantiation loop.
// [OpenModelica/flattening/modelica/scodeinst/RecursiveExtends2.mo:18:3-18:14:writable] Error: Base class A.B not found in scope RecursiveExtends2.
// Error: Error occurred while flattening model RecursiveExtends2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

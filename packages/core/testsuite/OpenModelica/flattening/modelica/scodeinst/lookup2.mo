// name: lookup2.mo
// keywords:
// status: incorrect
//

model A
  model B
    model C
      Real x;
    end C;
  end B;

  B b;
end A;

model M
  A a;
  A.b.C c;
end M;

// Result:
// Error processing file: lookup2.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/lookup2.mo:18:3-18:10:writable] Error: Class name 'A.b.C' was found via a component (only component and function call names may be accessed in this way).
//
// Execution failed!
// endResult

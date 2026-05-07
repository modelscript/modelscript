// name: lookup1.mo
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
  a.B b;
end M;

// Result:
// Error processing file: lookup1.mo
// [<interactive>:18:3-18:8:writable] Error: Class name 'a.B' was found via a component (only component and function call names may be accessed in this way).
// Error: Error occurred while flattening model M
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

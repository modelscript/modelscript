// name: lookup4.mo
// keywords:
// status: incorrect
//

model A
  model B
    model C
      model D
        Real x;
      end D;

      constant D d;
    end C;
  end B;

  constant B b;
end A;

model M
  A a;
  Real x = a.b.C.d.x;
end M;

// Result:
// Error processing file: lookup4.mo
// [<interactive>:22:3-22:21:writable] Error: Found component 'd' in composite name 'a.b.C.d.x', expected class.
// Error: Error occurred while flattening model M
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

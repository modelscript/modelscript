// name: const11.mo
// keywords:
// status: correct
//

package P
  model A
    constant Integer j = 2;

    model B
      constant Integer i = j;
    end B;
  end A;

  model C
    Integer x = P.A.B.i;
    A a(j = 3);
    Integer y = a.j;
    A.B b;
    Integer z = b.i;
  end C;

  model D
    extends A;
    Integer w = j;
    Integer v = B.i;
  end D;
end P;

model M
  extends P.C;
  extends P.D;
end M;

// Result:
// Error processing file: const11.mo
// Error: Failed to load package const11 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const11.mo not found in scope <top>.
// Error: Error occurred while flattening model const11.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

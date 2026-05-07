// name: const1.mo
// keywords:
// status: correct
//


package P
  constant Integer i = 2;
end P;

model A
  constant Integer j = 3;
end A;

model B
  extends A(j = 5);
  A a(j = 4);
  P p(i = 9);

  Real x[P.i];
  Real y[j];
  Real z[a.j];
  Real w[A.j];
  Real v[p.i];
  constant Integer i = 0;
end B;

// Result:
// Error processing file: const1.mo
// Error: Failed to load package const1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class const1.mo not found in scope <top>.
// Error: Error occurred while flattening model const1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

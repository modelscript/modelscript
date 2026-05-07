// name: arrfunc.mo
// keywords:
// status: incorrect
//
//


model A
  constant Real z;

  function f
    input Real x;
    output Real y;
  algorithm
    y := x * z;
  end f;
end A;

model B
  A a[2](z = {1, 2});
  Real x1 = a[1].f(3);
  Real x2 = a[2].f(3);
end B;

// Result:
// Error processing file: arrfunc.mo
// Error: Failed to load package arrfunc (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class arrfunc.mo not found in scope <top>.
// Error: Error occurred while flattening model arrfunc.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

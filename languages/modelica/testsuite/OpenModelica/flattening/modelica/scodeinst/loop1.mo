// name: loop1.mo
// keywords:
// status: incorrect
//
//


model A
  constant Integer b = a;
  constant Integer a = i;
  constant Integer i = j;
  constant Integer x[i];
  constant Integer j = size(x, 1);
end A;

// Result:
// Error processing file: loop1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/loop1.mo:12:3-12:24:writable] Error: Dimension 1 of x, 'i', could not be evaluated due to a cyclic dependency.
//
// Execution failed!
// endResult

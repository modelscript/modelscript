class TypeTestArrayBug

  type Wrong = Real[2](unit = "m");
  Wrong w;

  type Good = Wrong[2](each quantity = "Good");
  Good g;

  type Bubu = Real(unit = "m");
  type B = Bubu[2];
  B[3] z(each quantity = "Length");

  type A = B[10](each quantity = "SomeQ");
  A[4] a[5](each nominal = 5);

end TypeTestArrayBug;


// Result:
// Error processing file: TypeTestArrayBug.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/arrays/TypeTestArrayBug.mo:3:24-3:34:writable] Notification: From here:
// [OpenModelica/flattening/modelica/arrays/TypeTestArrayBug.mo:4:3-4:10:writable] Error: Non-array modification '"m"' for array component 'unit', possibly due to missing 'each'.
//
// Execution failed!
// endResult

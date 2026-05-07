// name: IntervalTest
// keywords: synchronous features
// status: correct

model IntervalTest
  Real y[2], u[2];
  Integer x(start=0);
equation
  x = previous(x);
  y = interval(u);
end IntervalTest;

// Result:
// Error processing file: IntervalTest.mo
// [OpenModelica/flattening/modelica/synchronous/IntervalTest.mo:10:3-10:18:writable] Error: Type mismatch in equation y = interval(u) of type Real[2] = Real.
// Error: Error occurred while flattening model IntervalTest
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

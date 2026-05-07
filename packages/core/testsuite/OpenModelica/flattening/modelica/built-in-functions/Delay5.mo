// name:     Delay5
// keywords: builtin
// status:   incorrect
//
// Test flattening of the builtin function delay.
// Should issue an error as a is not parameter/constant.
//

model Delay
  Real x, y, z;
  Real a=1.0;
equation
  x = sin(time);
  y = delay(x, a);
  z = delay(x, a, a);
end Delay;

// Result:
// Error processing file: Delay5.mo
// [<interactive>:14:3-14:18:writable] Error: No matching function found for delay(/*Real*/ x, /*Real*/ a).
// Candidates are:
//   OpenModelica.Internal.delay2(Real expr, parameter Real delayTime) => Real
//   delay(Real expr, Real delayTime, parameter Real delayMax) => Real
// Error: Error occurred while flattening model Delay
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

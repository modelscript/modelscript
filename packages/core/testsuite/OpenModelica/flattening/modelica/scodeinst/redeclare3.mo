// name: redeclare3.mo
// keywords:
// status: incorrect
//
// FAILREASON: Invalid usage of time inside function not checked.
//

package A
  function f
    replaceable input Real x;
    output Real y = x;
  end f;
end A;

model B
  function f = A.f(redeclare Real x = time);
  Real x = f();
end B;

// Result:
// Error processing file: redeclare3.mo
// [<interactive>:16:20-16:43:writable] Error: time is not allowed in a function.
// Error: Error occurred while flattening model B
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

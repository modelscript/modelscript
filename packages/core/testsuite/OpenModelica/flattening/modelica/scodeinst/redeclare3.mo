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
// Error: Failed to load package redeclare3 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class redeclare3.mo not found in scope <top>.
// Error: Error occurred while flattening model redeclare3.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

// name:     reinit
// keywords: reinit
// status:   correct
//
// using reinit in when initial() is not allowed, changed to assignment
//

block FilterBlock1
  parameter Real T = 1 "Time constant";
  parameter Real k = 1 "Gain";
  input Real u = 1;
  output Real y;
protected
  Real x;
equation
  der(x) = (u - x)/T;
  y = k*x;
initial algorithm
  x := u;
algorithm
  when time > 0 then
    reinit(x, u); // if x is u since der(x) = (u - x)/T
  end when;
end FilterBlock1;

// Result:
// Error processing file: reinit.mo
// [/usr/lib/omc/NFModelicaBuiltin.mo:521:1-528:11:readonly] Error: Cannot instantiate reinit due to class specialization function.
// Error: Error occurred while flattening model reinit
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

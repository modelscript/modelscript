// name:     Redeclare4
// keywords: redeclare, bug #36
// status:   correct
//

package A
  model B
    parameter Real b=1.0;
    Real x;
  end B;
end A;

package E
model BB
  extends A.B;
equation
  der(x) = b;
end BB;
end E;

package F
model C
  parameter Real b=2.0;
  replaceable A.B d(final b=b);
equation
end C;
end F;

model D
  F.C c(b=5, redeclare E.BB d);
end D;


// Result:
// Error processing file: Redeclare4.mo
// Error: Failed to load package Redeclare4 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Redeclare4 not found in scope <top>.
// Error: Error occurred while flattening model Redeclare4
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

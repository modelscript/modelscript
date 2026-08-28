// name: expconn6.mo
// keywords:
// status: correct
//
// FAILREASON: Expandable connectors not handled yet.
//

expandable connector EC
  Real r;
end EC;

model M
  EC ec, ec2;
equation
  connect(ec.r, ec2.e);
end M;

// Result:
// Error processing file: expconn6.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/scodeinst/expconn6.mo:15:3-15:23:writable] Error: Cannot connect undeclared connectors ec.r with ec2.e. At least one of them must be declared.
//
// Execution failed!
// endResult

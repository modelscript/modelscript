// name: ExpandableConnectorNonDecl3
// keywords: expandable connector
// status: incorrect
// xfail:    true
//
//

connector RealInput = input Real;

expandable connector EC
end EC;

model ExpandableConnectorNonDecl3
  RealInput ri;
  EC ec;
equation
  connect(ec.c.ri, ri);
end ExpandableConnectorNonDecl3;

// Result:
// Error processing file: ExpandableConnectorNonDecl3.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Error: Internal error Augmenting a virtual element in an expandable connector is not yet supported.
//
// Execution failed!
// endResult

// name: ExpandableConnectorNonDecl1
// keywords: expandable connector
// status: incorrect
//
//

expandable connector EC
end EC;

model ExpandableConnectorNonDecl1
  EC ec1, ec2;
equation
  connect(ec1.c, ec2.c);
end ExpandableConnectorNonDecl1;

// Result:
// Error processing file: ExpandableConnectorNonDecl1.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Error: Cannot connect undeclared connectors ec1.c with ec2.c. At least one of them must be declared.
//
// Execution failed!
// endResult

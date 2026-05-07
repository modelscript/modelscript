// name:     ConnectorInheritance1.mo
// keywords: connector, record, inheritance
// status:   correct
//
// Connectors may inherit from records.
//

record A
  Real x;
end A;

connector ConnectorInheritance1 = A;

// Result:
// Error processing file: ConnectorInheritance1.mo
// Error: Class ConnectorInheritance1.mo not found in scope <top>.
// Error: Error occurred while flattening model ConnectorInheritance1.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

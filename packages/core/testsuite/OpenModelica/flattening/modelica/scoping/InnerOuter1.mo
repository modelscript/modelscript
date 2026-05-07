// name:     InnerOuter1
// keywords: dynamic scope, lookup
// status:   correct
//
//  components with inner prefix references an outer component with
//  the same name and one variable is generated for all of them.
//

class A
  outer Real T0;
end A;

class B
  inner Real T0=100;
  A a1, a2; // B.T0, B.a1.T0 and B.a2.T0 is the same variable
end B;

// Result:
// Error processing file: InnerOuter1.mo
// Error: Failed to load package InnerOuter1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class InnerOuter1 not found in scope <top>.
// Error: Error occurred while flattening model InnerOuter1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

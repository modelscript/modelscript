// name:     Each1
// keywords: Each modifier
// status:   correct
//
// Testcase from Modelica specification.
//
model C
  parameter Real a[3];
  parameter Real d;
end C;
model B
  C c[5](each a={1,2,3},d={1,2,3,4,5});
end B;
// Result:
// Error processing file: Each1.mo
// Error: Failed to load package Each1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class Each1 not found in scope <top>.
// Error: Error occurred while flattening model Each1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

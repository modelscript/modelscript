// name: redeclare11.mo
// keywords:
// status: correct
//
//
//

model ModelA
  parameter Real a = 10 ;
end ModelA;

model ModelB
  replaceable model Model = ModelA;
  Model m;
end ModelB;

model Test3
  model ModelA1 = ModelA(final a = 1);

  ModelB b( redeclare model Model = ModelA(a = 1));
  ModelB b1( redeclare model Model = ModelA1);
  ModelA1 a;
end Test3;

// Result:
// Error processing file: redeclare11.mo
// Error: Failed to load package redeclare11 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class redeclare11.mo not found in scope <top>.
// Error: Error occurred while flattening model redeclare11.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

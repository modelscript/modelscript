// name: redeclare12.mo
// keywords:
// status: correct
//
//


model MyInternalModel
  parameter Real par = 1;
end MyInternalModel;

model MyModel
  replaceable model ReplaceableInternalModel = MyInternalModel;
  ReplaceableInternalModel internalModel;
end MyModel;

model MyTestModel
  parameter Real localPar = 1;
  MyModel intModel(redeclare model ReplaceableInternalModel = MyInternalModel(final par = localPar));
end MyTestModel;

// Result:
// Error processing file: redeclare12.mo
// Error: Failed to load package redeclare12 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class redeclare12.mo not found in scope <top>.
// Error: Error occurred while flattening model redeclare12.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

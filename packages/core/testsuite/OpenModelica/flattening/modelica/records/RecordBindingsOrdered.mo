// name:     RecordBindingsOrdered
// keywords: record parameter
// status:   correct
//
// Tests records elements get bindings properly and in the correct order.
// Fix for bug #1675: https://openmodelica.org:8443/cb/issue/1675
//

record GenericData
  parameter Integer dataOne = 1;
  parameter Integer dataTwo = 1;
end GenericData;

record DataSetOne = GenericData(dataOne = 5, dataTwo = 10);
record DataSetTwo = GenericData(dataOne = 15, dataTwo = 20);

model HasRecordAsParameter
  parameter GenericData data;
  Integer variable;
equation
  variable = data.dataOne;
end HasRecordAsParameter;

model PassesRecordAsParameter
  parameter DataSetOne data;
  HasRecordAsParameter parameterReceiver(data = data);
  Integer variable;
equation
  variable = parameterReceiver.variable;
end PassesRecordAsParameter;

model PassesRecordArrayAsParameter
  parameter DataSetOne data1;
  parameter DataSetTwo data2;
  parameter GenericData data[2]={data1,data2};
  HasRecordAsParameter parameterReceiver[2](data = data);
  Integer variable;
equation
  variable = parameterReceiver[1].variable;
end PassesRecordArrayAsParameter;

// Result:
// Error processing file: RecordBindingsOrdered.mo
// Error: Failed to load package RecordBindingsOrdered (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class RecordBindingsOrdered not found in scope <top>.
// Error: Error occurred while flattening model RecordBindingsOrdered
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

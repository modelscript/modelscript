// name:     AssertTest1
// keywords: assert
// status:   correct
//
// Drmodelica: 9.1 assert (p. 298)
//

class AssertTest
  parameter Real lowlimit;
  parameter Real highlimit;
  Real x = 5;
equation
  assert(x >= lowlimit and x <= highlimit, "Variable x out of limit");
end AssertTest;

class Test1
  AssertTest assertTest(lowlimit = 4, highlimit = 8);
end Test1;

// Result:
// Error processing file: AssertTest1.mo
// Error: Failed to load package AssertTest1 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class AssertTest1 not found in scope <top>.
// Error: Error occurred while flattening model AssertTest1
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

// name:     AssertTest2
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

class Test2
  AssertTest assertTest(lowlimit = 6, highlimit = 20);
end Test2;

// Result:
// Error processing file: AssertTest2.mo
// Error: Failed to load package AssertTest2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class AssertTest2 not found in scope <top>.
// Error: Error occurred while flattening model AssertTest2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

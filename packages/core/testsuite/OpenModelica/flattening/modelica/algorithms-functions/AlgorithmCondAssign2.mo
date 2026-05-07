// name:     AlgorithmCondAssign
// keywords: for statement, if statement
// status:   correct
//
// Assignments within if-Statements
// Drmodelica: 9.1  if-Statement (p. 292)
//

function CondAssignFunc
  input Real z;
  output Real x = 35;
  output Real y = 45;
algorithm
  if x > 5 then
    x := 400;
  end if;
  if z > 10 then
    y := 500;
  end if;
end CondAssignFunc;

model CondAssignFuncCall
  Real a, b;
equation
  (a, b) = CondAssignFunc(5);
end CondAssignFuncCall;

// Result:
// Error processing file: AlgorithmCondAssign2.mo
// Error: Failed to load package AlgorithmCondAssign (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class AlgorithmCondAssign not found in scope <top>.
// Error: Error occurred while flattening model AlgorithmCondAssign
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

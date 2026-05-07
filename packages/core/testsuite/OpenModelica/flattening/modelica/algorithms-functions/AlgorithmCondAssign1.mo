// name:     AlgorithmCondAssign
// keywords: for statement, if statement
// status:   correct
//
// Assignments within if-Statements
// Drmodelica: 9.1  if-Statement (p. 292)
//


model CondAssign
  Real x(start = 35);
  Real y(start = 45);
  parameter Real z = 0;
algorithm
  if x > 5 then
    x := 400;
  end if;
  if z > 10 then
    y := 500;
  end if;
end CondAssign;


// Result:
// Error processing file: AlgorithmCondAssign1.mo
// Error: Failed to load package AlgorithmCondAssign (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class AlgorithmCondAssign not found in scope <top>.
// Error: Error occurred while flattening model AlgorithmCondAssign
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

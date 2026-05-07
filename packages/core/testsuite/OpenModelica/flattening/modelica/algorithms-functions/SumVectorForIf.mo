// name:     SumVectorForIf
// keywords: for statement, if statement
// status:   correct
//
// Drmodelica: 9.1  if-Statement (p. 292)
//
class SumVector
  Real sum;
  parameter Real v[5] = {100, 200, -300, 400, 500};
  parameter Integer n = size(v, 1);
algorithm
  sum := 0;
  for i in 1:n loop
    if v[i] > 0 then
      sum := sum + v[i];
    elseif v[i] > -1 then
      sum := sum + v[i] - 1;
    else
      sum := sum - v[i];
    end if;
  end for;
end SumVector;

// Result:
// Error processing file: SumVectorForIf.mo
// Error: Failed to load package SumVectorForIf (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class SumVectorForIf not found in scope <top>.
// Error: Error occurred while flattening model SumVectorForIf
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

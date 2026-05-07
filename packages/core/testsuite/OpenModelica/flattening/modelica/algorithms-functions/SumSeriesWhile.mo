// name:     SumSeriesWhile
// keywords: while statement
// status:   correct
//
// Drmodelica: 9.1 while-loop (p.290)
//
model SumSeries
  parameter Real eps = 1.E-6;
  Integer i;
  Real sum;
  Real delta;
algorithm
  i := 1;
  delta := exp(-0.01 * i);
  while delta >= eps loop
    sum := sum + delta;
    i := i + 1;
    delta := exp(-0.01 * i);
  end while;
end SumSeries;

// Result:
// Error processing file: SumSeriesWhile.mo
// Error: Failed to load package SumSeriesWhile (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class SumSeriesWhile not found in scope <top>.
// Error: Error occurred while flattening model SumSeriesWhile
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

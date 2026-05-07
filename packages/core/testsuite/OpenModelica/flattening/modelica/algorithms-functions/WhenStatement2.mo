// name:     WhenStatement2
// keywords: when
// status:   correct
//
//
//

class WhenStat2
  Real x(start = 1);
  Real y1;
  parameter Real y2 = 5;
  Real y3;
algorithm
  when {x > 2, sample(0, 2), x < 5} then
    y1 := sin(x);
    y3 := 2*x + y1 + y2;
  end when;
equation
  der(x) = 2*x;
end WhenStat2;


// Result:
// Error processing file: WhenStatement2.mo
// Error: Failed to load package WhenStatement2 (default) using MODELICAPATH /home/omar/.openmodelica/libraries/.
// Error: Class WhenStatement2 not found in scope <top>.
// Error: Error occurred while flattening model WhenStatement2
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

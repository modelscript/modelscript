// name:     ElementWiseMultiplication.mo
// keywords: function, array, algorithm
// status:   correct
//
// Drmodelica:
//

function ewm
  input Real[3] positionvector;
  output Real[3] result;
algorithm
  result := positionvector * 2;
end ewm;

model ElementWiseMultiplication
  Real inVector[3] = {3,6,1};
  Real result[3];
equation
  result = ewm(inVector);
end ElementWiseMultiplication;

// Result:
// Error processing file: ElementWiseMultiplication.mo
// Error: Class ElementWiseMultiplication.mo not found in scope <top>.
// Error: Error occurred while flattening model ElementWiseMultiplication.mo
//
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// Execution failed!
// endResult

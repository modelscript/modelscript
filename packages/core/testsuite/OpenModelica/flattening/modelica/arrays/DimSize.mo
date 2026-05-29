// name:     DimSize
// keywords: array
// status:   correct
//
// ??Error - not yet implemented
// Drmodelica: 7.7 Built-in Functions (p. 225)
//
class DimSize
  parameter Real[4, 1, 6] x = fill(1., 4, 1, 6);
  parameter Real dim = ndims(x);           // Returns 3
  parameter Real dimsize = size(x, 1);     // Returns 4
  parameter Real specsize[3] = size(x);    // Returns the vector {4, 1, 6}
equation
 // size(2*x + x) = size(x);                // This equation holds
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end DimSize;

// Result:
// class DimSize
//   parameter Real x[1,1,1] = 1.0;
//   parameter Real x[1,1,2] = 1.0;
//   parameter Real x[1,1,3] = 1.0;
//   parameter Real x[1,1,4] = 1.0;
//   parameter Real x[1,1,5] = 1.0;
//   parameter Real x[1,1,6] = 1.0;
//   parameter Real x[2,1,1] = 1.0;
//   parameter Real x[2,1,2] = 1.0;
//   parameter Real x[2,1,3] = 1.0;
//   parameter Real x[2,1,4] = 1.0;
//   parameter Real x[2,1,5] = 1.0;
//   parameter Real x[2,1,6] = 1.0;
//   parameter Real x[3,1,1] = 1.0;
//   parameter Real x[3,1,2] = 1.0;
//   parameter Real x[3,1,3] = 1.0;
//   parameter Real x[3,1,4] = 1.0;
//   parameter Real x[3,1,5] = 1.0;
//   parameter Real x[3,1,6] = 1.0;
//   parameter Real x[4,1,1] = 1.0;
//   parameter Real x[4,1,2] = 1.0;
//   parameter Real x[4,1,3] = 1.0;
//   parameter Real x[4,1,4] = 1.0;
//   parameter Real x[4,1,5] = 1.0;
//   parameter Real x[4,1,6] = 1.0;
//   parameter Real dim = 3.0;
//   parameter Real dimsize = 4.0;
//   parameter Real specsize[1] = 4.0;
//   parameter Real specsize[2] = 1.0;
//   parameter Real specsize[3] = 6.0;
// end DimSize;
// endResult

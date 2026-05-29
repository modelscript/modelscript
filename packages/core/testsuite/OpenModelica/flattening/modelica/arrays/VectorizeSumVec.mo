// name:     VectorizeSumVec
// keywords: <insert keywords here>
// status:   correct
//
// MORE WORK HAS TO BE DONE ON THIS FILE!
//
// Drmodelica: 7.8  Applied to Arrays  element-wise (p. 229)
//
class SumVec
  Real[3] v1 = {1, 2, 3};
  Real[3] v2 = {6, 4, 5};
  Real[3] v3 = {3, 7, 6};
  Real[3] v4 = {1, 3, 8};
  Real[2, 3] M1 = {v1, v2};
  Real[2, 3] M2 = {v3, v4};
  Real sv1[2] = atan2SumVec(M1, M2); // atan2SumVec({v1, v2}, {v3, v4}) <=> {atan2(sum(v1), sum(v2)), atan2(sum(v3), sum(v4))}
  Real sv2[2] = atan2SumVec({{1, 2}, {3, 4}}, {{6, 7},{8, 9}}); // {atan2(sum({1, 2}), sum({3, 4})), atan2(sum({6,7}), sum({8, 9}))}
  // <=> {atan2(3, 7), atan2(13, 17) }
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end SumVec;

// insert expected flat file here. Can be done by issuing the command
// ./omc XXX.mo >> XXX.mo and then comment the inserted class.
//
// Result:
// Error processing file: VectorizeSumVec.mo
// # Error encountered! Exiting...
// # Please check the error message and the flags.
//
// [OpenModelica/flattening/modelica/arrays/VectorizeSumVec.mo:17:3-17:63:writable] Error: Class atan2SumVec not found in scope SumVec (looking for a function or record).
// Error: Error occurred while flattening model SumVec
//
// Execution failed!
// endResult

// name:     AlgorithmCondAssign2
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

model AlgorithmCondAssign2
  Real a, b;
equation
  (a, b) = CondAssignFunc(5);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end AlgorithmCondAssign2;

// Result:
// function CondAssignFunc
//   input Real z;
//   output Real x = 35.0;
//   output Real y = 45.0;
// algorithm
//   if x > 5.0 then
//     x := 400.0;
//   end if;
//   if z > 10.0 then
//     y := 500.0;
//   end if;
// end CondAssignFunc;
//
// class AlgorithmCondAssign2
//   Real a;
//   Real b;
// equation
//   (a, b) = (400.0, 45.0);
// end AlgorithmCondAssign2;
// endResult

// name:     StatementCall
// keywords: multiple results, algorithm
// status:   skipped
//
// Computes cartesian coordinates of a point
//
// Drmodelica: 9.2 Multiple Results (p. 302)
//
function PointOnCircle
  input Real angle "Angle in radians";
  input Real radius;
  output Real x; // 1:st result formal parameter
  output Real y; // 2:nd result formal parameter
algorithm
  x := radius*Modelica.Math.cos(angle);
  y := radius*Modelica.Math.sin(angle);
end PointOnCircle;

class StatementCall
  Real px, py;
algorithm
  (px, py) := PointOnCircle(1.2, 2);
  annotation(__OpenModelica_commandLineOptions="-d=-newInst");
end StatementCall;

// Result:
// function Modelica.Math.cos "Cosine"
//   input Real u(quantity = "Angle", unit = "rad", displayUnit = "deg") "Independent variable";
//   output Real y "Dependent variable y=cos(u)";
// algorithm
//   y := cos(u);
// end Modelica.Math.cos;
// 
// function Modelica.Math.sin "Sine"
//   input Real u(quantity = "Angle", unit = "rad", displayUnit = "deg") "Independent variable";
//   output Real y "Dependent variable y=sin(u)";
// algorithm
//   y := sin(u);
// end Modelica.Math.sin;
// 
// function PointOnCircle
//   input Real angle "Angle in radians";
//   input Real radius;
//   output Real x;
//   output Real y;
// algorithm
//   x := radius * Modelica.Math.cos(angle);
//   y := radius * Modelica.Math.sin(angle);
// end PointOnCircle;
// 
// class StatementCall
//   Real px;
//   Real py;
// algorithm
//   px := 0.7247155089533472;
//   py := 1.8640781719344526;
// end StatementCall;
// endResult

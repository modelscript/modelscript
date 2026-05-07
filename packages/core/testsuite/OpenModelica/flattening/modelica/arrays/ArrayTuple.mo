// name: ArrayTuple [BUG: https://trac.openmodelica.org/OpenModelica/ticket/1951]
// keywords: array
// status: correct
//
// Testing the array reduction on function returning tuple
//

package Modelica
  package Math
    package Vectors
      function interpolate
        input Real[:] x;
        input Real[size(x, 1)] y;
        input Real xi;
        input Integer iLast = 1;
        output Real yi;
        output Integer iNew = 1;
      protected
        Integer i;
        Integer nx = size(x, 1);
        Real x1;
        Real x2;
        Real y1;
        Real y2;
      algorithm
        assert(nx > 0, "The table vectors must have at least 1 entry.");
        if nx == 1 then
          yi := y[1];
        else
          i := min(max(iLast, 1), nx - 1);
          if xi >= x[i] then
            while i < nx and xi >= x[i] loop
              i := i + 1;
            end while;
            i := i - 1;
          else
            while i > 1 and xi < x[i] loop
              i := i - 1;
            end while;
          end if;
          x1 := x[i];
          x2 := x[i + 1];
          y1 := y[i];
          y2 := y[i + 1];
          assert(x2 > x1, "Abszissa table vector values must be increasing");
          yi := y1 + ((y2 - y1) * (xi - x1)) / (x2 - x1);
          iNew := i;
        end if;
      end interpolate;
    end Vectors;
  end Math;
end Modelica;

model ArrayTuple
  parameter Real[:, 2] pressure_drop = [0, 0; 1, 1];
  parameter Boolean anti_symmetric = true;
  parameter Integer n = 2;
  parameter Real m_flows[n] = {1, 2};
  Real x[n-1];
equation
  x = array(Modelica.Math.Vectors.interpolate(pressure_drop[:, 1], sign(m_flows[i]) * pressure_drop[:, 2], abs(m_flows[i]), 1) for i in 1:n - 1);
end ArrayTuple;



// Result:
// class Range1
//   Integer x[1];
//   Integer x[2];
//   Integer x[3];
//   Integer x[4];
//   Integer x[5];
//   Integer y[1];
//   Integer y[2];
//   Integer y[3];
//   Integer y[4];
//   Integer y[5];
//   Integer z[1];
//   Integer z[2];
//   Integer z[3];
//   Integer z[4];
//   Integer z[5];
// equation
//   x = 1:5;
//   y[1] = x[1] + 1;
//   y[2] = x[2] + 1;
//   y[3] = x[3] + 1;
//   y[4] = x[4] + 1;
//   y[5] = x[5] + 1;
//   z[1] = x[1] + 2;
//   z[3] = x[3] + 2;
//   z[5] = x[5] + 2;
//   z[2] = 1;
//   z[4] = 2;
// end Range1;
// [OpenModelica/flattening/modelica/arrays/Range1.mo:9:3-9:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/arrays/Range1.mo:10:3-10:21:writable] Warning: Components are deprecated in class.
// [OpenModelica/flattening/modelica/arrays/Range1.mo:12:3-14:10:writable] Warning: Equation sections are deprecated in class.
// endResult

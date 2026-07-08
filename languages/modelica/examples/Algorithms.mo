package Algorithms
  "Examples demonstrating Modelica algorithmic constructs"

  function sort
    input Real[:] x "Input array";
    output Real[size(x, 1)] y "Sorted array";
  protected
    Integer n = size(x, 1);
    Real temp;
  algorithm
    y := x;
    for i in 1:n-1 loop
      for j in 1:n-i loop
        if y[j] > y[j+1] then
          temp := y[j];
          y[j] := y[j+1];
          y[j+1] := temp;
        end if;
      end for;
    end for;
  end sort;

  model ArrayProcessing
    parameter Real data[5] = {5.5, -2.0, 10.1, 0.0, 3.14};
    Real sortedData[5];
    Real maxValue;
  algorithm
    sortedData := sort(data);
    maxValue := sortedData[size(sortedData, 1)];
  end ArrayProcessing;

end Algorithms;

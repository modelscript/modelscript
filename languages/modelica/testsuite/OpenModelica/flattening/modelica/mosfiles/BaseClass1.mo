partial package PartialMedium

  constant Integer nX = size(reference_X,1);
  constant Real reference_X[:] = {1,2};

  model BaseProperties
    Real[nXi] Xi = reference_X;
    parameter Integer nXi;
    parameter Boolean b = nX == 4;
  end BaseProperties;

end PartialMedium;

package TableBased
  extends PartialMedium(reference_X = {1,2,3,4});
  model BP
    extends BaseProperties(nXi = if b then 4 else 2);
  end BP;
end TableBased;

model BaseClass1
  TableBased.BP medium;
end BaseClass1;

// Result:
// class BaseClass1
//   Real medium.Xi[1];
//   Real medium.Xi[2];
//   Real medium.Xi[3];
//   Real medium.Xi[4];
//   final parameter Integer medium.nXi = 4;
//   final parameter Boolean medium.b = true;
// equation
//   medium.Xi = {1.0, 2.0, 3.0, 4.0};
// end BaseClass1;
// endResult

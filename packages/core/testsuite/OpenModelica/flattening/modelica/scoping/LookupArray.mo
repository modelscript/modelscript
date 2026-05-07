// name:     Lookup with arrays
// keywords: Lookup array
// status:   correct
//
//
// To test that the lookup of model vars with arrays works correctly.
//
model A
  model B
    model G
      Boolean[2] setdg;
    end G;
    G[2] g;
    Boolean set;
  end B;
  B[2,3,1] C;

  Boolean b4[3,1,2,2];
  equation
    b4 = C[1,:,:].g.setdg;
end A;

// Result:
// class InnerOuterSystem
//   Boolean subSystem.enableMe = time <= 1.0;
//   Boolean subSystem.isEnabled = isEnabled and subSystem.enableMe;
//   Real subSystem.conditionalIntegrator.x(start = 1.0);
//   Real subSystem.conditionalIntegrator2.x(start = 1.0);
//   Boolean isEnabled = time >= 0.5;
// equation
//   der(subSystem.conditionalIntegrator.x) = if subSystem.isEnabled then -subSystem.conditionalIntegrator.x else 0.0;
//   der(subSystem.conditionalIntegrator2.x) = if subSystem.isEnabled then -subSystem.conditionalIntegrator2.x else 0.0;
// end InnerOuterSystem;
// endResult

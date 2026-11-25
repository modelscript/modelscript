package SubmarineHullVerification {
  attribute def Real;

  part def PressureHull {
    attribute outerRadiusM : Real = 4.2;
    attribute wallThicknessM : Real = 0.055;
    attribute testDepthM : Real = 400.0;
    attribute computedHoopStressMPa : Real = 312.5;
  }

  verification def HydrostaticCollapseTest {
    attribute verifiedCollapseDepthM : Real = 640.0;
    attribute verifiedHoopStressMPa : Real = 312.5;
  }

  verification def LifeSupportEnduranceTest {
    attribute maxCo2Percent : Real = 0.34;
    attribute oxygenEnduranceHours : Real = 192.0;
  }
}

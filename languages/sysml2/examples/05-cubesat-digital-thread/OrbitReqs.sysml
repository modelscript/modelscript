package CubeSatOrbitReqs {
  attribute def Real;

  requirement def SunSynchronousOrbitReq {
    attribute nominalAltitudeKm : Real = 550.0;
    attribute inclinationDeg : Real = 97.6;
    attribute missionLifeYears : Real = 3.0;
  }

  requirement def DownlinkBudgetReq {
    attribute minDataRateMbps : Real = 25.0;
    attribute linkMarginDb : Real = 6.0;
  }
}

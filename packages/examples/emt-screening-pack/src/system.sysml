package EmtScreeningPack {
  verification def GridStrengthGate {
    attribute poiFaultMva = 620.0;
    attribute ibrRatedMw = 250.0;
    attribute minScr = 2.0;
    require constraint { scr >= minScr }
  }

  verification def PmviewLvrtCheck {
    attribute profileFile = "data/pmview_lvrt_profile.txt";
    attribute minRideThroughPowerPu = 0.10;
    require constraint { minPowerDuringRideThrough >= minRideThroughPowerPu and sampleCount >= 5 }
  }
}

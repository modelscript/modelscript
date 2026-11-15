package EmtScreeningPack {
  action def BaselineModelAudit {
    attribute rawFile = "data/poi_case.raw";
    attribute dyrFile = "data/poi_case.dyr";
    attribute poiBus = 300;
    attribute implementation = "ts://./src/pipeline-stages.ts#baselineModelAudit";
    require constraint { missingDyrCount == 0 and orphanDyrCount == 0 and mod032Score >= 1.0 and poiFaultMva > 0 }
  }

  analysis def GridStrengthGate {
    attribute poiFaultMva = BaselineModelAudit.poiFaultMva;
    attribute ibrRatedMw = 250.0;
    attribute minScr = 2.0;
    attribute scr = poiFaultMva / ibrRatedMw;
    attribute emtMandatory = scr < minScr;
    attribute implementation = "ts://./src/pipeline-stages.ts#gridStrengthGateDecision";
    require constraint { scr > 0 and poiFaultMva > 0 }
  }

  verification def EmtSsciAndLvrtCheck {
    attribute pscxFile = "data/ibr_interconnection.pscx";
    attribute profileFile = "data/pmview_lvrt_profile.txt";
    attribute scr = GridStrengthGate.scr;
    attribute implementation = "ts://./src/pipeline-stages.ts#emtSsciAndLvrtCheck";
    assume constraint { GridStrengthGate.emtMandatory == true }
    require constraint { coverageRatio > 0 and envelopeOk == true and hasSsciRisk == false }
  }

  verification def PmviewLvrtCheck {
    attribute dependsOn = "BaselineModelAudit";
    attribute profileFile = "data/pmview_lvrt_profile.txt";
    attribute minRideThroughPowerPu = 0.10;
    require constraint { minPowerDuringRideThrough >= minRideThroughPowerPu and sampleCount >= 5 }
  }

  verification def TransformerCalibrationCheck {
    attribute dependsOn = "BaselineModelAudit";
    attribute sfraFile = "data/sfra_curve.csv";
    attribute maxRmse = 0.05;
    attribute implementation = "ts://./src/pipeline-stages.ts#transformerCalibrationCheck";
    require constraint { fitRmse <= maxRmse and fittedLH > 0 }
  }
}

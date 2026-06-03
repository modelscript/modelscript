
model TradeStudy
  import Manufacturing;
  
  // UMP: 3D Printing the drone chassis
  Manufacturing.FDM_3D_Printing fdm(
    partVolume = 5.5341e-7,
    surfaceArea = 1.0912e-3
  );
  
  // UMP: CNC Milling the drone chassis
  Manufacturing.CNC_Milling cnc(
    rawVolume = 8.3011e-7,
    partVolume = 5.5341e-7
  );
  
  // Evaluation Metric Deltas
  Real costDifference = cnc.cost - fdm.cost;
  Real timeDifference = cnc.totalTime - fdm.totalTime;
end TradeStudy;

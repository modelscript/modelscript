package Manufacturing
  "A library of Unit Manufacturing Processes (UMPs) based on ASTM E3012-16"
  
  model CNC_Milling
    "Models a generic 3-axis CNC milling operation"
    
    // Inputs mapped from CAD geometry
    parameter Real rawVolume(unit="m3") "Volume of the raw stock block";
    parameter Real partVolume(unit="m3") "Volume of the final machined part";
    
    // Machine/Process parameters
    parameter Real mrr(unit="m3/s") = 1.5e-6 "Material Removal Rate (m^3/s)";
    parameter Real specificEnergy(unit="J/m3") = 2.0e9 "Specific Energy for aluminum (J/m^3)";
    parameter Real hourlyRate(unit="USD/h") = 65.0 "Cost of machine time per hour";
    parameter Real setupTime(unit="s") = 1800.0 "Setup time (s)";
    parameter Real setupCost(unit="USD") = 50.0 "Cost of setup";
    
    // Calculated Process Outcomes
    Real processingTime(unit="s") "Time spent actively cutting";
    Real totalTime(unit="s") "Total process time including setup";
    Real energy(unit="J") "Energy consumed by cutting";
    Real cost(unit="USD") "Total cost of the operation";
    Real removedVolume(unit="m3") "Total material removed";
    
  equation
    removedVolume = rawVolume - partVolume;
    processingTime = removedVolume / mrr;
    totalTime = setupTime + processingTime;
    energy = removedVolume * specificEnergy;
    cost = setupCost + (totalTime / 3600.0) * hourlyRate;
  end CNC_Milling;

  model FDM_3D_Printing
    "Models a generic Fused Deposition Modeling (FDM) 3D printing operation"
    
    // Inputs mapped from CAD geometry
    parameter Real partVolume(unit="m3") "Volume of the final printed part";
    parameter Real surfaceArea(unit="m2") "Surface area of the part (affects skin print time)";
    
    // Machine/Process parameters
    parameter Real depositionRate(unit="m3/s") = 0.5e-6 "Material deposition rate (m^3/s)";
    parameter Real specificEnergy(unit="J/m3") = 5.0e8 "Specific Energy to melt plastic (J/m^3)";
    parameter Real hourlyRate(unit="USD/h") = 15.0 "Cost of machine time per hour";
    parameter Real setupTime(unit="s") = 300.0 "Bed preparation and heating time (s)";
    
    // Support material overhead (approximate)
    parameter Real supportVolumeRatio = 0.2 "Ratio of support material to part volume";
    
    // Calculated Process Outcomes
    Real totalVolume(unit="m3") "Volume of material printed including supports";
    Real processingTime(unit="s") "Time spent actively printing";
    Real totalTime(unit="s") "Total process time including setup";
    Real energy(unit="J") "Energy consumed by printing";
    Real cost(unit="USD") "Total cost of the operation";
    
  equation
    totalVolume = partVolume * (1.0 + supportVolumeRatio);
    processingTime = totalVolume / depositionRate;
    totalTime = setupTime + processingTime;
    energy = totalVolume * specificEnergy;
    cost = (totalTime / 3600.0) * hourlyRate;
  end FDM_3D_Printing;

end Manufacturing;

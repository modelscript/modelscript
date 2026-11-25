plant MLE_PreDenitrification {
  model: ASM1;

  influent {
    flow: 12000.0 m3/day;
    S_S: 72.0;
    S_I: 30.0;
    X_I: 50.0;
    X_S: 195.0;
    X_BH: 28.0;
    S_NH: 32.0;
    S_NO: 0.0;
    S_ND: 7.0;
    X_ND: 10.5;
    S_ALK: 7.0;
  }

  recycle {
    internal_ratio: 2.5;
    sludge_ratio: 0.9;
    waste_flow: 240.0 m3/day;
  }

  bioreactor ANOXIC_ZONE {
    type: Anoxic;
    volume: 1400.0 m3;
    kla: 0.0;
  }

  bioreactor AEROBIC_NITRIF {
    type: Aerobic;
    volume: 2600.0 m3;
    kla: 220.0;
    do_target: 2.0;
  }

  clarifier SECONDARY_CLARIFIER {
    area: 980.0 m2;
    depth: 4.0 m;
    layers: 10;
    feed_layer: 5;
  }
}

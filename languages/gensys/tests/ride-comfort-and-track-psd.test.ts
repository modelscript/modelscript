// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  applyIso2631Filter,
  calculateErriB176Psd,
  calculateFraPsd,
  calculateSperlingRideIndex,
  evaluateIso2631RideComfort,
  exportTrackGeometryToTrax,
  generatePsdTrackIrregularity,
  getIso2631WeightingFactor,
  parseTrackGeometry,
} from "../src/index.js";

test("ISO 2631-1 & ISO 8041 Frequency Weighting Filters (Wk and Wd)", () => {
  // 1. Vertical Weighting Wk: Peak sensitivity between 4 and 12.5 Hz (Wk ~ 1.0)
  const wk01 = getIso2631WeightingFactor(0.1, "Wk");
  const wk1 = getIso2631WeightingFactor(1.0, "Wk");
  const wk5 = getIso2631WeightingFactor(5.0, "Wk");
  const wk10 = getIso2631WeightingFactor(10.0, "Wk");
  const wk25 = getIso2631WeightingFactor(25.0, "Wk");
  const wk150 = getIso2631WeightingFactor(150.0, "Wk");

  assert.ok(wk01 < 0.1, `Sub-0.4Hz vertical vibrations must be attenuated, got ${wk01}`);
  assert.ok(wk5 > 0.9 && wk5 < 1.15, `5Hz vertical sensitivity must be ~1.0, got ${wk5}`);
  assert.ok(wk10 > 0.85 && wk10 < 1.15, `10Hz vertical sensitivity must be ~1.0, got ${wk10}`);
  assert.ok(wk25 < wk10, `25Hz sensitivity must be lower than 10Hz, got ${wk25}`);
  assert.ok(wk150 < 0.25, `Above-100Hz vibrations must be rolled off, got ${wk150}`);

  // 2. Lateral Weighting Wd: Peak sensitivity between 0.5 and 2.0 Hz (Wd ~ 1.0)
  const wd01 = getIso2631WeightingFactor(0.1, "Wd");
  const wd1 = getIso2631WeightingFactor(1.0, "Wd");
  const wd5 = getIso2631WeightingFactor(5.0, "Wd");
  const wd20 = getIso2631WeightingFactor(20.0, "Wd");

  assert.ok(wd01 < 0.15, `Sub-0.4Hz lateral vibrations must be attenuated, got ${wd01}`);
  assert.ok(wd1 > 0.85 && wd1 < 1.15, `1Hz lateral sensitivity must be ~1.0, got ${wd1}`);
  assert.ok(wd5 < 0.55, `5Hz lateral sensitivity must be lower than 1Hz, got ${wd5}`);
  assert.ok(wd20 < 0.15, `20Hz lateral sensitivity must be low, got ${wd20}`);

  // 3. Digital Filtering on a 200 Hz sampled signal
  const dt = 0.005; // 200 Hz
  const n = 1000; // 5.0 seconds
  const t = new Float64Array(n);
  const aRaw = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const time = i * dt;
    t[i] = time;
    // Mix: 5 Hz resonance (in passband) + 60 Hz electrical motor hum (out of band)
    aRaw[i] = 1.0 * Math.sin(2 * Math.PI * 5.0 * time) + 2.0 * Math.sin(2 * Math.PI * 60.0 * time);
  }

  const aFiltered = applyIso2631Filter(t, aRaw, "Wk");
  assert.strictEqual(aFiltered.length, n);

  // Check that 60 Hz hum is attenuated while 5 Hz passband is preserved
  let sumRaw = 0;
  let sumFilt = 0;
  for (let i = 100; i < n - 100; i++) {
    sumRaw += aRaw[i]! * aRaw[i]!;
    sumFilt += aFiltered[i]! * aFiltered[i]!;
  }
  const rmsRaw = Math.sqrt(sumRaw / (n - 200));
  const rmsFilt = Math.sqrt(sumFilt / (n - 200));

  assert.ok(
    rmsFilt < rmsRaw * 0.7,
    `Filtered acceleration RMS (${rmsFilt.toFixed(3)}) must attenuate high-frequency noise vs raw (${rmsRaw.toFixed(3)})`,
  );
});

test("EN 12299 Mean Comfort Index (N_MV) & ISO 2631-1 Passenger Assessment", () => {
  const dt = 0.01; // 100 Hz
  const duration = 10.0; // 10 seconds
  const n = Math.round(duration / dt);
  const t = new Float64Array(n);

  const vertSmooth = new Float64Array(n);
  const latSmooth = new Float64Array(n);
  const longSmooth = new Float64Array(n);

  const vertRough = new Float64Array(n);
  const latRough = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const time = i * dt;
    t[i] = time;

    // Smooth luxury coach vibration (< 0.05 m/s^2)
    vertSmooth[i] = 0.04 * Math.sin(2 * Math.PI * 2.0 * time) + 0.02 * Math.sin(2 * Math.PI * 8.0 * time);
    latSmooth[i] = 0.03 * Math.sin(2 * Math.PI * 1.2 * time);
    longSmooth[i] = 0.01 * Math.sin(2 * Math.PI * 0.5 * time);

    // Rough track severe vibration (> 0.6 m/s^2)
    vertRough[i] = 0.8 * Math.sin(2 * Math.PI * 6.0 * time) + 0.4 * Math.sin(2 * Math.PI * 10.0 * time);
    latRough[i] = 0.7 * Math.sin(2 * Math.PI * 1.5 * time);
  }

  // 1. Assess Smooth Ride
  const smoothReport = evaluateIso2631RideComfort(t, {
    vertical: vertSmooth,
    lateral: latSmooth,
    longitudinal: longSmooth,
  });

  assert.strictEqual(smoothReport.sampleCount, n);
  assert.ok(smoothReport.en12299.nmv < 1.5, `Smooth ride N_MV must be < 1.5, got ${smoothReport.en12299.nmv}`);
  assert.strictEqual(smoothReport.en12299.comfortRating, "Very Good");
  assert.ok(smoothReport.vertical.sperlingWz < 2.0, "Smooth ride Sperling Wz must be < 2.0");
  assert.ok(smoothReport.vertical.crestFactor >= 1.0, "Crest factor must be >= 1.0");
  assert.ok(smoothReport.vertical.vdv > 0, "VDV must be positive");

  // 2. Assess Rough Track Ride
  const roughReport = evaluateIso2631RideComfort(t, {
    vertical: vertRough,
    lateral: latRough,
  });

  assert.ok(
    roughReport.en12299.nmv >= 3.5,
    `Rough track ride N_MV must be >= 3.5 (Poor/Very Poor), got ${roughReport.en12299.nmv}`,
  );
  assert.ok(roughReport.en12299.comfortRating === "Poor" || roughReport.en12299.comfortRating === "Very Poor");
  assert.ok(roughReport.vertical.sperlingWz > 3.0, "Rough ride Sperling Wz must exceed 3.0");

  // Legacy Sperling scalar function check (0.05 m/s^2 at 5 Hz gives comfortable Wz ~ 2.7)
  const wzSingle = calculateSperlingRideIndex(0.05, 5.0, "vertical");
  assert.ok(wzSingle > 2.0 && wzSingle < 3.5);
});

test("Power Spectral Density (PSD) Track Irregularity Synthesizer (ERRI B176 & FRA)", () => {
  // 1. ERRI B176 PSD evaluations
  const psdHigh = calculateErriB176Psd(0.1, "vertical", "high");
  const psdLow = calculateErriB176Psd(0.1, "vertical", "low");
  const psdHighSpeed = calculateErriB176Psd(0.1, "vertical", "high_speed");

  assert.ok(psdLow > psdHigh, "Low quality track PSD must be strictly greater than High quality track PSD");
  assert.ok(psdHigh > psdHighSpeed, "High quality PSD must be greater than High-Speed track PSD");

  // 2. FRA PSD evaluations
  const fraPsd1 = calculateFraPsd(0.2, "vertical", 1);
  const fraPsd6 = calculateFraPsd(0.2, "vertical", 6);
  assert.ok(fraPsd1 > fraPsd6 * 10, "FRA Class 1 (worst) PSD must be > 10x FRA Class 6 (best) PSD");

  // 3. Multi-channel synthetic track generation (ERRI B176)
  const trackHigh = generatePsdTrackIrregularity({
    standard: "ERRI_B176",
    quality: "high",
    lengthMeters: 200.0,
    spatialStepMeters: 0.25,
    randomSeed: 12345,
    trackName: "HighSpeedMainLine",
  });

  assert.strictEqual(trackHigh.points.length, Math.round(200.0 / 0.25) + 1);
  assert.strictEqual(trackHigh.nominalGauge, 1.435);

  const trackLow = generatePsdTrackIrregularity({
    standard: "ERRI_B176",
    quality: "low",
    lengthMeters: 200.0,
    spatialStepMeters: 0.25,
    randomSeed: 12345,
    trackName: "LowQualityBranchLine",
  });

  // Calculate RMS of vertical irregularity for both
  let sumSqHigh = 0;
  let sumSqLow = 0;
  for (let i = 0; i < trackHigh.points.length; i++) {
    const ptH = trackHigh.points[i]!;
    const ptL = trackLow.points[i]!;
    sumSqHigh += ptH.verticalLeft * ptH.verticalLeft;
    sumSqLow += ptL.verticalLeft * ptL.verticalLeft;
  }
  const rmsHigh = Math.sqrt(sumSqHigh / trackHigh.points.length);
  const rmsLow = Math.sqrt(sumSqLow / trackLow.points.length);

  assert.ok(
    rmsLow > rmsHigh * 1.4,
    `Low quality track RMS (${(rmsLow * 1e3).toFixed(2)} mm) must be > 1.4x High quality (${(rmsHigh * 1e3).toFixed(2)} mm)`,
  );
  assert.ok(rmsHigh < 0.005, `High quality track RMS must be < 5 mm, got ${(rmsHigh * 1e3).toFixed(2)} mm`);

  // 4. Deterministic Reproducibility
  const trackRepeat = generatePsdTrackIrregularity({
    standard: "ERRI_B176",
    quality: "high",
    lengthMeters: 200.0,
    spatialStepMeters: 0.25,
    randomSeed: 12345,
  });

  assert.strictEqual(trackRepeat.points[50]!.verticalLeft, trackHigh.points[50]!.verticalLeft);
  assert.strictEqual(trackRepeat.points[100]!.alignmentRight, trackHigh.points[100]!.alignmentRight);

  // 5. GENSYS / SIMPACK .trax format export and parsing round-trip
  const traxText = exportTrackGeometryToTrax(trackHigh);
  assert.ok(traxText.includes("Distance[m]"));
  assert.ok(traxText.includes("HighSpeedMainLine"));

  const parsedTrack = parseTrackGeometry(traxText, "ParsedTrack");
  assert.strictEqual(parsedTrack.points.length, trackHigh.points.length);
  assert.ok(
    Math.abs(parsedTrack.points[25]!.verticalLeft - trackHigh.points[25]!.verticalLeft) < 1e-5,
    "Track points must round-trip through .trax format accurately",
  );
});

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Lagrangian Hydrodynamic & Terrain Slug Front Tracker.
 *
 * Tracks individual liquid slugs as discrete moving Lagrangian bodies overlaid
 * on the Eulerian flowline grid, calculating slug length distributions (L_s),
 * arrival frequency (f_s), slug front/tail velocities, and riser-base severe slugging.
 */

export interface DiscreteSlug {
  /** Unique sequential identifier for this slug. */
  id: number;
  /** Position of the advancing slug front [m]. */
  frontPos: number;
  /** Position of the trailing slug tail [m]. */
  tailPos: number;
  /** Instantaneous slug body length L_s = frontPos - tailPos [m]. */
  length: number;
  /** Average liquid volume fraction inside the slug body [-]. */
  holdup: number;
  /** Velocity of the slug body [m/s]. */
  velocity: number;
  /** Liquid volume contained in the slug body [m^3]. */
  volume: number;
}

export interface SlugTrackerStatistics {
  /** Total number of discrete slugs initiated. */
  slugsInitiated: number;
  /** Total number of discrete slugs that reached the topside terminal. */
  slugsArrived: number;
  /** Mean arrived slug length [m]. */
  meanSlugLength: number;
  /** Peak arrived slug length [m]. */
  maxSlugLength: number;
  /** 95th-percentile arrived slug length [m]. */
  p95SlugLength: number;
  /** Average slug arrival frequency at topside [Hz] (1 / period). */
  slugFrequencyHz: number;
  /** Whether the pipeline-riser system exhibits severe cyclic slugging. */
  severeSluggingDetected: boolean;
  /** Peak pressure fluctuation amplitude at riser base [Pa]. */
  riserBaseCycleAmplitude: number;
}

export interface SlugTrackerOptions {
  /** Minimum length for a stable slug [m] (default: 2.0 m). */
  minSlugLength?: number | undefined;
  /** Critical holdup required to initiate hydrodynamic bridging (default: 0.38). */
  initiationHoldupThreshold?: number | undefined;
  /** Severe slugging pressure amplitude threshold [Pa] (default: 5.0 bar = 5e5 Pa). */
  severeSluggingThreshold?: number | undefined;
}

interface ResolvedSlugTrackerOptions {
  minSlugLength: number;
  initiationHoldupThreshold: number;
  severeSluggingThreshold: number;
}

/**
 * Manages discrete Lagrangian slugs propagating along an OLGA flowpath.
 */
export class SlugTracker {
  private nextSlugId = 1;
  private activeSlugs: DiscreteSlug[] = [];
  private arrivedLengths: number[] = [];
  private arrivalTimes: number[] = [];
  private totalInitiated = 0;
  private totalArrived = 0;

  // Pressure history at riser base for severe slugging detection
  private riserBasePressures: { time: number; pressure: number }[] = [];

  private options: ResolvedSlugTrackerOptions;

  constructor(options: SlugTrackerOptions = {}) {
    this.options = {
      minSlugLength: options.minSlugLength ?? 2.0,
      initiationHoldupThreshold: options.initiationHoldupThreshold ?? 0.38,
      severeSluggingThreshold: options.severeSluggingThreshold ?? 5.0e5,
    };
  }

  /**
   * Advances all active slugs across time step dt and initiates new slugs where conditions are met.
   *
   * @param currentTime       Simulation time [s]
   * @param dt                Time step [s]
   * @param pipeLength        Total flowpath length [m]
   * @param pipeDiameter      Pipe inner diameter [m]
   * @param spatialHoldup     Array of liquid holdup along the pipe cells
   * @param cellPositions     Spatial coordinate array of the pipe cells [m]
   * @param mixtureVelocity   Superficial mixture velocity j = j_g + j_l [m/s]
   * @param riserBasePressure Optional pressure reading at the riser base [Pa]
   */
  public step(
    currentTime: number,
    dt: number,
    pipeLength: number,
    pipeDiameter: number,
    spatialHoldup: number[],
    cellPositions: number[],
    mixtureVelocity: number,
    riserBasePressure?: number,
  ): DiscreteSlug[] {
    const area = 0.25 * Math.PI * pipeDiameter * pipeDiameter;
    const j = Math.max(0.1, mixtureVelocity);

    // 1. Slug initiation check (hydrodynamic wave bridging & terrain dips)
    this.checkInitiation(spatialHoldup, cellPositions, pipeDiameter, j, area);

    // 2. Propagate active slugs
    const surviving: DiscreteSlug[] = [];
    // Slug front drift parameter (Bendiksen / Gregory correlation)
    const C0 = 1.2;
    const driftVel = 0.54 * Math.sqrt(9.81 * pipeDiameter);
    const vFront = C0 * j + driftVel;

    for (const slug of this.activeSlugs) {
      // Slug tail advances slightly slower due to liquid film shedding
      const shedFactor = 0.92;
      const vTail = j * shedFactor;

      slug.frontPos += vFront * dt;
      slug.tailPos += vTail * dt;
      slug.length = Math.max(0, slug.frontPos - slug.tailPos);
      slug.velocity = 0.5 * (vFront + vTail);
      slug.volume = slug.length * area * slug.holdup;

      // Check arrival at terminal
      if (slug.frontPos >= pipeLength) {
        this.totalArrived++;
        this.arrivedLengths.push(slug.length);
        this.arrivalTimes.push(currentTime);
        continue; // Slug exited pipeline
      }

      // Check dissipation
      if (slug.length < this.options.minSlugLength) {
        continue; // Slug dissipated
      }

      surviving.push(slug);
    }

    // 3. Slug coalescence (merging when trailing slug front catches preceding slug tail)
    this.activeSlugs = this.mergeCollidingSlugs(surviving, area);

    // 4. Record riser-base pressure for severe slugging cycle analysis
    if (riserBasePressure !== undefined) {
      this.riserBasePressures.push({ time: currentTime, pressure: riserBasePressure });
      // Keep trailing 10-minute window
      const cutoff = currentTime - 600.0;
      this.riserBasePressures = this.riserBasePressures.filter((p) => p.time >= cutoff);
    }

    return [...this.activeSlugs];
  }

  /** Initiates new discrete slugs at locations where wave bridging occurs. */
  private checkInitiation(holdup: number[], positions: number[], diameter: number, j: number, area: number): void {
    const minSpacing = 15.0 * diameter; // Minimum distance between distinct slugs

    for (let i = 0; i < holdup.length; i++) {
      const alpha = holdup[i]!;
      const pos = positions[i]!;

      if (alpha > this.options.initiationHoldupThreshold) {
        // Ensure no existing slug is already occupying this neighborhood
        const isOccupied = this.activeSlugs.some(
          (s) => Math.abs(s.frontPos - pos) < minSpacing || Math.abs(s.tailPos - pos) < minSpacing,
        );

        if (!isOccupied) {
          const initLength = Math.max(12.0 * diameter, 4.0);
          const slugHoldup = Math.min(0.98, 1.0 - j / (j + 8.0)); // Gregory et al.
          const newSlug: DiscreteSlug = {
            id: this.nextSlugId++,
            frontPos: pos + initLength,
            tailPos: pos,
            length: initLength,
            holdup: slugHoldup,
            velocity: 1.2 * j,
            volume: initLength * area * slugHoldup,
          };
          this.activeSlugs.push(newSlug);
          this.totalInitiated++;
        }
      }
    }
  }

  /** Merges overlapping adjacent slugs into single larger slugs. */
  private mergeCollidingSlugs(slugs: DiscreteSlug[], area: number): DiscreteSlug[] {
    if (slugs.length <= 1) return slugs;

    // Sort by front position descending (furthest downstream first)
    slugs.sort((a, b) => b.frontPos - a.frontPos);

    const merged: DiscreteSlug[] = [];
    let current = slugs[0]!;

    for (let i = 1; i < slugs.length; i++) {
      const upstream = slugs[i]!;
      // Collision condition: upstream front touches or passes current slug tail
      if (upstream.frontPos >= current.tailPos) {
        // Merge into current
        current.tailPos = upstream.tailPos;
        current.length = current.frontPos - current.tailPos;
        current.volume += upstream.volume;
        current.holdup = current.volume / Math.max(1e-4, current.length * area);
      } else {
        merged.push(current);
        current = upstream;
      }
    }
    merged.push(current);

    return merged;
  }

  /**
   * Computes comprehensive slug statistics (frequencies, distributions, severe slugging).
   */
  public getStatistics(): SlugTrackerStatistics {
    let meanLength = 0;
    let maxLength = 0;
    let p95Length = 0;

    const lengths = this.arrivedLengths.length > 0 ? this.arrivedLengths : this.activeSlugs.map((s) => s.length);

    if (lengths.length > 0) {
      const sorted = [...lengths].sort((a, b) => a - b);
      const sum = sorted.reduce((acc, l) => acc + l, 0);
      meanLength = sum / sorted.length;
      maxLength = sorted[sorted.length - 1]!;
      const idx95 = Math.floor(0.95 * (sorted.length - 1));
      p95Length = sorted[idx95]!;
    }

    // Slug frequency (arrivals per second)
    let freqHz = 0;
    if (this.arrivalTimes.length >= 2) {
      const dtTotal = this.arrivalTimes[this.arrivalTimes.length - 1]! - this.arrivalTimes[0]!;
      if (dtTotal > 0) {
        freqHz = (this.arrivalTimes.length - 1) / dtTotal;
      }
    }

    // Severe slugging cycle amplitude
    let riserBaseCycleAmplitude = 0;
    let severeSluggingDetected = false;
    if (this.riserBasePressures.length >= 5) {
      let minP = Infinity;
      let maxP = -Infinity;
      for (const pt of this.riserBasePressures) {
        if (pt.pressure < minP) minP = pt.pressure;
        if (pt.pressure > maxP) maxP = pt.pressure;
      }
      riserBaseCycleAmplitude = maxP - minP;
      if (riserBaseCycleAmplitude > this.options.severeSluggingThreshold) {
        severeSluggingDetected = true;
      }
    }

    return {
      slugsInitiated: this.totalInitiated,
      slugsArrived: this.totalArrived,
      meanSlugLength: meanLength,
      maxSlugLength: maxLength,
      p95SlugLength: p95Length,
      slugFrequencyHz: freqHz,
      severeSluggingDetected,
      riserBaseCycleAmplitude,
    };
  }

  /** Returns copies of all currently active discrete slugs. */
  public getActiveSlugs(): DiscreteSlug[] {
    return [...this.activeSlugs];
  }
}

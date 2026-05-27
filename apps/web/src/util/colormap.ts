/**
 * Scientific Colormap Utilities
 *
 * Generates 1D colormap textures for scalar field visualization.
 * Includes standard scientific presets (Viridis, Jet, Plasma, Turbo, Coolwarm).
 *
 * Usage:
 *   const texture = createColormapTexture("viridis");
 *   material.uniforms.colormap.value = texture;
 */

import * as THREE from "three";

// ── Colormap Presets ────────────────────────────────────────────

/**
 * Each preset is an array of [t, r, g, b] control points.
 * t ∈ [0, 1], rgb ∈ [0, 1].
 */
type ColormapStops = [number, number, number, number][];

const PRESETS: Record<string, ColormapStops> = {
  viridis: [
    [0.0, 0.267, 0.004, 0.329],
    [0.13, 0.282, 0.14, 0.458],
    [0.25, 0.253, 0.265, 0.53],
    [0.38, 0.191, 0.407, 0.556],
    [0.5, 0.127, 0.566, 0.551],
    [0.63, 0.134, 0.658, 0.518],
    [0.75, 0.267, 0.749, 0.441],
    [0.88, 0.478, 0.821, 0.318],
    [1.0, 0.993, 0.906, 0.144],
  ],
  jet: [
    [0.0, 0.0, 0.0, 0.5],
    [0.11, 0.0, 0.0, 1.0],
    [0.25, 0.0, 0.5, 1.0],
    [0.36, 0.0, 1.0, 1.0],
    [0.5, 0.5, 1.0, 0.5],
    [0.64, 1.0, 1.0, 0.0],
    [0.75, 1.0, 0.5, 0.0],
    [0.89, 1.0, 0.0, 0.0],
    [1.0, 0.5, 0.0, 0.0],
  ],
  plasma: [
    [0.0, 0.05, 0.03, 0.528],
    [0.13, 0.226, 0.015, 0.618],
    [0.25, 0.382, 0.002, 0.643],
    [0.38, 0.531, 0.03, 0.58],
    [0.5, 0.659, 0.106, 0.469],
    [0.63, 0.777, 0.195, 0.343],
    [0.75, 0.876, 0.308, 0.217],
    [0.88, 0.95, 0.472, 0.089],
    [1.0, 0.94, 0.975, 0.131],
  ],
  turbo: [
    [0.0, 0.19, 0.072, 0.232],
    [0.07, 0.257, 0.26, 0.758],
    [0.15, 0.17, 0.494, 0.964],
    [0.25, 0.074, 0.71, 0.83],
    [0.35, 0.097, 0.86, 0.571],
    [0.45, 0.302, 0.95, 0.342],
    [0.55, 0.573, 0.979, 0.226],
    [0.65, 0.823, 0.918, 0.171],
    [0.75, 0.969, 0.773, 0.12],
    [0.85, 0.998, 0.563, 0.08],
    [0.92, 0.956, 0.344, 0.027],
    [1.0, 0.71, 0.122, 0.055],
  ],
  coolwarm: [
    [0.0, 0.23, 0.299, 0.754],
    [0.25, 0.552, 0.592, 0.88],
    [0.5, 0.865, 0.865, 0.865],
    [0.75, 0.895, 0.545, 0.441],
    [1.0, 0.706, 0.016, 0.15],
  ],
  inferno: [
    [0.0, 0.001, 0.0, 0.014],
    [0.13, 0.106, 0.042, 0.268],
    [0.25, 0.265, 0.05, 0.479],
    [0.38, 0.44, 0.061, 0.495],
    [0.5, 0.612, 0.118, 0.406],
    [0.63, 0.779, 0.211, 0.267],
    [0.75, 0.911, 0.364, 0.13],
    [0.88, 0.982, 0.574, 0.027],
    [1.0, 0.988, 0.998, 0.645],
  ],
};

export type ColormapPreset = keyof typeof PRESETS;

export const COLORMAP_NAMES: ColormapPreset[] = Object.keys(PRESETS) as ColormapPreset[];

// ── Texture Generation ──────────────────────────────────────────

/**
 * Interpolate between colormap stops to produce an RGBA pixel.
 */
function sampleColormap(stops: ColormapStops, t: number): [number, number, number, number] {
  if (t <= stops[0][0]) return [stops[0][1], stops[0][2], stops[0][3], 1];
  if (t >= stops[stops.length - 1][0]) {
    const last = stops[stops.length - 1];
    return [last[1], last[2], last[3], 1];
  }

  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      const frac = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return [
        stops[i][1] + frac * (stops[i + 1][1] - stops[i][1]),
        stops[i][2] + frac * (stops[i + 1][2] - stops[i][2]),
        stops[i][3] + frac * (stops[i + 1][3] - stops[i][3]),
        1,
      ];
    }
  }

  return [0, 0, 0, 1];
}

/**
 * Create a Three.js DataTexture from a colormap preset.
 * Returns a 256×1 RGBA texture for use as a LUT in shaders.
 */
export function createColormapTexture(preset: ColormapPreset = "viridis"): THREE.DataTexture {
  const stops = PRESETS[preset] || PRESETS.viridis;
  const width = 256;
  const data = new Uint8Array(width * 4);

  for (let i = 0; i < width; i++) {
    const t = i / (width - 1);
    const [r, g, b, a] = sampleColormap(stops, t);
    data[i * 4 + 0] = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = Math.round(a * 255);
  }

  const texture = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;

  return texture;
}

/**
 * Sample a color from a preset at a normalized value t ∈ [0, 1].
 * Returns CSS rgb() string — useful for legends and UI.
 */
export function sampleColormapCss(preset: ColormapPreset, t: number): string {
  const stops = PRESETS[preset] || PRESETS.viridis;
  const [r, g, b] = sampleColormap(stops, t);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

// ── Shader Source ────────────────────────────────────────────────

export const COLORMAP_VERTEX_SHADER = `
  attribute float scalar;
  varying float vScalar;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vScalar = scalar;
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const COLORMAP_FRAGMENT_SHADER = `
  uniform sampler2D colormap;
  uniform float scalarMin;
  uniform float scalarMax;
  uniform float opacity;
  uniform float loadFactor;

  varying float vScalar;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    // Normalize scalar to [0, 1]
    float range = scalarMax - scalarMin;
    float currentScalar = vScalar * loadFactor;
    float t = range > 0.0 ? clamp((currentScalar - scalarMin) / range, 0.0, 1.0) : 0.5;

    // Sample colormap
    vec4 color = texture2D(colormap, vec2(t, 0.5));

    // Basic lighting (Lambertian + ambient)
    vec3 normal = normalize(vNormal);
    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.8));
    float diffuse = max(dot(normal, lightDir), 0.0);
    float ambient = 0.35;
    float lighting = ambient + (1.0 - ambient) * diffuse;

    gl_FragColor = vec4(color.rgb * lighting, opacity);
  }
`;

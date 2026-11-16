// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DyrHeaderKind, PsseDyrCategory } from "../types.js";

/**
 * Fine-grained dynamic equipment sub-category (used to avoid false duplicate-slot
 * collisions between e.g. an exciter and its OEL/UEL/COMP on the same unit).
 */
export type DyrSubCategory =
  | "sync_generator"
  | "condenser"
  | "induction_generator"
  | "wind_generator"
  | "exciter"
  | "oel"
  | "uel"
  | "vhz"
  | "compensator"
  | "governor"
  | "boiler_load_ctrl"
  | "wind_mechanical"
  | "stabilizer"
  | "ibr_converter"
  | "ibr_control"
  | "ibr_plant"
  | "ibr_gfm"
  | "ibr_der"
  | "load_static"
  | "load_motor"
  | "load_composite"
  | "svc"
  | "statcom"
  | "tcsc"
  | "lcc_hvdc"
  | "vsc_hvdc"
  | "relay_shed"
  | "relay_trip"
  | "relay_branch"
  | "measurement"
  | "user";

/**
 * Canonical DAE lowering & AssemblyScript kernel archetype identifier.
 */
export type DaeArchetypeId =
  | "sync_classical_2o"
  | "sync_transient_3o"
  | "sync_subtrans_round_6o"
  | "sync_subtrans_salient_5o"
  | "sync_gentpj_6o"
  | "induction_machine_4o"
  | "wind_ind_gen_4o"
  | "wind_type3_dfag"
  | "exc_sexs"
  | "exc_scrx"
  | "exc_ieee_dc"
  | "exc_ieee_ac"
  | "exc_ieee_st"
  | "exc_st4b_pi"
  | "exc_pid"
  | "lim_oel"
  | "lim_uel"
  | "lim_vhz"
  | "comp_rc_xc"
  | "gov_steam_simple"
  | "gov_steam_reheat"
  | "gov_lcfb"
  | "gov_gast"
  | "gov_ggov1_temp"
  | "gov_hydro_penstock"
  | "gov_hydro_pid"
  | "gov_degov"
  | "wind_drivetrain_2mass"
  | "wind_pitch_torque"
  | "pss_single_leadlag"
  | "pss_dual_ramptrack"
  | "pss_multiband_4b"
  | "ibr_regc_converter"
  | "ibr_reec_control"
  | "ibr_repc_plant"
  | "ibr_dera_aggregate"
  | "ibr_regfm_vsm"
  | "ibr_iec_generic"
  | "load_static_zipf"
  | "load_complex_clod"
  | "load_ind_motor"
  | "load_1ph_stall"
  | "load_composite_cmpldw"
  | "facts_svc"
  | "facts_statcom"
  | "facts_tcsc"
  | "hvdc_lcc_2t"
  | "hvdc_vsc_2t"
  | "relay_load_shed"
  | "relay_gen_trip"
  | "relay_branch_dist"
  | "meas_bus_freq";

export interface DyrIconSchema {
  name: string;
  type: "int" | "bus" | "id" | "flag";
  default?: number | string | undefined;
  validValues?: readonly number[] | undefined;
  description: string;
}

export interface DyrModelParamMeta {
  name: string;
  unit: string;
  default?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  description: string;
}

export interface DyrModelSchema {
  model: string;
  aliases?: readonly string[] | undefined;
  category: PsseDyrCategory;
  subCategory?: DyrSubCategory | undefined;
  headerKind?: DyrHeaderKind | undefined;
  title: string;
  standardRef?: string | undefined;
  description: string;
  icons?: readonly DyrIconSchema[] | undefined;
  params: DyrModelParamMeta[];
  states?: readonly string[] | undefined;
  daeArchetype: DaeArchetypeId;
}

/**
 * Compact helper to define a parameter entry concisely without sacrificing type safety or defaults.
 */
export function p(
  name: string,
  unit: string,
  description: string,
  defaultVal?: number,
  min?: number,
  max?: number,
): DyrModelParamMeta {
  const entry: DyrModelParamMeta = { name, unit, description };
  if (defaultVal !== undefined) entry.default = defaultVal;
  if (min !== undefined) entry.min = min;
  if (max !== undefined) entry.max = max;
  return entry;
}

/**
 * Compact helper to define an ICON entry concisely.
 */
export function ic(
  name: string,
  type: "int" | "bus" | "id" | "flag",
  description: string,
  defaultVal?: number | string,
  validValues?: readonly number[],
): DyrIconSchema {
  const entry: DyrIconSchema = { name, type, description };
  if (defaultVal !== undefined) entry.default = defaultVal;
  if (validValues !== undefined) entry.validValues = validValues;
  return entry;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import { genericAttachProfile } from "./profiles/generic";
import { modelicaAttachProfile } from "./profiles/ModelicaProfile";
import { qifAttachProfile } from "./profiles/QifProfile";
import { vegaAttachProfile } from "./profiles/VegaProfile";
import { registerAttachProfile } from "./registry";

// Built-in profiles. Language profiles register themselves the same way.
registerAttachProfile(genericAttachProfile);
registerAttachProfile(qifAttachProfile);
registerAttachProfile(modelicaAttachProfile);
registerAttachProfile(vegaAttachProfile);

export * from "./artifact-source";
export * from "./AttachWizard";
export * from "./engine";
export * from "./Primitives";
export { genericAttachProfile } from "./profiles/generic";
export * from "./profiles/modelica-classes";
export { modelicaAttachProfile } from "./profiles/ModelicaProfile";
export { qifAttachProfile, QifPreview, qifPreviewRenderer, summarizeReconciliation } from "./profiles/QifProfile";
export * from "./profiles/vega-model";
export { vegaAttachProfile, vegaPreviewRenderer } from "./profiles/VegaProfile";
export * from "./registry";
export * from "./types";
export * from "./useAttachFlow";

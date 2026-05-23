// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  Scope,
  _getAnnotationScope,
  _getScriptingScope,
  _resolveBuiltIn,
  getQueryDB,
  setAnnotationScopeGetter,
  setBuiltInResolver,
  setQueryDB,
  setScriptingScopeGetter,
} from "@modelscript/compiler";

export { ModelicaLoopScope, ModelicaScriptScope } from "./modelica/modelica-scopes.js";

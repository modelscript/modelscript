import { ParseHead, ErrorBranch, allocErrorBranch, pushActiveHead, allocParseHead } from "./gss";
import { debugLog, pushDiagnostic, MAX_ERRORS } from "./engine";
import { 
  cloneNodeShallow, 
  getNodePadding, 
  getNodeByteLength, 
  setNodeByteLength, 
  getNodeFirstChild, 
  setFirstChild, 
  setNextSibling,
  getNodeType,
  concatLists,
  allocNode,
  NODE_TYPE_ERROR,
  getInputBuffer
} from "./arena";

// Note: To make this decoupled, we rely on the caller passing the required data or exporting it.

import { ParseHead, ErrorBranch, allocErrorBranch, pushActiveHead, allocParseHead } from "./gss";
import { debugLog, pushDiagnostic, MAX_ERRORS, MAX_CHILD_NODES, t_globalChildNodes, MAX_TERMINAL_ID,
  action_offsets, action_data, ACTION_SHIFT, MAX_PANIC_SCAN_TOKENS, PENALTY_UNWIND_NODE, token_insert_costs,
  NODE_TYPE_ERROR, goto_offsets, goto_data, configEnableBranchA1, configEnableBranchB, configEnableIslandMode
} from "./engine";
import { stateCanAccept, cloneNodeShallow, concatLists, isPureErrorNode } from "./parser-loop";
import { 
  getNodePadding, 
  setNodePadding,
  getNodeByteLength, 
  setNodeByteLength, 
  getNodeFirstChild, 
  setFirstChild, 
  setNextSibling,
  getNodeNextSibling,
  getNodeType,
  allocNode,
  getInputBuffer,
  ASTNode,
  FLAG_IS_INSERTED
} from "./arena";
import { UnmanagedUint16Array, UnmanagedUint8Array } from "./array";
import {
  lexPos,
  lexLen,
  srcLexPos,
  currentScannerState,
  invokeLexer,
  lex,
  expected_tokens,
  setLexPos,
  setLexLen,
  setSrcLexPos,
  setCurrentScannerState,
  TOKEN_EOF,
  TOKEN_UNKNOWN,
  SYMBOL_COUNT,
  peekChar,
  peekCharLen,
  inputEncoding
} from "./parser";

export let errorQueueHead: u32 = 0;
export let errorQueueTail: u32 = 0;

export function clearErrorQueue(): void {
  errorQueueHead = 0;
  errorQueueTail = 0;
}

const CHAR_LBRACE: u8 = 123;
const CHAR_RBRACE: u8 = 125;
const CHAR_LBRACKET: u8 = 91;
const CHAR_RBRACKET: u8 = 93;
const CHAR_LPAREN: u8 = 40;
const CHAR_RPAREN: u8 = 41;
const PENALTY_SYNC_TOKEN: i32 = 50;

@inline
function getInsertCost(tok: i32): i32 {
  if (tok < 0 || tok >= token_insert_costs.length) return 10;
  return token_insert_costs[tok];
}

@inline
export function recoverUnwindAndMutate(
  head: ParseHead,
  token: i32,
  inputLength: u32,
  bestAcceptedCost: i32
): void {
        // === ERROR RECOVERY ENTRY ===
        debugLog(999000, head.pos, token, bestAcceptedCost);
        // ERROR BRANCH A & B: Unwind and Mutate
        // ----------------------------------------------------------------
        let initialScannerState = currentScannerState;
        
        // If forced reduction didn't work, we iteratively pop (unwind) states from the GSS
        // up to a depth of 5. For each popped state, we attempt:
        // Branch A: Deleting the current token (skip)
        // Branch B: Inserting a missing token (virtual shift)
        let unwindCurr: ParseHead | null = head;
        let unwindDepth = 0;
        while (unwindCurr != null && unwindDepth < 3) {
          let recState = unwindCurr.state;
          let recPrev = unwindCurr.prev;
          let recBalance = unwindCurr.balanceHash;
          let recPrec = unwindCurr.dynamicPrec;

          // Note: The scope boundary check that previously prevented unwinding
          // past }/)/] has been removed. It was scanning [unwindCurr.pos, head.pos)
          // which looks backward into already-parsed input. After a valid reduction
          // like `scope {}`, the `}` was inside this range despite being part of a
          // successfully consumed production, causing ALL structural recovery to be
          // aborted at depth 1. The PENALTY_UNWIND_NODE cost (500 per depth level)
          // is sufficient to naturally prevent excessively deep unwinds.

          // ------------------------------------------------------------
          // Branch A: Deletion (Skip Token)
          // ------------------------------------------------------------
          if (token != TOKEN_EOF) {
            let pCount = unwindDepth;
            let uCurr: ParseHead | null = head;
            let newBalance = head.balanceHash;
            for (let u = 0; u < pCount; u++) {
              if (uCurr != null) {
                newBalance = uCurr.balanceHash;
                uCurr = uCurr.prev;
              }
            }
            let uPos: u32 = uCurr ? uCurr.pos : 0;
            let uPadding: u32 = uCurr ? uCurr.pendingPadding : 0;
            let droppedBytes: u32 = head.pos > uPos ? head.pos - uPos : 0;

            debugLog(9995, head.pos, uPos, changetype<usize>(uCurr) as u32);

            let baseDelCost =
              getInsertCost(token == TOKEN_EOF ? 0 : token) + unwindDepth * PENALTY_UNWIND_NODE + droppedBytes;
            if (lexLen == 1 && lexPos < inputLength) {
              let c = changetype<UnmanagedUint8Array>(getInputBuffer())[lexPos];
              if (c == CHAR_LBRACE || c == CHAR_LBRACKET || c == CHAR_LPAREN) newBalance++;
              else if (c == CHAR_RBRACE || c == CHAR_RBRACKET || c == CHAR_RPAREN) {
                newBalance--;
                baseDelCost = getInsertCost(token) + (unwindDepth as i32);
              }
            }

            // A1. Standard Deletion: Discard current token(s) and advance scanner
            // We scan forward up to 5 tokens to see if deleting them allows the state to recover.
            // If unwindDepth > 0, we also try skipCount=0 (just unwinding without dropping the current token).
            let maxSkips: u32 = 5;
            let startSkip: u32 = unwindDepth == 0 ? 1 : 0;
            let a1NextScanPos = startSkip == 1 ? (srcLexPos + lexLen) : srcLexPos;
            
            // baseDelCost includes the cost of dropping 'token'. If we do startSkip=0,
            // we are NOT dropping 'token', so we refund its cost in a1DelCost.
            let a1DelCost = startSkip == 0 ? -getInsertCost(token == TOKEN_EOF ? 0 : token) : 0;

            if (configEnableBranchA1) {
            // Force lexer to recognize all tokens during recovery forward scan
            expected_tokens.fill(1);
            for (let skipCount: u32 = startSkip; skipCount <= maxSkips; skipCount++) {
              let savedLexPos = lexPos;
              let savedLexLen = lexLen;
              let savedSrcLexPos = srcLexPos;
              let savedScannerState = currentScannerState;

              let nextToken = invokeLexer(a1NextScanPos);
              let tokenEndPos = srcLexPos + lexLen;

              setLexPos(savedLexPos);
              setLexLen(savedLexLen);
              setSrcLexPos(savedSrcLexPos);
              setCurrentScannerState(savedScannerState);

              let tokCost = getInsertCost(nextToken == TOKEN_EOF ? 0 : nextToken);
              
              let canAccept = stateCanAccept(unwindCurr, recState, nextToken, 0);
              debugLog(60100, recState, nextToken, canAccept ? 1 : 0);

              if (canAccept) {
                // ── 2-token lookahead validation ──
                // After finding that nextToken can be accepted from recState,
                // check whether the SECOND token ahead can also be processed
                // from the state we'd reach AFTER shifting nextToken.
                // This prevents shallow recoveries that match one token but
                // immediately fail (e.g., "let <skip print> velocity ;" where
                // velocity matches Identifier but ';' doesn't match '=').
                let weakRecovery: bool = false;
                if (tokenEndPos < inputLength) {
                  let sv2_lp = lexPos, sv2_ll = lexLen, sv2_sp = srcLexPos, sv2_ss = currentScannerState;
                  expected_tokens.fill(1);
                  let secondToken = invokeLexer(tokenEndPos);
                  setLexPos(sv2_lp); setLexLen(sv2_ll); setSrcLexPos(sv2_sp); setCurrentScannerState(sv2_ss);

                  if (secondToken != TOKEN_EOF && secondToken != TOKEN_UNKNOWN) {
                    // Find the shift target state for nextToken from recState
                    let shiftTarget: i32 = -1;
                    let ao: i32 = -1;
                    if (recState >= 0 && recState < action_offsets.length) {
                      ao = action_offsets[recState];
                    }
                    if (ao >= 0 && ao < action_data.length) {
                      let ac = action_data[ao];
                      let aidx = ao + 1;
                      for (let ai: i32 = 0; ai < ac; ai++) {
                        let sym = action_data[aidx++];
                        let actCount = action_data[aidx++];
                        if (sym == nextToken || sym == 0) {
                          for (let aj: i32 = 0; aj < actCount; aj++) {
                            let atype = action_data[aidx++];
                            let atarget = action_data[aidx++];
                            if (atype == ACTION_SHIFT) {
                              shiftTarget = atarget;
                              break;
                            }
                          }
                          break;
                        } else {
                          aidx += actCount * 2;
                        }
                      }
                    }

                    if (shiftTarget != -1) {
                      // Check if secondToken can be accepted from the shifted state
                      let canAccept2 = stateCanAccept(unwindCurr, shiftTarget, secondToken, 0, 1, shiftTarget) > 0;
                      if (!canAccept2) {
                        weakRecovery = true;
                      }
                    }
                  }
                }

                let currChild: ParseHead | null = head;
                let childCount = 0;
                while (currChild != null && currChild != unwindCurr) {
                  if (childCount < MAX_CHILD_NODES) t_globalChildNodes[childCount] = currChild.astNode;
                  childCount++;
                  currChild = currChild.prev;
                }
                if (childCount > MAX_CHILD_NODES) childCount = MAX_CHILD_NODES;

                let errPad = uPadding;
                if (childCount > 0) {
                  let firstChildId = t_globalChildNodes[childCount - 1];
                  errPad = getNodePadding(firstChildId);
                } else if (head.pos < a1NextScanPos) {
                  let savedLexPos = lexPos;
                  let savedLexLen = lexLen;
                  let savedSrcLexPos = srcLexPos;
                  let savedScannerState = currentScannerState;
                  invokeLexer(head.pos);
                  errPad = srcLexPos > head.pos ? srcLexPos - head.pos : 0;
                  setLexLen(savedLexLen);
                  setLexPos(savedLexPos);
                  setSrcLexPos(savedSrcLexPos);
                  setCurrentScannerState(savedScannerState);
                }

                let errNode = allocNode(NODE_TYPE_ERROR, errPad, 0, newBalance & 0xff);
                let lastChild = 0;
                for (let k = childCount - 1; k >= 0; k--) {
                  let child = t_globalChildNodes[k];
                  if (child == 0) continue;
                  
                  if (getNodeType(child) == NODE_TYPE_ERROR) {
                    let errChild = getNodeFirstChild(child);
                    while (errChild != 0) {
                      let clone = cloneNodeShallow(errChild);
                      if (lastChild == 0) {
                        setNodePadding(clone, 0);
                        setFirstChild(errNode, clone);
                      } else setNextSibling(lastChild, clone);
                      lastChild = clone;
                      errChild = getNodeNextSibling(errChild);
                    }
                  } else {
                    let clone = cloneNodeShallow(child);
                    if (lastChild == 0) {
                      setNodePadding(clone, 0);
                      setFirstChild(errNode, clone);
                    } else setNextSibling(lastChild, clone);
                    lastChild = clone;
                  }
                }

                expected_tokens.fill(1);
                let p = head.pos;
                let newTail = head.errorTail;
                while (p < a1NextScanPos) {
                  let tok = invokeLexer(p);
                  if (tok == -1) break;
                  if (srcLexPos >= a1NextScanPos) break;
                  let tLen = lexLen;
                  if (tLen == 0) break;
                  let pad = srcLexPos > p ? srcLexPos - p : 0;
                  if (lastChild == 0) pad = 0; // Parent holds the padding
                  newTail = pushDiagnostic(newTail, srcLexPos as u32, (srcLexPos + tLen) as u32);
                  let tNode = allocNode((tok == TOKEN_UNKNOWN ? NODE_TYPE_ERROR : tok) as u16, pad as u32, tLen, 0);
                  if (lastChild == 0) setFirstChild(errNode, tNode);
                  else setNextSibling(lastChild, tNode);
                  lastChild = tNode;
                  p = srcLexPos + tLen;
                }
                
                let errByteLen = p > unwindCurr.pos + errPad ? p - unwindCurr.pos - errPad : 0;
                setNodeByteLength(errNode, errByteLen);

                // Weak recovery penalty: if the 2-token check showed the path
                // will fail right after resumption, inflate the cost so deeper
                // unwind paths that genuinely recover can compete.
                let weakPenalty: i32 = weakRecovery ? 50 : 0;

                let delHeadCost = head.errorCost + baseDelCost + a1DelCost + weakPenalty;
                // Only push delHead if we actually dropped tokens.
                // Pushing delHead when skipCount == 0 (0 dropped tokens)
                // will just infinite loop the parser at the exact same position and state.
                let shouldPushDelHead = (skipCount > 0);
                
                let delHead = allocParseHead(
                  recState,
                  errNode,
                  unwindCurr,
                  a1NextScanPos,
                  initialScannerState,
                  delHeadCost,
                  0, // pendingPadding (reset after recovery)
                  newBalance,
                  0, // consecutiveInsertions
                  recPrec,
                  0,
                  newTail
                );
                
                if (shouldPushDelHead) {
                  pushActiveHead(changetype<u32>(delHead));
                }
                break;
              }

              a1DelCost += tokCost;

              if (nextToken == TOKEN_EOF) break; // EOF

              a1NextScanPos = tokenEndPos;
            }

            // A3. Skip-to-EOF has been removed. Island Mode handles this fallback significantly better.

            // A2 has been removed to prevent AST corruption via concatLists on non-list nodes.
            } // end configEnableBranchA1
          }

          // ------------------------------------------------------------
          // Branch B: Insertion (Virtual Shift)
          // ------------------------------------------------------------
          // Search the action table for any valid SHIFT out of the unwound state.
          // Create a zero-length virtual AST node for that expected token.
          //
          // Guard: At depth=0, skip insertions if the last significant character
          // before head.pos is a scope closer (}, ), ]). This means the parser
          // just completed a scope-closing reduction and any insertion here would
          // absorb inter-scope garbage into the preceding node's byte length.
          // Island mode will handle the garbage correctly instead.
          if (configEnableBranchB) {
          let skipBranchB = false;
          if (unwindDepth == 0 && head.pos > 0) {
            // Scan backwards past whitespace to find the last significant character
            let scanBack: u32 = head.pos;
            while (scanBack > 0) {
              scanBack -= (inputEncoding == 0 ? 1 : inputEncoding <= 2 ? 2 : 4);
              if (scanBack == 0) break;
              let ch = peekChar(scanBack);
              if (ch != 32 && ch != 9 && ch != 10 && ch != 13) {  // not space/tab/LF/CR
                if (ch == 125 || ch == 41 || ch == 93) {  // } ) ]
                  skipBranchB = true;
                }
                debugLog(90000, head.pos, ch, skipBranchB ? 1 : 0);
                break;
              }
            }
          }
          if (!skipBranchB && head.consecutiveInsertions < 8) {
            for (let sym = 1; sym <= SYMBOL_COUNT; sym++) {
              let target = -1;
              
              if (sym <= MAX_TERMINAL_ID) {
                let res = stateCanAccept(unwindCurr, recState, sym, 0);
                if (res > 0) {
                  target = res - 1;
                }
              } else {
                // Non-terminal hallucination: look up the GOTO table
                let gOffset = goto_offsets[recState];
                if (gOffset >= 0 && gOffset < goto_data.length) {
                  let gCount = goto_data[gOffset];
                  let gIdx = gOffset + 1;
                  for (let i = 0; i < gCount; i++) {
                    if (goto_data[gIdx++] == sym) {
                      target = goto_data[gIdx];
                      break;
                    } else {
                      gIdx++;
                    }
                  }
                }
              }

              if (target != -1) {
                  if (sym == TOKEN_EOF && token != TOKEN_EOF) {
                    continue;
                  }
                  debugLog(60200, sym, target, recState);

                    let baseCost = getInsertCost(sym == TOKEN_EOF ? 0 : sym);
                    if (baseCost <= 0) baseCost = 10; // Prevent infinite loops from 0-cost insertions
                    let uPos = unwindCurr.pos;
                    let bDropped: u32 = head.pos > uPos ? head.pos - uPos : 0;
                    let retroCost = (unwindDepth as i32) * PENALTY_UNWIND_NODE + (bDropped as i32);
                    let actualCost = baseCost + retroCost;
                    
                    let candidateViable = false;
                    let laScanPos = head.pos;
                    
                    let savedLexPosB = lexPos;
                    let savedLexLenB = lexLen;
                    let savedSrcLexPosB = srcLexPos;
                    let savedScannerStateB = currentScannerState;

                    // Force lexer to recognize ANY token during lookahead.
                    // Without this, the lexer filters tokens via expected_tokens
                    // (set for current active heads), missing tokens the TARGET
                    // state needs (e.g., `;` after virtual Number insertion).
                    expected_tokens.fill(1);

                    for (let skip = 0; skip <= 3; skip++) {
                      if (laScanPos >= inputLength) {
                        if (skip == 0 && token == TOKEN_EOF && stateCanAccept(unwindCurr, target, TOKEN_EOF, 0, 1, target) > 0) {
                           candidateViable = true;
                        }
                        break;
                      }
                      
                      setLexPos(laScanPos);
                      let laTok = lex(laScanPos);
                      let laEnd = srcLexPos + lexLen;
                      let canAcceptLA = stateCanAccept(unwindCurr, target, laTok, 0, 1, target) > 0;
                      debugLog(60201, laTok, target, canAcceptLA ? 1 : 0);
                      if (canAcceptLA) {
                        candidateViable = true;
                        break;
                      }
                      
                      if (laTok == TOKEN_EOF) break;
                      laScanPos = laEnd;
                    }

                    setLexPos(savedLexPosB);
                    setLexLen(savedLexLenB);
                    setSrcLexPos(savedSrcLexPosB);
                    setCurrentScannerState(savedScannerStateB);

                    if (candidateViable) {
                        let pCount = unwindDepth;
                        let uCurr: ParseHead | null = head;
                        let newBalance = head.balanceHash;
                        for (let u = 0; u < pCount; u++) {
                          if (uCurr != null) {
                            newBalance = uCurr.balanceHash;
                            uCurr = uCurr.prev;
                          }
                        }
                        let uPadding: u32 = uCurr ? uCurr.pendingPadding : 0;
                        
                        let virtualLeaf = allocNode(sym as u16, 0, 0, newBalance & 0xff);
                        let ptr = virtualLeaf as usize;
                        changetype<ASTNode>(ptr).flags |= FLAG_IS_INSERTED;
                        let insHead = allocParseHead(
                          target,
                          virtualLeaf,
                          unwindCurr,
                          head.pos,
                          initialScannerState,
                          head.errorCost + actualCost,
                          0,
                          newBalance,
                          head.consecutiveInsertions + 1,
                          recPrec,
                          uPadding + bDropped,
                          head.errorTail
                        );
                        
                        debugLog(60202, sym, target, head.state);
                        if (target != head.state) {
                          pushActiveHead(changetype<u32>(insHead));
                          debugLog(60203, sym, target, head.errorCost + actualCost);
                        } else {
                          debugLog(60204, sym, target, 0); // DROPPED: target == head.state
                        }
                    }
                  }
            }
          }
          } // end configEnableBranchB

          unwindCurr = unwindCurr.prev;
          unwindDepth++;
        }
}
@inline
export function recoverIslandMode(
  head: ParseHead,
  inputLength: u32,
  bestAcceptedCost: i32,
  activeHeadsCount: u32
): void {
        // ERROR BRANCH D: Island Parsing (Panic Mode)
        // --------------------------------------------------------------------
        // If local insertions/deletions fail, we fallback to a coarse panic mode.
        // We advance the scanner forward until we hit a "sync token" (e.g. `}`, `;`, `end`).
        // Then we search the GSS stack backwards for a state that can consume that sync token.
        // Everything in between is wrapped in an ERROR node and discarded from the AST.
        if (configEnableIslandMode) {
        if (head.consecutiveInsertions == 0) {
          let syncCost = 15; // High initial penalty for destroying a span of code
          let searchPos = head.pos;
          let foundTarget = -1;
          let foundBalance = head.balanceHash;
          let currPop: ParseHead | null = null;
          let resumePos = 0;

           // Step 1: Scan forward for a synchronization point (capped to prevent O(N²))
          // Enable all tokens so the lexer can match any keyword/symbol during scanning.
          // Without this, keywords may be mis-lexed as identifiers when the current head's
          // expected_tokens bitmap has been cleared, preventing stateCanAccept from finding
          // a valid recovery anchor.
          expected_tokens.fill(1);
          let panicScanCount: u32 = 0;
          let targetScannerState = currentScannerState;
          while (searchPos <= inputLength && panicScanCount < MAX_PANIC_SCAN_TOKENS) {
            panicScanCount++;
            let tok = TOKEN_EOF;
            let tokenLen = 0;

            let stateBeforeLex = currentScannerState;

            if (searchPos < inputLength) {
              tok = invokeLexer(searchPos);
              if (tok == -1) break;
              tokenLen = lexLen;
              if (tokenLen == 0) break;
            }

            debugLog(60001, tok, searchPos, tokenLen);

            // We treat EVERY token as a potential synchronization point (like Tree-sitter's ERROR pseudo-node).
            // We rely on `stateCanAccept` to contextually determine if the popped state can resume here.
            let nextPos = searchPos < inputLength ? srcLexPos + tokenLen : searchPos;
            // Save lexer state before lookahead to prevent clobbering tok's lexLen
            let savedPanicLexLen = lexLen;
            let savedPanicLexPos = lexPos;
            let savedPanicSrcLexPos = srcLexPos;
            let savedPanicScannerState = currentScannerState;
            let nextTok = invokeLexer(nextPos); // lookahead token after the sync token
            // Restore lexer state so tokenLen stays valid for subsequent iterations
            setLexLen(savedPanicLexLen);
            setLexPos(savedPanicLexPos);
            setSrcLexPos(savedPanicSrcLexPos);
            setCurrentScannerState(savedPanicScannerState);

            currPop = head;
            let gssDepth: i32 = 0;
            // Remove artificial constraint: allow popping as deep as needed (cost will penalize).
            while (currPop != null && gssDepth < 20) {
              // Check if this popped state can eventually consume the sync token
              // stateCanAccept is reduction-aware!
              debugLog(999103, currPop.state, tok, nextTok);
              let canAcceptTok = stateCanAccept(currPop, currPop.state, tok);
              let canAcceptNext = stateCanAccept(currPop, currPop.state, nextTok);
              if (canAcceptTok > 0) {
                foundTarget = currPop.state;
                resumePos = searchPos;
                targetScannerState = stateBeforeLex;
                break;
              } else if (canAcceptNext > 0) {
                foundTarget = currPop.state;
                resumePos = nextPos;
                targetScannerState = savedPanicScannerState;
                break;
              }
              currPop = currPop.prev; // Pop stack
              gssDepth++;
            }
            debugLog(60003, foundTarget, gssDepth, resumePos);

            // (Brute-force fallback removed: it was too aggressive and matched invalid states for Identifier, causing infinite recovery loops. The GSS walk is sufficient now that stateCanAccept cache is fixed.)

            if (foundTarget != -1) break; // We found a recovery anchor!
            // If the sync token wasn't useful, consume it and keep scanning forward
            if (searchPos >= inputLength) break; // Cannot scan past EOF
            searchPos = nextPos;
            syncCost += 1; // +1 penalty for every token skipped during panic mode
          }
          debugLog(60004, foundTarget, panicScanCount as i32, resumePos);

          // Step 3: Apply the Panic Mode Recovery
          if (foundTarget != -1 && currPop != null && (resumePos as u32) <= inputLength) {
            // Calculate the true penalty for Panic Mode
            let poppedDepth = 0;
            let tempPop: ParseHead | null = head;
            while (tempPop != null && tempPop != currPop) {
              poppedDepth++;
              tempPop = tempPop.prev;
            }
            let islandCost =
              head.errorCost +
              poppedDepth * PENALTY_UNWIND_NODE +
              syncCost * PENALTY_SYNC_TOKEN +
              (resumePos - currPop.pos);

            // Collect all the AST nodes that were parsed between the anchor state and the failure point
            let currChild: ParseHead | null = head;
            let childCount = 0;
            while (currChild != null && currChild != currPop) {
              if (childCount < MAX_CHILD_NODES) {
                t_globalChildNodes[childCount] = currChild.astNode;
              }
              childCount++;
              currChild = currChild.prev;
            }
            if (childCount > MAX_CHILD_NODES) childCount = MAX_CHILD_NODES;

            let islandPad: u32 = 0;
            let islandScannerState = targetScannerState;
            if (childCount > 0) {
              let firstChildId = t_globalChildNodes[childCount - 1];
              islandPad = getNodePadding(firstChildId);
            } else if (head.pos < (resumePos as u32)) {
              let savedLexPos = lexPos;
              let savedSrcLexPos = srcLexPos;
              let savedLexLen = lexLen;
              let savedScannerState = currentScannerState;
              invokeLexer(head.pos);
              islandPad = srcLexPos > head.pos ? srcLexPos - head.pos : 0;
              setLexLen(savedLexLen);
              setLexPos(savedLexPos);
              setSrcLexPos(savedSrcLexPos);
              setCurrentScannerState(savedScannerState);
            }

            // Allocate a monolithic ERROR node container
            let islandLeaf = allocNode(NODE_TYPE_ERROR, islandPad, 0, head.balanceHash & 0xff);

            // Mount the discarded AST nodes as children of the ERROR node,
            // so the language server can still offer completions inside broken blocks.
            // If a popped node is already an ERROR node, flatten it to prevent deep nesting.
            let lastChild = 0;
            for (let k = childCount - 1; k >= 0; k--) {
              let child = t_globalChildNodes[k];
              if (child == 0) continue;
              
              if (getNodeType(child) == NODE_TYPE_ERROR) {
                let errChild = getNodeFirstChild(child);
                while (errChild != 0) {
                  let clone = cloneNodeShallow(errChild);
                  if (lastChild == 0) {
                    setNodePadding(clone, 0);
                    setFirstChild(islandLeaf, clone);
                  } else setNextSibling(lastChild, clone);
                  lastChild = clone;
                  errChild = getNodeNextSibling(errChild);
                }
              } else {
                let clone = cloneNodeShallow(child);
                if (lastChild == 0) {
                  setNodePadding(clone, 0);
                  setFirstChild(islandLeaf, clone);
                } else setNextSibling(lastChild, clone);
                lastChild = clone;
              }
            }

            // Lex any remaining raw garbage between the last parsed node and the resume position
            // This ensures discarded spaces aren't squiggled and the LSP doesn't merge everything
            expected_tokens.fill(1);
            let p = head.pos;
            let newTail = currPop != null ? currPop.errorTail : 0;
            
            // Determine the actual start of the first garbage token by peeking
            // forward from head.pos. head.pos sits right after the last consumed
            // token (e.g., after `;` on line 3), so it includes the newline and
            // indentation whitespace leading to the error tokens on the next line.
            // Using head.pos directly would create a ghost squiggle on the
            // previous line. Instead, lex once to get srcLexPos which is the
            // byte offset of the first real token after whitespace.
            let diagStart: u32 = head.pos;
            if ((resumePos as u32) > head.pos) {
              let savedLP = lexPos;
              let savedSLP = srcLexPos;
              let savedLL = lexLen;
              let savedSS = currentScannerState;
              let peekTok = invokeLexer(head.pos);
              if (peekTok != -1 && srcLexPos > head.pos) {
                diagStart = srcLexPos;  // skip whitespace
              }
              setLexLen(savedLL);
              setLexPos(savedLP);
              setSrcLexPos(savedSLP);
              setCurrentScannerState(savedSS);
            }

            while (p < (resumePos as u32)) {
              let tok = invokeLexer(p);
              if (tok == -1) break;
              if (srcLexPos >= (resumePos as u32)) break;

              // All tokens between the last valid parsed node and the recovery anchor
              // are definitively garbage (skipped by panic mode). We must consume them
              // and emit them as ERROR leaves so they get accurately squiggled,
              // regardless of whether they cross a line boundary.

              let tLen = lexLen;
              if (tLen == 0) break; // prevent infinite loop
              
              let insCost = tok == TOKEN_UNKNOWN ? 2 : token_insert_costs[tok];
              islandCost += (insCost > 0 ? insCost : 3);

              let pad = srcLexPos > p ? srcLexPos - p : 0;

              let tNode = allocNode((tok == TOKEN_UNKNOWN ? NODE_TYPE_ERROR : tok) as u16, pad, tLen, 0);
              // Do NOT set FLAG_IS_INSERTED here because this is shifting a real terminal, not inserting a missing one!
              if (lastChild == 0) {
                setNodePadding(tNode, 0);
                setFirstChild(islandLeaf, tNode);
              } else setNextSibling(lastChild, tNode);
              lastChild = tNode;

              // Emit a diagnostic specifically for this garbage token
              newTail = pushDiagnostic(newTail, srcLexPos, srcLexPos + tLen);

              p = srcLexPos + tLen;
            }

            // The ERROR node's byte length MUST cover all bytes from its
            // start up to the resume position (where the parser picks back
            // up). The parser resumes at `resumePos` and the next token's
            // padding is computed relative to that position. If we used
            // `actualEnd` (end of last garbage token) instead, there would
            // be a gap of uncovered bytes (trailing whitespace/newlines
            // between the error tokens and the resume point) that no node
            // accounts for, causing all subsequent sibling offsets to drift.
            let islandByteLen = (resumePos as u32) > currPop.pos + islandPad ? (resumePos as u32) - currPop.pos - islandPad : 0;
            setNodeByteLength(islandLeaf, islandByteLen);

            // Branch the GSS from the recovery anchor, shifting the new ERROR node.
            // We give it an artificially low errorCost so it ALWAYS survives the
            // primary culling phase against greedy local insertions, ensuring global recovery completes.
            let islandHead = allocParseHead(
              foundTarget,
              islandLeaf,
              currPop,
              resumePos,
              islandScannerState,
              islandCost,
              0,
              foundBalance,
              0, // consecutiveInsertions
              head.dynamicPrec,
              0, // pendingPadding
              newTail,
            );
            pushActiveHead(changetype<u32>(islandHead));
            debugLog(6, foundTarget, islandCost, resumePos);
          }
        }
        } // end configEnableIslandMode
}

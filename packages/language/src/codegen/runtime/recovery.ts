
import { ParseHead, ErrorBranch, allocErrorBranch, pushActiveHead, allocParseHead } from "./gss";
import { debugLog, pushDiagnostic, MAX_ERRORS, MAX_CHILD_NODES, t_globalChildNodes,
  action_offsets, action_data, ACTION_SHIFT, MAX_PANIC_SCAN_TOKENS, PENALTY_UNWIND_NODE, token_insert_costs,
  NODE_TYPE_ERROR
} from "./engine";
import { stateCanAccept, cloneNodeShallow, concatLists } from "./parser-loop";
import { 
  getNodePadding, 
  getNodeByteLength, 
  setNodeByteLength, 
  getNodeFirstChild, 
  setFirstChild, 
  setNextSibling,
  getNodeType,
  allocNode,
  getInputBuffer
} from "./arena";
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
  TOKEN_EOF
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
const PENALTY_UNWIND_NODE: i32 = 5;
const PENALTY_SYNC_TOKEN: i32 = 10;

@inline
export function recoverUnwindAndMutate(
  head: ParseHead,
  token: i32,
  inputLength: u32,
  bestAcceptedCost: i32
): void {
        // ERROR BRANCH A & B: Unwind and Mutate
        // ----------------------------------------------------------------
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

            let baseDelCost =
              token_insert_costs[token == TOKEN_EOF ? 0 : token] + unwindDepth * PENALTY_UNWIND_NODE + droppedBytes; // Token-specific deletion cost + unwind penalty
            if (lexLen == 1) {
              let c = load<u8>(getInputBuffer() + lexPos);
              if (c == CHAR_LBRACE || c == CHAR_LBRACKET || c == CHAR_LPAREN) newBalance++;
              else if (c == CHAR_RBRACE || c == CHAR_RBRACKET || c == CHAR_RPAREN) {
                newBalance--;
                baseDelCost = token_insert_costs[token] + (unwindDepth as i32);
              }
            }

            // A1. Standard Deletion: Discard current token(s) and advance scanner
            // We scan forward up to 5 tokens to see if deleting them allows the state to recover.
            let a1NextScanPos = srcLexPos + lexLen;
            let a1DelCost = 0;

            let maxSkips: u32 = 5;
            // Force lexer to recognize all tokens during recovery forward scan
            expected_tokens.fill(1);
            for (let skipCount: u32 = 1; skipCount <= maxSkips; skipCount++) {
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

              let tokCost = token_insert_costs[nextToken == TOKEN_EOF ? 0 : nextToken];
              
              let canAccept = stateCanAccept(unwindCurr, recState, nextToken, 0);
              debugLog(60100, recState, nextToken, canAccept ? 1 : 0);

              if (canAccept) {
                let currChild: ParseHead | null = head;
                let childCount = 0;
                while (currChild != null && currChild != unwindCurr) {
                  if (childCount < MAX_CHILD_NODES) store<i32>(t_globalChildNodes + childCount * 4, currChild.astNode);
                  childCount++;
                  currChild = currChild.prev;
                }
                if (childCount > MAX_CHILD_NODES) childCount = MAX_CHILD_NODES;

                let errPad = uPadding;
                let errLen = droppedBytes + (a1NextScanPos - head.pos);
                let errNode = allocNode(NODE_TYPE_ERROR, errPad, errLen, newBalance & 0xff);

                let lastChild = 0;
                for (let k = childCount - 1; k >= 0; k--) {
                  let child = load<i32>(t_globalChildNodes + k * 4);
                  if (child == 0) continue;
                  let clone = cloneNodeShallow(child);
                  if (lastChild == 0) setFirstChild(errNode, clone);
                  else setNextSibling(lastChild, clone);
                  lastChild = clone;
                }

                expected_tokens.fill(1);
                let p = head.pos;
                let newTail = head.errorTail;
                while (p < a1NextScanPos) {
                  let tok = invokeLexer(p);
                  if (tok == -1) break;
                  let pad = lexPos - p;
                  let token = lex(p);
                  let tLen = lexLen;
                  if (tLen == 0) break;
                  newTail = pushDiagnostic(newTail, lexPos as u32, (lexPos + tLen) as u32);
                  let tNode = allocNode(token as u16, pad, tLen, 0);
                  if (lastChild == 0) setFirstChild(errNode, tNode);
                  else setNextSibling(lastChild, tNode);
                  lastChild = tNode;
                  p = lexPos + tLen;
                }

                let merged = concatLists(unwindCurr.astNode, errNode, getNodeType(unwindCurr.astNode), newBalance & 0xff);

                let delHead = allocParseHead(
                  recState,
                  merged,
                  unwindCurr.prev,
                  a1NextScanPos,
                  currentScannerState,
                  head.errorCost + baseDelCost + a1DelCost,
                  0,
                  newBalance,
                  0,
                  recPrec,
                  0,
                  newTail
                );
                pushActiveHead(changetype<u32>(delHead));
                break;
              }

              a1DelCost += tokCost;

              if (nextToken == TOKEN_EOF) break; // EOF

              a1NextScanPos = tokenEndPos;
            }

            // A3. Skip-to-EOF: If the max skip window was exhausted without finding a
            // resumable token, but the state can accept EOF, scan all remaining tokens
            // to EOF. This prevents valid early parses from dying because there are too
            // many trailing garbage tokens.
            let canAcceptEof = stateCanAccept(unwindCurr, recState, TOKEN_EOF, 0);
            debugLog(776, recState, canAcceptEof ? 1 : 0, unwindDepth);
            if (canAcceptEof) {
              // Instead of manually lexing up to 1000 tokens, approximate the cost in O(1).
              // This prevents an O(N) slowdown where every error branch rescans trailing garbage.
              let remainingBytes: u32 = inputLength > head.pos ? inputLength - head.pos : 0;
              let approxTokens = remainingBytes / 5;
              let eofDelCost = approxTokens * 20;

              // Cap the total cost so trailing garbage doesn't exceed MAX_ERRORS and kill the parse.
              let totalCost = head.errorCost + baseDelCost + eofDelCost;
              if (totalCost > MAX_ERRORS - 50) {
                totalCost = MAX_ERRORS - 50;
              }

              let errPad = uPadding;
              let errLen = droppedBytes + remainingBytes;
              if (unwindDepth == 0 && srcLexPos > head.pos) {
                errPad += srcLexPos - head.pos;
                errLen = inputLength > srcLexPos ? inputLength - srcLexPos : 0;
              }
              // Collect dropped children between `head` and `unwindCurr`
              let currChild: ParseHead | null = head;
              let childCount = 0;
              while (currChild != null && currChild != unwindCurr) {
                if (childCount < MAX_CHILD_NODES) {
                  store<i32>(t_globalChildNodes + childCount * 4, currChild.astNode);
                }
                childCount++;
                currChild = currChild.prev;
              }
              if (childCount > MAX_CHILD_NODES) childCount = MAX_CHILD_NODES;

              let eofHead: ParseHead;
              if (childCount > 0 || errLen > 0) {
                let errNode = allocNode(NODE_TYPE_ERROR, errPad, errLen, newBalance & 0xff);
                let lastChild = 0;
                for (let k = childCount - 1; k >= 0; k--) {
                  let child = load<i32>(t_globalChildNodes + k * 4);
                  if (child == 0) continue;
                  let clone = cloneNodeShallow(child);
                  if (lastChild == 0) setFirstChild(errNode, clone);
                  else setNextSibling(lastChild, clone);
                  lastChild = clone;
                }

                // Force lexer to accept any token during error node construction
                expected_tokens.fill(1);
                let p = head.pos;
                let newTail = head.errorTail;
                while (p < inputLength) {
                  let tok = invokeLexer(p);
                  if (tok == -1) break;
                  let pad = lexPos - p;
                  let token = lex(p);
                  let tLen = lexLen;
                  if (tLen == 0) break; // prevent infinite loop

                  // Report each garbage token individually so spaces don't get squiggled
                  newTail = pushDiagnostic(newTail, lexPos as u32, (lexPos + tLen) as u32);

                  let tNode = allocNode(token as u16, pad, tLen, 0);
                  if (lastChild == 0) setFirstChild(errNode, tNode);
                  else setNextSibling(lastChild, tNode);
                  lastChild = tNode;

                  p = lexPos + tLen;
                }

                eofHead = allocParseHead(
                  recState,
                  errNode,
                  unwindCurr,
                  inputLength,
                  0, // Reset scanner state for EOF
                  totalCost,
                  0,
                  newBalance,
                  0,
                  recPrec,
                  0, // pendingPadding is absorbed
                  newTail,
                );
              } else {
                eofHead = allocParseHead(
                  recState,
                  unwindCurr.astNode,
                  unwindCurr.prev,
                  inputLength,
                  0, // Reset scanner state for EOF
                  totalCost,
                  0,
                  newBalance,
                  0,
                  recPrec,
                  0, // pendingPadding is absorbed
                  head.errorTail,
                );
              }
              pushActiveHead(changetype<u32>(eofHead));
              debugLog(777, totalCost, inputLength as i32, getNodeByteLength(unwindCurr.astNode) as i32);
            }

            // A2. Retrospective Deletion: Unwind state but keep the current token
            // E.g., we shifted a token prematurely, so we pop the state but leave the scanner where it is
            if (unwindDepth > 0) {
              if (stateCanAccept(unwindCurr, recState, token, 0)) {
                let retroCost = (unwindDepth as i32) * PENALTY_UNWIND_NODE + droppedBytes;
                
                let currChild: ParseHead | null = head;
                let childCount = 0;
                while (currChild != null && currChild != unwindCurr) {
                  if (childCount < MAX_CHILD_NODES) store<i32>(t_globalChildNodes + childCount * 4, currChild.astNode);
                  childCount++;
                  currChild = currChild.prev;
                }
                if (childCount > MAX_CHILD_NODES) childCount = MAX_CHILD_NODES;

                let errPad = uPadding;
                let errLen = droppedBytes;
                let errNode = allocNode(NODE_TYPE_ERROR, errPad, errLen, newBalance & 0xff);

                let lastChild = 0;
                for (let k = childCount - 1; k >= 0; k--) {
                  let child = load<i32>(t_globalChildNodes + k * 4);
                  if (child == 0) continue;
                  let clone = cloneNodeShallow(child);
                  if (lastChild == 0) setFirstChild(errNode, clone);
                  else setNextSibling(lastChild, clone);
                  lastChild = clone;
                }

                let newTail = head.errorTail;
                if (droppedBytes > 0) {
                    newTail = pushDiagnostic(newTail, uPos, head.pos);
                }

                let merged = concatLists(unwindCurr.astNode, errNode, getNodeType(unwindCurr.astNode), newBalance & 0xff);

                let retroHead = allocParseHead(
                  recState,
                  merged,
                  unwindCurr.prev,
                  head.pos,
                  currentScannerState,
                  head.errorCost + retroCost,
                  0,
                  newBalance,
                  0,
                  recPrec,
                  0,
                  newTail
                );
                pushActiveHead(changetype<u32>(retroHead));
                debugLog(5, recState, head.errorCost + retroCost, head.pos);
              }
            }
          }

          // ------------------------------------------------------------
          // Branch B: Insertion (Virtual Shift)
          // ------------------------------------------------------------
          // Search the action table for any valid SHIFT out of the unwound state.
          // Create a zero-length virtual AST node for that expected token.
          if (head.consecutiveInsertions < 8) {
            let aOffset = action_offsets[recState];
            if (aOffset >= 0 && aOffset < action_data.length) {
              let idx2 = aOffset + 1;
              let count2 = action_data[aOffset];

              for (let i = 0; i < count2; i++) {
                if (idx2 < 0 || idx2 + 1 >= action_data.length) {
                  throw new Error("BAD idx2 in error B");
                }
                let sym = action_data[idx2++];
                let actCount = action_data[idx2++];
                for (let j = 0; j < actCount; j++) {
                  let type = action_data[idx2++];
                  let target = action_data[idx2++];
                  if (type == ACTION_SHIFT) {
                    if (sym == TOKEN_EOF && token != TOKEN_EOF) {
                      continue;
                    }
                    debugLog(60200, sym, target, recState);

                    let baseCost = token_insert_costs[sym == TOKEN_EOF ? 0 : sym];
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
                        if (skip == 0 && token == TOKEN_EOF && stateCanAccept(unwindCurr, target, TOKEN_EOF, 0, 1)) {
                           candidateViable = true;
                        }
                        break;
                      }
                      
                      setLexPos(laScanPos);
                      let laTok = lex(laScanPos);
                      let laEnd = srcLexPos + lexLen;
                      let canAcceptLA = stateCanAccept(unwindCurr, target, laTok, 0, 1);
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
                        let insHead = allocParseHead(
                          target,
                          virtualLeaf,
                          unwindCurr,
                          head.pos,
                          currentScannerState,
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
            }
          }

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
          debugLog(60000, head.state, head.pos, head.consecutiveInsertions);
          let panicScanCount: u32 = 0;
          while (searchPos <= inputLength && panicScanCount < MAX_PANIC_SCAN_TOKENS) {
            panicScanCount++;
            let tok = TOKEN_EOF;
            let tokenLen = 0;

            if (searchPos < inputLength) {
              tok = invokeLexer(searchPos);
              if (tok == -1) break;
              tokenLen = lexLen;
              if (tokenLen == 0) break;
            }

            debugLog(60001, tok, searchPos, tokenLen);

            // We treat EVERY token as a potential synchronization point (like Tree-sitter's ERROR pseudo-node).
            // We rely on `stateCanAccept` to contextually determine if the popped state can resume here.
            let nextPos = searchPos < inputLength ? lexPos + tokenLen : searchPos;
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
            while (currPop != null) {
              // Check if this popped state can eventually consume the sync token
              // stateCanAccept is reduction-aware!
              let canAcceptTok = stateCanAccept(currPop, currPop.state, tok);
              let canAcceptNext = stateCanAccept(currPop, currPop.state, nextTok);
              debugLog(60002, currPop.state, canAcceptTok ? 1 : 0, canAcceptNext ? 1 : 0);
              if (canAcceptTok) {
                foundTarget = currPop.state;
                resumePos = searchPos;
                break;
              } else if (canAcceptNext) {
                foundTarget = currPop.state;
                resumePos = nextPos;
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
          // Skip recovery at EOF — wrapping the entire remaining file as ERROR
          // and accepting with an empty parse is never useful.
          if (foundTarget != -1 && currPop != null && (resumePos as u32) < inputLength) {
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
                store<i32>(t_globalChildNodes + childCount * 4, currChild.astNode);
              }
              childCount++;
              currChild = currChild.prev;
            }
            if (childCount > MAX_CHILD_NODES) childCount = MAX_CHILD_NODES;

            // Allocate a monolithic ERROR leaf that spans the entire discarded section
            let islandLeaf = allocNode(NODE_TYPE_ERROR, 0, resumePos - currPop.pos, head.balanceHash & 0xff);

            // Mount the discarded AST nodes as children of the ERROR node,
            // so the language server can still offer completions inside broken blocks.
            let lastChild = 0;
            for (let k = childCount - 1; k >= 0; k--) {
              let child = load<i32>(t_globalChildNodes + k * 4);
              if (child == 0) continue;
              let clone = cloneNodeShallow(child);
              if (lastChild == 0) setFirstChild(islandLeaf, clone);
              else setNextSibling(lastChild, clone);
              lastChild = clone;
            }

            // Lex any remaining raw garbage between the last parsed node and the resume position
            // This ensures discarded spaces aren't squiggled and the LSP doesn't merge everything
            expected_tokens.fill(1);
            let p = head.pos;
            let newTail = currPop != null ? currPop.errorTail : 0;
            while (p < (resumePos as u32)) {
              let tok = invokeLexer(p);
              if (tok == -1) break;
              let pad = lexPos - p;
              let token = lex(p);
              let tLen = lexLen;
              if (tLen == 0) break; // prevent infinite loop

              // Report each garbage token individually so spaces don't get squiggled
              newTail = pushDiagnostic(newTail, lexPos as u32, (lexPos + tLen) as u32);

              let tNode = allocNode(token as u16, pad, tLen, 0);
              if (lastChild == 0) setFirstChild(islandLeaf, tNode);
              else setNextSibling(lastChild, tNode);
              lastChild = tNode;

              p = lexPos + tLen;
            }

            // Branch the GSS from the recovery anchor, shifting the new ERROR node.
            // We give it an artificially low errorCost so it ALWAYS survives the
            // primary culling phase against greedy local insertions, ensuring global recovery completes.
            // We use head.errorCost + 1 to shield it from being instantly culled
            // by greedy local insertion branches.
            let islandHead = allocParseHead(
              foundTarget,
              islandLeaf,
              currPop,
              resumePos,
              currentScannerState,
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
}

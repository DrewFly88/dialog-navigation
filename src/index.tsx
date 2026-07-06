import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { ThemeType } from "./types";
import { useDialogIndex } from "./hooks/useDialogIndex";
import { useMessageMap } from "./hooks/useMessageMap";
import { useViewportTracker } from "./hooks/useViewportTracker";
import { BarStrip } from "./BarStrip";
import { SettingsPage } from "./SettingsPage";
import "./styles.css";

const LOG = "[dialog-index]";
const BUILD = "v0.7.2-20260630";

try {
  const host = window.QwenPaw?.host;
  const route = window.QwenPaw?.route;
  const pluginId = "dialog-navigation";

  if (!host) {
    console.error(LOG, "host not available");
  } else {
    // Main wrapper component
    const DialogIndexWrapper = (Inner: React.ComponentType) => {
      return () => {
        const theme = (host.useTheme?.() ?? "dark") as ThemeType;
        const session = host.useCurrentSession?.();
        const sessionId = session?.id ?? null;
        const agent = host.useSelectedAgent?.();
        const agentId = agent?.id ?? null;
        const imperativeId = host.getCurrentSessionId?.() ?? null;
        const chatContainerRef = useRef<HTMLDivElement | null>(null);
        // State flag: triggers re-render after container is found,
        // so hooks (useMessageMap, useViewportTracker) see the updated ref.
        const [containerReady, setContainerReady] = useState(false);
        const hasLogged = useRef(false);

        // Diagnostic log — confirm wrapper renders
        if (!hasLogged.current) {
          hasLogged.current = true;
          console.log(LOG, "Wrapper RENDERED", {
            theme,
            hookSessionId: sessionId,
            agentId,
            imperativeSessionId: imperativeId,
            hasHostFetch: typeof host.fetch === "function",
          });
        }

        const { indexData, loading, refresh } = useDialogIndex(sessionId, agentId);
        const totalCards = indexData.stats.totalCards;
        const totalCardsRef = useRef(totalCards);
        totalCardsRef.current = totalCards; // Keep ref in sync during render

        // Debounced refresh for DOM-triggered updates (avoids rapid API calls during streaming)
        const debouncedRefresh = useMemo(() => {
          let timer: ReturnType<typeof setTimeout>;
          return () => {
            clearTimeout(timer);
            timer = setTimeout(refresh, 300);
          };
        }, [refresh]);

        const { cardCount: _cc } = useMessageMap(chatContainerRef, debouncedRefresh, containerReady);
        const [activeBubbleIndex, activeToolIndex] = useViewportTracker(chatContainerRef, totalCards, containerReady);

        // Navigation loading state — shows "对话加载中…" in BarStrip
        const [isNavigating, setIsNavigating] = useState(false);

        // Refresh index when page becomes visible again
        useEffect(() => {
          const onVisibilityChange = () => {
            if (document.visibilityState === "visible") {
              console.log(LOG, "page visible, refreshing index");
              refresh();
            }
          };
          document.addEventListener("visibilitychange", onVisibilityChange);
          return () => document.removeEventListener("visibilitychange", onVisibilityChange);
        }, [refresh]);

        // Find the chat scroll container after mount and when session changes
        useEffect(() => {
          // Reset container ready state when session changes
          setContainerReady(false);
          const timer = setTimeout(() => {
            // The actual scrollable container is .qwenpaw-bubble-list (overflow-y: auto).
            // Always prefer it — don't check scrollHeight because content-visibility: auto
            // may reduce it before all cards are loaded.
            const directList = document.querySelector('.qwenpaw-bubble-list');
            let found: HTMLElement | null = null;
            if (directList instanceof HTMLElement) {
              found = directList;
            }
            // Fallback: check other scrollable containers
            if (!found) {
              const preferred = [
                "[class*='chatMessagesArea']",
                "[class*='bubble-list-wrapper']",
              ];
              for (const sel of preferred) {
                const el = document.querySelector(sel);
                if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 10) {
                  found = el;
                  break;
                }
              }
            }
            // Fallback: any scrollable chat-related container
            if (!found) {
              const candidates = document.querySelectorAll(
                "[class*='chat'], [class*='Chat'], [class*='scroll']"
              );
              console.log(LOG, "container fallback search:", candidates.length, "candidates");
              for (const el of candidates) {
                if (
                  el instanceof HTMLElement &&
                  el.scrollHeight > el.clientHeight + 10
                ) {
                  found = el;
                  break;
                }
              }
            }
            if (found) {
              chatContainerRef.current = found;
              console.log(LOG, "container found:", found.className?.slice(0, 60));
              setContainerReady(true); // trigger re-render so hooks see the ref
            } else {
              console.log(LOG, "no scrollable container found");
            }
          }, 2000);
          return () => clearTimeout(timer);
        }, [imperativeId]);

        // Scroll to message by parser bubbleIndex.
        // DOM layout (column-reverse, newest first):
        //   [0] spacer  [1] newest-agent  [2] newest-user
        //   [3] newer-agent  [4] newer-user  ...  [N-2] oldest-agent  [N-1] oldest-user
        //
        // Each turn = 2 DOM elements (agent card + user bubble), pairs after [0] spacer.
        // cardIdx N (1-based, newest=1) maps to DOM idx:
        //   - agent card (odd cardIdx): idx = 1 + (cardIdx - 1) * 2       (1, 3, 5, ...)
        //   - user bubble (even cardIdx): idx = 1 + (cardIdx - 1) * 2     (2, 4, 6, ...)
        // Wait — cardIdx here is parser bubbleIndex which already encodes the turn:
        //   bubbleIndex 1 (newest agent) → idx 1,  bubbleIndex 2 (newest user) → idx 2
        //   bubbleIndex 3 → idx 3,  ...  bubbleIndex N → idx N
        // So childrenIndex = bubbleIndex (1-based, matches DOM idx directly after spacer).
        //
        // If target not in DOM: scroll loadMore into view to trigger SDK's
        // native IntersectionObserver (only reliable loading mechanism).
        // Show "对话加载中…" via isNavigating during loading, then one final
        // scroll to target. Fiber dispatch doesn't work because session
        // re-fetch (triggered by 500ms polling) resets the dispatched state.
        const navigateToMessage = useCallback(
          async (parserIdx: number, childIndex?: number, group?: string, itemId?: string) => {
            const container = chatContainerRef.current;
            if (!container) return;

            const tc = totalCardsRef.current;
            if (tc <= 0) return;

            const bubbleList =
              container.querySelector(".qwenpaw-bubble-list") || container;

            // §29: parser bubbleIndex 与 SDK DOM 映射——用 SDK agent card 总数反算。
            // 视口追踪器实测正确公式: bubbleIndex = sdkCardCount - 1 - agentDomPos
            //   → agentDomPos = sdkCardCount - 1 - bubbleIndex
            //   → domIdx = 1 + agentDomPos * 2 (spacer 占 idx 0，后成对)
            // 注: parser cardIdx 有跳跃(SDK 合并多消息为单卡)，此公式对单消息卡精准，
            // 多消息卡可能偏移——根因是 parser 与 SDK 坐标系不一致，需架构层修复。
            const isTopic = group === "topic";
            const agentCards = Array.from(bubbleList.children).filter((el) =>
              el.classList.contains("qwenpaw-bubble-start")
            );
            const sdkCardCount = agentCards.length;
            const agentDomPos = sdkCardCount - 1 - parserIdx;
            const childrenIndex = isTopic
              ? 2 + agentDomPos * 2  // user bubble
              : 1 + agentDomPos * 2; // agent card

            const getTarget = (): HTMLElement | null => {
              const cl = bubbleList.children;
              return childrenIndex >= 1 && childrenIndex < cl.length
                ? (cl[childrenIndex] as HTMLElement)
                : null;
            };

            let target = getTarget();

            if (!target) {
              setIsNavigating(true);
              try {
                // Kick off loadMore once to trigger DOM change + potential
                // session re-fetch, then wait for everything to settle before
                // starting the actual scrollToLoadMore loop. Without this,
                // the re-fetch happens DURING the loop, shifting the DOM
                // after the target has been positioned.
                const kickEl = bubbleList.querySelector(
                  ".qwenpaw-bubble-list-load-more"
                ) as HTMLElement | null;
                if (kickEl) {
                  kickEl.scrollIntoView({ block: "start" });
                }
                // Wait for re-fetch to complete and DOM to stabilize
                await new Promise((r) => setTimeout(r, 1500));
                target = getTarget();

                if (!target) {
                  // SDK paginates PAGE_SIZE=10 cards per loadMore trigger.
                  // A long session can have up to tc cards (tc up to ~80+),
                  // requiring up to ~8 successful loads from an initial 10.
                  // Allow more attempts (20) to cover re-fetch overhead and
                  // SDK throttling, and only give up after consecutive stalled
                  // rounds (not a single one) — a momentary stall can happen
                  // when the SDK re-fetches session state mid-loop.
                  let prevCount = Array.from(bubbleList.children).filter(
                    (el) => el.classList.contains("qwenpaw-bubble-start") ||
                            el.classList.contains("qwenpaw-bubble-end")
                  ).length;
                  let stallCount = 0;
                  for (let attempt = 0; attempt < 20; attempt++) {
                    const loadMore = bubbleList.querySelector(
                      ".qwenpaw-bubble-list-load-more"
                    ) as HTMLElement | null;
                    if (!loadMore) break; // all history loaded
                    loadMore.scrollIntoView({ block: "start" });
                    await new Promise((r) => setTimeout(r, 800));
                    target = getTarget();
                    if (target) {
                      console.log(LOG, `target found after ${attempt+1} scroll loads`);
                      break;
                    }
                    const newCount = Array.from(bubbleList.children).filter(
                      (el) => el.classList.contains("qwenpaw-bubble-start") ||
                              el.classList.contains("qwenpaw-bubble-end")
                    ).length;
                    if (newCount === prevCount) {
                      stallCount++;
                      // Consecutive 3 stalls with loadMore still present
                      // means SDK is not yielding more cards — give up.
                      if (stallCount >= 3) {
                        console.warn(LOG, `loadMore stalled 3x consecutively, giving up at attempt ${attempt+1}`);
                        break;
                      }
                    } else {
                      stallCount = 0;
                    }
                    prevCount = newCount;
                  }
                }
              } finally {
                setIsNavigating(false);
              }
            }

            if (target) {
              // Detect header overlayer height for scroll offset.
              // Without this, scrollIntoView's "start" aligns with viewport
              // top, hiding the target behind the fixed header.
              const headerEl = document.querySelector(
                ".qwenpaw-chat-anywhere-layout-right-header"
              );
              let headerHeight = 60; // safe default
              if (headerEl instanceof HTMLElement) {
                const rect = headerEl.getBoundingClientRect();
                headerHeight = rect.height + 8;
              }

              // For topic (even parserIdx): children[tc-parserIdx] IS the user
              // bubble — scroll to it directly.
              // For assistant items (tool/code/conclusion, odd parserIdx):
              // children[tc-parserIdx] is the agent card. Use childIndex
              // to find the precise DOM element within the card.
              let precisionTarget: HTMLElement | null = target;

              if (!isTopic && childIndex !== undefined && group && target) {
                let selector = '';
                if (group === 'tool') {
                  selector = '[class*="toolCallLabel"]';
                } else if (group === 'code') {
                  selector = 'pre code, [class*="toolCallCompact"] code';
                } else if (group === 'conclusion') {
                  selector = 'strong, li';
                }
                if (selector) {
                  const candidates = target.querySelectorAll<HTMLElement>(selector);
                  // For tools, deduplicate labels to match parser's call_id dedup
                  if (group === 'tool') {
                    const seen = new Set<string>();
                    let matchIdx = 0;
                    for (const el of candidates) {
                      const txt = (el.textContent || '').trim();
                      if (txt && !seen.has(txt)) {
                        seen.add(txt);
                        if (matchIdx === childIndex) {
                          precisionTarget = el.closest('[class*="toolCallCompact"]') as HTMLElement || el;
                          console.log(LOG, `precision: tool[${childIndex}] matched by unique label`);
                          break;
                        }
                        matchIdx++;
                      }
                    }
                  } else {
                    const precise = candidates[childIndex];
                    if (precise) {
                      precisionTarget = precise;
                      console.log(LOG, `precision: ${group}[${childIndex}] found`);
                    }
                  }
                }
              }

              const scrollTarget = precisionTarget;

              if (scrollTarget) {
                // Wait for layout to settle after loadMore batches
                // This prevents "overshoot" where content-visibility: auto
                // hasn't computed layout for newly added cards yet.
                await new Promise((r) => requestAnimationFrame(r));
                await new Promise((r) => requestAnimationFrame(r));

                // Apply scroll-margin-top inline so the target clears the
                // fixed header overlayer.
                const prevMargin = scrollTarget.style.scrollMarginTop;
                scrollTarget.style.scrollMarginTop = `${headerHeight}px`;

                scrollTarget.scrollIntoView({
                  behavior: "auto",
                  block: "start",
                });
                scrollTarget.classList.add("dip-highlight-flash");

                // Log final position immediately (scroll is instant, no
                // animation delay). The 2s timeout only removes the flash.
                const bubbleText = (scrollTarget.textContent || '').substring(0, 40);
                const bubbleRect = scrollTarget.getBoundingClientRect();
                console.log(
                  LOG,
                  `navigated to parserIdx=${parserIdx} "${bubbleText}" at (${Math.round(bubbleRect.left)},${Math.round(bubbleRect.top)})`
                );

                setTimeout(() => {
                  scrollTarget.classList.remove("dip-highlight-flash");
                  scrollTarget.style.scrollMarginTop = prevMargin || "";
                }, 2000);
              }
            }
          },
          []
        );

        return (
          <>
            <Inner />
            {createPortal(
              <BarStrip
                indexData={indexData}
                activeBubbleIndex={activeBubbleIndex}
                activeToolIndex={activeToolIndex}
                theme={theme}
                onNavigate={navigateToMessage}
                isLoading={isNavigating}
              />,
              document.body
            )}
          </>
        );
      };
    };

    // Register route.wrap using window.QwenPaw.route namespace
    const disposable = route?.wrap?.(
      pluginId,
      "core.chat",
      DialogIndexWrapper
    );

    // Register settings page in sidebar
    const menu = (window as any).QwenPaw?.menu;
    const settingsDisposable = route?.add?.(pluginId, {
      id: "dialog-navigation.settings",
      path: "/plugin/dialog-navigation/settings",
      component: SettingsPage,
    });
    const menuDisposable = menu?.add?.(pluginId, {
      id: "dialog-navigation.settings",
      label: "对话索引设置",
      icon: "📑",
      route: "dialog-navigation.settings",
    });
    console.log(LOG, BUILD, "settings registered:", !!settingsDisposable, !!menuDisposable);

    // Cleanup on unload
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        disposable?.dispose?.();
      });
    }

    console.log(LOG, BUILD, "registered, has route.wrap:", typeof route?.wrap);
  }
} catch (e) {
  console.error(LOG, "init failed:", e);
}

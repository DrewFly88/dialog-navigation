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
  const pluginId = "dialog-index-plugin";

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
        const activeBubbleIndex = useViewportTracker(chatContainerRef, totalCards, containerReady);

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
        //   [0] spacer      [1] newest-agent  [2] newest-user
        //   [3] newer-agent [4] newer-user     ... [N-2] oldest-agent [N-1] oldest-user
        //
        // Key insight: each SDK card = 1 DOM element.
        // DOM children order = newest SDK card first, oldest last.
        // SDK loads cards from newest downward: indices S-1, S-2, ..., S-M.
        //
        // Correct DOM position for SDK card at index parserIdx:
        //   childrenIndex = totalCards - parserIdx
        // (totalCards = S = total SDK cards from parser = total card groups)
        //
        // When target card is NOT yet loaded into DOM, childrenIndex >= children.length.
        // Need to trigger SDK loadMore until children.length > childrenIndex.
        // Each loadMore batch loads PAGE_SIZE=10 SDK cards.
        const navigateToMessage = useCallback(
          async (parserIdx: number) => {
            const container = chatContainerRef.current;
            if (!container) return;

            const tc = totalCardsRef.current;
            if (tc <= 0) return;

            const bubbleList =
              container.querySelector(".qwenpaw-bubble-list") || container;

            const isTopic = parserIdx % 2 === 0;
            const childrenIndex = tc - parserIdx;

            const getTarget = (): HTMLElement | null => {
              const cl = bubbleList.children;
              return childrenIndex >= 1 && childrenIndex < cl.length
                ? (cl[childrenIndex] as HTMLElement)
                : null;
            };

            let target = getTarget();

            // If target not in DOM yet, calculate how many batches needed.
            // Each loadMore batch loads ~PAGE_SIZE SDK cards.
            if (!target) {
              const PAGE_SIZE = 10;
              const currentBubbles = Array.from(bubbleList.children).filter(
                (el) =>
                  el.classList.contains("qwenpaw-bubble-start") ||
                  el.classList.contains("qwenpaw-bubble-end")
              ).length;
              // Cards needed = target position - current position + margin
              // totalPages = ceil(neededCards / PAGE_SIZE) + 1 safety margin
              const cardsNeeded = childrenIndex - currentBubbles + 1;
              const totalBatches = Math.ceil(cardsNeeded / PAGE_SIZE) + 1;
              console.log(
                LOG,
                `need ${cardsNeeded} more cards (${totalBatches} batches) for parserIdx ${parserIdx}`
              );

              let prevCount = currentBubbles;
              for (let attempt = 0; attempt < totalBatches; attempt++) {
                const loadMore = bubbleList.querySelector(
                  ".qwenpaw-bubble-list-load-more"
                ) as HTMLElement | null;
                if (!loadMore) {
                  console.log(LOG, "no more cards to load (load-more gone)");
                  break;
                }
                loadMore.scrollIntoView({ block: "start" });
                // Wait for SDK to process + React re-render
                await new Promise((r) => setTimeout(r, 800));
                target = getTarget();
                if (target) {
                  console.log(
                    LOG,
                    `target found after ${attempt + 1}/${totalBatches} batches`
                  );
                  break;
                }
                const newCount = Array.from(bubbleList.children).filter(
                  (el) =>
                    el.classList.contains("qwenpaw-bubble-start") ||
                    el.classList.contains("qwenpaw-bubble-end")
                ).length;
                if (newCount === prevCount) {
                  console.log(LOG, `DOM stable at ${prevCount}, no more cards`);
                  break;
                }
                prevCount = newCount;
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

              // Always find the user bubble for both topic and assistant items.
              // In column-reverse DOM layout, the user bubble (bubble-end) is
              // the element AFTER the agent card (bubble-start) in visual flow,
              // which is the next DOM sibling of the agent card.
              // For topic (even parserIdx): children[tc-parserIdx] IS the user bubble.
              // For assistant (odd parserIdx): children[tc-parserIdx] is the agent card,
              //   the user bubble is its nextElementSibling.
              let userBubble: HTMLElement | null;
              if (isTopic) {
                userBubble = target;
              } else {
                const sibling = target.nextElementSibling;
                userBubble =
                  sibling instanceof HTMLElement &&
                  (sibling.classList.contains("qwenpaw-bubble-end") ||
                    sibling.className.includes("bubble-end"))
                    ? sibling
                    : target;
              }

              if (userBubble) {
                // Wait for layout to settle after loadMore batches
                // This prevents "overshoot" where content-visibility: auto
                // hasn't computed layout for newly added cards yet.
                await new Promise((r) => requestAnimationFrame(r));
                await new Promise((r) => requestAnimationFrame(r));

                // Apply scroll-margin-top inline so the target clears the
                // fixed header overlayer.
                const prevMargin = userBubble.style.scrollMarginTop;
                userBubble.style.scrollMarginTop = `${headerHeight}px`;

                userBubble.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
                userBubble.classList.add("dip-highlight-flash");

                // Restore scroll-margin-top after scroll animation completes
                setTimeout(() => {
                  userBubble.classList.remove("dip-highlight-flash");
                  userBubble.style.scrollMarginTop = prevMargin || "";
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
                theme={theme}
                onNavigate={navigateToMessage}
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
      id: "dialog-index-plugin.settings",
      path: "/plugin/dialog-index-plugin/settings",
      component: SettingsPage,
    });
    const menuDisposable = menu?.add?.(pluginId, {
      id: "dialog-index-plugin.settings",
      label: "对话索引设置",
      icon: "📑",
      route: "dialog-index-plugin.settings",
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

import { useEffect, useRef, useCallback, useState } from "react";
import { flushSync } from "../react-shim";

const LOG = "[dialog-index]";
const PAGE_SIZE = 10; // SDK pagination constant (dY = 10)

export function useMessageMap(
  chatContainerRef: React.RefObject<HTMLElement | null>,
  onNewMessages?: () => void,
  containerReady?: boolean
) {
  const observerRef = useRef<MutationObserver | null>(null);
  const onNewMessagesRef = useRef(onNewMessages);
  const [cardCount, setCardCount] = useState(0);

  useEffect(() => {
    onNewMessagesRef.current = onNewMessages;
  }, [onNewMessages]);

  /** Find direct children of bubble list (all SDK-rendered elements) */
  const getCardElements = useCallback((): Element[] => {
    const container = chatContainerRef.current;
    if (!container) return [];

    const bubbleList =
      container.querySelector(".qwenpaw-bubble-list") || container;

    // Try primary selector
    let els = Array.from(
      bubbleList.querySelectorAll(":scope > .qwenpaw-bubble")
    );

    // Fallback: include bubble-end/bubble-start (user messages may be separate)
    if (els.length === 0) {
      for (const sel of [
        ":scope > [class*='bubble-end'], :scope > [class*='bubble-start']",
        ":scope > [class*='message']",
      ]) {
        els = Array.from(bubbleList.querySelectorAll(sel));
        if (els.length > 0) break;
      }
    }

    // Last resort: filter children by class name
    if (els.length === 0) {
      els = Array.from(bubbleList.children).filter(
        (el) =>
          el.classList.contains("qwenpaw-bubble") ||
          el.className.includes("bubble")
      );
    }

    return els;
  }, [chatContainerRef]);

  /**
   * Load cards via React fiber dispatch — silent, no scroll involved.
   *
   * SDK renders history via `historyMessages.slice(0, page * PAGE_SIZE)`.
   * We find the pagination hook via fiber internals and dispatch the
   * target page to force React to re-render with more cards.
   *
   * Key improvement over previous versions: we use actual DOM bubble
   * count (`domPage`) to decide whether dispatch is needed, instead of
   * the SDK's `useState` currentPage (which may be inflated/out of sync
   * with actual DOM rendering).
   *
   * @param sdkCardPos SDK card position needed (0 = newest).
   * @param bubbleList The bubble-list element (for DOM counting).
   */
  const loadCardsToPosition = useCallback(
    async (sdkCardPos: number, bubbleList: HTMLElement): Promise<void> => {
      // Count actual bubbles in DOM to compute domPage
      const actualBubbles = Array.from(bubbleList.children).filter(
        (el) =>
          el.classList.contains("qwenpaw-bubble-start") ||
          el.classList.contains("qwenpaw-bubble-end")
      ).length;
      const domPage = Math.ceil(actualBubbles / PAGE_SIZE);

      // Target page: how many pages we need to reach sdkCardPos
      const targetPage = Math.ceil((sdkCardPos + 1) / PAGE_SIZE) + 1;

      if (domPage >= targetPage) {
        // Already have enough cards in DOM
        console.log(LOG, `domPage ${domPage} >= target ${targetPage}, no dispatch needed`);
        return;
      }

      console.log(
        LOG,
        `need dispatch: domPage ${domPage} < target ${targetPage} for sdkCardPos ${sdkCardPos}`
      );

      const fiberKey = Object.keys(bubbleList).find((k) =>
        k.startsWith("__reactFiber")
      );
      if (!fiberKey) {
        console.log(LOG, "fiber key not found, falling back to scroll trigger");
        // Fallback: trigger loadMore via scroll
        const loadMore = bubbleList.querySelector(
          ".qwenpaw-bubble-list-load-more"
        ) as HTMLElement | null;
        if (loadMore) {
          loadMore.scrollIntoView({ block: "start" });
        }
        return;
      }

      let fiber = (bubbleList as any)[fiberKey];
      let depth = 0;
      while (fiber && depth < 30) {
        if (fiber.memoizedState) {
          let hook = fiber.memoizedState;
          let hookIdx = 0;
          while (hook && hookIdx < 20) {
            if (
              hook.queue &&
              typeof hook.memoizedState === "number" &&
              hook.memoizedState > 0 &&
              hook.memoizedState <= 10
            ) {
              try {
                // Dual-phase dispatch wrapped in flushSync to force
                // synchronous React re-render (matches SDK's native
                // loadMore which also uses flushSync).
                flushSync?.(() => {
                  hook.queue.dispatch(1);
                });
                await new Promise((r) => setTimeout(r, 100));
                flushSync?.(() => {
                  hook.queue.dispatch(targetPage);
                });
                console.log(
                  LOG,
                  `fiber dispatch 1→${targetPage} for sdkCardPos ${sdkCardPos}`
                );
              } catch {
                console.warn(LOG, "fiber dispatch failed");
              }
              return;
            }
            hook = hook.next;
            hookIdx++;
          }
        }
        fiber = fiber.return;
        depth++;
      }

      console.log(LOG, "fiber hook not found, falling back to scroll trigger");
      const loadMore = bubbleList.querySelector(
        ".qwenpaw-bubble-list-load-more"
      ) as HTMLElement | null;
      if (loadMore) {
        loadMore.scrollIntoView({ block: "start" });
      }
    },
    [chatContainerRef]
  );

  // Reset state when container/session changes
  useEffect(() => {
    setCardCount(0);
  }, [chatContainerRef, containerReady]);

  // Count cards and detect new messages via MutationObserver
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    let cancelled = false;

    const countCards = () => {
      if (cancelled) return;
      const els = getCardElements();
      const newCount = els.length;
      setCardCount((prev) => {
        if (newCount !== prev && prev > 0 && newCount > prev) {
          onNewMessagesRef.current?.();
        }
        return newCount;
      });
    };

    // Initial count
    countCards();

    // Debounced observer to avoid rapid updates during streaming
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    observerRef.current = new MutationObserver(() => {
      if (cancelled) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        countCards();
      }, 200);
    });
    observerRef.current.observe(container, {
      childList: true,
      subtree: true,
    });

    return () => {
      cancelled = true;
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [chatContainerRef, containerReady, getCardElements]);

  return { cardCount, loadCardsToPosition };
}

import { useEffect, useRef, useCallback, useState } from "react";

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
   * Load cards up to a specific SDK card position via React fiber pagination.
   *
   * SDK renders each conversation turn as ONE SDK card, but the DOM gets
   * 2 elements per turn: agent card + user bubble. The SDK pagination
   * (dY = 10) controls SDK cards, NOT DOM elements.
   *
   * Strategy: 双阶段 dispatch（方案 B）
   * - 如果 targetPage > currentPage → dispatch(targetPage) 即可
   * - 如果 targetPage == currentPage → 先 dispatch(1) 降级，再 dispatch(targetPage) 升回
   *   确保 React 检测到状态变化触发重新渲染
   *
   * @param sdkCardPos The SDK card position (0 = newest). NOT the DOM element index.
   */
  const loadCardsToPosition = useCallback(
    async (sdkCardPos: number): Promise<void> => {
      const container = chatContainerRef.current;
      if (!container) return;

      const bubbleList =
        container.querySelector(".qwenpaw-bubble-list") || container;

      const fiberKey = Object.keys(bubbleList).find((k) =>
        k.startsWith("__reactFiber")
      );
      if (!fiberKey) {
        console.log(LOG, "fiber key not found");
        return;
      }

      // SDK page size is in SDK cards (turns), not DOM elements.
      // sdkCardPos is already in SDK-card units, so:
      const targetPage = Math.ceil((sdkCardPos + 1) / PAGE_SIZE) + 1;

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
                const currentPage = hook.memoizedState;
                if (targetPage > currentPage) {
                  // Normal case: just dispatch the target
                  hook.queue.dispatch(targetPage);
                  console.log(
                    LOG,
                    `dispatched page ${targetPage} for sdkCardPos ${sdkCardPos} (was ${currentPage})`
                  );
                } else if (targetPage === currentPage) {
                  // Dual-phase dispatch: force a state change by going down first
                  console.log(
                    LOG,
                    `dual-dispatch: current ${currentPage} == target ${targetPage}, dropping to 1 first`
                  );
                  hook.queue.dispatch(1);
                  await new Promise((r) => setTimeout(r, 100));
                  hook.queue.dispatch(targetPage);
                  console.log(
                    LOG,
                    `dual-dispatch: back to page ${targetPage} for sdkCardPos ${sdkCardPos}`
                  );
                } else {
                  // targetPage < currentPage: already loaded enough
                  console.log(
                    LOG,
                    `already loaded page ${currentPage} >= target ${targetPage} for sdkCardPos ${sdkCardPos}`
                  );
                }
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

      console.log(LOG, "fiber pagination hook not found");
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

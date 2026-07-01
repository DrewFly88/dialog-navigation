import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Track which card is currently in the viewport using dynamic index computation.
 *
 * DOM structure (column-reverse layout):
 *   [spacer] [newest-agent] [newest-user] ... [oldest-agent] [oldest-user] [load-more]
 *
 * Each conversation turn produces 2 DOM elements:
 *   - Agent card: .qwenpaw-bubble-start (also has .qwenpaw-bubble)
 *   - User bubble: .qwenpaw-bubble-end (also has .qwenpaw-bubble)
 *
 * Parser assigns cardIdx per turn:
 *   - Topics (user messages): even cardIdx (0, 2, 4, ...)
 *   - Assistant items (tool/code/conclusion): odd cardIdx (1, 3, 5, ...)
 *   - totalCards = max(cardIdx) + 1 = number of turns
 *
 * Index formulas (using agent cards only):
 *   - Agent at agentPos (0 = newest among agent cards):
 *       parserIdx = totalAgentCards - 1 - agentPos
 *   - User bubble after agent at agentPos:
 *       same parserIdx as its agent card
 */
export function useViewportTracker(
  chatContainerRef: React.RefObject<HTMLElement | null>,
  totalCards: number,
  containerReady?: boolean
) {
  const [activeBubbleIndex, setActiveBubbleIndex] = useState<number>(-1);
  const rafRef = useRef<number>(0);
  const lastCalcRef = useRef<number>(0);
  const totalCardsRef = useRef(totalCards);

  // IntersectionObserver tracks which cards are visible + their agentPos
  const visibleCardsRef = useRef<Map<Element, number>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    totalCardsRef.current = totalCards;
  }, [totalCards]);

  const calculate = useCallback(() => {
    const tc = totalCardsRef.current;
    if (tc <= 0) return;

    const container = chatContainerRef.current;
    if (!container) return;

    const now = Date.now();
    if (now - lastCalcRef.current < 100) return; // Throttle 100ms
    lastCalcRef.current = now;

    const bubbleList =
      container.querySelector(".qwenpaw-bubble-list") || container;

    // Use parser's totalCards for stable indices regardless of loaded card count.
    // Agent card at DOM position k (0 = newest, after spacer) has
    // parserIdx = tc - 1 - k.
    const visibleCards = visibleCardsRef.current;
    if (visibleCards.size === 0) {
      setActiveBubbleIndex(-1);
      return;
    }

    const containerRect = bubbleList.getBoundingClientRect();
    const containerTop = containerRect.top;
    // Use 1/3 line as the "reading position" target
    const targetLine = containerTop + containerRect.height / 3;

    let closestIdx = -1;
    let closestDist = Infinity;

    // Only measure agent cards (skip user bubbles with agentDomPos === -1)
    for (const [el, agentDomPos] of visibleCards) {
      if (agentDomPos < 0) continue; // skip user bubbles

      const rect = el.getBoundingClientRect();
      const elTop = rect.top;
      const dist = Math.abs(elTop - targetLine);

      if (dist < closestDist) {
        closestDist = dist;
        // Formula: agentDomPos=0 (newest, first after spacer) = highest parserIdx
        closestIdx = tc - 1 - agentDomPos;
      }
    }

    setActiveBubbleIndex((prev) => (closestIdx !== prev ? closestIdx : prev));
  }, [chatContainerRef]);

  // Set up IntersectionObserver + scroll listener + MutationObserver
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const bubbleList =
      container.querySelector(".qwenpaw-bubble-list") || container;

    const isAgentCard = (el: Element) =>
      el.classList.contains("qwenpaw-bubble-start");

    const isUserBubble = (el: Element) =>
      el.classList.contains("qwenpaw-bubble-end");

    // computeAgentDomPos: element's position among all bubbleList children,
    // minus 1 to skip the spacer element at position 0.
    // This gives a stable position: 0 = newest agent, increasing toward oldest.
    const computeAgentDomPos = (el: Element): number => {
      const allChildren = Array.from(bubbleList.children);
      return allChildren.indexOf(el) - 1; // -1 for spacer
    };

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target;
          if (entry.isIntersecting) {
            if (isAgentCard(el)) {
              const agentDomPos = computeAgentDomPos(el);
              if (agentDomPos >= 0) {
                visibleCardsRef.current.set(el, agentDomPos);
              }
            } else if (isUserBubble(el)) {
              // Track user bubbles with -1 so calculate() can skip them
              visibleCardsRef.current.set(el, -1);
            }
          } else {
            visibleCardsRef.current.delete(el);
          }
        }
      },
      {
        root: bubbleList,
        rootMargin: "150px 0px", // buffer zone for smoother transitions
        threshold: 0,
      }
    );

    // Observe all current card children (both agent cards and user bubbles)
    const observeCards = () => {
      const obs = observerRef.current;
      if (!obs) return;
      for (const child of bubbleList.children) {
        if (isAgentCard(child) || isUserBubble(child)) {
          obs.observe(child);
        }
      }
    };
    observeCards();

    // MutationObserver: observe new cards as they're added
    const mutObserver = new MutationObserver((mutations) => {
      const obs = observerRef.current;
      if (!obs) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (
            node instanceof Element &&
            (isAgentCard(node) || isUserBubble(node))
          ) {
            obs.observe(node);
          }
        }
        // Clean up removed cards from visible set
        for (const node of mutation.removedNodes) {
          if (node instanceof Element) {
            visibleCardsRef.current.delete(node);
          }
        }
      }
    });
    mutObserver.observe(bubbleList, { childList: true });

    // --- Scroll listener ---
    let scrollTarget: HTMLElement | null = bubbleList;
    while (
      scrollTarget &&
      scrollTarget.scrollHeight <= scrollTarget.clientHeight
    ) {
      scrollTarget = scrollTarget.parentElement;
    }
    if (!scrollTarget) scrollTarget = bubbleList;

    const handleScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(calculate);
    };

    scrollTarget.addEventListener("scroll", handleScroll, { passive: true });
    // Initial calculation (slight delay to let IntersectionObserver populate)
    setTimeout(() => handleScroll(), 50);

    return () => {
      scrollTarget!.removeEventListener("scroll", handleScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      observerRef.current?.disconnect();
      observerRef.current = null;
      mutObserver.disconnect();
      visibleCardsRef.current.clear();
    };
  }, [chatContainerRef, calculate, containerReady]);

  return activeBubbleIndex;
}

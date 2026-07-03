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
): number[] {
  const [activeBubbleIndex, setActiveBubbleIndex] = useState<number>(-1);
  // activeToolIndex: childIndex of the visible tool call (-1 = none / topic)
  const [activeToolIndex, setActiveToolIndex] = useState<number>(-1);
  const rafRef = useRef<number>(0);
  const lastCalcRef = useRef<number>(0);
  const totalCardsRef = useRef(totalCards);
  const totalCardsRef2 = useRef(totalCards);

  // IntersectionObserver tracks which cards/tool calls are visible
  const visibleCardsRef = useRef<Map<Element, number>>(new Map());
  const visibleToolCallsRef = useRef<Map<Element, { agentPos: number; childIdx: number }>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    totalCardsRef.current = totalCards;
    totalCardsRef2.current = totalCards;
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
    const containerRect = bubbleList.getBoundingClientRect();
    const containerTop = containerRect.top;
    const targetLine = containerTop + containerRect.height / 3;

    // 1. Find closest agent card (gives activeBubbleIndex, same as before)
    const visibleCards = visibleCardsRef.current;
    let closestAgentIdx = -1;
    let closestAgentDist = Infinity;

    for (const [el, agentDomPos] of visibleCards) {
      if (agentDomPos < 0) continue;
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.top - targetLine);
      if (dist < closestAgentDist) {
        closestAgentDist = dist;
        closestAgentIdx = tc - 1 - agentDomPos;
      }
    }

    setActiveBubbleIndex((prev) => (closestAgentIdx !== prev ? closestAgentIdx : prev));

    // 2. Find closest tool call within the closest agent card
    const visibleToolCalls = visibleToolCallsRef.current;
    let closestToolChildIdx = -1;
    let closestToolDist = Infinity;

    for (const [el, info] of visibleToolCalls) {
      // Only consider tool calls in the closest agent card (or its neighbors)
      const toolAgentIdx = tc - 1 - info.agentPos;
      if (Math.abs(toolAgentIdx - closestAgentIdx) > 1) continue; // skip far cards
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.top - targetLine);
      if (dist < closestToolDist) {
        closestToolDist = dist;
        closestToolChildIdx = info.childIdx;
      }
    }

    setActiveToolIndex((prev) => (closestToolChildIdx !== prev ? closestToolChildIdx : prev));
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

    const computeAgentDomPos = (el: Element): number => {
      const allChildren = Array.from(bubbleList.children);
      return allChildren.indexOf(el) - 1;
    };

    // Compute tool call's childIndex within its parent card
    const computeToolChildIdx = (toolEl: Element): { agentPos: number; childIdx: number } | null => {
      const card = toolEl.closest('.qwenpaw-bubble-start');
      if (!card) return null;
      const agentPos = computeAgentDomPos(card);
      if (agentPos < 0) return null;
      const siblings = card.querySelectorAll('[class*="toolCallCompact"]');
      let childIdx = -1;
      for (let i = 0; i < siblings.length; i++) {
        if (siblings[i] === toolEl) { childIdx = i; break; }
      }
      if (childIdx < 0) return null;
      return { agentPos, childIdx };
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
              visibleCardsRef.current.set(el, -1);
            } else if (el.classList.contains('qwenpaw-bubble')) {
              // Tool call element
              const info = computeToolChildIdx(el);
              if (info) {
                visibleToolCallsRef.current.set(el, info);
              }
            }
          } else {
            visibleCardsRef.current.delete(el);
            visibleToolCallsRef.current.delete(el);
          }
        }
      },
      { root: bubbleList, rootMargin: "150px 0px", threshold: 0 }
    );

    const observeCards = () => {
      const obs = observerRef.current;
      if (!obs) return;
      for (const child of bubbleList.children) {
        if (isAgentCard(child) || isUserBubble(child)) {
          obs.observe(child);
        }
      }
      // Also observe existing tool call elements inside agent cards
      const cards = bubbleList.querySelectorAll('.qwenpaw-bubble-start');
      cards.forEach((card) => {
        card.querySelectorAll('[class*="toolCallCompact"]').forEach((toolEl) => {
          obs.observe(toolEl);
        });
      });
    };
    observeCards();

    const mutObserver = new MutationObserver((mutations) => {
      const obs = observerRef.current;
      if (!obs) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            if (isAgentCard(node) || isUserBubble(node)) {
              obs.observe(node);
            }
            // Observe tool calls inside added nodes
            node.querySelectorAll('[class*="toolCallCompact"]').forEach((toolEl) => {
              obs.observe(toolEl);
            });
          }
        }
        for (const node of mutation.removedNodes) {
          if (node instanceof Element) {
            visibleCardsRef.current.delete(node);
            visibleToolCallsRef.current.delete(node);
          }
        }
      }
    });
    mutObserver.observe(bubbleList, { childList: true, subtree: true });

    // --- Scroll listener ---
    let scrollTarget: HTMLElement | null = bubbleList;
    while (scrollTarget && scrollTarget.scrollHeight <= scrollTarget.clientHeight) {
      scrollTarget = scrollTarget.parentElement;
    }
    if (!scrollTarget) scrollTarget = bubbleList;

    const handleScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(calculate);
    };

    scrollTarget.addEventListener("scroll", handleScroll, { passive: true });
    setTimeout(() => handleScroll(), 50);

    return () => {
      scrollTarget!.removeEventListener("scroll", handleScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      observerRef.current?.disconnect();
      observerRef.current = null;
      mutObserver.disconnect();
      visibleCardsRef.current.clear();
      visibleToolCallsRef.current.clear();
    };
  }, [chatContainerRef, calculate, containerReady]);

  return [activeBubbleIndex, activeToolIndex];
}

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  IndexGroup,
  IndexData,
  IndexItem,
  GROUP_ORDER,
  GROUP_COLORS,
  ThemeType,
} from "./types";
import { GroupSwitcher, getNextGroup } from "./GroupSwitcher";
import { StatsBubble } from "./StatsBubble";

interface BarStripProps {
  indexData: IndexData;
  activeBubbleIndex: number;
  activeToolIndex: number;
  theme: ThemeType;
  onNavigate: (bubbleIndex: number, childIndex: number, group: IndexGroup, itemId?: string) => void;
  isLoading?: boolean;
}

const SECTION_GAP = 10;
const SWITCHER_HEIGHT = 28;
const STATS_HEIGHT = 20;
const BARS_MAX_HEIGHT = 360;
const ROW_HEIGHT = 22;
const ROW_GAP = 6;
const BAR_WIDTH = 9;
const POPOVER_MIN_WIDTH = 160;
const POPOVER_MAX_WIDTH = 220;
const POPOVER_ROW_PADDING_X = 10;
// Secondary popover horizontal position is calculated dynamically from the hovered row's actual position

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

export function BarStrip({
  indexData,
  activeBubbleIndex,
  activeToolIndex,
  theme,
  onNavigate,
  isLoading = false,
}: BarStripProps) {
  const [activeGroup, setActiveGroup] = useState<IndexGroup>("topic");
  const [hovered, setHovered] = useState(false);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [sidebarOffset, setSidebarOffset] = useState(0);

  // Detect right sidebar and calculate its width
  useEffect(() => {
    const detectSidebar = () => {
      // Strategy 1: Ant Design Drawer (placement="right")
      const drawerWrappers = document.querySelectorAll(".ant-drawer-content-wrapper");
      for (const wrapper of drawerWrappers) {
        const htmlEl = wrapper as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        if (style.right === "0px" && htmlEl.offsetWidth > 100) {
          setSidebarOffset(htmlEl.offsetWidth + 8);
          return;
        }
      }

      // Strategy 2: Embedded panel mode (QwenPaw desktop uses this)
      const embeddedPanels = document.querySelectorAll("[class*='embeddedPanel']");
      for (const panel of embeddedPanels) {
        const htmlEl = panel as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();
        if (rect.left > window.innerWidth * 0.5 && rect.width > 100) {
          setSidebarOffset(window.innerWidth - rect.left + 8);
          return;
        }
      }

      setSidebarOffset(0);
    };

    detectSidebar();

    const observer = new MutationObserver(() => detectSidebar());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });

    const onResize = () => detectSidebar();
    window.addEventListener("resize", onResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const currentItems = indexData[activeGroup] || [];

  // Find the "active" item: for topic groups, the one with the largest
  // bubbleIndex ≤ activeBubbleIndex. For tool groups, also match childIndex
  // against activeToolIndex for precise tool call tracking.
  const activeItemId = useMemo(() => {
    if (activeBubbleIndex < 0 || currentItems.length === 0) return null;
    let best: IndexItem | null = null;

    for (const item of currentItems) {
      // For tool group, require exact bubbleIndex AND childIndex match
      if (activeGroup === 'tool' && activeToolIndex >= 0) {
        if (item.bubbleIndex === activeBubbleIndex && item.childIndex === activeToolIndex) {
          best = item;
          break; // exact match found
        }
      } else {
        // Default: largest bubbleIndex ≤ activeBubbleIndex
        if (item.bubbleIndex <= activeBubbleIndex) {
          if (!best || item.bubbleIndex > best.bubbleIndex) {
            best = item;
          }
        }
      }
    }
    return best?.id ?? null;
  }, [activeBubbleIndex, activeToolIndex, currentItems, activeGroup]);

  // Auto-scroll the bar strip to show the active item
  useEffect(() => {
    if (!activeItemId || !scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const activeRow = container.querySelector(`[data-item-id="${activeItemId}"]`) as HTMLElement | null;
    if (!activeRow) return;
    const containerRect = container.getBoundingClientRect();
    const rowRect = activeRow.getBoundingClientRect();
    // Only scroll if the active row is outside the visible area
    if (rowRect.top < containerRect.top || rowRect.bottom > containerRect.bottom) {
      activeRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeItemId]);

  const availableGroups = GROUP_ORDER.filter(
    (g) => indexData[g] && indexData[g].length > 0
  );

  useEffect(() => {
    if (
      availableGroups.length > 0 &&
      (!indexData[activeGroup] || indexData[activeGroup].length === 0)
    ) {
      setActiveGroup(availableGroups[0]);
    }
  }, [activeGroup, availableGroups, indexData]);

  const handleCycleGroup = () => {
    if (availableGroups.length === 0) return;
    const next = getNextGroup(activeGroup, availableGroups);
    setActiveGroup(next);
  };

  const cancelHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    hideTimerRef.current = setTimeout(() => {
      setHovered(false);
      setHoveredItemId(null);
    }, 600);
  }, []);

  const handleMouseEnter = () => {
    cancelHide();
    setHovered(true);
  };

  const handleMouseLeave = () => {
    scheduleHide();
  };

  const groupColors = GROUP_COLORS[activeGroup];
  const color = theme === "dark" ? groupColors.dark : groupColors.light;
  const textColor = theme === "dark" ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.8)";
  const mutedColor = theme === "dark" ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)";
  const highlightBg = theme === "dark"
    ? `rgba(${hexToRgb(color)},0.15)`
    : `rgba(${hexToRgb(color)},0.10)`;

  const secondaryItem = hoveredItemId
    ? currentItems.find((it) => it.id === hoveredItemId) || null
    : null;

  const getSecondaryPosition = useCallback(() => {
    if (!hoveredItemId || !scrollContainerRef.current) return { top: 0, right: 0 };
    const container = scrollContainerRef.current;
    const rowEl = container.querySelector(`[data-item-id="${hoveredItemId}"]`) as HTMLElement | null;
    if (!rowEl) return { top: 0, right: 0 };
    const rowRect = rowEl.getBoundingClientRect();
    // Find the primary popover row div
    const popoverEl = rowEl.querySelector("[data-popover-row]") as HTMLElement | null;
    if (popoverEl) {
      const popRect = popoverEl.getBoundingClientRect();
      // Right edge of secondary popover = just left of primary popover's left edge
      return { top: rowRect.top, right: window.innerWidth - popRect.left + 6 };
    }
    // Fallback: position to the left of the entire row
    return { top: rowRect.top, right: window.innerWidth - rowRect.left + 6 };
  }, [hoveredItemId]);

  const [secondaryTop, setSecondaryTop] = useState(0);
  const [secondaryRight, setSecondaryRight] = useState(0);
  useEffect(() => {
    if (!hoveredItemId) return;
    const pos = getSecondaryPosition();
    setSecondaryTop(pos.top);
    setSecondaryRight(pos.right);
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const p = getSecondaryPosition();
      setSecondaryTop(p.top);
      setSecondaryRight(p.right);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [hoveredItemId, getSecondaryPosition]);

  return (
    <div
      className="dip-bar-strip"
      style={{
        position: "fixed",
        right: sidebarOffset + 8,
        top: "50%",
        transform: "translateY(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: SECTION_GAP,
        zIndex: 9999,
        padding: "8px 4px",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div style={{ height: SWITCHER_HEIGHT, display: "flex", alignItems: "center" }}>
        {isLoading ? (
          <div
            style={{
              fontSize: 11,
              color: theme === "dark" ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)",
              textAlign: "right",
              width: 40,
              lineHeight: 1.2,
              userSelect: "none",
            }}
          >
            对话
            <br />
            加载中…
          </div>
        ) : (
          <GroupSwitcher
            group={activeGroup}
            theme={theme}
            onCycle={handleCycleGroup}
          />
        )}
      </div>

      <div
        ref={scrollContainerRef}
        className="dip-bars-scroll"
        style={{
          maxHeight: BARS_MAX_HEIGHT,
          overflowY: "auto",
          overflowX: "visible",
        }}
      >
        {currentItems.length === 0 && (
          <div
            style={{
              fontSize: 10,
              color: theme === "dark" ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.25)",
              writingMode: "vertical-rl",
              padding: "4px 0",
            }}
          >
            无索引
          </div>
        )}
        {currentItems.map((item) => {
          const isActive = item.id === activeItemId;
          const isHovered = hoveredItemId === item.id;
          const isHighlighted = isActive;

          const barHeight = hovered ? ROW_HEIGHT : (isHighlighted ? 5 : 3);
          let barOpacity: number;
          if (isHighlighted) {
            barOpacity = hovered ? 0.6 : 0.7;
          } else if (isHovered) {
            barOpacity = 0.5;
          } else {
            barOpacity = hovered ? 0.2 : 0.3;
          }

          const shortTitle =
            item.title.length > 15
              ? item.title.slice(0, 15) + "..."
              : item.title;

          return (
            <div
              key={item.id}
              data-item-id={item.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: ROW_HEIGHT,
                marginBottom: ROW_GAP,
              }}
            >
              <div
                data-popover-row=""
                style={{
                  width: POPOVER_MIN_WIDTH,
                  maxWidth: POPOVER_MAX_WIDTH,
                  height: ROW_HEIGHT,
                  padding: `0 ${POPOVER_ROW_PADDING_X}px`,
                  cursor: "pointer",
                  backgroundColor: isHovered || isActive ? highlightBg : "transparent",
                  display: hovered ? "flex" : "none",
                  alignItems: "center",
                  gap: 6,
                  transition: "background-color 0.4s ease",
                  boxSizing: "border-box",
                  borderRadius: 4,
                }}
                onMouseEnter={() => setHoveredItemId(item.id)}
                onMouseLeave={() => setHoveredItemId(null)}
                onClick={() => {
                  onNavigate(item.bubbleIndex, item.childIndex, item.group, item.id);
                  setHovered(false);
                  setHoveredItemId(null);
                }}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: isActive ? 600 : 400,
                    fontSize: 12,
                    color: textColor,
                  }}
                >
                  {shortTitle}
                </span>
                {item.status === "fail" && (
                  <span style={{ color: "#ef4444", fontSize: 11 }}>!</span>
                )}
              </div>

              <div
                className="dip-bar"
                style={{
                  width: BAR_WIDTH,
                  height: barHeight,
                  borderRadius: 2,
                  backgroundColor: color,
                  opacity: barOpacity,
                  cursor: "pointer",
                  transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                  flexShrink: 0,
                  alignSelf: "flex-end",
                }}
                onClick={() => {
                  onNavigate(item.bubbleIndex, item.childIndex, item.group, item.id);
                  setHovered(false);
                  setHoveredItemId(null);
                }}
                title={item.title}
              />
            </div>
          );
        })}
      </div>

      <div style={{ height: STATS_HEIGHT, display: "flex", alignItems: "center", position: "relative" }}>
        <StatsBubble stats={indexData.stats} theme={theme} color={color} />
      </div>

      {secondaryItem && hovered && createPortal(
      <div
        style={{
          position: "fixed",
          right: secondaryRight,
          top: secondaryTop,
          background: theme === "dark" ? "rgba(40,40,40,0.96)" : "rgba(255,255,255,0.98)",
          color: textColor,
          borderRadius: 6,
          padding: "8px 12px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
          whiteSpace: "pre-wrap",
          maxWidth: 320,
          zIndex: 10002,
          pointerEvents: "none",
          lineHeight: 1.5,
        }}
        >
          <div style={{ fontSize: 13, fontWeight: 500 }}>
            {secondaryItem.title}
          </div>
          <div style={{ fontSize: 11, color: mutedColor, marginTop: 2 }}>
            气泡 #{secondaryItem.bubbleIndex + 1}
            {secondaryItem.lang && ` · ${secondaryItem.lang}`}
            {secondaryItem.status && ` · ${secondaryItem.status === "fail" ? "失败" : "成功"}`}
          </div>
          {secondaryItem.group === "tool" && (function() {
            try {
              var tc = indexData.stats.totalCards;
              var idx = tc - secondaryItem.bubbleIndex;
              var bl = document.querySelector(".qwenpaw-bubble-list");
              if (!bl) return null;
              var card = bl.children[idx];
              if (!card) return null;
              var els = card.querySelectorAll('[class*="toolCallLabel"]');
              var lab = els[secondaryItem.childIndex];
              var txt = lab ? lab.textContent.trim() : null;
              if (!txt) return null;
              return React.createElement("div", { style: { fontSize: 11, color: mutedColor, marginTop: 3, whiteSpace: "pre-wrap", wordBreak: "break-word" } }, txt);
            } catch(e) { return null; }
          })()}
        </div>,
        document.body
      )}
    </div>
  );
}

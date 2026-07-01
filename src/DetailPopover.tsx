import { useState } from "react";
import {
  IndexItem,
  IndexGroup,
  GROUP_LABELS,
  GROUP_COLORS,
  ThemeType,
} from "./types";

interface DetailPopoverProps {
  items: IndexItem[];
  group: IndexGroup;
  activeBubbleIndex: number;
  theme: ThemeType;
  hoveredItemId: string | null;
  onItemHover: (id: string | null) => void;
  onItemClick: (bubbleIndex: number) => void;
  onClose: () => void;
}

// Must match Bar's EXPANDED_ROW_HEIGHT and BarStrip's BARS_MAX_HEIGHT
const ROW_HEIGHT = 22;
const MAX_HEIGHT = 360;
// Bars container starts at: 8px padding + 28px switcher + 10px gap = 46px
const POPOVER_TOP = 46;

export function DetailPopover({
  items,
  group,
  activeBubbleIndex,
  theme,
  hoveredItemId,
  onItemHover,
  onItemClick,
  onClose,
}: DetailPopoverProps) {
  const colors = GROUP_COLORS[group];
  const color = theme === "dark" ? colors.dark : colors.light;

  const bgColor = theme === "dark"
    ? "rgba(30,30,30,0.94)"
    : "rgba(255,255,255,0.96)";
  const textColor = theme === "dark"
    ? "rgba(255,255,255,0.85)"
    : "rgba(0,0,0,0.8)";
  const mutedColor = theme === "dark"
    ? "rgba(255,255,255,0.5)"
    : "rgba(0,0,0,0.45)";
  const highlightBg = theme === "dark"
    ? `rgba(${hexToRgb(color)},0.15)`
    : `rgba(${hexToRgb(color)},0.10)`;

  return (
    <div
      className="dip-detail-popover"
      style={{
        position: "absolute",
        right: 14,
        top: POPOVER_TOP, // aligned with bars container top
        background: bgColor,
        color: textColor,
        borderRadius: 8,
        padding: 0, // no extra padding — items start at edge
        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
        minWidth: 160,
        maxWidth: 220,
        maxHeight: MAX_HEIGHT, // same as bars container
        zIndex: 10000,
        fontSize: 13,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Items list — no header, no blank space */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {items.length === 0 && (
          <div style={{ padding: "8px 12px", color: mutedColor, fontSize: 12 }}>
            暂无条目
          </div>
        )}
        {items.map((item) => {
          const isActive = item.bubbleIndex === activeBubbleIndex;
          const isHovered = hoveredItemId === item.id;
          const shortTitle =
            item.title.length > 15
              ? item.title.slice(0, 15) + "..."
              : item.title;

          return (
            <div key={item.id} style={{ position: "relative" }}>
              <div
                style={{
                  height: ROW_HEIGHT, // matches expanded bar height
                  padding: "0 10px",
                  cursor: "pointer",
                  backgroundColor: isHovered
                    ? highlightBg
                    : isActive
                    ? highlightBg
                    : "transparent",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "background-color 0.4s ease",
                  boxSizing: "border-box",
                }}
                onMouseEnter={() => onItemHover(item.id)}
                onMouseLeave={() => onItemHover(null)}
                onClick={() => onItemClick(item.bubbleIndex)}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: isActive ? 600 : 400,
                    fontSize: 12,
                  }}
                >
                  {shortTitle}
                </span>
                {item.status === "fail" && (
                  <span style={{ color: "#ef4444", fontSize: 11 }}></span>
                )}
              </div>

              {/* Secondary popover on item hover */}
              {isHovered && (
                <div
                  style={{
                    position: "absolute",
                    right: "100%",
                    top: 0,
                    marginRight: 6,
                    background: theme === "dark"
                      ? "rgba(40,40,40,0.96)"
                      : "rgba(255,255,255,0.98)",
                    color: textColor,
                    borderRadius: 6,
                    padding: "6px 10px",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
                    whiteSpace: "nowrap",
                    zIndex: 10001,
                    pointerEvents: "auto",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {item.title}
                  </div>
                  <div style={{ fontSize: 11, color: mutedColor, marginTop: 2 }}>
                    第 {item.bubbleIndex + 1} 条消息
                    {item.lang && ` · ${item.lang}`}
                    {item.status && ` · ${item.status === "fail" ? "失败" : "成功"}`}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

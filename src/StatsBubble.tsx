import { useState } from "react";
import { IndexStats, ThemeType } from "./types";

interface StatsBubbleProps {
  stats: IndexStats;
  theme: ThemeType;
  color: string; // bar color for border
}

export function StatsBubble({ stats, theme, color }: StatsBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const textColor = theme === "dark"
    ? "rgba(255,255,255,0.85)"
    : "rgba(0,0,0,0.8)";
  const popBg = theme === "dark"
    ? "rgba(30,30,30,0.94)"
    : "rgba(255,255,255,0.96)";

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
      }}
    >
      {/* Stats popover - appears to the left */}
      {hovered && (
        <div
          style={{
            position: "absolute",
            right: 16,
            bottom: -2,
            background: popBg,
            color: textColor,
            fontSize: 11,
            padding: "4px 8px",
            borderRadius: 6,
            whiteSpace: "nowrap",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            pointerEvents: "none",
            zIndex: 10001,
          }}
        >
          {stats.totalMessages} 条消息 · {stats.topicCount} 话题 · {stats.toolCount} 工具 · {stats.codeCount} 代码 · {stats.conclusionCount} 结论
        </div>
      )}
      {/* Hollow dot — centered with bars midpoint.
          Bars: 9px wide, right-aligned in container with 4px right padding.
          Bar center = 8 + 4 - 4.5 = 7.5px from viewport right.
          8px bubble center at 7.5px → right edge at 11.5px from viewport right.
          Container at right:8 → bubble right = 11.5 - 8 = 3.5px within container.
      */}
      <div
        style={{
          position: "absolute",
          right: 3.5,
          top: "50%",
          transform: "translateY(-50%)",
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            border: `1.5px solid ${color}`,
            backgroundColor: "transparent",
            cursor: "default",
            flexShrink: 0,
            transition: "opacity 0.3s ease",
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        />
      </div>
    </div>
  );
}

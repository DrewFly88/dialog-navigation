import { useState } from "react";
import { IndexGroup, GROUP_LABELS, GROUP_ORDER, GROUP_COLORS, ThemeType } from "./types";

interface GroupSwitcherProps {
  group: IndexGroup;
  theme: ThemeType;
  onCycle: () => void;
}

export function GroupSwitcher({ group, theme, onCycle }: GroupSwitcherProps) {
  const [hovered, setHovered] = useState(false);
  const colors = GROUP_COLORS[group];
  const color = theme === "dark" ? colors.dark : colors.light;
  const label = GROUP_LABELS[group];

  return (
    <div
      className="dip-switcher"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        width: 40, // fixed clickable width
        height: 28,
        cursor: "pointer",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onCycle}
    >
      {/* Base bar — ALWAYS rendered, fades out on hover */}
      <div
        style={{
          width: 16,
          height: 4,
          borderRadius: 2,
          backgroundColor: color,
          opacity: hovered ? 0 : 0.7,
          transition: "opacity 0.3s ease",
          flexShrink: 0,
        }}
      />
      {/* Rounded rectangle — fades in on hover, overlays the bar */}
      <div
        style={{
          position: "absolute",
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          backgroundColor: color,
          color: "#ffffff",
          fontSize: 12,
          fontWeight: 500,
          padding: "5px 12px",
          borderRadius: 5,
          whiteSpace: "nowrap",
          lineHeight: 1.2,
          opacity: hovered ? 1 : 0,
          transition: "opacity 0.3s ease",
          pointerEvents: "none",
          zIndex: 1,
        }}
      >
        {label}
      </div>
    </div>
  );
}

export function getNextGroup(current: IndexGroup, availableGroups: IndexGroup[]): IndexGroup {
  const order = GROUP_ORDER.filter((g) => availableGroups.includes(g));
  if (order.length === 0) return "topic";
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length];
}

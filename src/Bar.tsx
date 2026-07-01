import { IndexItem, IndexGroup, GROUP_COLORS, ThemeType } from "./types";

interface BarProps {
  item: IndexItem;
  highlighted: boolean; // viewport-based highlight
  hovered: boolean; // detail popover item hover
  expanded: boolean; // strip is hovered, bars expand to title-row height
  theme: ThemeType;
  onClick: () => void;
}

const EXPANDED_ROW_HEIGHT = 22;

export function Bar({ item, highlighted, hovered, expanded, theme, onClick }: BarProps) {
  const colors = GROUP_COLORS[item.group];
  const color = theme === "dark" ? colors.dark : colors.light;

  // Height: compact 3px → expanded 22px (smooth cubic-bezier transition)
  const height = expanded ? EXPANDED_ROW_HEIGHT : (highlighted ? 5 : 3);

  // Opacity: more transparent overall, subtle when expanded
  let opacity: number;
  if (highlighted) {
    opacity = expanded ? 0.6 : 0.7;
  } else if (hovered) {
    opacity = 0.5;
  } else {
    opacity = expanded ? 0.2 : 0.3;
  }

  return (
    <div
      className="dip-bar"
      style={{
        width: 9,
        height,
        borderRadius: 2,
        backgroundColor: color,
        opacity,
        cursor: "pointer",
        transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        flexShrink: 0,
        alignSelf: "flex-end",
      }}
      onClick={onClick}
      title={item.title}
    />
  );
}

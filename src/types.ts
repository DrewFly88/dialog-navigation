// ============================================================
// dialog-index-plugin - Type Definitions
// ============================================================

export type IndexGroup = 'topic' | 'tool' | 'code' | 'conclusion';

export const GROUP_LABELS: Record<IndexGroup, string> = {
  topic: '话题',
  tool: '工具',
  code: '代码',
  conclusion: '结论',
};

export const GROUP_ORDER: IndexGroup[] = ['topic', 'tool', 'code', 'conclusion'];

export const GROUP_COLORS: Record<IndexGroup, { light: string; dark: string }> = {
  topic: { light: '#2563eb', dark: '#60a5fa' },
  tool: { light: '#16a34a', dark: '#4ade80' },
  code: { light: '#ea580c', dark: '#fb923c' },
  conclusion: { light: '#9333ea', dark: '#c084fc' },
};

export interface IndexItem {
  id: string;
  group: IndexGroup;
  title: string;
  /** Sequential DOM bubble index (consecutive assistant msgs share one bubble) */
  bubbleIndex: number;
  /** Position of this item among same-type items within the same card (0 = first) */
  childIndex: number;
  timestamp: string;
  status?: 'success' | 'fail';
  lang?: string;
  fileName?: string;
}

export interface IndexData {
  topic: IndexItem[];
  tool: IndexItem[];
  code: IndexItem[];
  conclusion: IndexItem[];
  stats: IndexStats;
}

export interface IndexStats {
  totalMessages: number;
  totalCards: number;
  topicCount: number;
  toolCount: number;
  codeCount: number;
  conclusionCount: number;
}

export interface PluginSettings {
  enabledGroups: Record<IndexGroup, boolean>;
  barWidth: number;
  barHeight: number;
  barGap: number;
  popoverCloseDelayMs: number;
  highlightDurationMs: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  enabledGroups: { topic: true, tool: true, code: true, conclusion: true },
  barWidth: 18,
  barHeight: 3,
  barGap: 8,
  popoverCloseDelayMs: 300,
  highlightDurationMs: 2000,
};

export interface QPMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string | QPContentBlock[];
}

export interface QPContentBlock {
  type: 'text' | 'tool_use' | 'tool_call' | 'tool_result' | 'data' | 'file' | 'image';
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
}

export type ThemeType = 'light' | 'dark';

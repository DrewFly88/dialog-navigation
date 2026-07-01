import { useState, useCallback } from "react";
import { IndexGroup, GROUP_LABELS, GROUP_ORDER, PluginSettings, DEFAULT_SETTINGS } from "./types";

const LOG = "[dialog-index]";

function loadSettings(): PluginSettings {
  try {
    const raw = localStorage.getItem("dialog-index-settings");
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s: PluginSettings) {
  try {
    localStorage.setItem("dialog-index-settings", JSON.stringify(s));
  } catch (e) {
    console.warn(LOG, "Failed to save settings:", e);
  }
}

export function SettingsPage() {
  const [settings, setSettings] = useState<PluginSettings>(loadSettings);

  const toggleGroup = useCallback((group: IndexGroup) => {
    setSettings((prev) => {
      const next = {
        ...prev,
        enabledGroups: {
          ...prev.enabledGroups,
          [group]: !prev.enabledGroups[group],
        },
      };
      saveSettings(next);
      return next;
    });
  }, []);

  const host = (window as any).QwenPaw?.host;
  const antd = host?.antd ?? {};
  const { Card, Switch, Typography, Space } = antd;
  const { Text } = Typography ?? {};

  // Fallback if antd components are not available
  if (!Card) {
    return (
      <div style={{ padding: 24, maxWidth: 600 }}>
        <h2 style={{ marginBottom: 16 }}>Dialog Index 设置</h2>
        <p style={{ color: "#888" }}>antd 组件不可用，请检查 QwenPaw host 环境。</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 600 }}>
      <Card title="Dialog Index 设置" size="small">
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ display: "block", marginBottom: 8 }}>
            显示分组
          </Text>
          <Space direction="vertical" size={4}>
            {GROUP_ORDER.map((g) => (
              <div
                key={g}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: 200,
                }}
              >
                <Text>{GROUP_LABELS[g]}</Text>
                <Switch
                  size="small"
                  checked={settings.enabledGroups[g]}
                  onChange={() => toggleGroup(g)}
                />
              </div>
            ))}
          </Space>
        </div>
      </Card>
    </div>
  );
}

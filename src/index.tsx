import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { ThemeType } from "./types";
import { useDialogIndex } from "./hooks/useDialogIndex";
import { useMessageMap } from "./hooks/useMessageMap";
import { useViewportTracker } from "./hooks/useViewportTracker";
import { BarStrip } from "./BarStrip";
import { SettingsPage } from "./SettingsPage";
import "./styles.css";

const LOG = "[dialog-index]";
const BUILD = "v0.7.2-20260630";

try {
  const host = window.QwenPaw?.host;
  const route = window.QwenPaw?.route;
  const pluginId = "dialog-navigation";

  if (!host) {
    console.error(LOG, "host not available");
  } else {
    // Main wrapper component
    const DialogIndexWrapper = (Inner: React.ComponentType) => {
      return () => {
        const theme = (host.useTheme?.() ?? "dark") as ThemeType;
        const session = host.useCurrentSession?.();
        const sessionId = session?.id ?? null;
        const agent = host.useSelectedAgent?.();
        const agentId = agent?.id ?? null;
        const imperativeId = host.getCurrentSessionId?.() ?? null;
        const chatContainerRef = useRef<HTMLDivElement | null>(null);
        // State flag: triggers re-render after container is found,
        // so hooks (useMessageMap, useViewportTracker) see the updated ref.
        const [containerReady, setContainerReady] = useState(false);
        const hasLogged = useRef(false);

        // Diagnostic log — confirm wrapper renders
        if (!hasLogged.current) {
          hasLogged.current = true;
          console.log(LOG, "Wrapper RENDERED", {
            theme,
            hookSessionId: sessionId,
            agentId,
            imperativeSessionId: imperativeId,
            hasHostFetch: typeof host.fetch === "function",
          });
        }

        const { indexData, loading, refresh } = useDialogIndex(sessionId, agentId);
        const totalCards = indexData.stats.totalCards;
        const totalCardsRef = useRef(totalCards);
        totalCardsRef.current = totalCards; // Keep ref in sync during render

        // Debounced refresh for DOM-triggered updates (avoids rapid API calls during streaming)
        const debouncedRefresh = useMemo(() => {
          let timer: ReturnType<typeof setTimeout>;
          return () => {
            clearTimeout(timer);
            timer = setTimeout(refresh, 300);
          };
        }, [refresh]);

        const { cardCount: _cc, loadCardsToPosition } = useMessageMap(chatContainerRef, debouncedRefresh, containerReady);
        const [activeBubbleIndex, activeToolIndex] = useViewportTracker(chatContainerRef, totalCards, containerReady);

        // Navigation loading state — shows "对话加载中…" in BarStrip
        const [isNavigating, setIsNavigating] = useState(false);

        // Refresh index when page becomes visible again
        useEffect(() => {
          const onVisibilityChange = () => {
            if (document.visibilityState === "visible") {
              console.log(LOG, "page visible, refreshing index");
              refresh();
            }
          };
          document.addEventListener("visibilitychange", onVisibilityChange);
          return () => document.removeEventListener("visibilitychange", onVisibilityChange);
        }, [refresh]);

        // Find the chat scroll container after mount and when session changes
        useEffect(() => {
          // Reset container ready state when session changes
          setContainerReady(false);
          const timer = setTimeout(() => {
            // The actual scrollable container is .qwenpaw-bubble-list (overflow-y: auto).
            // Always prefer it — don't check scrollHeight because content-visibility: auto
            // may reduce it before all cards are loaded.
            const directList = document.querySelector('.qwenpaw-bubble-list');
            let found: HTMLElement | null = null;
            if (directList instanceof HTMLElement) {
              found = directList;
            }
            // Fallback: check other scrollable containers
            if (!found) {
              const preferred = [
                "[class*='chatMessagesArea']",
                "[class*='bubble-list-wrapper']",
              ];
              for (const sel of preferred) {
                const el = document.querySelector(sel);
                if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 10) {
                  found = el;
                  break;
                }
              }
            }
            // Fallback: any scrollable chat-related container
            if (!found) {
              const candidates = document.querySelectorAll(
                "[class*='chat'], [class*='Chat'], [class*='scroll']"
              );
              console.log(LOG, "container fallback search:", candidates.length, "candidates");
              for (const el of candidates) {
                if (
                  el instanceof HTMLElement &&
                  el.scrollHeight > el.clientHeight + 10
                ) {
                  found = el;
                  break;
                }
              }
            }
            if (found) {
              chatContainerRef.current = found;
              console.log(LOG, "container found:", found.className?.slice(0, 60));
              setContainerReady(true); // trigger re-render so hooks see the ref
            } else {
              console.log(LOG, "no scrollable container found");
            }
          }, 2000);
          return () => clearTimeout(timer);
        }, [imperativeId]);

        // Scroll to message by parser bubbleIndex.
        // DOM layout (column-reverse, newest first):
        //   [0] spacer  [1] newest-agent  [2] newest-user
        //   [3] newer-agent  [4] newer-user  ...  [N-2] oldest-agent  [N-1] oldest-user
        //
        // Each turn = 2 DOM elements (agent card + user bubble), pairs after [0] spacer.
        // cardIdx N (1-based, newest=1) maps to DOM idx:
        //   - agent card (odd cardIdx): idx = 1 + (cardIdx - 1) * 2       (1, 3, 5, ...)
        //   - user bubble (even cardIdx): idx = 1 + (cardIdx - 1) * 2     (2, 4, 6, ...)
        // Wait — cardIdx here is parser bubbleIndex which already encodes the turn:
        //   bubbleIndex 1 (newest agent) → idx 1,  bubbleIndex 2 (newest user) → idx 2
        //   bubbleIndex 3 → idx 3,  ...  bubbleIndex N → idx N
        // So childrenIndex = bubbleIndex (1-based, matches DOM idx directly after spacer).
        //
        // If target not in DOM: scroll loadMore into view to trigger SDK's
        // native IntersectionObserver (only reliable loading mechanism).
        // Show "对话加载中…" via isNavigating during loading, then one final
        // scroll to target. Fiber dispatch doesn't work because session
        // re-fetch (triggered by 500ms polling) resets the dispatched state.
        const navigateToMessage = useCallback(
          async (parserIdx: number, childIndex?: number, group?: string, itemId?: string) => {
            const container = chatContainerRef.current;
            if (!container) return;

            const tc = totalCardsRef.current;
            if (tc <= 0) return;

            const bubbleList =
              container.querySelector(".qwenpaw-bubble-list") || container;

            // §30: 跳转公式与视口追踪器（useViewportTracker）同源。
            // 视口追踪器实测正确: agentDomPos = indexOf(el) - 1
            //   → bubbleIndex = tc - 1 - agentDomPos = tc - 1 - (idx - 1) = tc - idx
            //   → idx = tc - bubbleIndex
            // 实测: bi=77(newest) → idx 1 ✅, bi=73 → idx 5 ✅, bi=5 → idx 73 ✅
            // §29 误改成 sdkCardCount-1-parserIdx + agentDomPos*2 完全错误,本轮回退。
            const isTopic = group === "topic";
            const childrenIndex = tc - parserIdx;

            const getTarget = (): HTMLElement | null => {
              const cl = bubbleList.children;
              return childrenIndex >= 1 && childrenIndex < cl.length
                ? (cl[childrenIndex] as HTMLElement)
                : null;
            };

            let target = getTarget();

            if (!target) {
              setIsNavigating(true);
              try {
                // §32.5c: scroll loop + MutationObserver 实时回调(方案 C)。
                // fiber dispatch 在本环境失效(DEVLOG §15/§18 定论),scroll loop 是唯一可用通道。
                // observer 盂 bubbleList childList 变化——SDK 渲染新卡时立即回调检查 target,
                // 不等每轮 100ms poll 超时,命中即停。每轮等缩到 100ms(poll 兜底)。
                let settled = false;
                const finishLoad = () => {
                  if (settled) return;
                  settled = true;
                  ob.disconnect();
                };
                const ob = new MutationObserver(() => {
                  const t = getTarget();
                  if (t) { target = t; finishLoad(); }
                });
                ob.observe(bubbleList, { childList: true, subtree: false });
                let prevCount = Array.from(bubbleList.children).filter(
                  (el) => el.classList.contains("qwenpaw-bubble-start") ||
                          el.classList.contains("qwenpaw-bubble-end")
                ).length;
                let stallCount = 0;
                for (let attempt = 0; attempt < 30 && !settled; attempt++) {
                  const loadMore = bubbleList.querySelector(
                    ".qwenpaw-bubble-list-load-more"
                  ) as HTMLElement | null;
                  if (!loadMore) break;
                  loadMore.scrollIntoView({ block: "start" });
                  // §32.5d: 每轮等 200ms——SDK re-fetch 间隙卡数短暂不变,100ms 太短跨不过
                  // 间隙误判 stall,200ms 给 re-fetch 完成窗口(re-fetch 实测 ~150-300ms)
                  await new Promise((r) => setTimeout(r, 200));
                  if (settled) {
                    console.log(LOG, `target found after ${attempt+1} scroll loads (observer)`);
                    break;
                  }
                  target = getTarget();
                  if (target) {
                    console.log(LOG, `target found after ${attempt+1} scroll loads (poll)`);
                    finishLoad();
                    break;
                  }
                  const newCount = Array.from(bubbleList.children).filter(
                    (el) => el.classList.contains("qwenpaw-bubble-start") ||
                            el.classList.contains("qwenpaw-bubble-end")
                  ).length;
                  if (newCount === prevCount) {
                    stallCount++;
                    // §32.5d: stall 5 → 8——SDK re-fetch 间隙卡数短暂不变,连续多次误判
                    // 放弃太早(reload 后冷启动间隙更频繁)。8 次给 re-fetch 完成足够窗口
                    if (stallCount >= 8) {
                      console.warn(LOG, `scroll loop stalled 8x, giving up at attempt ${attempt+1}`);
                      break;
                    }
                  } else {
                    stallCount = 0;
                  }
                  prevCount = newCount;
                }
                ob.disconnect();
              } finally {
                setIsNavigating(false);
              }
            }

            // §32.5: scroll loop 触发 SDK 加载时会引起 re-fetch(console 实测 msgid=61
            // Fetched 879 在 scroll loop 之后),re-render 替换 precisionTarget 指向的
            // DOM 节点 → 后续 scrollIntoView/addClass 在已脱离 DOM 树的旧节点上操作,
            // 滚到整个气泡而非结论元素。等 1500ms 让 re-fetch 完成后 DOM 稳定再精准段。
            // §32.5c+2: 远距离目标(如气泡 60)卡片骨架插入后内部内容(<strong>/<li> 候选)
            // 是异步渲染的——立即精准段 querySelectorAll 抓不全候选导致命中失败。
            // 1500ms 之后再加 rAF ×2 让 content-visibility 布局完成,候选元素全部就绪。
            if (target) {
              await new Promise((r) => setTimeout(r, 1500));
              await new Promise((r) => requestAnimationFrame(r));
              await new Promise((r) => requestAnimationFrame(r));
              // Detect header overlayer height for scroll offset.
              // Without this, scrollIntoView's "start" aligns with viewport
              // top, hiding the target behind the fixed header.
              const headerEl = document.querySelector(
                ".qwenpaw-chat-anywhere-layout-right-header"
              );
              let headerHeight = 60; // safe default
              if (headerEl instanceof HTMLElement) {
                const rect = headerEl.getBoundingClientRect();
                headerHeight = rect.height + 8;
              }

              // For topic (even parserIdx): children[tc-parserIdx] IS the user
              // bubble — scroll to it directly.
              // For assistant items (tool/code/conclusion, odd parserIdx):
              // children[tc-parserIdx] is the agent card. Use childIndex
              // to find the precise DOM element within the card.
              let precisionTarget: HTMLElement | null = target;

              if (!isTopic && childIndex !== undefined && group && target) {
                let selector = '';
                if (group === 'tool') {
                  selector = '[class*="toolCallLabel"]';
                } else if (group === 'code') {
                  selector = 'pre code, [class*="toolCallCompact"] code';
                } else if (group === 'conclusion') {
                  selector = 'strong, li';
                }
                if (selector) {
                  const candidates = target.querySelectorAll<HTMLElement>(selector);
                  // For tools, deduplicate labels to match parser's call_id dedup
                  if (group === 'tool') {
                    const seen = new Set<string>();
                    let matchIdx = 0;
                    for (const el of candidates) {
                      const txt = (el.textContent || '').trim();
                      if (txt && !seen.has(txt)) {
                        seen.add(txt);
                        if (matchIdx === childIndex) {
                          precisionTarget = el.closest('[class*="toolCallCompact"]') as HTMLElement || el;
                          console.log(LOG, `precision: tool[${childIndex}] matched by unique label`);
                          break;
                        }
                        matchIdx++;
                      }
                    }
                  } else if (group === 'conclusion') {
                    // §32: DOM 端候选序号必须与 parser extractStructured 同源。
                    // parser 按 BOLD_RE(**x**)→NUMBERED_RE(1. x)→LIST_ITEM_RE(- x)
                    // 三优先级分抓 findings,childIdx 跨级累加(bold 第 0,第 1...再 numbered,再 list)。
                    // 但 DOM selectorAll('strong, li') 按 SDK 渲染顺序命,含非加粗的
                    // 「工作目录问题」等普通 li 序号在前——气 #6 parser childIdx=0
                    // 是 bold 第 0 条,DOM 命序号 2 → 精准定位错位滚到「关键原则」。
                    // 修复:DOM 端按 parser 同款三优先级分抓候选——
                    //   1. strong/bold 加粗命中(boldResults)
                    //   2. li 数字开头有序项(numberedResults)
                    //   3. 普通 li(listResults)
                    // 每级内用 C2 白名单筛,序号跨级累加与 parser childIdx 对齐。
                    // §31: 跳过 agent 引用 user 原话的 li(含"授权我"、"你会照做"等
                    // 用户口吻被 agent 引用的列表项)——parser 按 msg.type!=="message"
                    // 跳过了它们,DOM 端也必须跳过才能让候选序号与 parser childIndex 一致。
                    // §32.5d: 原正则 `[通过|失败|正确|错误|成功|完美|通关]` 误用字符类——含「完」「美」「通」
                    // 等单字任一即命中,导致"完全不提文件名"(含「完」)被误判为结论。改分组 `(...)` 匹配整词。
                    const verdict = /[✅⛔❌✓✗]|(通过|失败|正确|错误|成功|完美|通关)/;
                    const conclusionMarker = /^(结论|总结|最终|结果|答案|核心|关键|总的来说|综上|最终结论|要点|发现|结论是|总结一下|Conclusion|Summary|Result|Answer|Key|Finding|Finally)/;
                    const doneRe = /^已(创建|修复|完成|修改|设置|找到|解决|实现|添加|删除|更新)/;
                    const doneEnRe = /^(Done|Completed|Fixed|Created|Resolved|Updated|Added|Removed)/;
                    const quantified = /\d+\s*(个|次|条|行|项|处|ms|秒)|\d+\%|\d+\.\d+/;
                    // user 原话特征:agent 引用用户确认/指令的列表项,非真结论
                    const userQuote = /(授权我|你会照做|需要你确认|让你|请你|我要你|帮我|我要)/;
                    const numberedLi = /^\s*\d+[.)]\s+/;
                    const isC2 = (txt: string) =>
                      conclusionMarker.test(txt) || verdict.test(txt) ||
                      doneRe.test(txt) || doneEnRe.test(txt) || quantified.test(txt);
                    // §32: 按 parser 三优先级分抓 DOM 候选——strong(bold)→numbered li→普通 li
                    // 但 DOM <strong> 含 SDK 渲染样式加粗(「名字：」「定位：」等字段标签),
                    // 非 parser 端 BOLD_RE 抓的源 markdown **xxx** 加粗——序号错位根因。
                    // §32.5d: 原用 tagPattern 筛「≤8字+冒号」字段标签,但「✅ 进步了：」「❌ 但找错了文件：」
                    // 含冒号也被误筛。删 tagPattern 让 isC2 独筛——isC2 按 C2 白名单判据(含结论特征)
                    // 筛真实结论,「名字：」等字段标签无结论特征被 isC2 跳过,序号与 parser childIdx 对齐。
                    const boldEls = Array.from(target.querySelectorAll<HTMLElement>('strong'));
                    const liEls = Array.from(target.querySelectorAll<HTMLElement>('li'));
                    const numberedEls = liEls.filter(el => numberedLi.test((el.textContent || '').trim()));
                    const plainLiEls = liEls.filter(el => !numberedLi.test((el.textContent || '').trim()));
                    let matchIdx = 0;
                    let hit: HTMLElement | null = null;
                    for (const el of [...boldEls, ...numberedEls, ...plainLiEls]) {
                      const txt = (el.textContent || '').trim();
                      if (!txt || txt.length < 5) continue;
                      // 跳过 agent 引用 user 原话的 li(非真结论,parser 已跳过)
                      if (userQuote.test(txt)) continue;
                      if (!isC2(txt)) continue;
                      if (matchIdx === childIndex) {
                        hit = el;
                        console.log(LOG, `precision: conclusion[${childIndex}] matched by C2 (parser-aligned order)`);
                        break;
                      }
                      matchIdx++;
                    }
                    if (hit) precisionTarget = hit;
                  } else {
                    const precise = candidates[childIndex];
                    if (precise) {
                      precisionTarget = precise;
                      console.log(LOG, `precision: ${group}[${childIndex}] found`);
                    }
                  }
                }
              }

              const scrollTarget = precisionTarget;

              if (scrollTarget) {
                // Wait for layout to settle after loadMore batches
                // This prevents "overshoot" where content-visibility: auto
                // hasn't computed layout for newly added cards yet.
                await new Promise((r) => requestAnimationFrame(r));
                await new Promise((r) => requestAnimationFrame(r));

                // Apply scroll-margin-top inline so the target clears the
                // fixed header overlayer.
                const prevMargin = scrollTarget.style.scrollMarginTop;
                scrollTarget.style.scrollMarginTop = `${headerHeight}px`;

                scrollTarget.scrollIntoView({
                  behavior: "auto",
                  block: "start",
                });
                scrollTarget.classList.add("dip-highlight-flash");

                // Log final position immediately (scroll is instant, no
                // animation delay). The 2s timeout only removes the flash.
                const bubbleText = (scrollTarget.textContent || '').substring(0, 40);
                const bubbleRect = scrollTarget.getBoundingClientRect();
                console.log(
                  LOG,
                  `navigated to parserIdx=${parserIdx} "${bubbleText}" at (${Math.round(bubbleRect.left)},${Math.round(bubbleRect.top)})`
                );

                setTimeout(() => {
                  scrollTarget.classList.remove("dip-highlight-flash");
                  scrollTarget.style.scrollMarginTop = prevMargin || "";
                }, 2000);
              }
            }
          },
          [loadCardsToPosition]
        );

        return (
          <>
            <Inner />
            {createPortal(
              <BarStrip
                indexData={indexData}
                activeBubbleIndex={activeBubbleIndex}
                activeToolIndex={activeToolIndex}
                theme={theme}
                onNavigate={navigateToMessage}
                isLoading={isNavigating}
              />,
              document.body
            )}
          </>
        );
      };
    };

    // Register route.wrap using window.QwenPaw.route namespace
    const disposable = route?.wrap?.(
      pluginId,
      "core.chat",
      DialogIndexWrapper
    );

    // Register settings page in sidebar
    const menu = (window as any).QwenPaw?.menu;
    const settingsDisposable = route?.add?.(pluginId, {
      id: "dialog-navigation.settings",
      path: "/plugin/dialog-navigation/settings",
      component: SettingsPage,
    });
    const menuDisposable = menu?.add?.(pluginId, {
      id: "dialog-navigation.settings",
      label: "对话索引设置",
      icon: "📑",
      route: "dialog-navigation.settings",
    });
    console.log(LOG, BUILD, "settings registered:", !!settingsDisposable, !!menuDisposable);

    // Cleanup on unload
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        disposable?.dispose?.();
      });
    }

    console.log(LOG, BUILD, "registered, has route.wrap:", typeof route?.wrap);
  }
} catch (e) {
  console.error(LOG, "init failed:", e);
}

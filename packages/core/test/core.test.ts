import { describe, expect, it } from "vitest";
import {
  buildMonthlyReviewPrompt,
  buildYearlyReviewPrompt,
  checkMonthlyUnlock,
  checkYearlyUnlock,
  countWords,
  getShanghaiNowParts,
  isBlankDraftRecord,
  mapOldMoodsToNew,
  markdownToHtml,
  parseCsvRecords,
  resolveConflictEntry,
  scoreHighlightCandidates,
  stripDatePrefixFromTitle,
  stripHtml,
  validateMonthlyReviewDepth,
  validateYearlyReviewDepth,
  verifyAndMergeHighlights,
  type EntryAiDigest,
  type EntryRecord
} from "@lifebook/core";

describe("@lifebook/core 纯函数领域测试", () => {
  it("Asia/Shanghai 自然日与月/年锁判定准确", () => {
    // UTC 2026-11-30T16:30:00Z = 上海 2026-12-01 00:30:00
    const dec1Shanghai = new Date("2026-11-30T16:30:00Z");
    const parts = getShanghaiNowParts(dec1Shanghai);
    expect(parts.date).toBe("2026-12-01");
    expect(parts.month).toBe("2026-12");
    expect(parts.year).toBe("2026");

    // 11 月在 12 月 1 日应解锁，12 月锁定
    expect(checkMonthlyUnlock("2026-11", dec1Shanghai).locked).toBe(false);
    const decLock = checkMonthlyUnlock("2026-12", dec1Shanghai);
    expect(decLock.locked).toBe(true);
    expect(decLock.unlockDate).toBe("2027-01-01");

    // 2025 年解锁，2026 年锁定
    expect(checkYearlyUnlock("2025", dec1Shanghai).locked).toBe(false);
    const yrLock = checkYearlyUnlock("2026", dec1Shanghai);
    expect(yrLock.locked).toBe(true);
    expect(yrLock.unlockDate).toBe("2027-01-01");
  });

  it("HTML 剥离与有效字数统计", () => {
    const html = "<h3>生活部分</h3><p>1、晚饭做了番茄滑蛋盖饭。</p><p>出门散步 20 分钟。</p>";
    expect(stripHtml(html)).toContain("晚饭做了番茄滑蛋盖饭。");
    expect(countWords(html)).toBe(26);
  });

  it("原平台导入：标题日期前缀剥离、空白草稿判定、旧12→新8心情归并、冲突合并", () => {
    expect(stripDatePrefixFromTitle("2025-11-20 把桌面线缆理顺")).toBe("把桌面线缆理顺");
    expect(stripDatePrefixFromTitle("2025年11月20日：雨夜写方案")).toBe("雨夜写方案");
    expect(stripDatePrefixFromTitle("2026-10-05 2026-10-05 秋游")).toBe("秋游");
    expect(stripDatePrefixFromTitle("【2025-11-20】 - ", "2025-11-20")).toBe("");

    expect(isBlankDraftRecord({ date: "", title: "", contentHtml: "<p>  </p>" })).toBe(true);
    expect(isBlankDraftRecord({ date: "2026-11-01", title: "", contentHtml: "" })).toBe(false);

    expect(
      mapOldMoodsToNew(["😐 平静", "🙃 一般", "😔 不差", "😷 不爽", "💔 心碎", "😣 疲惫"])
    ).toEqual(["😌 平静", "😤 烦躁", "😢 低落", "😮‍💨 疲惫"]);

    const merged = resolveConflictEntry(
      { title: "原日记", contentHtml: "<p>上午</p>", tags: ["日常记录"], moods: ["😌 平静"] },
      { title: "新导入", contentHtml: "<p>下午</p>", tags: ["日常记录", "节点事件"], moods: ["😄 开心"] },
      "merge"
    );
    expect(merged.action).toBe("merged");
    expect(merged.contentHtml).toContain("上午");
    expect(merged.contentHtml).toContain("下午");
    expect(merged.tags).toEqual(["日常记录", "节点事件"]);
    expect(merged.moods).toEqual(["😌 平静", "😄 开心"]);
  });

  it("CSV 解析与 Markdown 转 HTML", () => {
    const csv = `日期,标题,心情,标签\n"2026-10-01","国庆出门","😄 开心","旅行游玩,重要事件"\n`;
    const rows = parseCsvRecords(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]["标题"]).toBe("国庆出门");

    const html = markdownToHtml("### 生活部分\n- **早起**散步\n![图片](img/a.png)");
    expect(html).toContain("<h3>生活部分</h3>");
    expect(html).toContain("<strong>早起</strong>");
    expect(html).toContain('<img src="img/a.png"');
  });

  it("C-16 双高光规则初筛、假日期溯源拦截与手动钉选/移出保留", () => {
    const entries: EntryRecord[] = [
      {
        id: "e1",
        kind: "daily",
        date: "2026-10-03",
        title: "环湖骑行",
        contentHtml: "<p>骑行四十公里</p>",
        contentText: "骑行四十公里",
        wordCount: 400,
        importBatch: null,
        tags: ["旅行游玩"],
        moods: ["🥰 兴奋"],
        createdAt: "",
        updatedAt: "",
        deletedAt: null
      },
      {
        id: "e2",
        kind: "daily",
        date: "2026-10-15",
        title: "重要里程碑上线",
        contentHtml: "<p>重要里程碑上线完成</p>",
        contentText: "重要里程碑上线完成".repeat(80),
        wordCount: 800,
        importBatch: null,
        tags: ["重要事件"],
        moods: ["😄 开心"],
        createdAt: "",
        updatedAt: "",
        deletedAt: null
      },
      {
        id: "e3",
        kind: "daily",
        date: "2026-10-20",
        title: "普通一天",
        contentHtml: "<p>普通散步</p>",
        contentText: "普通散步",
        wordCount: 200,
        importBatch: null,
        tags: ["日常记录"],
        moods: ["😌 平静"],
        createdAt: "",
        updatedAt: "",
        deletedAt: null
      }
    ];
    const digests = new Map<string, EntryAiDigest>();
    const cands = scoreHighlightCandidates(entries, digests, 10);
    expect(cands[0].entryId).toBe("e2");
    expect(cands[0].mustKeep).toBe(true);

    const byId = new Map(entries.map((e) => [e.id, e]));
    const byDate = new Map(entries.map((e) => [e.date, e]));

    const merged = verifyAndMergeHighlights({
      scope: "monthly",
      candidates: cands,
      aiSelected: [
        { date: "2026-10-99", entryId: "fake-id", title: "幻觉假日期" },
        { date: "2026-10-03", entryId: "e1", title: "秋日骑行" },
        { date: "2026-10-20", entryId: "e3", title: "普通一天" }
      ],
      pinnedEntryIds: new Set(["e2"]),
      excludedEntryIds: new Set(["e3"]),
      entriesById: byId,
      entriesByDate: byDate,
      digestsById: digests,
      minCount: 2,
      maxCount: 6
    });

    // 假日期 fake-id 与被排除的 e3 绝不能出现；手动钉选 e2 必须保留
    expect(merged.some((m) => m.entryId === "fake-id")).toBe(false);
    expect(merged.some((m) => m.entryId === "e3")).toBe(false);
    expect(merged.find((m) => m.entryId === "e2")?.pinned).toBe(true);
    expect(merged.some((m) => m.entryId === "e1")).toBe(true);
  });

  it("C-17 月报/年报提示词词元上限与深度校验", () => {
    const mp = buildMonthlyReviewPrompt({
      ym: "2026-10",
      stats: { days: 31, totalWords: 27420, avgWords: 884, moodSummary: "平静 15" },
      digestsText: "2026-10-01: ...",
      candidates: [],
      timebook: { available: false, totalHours: 0, todoTotal: 0, todoDone: 0, todoRate: "0%", modules: [] }
    });
    expect(mp.maxTokens).toBe(3000);
    expect(mp.system).toContain("150~260");

    const yp = buildYearlyReviewPrompt({
      year: "2025",
      stats: { days: 365, totalWords: 315942, avgWords: 866, yoyDelta: "+71%" },
      monthlySummariesText: "...",
      specialEntriesText: "...",
      candidates: [],
      timebook: { available: false, totalHours: 0, todoTotal: 0, todoDone: 0, todoRate: "0%", modules: [] }
    });
    expect(yp.maxTokens).toBe(5000);
    expect(yp.system).toContain("300~500");

    expect(
      validateMonthlyReviewDepth({
        work: "短",
        life: "短",
        leisure: "短",
        emotion: "短"
      }).ok
    ).toBe(false);

    const long160 = "本月工作推进围绕架构设计与任务拆解持续展开。".repeat(10);
    expect(
      validateMonthlyReviewDepth({
        work: long160,
        life: long160,
        leisure: long160,
        emotion: long160
      }).ok
    ).toBe(true);

    const long320 = "全年工作积累经历了打基础、系统化与稳步收获三个阶段。".repeat(15);
    expect(
      validateYearlyReviewDepth({
        work: long320,
        life: long320,
        growth: long320
      }).ok
    ).toBe(true);
  });
});

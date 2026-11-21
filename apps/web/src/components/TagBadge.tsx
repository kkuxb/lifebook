import type { TagItem } from "@lifebook/core";

export function TagBadge({
  tagName,
  tags,
  theme
}: {
  tagName: string;
  tags: TagItem[];
  theme: "light" | "dark";
}) {
  const t = tags.find((x) => x.name === tagName);
  const bg = t ? (theme === "dark" ? t.darkTint : t.tint) : theme === "dark" ? "#232A36" : "#F1F5F9";
  const fg = t ? (theme === "dark" ? t.darkInk : t.ink) : theme === "dark" ? "#CBD5E1" : "#334155";
  const dot = t ? t.color : "#64748B";
  return (
    <span className="chip" style={{ background: bg, color: fg }}>
      <i style={{ width: 7, height: 7, borderRadius: "50%", background: dot, display: "inline-block" }} />
      {tagName}
    </span>
  );
}

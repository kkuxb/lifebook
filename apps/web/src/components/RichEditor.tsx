import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { api } from "../lib/api";

interface SlashCommandItem {
  key: string;
  icon: string;
  name: string;
  desc: string;
}

const SLASH_COMMANDS: SlashCommandItem[] = [
  { key: "h3", icon: "H3", name: "三级小节标题", desc: "如「生活部分」「工作部分」" },
  { key: "h2", icon: "H2", name: "二级章节标题", desc: "较大分章结构标题" },
  { key: "p", icon: "¶", name: "普通正文段落", desc: "切换回常规文字段落" },
  { key: "ol", icon: "1.", name: "编号条目列表", desc: "逐条梳理当天事件" },
  { key: "ul", icon: "•", name: "无序圆点列表", desc: "零散想法与清单" },
  { key: "todo", icon: "☑", name: "待办复选框", desc: "可点击勾选完成" },
  { key: "quote", icon: "❝", name: "引用块", desc: "摘录金句或当日感悟" },
  { key: "code", icon: "</>", name: "代码块", desc: "记录命令、公式或片段" },
  { key: "hr", icon: "—", name: "分割线", desc: "轻柔分隔段落内容" },
  { key: "img-local", icon: "🖼", name: "插入本地图片", desc: "选择本地照片上传插入" }
];

export function RichEditor({
  valueHtml,
  onChangeHtml,
  onNotify
}: {
  valueHtml: string;
  onChangeHtml: (html: string) => void;
  onNotify: (msg: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [slashState, setSlashState] = useState<{
    open: boolean;
    left: number;
    top: number;
    activeIdx: number;
    fromPos: number;
  }>({ open: false, left: 0, top: 0, activeIdx: 0, fromPos: 0 });

  const [floatState, setFloatState] = useState<{
    open: boolean;
    left: number;
    top: number;
  }>({ open: false, left: 0, top: 0 });

  const slashRef = useRef(slashState);
  slashRef.current = slashState;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] }
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: false }),
      Image.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({
        placeholder: "写下今天的所思所感，输入 / 呼出块菜单，或直接粘贴图片…"
      })
    ],
    content: valueHtml || "<p></p>",
    onUpdate: ({ editor: ed }) => {
      onChangeHtml(ed.getHTML());
      const { state } = ed;
      const { from, empty } = state.selection;
      if (empty && from > 0) {
        const textBefore = state.doc.textBetween(Math.max(0, from - 2), from, "\n");
        if (textBefore === "/" || textBefore.endsWith("\n/") || /\s\/$/.test(textBefore)) {
          try {
            const coords = ed.view.coordsAtPos(from);
            const left = Math.min(coords.left, Math.max(12, window.innerWidth - 275));
            const top =
              coords.bottom + 330 > window.innerHeight
                ? Math.max(16, coords.top - 320)
                : coords.bottom + 8;
            setSlashState({ open: true, left, top, activeIdx: 0, fromPos: from });
            return;
          } catch {
            // ignore coords error
          }
        }
      }
      if (slashRef.current.open) {
        setSlashState((s) => ({ ...s, open: false }));
      }
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to, empty } = ed.state.selection;
      if (empty || to - from === 0) {
        setFloatState((s) => (s.open ? { ...s, open: false } : s));
        return;
      }
      const selectedText = ed.state.doc.textBetween(from, to, " ").trim();
      if (!selectedText) {
        setFloatState((s) => (s.open ? { ...s, open: false } : s));
        return;
      }
      try {
        const start = ed.view.coordsAtPos(from);
        const end = ed.view.coordsAtPos(to);
        const midX = (start.left + end.right) / 2;
        setFloatState({
          open: true,
          left: Math.max(12, Math.min(window.innerWidth - 250, midX - 115)),
          top: Math.max(10, Math.min(start.top, end.top) - 44)
        });
      } catch {
        // ignore
      }
    },
    editorProps: {
      handleKeyDown: (_view, event) => {
        const st = slashRef.current;
        if (!st.open) return false;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashState((s) => ({ ...s, activeIdx: (s.activeIdx + 1) % SLASH_COMMANDS.length }));
          return true;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashState((s) => ({
            ...s,
            activeIdx: (s.activeIdx - 1 + SLASH_COMMANDS.length) % SLASH_COMMANDS.length
          }));
          return true;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          const cmd = SLASH_COMMANDS[st.activeIdx];
          if (cmd) runSlashCommand(cmd.key);
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSlashState((s) => ({ ...s, open: false }));
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              void uploadAndInsertImage(file);
              return true;
            }
          }
        }
        return false;
      }
    }
  });

  // 外部切换日记或套用模板/恢复快照时同步内容
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (valueHtml !== current) {
      editor.commands.setContent(valueHtml || "<p></p>", false);
    }
  }, [valueHtml, editor]);

  async function uploadAndInsertImage(file: File) {
    if (!editor) return;
    try {
      onNotify("正在上传图片…");
      const res = await api.uploadImageFile(file);
      editor.chain().focus().setImage({ src: res.url, alt: file.name }).run();
      onNotify(`已插入图片：${file.name}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "图片上传失败");
    }
  }

  function runSlashCommand(key: string) {
    if (!editor) return;
    const fromPos = slashRef.current.fromPos;
    setSlashState((s) => ({ ...s, open: false }));

    const chain = editor.chain().focus();
    if (fromPos > 0) {
      const charBefore = editor.state.doc.textBetween(fromPos - 1, fromPos);
      if (charBefore === "/") {
        chain.deleteRange({ from: fromPos - 1, to: fromPos });
      }
    }

    if (key === "h3") chain.toggleHeading({ level: 3 }).run();
    else if (key === "h2") chain.toggleHeading({ level: 2 }).run();
    else if (key === "p") chain.setParagraph().run();
    else if (key === "ol") chain.toggleOrderedList().run();
    else if (key === "ul") chain.toggleBulletList().run();
    else if (key === "todo") chain.toggleTaskList().run();
    else if (key === "quote") chain.toggleBlockquote().run();
    else if (key === "code") chain.toggleCodeBlock().run();
    else if (key === "hr") chain.setHorizontalRule().run();
    else if (key === "img-local") {
      chain.run();
      fileInputRef.current?.click();
    }
  }

  return (
    <div className="tiptap-area">
      <EditorContent editor={editor} />

      <div className="editor-bottom-bar">
        <div className="shortcut-tip">
          <span>
            输入 <span className="kbd">/</span> 呼出块菜单
          </span>
          <span>
            行首 <span className="kbd">### </span> 标题
          </span>
          <span>
            <span className="kbd">- </span> 列表
          </span>
          <span>
            <span className="kbd">&gt; </span> 引用
          </span>
          <span>选中文字浮出格式条 · 支持直接粘贴图片</span>
        </div>
        <button
          type="button"
          className="btn btn-soft"
          style={{ height: 30, padding: "0 10px", fontSize: 12 }}
          onClick={() => fileInputRef.current?.click()}
        >
          🖼 插入本地图片
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void uploadAndInsertImage(f);
          e.target.value = "";
        }}
      />

      {slashState.open && (
        <div className="slash-menu" style={{ left: slashState.left, top: slashState.top }}>
          <div className="slash-menu-head">插入或切换块类型（↑↓ 选，回车确认）</div>
          {SLASH_COMMANDS.map((cmd, idx) => (
            <button
              key={cmd.key}
              type="button"
              className={`slash-item ${idx === slashState.activeIdx ? "active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                runSlashCommand(cmd.key);
              }}
            >
              <span className="slash-icon">{cmd.icon}</span>
              <span>
                <div className="slash-name">{cmd.name}</div>
                <div className="slash-desc">{cmd.desc}</div>
              </span>
            </button>
          ))}
        </div>
      )}

      {floatState.open && editor && (
        <div className="float-bar" style={{ left: floatState.left, top: floatState.top }}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleBold().run();
            }}
          >
            <b>加粗</b>
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleItalic().run();
            }}
          >
            <i>斜体</i>
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleHighlight().run();
            }}
          >
            🖍 高亮
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleStrike().run();
            }}
          >
            <s>划线</s>
          </button>
        </div>
      )}
    </div>
  );
}

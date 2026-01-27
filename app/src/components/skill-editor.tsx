"use client";

import {
  EditorRoot,
  EditorContent,
  EditorCommand,
  EditorCommandList,
  EditorCommandItem,
  EditorCommandEmpty,
  EditorBubble,
  EditorBubbleItem,
  handleCommandNavigation,
  type JSONContent,
} from "novel";
import { useRef } from "react";
import { defaultExtensions } from "./novel-extensions";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  CodeSquare,
  Text,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SkillEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  editorKey?: string;
  className?: string;
}

// Slash command suggestions
const suggestionItems = [
  {
    title: "Text",
    description: "Just start writing with plain text",
    searchTerms: ["p", "paragraph"],
    icon: <Text className="h-4 w-4" />,
    command: ({ editor, range }: any) => {
      editor.chain().focus().deleteRange(range).setParagraph().run();
    },
  },
  {
    title: "Heading 1",
    description: "Large section heading",
    searchTerms: ["title", "big", "large", "h1"],
    icon: <Heading1 className="h-4 w-4" />,
    command: ({ editor, range }: any) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
    },
  },
  {
    title: "Heading 2",
    description: "Medium section heading",
    searchTerms: ["subtitle", "medium", "h2"],
    icon: <Heading2 className="h-4 w-4" />,
    command: ({ editor, range }: any) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
    },
  },
  {
    title: "Heading 3",
    description: "Small section heading",
    searchTerms: ["small", "h3"],
    icon: <Heading3 className="h-4 w-4" />,
    command: ({ editor, range }: any) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run();
    },
  },
  {
    title: "Bullet List",
    description: "Create a bulleted list",
    searchTerms: ["unordered", "point", "ul"],
    icon: <List className="h-4 w-4" />,
    command: ({ editor, range }: any) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Numbered List",
    description: "Create a numbered list",
    searchTerms: ["ordered", "ol"],
    icon: <ListOrdered className="h-4 w-4" />,
    command: ({ editor, range }: any) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "Quote",
    description: "Add a block quote",
    searchTerms: ["blockquote"],
    icon: <Quote className="h-4 w-4" />,
    command: ({ editor, range }: any) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: "Code Block",
    description: "Add a code block",
    searchTerms: ["codeblock", "pre"],
    icon: <CodeSquare className="h-4 w-4" />,
    command: ({ editor, range }: any) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
];

export function SkillEditor({ content, onChange, editorKey, className }: SkillEditorProps) {
  const initialContent = useRef(content);

  // Update initialContent when editorKey changes (file switch)
  if (editorKey) {
    initialContent.current = content;
  }

  return (
    <EditorRoot>
      <EditorContent
        key={editorKey}
        className={cn(
          "prose prose-sm dark:prose-invert max-w-none w-full rounded-lg border bg-background p-4",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          "[&_.ProseMirror]:outline-none [&_.ProseMirror]:h-full",
          "[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:mt-0",
          "[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mb-3 [&_h2]:mt-0",
          "[&_h3]:text-lg [&_h3]:font-medium [&_h3]:mb-2 [&_h3]:mt-0",
          "[&_p]:mb-3 [&_p]:leading-relaxed",
          "[&_ul]:mb-3 [&_ol]:mb-3",
          "[&_.is-empty.is-editor-empty]:before:content-[attr(data-placeholder)] [&_.is-empty.is-editor-empty]:before:text-muted-foreground [&_.is-empty.is-editor-empty]:before:float-left [&_.is-empty.is-editor-empty]:before:pointer-events-none [&_.is-empty.is-editor-empty]:before:h-0",
          className
        )}
        extensions={defaultExtensions}
        initialContent={parseMarkdownToJSON(content)}
        editorProps={{
          handleDOMEvents: {
            keydown: (_view, event) => handleCommandNavigation(event),
          },
        }}
        onUpdate={({ editor }) => {
          const markdown = editorToMarkdown(editor);
          onChange(markdown);
        }}
        slotAfter={
          <EditorCommand className="z-50 h-auto max-h-[330px] overflow-y-auto rounded-md border bg-background px-1 py-2 shadow-md">
            <EditorCommandEmpty className="px-2 text-sm text-muted-foreground">
              No results
            </EditorCommandEmpty>
            <EditorCommandList>
              {suggestionItems.map((item) => (
                <EditorCommandItem
                  key={item.title}
                  value={item.title}
                  onCommand={(val) => item.command(val)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent cursor-pointer aria-selected:bg-accent"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-background">
                    {item.icon}
                  </div>
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </EditorCommandItem>
              ))}
            </EditorCommandList>
          </EditorCommand>
        }
      >
        <EditorBubble className="flex w-fit max-w-[90vw] overflow-hidden rounded-md border bg-background shadow-xl">
          <EditorBubbleItem
            onSelect={(editor) => editor.chain().focus().toggleBold().run()}
            className="p-2 hover:bg-accent"
          >
            <Bold className="h-4 w-4" />
          </EditorBubbleItem>
          <EditorBubbleItem
            onSelect={(editor) => editor.chain().focus().toggleItalic().run()}
            className="p-2 hover:bg-accent"
          >
            <Italic className="h-4 w-4" />
          </EditorBubbleItem>
          <EditorBubbleItem
            onSelect={(editor) => editor.chain().focus().toggleStrike().run()}
            className="p-2 hover:bg-accent"
          >
            <Strikethrough className="h-4 w-4" />
          </EditorBubbleItem>
          <EditorBubbleItem
            onSelect={(editor) => editor.chain().focus().toggleCode().run()}
            className="p-2 hover:bg-accent"
          >
            <Code className="h-4 w-4" />
          </EditorBubbleItem>
        </EditorBubble>
      </EditorContent>
    </EditorRoot>
  );
}

// Parse markdown to TipTap JSON
export function parseMarkdownToJSON(markdown: string): JSONContent | undefined {
  if (!markdown || !markdown.trim()) {
    return {
      type: "doc",
      content: [{ type: "paragraph" }],
    };
  }

  const lines = markdown.split("\n");
  const content: JSONContent[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      content.push({
        type: "heading",
        attrs: { level },
        content: text ? parseInlineContent(text) : undefined,
      });
      i++;
      continue;
    }

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```
      content.push({
        type: "codeBlock",
        attrs: { language: lang || null },
        content: codeLines.length > 0 ? [{ type: "text", text: codeLines.join("\n") }] : undefined,
      });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      content.push({
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: parseInlineContent(quoteLines.join("\n")),
          },
        ],
      });
      continue;
    }

    // Bullet list
    if (line.match(/^[-*]\s+/)) {
      const items: JSONContent[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        const itemText = lines[i].replace(/^[-*]\s+/, "");
        items.push({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: parseInlineContent(itemText),
            },
          ],
        });
        i++;
      }
      content.push({
        type: "bulletList",
        content: items,
      });
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\.\s+/)) {
      const items: JSONContent[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        const itemText = lines[i].replace(/^\d+\.\s+/, "");
        items.push({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: parseInlineContent(itemText),
            },
          ],
        });
        i++;
      }
      content.push({
        type: "orderedList",
        content: items,
      });
      continue;
    }

    // Empty line(s) - preserve multiple consecutive blank lines as empty paragraphs
    if (!line.trim()) {
      let emptyCount = 0;
      while (i < lines.length && !lines[i].trim()) {
        emptyCount++;
        i++;
      }
      // If more than one consecutive empty line, add empty paragraphs to preserve spacing
      // (one empty line is a standard paragraph break, additional ones create extra spacing)
      for (let j = 1; j < emptyCount; j++) {
        content.push({
          type: "paragraph",
          content: [],
        });
      }
      continue;
    }

    // Paragraph (collect consecutive non-empty, non-special lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("> ") &&
      !lines[i].match(/^[-*]\s+/) &&
      !lines[i].match(/^\d+\.\s+/)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      content.push({
        type: "paragraph",
        content: parseInlineContent(paraLines.join(" ")),
      });
    }
  }

  if (content.length === 0) {
    return {
      type: "doc",
      content: [{ type: "paragraph" }],
    };
  }

  return {
    type: "doc",
    content,
  };
}

// Parse inline markdown (bold, italic, code, strikethrough)
function parseInlineContent(text: string): JSONContent[] {
  if (!text) return [];

  const result: JSONContent[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Bold **text**
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      result.push({
        type: "text",
        text: boldMatch[1],
        marks: [{ type: "bold" }],
      });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic *text* (single asterisk)
    const italicMatch = remaining.match(/^\*([^*]+?)\*/);
    if (italicMatch) {
      result.push({
        type: "text",
        text: italicMatch[1],
        marks: [{ type: "italic" }],
      });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Strikethrough ~~text~~
    const strikeMatch = remaining.match(/^~~(.+?)~~/);
    if (strikeMatch) {
      result.push({
        type: "text",
        text: strikeMatch[1],
        marks: [{ type: "strike" }],
      });
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // Inline code `text`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      result.push({
        type: "text",
        text: codeMatch[1],
        marks: [{ type: "code" }],
      });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Regular text (up to the next special character)
    const plainMatch = remaining.match(/^[^*`~]+/);
    if (plainMatch) {
      result.push({
        type: "text",
        text: plainMatch[0],
      });
      remaining = remaining.slice(plainMatch[0].length);
      continue;
    }

    // Single special character that didn't match a pattern
    result.push({
      type: "text",
      text: remaining[0],
    });
    remaining = remaining.slice(1);
  }

  return result;
}

// Convert editor content to markdown
function editorToMarkdown(editor: any): string {
  if (!editor) return "";

  const json = editor.getJSON();
  return jsonToMarkdown(json);
}

// Convert JSON content to markdown
export function jsonToMarkdown(json: JSONContent): string {
  if (!json.content) return "";

  return json.content
    .map((node: any) => {
      switch (node.type) {
        case "heading":
          const level = node.attrs?.level || 1;
          const headingText = getTextContent(node);
          return "#".repeat(level) + " " + headingText;
        case "paragraph":
          return getTextContent(node);
        case "bulletList":
          return node.content
            ?.map((item: any) => "- " + getTextContent(item))
            .join("\n");
        case "orderedList":
          return node.content
            ?.map((item: any, i: number) => `${i + 1}. ` + getTextContent(item))
            .join("\n");
        case "blockquote":
          const quoteText = getTextContent(node);
          return quoteText.split("\n").map((line: string) => "> " + line).join("\n");
        case "codeBlock":
          const lang = node.attrs?.language || "";
          return "```" + lang + "\n" + getTextContent(node) + "\n```";
        case "horizontalRule":
          return "---";
        case "taskList":
          return node.content
            ?.map((item: any) => {
              const checked = item.attrs?.checked ? "x" : " ";
              return `- [${checked}] ` + getTextContent(item);
            })
            .join("\n");
        default:
          return getTextContent(node);
      }
    })
    .filter((text: string) => text !== undefined)
    .join("\n\n");
}

function getTextContent(node: any): string {
  if (!node) return "";
  if (node.text) {
    let text = node.text;
    if (node.marks) {
      for (const mark of node.marks) {
        switch (mark.type) {
          case "bold":
            text = `**${text}**`;
            break;
          case "italic":
            text = `*${text}*`;
            break;
          case "strike":
            text = `~~${text}~~`;
            break;
          case "code":
            text = "`" + text + "`";
            break;
          case "link":
            text = `[${text}](${mark.attrs?.href || ""})`;
            break;
        }
      }
    }
    return text;
  }
  if (node.content) {
    return node.content.map(getTextContent).join("");
  }
  return "";
}

// Helper to parse and serialize SKILL.md frontmatter
export function parseSkillContent(content: string): {
  name: string;
  description: string;
  body: string;
} {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!frontmatterMatch) {
    return { name: "", description: "", body: content };
  }

  const frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  // Parse YAML-like frontmatter
  const nameMatch = frontmatter.match(/^name:\s*(.*)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.*)$/m);

  return {
    name: nameMatch ? nameMatch[1].trim() : "",
    description: descMatch ? descMatch[1].trim() : "",
    body: body.trim(),
  };
}

export function serializeSkillContent(name: string, description: string, body: string): string {
  return `---
name: ${name}
description: ${description}
---

${body}`;
}

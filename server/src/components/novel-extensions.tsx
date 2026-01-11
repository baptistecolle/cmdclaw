"use client";

import {
  StarterKit,
  TiptapLink,
  TiptapUnderline,
  TaskList,
  TaskItem,
  TextStyle,
  Color,
  renderItems,
} from "novel";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";

// Slash command extension that triggers on "/"
const SlashCommand = Extension.create({
  name: "slash-command",
  addOptions() {
    return {
      suggestion: {
        char: "/",
        command: ({
          editor,
          range,
          props,
        }: {
          editor: any;
          range: any;
          props: any;
        }) => {
          props.command({ editor, range });
        },
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        render: renderItems,
      }),
    ];
  },
});

export const defaultExtensions = [
  StarterKit.configure({
    heading: {
      levels: [1, 2, 3],
      HTMLAttributes: {
        class: "font-semibold",
      },
    },
    bulletList: {
      HTMLAttributes: {
        class: "list-disc list-outside leading-relaxed ml-4",
      },
    },
    orderedList: {
      HTMLAttributes: {
        class: "list-decimal list-outside leading-relaxed ml-4",
      },
    },
    listItem: {
      HTMLAttributes: {
        class: "leading-normal mb-1",
      },
    },
    blockquote: {
      HTMLAttributes: {
        class: "border-l-4 border-muted-foreground/30 pl-4 italic text-muted-foreground",
      },
    },
    codeBlock: {
      HTMLAttributes: {
        class: "rounded-md bg-muted border p-4 font-mono text-sm overflow-x-auto",
      },
    },
    code: {
      HTMLAttributes: {
        class: "rounded bg-muted px-1.5 py-0.5 font-mono text-sm before:content-none after:content-none",
        spellcheck: "false",
      },
    },
    paragraph: {
      HTMLAttributes: {
        class: "leading-relaxed",
      },
    },
    horizontalRule: false,
    dropcursor: {
      color: "#DBEAFE",
      width: 4,
    },
    gapcursor: false,
  }),
  TiptapLink.configure({
    HTMLAttributes: {
      class: "text-primary underline underline-offset-4 hover:text-primary/80 cursor-pointer",
    },
  }),
  TiptapUnderline,
  TextStyle,
  Color,
  TaskList.configure({
    HTMLAttributes: {
      class: "not-prose pl-2",
    },
  }),
  TaskItem.configure({
    HTMLAttributes: {
      class: "flex items-start gap-2",
    },
    nested: true,
  }),
  Placeholder.configure({
    placeholder: ({ node }) => {
      if (node.type.name === "heading") {
        return `Heading ${node.attrs.level}`;
      }
      return "Type '/' for commands...";
    },
    includeChildren: true,
  }),
  SlashCommand,
];

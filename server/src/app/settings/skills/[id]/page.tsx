"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  useSkill,
  useUpdateSkill,
  useDeleteSkill,
  useAddSkillFile,
  useUpdateSkillFile,
  useDeleteSkillFile,
} from "@/orpc/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SkillEditor,
  parseSkillContent,
  serializeSkillContent,
} from "@/components/skill-editor";
import {
  ArrowLeft,
  Loader2,
  Save,
  Trash2,
  Plus,
  FileText,
  CheckCircle2,
  XCircle,
  Eye,
  Code2,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";

type EditorMode = "rich" | "markdown";

function SkillEditorPageContent() {
  const params = useParams();
  const router = useRouter();
  const skillId = params.id as string;

  const { data: skill, isLoading, refetch } = useSkill(skillId);
  const updateSkill = useUpdateSkill();
  const deleteSkill = useDeleteSkill();
  const addFile = useAddSkillFile();
  const updateFile = useUpdateSkillFile();
  const deleteFile = useDeleteSkillFile();

  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("rich");
  const [isSaving, setIsSaving] = useState(false);
  const [showAddFile, setShowAddFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Inline editing states
  const [isEditingSlug, setIsEditingSlug] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);

  // For SKILL.md - separate state for metadata and body
  const [skillDisplayName, setSkillDisplayName] = useState("");
  const [skillSlug, setSkillSlug] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillBody, setSkillBody] = useState("");

  // For other files - raw content
  const [editedContent, setEditedContent] = useState("");

  // Set initial selected file and content when skill loads
  useEffect(() => {
    if (skill?.files && skill.files.length > 0) {
      // Set display name and slug from skill metadata
      setSkillDisplayName(skill.displayName);
      setSkillSlug(skill.name);
      setSkillDescription(skill.description);

      const skillMd = skill.files.find((f) => f.path === "SKILL.md");
      const initialFile = skillMd || skill.files[0];
      if (initialFile && !selectedFileId) {
        setSelectedFileId(initialFile.id);
        if (initialFile.path === "SKILL.md") {
          const parsed = parseSkillContent(initialFile.content);
          setSkillBody(parsed.body);
        } else {
          setEditedContent(initialFile.content);
        }
      }
    }
  }, [skill, selectedFileId]);

  // Auto-generate slug from display name
  const generateSlug = (displayName: string): string => {
    return displayName
      .toLowerCase()
      .replace(/[^a-z0-9-\s]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64);
  };

  const handleDisplayNameChange = (value: string) => {
    setSkillDisplayName(value);
    // Auto-generate slug if user hasn't manually edited it
    if (!isEditingSlug) {
      setSkillSlug(generateSlug(value));
    }
  };

  const handleSelectFile = (fileId: string) => {
    if (selectedFileId) {
      // Auto-save current file before switching
      handleSaveFile();
    }
    const file = skill?.files.find((f) => f.id === fileId);
    if (file) {
      setSelectedFileId(fileId);
      if (file.path === "SKILL.md") {
        const parsed = parseSkillContent(file.content);
        setSkillBody(parsed.body);
      } else {
        setEditedContent(file.content);
      }
    }
  };

  const getCurrentContent = (): string => {
    const selectedFile = skill?.files.find((f) => f.id === selectedFileId);
    if (selectedFile?.path === "SKILL.md") {
      return serializeSkillContent(skillSlug, skillDescription, skillBody);
    }
    return editedContent;
  };

  const handleSaveFile = async () => {
    if (!selectedFileId) return;

    setIsSaving(true);
    try {
      const content = getCurrentContent();
      await updateFile.mutateAsync({
        id: selectedFileId,
        content,
      });

      // Also update skill metadata
      await updateSkill.mutateAsync({
        id: skillId,
        name: skillSlug,
        displayName: skillDisplayName,
        description: skillDescription,
      });

      setNotification({ type: "success", message: "Saved" });
      refetch();
    } catch (error) {
      setNotification({ type: "error", message: "Failed to save" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddFile = async () => {
    if (!newFilePath.trim()) return;

    try {
      await addFile.mutateAsync({
        skillId,
        path: newFilePath,
        content: `# ${newFilePath}\n\nAdd content here...`,
      });
      setShowAddFile(false);
      setNewFilePath("");
      setNotification({ type: "success", message: "File added" });
      refetch();
    } catch (error) {
      setNotification({ type: "error", message: "Failed to add file" });
    }
  };

  const handleDeleteFile = async (fileId: string, path: string) => {
    if (path === "SKILL.md") {
      setNotification({ type: "error", message: "Cannot delete SKILL.md" });
      return;
    }
    if (!confirm(`Delete "${path}"?`)) return;

    try {
      await deleteFile.mutateAsync(fileId);
      if (selectedFileId === fileId) {
        const skillMd = skill?.files.find((f) => f.path === "SKILL.md");
        if (skillMd) {
          setSelectedFileId(skillMd.id);
          const parsed = parseSkillContent(skillMd.content);
          setSkillBody(parsed.body);
        }
      }
      setNotification({ type: "success", message: "File deleted" });
      refetch();
    } catch (error) {
      setNotification({ type: "error", message: "Failed to delete file" });
    }
  };

  const handleDeleteSkill = async () => {
    if (!confirm(`Delete skill "${skillDisplayName}"? This cannot be undone.`))
      return;

    try {
      await deleteSkill.mutateAsync(skillId);
      router.push("/settings/skills");
    } catch (error) {
      setNotification({ type: "error", message: "Failed to delete skill" });
    }
  };

  // Auto-dismiss notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground">Skill not found</p>
        <Button asChild className="mt-4">
          <Link href="/settings/skills">Back to Skills</Link>
        </Button>
      </div>
    );
  }

  const selectedFile = skill.files.find((f) => f.id === selectedFileId);
  const isSkillMd = selectedFile?.path === "SKILL.md";

  return (
    <div className="flex h-[calc(100vh-8rem)] max-w-4xl flex-col">
      {/* Header with back button, save and delete */}
      <div className="mb-6 flex items-center justify-between shrink-0">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/settings/skills">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveFile}
            disabled={isSaving || !selectedFileId}
          >
            {isSaving ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <Save className="mr-2 h-3 w-3" />
            )}
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={handleDeleteSkill}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div
          className={cn(
            "mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm shrink-0",
            notification.type === "success"
              ? "bg-green-500/10 text-green-700 dark:text-green-400"
              : "bg-red-500/10 text-red-700 dark:text-red-400"
          )}
        >
          {notification.type === "success" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          {notification.message}
        </div>
      )}

      {/* Notion-style inline editable metadata */}
      <div className="mb-6 space-y-2 shrink-0">
        {/* Display Name - Large title */}
        <input
          ref={displayNameRef}
          type="text"
          value={skillDisplayName}
          onChange={(e) => handleDisplayNameChange(e.target.value)}
          placeholder="Untitled Skill"
          className="w-full bg-transparent text-3xl font-bold outline-none placeholder:text-muted-foreground/50 focus:outline-none"
        />

        {/* Slug - Small monospace, editable on click */}
        <div className="flex items-center gap-1.5">
          {isEditingSlug ? (
            <input
              ref={slugRef}
              type="text"
              value={skillSlug}
              onChange={(e) =>
                setSkillSlug(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, "-")
                    .replace(/-+/g, "-")
                )
              }
              onBlur={() => setIsEditingSlug(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") {
                  setIsEditingSlug(false);
                }
              }}
              className="h-6 bg-transparent font-mono text-xs text-muted-foreground outline-none"
              autoFocus
            />
          ) : (
            <button
              onClick={() => setIsEditingSlug(true)}
              className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <span className="font-mono">{skillSlug || "skill-slug"}</span>
              <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100" />
            </button>
          )}
        </div>

        {/* Description - Muted text, expands to input on click */}
        {isEditingDescription ? (
          <input
            ref={descriptionRef}
            type="text"
            value={skillDescription}
            onChange={(e) => setSkillDescription(e.target.value)}
            onBlur={() => setIsEditingDescription(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                setIsEditingDescription(false);
              }
            }}
            placeholder="Add a description..."
            className="w-full bg-transparent text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/50"
            autoFocus
          />
        ) : (
          <button
            onClick={() => setIsEditingDescription(true)}
            className="text-left text-sm text-muted-foreground hover:text-foreground"
          >
            {skillDescription || (
              <span className="text-muted-foreground/50">
                Add a description...
              </span>
            )}
          </button>
        )}
      </div>

      {/* File tabs - subtle style, above editor */}
      <div className="mb-3 flex items-center gap-1 border-b border-border/50 shrink-0">
        {skill.files
          .sort((a, b) => {
            if (a.path === "SKILL.md") return -1;
            if (b.path === "SKILL.md") return 1;
            return a.path.localeCompare(b.path);
          })
          .map((file) => (
            <button
              key={file.id}
              onClick={() => handleSelectFile(file.id)}
              className={cn(
                "group flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors",
                selectedFileId === file.id
                  ? "border-b-2 border-foreground/70 font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <FileText className="h-3 w-3" />
              {file.path}
              {file.path !== "SKILL.md" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteFile(file.id, file.path);
                  }}
                  className="ml-0.5 rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              )}
            </button>
          ))}
        <button
          onClick={() => setShowAddFile(true)}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
        </button>

        {/* Mode toggle - far right */}
        {isSkillMd && (
          <div className="ml-auto flex items-center gap-0.5">
            <button
              onClick={() => setEditorMode("rich")}
              className={cn(
                "rounded p-1.5 transition-colors",
                editorMode === "rich"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Rich editor"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setEditorMode("markdown")}
              className={cn(
                "rounded p-1.5 transition-colors",
                editorMode === "markdown"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Markdown"
            >
              <Code2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Add file input */}
      {showAddFile && (
        <div className="mb-4 flex items-center gap-2 shrink-0">
          <Input
            placeholder="filename.md"
            value={newFilePath}
            onChange={(e) => setNewFilePath(e.target.value)}
            className="h-8 flex-1 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddFile();
              if (e.key === "Escape") {
                setShowAddFile(false);
                setNewFilePath("");
              }
            }}
          />
          <Button size="sm" onClick={handleAddFile} disabled={!newFilePath.trim()}>
            Add
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowAddFile(false);
              setNewFilePath("");
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* Editor area */}
      {selectedFile && (
        <div className="flex-1 min-h-0">
          {isSkillMd && editorMode === "rich" ? (
            <SkillEditor
              content={skillBody}
              onChange={setSkillBody}
              editorKey={`${selectedFileId}-body`}
              className="h-full"
            />
          ) : isSkillMd && editorMode === "markdown" ? (
            <textarea
              value={serializeSkillContent(skillSlug, skillDescription, skillBody)}
              onChange={(e) => {
                const parsed = parseSkillContent(e.target.value);
                setSkillSlug(parsed.name);
                setSkillDescription(parsed.description);
                setSkillBody(parsed.body);
              }}
              className="h-full w-full rounded-lg border bg-background p-4 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              placeholder="---
name: skill-name
description: What this skill does
---

# Instructions

Add your skill instructions here..."
            />
          ) : (
            <SkillEditor
              content={editedContent}
              onChange={setEditedContent}
              editorKey={selectedFileId || ""}
              className="h-full"
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function SkillEditorPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <SkillEditorPageContent />
    </Suspense>
  );
}

"use client";

import { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  useSkill,
  useUpdateSkill,
  useDeleteSkill,
  useAddSkillFile,
  useUpdateSkillFile,
  useDeleteSkillFile,
  useUploadSkillDocument,
  useDeleteSkillDocument,
  useGetDocumentUrl,
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
  Trash2,
  Plus,
  FileText,
  CheckCircle2,
  XCircle,
  Eye,
  Code2,
  Pencil,
  FileUp,
  Download,
  File,
  Image,
  FileSpreadsheet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconPicker, IconDisplay } from "@/components/ui/icon-picker";

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
  const uploadDocument = useUploadSkillDocument();
  const deleteDocument = useDeleteSkillDocument();
  const getDocumentUrl = useGetDocumentUrl();

  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("rich");
  const [isSaving, setIsSaving] = useState(false);
  const [showAddFile, setShowAddFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<{ id: string; filename: string } | null>(null);
  const [fileToDelete, setFileToDelete] = useState<{ id: string; path: string } | null>(null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [isLoadingDocumentUrl, setIsLoadingDocumentUrl] = useState(false);

  // Inline editing states
  const [isEditingSlug, setIsEditingSlug] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // For SKILL.md - separate state for metadata and body
  const [skillDisplayName, setSkillDisplayName] = useState("");
  const [skillSlug, setSkillSlug] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillIcon, setSkillIcon] = useState<string | null>(null);
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
      setSkillIcon(skill.icon ?? null);

      const skillMd = skill.files.find((f) => f.path === "SKILL.md");
      const initialFile = skillMd || skill.files[0];
      // Only auto-select if nothing is selected (not a file, not a document)
      if (initialFile && !selectedFileId && !selectedDocumentId) {
        setSelectedFileId(initialFile.id);
        if (initialFile.path === "SKILL.md") {
          const parsed = parseSkillContent(initialFile.content);
          setSkillBody(parsed.body);
        } else {
          setEditedContent(initialFile.content);
        }
      }
    }
  }, [skill, selectedFileId, selectedDocumentId]);

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

  // Generate display name from slug (reverse of generateSlug)
  const generateDisplayName = (slug: string): string => {
    return slug
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
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
      setSelectedDocumentId(null);
      setDocumentUrl(null);
      if (file.path === "SKILL.md") {
        const parsed = parseSkillContent(file.content);
        setSkillBody(parsed.body);
      } else {
        setEditedContent(file.content);
      }
    }
  };

  const isViewableDocument = (mimeType: string) => {
    return (
      mimeType === "application/pdf" ||
      mimeType.startsWith("image/")
    );
  };

  const handleSelectDocument = async (docId: string) => {
    if (selectedFileId) {
      // Auto-save current file before switching
      handleSaveFile();
    }
    setSelectedFileId(null);
    setSelectedDocumentId(docId);
    setDocumentUrl(null);

    const doc = skill?.documents?.find((d) => d.id === docId);
    if (doc && isViewableDocument(doc.mimeType)) {
      setIsLoadingDocumentUrl(true);
      try {
        const { url } = await getDocumentUrl.mutateAsync(docId);
        setDocumentUrl(url);
      } catch (error) {
        setNotification({ type: "error", message: "Failed to load document" });
      } finally {
        setIsLoadingDocumentUrl(false);
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

  const handleSaveFile = async (showNotificationIfNoChanges = false) => {
    if (!selectedFileId) return;

    const selectedFile = skill?.files.find((f) => f.id === selectedFileId);
    if (!selectedFile) return;

    const content = getCurrentContent();

    // Check if there are actual changes
    const hasFileChanges = content !== selectedFile.content;
    const hasMetadataChanges =
      skillSlug !== skill?.name ||
      skillDisplayName !== skill?.displayName ||
      skillDescription !== skill?.description ||
      skillIcon !== (skill?.icon ?? null);

    // Skip save if nothing changed
    if (!hasFileChanges && !hasMetadataChanges) {
      if (showNotificationIfNoChanges) {
        setNotification({ type: "success", message: "Saved" });
      }
      return;
    }

    setIsSaving(true);
    try {
      if (hasFileChanges) {
        await updateFile.mutateAsync({
          id: selectedFileId,
          content,
        });
      }

      if (hasMetadataChanges) {
        // Also update skill metadata
        await updateSkill.mutateAsync({
          id: skillId,
          name: skillSlug,
          displayName: skillDisplayName,
          description: skillDescription,
          icon: skillIcon,
        });
      }

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

  const handleDeleteFile = async () => {
    if (!fileToDelete) return;

    try {
      await deleteFile.mutateAsync(fileToDelete.id);
      if (selectedFileId === fileToDelete.id) {
        const skillMd = skill?.files.find((f) => f.path === "SKILL.md");
        if (skillMd) {
          setSelectedFileId(skillMd.id);
          const parsed = parseSkillContent(skillMd.content);
          setSkillBody(parsed.body);
        }
      }
      setNotification({ type: "success", message: "File deleted" });
      setFileToDelete(null);
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

  // Document handlers
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      await uploadDocument.mutateAsync({
        skillId,
        filename: file.name,
        mimeType: file.type,
        content: base64,
      });

      setNotification({ type: "success", message: "Document uploaded" });
      refetch();
    } catch (error) {
      setNotification({
        type: "error",
        message: error instanceof Error ? error.message : "Upload failed",
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDownloadDocument = async (docId: string) => {
    try {
      const { url, filename } = await getDocumentUrl.mutateAsync(docId);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      setNotification({ type: "error", message: "Failed to get download URL" });
    }
  };

  const handleDeleteDocument = async () => {
    if (!documentToDelete) return;

    try {
      await deleteDocument.mutateAsync(documentToDelete.id);
      if (selectedDocumentId === documentToDelete.id) {
        // Switch back to SKILL.md
        const skillMd = skill?.files.find((f) => f.path === "SKILL.md");
        if (skillMd) {
          setSelectedFileId(skillMd.id);
          setSelectedDocumentId(null);
          setDocumentUrl(null);
          const parsed = parseSkillContent(skillMd.content);
          setSkillBody(parsed.body);
        }
      }
      setNotification({ type: "success", message: "Document deleted" });
      setDocumentToDelete(null);
      refetch();
    } catch (error) {
      setNotification({ type: "error", message: "Failed to delete document" });
    }
  };

  const getDocumentIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) return Image;
    if (mimeType.includes("spreadsheet") || mimeType.includes("excel"))
      return FileSpreadsheet;
    return File;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Auto-dismiss notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  // Auto-save with debounce
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasInitializedRef = useRef(false);

  useEffect(() => {
    // Skip auto-save on initial load
    if (!hasInitializedRef.current) {
      if (skill?.files && skill.files.length > 0) {
        hasInitializedRef.current = true;
      }
      return;
    }

    // Don't auto-save if no file is selected
    if (!selectedFileId) return;

    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    // Set new timeout for auto-save (debounce 1 second)
    autoSaveTimeoutRef.current = setTimeout(() => {
      handleSaveFile();
    }, 1000);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [skillBody, editedContent, skillDisplayName, skillSlug, skillDescription, skillIcon]);

  // Cmd+S / Ctrl+S to save immediately
  useHotkeys(
    "mod+s",
    (e) => {
      e.preventDefault();
      handleSaveFile(true);
    },
    { enableOnFormTags: ["INPUT", "TEXTAREA"] },
    [handleSaveFile]
  );

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
      {/* Header with back button and delete */}
      <div className="mb-6 flex items-center justify-between shrink-0">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/settings/skills">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <span className={cn(
            "flex items-center gap-1.5 text-xs transition-opacity",
            isSaving ? "opacity-100 text-muted-foreground" :
            notification?.type === "success" ? "opacity-100 text-green-600 dark:text-green-400" :
            notification?.type === "error" ? "opacity-100 text-red-600 dark:text-red-400" : "opacity-0 text-muted-foreground"
          )}>
            {isSaving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving...
              </>
            ) : notification?.type === "success" ? (
              <>
                <CheckCircle2 className="h-3 w-3" />
                Saved
              </>
            ) : notification?.type === "error" ? (
              <>
                <XCircle className="h-3 w-3" />
                {notification.message}
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3 w-3" />
                Saved
              </>
            )}
          </span>
          <Button variant="ghost" size="sm" onClick={handleDeleteSkill}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Notion-style inline editable metadata */}
      <div className="mb-6 space-y-2 shrink-0">
        {/* Icon and Display Name */}
        <div className="flex items-start gap-3">
          <IconPicker value={skillIcon} onChange={setSkillIcon}>
            <button
              type="button"
              className="flex h-12 w-12 items-center justify-center rounded-lg border bg-muted hover:bg-muted/80 transition-colors shrink-0"
            >
              {skillIcon ? (
                <span className="text-2xl">{skillIcon}</span>
              ) : (
                <FileText className="h-6 w-6 text-muted-foreground" />
              )}
            </button>
          </IconPicker>
          <input
            ref={displayNameRef}
            type="text"
            value={skillDisplayName}
            onChange={(e) => handleDisplayNameChange(e.target.value)}
            placeholder="Untitled Skill"
            className="w-full bg-transparent text-3xl font-bold outline-none placeholder:text-muted-foreground/50 focus:outline-none pt-1"
          />
        </div>

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
        {/* Text files */}
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
                    setFileToDelete({ id: file.id, path: file.path });
                  }}
                  className="ml-0.5 rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              )}
            </button>
          ))}
        {/* Document tabs */}
        {skill.documents?.map((doc) => {
          const Icon = getDocumentIcon(doc.mimeType);
          return (
            <button
              key={doc.id}
              onClick={() => handleSelectDocument(doc.id)}
              className={cn(
                "group flex items-center gap-1 px-2.5 py-1.5 text-xs transition-colors",
                selectedDocumentId === doc.id
                  ? "border-b-2 border-foreground/70 font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3 w-3" />
              {doc.filename}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDocumentToDelete({ id: doc.id, filename: doc.filename });
                }}
                className="ml-0.5 rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </button>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
              <Plus className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setShowAddFile(true)}>
              <FileText className="h-4 w-4" />
              Text file
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              {isUploading ? "Uploading..." : "Document"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.gif,.webp,.svg"
          className="hidden"
        />

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

      {/* Editor/Content area */}
      <div className="flex-1 min-h-0">
        {selectedFile && !selectedDocumentId && (
          <>
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
                  // Also update display name when name changes in markdown mode
                  if (parsed.name !== skillSlug) {
                    setSkillDisplayName(generateDisplayName(parsed.name));
                  }
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
          </>
        )}
        {selectedDocumentId && (() => {
          const selectedDoc = skill.documents?.find((d) => d.id === selectedDocumentId);
          if (!selectedDoc) return null;

          const isViewable = isViewableDocument(selectedDoc.mimeType);

          if (isLoadingDocumentUrl) {
            return (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            );
          }

          if (isViewable && documentUrl) {
            if (selectedDoc.mimeType === "application/pdf") {
              return (
                <iframe
                  src={documentUrl}
                  className="h-full w-full rounded-lg border"
                  title={selectedDoc.filename}
                />
              );
            }
            if (selectedDoc.mimeType.startsWith("image/")) {
              return (
                <div className="flex h-full items-center justify-center overflow-auto rounded-lg border bg-muted/30 p-4">
                  <img
                    src={documentUrl}
                    alt={selectedDoc.filename}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              );
            }
          }

          // Non-viewable document - show download prompt
          const Icon = getDocumentIcon(selectedDoc.mimeType);
          return (
            <div className="flex h-full flex-col items-center justify-center gap-4 rounded-lg border bg-muted/30">
              <Icon className="h-16 w-16 text-muted-foreground" />
              <div className="text-center">
                <p className="font-medium">{selectedDoc.filename}</p>
                <p className="text-sm text-muted-foreground">
                  {formatFileSize(selectedDoc.sizeBytes)}
                </p>
              </div>
              <Button onClick={() => handleDownloadDocument(selectedDoc.id)}>
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>
          );
        })()}
      </div>

      {/* Delete document confirmation modal */}
      {documentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg">
            <h3 className="text-lg font-semibold">Delete document</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Are you sure you want to delete "{documentToDelete.filename}"? This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setDocumentToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteDocument}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete file confirmation modal */}
      {fileToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg">
            <h3 className="text-lg font-semibold">Delete file</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Are you sure you want to delete "{fileToDelete.path}"? This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setFileToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteFile}
              >
                Delete
              </Button>
            </div>
          </div>
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

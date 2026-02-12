"use client";

import { Plus, Loader2, FileText, Pencil, Trash2, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconDisplay } from "@/components/ui/icon-picker";
import { cn } from "@/lib/utils";
import { useSkillList, useCreateSkill, useUpdateSkill, useDeleteSkill } from "@/orpc/hooks";

function SkillsPageContent() {
  const router = useRouter();
  const { data: skills, isLoading, refetch } = useSkillList();
  const createSkill = useCreateSkill();
  const updateSkill = useUpdateSkill();
  const deleteSkill = useDeleteSkill();

  const [isCreating, setIsCreating] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    try {
      const result = await createSkill.mutateAsync({
        displayName: "New Skill",
        description: "Add a description for this skill",
      });
      // Navigate to the editor page
      router.push(`/skills/${result.id}`);
    } catch {
      setNotification({
        type: "error",
        message: "Failed to create skill. Please try again.",
      });
      setIsCreating(false);
    }
  }, [createSkill, router]);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    try {
      await updateSkill.mutateAsync({ id, enabled });
      refetch();
    } catch (error) {
      console.error("Failed to toggle skill:", error);
    }
  }, [refetch, updateSkill]);

  const handleDelete = useCallback(async (id: string, displayName: string) => {
    if (!confirm(`Are you sure you want to delete "${displayName}"?`)) {
      return;
    }

    try {
      await deleteSkill.mutateAsync(id);
      setNotification({
        type: "success",
        message: `Skill "${displayName}" deleted.`,
      });
      refetch();
    } catch {
      setNotification({
        type: "error",
        message: "Failed to delete skill.",
      });
    }
  }, [deleteSkill, refetch]);

  useEffect(() => {
    if (!notification) {
      return;
    }
    const timer = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(timer);
  }, [notification]);

  const skillsList = Array.isArray(skills) ? skills : [];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Skills</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create custom skills to teach the AI agent new capabilities.
          </p>
        </div>
        <Button onClick={handleCreate} disabled={isCreating}>
          {isCreating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Create Skill
        </Button>
      </div>

      {notification && (
        <div
          className={cn(
            "mb-6 flex items-center gap-2 rounded-lg border p-4",
            notification.type === "success"
              ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
              : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400",
          )}
        >
          {notification.type === "success" ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            <XCircle className="h-5 w-5" />
          )}
          {notification.message}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : skillsList.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h3 className="mt-4 text-lg font-medium">No skills yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first skill to teach the AI agent new capabilities.
          </p>
          <Button className="mt-4" onClick={handleCreate} disabled={isCreating}>
            {isCreating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Create Skill
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {skillsList.map((skill) => (
            <div key={skill.id} className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center">
                  <IconDisplay icon={skill.icon} />
                </div>
                <div>
                  <h3 className="font-medium">{skill.displayName}</h3>
                  <p className="text-xs text-muted-foreground font-mono">{skill.name}</p>
                  <p className="text-sm text-muted-foreground line-clamp-1">{skill.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <SkillEnabledCheckbox
                    checked={skill.enabled}
                    skillId={skill.id}
                    onToggle={handleToggle}
                  />
                  <span className="text-sm">Enabled</span>
                </label>
                <Button variant="ghost" size="icon" asChild>
                  <Link href={`/skills/${skill.id}`}>
                    <Pencil className="h-4 w-4" />
                  </Link>
                </Button>
                <SkillDeleteButton
                  skillId={skill.id}
                  displayName={skill.displayName}
                  onDelete={handleDelete}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SkillsPage() {
  return <Suspense fallback={skillsPageFallbackNode}><SkillsPageContent /></Suspense>;
}

function SkillEnabledCheckbox({
  checked,
  skillId,
  onToggle,
}: {
  checked: boolean;
  skillId: string;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
}) {
  const handleCheckedChange = useCallback(
    (value: boolean | "indeterminate") => {
      void onToggle(skillId, value === true);
    },
    [onToggle, skillId],
  );

  return <Checkbox checked={checked} onCheckedChange={handleCheckedChange} />;
}

function SkillDeleteButton({
  skillId,
  displayName,
  onDelete,
}: {
  skillId: string;
  displayName: string;
  onDelete: (id: string, displayName: string) => Promise<void>;
}) {
  const handleClick = useCallback(() => {
    void onDelete(skillId, displayName);
  }, [displayName, onDelete, skillId]);

  return (
    <Button variant="ghost" size="icon" onClick={handleClick}>
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function SkillsPageFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

const skillsPageFallbackNode = <SkillsPageFallback />;

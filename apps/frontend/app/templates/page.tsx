"use client";

import type React from "react";
import { Suspense, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsBoolean, parseAsString, useQueryStates } from "nuqs";
import {
  ArchiveIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  FolderInputIcon,
  FolderIcon,
  FolderPlusIcon,
  Grid3X3Icon,
  ListIcon,
  MoreVerticalIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  UploadIcon,
  UserRoundIcon,
  type LucideIcon,
  PencilIcon,
  SignatureIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api/http";
import {
  archiveSubmission,
  listSubmissions,
  type SubmissionResponse,
} from "@/lib/api/submissions";
import { listTeams, type Team } from "@/lib/api/teams";
import {
  archiveTemplate,
  addTemplateGoogleDriveDocuments,
  cloneTemplate,
  createTemplate,
  createTemplateFolder,
  createTemplateFromDocument,
  deleteTemplateFolder,
  deleteTemplatePermanently,
  listTemplateFolders,
  listTemplates,
  type DeleteTemplateFolderMode,
  type TemplateFolderResponse,
  type TemplateResponse,
  updateTemplateFolder,
  updateTemplate,
} from "@/lib/api/templates";
import { pickGoogleDriveDocuments } from "@/lib/google-drive/picker";
import type { AppDictionary } from "@/lib/i18n/app-dictionaries";
import { useAppI18n } from "@/lib/i18n/use-app-i18n";
import { useRealtimeEvents } from "@/lib/realtime/use-realtime-events";
import { cn } from "@/lib/utils";
import { TemplateUploadDropzone } from "./_components/template-upload-dropzone";
import { ConsoleHeader } from "./_components/console-header";

type PendingDelete = {
  mode: "archive" | "delete";
  template: TemplateResponse;
};

type PendingFolderDelete = {
  folder: TemplateFolderResponse;
};

type CloneDialogState = {
  folderName: string;
  name: string;
  teamId: string;
  template: TemplateResponse;
};

type DashboardView = "templates" | "submissions";
type CreateTemplateSource = "drive" | "upload";

export default function TemplatesPage() {
  return (
    <Suspense fallback={<TemplatesPageFallback />}>
      <TemplatesDashboard />
    </Suspense>
  );
}

function TemplatesDashboard() {
  const router = useRouter();
  const { dictionary } = useAppI18n();
  const text = dictionary.templates;
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const loadSequenceRef = useRef(0);
  const [templateUrlState, setTemplateUrlState] = useQueryStates(
    {
      archived: parseAsBoolean.withDefault(false),
      folder: parseAsString.withDefault(""),
      q: parseAsString.withDefault(""),
      view: parseAsString.withDefault("templates"),
    },
    {
      history: "push",
      shallow: true,
    },
  );
  const [templates, setTemplates] = useState<TemplateResponse[]>([]);
  const [folders, setFolders] = useState<TemplateFolderResponse[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [query, setQuery] = useState(templateUrlState.q);
  const [folderName, setFolderName] = useState("");
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [createTemplateName, setCreateTemplateName] = useState("");
  const [createTemplateSource, setCreateTemplateSource] =
    useState<CreateTemplateSource>("upload");
  const [renameFolderName, setRenameFolderName] = useState("");
  const [renameTargetFolder, setRenameTargetFolder] =
    useState<TemplateFolderResponse | null>(null);
  const [moveTargetTemplate, setMoveTargetTemplate] =
    useState<TemplateResponse | null>(null);
  const [moveFolderName, setMoveFolderName] = useState("");
  const [cloneDialog, setCloneDialog] = useState<CloneDialogState | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [pendingFolderDelete, setPendingFolderDelete] =
    useState<PendingFolderDelete | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const isArchivedView = templateUrlState.archived;
  const dashboardView: DashboardView =
    templateUrlState.view === "submissions" ? "submissions" : "templates";
  const selectedFolder = templateUrlState.folder;
  const submittedQuery = templateUrlState.q;
  const visibleFolders = scopeFoldersToParent(folders, selectedFolder);
  const visibleTemplates = isArchivedView
    ? templates
    : scopeTemplatesToFolder(templates, selectedFolder, Boolean(submittedQuery));
  const moveFolderOptions = getMoveFolderOptions(selectedFolder, folders);

  useEffect(() => {
    void loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardView, isArchivedView, selectedFolder, submittedQuery]);

  useRealtimeEvents({
    onEvent: () => {
      void loadTemplates({ silent: true });
    },
    scope: "account",
  });

  useEffect(() => {
    listTeams("active")
      .then(setTeams)
      .catch(() => setTeams([]));
  }, []);

  async function loadTemplates(options: { silent?: boolean } = {}) {
    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    const loadParams = {
      dashboardView,
      isArchivedView,
      selectedFolder,
      submittedQuery,
    };

    if (!options.silent) {
      setIsLoading(true);
    }

    try {
      if (loadParams.dashboardView === "submissions") {
        const response = await listSubmissions({
          archived: loadParams.isArchivedView,
          limit: 100,
          q: loadParams.submittedQuery || undefined,
        });

        if (!isCurrentLoad(loadSequenceRef, loadSequence)) {
          return;
        }

        setSubmissions(response.data);
        setTemplates([]);
        setFolders([]);
        return;
      }

      const [response, folderResponse] = await Promise.all([
        listTemplates({
          archived: loadParams.isArchivedView,
          folder: loadParams.selectedFolder || undefined,
          limit: 100,
          q: loadParams.submittedQuery || undefined,
        }),
        loadParams.isArchivedView
          ? Promise.resolve([])
          : listTemplateFolders({
              parent: loadParams.selectedFolder || undefined,
              q: loadParams.submittedQuery || undefined,
            }),
      ]);

      if (!isCurrentLoad(loadSequenceRef, loadSequence)) {
        return;
      }

      setTemplates(
        loadParams.isArchivedView
          ? response.data
          : scopeTemplatesToFolder(
              response.data,
              loadParams.selectedFolder,
              Boolean(loadParams.submittedQuery),
            ),
      );
      setFolders(scopeFoldersToParent(folderResponse, loadParams.selectedFolder));
      setSubmissions([]);
    } catch (error) {
      if (!isCurrentLoad(loadSequenceRef, loadSequence)) {
        return;
      }

      if (error instanceof ApiError && error.status === 401) {
        router.push("/auth/login");
        return;
      }

      const message =
        error instanceof Error
          ? error.message
          : `${text.toasts.loadingFailed}.`;

      toast.error(text.toasts.loadingFailed, { description: message });
    } finally {
      if (isCurrentLoad(loadSequenceRef, loadSequence)) {
        setIsLoading(false);
      }
    }
  }

  async function uploadTemplate(file: File) {
    setIsUploading(true);
    toast.loading(text.toasts.uploadingDocument, {
      description: file.name,
      id: "template-upload",
    });

    try {
      const template = await createTemplateFromDocument(
        file,
        selectedFolder || undefined,
      );

      toast.success(text.toasts.documentUploaded, {
        description: text.toasts.openingEditor,
        id: "template-upload",
      });
      router.push(`/templates/${template.id}/edit`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `${text.toasts.uploadFailed}.`;

      toast.error(text.toasts.uploadFailed, {
        description: message,
        id: "template-upload",
      });
    } finally {
      setIsUploading(false);
    }
  }

  async function createBlankTemplate() {
    const name = createTemplateName.trim() || text.create.title;

    setIsCreatingTemplate(true);
    toast.loading(text.toasts.created, {
      description: name,
      id: "template-create",
    });

    try {
      const template = await createTemplate({
        folder_name: selectedFolder || undefined,
        name,
        shared_link: true,
      });

      toast.success(text.toasts.created, {
        description: text.toasts.openingEditor,
        id: "template-create",
      });
      setIsCreateDialogOpen(false);
      setCreateTemplateName("");
      router.push(`/templates/${template.id}/edit`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `${text.toasts.createFailed}.`;

      toast.error(text.toasts.createFailed, {
        description: message,
        id: "template-create",
      });
    } finally {
      setIsCreatingTemplate(false);
    }
  }

  async function createTemplateFromGoogleDrive() {
    setIsCreatingTemplate(true);
    toast.loading(text.toasts.openingDrive, {
      description: text.uploadDropzone.body,
      id: "template-create",
    });

    try {
      const picked = await pickGoogleDriveDocuments();

      if (picked.files.length === 0) {
        toast.info(text.toasts.driveNoFiles, { id: "template-create" });
        return;
      }

      const firstFileName = picked.files.at(0)?.name?.trim();
      const name =
        createTemplateName.trim() || firstFileName || text.create.title;
      const template = await createTemplate({
        folder_name: selectedFolder || undefined,
        name,
        shared_link: true,
      });

      await addTemplateGoogleDriveDocuments(template.id, {
        access_token: picked.accessToken,
        files: picked.files,
        merge: true,
      });

      toast.success(text.toasts.driveImported, {
        description: text.toasts.openingEditor,
        id: "template-create",
      });
      setIsCreateDialogOpen(false);
      setCreateTemplateName("");
      router.push(`/templates/${template.id}/edit`);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `${text.toasts.driveImportFailed}.`;

      toast.error(text.toasts.driveImportFailed, {
        description: message,
        id: "template-create",
      });
    } finally {
      setIsCreatingTemplate(false);
    }
  }

  function openMoveTemplateDialog(template: TemplateResponse) {
    setMoveTargetTemplate(template);
    setMoveFolderName(template.folder_name);
  }

  async function moveTemplate() {
    if (!moveTargetTemplate) {
      return;
    }

    const folderName = moveFolderName.trim() || text.folder.default;

    if (folderName === moveTargetTemplate.folder_name) {
      setMoveTargetTemplate(null);
      return;
    }

    try {
      await updateTemplate(moveTargetTemplate.id, { folder_name: folderName });
      toast.success(text.toasts.moved, { description: folderName });
      setMoveTargetTemplate(null);
      await loadTemplates();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `${text.toasts.moveFailed}.`;

      toast.error(text.toasts.moveFailed, { description: message });
    }
  }

  async function createFolder() {
    const name = folderName.trim();

    if (!name) {
      return;
    }

    try {
      await createTemplateFolder({
        name,
        parent: selectedFolder || undefined,
      });
      toast.success(text.toasts.folderCreated, { description: name });
      setFolderName("");
      setIsFolderDialogOpen(false);
      await loadTemplates();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `${text.toasts.folderCreateFailed}.`;

      toast.error(text.toasts.folderCreateFailed, { description: message });
    }
  }

  function openRenameFolderDialog(folder: TemplateFolderResponse) {
    setRenameTargetFolder(folder);
    setRenameFolderName(folder.name);
  }

  async function renameFolder() {
    if (!renameTargetFolder) {
      return;
    }

    const name = renameFolderName.trim();

    if (!name || name === renameTargetFolder.name) {
      setRenameTargetFolder(null);
      return;
    }

    try {
      const updatedFolder = await updateTemplateFolder(renameTargetFolder.id, {
        name,
      });

      toast.success(text.toasts.folderRenamed, {
        description: updatedFolder.full_name,
      });
      setRenameTargetFolder(null);

      if (selectedFolder === renameTargetFolder.full_name) {
        await setTemplateUrlState({ folder: updatedFolder.full_name });
        return;
      }

      await loadTemplates();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `${text.toasts.folderRenameFailed}.`;

      toast.error(text.toasts.folderRenameFailed, { description: message });
    }
  }

  async function deleteFolder(mode: DeleteTemplateFolderMode) {
    if (!pendingFolderDelete) {
      return;
    }

    const folder = pendingFolderDelete.folder;

    try {
      await deleteTemplateFolder(folder.id, mode);
      toast.success(text.toasts.folderDeleted, {
        description:
          mode === "with_contents"
            ? text.toasts.folderDeletedWithContents
            : text.toasts.folderOnlyDeleted,
      });
      setPendingFolderDelete(null);

      if (selectedFolder === folder.full_name) {
        await setTemplateUrlState({ folder: "" });
        return;
      }

      await loadTemplates();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `${text.toasts.folderDeleteFailed}.`;

      toast.error(text.toasts.folderDeleteFailed, { description: message });
    }
  }

  async function archiveSubmissionRow(submission: SubmissionResponse) {
    try {
      await archiveSubmission(submission.id);
      toast.success(text.toasts.submissionArchived, {
        description: submission.name ?? submission.template?.name ?? submission.id,
      });
      await loadTemplates();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `${text.toasts.submissionArchiveFailed}.`;

      toast.error(text.toasts.submissionArchiveFailed, { description: message });
    }
  }

  async function restoreTemplate(template: TemplateResponse) {
    try {
      await updateTemplate(template.id, { archived: false });
      toast.success(text.toasts.restored, { description: template.name });
      await loadTemplates();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `${text.toasts.restoreFailed}.`;

      toast.error(text.toasts.restoreFailed, { description: message });
    }
  }

  function openCloneTemplateDialog(template: TemplateResponse) {
    setCloneDialog({
      folderName: template.folder_name,
      name: `${template.name} (Clone)`,
      teamId: teams[0]?.id ?? "",
      template,
    });
  }

  async function duplicateTemplate() {
    if (!cloneDialog) {
      return;
    }

    const cloneName =
      cloneDialog.name.trim() || `${cloneDialog.template.name} (Clone)`;

    toast.loading(text.toasts.cloned, {
      description: cloneDialog.template.name,
      id: `template-clone-${cloneDialog.template.id}`,
    });

    try {
      const clonedTemplate = await cloneTemplate(cloneDialog.template.id, {
        folder_name: cloneDialog.folderName.trim() || text.folder.default,
        name: cloneName,
        team_id: cloneDialog.teamId || undefined,
      });

      toast.success(text.toasts.cloned, {
        description: clonedTemplate.name,
        id: `template-clone-${cloneDialog.template.id}`,
      });

      setCloneDialog(null);

      if (isArchivedView) {
        await setTemplateUrlState({ archived: false });
        return;
      }

      await loadTemplates();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `${text.toasts.cloneFailed}.`;

      toast.error(text.toasts.cloneFailed, {
        description: message,
        id: `template-clone-${cloneDialog.template.id}`,
      });
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) {
      return;
    }

    const { mode, template } = pendingDelete;

    try {
      if (mode === "delete") {
        await deleteTemplatePermanently(template.id);
        toast.success(text.toasts.templateDeleted, { description: template.name });
      } else {
        await archiveTemplate(template.id);
        toast.success(text.toasts.templateArchived, {
          description: template.name,
        });
      }

      setPendingDelete(null);
      await loadTemplates();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Template action failed.";

      toast.error(
        mode === "delete"
          ? text.toasts.deleteFailed
          : text.toasts.archiveFailed,
        { description: message },
      );
    }
  }

  return (
    <TooltipProvider>
      <main
        className="min-h-svh overflow-x-hidden bg-[var(--auth-background)] text-[var(--auth-foreground)]"
        id="main-content"
        tabIndex={-1}
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-4 md:px-2">
          <ConsoleHeader />

          <div>
            <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <DashboardViewToggle
                  onSelect={(view) => {
                    void setTemplateUrlState({
                      archived: false,
                      folder: view === "submissions" ? "" : selectedFolder,
                      view,
                    });
                  }}
                  value={dashboardView}
                />
                <h1 className="min-w-0 text-pretty text-[1.75rem] font-semibold leading-tight tracking-normal sm:text-[2rem]">
                  {getDashboardTitle(
                    dashboardView,
                    isArchivedView,
                    selectedFolder,
                    text,
                  )}
                </h1>
              </div>

              <div className="grid w-full grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center lg:w-auto lg:justify-end">
                <form
                  className="relative col-span-2 w-full sm:w-72"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void setTemplateUrlState({ q: query.trim() });
                  }}
                >
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--auth-label)]" />
                  <Input
                    aria-label={
                      dashboardView === "submissions"
                        ? text.search.submissions
                        : text.search.templates
                    }
                    className="h-10 rounded-full border-[var(--auth-input-border)] bg-card pl-9"
                    name="templates-search"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={
                      dashboardView === "submissions"
                        ? text.search.submissions
                        : text.search.templates
                    }
                    value={query}
                  />
                </form>
                <ToggleGroup
                  className="col-span-2 rounded-2xl bg-[var(--auth-muted)] p-1 sm:col-span-1"
                  onValueChange={(value) => {
                    if (value) {
                      void setTemplateUrlState({
                        archived: value === "archived",
                        folder: value === "archived" ? "" : selectedFolder,
                      });
                    }
                  }}
                  type="single"
                  value={isArchivedView ? "archived" : "active"}
                >
                  <ToggleGroupItem
                    aria-label={text.actions.active}
                    className="h-10 rounded-xl px-3 text-xs font-bold data-[state=on]:bg-card data-[state=on]:text-[var(--auth-primary)]"
                    value="active"
                  >
                    {text.actions.active}
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    aria-label={text.actions.archived}
                    className="h-10 rounded-xl px-3 text-xs font-bold data-[state=on]:bg-card data-[state=on]:text-[var(--auth-primary)]"
                    value="archived"
                  >
                    {text.actions.archived}
                  </ToggleGroupItem>
                </ToggleGroup>

                <input
                  accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="hidden"
                  disabled={isUploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];

                    if (file) {
                      void uploadTemplate(file);
                    }

                    event.target.value = "";
                  }}
                  ref={uploadInputRef}
                  type="file"
                />
                <Button
                  className="h-12 rounded-full px-4 text-sm font-bold text-[var(--auth-primary)] hover:bg-[var(--auth-muted)] hover:text-[var(--auth-primary-hover)] sm:px-6"
                  disabled={isUploading}
                  onClick={() => uploadInputRef.current?.click()}
                  type="button"
                  variant="ghost"
                >
                  {isUploading ? (
                    <Spinner />
                  ) : (
                    <UploadIcon data-icon="inline-start" />
                  )}
                  {text.actions.upload}
                </Button>
                {!isArchivedView && dashboardView === "templates" ? (
                  <Button
                    className="h-12 rounded-full px-4 text-sm font-bold text-[var(--auth-primary)] hover:bg-[var(--auth-muted)] hover:text-[var(--auth-primary-hover)] sm:px-6"
                    onClick={() => setIsFolderDialogOpen(true)}
                    type="button"
                    variant="ghost"
                  >
                    <FolderPlusIcon data-icon="inline-start" />
                    {text.actions.newFolder}
                  </Button>
                ) : null}
                <Button
                  className="h-12 rounded-full border-[var(--auth-primary)] bg-transparent px-4 text-sm font-bold text-[var(--auth-primary)] hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)] sm:px-6"
                  onClick={() => setIsCreateDialogOpen(true)}
                  type="button"
                  variant="outline"
                >
                  <PlusIcon data-icon="inline-start" />
                  {text.actions.create}
                </Button>
              </div>
            </section>

            <section className="mt-6 flex flex-col gap-8">
              {!isArchivedView && dashboardView === "templates" && selectedFolder ? (
                  <FolderBreadcrumbs
                  dictionary={dictionary}
                  folder={selectedFolder}
                  onSelect={(folder) => {
                    void setTemplateUrlState({ folder });
                  }}
                />
              ) : null}
              {isLoading ? (
                <TemplatesLoadingState />
              ) : dashboardView === "submissions" ? (
                submissions.length === 0 ? (
                  <DashboardEmptyState
                    isArchivedView={isArchivedView}
                    query={submittedQuery}
                    dictionary={dictionary}
                    view="submissions"
                  />
                ) : (
                  <div className="flex flex-col gap-3">
                    {submissions.map((submission) => (
                      <SubmissionListRow
                        key={submission.id}
                        onArchive={() => void archiveSubmissionRow(submission)}
                        dictionary={dictionary}
                        submission={submission}
                      />
                    ))}
                  </div>
                )
              ) : visibleTemplates.length === 0 && visibleFolders.length === 0 ? (
                <TemplatesEmptyState
                  folder={selectedFolder}
                  dictionary={dictionary}
                  isArchivedView={isArchivedView}
                  query={submittedQuery}
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {!isArchivedView
                        ? visibleFolders.map((folder) => (
                            <FolderCard
                              folder={folder}
                              dictionary={dictionary}
                              key={folder.id}
                              onDelete={() => setPendingFolderDelete({ folder })}
                              onRename={() => openRenameFolderDialog(folder)}
                              onOpen={() => {
                                void setTemplateUrlState({
                                  folder: folder.full_name,
                                });
                              }}
                            />
                          ))
                        : null}
                      {visibleTemplates.map((template) => (
                        <TemplateCard
                          isArchivedView={isArchivedView}
                          dictionary={dictionary}
                          key={template.id}
                          onArchive={() =>
                            setPendingDelete({ mode: "archive", template })
                          }
                          onClone={() => openCloneTemplateDialog(template)}
                          onDelete={() =>
                            setPendingDelete({ mode: "delete", template })
                          }
                          onMove={() => openMoveTemplateDialog(template)}
                          onRestore={() => void restoreTemplate(template)}
                          template={template}
                        />
                      ))}
                </div>
              )}

              {!isArchivedView && (
                <TemplateUploadDropzone
                  folderName={selectedFolder || undefined}
                />
              )}
            </section>
          </div>
        </div>
      </main>

      <Dialog
        onOpenChange={(open) => {
          setIsCreateDialogOpen(open);

          if (!open) {
            setCreateTemplateName("");
            setCreateTemplateSource("upload");
          }
        }}
        open={isCreateDialogOpen}
      >
        <DialogContent className="gap-0 overflow-hidden border-[var(--auth-input-border)] bg-[var(--auth-background)] p-0 text-[var(--auth-foreground)] sm:max-w-[590px]">
          <DialogHeader className="border-b border-[var(--auth-input-border)] px-5 py-4 text-left">
            <DialogTitle>{text.create.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-5 py-4">
            <CreateTemplateSourceTabs
              source={createTemplateSource}
              dictionary={dictionary}
              onSourceChange={setCreateTemplateSource}
            />
            {createTemplateSource === "upload" ? (
              <>
                <Input
                  autoFocus
                  className="h-12 rounded-full border-[var(--auth-input-border)] bg-card px-5 text-base shadow-none focus-visible:ring-0"
                  onChange={(event) => setCreateTemplateName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void createBlankTemplate();
                    }
                  }}
                  placeholder={text.create.documentName}
                  value={createTemplateName}
                />
                <div className="flex items-center justify-between gap-4 text-base">
                  <div className="flex min-w-0 items-center gap-2">
                    <FolderIcon className="size-5 shrink-0" />
                    <span className="truncate">
                      {selectedFolder || text.folder.default}
                    </span>
                  </div>
                  <button
                    className="shrink-0 text-[var(--auth-primary)] underline underline-offset-2 hover:text-[var(--auth-primary-hover)]"
                    onClick={() => {
                      setIsCreateDialogOpen(false);
                      setIsFolderDialogOpen(true);
                    }}
                    type="button"
                  >
                    {text.actions.changeFolder}
                  </button>
                </div>
              </>
            ) : (
              <Button
                className="h-12 w-full rounded-full border-[var(--auth-primary)] bg-transparent px-5 text-sm font-bold text-[var(--auth-primary)] hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)]"
                disabled={isCreatingTemplate}
                onClick={() => void createTemplateFromGoogleDrive()}
                type="button"
                variant="outline"
              >
                {isCreatingTemplate ? <Spinner className="size-4" /> : null}
                <Image
                  alt=""
                  className="size-6"
                  height={24}
                  src="/images/drive-logo.png"
                  width={24}
                />
                {text.actions.addFromGoogleDrive}
              </Button>
            )}
          </div>
          {createTemplateSource === "upload" ? (
            <DialogFooter className="px-5 pb-5 sm:justify-stretch">
              <Button
                className="h-12 w-full rounded-full bg-[var(--auth-primary)] font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
                disabled={isCreatingTemplate}
                onClick={() => void createBlankTemplate()}
                type="button"
              >
                {isCreatingTemplate ? <Spinner className="size-4" /> : null}
                {text.actions.create}
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          setIsFolderDialogOpen(open);

          if (!open) {
            setFolderName("");
          }
        }}
        open={isFolderDialogOpen}
      >
        <DialogContent className="border-[var(--auth-input-border)] bg-[var(--auth-background)] text-[var(--auth-foreground)]">
          <DialogHeader>
            <DialogTitle>{text.dialogs.createFolderTitle}</DialogTitle>
            <DialogDescription>
              {selectedFolder
                ? interpolate(text.dialogs.createFolderInside, {
                    folder: selectedFolder,
                  })
                : text.dialogs.createFolderDescription}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            className="h-12 rounded-full border-[var(--auth-input-border)] bg-card px-5"
            onChange={(event) => setFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void createFolder();
              }
            }}
            placeholder={text.folder.namePlaceholder}
            value={folderName}
          />
          <DialogFooter>
            <Button
              className="h-11 rounded-full px-6"
              onClick={() => setIsFolderDialogOpen(false)}
              type="button"
              variant="ghost"
            >
              {text.actions.cancel}
            </Button>
            <Button
              className="h-11 rounded-full bg-[var(--auth-primary)] px-7 font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
              disabled={!folderName.trim()}
              onClick={() => void createFolder()}
              type="button"
            >
              {text.actions.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setRenameTargetFolder(null);
            setRenameFolderName("");
          }
        }}
        open={Boolean(renameTargetFolder)}
      >
        <DialogContent className="border-[var(--auth-input-border)] bg-[var(--auth-background)] text-[var(--auth-foreground)]">
          <DialogHeader>
            <DialogTitle>{text.dialogs.renameFolderTitle}</DialogTitle>
            <DialogDescription>
              {interpolate(text.dialogs.renameFolderDescription, {
                folder: renameTargetFolder?.full_name ?? text.folder.folders,
              })}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            className="h-12 rounded-full border-[var(--auth-input-border)] bg-card px-5"
            onChange={(event) => setRenameFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void renameFolder();
              }
            }}
            placeholder={text.folder.namePlaceholder}
            value={renameFolderName}
          />
          <DialogFooter>
            <Button
              className="h-11 rounded-full px-6"
              onClick={() => setRenameTargetFolder(null)}
              type="button"
              variant="ghost"
            >
              {text.actions.cancel}
            </Button>
            <Button
              className="h-11 rounded-full bg-[var(--auth-primary)] px-7 font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
              disabled={!renameFolderName.trim()}
              onClick={() => void renameFolder()}
              type="button"
            >
              {text.actions.rename}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setMoveTargetTemplate(null);
          }
        }}
        open={Boolean(moveTargetTemplate)}
      >
        <DialogContent className="border-[var(--auth-input-border)] bg-[var(--auth-background)] text-[var(--auth-foreground)]">
          <DialogHeader>
            <DialogTitle>{text.dialogs.moveTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Combobox
              inputValue={moveFolderName}
              items={moveFolderOptions}
              onInputValueChange={setMoveFolderName}
              onValueChange={(value) => {
                if (typeof value === "string") {
                  setMoveFolderName(value);
                }
              }}
              value={moveFolderName}
            >
              <ComboboxInput
                autoFocus
                className="h-12 w-full rounded-full border-[var(--auth-input-border)] bg-card px-5"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void moveTemplate();
                  }
                }}
                placeholder={text.folder.newNamePlaceholder}
                showTrigger
              />
              <ComboboxContent>
                <ComboboxList>
                  {moveFolderOptions.length > 0 ? (
                    <ComboboxGroup>
                      <ComboboxLabel>{text.folder.folders}</ComboboxLabel>
                      {moveFolderOptions.map((folder) => (
                        <ComboboxItem key={folder} value={folder}>
                          {folder}
                        </ComboboxItem>
                      ))}
                    </ComboboxGroup>
                  ) : (
                    <ComboboxEmpty>{text.folder.noFoldersFound}</ComboboxEmpty>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
          <DialogFooter className="sm:block">
            <Button
              className="h-12 w-full rounded-full bg-[var(--auth-primary)] px-7 font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
              onClick={() => void moveTemplate()}
              type="button"
            >
              {text.actions.moveSubmit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setCloneDialog(null);
          }
        }}
        open={Boolean(cloneDialog)}
      >
        <DialogContent className="border-[var(--auth-input-border)] bg-[var(--auth-background)] text-[var(--auth-foreground)]">
          <DialogHeader>
            <DialogTitle>{text.dialogs.cloneTitle}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Select
              onValueChange={(teamId) =>
                setCloneDialog((current) =>
                  current ? { ...current, teamId } : current,
                )
              }
              value={cloneDialog?.teamId}
            >
              <SelectTrigger className="!h-12 min-h-12 w-full rounded-full border-[var(--auth-input-border)] bg-card px-5">
                <SelectValue placeholder={text.dialogs.selectTeamAccount} />
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="h-12 rounded-full border-[var(--auth-input-border)] bg-card px-5"
              onChange={(event) =>
                setCloneDialog((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
              value={cloneDialog?.name ?? ""}
            />
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="inline-flex min-w-0 items-center gap-2">
                <FolderIcon data-icon="inline-start" />
                <span className="truncate">
                  {cloneDialog?.folderName || text.folder.default}
                </span>
              </span>
              <Combobox
                inputValue={cloneDialog?.folderName ?? ""}
                items={moveFolderOptions}
                onInputValueChange={(folderName) =>
                  setCloneDialog((current) =>
                    current ? { ...current, folderName } : current,
                  )
                }
                onValueChange={(folderName) => {
                  if (typeof folderName === "string") {
                    setCloneDialog((current) =>
                      current ? { ...current, folderName } : current,
                    );
                  }
                }}
                value={cloneDialog?.folderName ?? ""}
              >
                <ComboboxInput
                  className="h-9 w-40 rounded-full border-[var(--auth-input-border)] bg-card px-4"
                  placeholder={text.actions.changeFolder}
                  showTrigger
                />
                <ComboboxContent>
                  <ComboboxList>
                    {moveFolderOptions.length > 0 ? (
                      <ComboboxGroup>
                        <ComboboxLabel>{text.folder.folders}</ComboboxLabel>
                        {moveFolderOptions.map((folder) => (
                          <ComboboxItem key={folder} value={folder}>
                            {folder}
                          </ComboboxItem>
                        ))}
                      </ComboboxGroup>
                    ) : (
                      <ComboboxEmpty>{text.folder.noFoldersFound}</ComboboxEmpty>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>
          </div>
          <DialogFooter className="sm:block">
            <Button
              className="h-12 w-full rounded-full bg-[var(--auth-primary)] px-7 font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
              disabled={!cloneDialog?.name.trim()}
              onClick={() => void duplicateTemplate()}
              type="button"
            >
              {text.actions.submit}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingFolderDelete(null);
          }
        }}
        open={Boolean(pendingFolderDelete)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{text.dialogs.deleteFolderTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {text.dialogs.deleteFolderDescription}
          </AlertDialogDescription>
          <AlertDialogFooter className="sm:grid sm:grid-cols-2">
            <AlertDialogCancel>{text.actions.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void deleteFolder("folder_only");
              }}
            >
              {text.actions.deleteFolderOnly}
            </AlertDialogAction>
            <AlertDialogAction
              className="sm:col-span-2"
              onClick={(event) => {
                event.preventDefault();
                void deleteFolder("with_contents");
              }}
              variant="destructive"
            >
              {text.actions.deleteFolderAndDocuments}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
        open={Boolean(pendingDelete)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {pendingDelete?.mode === "delete"
              ? `${text.actions.delete} ${text.folder.templates.toLowerCase()}?`
              : `${text.actions.archive} ${text.folder.templates.toLowerCase()}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDelete?.mode === "delete"
              ? text.toasts.deleteFailed
              : text.empty.archivedTemplates}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>{text.actions.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
              variant={
                pendingDelete?.mode === "delete" ? "destructive" : "default"
              }
            >
              {pendingDelete?.mode === "delete"
                ? text.actions.delete
                : text.actions.archive}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}

function TemplatesPageFallback() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-[var(--auth-background)] text-[var(--auth-foreground)]" id="main-content" tabIndex={-1}>
      <div className="flex items-center gap-3 text-sm font-semibold">
        <Spinner />
        Loading templates
      </div>
    </main>
  );
}

function DashboardViewToggle({
  onSelect,
  value,
}: {
  onSelect: (view: DashboardView) => void;
  value: DashboardView;
}) {
  return (
    <div className="flex items-center rounded-2xl bg-[var(--auth-muted)] p-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Templates"
            className={cn(
              "h-10 w-10 rounded-xl p-0",
              value === "templates"
                ? "bg-[var(--auth-primary)] text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
                : "bg-transparent text-[var(--auth-primary)] hover:bg-card",
            )}
            onClick={() => onSelect("templates")}
            type="button"
            variant="ghost"
          >
            <Grid3X3Icon className="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Templates</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Submissions"
            className={cn(
              "h-10 w-10 rounded-xl p-0",
              value === "submissions"
                ? "bg-[var(--auth-primary)] text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
                : "bg-transparent text-[var(--auth-primary)] hover:bg-card",
            )}
            onClick={() => onSelect("submissions")}
            type="button"
            variant="ghost"
          >
            <ListIcon className="size-5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Submissions</TooltipContent>
      </Tooltip>
    </div>
  );
}

function FolderBreadcrumbs({
  dictionary,
  folder,
  onSelect,
}: {
  dictionary: AppDictionary;
  folder: string;
  onSelect: (folder: string) => void;
}) {
  const text = dictionary.templates;
  const segments = getFolderSegments(folder);

  return (
    <nav className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--auth-label)]">
      <button
        className="rounded-full px-3 py-1.5 transition-colors hover:bg-[var(--auth-muted)] hover:text-[var(--auth-primary)]"
        onClick={() => onSelect("")}
        type="button"
      >
        {text.folder.templates}
      </button>
      {segments.map((segment, index) => (
        <span className="flex items-center gap-2" key={getFolderPath(segments, index)}>
          <ChevronRightIcon className="size-4" />
          <button
            className="rounded-full px-3 py-1.5 transition-colors hover:bg-[var(--auth-muted)] hover:text-[var(--auth-primary)]"
            onClick={() => onSelect(getFolderPath(segments, index))}
            type="button"
          >
            {segment}
          </button>
        </span>
      ))}
    </nav>
  );
}

function FolderCard({
  dictionary,
  folder,
  onDelete,
  onOpen,
  onRename,
}: {
  dictionary: AppDictionary;
  folder: TemplateFolderResponse;
  onDelete: () => void;
  onOpen: () => void;
  onRename: () => void;
}) {
  const text = dictionary.templates;

  return (
    <article className="group relative h-36 overflow-hidden rounded-2xl bg-[var(--auth-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--auth-muted),var(--auth-primary)_6%)]">
      <button
        className="flex h-full w-full flex-col justify-between px-7 pb-6 pt-6 text-left"
        onClick={onOpen}
        type="button"
      >
        <span className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-card text-[var(--auth-primary)] shadow-sm">
            <FolderIcon className="size-5 fill-current/10" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xl font-semibold leading-tight tracking-normal">
              {folder.name}
            </span>
            <span className="mt-1 block text-xs text-[var(--auth-label)]">
              {folder.full_name}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-3 text-xs font-semibold text-[var(--auth-label)]">
          <span>
            {interpolate(text.folder.templatesCount, {
              count: String(folder.templates_count),
            })}
          </span>
          <span className="size-1 rounded-full bg-current opacity-40" />
          <span>
            {interpolate(text.folder.foldersCount, {
              count: String(folder.subfolders_count),
            })}
          </span>
        </span>
      </button>
      <div className="absolute right-4 top-4 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Folder actions"
              className="rounded-full bg-card text-[var(--auth-primary)] shadow-sm hover:bg-[var(--auth-background)]"
              onClick={(event) => event.stopPropagation()}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <MoreVerticalIcon data-icon="inline-start" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onRename}>
                <PencilIcon data-icon="inline-start" />
                {text.actions.rename}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDelete} variant="destructive">
                <Trash2Icon data-icon="inline-start" />
                {text.actions.delete}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

function SubmissionListRow({
  dictionary,
  onArchive,
  submission,
}: {
  dictionary: AppDictionary;
  onArchive: () => void;
  submission: SubmissionResponse;
}) {
  const submitter = submission.submitters[0] ?? null;
  const title =
    submission.name ?? submission.template?.name ?? `Submission ${submission.id}`;
  const signer =
    submitter?.name ?? submitter?.email ?? submitter?.phone ?? "Recipient";

  return (
    <article className="flex min-h-[86px] flex-col overflow-hidden rounded-2xl bg-[var(--auth-muted)] sm:flex-row">
      <Link
        className="flex w-full shrink-0 flex-col justify-center gap-2 bg-[color-mix(in_srgb,var(--auth-muted),var(--auth-primary)_5%)] px-5 py-3 hover:bg-[color-mix(in_srgb,var(--auth-muted),var(--auth-primary)_8%)] sm:w-60"
        href={submission.template ? `/templates/${submission.template.id}` : `/submissions/${submission.id}`}
      >
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <FileTextIcon data-icon="inline-start" />
          <span className="truncate">{title}</span>
        </h2>
        <div className="flex flex-col gap-1 text-xs text-[var(--auth-label)]">
          <span className="flex items-center gap-1.5">
            <UserRoundIcon className="size-4" />
            <span className="truncate">
              {getSubmissionAuthor(submission)}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <CalendarDaysIcon className="size-4" />
            <span>{formatTemplateDate(submission.created_at)}</span>
          </span>
        </div>
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6 sm:py-3">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <SubmissionStatusBadge dictionary={dictionary} submission={submission} />
          <Link
            className="truncate text-lg hover:text-[var(--auth-primary)] hover:underline"
            href={`/submissions/${submission.id}`}
          >
            {signer}
          </Link>
        </div>

        <SubmissionRowActions
          dictionary={dictionary}
          onArchive={onArchive}
          submission={submission}
        />
      </div>
    </article>
  );
}

function SubmissionRowActions({
  dictionary,
  onArchive,
  submission,
}: {
  dictionary: AppDictionary;
  onArchive: () => void;
  submission: SubmissionResponse;
}) {
  const text = dictionary.templates;
  const submitter = submission.submitters[0] ?? null;
  const canSign =
    submitter &&
    submission.status === "pending" &&
    !submission.archived_at &&
    !submitter.completed_at &&
    !submitter.declined_at;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {canSign ? (
        <SubmissionSignButton label={text.actions.signNow} slug={submitter.slug} />
      ) : null}
      {!canSign && submission.status === "completed" ? (
        <SubmissionDownloadButton id={submission.id} label={text.actions.download} />
      ) : null}
      <Button
        className="h-8 rounded-full border-[var(--auth-primary)] px-5 text-sm font-bold text-[var(--auth-primary)] hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)]"
        asChild
        type="button"
        variant="outline"
      >
        <Link href={`/submissions/${submission.id}`}>{text.actions.view}</Link>
      </Button>
      {!submission.archived_at ? (
        <Button
          aria-label={text.actions.archive}
          className="rounded-full border-[var(--auth-primary)] text-[var(--auth-primary)] hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)]"
          onClick={onArchive}
          size="icon-sm"
          type="button"
          variant="outline"
        >
          <ArchiveIcon data-icon="inline-start" />
        </Button>
      ) : null}
    </div>
  );
}

function SubmissionSignButton({ label, slug }: { label: string; slug: string }) {
  return (
    <Button
      className="h-8 rounded-full border-[var(--auth-primary)] px-5 text-sm font-bold text-[var(--auth-primary)] hover:bg-[var(--auth-primary)] hover:text-[var(--auth-primary-foreground)]"
      asChild
      type="button"
      variant="outline"
    >
      <Link href={`/s/${slug}`} target="_blank">
        <SignatureIcon data-icon="inline-start" />
        {label}
      </Link>
    </Button>
  );
}

function SubmissionDownloadButton({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  return (
    <Button
      className="h-8 rounded-full bg-[var(--auth-primary)] px-5 text-sm font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
      asChild
      type="button"
    >
      <Link href={`/submissions/${id}`}>
        <DownloadIcon data-icon="inline-start" />
        {label}
      </Link>
    </Button>
  );
}

function SubmissionStatusBadge({
  dictionary,
  submission,
}: {
  dictionary: AppDictionary;
  submission: SubmissionResponse;
}) {
  const badge = getSubmissionStatusBadge(submission, dictionary);

  return (
    <span
      className={cn(
        "rounded-full px-6 py-1 text-xs font-bold uppercase",
        badge.className,
      )}
    >
      {badge.label}
    </span>
  );
}

function TemplateCard({
  dictionary,
  isArchivedView,
  onArchive,
  onClone,
  onDelete,
  onMove,
  onRestore,
  template,
}: TemplateActionProps) {
  const text = dictionary.templates;

  return (
    <article className="group relative h-36">
      <Link
        className="flex h-full flex-col justify-between rounded-2xl bg-[var(--auth-muted)] px-7 pb-6 pt-6 transition-colors before:absolute before:inset-0 before:hidden before:rounded-2xl before:border-2 before:border-dashed before:border-[var(--auth-input-border)] hover:bg-[color-mix(in_srgb,var(--auth-muted),var(--auth-primary)_4%)]"
        href={`/templates/${template.id}`}
      >
        <h2 className="line-clamp-2 text-xl font-semibold leading-[1.6rem] tracking-normal">
          {template.name}
        </h2>
        <TemplateMetadata template={template} />
      </Link>

      <div className="absolute bottom-3 right-3 flex items-end md:bottom-0 md:right-9 md:top-0 md:hidden md:w-0 md:items-center md:group-hover:flex md:group-focus-within:flex">
        <div className="flex flex-col gap-1">
          {isArchivedView ? (
            <>
              <TemplateActionButton
                icon={RotateCcwIcon}
                label={text.actions.restore}
                onClick={onRestore}
              />
              <TemplateActionButton
                destructive
                icon={Trash2Icon}
                label={text.actions.delete}
                onClick={onDelete}
              />
            </>
          ) : (
            <>
              <TemplateActionButton
                icon={FolderInputIcon}
                label={text.actions.move}
                onClick={onMove}
              />
              <TemplateActionButton
                href={`/templates/${template.id}/edit`}
                icon={PencilIcon}
                label={text.actions.edit}
              />
              <TemplateActionButton
                icon={CopyIcon}
                label={text.actions.clone}
                onClick={onClone}
              />
              <TemplateActionButton
                icon={ArchiveIcon}
                label={text.actions.archive}
                onClick={onArchive}
              />
            </>
          )}
        </div>
      </div>
    </article>
  );
}

type TemplateActionProps = {
  dictionary: AppDictionary;
  isArchivedView: boolean;
  onArchive: () => void;
  onClone: () => void;
  onDelete: () => void;
  onMove: () => void;
  onRestore: () => void;
  template: TemplateResponse;
};

function TemplateMetadata({
  compact,
  template,
}: {
  compact?: boolean;
  template: TemplateResponse;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs text-[var(--auth-label)]">
      <span className="flex items-center gap-1.5">
        <UserRoundIcon className="size-4" />
        <span className="truncate">{getAuthorName(template)}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <CalendarDaysIcon className="size-4" />
        <span>{formatTemplateDate(template.created_at)}</span>
        {!compact && template.archived_at ? (
          <span className="ml-2 rounded-full bg-[var(--auth-label)]/15 px-2 py-0.5 text-[10px] font-bold uppercase">
            Archived
          </span>
        ) : null}
      </span>
    </div>
  );
}

function TemplateActionButton({
  destructive,
  href,
  icon: Icon,
  label,
  onClick,
}: {
  destructive?: boolean;
  href?: string;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
}) {
  const className = cn(
    "rounded-full border-transparent bg-[var(--auth-muted)] shadow-sm hover:border-[var(--auth-primary)] hover:bg-card",
    destructive ? "text-destructive" : "text-[var(--auth-primary)]",
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <Button
            aria-label={label}
            asChild
            className={className}
            size="icon-xs"
            variant="outline"
          >
            <Link href={href}>
              <Icon data-icon="inline-start" />
            </Link>
          </Button>
        ) : (
          <Button
            aria-label={label}
            className={className}
            onClick={onClick}
            size="icon-xs"
            type="button"
            variant="outline"
          >
            <Icon data-icon="inline-start" />
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  );
}

function TemplatesLoadingState() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          className="flex h-36 animate-pulse flex-col justify-between rounded-2xl bg-[var(--auth-muted)] px-7 pb-6 pt-6"
          key={index}
        >
          <div className="h-5 w-3/4 rounded bg-[var(--auth-label)]/20" />
          <div className="space-y-2">
            <div className="h-3 w-1/2 rounded bg-[var(--auth-label)]/15" />
            <div className="h-3 w-1/3 rounded bg-[var(--auth-label)]/15" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TemplatesEmptyState({
  dictionary,
  folder,
  isArchivedView,
  query,
}: {
  dictionary: AppDictionary;
  folder: string;
  isArchivedView: boolean;
  query: string;
}) {
  const text = dictionary.templates;

  return (
    <div className="rounded-2xl border border-dashed border-[var(--auth-input-border)] px-6 py-12 text-center">
      <p className="text-2xl font-semibold">
        {query
          ? text.empty.templatesNotFound
          : isArchivedView
            ? text.empty.archivedTemplates
            : folder
              ? text.empty.folderEmpty
              : text.empty.noTemplates}
      </p>
      <p className="mt-2 text-sm text-[var(--auth-label)]">
        {isArchivedView
          ? text.empty.archivedTemplates
          : folder
            ? text.empty.folderEmptyDescription
            : text.empty.noTemplatesDescription}
      </p>
    </div>
  );
}

function DashboardEmptyState({
  dictionary,
  isArchivedView,
  query,
  view,
}: {
  dictionary: AppDictionary;
  isArchivedView: boolean;
  query: string;
  view: DashboardView;
}) {
  const text = dictionary.templates;

  return (
    <div className="rounded-2xl border border-dashed border-[var(--auth-input-border)] px-6 py-12 text-center">
      <p className="text-2xl font-semibold">
        {query
          ? view === "submissions"
            ? text.empty.submissionsNotFound
            : text.empty.templatesNotFound
          : isArchivedView
            ? view === "submissions"
              ? text.empty.archivedSubmissions
              : text.empty.archivedTemplates
            : view === "submissions"
              ? text.empty.noSubmissions
              : text.empty.noTemplates}
      </p>
      <p className="mt-2 text-sm text-[var(--auth-label)]">
        {view === "submissions"
          ? text.empty.noSubmissionsDescription
          : text.empty.noTemplatesDescription}
      </p>
    </div>
  );
}

function getDashboardTitle(
  view: DashboardView,
  isArchivedView: boolean,
  folder: string,
  text: AppDictionary["templates"],
): string {
  if (view === "submissions") {
    return isArchivedView
      ? text.titles.archivedSubmissions
      : text.titles.submissions;
  }

  return isArchivedView ? text.titles.archivedTemplates : getFolderTitle(folder, text);
}

function getFolderTitle(
  folder: string,
  text: AppDictionary["templates"],
): string {
  return getFolderSegments(folder).at(-1) ?? text.titles.documentTemplates;
}

function getFolderSegments(folder: string): string[] {
  return folder
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function getFolderPath(segments: string[], index: number): string {
  return segments.slice(0, index + 1).join(" / ");
}

function scopeFoldersToParent(
  folders: TemplateFolderResponse[],
  selectedFolder: string,
): TemplateFolderResponse[] {
  const parentSegments = getFolderSegments(selectedFolder);

  if (parentSegments.length === 0) {
    return folders.filter((folder) => getFolderSegments(folder.full_name).length === 1);
  }

  return folders.filter((folder) => {
    const folderSegments = getFolderSegments(folder.full_name);

    if (folderSegments.length !== parentSegments.length + 1) {
      return false;
    }

    return parentSegments.every(
      (segment, index) => folderSegments[index] === segment,
    );
  });
}

function scopeTemplatesToFolder(
  templates: TemplateResponse[],
  selectedFolder: string,
  includeDescendants: boolean,
): TemplateResponse[] {
  const selectedSegments = getFolderSegments(selectedFolder || "Default");

  return templates.filter((template) => {
    const folderSegments = getFolderSegments(template.folder_name);

    if (!includeDescendants) {
      return areFolderSegmentsEqual(folderSegments, selectedSegments);
    }

    return selectedSegments.every(
      (segment, index) => folderSegments[index] === segment,
    );
  });
}

function areFolderSegmentsEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === right[index])
  );
}

function isCurrentLoad(
  loadSequenceRef: { current: number },
  loadSequence: number,
): boolean {
  return loadSequenceRef.current === loadSequence;
}

function getMoveFolderOptions(
  selectedFolder: string,
  folders: TemplateFolderResponse[],
): string[] {
  return Array.from(
    new Set(
      ["Default", selectedFolder, ...folders.map((folder) => folder.full_name)]
        .map((folder) => folder.trim())
        .filter(Boolean),
    ),
  );
}

function CreateTemplateSourceTabs({
  dictionary,
  onSourceChange,
  source,
}: {
  dictionary: AppDictionary;
  onSourceChange: (source: CreateTemplateSource) => void;
  source: CreateTemplateSource;
}) {
  const text = dictionary.templates;
  const items: Array<{
    icon: React.ReactNode;
    label: string;
    value: CreateTemplateSource;
  }> = [
    {
      icon: <UploadIcon className="size-4" />,
      label: text.create.upload,
      value: "upload",
    },
    {
      icon: (
        <Image
          alt=""
          className="size-5"
          height={20}
          src="/images/drive-logo.png"
          width={20}
        />
      ),
      label: text.create.googleDrive,
      value: "drive",
    },
  ];

  return (
    <div className="mx-auto grid h-8 w-fit min-w-72 grid-cols-2 overflow-hidden rounded-full bg-[var(--auth-muted)]">
      {items.map((item) => (
        <button
          className={cn(
            "flex h-8 min-w-36 items-center justify-center gap-2 rounded-full px-5 text-sm font-bold transition-colors",
            source === item.value
              ? "bg-[var(--auth-background)] text-[var(--auth-primary)] shadow-sm"
              : "text-[var(--auth-muted-foreground)] hover:text-[var(--auth-primary)]",
          )}
          key={item.value}
          onClick={() => onSourceChange(item.value)}
          type="button"
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

function getAuthorName(template: TemplateResponse): string {
  const name = [template.author.first_name, template.author.last_name]
    .filter(Boolean)
    .join(" ");

  return name || template.author.email;
}

function formatTemplateDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function getSubmissionAuthor(submission: SubmissionResponse): string {
  const user = submission.created_by_user;
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ");

  return name || user?.email || submission.template?.name || "Unknown";
}

function getSubmissionStatusBadge(
  submission: SubmissionResponse,
  dictionary: AppDictionary,
): {
  className: string;
  label: string;
} {
  const text = dictionary.templates;

  if (submission.archived_at) {
    return {
      className: "bg-[var(--auth-label)]/20 text-[var(--auth-primary)]",
      label: text.status.archived,
    };
  }

  if (submission.status === "completed") {
    return {
      className:
        "bg-[var(--status-success)] text-[var(--status-success-foreground)]",
      label: text.status.completed,
    };
  }

  if (submission.status === "declined") {
    return {
      className: "bg-destructive/15 text-destructive",
      label: text.status.declined,
    };
  }

  if (submission.status === "expired") {
    return {
      className: "bg-destructive/15 text-destructive",
      label: text.status.expired,
    };
  }

  const firstSubmitter = submission.submitters[0];
  const opened = firstSubmitter?.opened_at;

  return {
    className: "bg-[var(--auth-upgrade)] text-[var(--auth-primary)]",
    label: opened ? text.status.opened : text.status.pending,
  };
}

function interpolate(
  value: string,
  replacements: Record<string, string>,
): string {
  return Object.entries(replacements).reduce(
    (current, [key, replacement]) =>
      current.replaceAll(`{${key}}`, replacement),
    value,
  );
}

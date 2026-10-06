"use client";

import { BrandLogo } from "@/components/branding/brand-logo";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  DownloadIcon,
  EyeIcon,
  PenLineIcon,
  PencilIcon,
  Redo2Icon,
  SaveIcon,
  SlidersHorizontalIcon,
  Undo2Icon,
  UserRoundPlusIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PendingImportedFieldsBanner } from "./_components/pending-imported-fields-banner";
import { TemplateCanvas } from "./_components/canvas/template-canvas";
import { TemplateDocumentsPanel } from "./_components/documents/template-documents-panel";
import { TemplateFieldsPanel } from "./_components/fields/template-fields-panel";
import { TemplateSendRecipientsDialog } from "./_components/send/template-send-recipients-dialog";
import { useTemplateEditorController } from "./_hooks/use-template-editor-controller";
import { TemplatePreferencesDialog } from "./template-preferences-dialog";

export function TemplateEditor() {
  const editor = useTemplateEditorController();
  const [isRecipientsOpen, setIsRecipientsOpen] = useState(false);

  if (!editor.isLoaded) {
    return (
      <TemplateEditorStatus
        error={editor.error}
        onBack={editor.goBackToTemplates}
      />
    );
  }

  const {
    activeFieldType,
    addBlankPage,
    addCustomFieldWithoutDrawing,
    addDocument,
    addDroppedField,
    addFieldWithoutDrawing,
    addGoogleDriveDocuments,
    addSubmitter,
    canRedo,
    canUndo,
    copyFieldToAllPages,
    copySelectedFields,
    currentFields,
    currentSubmitters,
    customFields,
    createField,
    currentTemplate,
    deleteField,
    deleteSelectedFields,
    downloadTemplateDocuments,
    editingDocumentUuid,
    goToFieldArea,
    goToFieldPage,
    isDownloadingTemplateDocuments,
    isOpeningSelfSign,
    isPreferencesOpen,
    isSavingFields,
    isSavingPreferences,
    isUpdatingSharedLink,
    isUploadingDocument,
    moveDocument,
    moveFieldInOrder,
    moveFieldToIndex,
    nudgeSelectedFields,
    openSelfSigningForm,
    pasteCopiedFields,
    pendingFieldAttachmentUuids,
    removeDocument,
    removeSubmitter,
    renameDocument,
    renameSubmitter,
    renameTemplate,
    replaceDocument,
    reorderDocumentFields,
    resolvePendingImportedFields,
    redoTemplateChange,
    saveTemplateDraft,
    saveFieldAsCustomField,
    saveTemplatePreferences,
    selectField,
    selectedDocument,
    selectedFieldUuid,
    selectedFieldUuids,
    selectedSubmitter,
    setActiveFieldType,
    setEditingDocumentUuid,
    setIsPreferencesOpen,
    setSelectedDocumentUuid,
    setSelectedSubmitterUuid,
    startDrawNewArea,
    updateField,
    updateFieldAndTemplate,
    updateFieldArea,
    updateDocumentConditions,
    updateTemplateSharedLink,
    updateTemplateTestingShare,
    undoTemplateChange,
  } = editor;

  function openRecipientsDialog() {
    if (currentSubmitters.length <= 1) {
      toast.error("Add another party before sending", {
        description:
          "Party one is reserved for self-signing. Add a second party to send this template to recipients.",
      });
      return;
    }

    setIsRecipientsOpen(true);
  }

  return (
    <main
      className="flex h-svh flex-col overflow-hidden bg-[var(--auth-background)] text-[var(--auth-foreground)]"
      id="main-content"
      tabIndex={-1}
    >
      {pendingFieldAttachmentUuids.length > 0 ? (
        <PendingImportedFieldsBanner
          isSaving={isSavingFields}
          onKeep={() => void resolvePendingImportedFields("keep")}
          onRemove={() => void resolvePendingImportedFields("remove")}
        />
      ) : null}
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-3 py-2 sm:px-4 lg:flex-nowrap">
        <div className="flex min-w-0 basis-full items-center gap-3 lg:flex-1 lg:basis-auto">
          <Button asChild variant="ghost" size="icon" className="size-10">
            <Link
              aria-label="Back to templates"
              title="Back to templates"
              href="/templates"
            >
              <ArrowLeftIcon className="size-5" />
            </Link>
          </Button>
          <BrandLogo className="hidden max-w-40 shrink-0 lg:inline-flex xl:max-w-56" />
          <span
            aria-hidden="true"
            className="hidden h-8 w-px shrink-0 bg-border lg:block"
          />
          <TemplateTitleInlineEditor
            name={currentTemplate.name}
            onRename={renameTemplate}
          />
        </div>

        <TemplateEditorHistoryControls
          canRedo={canRedo}
          canUndo={canUndo}
          isSaving={isSavingFields}
          onRedo={redoTemplateChange}
          onUndo={undoTemplateChange}
        />

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          <Button
            aria-label={
              isOpeningSelfSign ? "Opening signing form" : "Sign yourself"
            }
            className="size-10 rounded-full p-0 font-bold text-[var(--auth-primary)] sm:h-12 sm:w-auto sm:px-5"
            disabled={isOpeningSelfSign}
            onClick={() => void openSelfSigningForm()}
            type="button"
            variant="ghost"
          >
            {isOpeningSelfSign ? (
              <Spinner className="size-4" />
            ) : (
              <PenLineIcon />
            )}
            <span className="hidden sm:inline">
              {isOpeningSelfSign ? "OPENING" : "SIGN YOURSELF"}
            </span>
          </Button>
          <Button
            aria-label="Send"
            className="size-10 rounded-full p-0 font-bold sm:h-12 sm:w-auto sm:px-6"
            onClick={openRecipientsDialog}
            type="button"
            variant="outline"
          >
            <UserRoundPlusIcon />
            <span className="hidden sm:inline">SEND</span>
          </Button>
          <div className="flex overflow-hidden rounded-full bg-[var(--auth-primary)] text-[var(--auth-primary-foreground)]">
            <Button
              aria-label="Save template"
              className="size-10 rounded-none bg-transparent p-0 sm:h-12 sm:w-auto sm:pl-5 sm:pr-6 font-bold text-inherit hover:bg-[var(--auth-primary-hover)]"
              disabled={isSavingFields}
              onClick={() => void saveTemplateDraft()}
              type="button"
            >
              {isSavingFields ? <Spinner className="size-4" /> : <SaveIcon />}
              <span className="hidden sm:inline">SAVE</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Save options"
                  className="h-10 rounded-none border-l border-white/20 sm:h-12 bg-transparent text-inherit hover:bg-[var(--auth-primary-hover)]"
                  size="icon"
                  type="button"
                >
                  <ChevronDownIcon data-icon="icon-only" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link
                      className="flex items-center gap-2"
                      href={`/templates/${currentTemplate.id}/form`}
                    >
                      <EyeIcon className="size-4" />
                      <span>Save and Preview</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsPreferencesOpen(true)}>
                    <SlidersHorizontalIcon className="size-4" />
                    <span>Preferences</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isDownloadingTemplateDocuments}
                    onClick={() => void downloadTemplateDocuments()}
                  >
                    {isDownloadingTemplateDocuments ? (
                      <Spinner className="size-4" />
                    ) : (
                      <DownloadIcon className="size-4" />
                    )}
                    <span>
                      {isDownloadingTemplateDocuments
                        ? "Downloading..."
                        : "Download"}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {isPreferencesOpen ? (
        <TemplatePreferencesDialog
          isSaving={isSavingPreferences}
          isUpdatingSharedLink={isUpdatingSharedLink}
          open={isPreferencesOpen}
          template={currentTemplate}
          onOpenChange={setIsPreferencesOpen}
          onSave={saveTemplatePreferences}
          onSharedLinkChange={updateTemplateSharedLink}
          onTestingShareChange={updateTemplateTestingShare}
        />
      ) : null}
      {isRecipientsOpen ? (
        <TemplateSendRecipientsDialog
          onOpenChange={setIsRecipientsOpen}
          open={isRecipientsOpen}
          template={currentTemplate}
        />
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[226px_minmax(0,1fr)_340px]">
        <TemplateDocumentsPanel
          isUploadingDocument={isUploadingDocument}
          onAddBlankPage={addBlankPage}
          onAddDocument={addDocument}
          onAddGoogleDriveDocuments={addGoogleDriveDocuments}
          onEditDocument={setEditingDocumentUuid}
          onMoveDocument={moveDocument}
          onRenameDocument={renameDocument}
          onRemoveDocument={removeDocument}
          onReplaceDocument={replaceDocument}
          onReorderDocumentFields={reorderDocumentFields}
          onSelectDocument={setSelectedDocumentUuid}
          onUpdateDocumentConditions={updateDocumentConditions}
          editingDocumentUuid={editingDocumentUuid}
          selectedDocumentUuid={selectedDocument?.uuid ?? null}
          template={currentTemplate}
        />
        <TemplateCanvas
          activeFieldType={activeFieldType}
          documents={currentTemplate.documents}
          fields={currentFields}
          isUploadingDocument={isUploadingDocument}
          isSavingFields={isSavingFields}
          onAddDocument={addDocument}
          onAddGoogleDriveDocuments={addGoogleDriveDocuments}
          onAddSubmitter={addSubmitter}
          onCopySelectedFields={copySelectedFields}
          onDropField={addDroppedField}
          onCreateField={createField}
          onDeleteField={deleteField}
          onDeleteSelectedFields={deleteSelectedFields}
          onNudgeSelectedFields={nudgeSelectedFields}
          onPasteCopiedFields={pasteCopiedFields}
          onSelectField={selectField}
          onUpdateField={updateField}
          onUpdateFieldArea={updateFieldArea}
          selectedFieldUuid={selectedFieldUuid}
          selectedFieldUuids={selectedFieldUuids}
          selectedDocumentUuid={selectedDocument?.uuid ?? null}
          submitters={currentSubmitters}
          template={currentTemplate}
        />
        <TemplateFieldsPanel
          activeFieldType={activeFieldType}
          customFields={customFields}
          fields={currentFields}
          isSavingFields={isSavingFields}
          onAddSubmitter={addSubmitter}
          onAddFieldWithoutDrawing={addFieldWithoutDrawing}
          onCancelFieldPlacement={() => setActiveFieldType(null)}
          onCustomFieldSelect={addCustomFieldWithoutDrawing}
          onCopyFieldToAllPages={copyFieldToAllPages}
          onDeleteField={deleteField}
          onFieldTypeSelect={setActiveFieldType}
          onGoToFieldArea={goToFieldArea}
          onGoToFieldPage={goToFieldPage}
          onMoveField={moveFieldInOrder}
          onMoveFieldToIndex={moveFieldToIndex}
          onRemoveSubmitter={removeSubmitter}
          onRenameSubmitter={renameSubmitter}
          onSelectSubmitter={setSelectedSubmitterUuid}
          onSelectField={(fieldUuid) => selectField(fieldUuid)}
          onSaveCustomField={saveFieldAsCustomField}
          onStartDrawNewArea={startDrawNewArea}
          onUpdateField={updateFieldAndTemplate}
          selectedFieldUuid={selectedFieldUuid}
          selectedSubmitterUuid={selectedSubmitter?.uuid ?? null}
          submitters={currentSubmitters}
        />
      </div>
    </main>
  );
}

function TemplateTitleInlineEditor({
  name,
  onRename,
}: {
  name: string;
  onRename: (name: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isCommittingRef = useRef(false);
  const [draftName, setDraftName] = useState(name);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  async function saveName() {
    if (isCommittingRef.current) {
      return;
    }

    isCommittingRef.current = true;
    const nextName = draftName.trim() || name;

    setIsEditing(false);

    if (nextName === name) {
      setDraftName(name);
      isCommittingRef.current = false;
      return;
    }

    setIsSaving(true);

    try {
      await onRename(nextName);
    } catch {
      setDraftName(name);
    } finally {
      setIsSaving(false);
      isCommittingRef.current = false;
    }
  }

  function startEditing() {
    setDraftName(name);
    setIsEditing(true);
  }

  if (isEditing) {
    return (
      <input
        aria-label="Template name"
        className="min-w-0 max-w-[42vw] rounded bg-transparent text-3xl font-bold tracking-normal outline-none ring-0 focus-visible:ring-2 focus-visible:ring-ring"
        disabled={isSaving}
        onBlur={() => void saveName()}
        onChange={(event) => setDraftName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void saveName();
          }

          if (event.key === "Escape") {
            event.preventDefault();
            setDraftName(name);
            setIsEditing(false);
          }
        }}
        ref={inputRef}
        style={{ width: `${Math.max(1, draftName.length)}ch` }}
        value={draftName}
      />
    );
  }

  return (
    <button
      className="group/title flex min-w-0 items-center gap-2 rounded-md px-1 text-left hover:bg-[var(--auth-muted)]"
      disabled={isSaving}
      onClick={startEditing}
      type="button"
    >
      <span className="truncate text-xl font-bold tracking-normal sm:text-3xl">
        {name}
      </span>
      <PencilIcon className="size-5 shrink-0 text-[var(--auth-primary)] opacity-0 transition-opacity group-hover/title:opacity-100" />
      {isSaving ? <Spinner className="size-4 shrink-0" /> : null}
    </button>
  );
}

function TemplateEditorHistoryControls({
  canRedo,
  canUndo,
  isSaving,
  onRedo,
  onUndo,
}: {
  canRedo: boolean;
  canUndo: boolean;
  isSaving: boolean;
  onRedo: () => Promise<void>;
  onUndo: () => Promise<void>;
}) {
  return (
    <TooltipProvider>
      <div className="flex shrink-0 items-center overflow-hidden rounded-full border border-[var(--auth-input-border)] bg-[var(--auth-background)] shadow-sm">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Undo"
              className="size-10 rounded-none border-r border-[var(--auth-input-border)] text-[var(--auth-primary)]"
              disabled={!canUndo || isSaving}
              onClick={() => void onUndo()}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Undo2Icon data-icon="icon-only" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Redo"
              className="size-10 rounded-none text-[var(--auth-primary)]"
              disabled={!canRedo || isSaving}
              onClick={() => void onRedo()}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Redo2Icon data-icon="icon-only" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

function TemplateEditorStatus({
  error,
  onBack,
}: {
  error: string | null;
  onBack: () => void;
}) {
  if (error) {
    return (
      <main
        className="flex min-h-svh items-center justify-center bg-[var(--auth-background)] px-6 text-[var(--auth-foreground)]"
        id="main-content"
        tabIndex={-1}
      >
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <p className="text-lg font-semibold">{error}</p>
          <Button
            className="rounded-full border-[var(--auth-primary)] px-6 text-[var(--auth-primary)]"
            onClick={onBack}
            type="button"
            variant="outline"
          >
            Back to templates
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main
      className="flex min-h-svh items-center justify-center bg-[var(--auth-background)] text-[var(--auth-foreground)]"
      id="main-content"
      tabIndex={-1}
    >
      <div className="flex items-center gap-3 text-sm font-semibold">
        <Spinner />
        Loading template editor
      </div>
    </main>
  );
}

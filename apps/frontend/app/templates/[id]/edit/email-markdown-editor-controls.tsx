"use client";

import type { Editor } from "@tiptap/react";
import {
  CheckIcon,
  ChevronDownIcon,
  LinkIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import type { ComponentProps, KeyboardEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { EmailTemplateVariable } from "./email-markdown-editor";

type EditorToolbarButtonProps = {
  active?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
};

type VariableMenuProps = {
  disabled: boolean;
  onOpen: () => void;
  onSelectVariable: (variable: string) => void;
  variables: EmailTemplateVariable[];
};

type LinkEditorControlsProps = {
  editor: Editor | null;
  onCancel: () => void;
  onSave: () => void;
  onUrlChange: (url: string) => void;
  url: string;
};

export function EditorLinkButton({ editor }: { editor: Editor | null }) {
  const linkEditor = useLinkEditorControls(editor);

  return linkEditor.isEditing ? (
    <LinkEditorControls
      editor={editor}
      onCancel={linkEditor.close}
      onSave={linkEditor.save}
      onUrlChange={linkEditor.setUrl}
      url={linkEditor.url}
    />
  ) : (
    <EditorToolbarButton
      active={editor?.isActive("link") ?? false}
      disabled={!editor}
      icon={<LinkIcon data-icon="icon-only" />}
      label="Link"
      onClick={linkEditor.open}
    />
  );
}

function useLinkEditorControls(editor: Editor | null) {
  const [isEditing, setIsEditing] = useState(false);
  const [url, setUrl] = useState("");

  function open() {
    setUrl(getEditorLinkHref(editor));
    setIsEditing(true);
  }

  function save() {
    applyLinkUrl(editor, url);
    setIsEditing(false);
  }

  return { close: () => setIsEditing(false), isEditing, open, save, setUrl, url };
}

export function EditorToolbarButton({
  active = false,
  disabled = false,
  icon,
  label,
  onClick,
}: EditorToolbarButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={getToolbarButtonClassName(active)}
          disabled={disabled}
          onClick={onClick}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function VariableMenu({
  disabled,
  onOpen,
  onSelectVariable,
  variables,
}: VariableMenuProps) {
  if (variables.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <VariableMenuTrigger disabled={disabled} onOpen={onOpen} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          {variables.map((variable) => (
            <VariableMenuItem
              key={variable.value}
              onSelectVariable={onSelectVariable}
              variable={variable}
            />
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function VariableMenuTrigger({
  onOpen,
  onPointerDown,
  onKeyDown,
  ...buttonProps
}: ComponentProps<typeof Button> & { onOpen: () => void }) {
  return (
    <Button
      {...buttonProps}
      className="h-8 rounded-full px-3 text-xs"
      onPointerDown={(event) => {
        onOpen();
        onPointerDown?.(event);
      }}
      onKeyDown={(event) => {
        if (["Enter", " ", "ArrowDown"].includes(event.key)) onOpen();
        onKeyDown?.(event);
      }}
      type="button"
      variant="ghost"
    >
      Add variable
      <ChevronDownIcon data-icon="inline-end" />
    </Button>
  );
}

function VariableMenuItem({
  onSelectVariable,
  variable,
}: {
  onSelectVariable: (variable: string) => void;
  variable: EmailTemplateVariable;
}) {
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        onSelectVariable(variable.value);
      }}
    >
      {variable.label}
    </DropdownMenuItem>
  );
}

function LinkEditorControls({
  editor,
  onCancel,
  onSave,
  onUrlChange,
  url,
}: LinkEditorControlsProps) {
  return (
    <div className="flex items-center gap-1 rounded-full border bg-background p-1">
      <LinkEditorInput
        onCancel={onCancel}
        onSave={onSave}
        onUrlChange={onUrlChange}
        url={url}
      />
      <LinkEditorIconButton
        ariaLabel="Save link"
        icon={<CheckIcon data-icon="icon-only" />}
        onClick={onSave}
      />
      <LinkEditorIconButton
        ariaLabel="Remove link"
        icon={<Trash2Icon data-icon="icon-only" />}
        onClick={() => removeEditorLink(editor, onCancel)}
      />
    </div>
  );
}

function getToolbarButtonClassName(active: boolean) {
  return cn(
    "rounded-md",
    active && "bg-[var(--auth-muted)] text-[var(--auth-primary)]",
  );
}

function LinkEditorInput({
  onCancel,
  onSave,
  onUrlChange,
  url,
}: {
  onCancel: () => void;
  onSave: () => void;
  onUrlChange: (url: string) => void;
  url: string;
}) {
  return (
    <Input
      autoFocus
      className="h-7 w-52 border-none px-2 text-xs shadow-none focus-visible:ring-0"
      onChange={(event) => onUrlChange(event.target.value)}
      onKeyDown={(event) => handleLinkEditorKeyDown(event, onCancel, onSave)}
      placeholder="Enter a URL or variable name"
      value={url}
    />
  );
}

function LinkEditorIconButton({
  ariaLabel,
  icon,
  onClick,
}: {
  ariaLabel: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={ariaLabel}
      onClick={onClick}
      size="icon-xs"
      type="button"
      variant="ghost"
    >
      {icon}
    </Button>
  );
}

function applyLinkUrl(editor: Editor | null, url: string) {
  if (!editor) {
    return;
  }

  const href = normalizeLinkUrl(url);

  if (!href) {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }

  editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
}

function getEditorLinkHref(editor: Editor | null) {
  if (!editor) {
    return "";
  }

  const attrs = editor.getAttributes("link") as { href?: string };

  return attrs.href ?? "";
}

function removeEditorLink(editor: Editor | null, onCancel: () => void) {
  editor?.chain().focus().extendMarkRange("link").unsetLink().run();
  onCancel();
}

function handleLinkEditorKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  onCancel: () => void,
  onSave: () => void,
) {
  if (event.key === "Enter") {
    event.preventDefault();
    onSave();
  }

  if (event.key === "Escape") {
    event.preventDefault();
    onCancel();
  }
}

function normalizeLinkUrl(url: string) {
  const trimmedUrl = url.trim();

  if (!trimmedUrl) {
    return "";
  }

  if (/^\{/.test(trimmedUrl)) {
    return trimmedUrl;
  }

  if (/^(https?:\/\/|mailto:)/i.test(trimmedUrl)) {
    return trimmedUrl;
  }

  return `https://${trimmedUrl}`;
}

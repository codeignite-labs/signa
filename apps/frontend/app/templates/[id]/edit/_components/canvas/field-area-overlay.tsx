"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { GripVerticalIcon, TypeIcon, UserPlusIcon, XIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { handleFieldAreaKeyboard } from "./field-area-keyboard";
import { FieldAreaResizeHandle } from "./field-area-resize-handle";
import { FieldAreaValue } from "./field-area-value";
import {
  areaToStyle,
  buildDefaultFieldName,
  buildFieldTypeUpdate,
  fieldTypes,
  getAutosizeInputCh,
  getFieldConditions,
  getFieldOptions,
  getFieldStringValue,
  getFieldTypeDefinition,
  getPartyName,
  getSubmitterColor,
  humanizeConditionAction,
  isTextEditableField,
  normalizeArea,
  submitterColors,
  type EditorFieldType,
  type TemplateEditorField,
  type TemplateFieldArea,
  type TemplateSubmitter,
} from "../../_lib/template-editor-model";

export function FieldAreaOverlay({
  area,
  areaIndex,
  field,
  fields,
  isMultiSelected,
  isSaving,
  isSelected,
  onCopySelectedFields,
  onDeleteField,
  onDeleteSelectedFields,
  onAddSubmitter,
  onNudgeSelectedFields,
  onPasteCopiedFields,
  onSelectField,
  onUpdateField,
  onUpdateFieldArea,
  submitters,
}: {
  area: TemplateFieldArea;
  areaIndex: number;
  field: TemplateEditorField;
  fields: TemplateEditorField[];
  isMultiSelected: boolean;
  isSaving: boolean;
  isSelected: boolean;
  onCopySelectedFields: (fieldUuid?: string) => void;
  onDeleteField: (fieldUuid: string) => Promise<void>;
  onDeleteSelectedFields: (fieldUuid?: string) => Promise<void>;
  onAddSubmitter: (fieldUuid?: string) => Promise<void>;
  onNudgeSelectedFields: (
    fieldUuid: string,
    dx: number,
    dy: number,
  ) => Promise<void>;
  onPasteCopiedFields: () => Promise<void>;
  onSelectField: (fieldUuid: string | null, additive?: boolean) => void;
  onUpdateField: (
    fieldUuid: string,
    patch: Partial<TemplateEditorField>,
  ) => Promise<void>;
  onUpdateFieldArea: (
    fieldUuid: string,
    areaIndex: number,
    area: TemplateFieldArea,
  ) => Promise<void>;
  submitters: TemplateSubmitter[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const [isRenamingLabel, setIsRenamingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [interaction, setInteraction] = useState<{
    area: TemplateFieldArea;
    mode: "move" | "resize";
    startArea: TemplateFieldArea;
    startX: number;
    startY: number;
  } | null>(null);
  const displayArea = interaction?.area ?? area;
  const typeMeta = getFieldTypeDefinition(field.type);
  const Icon = typeMeta?.icon ?? TypeIcon;
  const title = field.name || buildDefaultFieldName(field.type, 0);
  const roleColor = getSubmitterColor(submitters, field.submitter_uuid);
  const defaultValue = getFieldStringValue(field.default_value);
  const checkedValue = field.default_value === true;
  const conditionCount = getFieldConditions(field).length;
  const hasDisplayValue = Boolean(defaultValue);
  const hasVisibleContent =
    (isTextEditableField(field.type) && hasDisplayValue) ||
    (field.type === "checkbox" && checkedValue);
  const shouldShowLabel = isSelected || isRenamingLabel || !hasVisibleContent;

  useEffect(() => {
    if (isSelected && isTextEditableField(field.type)) {
      inputRef.current?.focus();
    }
  }, [field.type, isSelected]);

  useEffect(() => {
    if (isRenamingLabel) {
      labelInputRef.current?.focus();
      labelInputRef.current?.select();
    }
  }, [isRenamingLabel]);

  function startInteraction(
    mode: "move" | "resize",
    event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
  ) {
    if (isSaving || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectField(field.uuid);
    setInteraction({
      area,
      mode,
      startArea: area,
      startX: event.clientX,
      startY: event.clientY,
    });
  }

  function updateInteraction(
    event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
  ) {
    if (!interaction) {
      return;
    }

    const parent = event.currentTarget.closest("[data-page-layer]");

    if (!parent) {
      return;
    }

    const rect = parent.getBoundingClientRect();
    const dx = (event.clientX - interaction.startX) / rect.width;
    const dy = (event.clientY - interaction.startY) / rect.height;

    if (interaction.mode === "move") {
      setInteraction({
        ...interaction,
        area: normalizeArea(
          {
            ...interaction.startArea,
            x: interaction.startArea.x + dx,
            y: interaction.startArea.y + dy,
          },
          field.type,
        ),
      });
      return;
    }

    setInteraction({
      ...interaction,
      area: normalizeArea(
        {
          ...interaction.startArea,
          h: interaction.startArea.h + dy,
          w: interaction.startArea.w + dx,
        },
        field.type,
      ),
    });
  }

  function finishInteraction(
    event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
  ) {
    event.stopPropagation();
    if (!interaction) {
      return;
    }

    const nextArea = interaction.area;

    setInteraction(null);
    void onUpdateFieldArea(field.uuid, areaIndex, nextArea);
  }

  function saveLabelName(value: string) {
    const nextName = value.trim() || title;

    setIsRenamingLabel(false);

    if (nextName !== field.name) {
      void onUpdateField(field.uuid, { name: nextName });
    }
  }

  function changeFieldType(nextType: EditorFieldType) {
    if (nextType === field.type) {
      return;
    }

    void onUpdateField(field.uuid, buildFieldTypeUpdate(field, nextType));
  }

  function changeFieldSubmitter(submitterUuid: string) {
    if (submitterUuid === field.submitter_uuid) {
      return;
    }

    void onUpdateField(field.uuid, { submitter_uuid: submitterUuid });
  }

  return (
    <div
      aria-label={`${title} field`}
      className={cn(
        "group/field field-area-container absolute cursor-default overflow-visible outline-none [container-type:size] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isSelected || isMultiSelected ? "z-10" : "hover:z-10",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onSelectField(field.uuid, event.metaKey || event.ctrlKey);
      }}
      onKeyDown={(event) => {
        handleFieldAreaKeyboard({
          event,
          field,
          onCopySelectedFields,
          onDeleteSelectedFields,
          onNudgeSelectedFields,
          onPasteCopiedFields,
        });
      }}
      onPointerCancel={() => setInteraction(null)}
      onPointerMove={updateInteraction}
      onPointerUp={finishInteraction}
      aria-pressed={isSelected || isMultiSelected}
      role="button"
      style={{
        ...areaToStyle(displayArea),
      }}
      tabIndex={0}
    >
      <div
        className="pointer-events-none absolute inset-0 border border-[1.5px]"
        style={{ borderColor: roleColor }}
      />
      {shouldShowLabel ? (
        <div
          className="field-area-controls absolute left-0 top-[-25px] z-10 flex h-[25px] w-max max-w-80 items-center overflow-hidden whitespace-nowrap rounded-t border border-slate-200 bg-white text-sm font-medium leading-none text-[var(--auth-primary)] shadow-sm"
        >
          <button
            aria-label={`Move ${title}`}
            className="flex h-full w-5 shrink-0 cursor-grab items-center justify-center border-r border-slate-200 text-[var(--auth-label)] hover:bg-red-50 active:cursor-grabbing"
            onPointerCancel={() => setInteraction(null)}
            onPointerDown={(event) => startInteraction("move", event)}
            onPointerMove={updateInteraction}
            onPointerUp={finishInteraction}
            type="button"
          >
            <GripVerticalIcon className="size-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`Change ${title} role`}
                className="roles-dropdown flex h-full w-7 shrink-0 items-center justify-center border-r border-slate-200"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectField(field.uuid);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: roleColor }}
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-52"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <DropdownMenuLabel>Assigned role</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {submitters.map((submitter, index) => (
                  <DropdownMenuItem
                    className="gap-2"
                    key={submitter.uuid}
                    onClick={(event) => {
                      event.stopPropagation();
                      void changeFieldSubmitter(submitter.uuid);
                    }}
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{
                        backgroundColor:
                          submitterColors[index % submitterColors.length],
                      }}
                    />
                    <span className="flex-1 truncate">
                      {submitter.name || getPartyName(index)}
                    </span>
                    {field.submitter_uuid === submitter.uuid ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Current
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2"
                disabled={isSaving}
                onClick={(event) => {
                  event.stopPropagation();
                  void onAddSubmitter(field.uuid);
                }}
              >
                <UserPlusIcon className="size-4" />
                <span>Add {getPartyName(submitters.length)}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`Change ${title} field type`}
                className="field-types-dropdown flex h-6 w-[27px] shrink-0 items-center justify-center text-[var(--auth-primary)] hover:bg-red-50"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectField(field.uuid);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                type="button"
              >
                <Icon className="h-6 w-[27px] px-1" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-52"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <DropdownMenuLabel>Field type</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {fieldTypes.map((fieldType) => {
                const TypeOptionIcon = fieldType.icon;

                return (
                  <DropdownMenuItem
                    className="gap-2"
                    disabled={fieldType.locked || isSaving}
                    key={fieldType.type}
                    onClick={(event) => {
                      event.stopPropagation();
                      changeFieldType(fieldType.type);
                    }}
                  >
                    <TypeOptionIcon className="size-4" />
                    <span className="flex-1">{fieldType.label}</span>
                    {field.type === fieldType.type ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Current
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          {isRenamingLabel ? (
            <input
              aria-label={`${title} name`}
              className="h-full max-w-40 bg-transparent px-0 pr-1 text-sm font-medium text-[var(--auth-primary)] outline-none ring-0 focus-visible:ring-2 focus-visible:ring-ring"
              onBlur={(event) => saveLabelName(event.target.value)}
              onChange={(event) => setLabelDraft(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                event.stopPropagation();

                if (event.key === "Enter") {
                  saveLabelName(event.currentTarget.value);
                }

                if (event.key === "Escape") {
                  setIsRenamingLabel(false);
                }
              }}
              onPointerDown={(event) => event.stopPropagation()}
              ref={labelInputRef}
              style={{
                width: `${getAutosizeInputCh(labelDraft || title)}ch`,
              }}
              value={labelDraft}
            />
          ) : (
            <button
              className="block min-w-6 flex-1 cursor-text truncate rounded pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(event) => {
                event.stopPropagation();
                setLabelDraft(title);
                setIsRenamingLabel(true);
                onSelectField(field.uuid);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              type="button"
            >
              {title}
            </button>
          )}
          <div
            className={cn(
              "ml-1 flex h-full shrink-0 items-center gap-0.5 border-l border-slate-200 pl-1",
              !isSelected && conditionCount === 0 ? "hidden" : "",
            )}
          >
            {conditionCount > 0 ? (
              <ConditionCountBadge field={field} fields={fields} />
            ) : null}
            {isSelected ? (
              <Checkbox
                aria-label={
                  field.required !== false
                    ? `Mark ${title} optional`
                    : `Mark ${title} required`
                }
                checked={field.required !== false}
                className="size-4 shrink-0 rounded-[4px]"
                onClick={(event) => {
                  event.stopPropagation();
                }}
                onCheckedChange={(checked) => {
                  void onUpdateField(field.uuid, {
                    required: checked === true,
                  });
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                title={field.required !== false ? "Required" : "Optional"}
              />
            ) : null}
            {isSelected ? (
              <button
                aria-label={`Delete ${title}`}
                className="flex size-5 shrink-0 items-center justify-center rounded-sm text-[var(--auth-primary)] hover:bg-red-50 hover:text-red-600"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void onDeleteField(field.uuid);
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                type="button"
              >
                <XIcon className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className="field-area flex h-full w-full items-center justify-center overflow-hidden bg-opacity-80 p-0 text-[var(--auth-primary)]"
        style={{ backgroundColor: `${roleColor}26` }}
      >
        <FieldAreaValue
          checkedValue={checkedValue}
          defaultValue={defaultValue}
          field={field}
          hasDisplayValue={hasDisplayValue}
          inputRef={inputRef}
          isSelected={isSelected}
          onUpdateField={onUpdateField}
          title={title}
        />
      </div>

      {isSelected ? (
        <FieldAreaResizeHandle
          finishInteraction={finishInteraction}
          startResize={(event) => startInteraction("resize", event)}
          title={title}
          updateInteraction={updateInteraction}
        />
      ) : null}
    </div>
  );
}

function ConditionCountBadge({
  field,
  fields,
}: {
  field: TemplateEditorField;
  fields: TemplateEditorField[];
}) {
  const conditions = getFieldConditions(field);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`${conditions.length} conditions`}
          className="flex h-5 min-w-5 shrink-0 cursor-help items-center justify-center rounded-full bg-[var(--auth-primary)] px-1 text-[10px] font-bold leading-none text-[var(--auth-primary-foreground)]"
        >
          {conditions.length}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72" side="top">
        <div className="grid gap-1 text-xs">
          <p className="font-semibold">
            {conditions.length} condition{conditions.length === 1 ? "" : "s"}
          </p>
          {conditions.map((condition, index) => (
            <p key={`${condition.field_uuid ?? "condition"}-${index}`}>
              {index > 0 ? `${condition.operation === "or" ? "OR" : "AND"} ` : ""}
              {formatCondition(condition, fields)}
            </p>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function formatCondition(
  condition: ReturnType<typeof getFieldConditions>[number],
  fields: TemplateEditorField[],
): string {
  const conditionField = fields.find(
    (item) => item.uuid === condition.field_uuid,
  );
  const fieldName = conditionField
    ? conditionField.name || buildDefaultFieldName(conditionField.type, 0)
    : "Unknown field";
  const action = condition.action
    ? humanizeConditionAction(condition.action)
    : "matches";
  const value = formatConditionValue(condition.value, conditionField);

  return value ? `${fieldName} ${action} ${value}` : `${fieldName} ${action}`;
}

function formatConditionValue(
  value: string | undefined,
  field: TemplateEditorField | undefined,
): string {
  if (!value) {
    return "";
  }

  if (!field) {
    return value;
  }

  const option = getFieldOptions(field).find((item) => item.uuid === value);

  return option?.value || value;
}

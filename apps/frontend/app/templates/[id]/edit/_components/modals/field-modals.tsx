"use client";

import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import phoneData from "@/lib/phone-data";
import { cn } from "@/lib/utils";
import {
  buildDefaultFieldName,
  createsConditionCycle,
  fieldValidationOptions,
  getConditionActions,
  getDefaultFieldFormat,
  getFieldConditions,
  getFieldFormats,
  getFieldOptions,
  getFieldStringValue,
  getValidationKind,
  getValidationPattern,
  humanizeConditionAction,
  isChoiceField,
  isRecord,
  isTextEditableField,
  parseLengthValidation,
  requiresConditionValue,
  type TemplateEditorField,
  type TemplateFieldArea,
  type TemplateFieldCondition,
} from "../../_lib/template-editor-model";

const phoneCountries = phoneData.map(([iso, name, dial, flag]) => ({
  dial,
  flag,
  iso,
  name,
}));

export function FieldDescriptionModal({
  field,
  onOpenChange,
  onSave,
  open,
  title,
}: {
  field: TemplateEditorField;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: Partial<TemplateEditorField>) => Promise<void>;
  open: boolean;
  title: string;
}) {
  const [description, setDescription] = useState(() =>
    getFieldStringValue(field.description),
  );
  const [displayTitle, setDisplayTitle] = useState(() =>
    getFieldStringValue(field.title),
  );

  if (!open) {
    return null;
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="top-16 max-w-xl -translate-y-0 border-[var(--auth-input-border)] bg-card p-6 text-[var(--auth-foreground)] shadow-2xl"
        overlayClassName="bg-black/35 backdrop-blur-none"
        showCloseButton={false}
      >
        <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSave({
            description: description.trim() || undefined,
            title: displayTitle.trim() || undefined,
          }).then(() => onOpenChange(false));
        }}
      >
        <DialogHeader className="mb-4 flex-row items-center justify-between border-b border-[var(--auth-input-border)] pb-3">
          <DialogTitle className="text-base font-bold text-[var(--auth-primary)]">
            {title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Edit the field description and display title.
          </DialogDescription>
          <DialogClose
            aria-label="Close description dialog"
            className="rounded-full px-2 text-xl leading-none text-[var(--auth-primary)] hover:bg-[var(--auth-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ×
          </DialogClose>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${field.uuid}-description`}>Description</Label>
            <textarea
              className="min-h-24 resize-y rounded-3xl border border-[var(--auth-input-border)] bg-background px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--auth-primary)] focus-visible:ring-2 focus-visible:ring-ring"
              id={`${field.uuid}-description`}
              name="description"
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${field.uuid}-display-title`}>
              Display title (optional)
            </Label>
            <Input
              autoComplete="off"
              className="h-12 rounded-full bg-background"
              id={`${field.uuid}-display-title`}
              name="displayTitle"
              onChange={(event) => setDisplayTitle(event.target.value)}
              value={displayTitle}
            />
          </div>
          <Button
            className="h-12 rounded-full bg-[var(--auth-primary)] font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
            type="submit"
          >
            SAVE
          </Button>
        </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FieldAdvancedSettingsModal({
  field,
  onGoToArea,
  onOpenChange,
  onSave,
  title,
}: {
  field: TemplateEditorField;
  onGoToArea: (area: TemplateFieldArea) => void;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: Partial<TemplateEditorField>) => Promise<void>;
  title: string;
}) {
  const preferences = isRecord(field.preferences) ? field.preferences : {};
  const validation = isRecord(field.validation) ? field.validation : {};
  const [required, setRequired] = useState(field.required !== false);
  const [readonly, setReadonly] = useState(field.readonly === true);
  const [prefillable, setPrefillable] = useState(field.prefillable === true);
  const [defaultValue, setDefaultValue] = useState(() =>
    field.type === "checkbox"
      ? field.default_value === true
        ? "true"
        : "false"
      : getFieldStringValue(field.default_value),
  );
  const [format, setFormat] = useState(() =>
    typeof preferences.format === "string"
      ? preferences.format
      : getDefaultFieldFormat(field.type),
  );
  const [validationKind, setValidationKind] = useState(() =>
    getValidationKind(field),
  );
  const [lengthMin, setLengthMin] = useState(() => {
    const length = parseLengthValidation(
      getFieldStringValue(validation.pattern),
    );
    return length?.min ?? "";
  });
  const [lengthMax, setLengthMax] = useState(() => {
    const length = parseLengthValidation(
      getFieldStringValue(validation.pattern),
    );
    return length?.max ?? "";
  });
  const [customPattern, setCustomPattern] = useState(() =>
    getValidationKind(field) === "custom"
      ? getFieldStringValue(validation.pattern)
      : "",
  );
  const [customMessage, setCustomMessage] = useState(() =>
    getFieldStringValue(validation.message),
  );
  const [acceptedFileTypes, setAcceptedFileTypes] = useState(() =>
    getFieldStringValue(preferences.accept),
  );
  const [maxFileSizeMb, setMaxFileSizeMb] = useState(() =>
    getFieldStringValue(preferences.max_size_mb),
  );
  const [minValue, setMinValue] = useState(() =>
    getFieldStringValue(validation.min),
  );
  const [maxValue, setMaxValue] = useState(() =>
    getFieldStringValue(validation.max),
  );
  const [phoneCountry, setPhoneCountry] = useState(() =>
    getFieldStringValue(validation.phone_country),
  );
  const [options, setOptions] = useState(() => getFieldOptions(field));
  const [areas, setAreas] = useState(() => field.areas);
  const supportsOptions = isChoiceField(field.type);
  const supportsTextDefault = isTextEditableField(field.type);
  const supportsFormat = field.type === "date" || field.type === "number";
  const supportsTextValidation = ["cells", "text"].includes(field.type);
  const supportsFileConstraints = ["file", "image"].includes(field.type);
  const supportsPhoneValidation = field.type === "phone";

  function saveSettings() {
    const nextPreferences = { ...preferences };
    const nextValidation = { ...validation };
    const patch: Partial<TemplateEditorField> = {
      prefillable,
      readonly,
      required,
    };

    if (supportsTextDefault) {
      patch.default_value = defaultValue;
    }

    if (field.type === "checkbox") {
      patch.default_value = defaultValue === "true";
    }

    if (supportsFormat) {
      nextPreferences.format = format || getDefaultFieldFormat(field.type);
      patch.preferences = nextPreferences;
    }

    if (supportsTextValidation) {
      if (!validationKind) {
        patch.validation = undefined;
      } else if (validationKind === "length") {
        patch.validation = {
          pattern: `.{${lengthMin.trim() || "0"},${lengthMax.trim()}}`,
        };
      } else if (validationKind === "custom") {
        patch.validation = {
          message: customMessage,
          pattern: customPattern,
        };
      } else {
        patch.validation = {
          pattern: getValidationPattern(validationKind),
        };
      }
    }

    if (field.type === "number") {
      if (minValue.trim()) {
        nextValidation.min = Number(minValue);
      } else {
        delete nextValidation.min;
      }

      if (maxValue.trim()) {
        nextValidation.max = Number(maxValue);
      } else {
        delete nextValidation.max;
      }

      patch.validation = Object.keys(nextValidation).length
        ? nextValidation
        : undefined;
    }

    if (supportsPhoneValidation) {
      if (phoneCountry) {
        nextValidation.phone_country = phoneCountry;
      } else {
        delete nextValidation.phone_country;
      }

      patch.validation = Object.keys(nextValidation).length
        ? nextValidation
        : undefined;
    }

    if (supportsOptions) {
      patch.options = options.length
        ? options.map((option) => ({
            uuid: option.uuid,
            value: option.value,
          }))
        : [
            { uuid: crypto.randomUUID(), value: "" },
            { uuid: crypto.randomUUID(), value: "" },
          ];
    }

    patch.areas = areas;

    if (supportsFileConstraints) {
      if (acceptedFileTypes.trim()) {
        nextPreferences.accept = acceptedFileTypes.trim();
      } else {
        delete nextPreferences.accept;
      }

      if (maxFileSizeMb.trim()) {
        nextPreferences.max_size_mb = maxFileSizeMb.trim();
      } else {
        delete nextPreferences.max_size_mb;
      }

      patch.preferences = Object.keys(nextPreferences).length
        ? nextPreferences
        : undefined;
    }

    void onSave(patch).then(() => onOpenChange(false));
  }

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent
        className="top-12 max-h-[calc(100svh-6rem)] max-w-xl -translate-y-0 gap-0 overflow-hidden border-[var(--auth-input-border)] bg-card p-0 text-[var(--auth-foreground)] shadow-2xl"
        overlayClassName="bg-black/35 backdrop-blur-none"
        showCloseButton={false}
      >
      <form
        className="flex min-h-0 flex-col overflow-hidden"
        onSubmit={(event) => {
          event.preventDefault();
          saveSettings();
        }}
      >
        <DialogHeader className="flex-row items-center justify-between border-b border-[var(--auth-input-border)] px-6 py-4">
          <DialogTitle className="text-base font-bold text-[var(--auth-primary)]">
            Field Settings - {title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Configure validation, defaults, options, and areas for this field.
          </DialogDescription>
          <DialogClose
            aria-label="Close field settings"
            className="rounded-full px-2 text-xl leading-none text-[var(--auth-primary)] hover:bg-[var(--auth-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ×
          </DialogClose>
        </DialogHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <FieldToggle
              checked={required}
              label="Required"
              onChange={setRequired}
            />
            <FieldToggle
              checked={readonly}
              label="Read only"
              onChange={setReadonly}
            />
            <FieldToggle
              checked={prefillable}
              label="Prefillable"
              onChange={setPrefillable}
            />
          </div>

          {supportsTextDefault ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${field.uuid}-default-value`}>
                Default value
              </Label>
              <Input
                className="h-11 rounded-full bg-background"
                id={`${field.uuid}-default-value`}
                onChange={(event) => setDefaultValue(event.target.value)}
                value={defaultValue}
              />
            </div>
          ) : null}

          {field.type === "checkbox" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${field.uuid}-checkbox-default`}>
                Checked by default
              </Label>
              <select
                className="h-11 rounded-full border border-[var(--auth-input-border)] bg-background px-4 text-sm outline-none focus:border-[var(--auth-primary)]"
                id={`${field.uuid}-checkbox-default`}
                onChange={(event) => setDefaultValue(event.target.value)}
                value={defaultValue}
              >
                <option value="false">Unchecked</option>
                <option value="true">Checked</option>
              </select>
            </div>
          ) : null}

          {supportsFormat ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${field.uuid}-format`}>Format</Label>
              <select
                className="h-11 rounded-full border border-[var(--auth-input-border)] bg-background px-4 text-sm outline-none focus:border-[var(--auth-primary)]"
                id={`${field.uuid}-format`}
                onChange={(event) => setFormat(event.target.value)}
                value={format}
              >
                {getFieldFormats(field.type).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {field.type === "number" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${field.uuid}-min`}>Minimum</Label>
                <Input
                  className="h-11 rounded-full bg-background"
                  id={`${field.uuid}-min`}
                  onChange={(event) => setMinValue(event.target.value)}
                  type="number"
                  value={minValue}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${field.uuid}-max`}>Maximum</Label>
                <Input
                  className="h-11 rounded-full bg-background"
                  id={`${field.uuid}-max`}
                  onChange={(event) => setMaxValue(event.target.value)}
                  type="number"
                  value={maxValue}
                />
              </div>
            </div>
          ) : null}

          {supportsTextValidation ? (
            <div className="flex flex-col gap-3 rounded-xl border border-[var(--auth-input-border)] bg-background p-3">
              <Label htmlFor={`${field.uuid}-validation`}>Validation</Label>
              <select
                className="h-11 rounded-full border border-[var(--auth-input-border)] bg-card px-4 text-sm outline-none focus:border-[var(--auth-primary)]"
                id={`${field.uuid}-validation`}
                onChange={(event) => setValidationKind(event.target.value)}
                value={validationKind}
              >
                <option value="">None</option>
                {fieldValidationOptions.map((option) => (
                  <option key={option.kind} value={option.kind}>
                    {option.label}
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
              {validationKind === "length" ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    aria-label="Minimum length"
                    className="h-11 rounded-full bg-card"
                    min={0}
                    onChange={(event) => setLengthMin(event.target.value)}
                    placeholder="Minimum length"
                    type="number"
                    value={lengthMin}
                  />
                  <Input
                    aria-label="Maximum length"
                    className="h-11 rounded-full bg-card"
                    min={1}
                    onChange={(event) => setLengthMax(event.target.value)}
                    placeholder="Maximum length"
                    type="number"
                    value={lengthMax}
                  />
                </div>
              ) : null}
              {validationKind === "custom" ? (
                <div className="flex flex-col gap-3">
                  <Input
                    aria-label="Validation pattern"
                    className="h-11 rounded-full bg-card"
                    onChange={(event) => setCustomPattern(event.target.value)}
                    placeholder="Regexp validation"
                    value={customPattern}
                  />
                  <Input
                    aria-label="Validation error message"
                    className="h-11 rounded-full bg-card"
                    onChange={(event) => setCustomMessage(event.target.value)}
                    placeholder="Error message"
                    value={customMessage}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {supportsPhoneValidation ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${field.uuid}-phone-country`}>
                Phone country
              </Label>
              <select
                className="h-11 rounded-full border border-[var(--auth-input-border)] bg-background px-4 text-sm outline-none focus:border-[var(--auth-primary)]"
                id={`${field.uuid}-phone-country`}
                onChange={(event) => setPhoneCountry(event.target.value)}
                value={phoneCountry}
              >
                <option value="">Signer can choose</option>
                {phoneCountries.map((country) => (
                  <option key={country.iso} value={country.iso}>
                    {country.flag} +{country.dial} {country.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {supportsOptions ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label id={`${field.uuid}-options-label`}>Options</Label>
                <Button
                  onClick={() =>
                    setOptions((current) => [
                      ...current,
                      { uuid: crypto.randomUUID(), value: "" },
                    ])
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <PlusIcon data-icon="inline-start" />
                  Add
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {options.map((option, optionIndex) => (
                  <div className="flex items-center gap-2" key={option.uuid}>
                    <Input
                      aria-label={`Option ${optionIndex + 1}`}
                      className="h-10 rounded-full bg-background"
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setOptions((current) =>
                          current.map((item) =>
                            item.uuid === option.uuid
                              ? { ...item, value: nextValue }
                              : item,
                          ),
                        );
                      }}
                      placeholder={`Option ${optionIndex + 1}`}
                      value={option.value}
                    />
                    <Button
                      aria-label={`Remove option ${optionIndex + 1}`}
                      disabled={options.length <= 1}
                      onClick={() =>
                        setOptions((current) =>
                          current.filter((item) => item.uuid !== option.uuid),
                        )
                      }
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2Icon data-icon="inline-start" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {supportsFileConstraints ? (
            <div className="flex flex-col gap-3 rounded-xl border border-[var(--auth-input-border)] bg-background p-3">
              <Label htmlFor={`${field.uuid}-accepted-types`}>
                {field.type === "image"
                  ? "Accepted image types"
                  : "Accepted file types"}
              </Label>
              <Input
                className="h-11 rounded-full bg-card"
                id={`${field.uuid}-accepted-types`}
                onChange={(event) => setAcceptedFileTypes(event.target.value)}
                placeholder={
                  field.type === "image" ? "image/*" : "application/pdf,image/*"
                }
                value={acceptedFileTypes}
              />
              <Label htmlFor={`${field.uuid}-max-file-size`}>
                Maximum size in MB
              </Label>
              <Input
                className="h-11 rounded-full bg-card"
                id={`${field.uuid}-max-file-size`}
                min={0}
                onChange={(event) => setMaxFileSizeMb(event.target.value)}
                placeholder="No limit"
                type="number"
                value={maxFileSizeMb}
              />
            </div>
          ) : null}

          {areas.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-xl border border-[var(--auth-input-border)] bg-background p-3">
              <Label id={`${field.uuid}-areas-label`}>Areas</Label>
              <div className="flex flex-col gap-2">
                {areas.map((area, areaIndex) => (
                  <div
                    className="flex items-center gap-2 rounded-lg border border-[var(--auth-input-border)] bg-card px-3 py-2"
                    key={`${area.attachment_uuid}-${area.page}-${areaIndex}`}
                  >
                    <button
                      className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-[var(--auth-primary)] hover:underline"
                      onClick={() => onGoToArea(area)}
                      type="button"
                    >
                      Page {area.page + 1}
                    </button>
                    <Button
                      aria-label={`Remove area ${areaIndex + 1}`}
                      disabled={areas.length <= 1}
                      onClick={() =>
                        setAreas((current) =>
                          current.filter((_, index) => index !== areaIndex),
                        )
                      }
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2Icon data-icon="inline-start" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="border-t border-[var(--auth-input-border)] p-4">
          <Button
            className="h-12 w-full rounded-full bg-[var(--auth-primary)] font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
            type="submit"
          >
            SAVE
          </Button>
        </div>
      </form>
      </DialogContent>
    </Dialog>
  );
}

export function FieldToggle({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-pressed={checked}
      className={cn(
        "flex h-10 items-center justify-between rounded-full border px-3 text-xs font-semibold transition-colors",
        checked
          ? "border-[var(--auth-primary)] bg-[var(--auth-primary)] text-[var(--auth-primary-foreground)]"
          : "border-[var(--auth-input-border)] bg-background text-[var(--auth-primary)]",
      )}
      onClick={() => onChange(!checked)}
      type="button"
    >
      {label}
      <span
        className={cn(
          "size-4 rounded-full border bg-current transition-opacity",
          checked ? "opacity-100" : "opacity-35",
        )}
      />
    </button>
  );
}

export function FieldConditionsModal({
  field,
  fields,
  onOpenChange,
  onSave,
  title,
}: {
  field: TemplateEditorField;
  fields: TemplateEditorField[];
  onOpenChange: (open: boolean) => void;
  onSave: (patch: Partial<TemplateEditorField>) => Promise<void>;
  title: string;
}) {
  const availableFields = fields.filter(
    (item) =>
      item.uuid !== field.uuid &&
      !createsConditionCycle(fields, item.uuid, field.uuid),
  );
  const [conditions, setConditions] = useState<TemplateFieldCondition[]>(() => {
    const current = getFieldConditions(field);
    return current.length ? current : [{}];
  });

  function updateCondition(index: number, patch: TemplateFieldCondition) {
    setConditions((current) =>
      current.map((condition, conditionIndex) =>
        conditionIndex === index ? { ...condition, ...patch } : condition,
      ),
    );
  }

  function saveConditions() {
    const normalized = conditions
      .filter((condition) => Boolean(condition.field_uuid))
      .map((condition, index) => {
        const conditionField = availableFields.find(
          (item) => item.uuid === condition.field_uuid,
        );
        const actions = getConditionActions(conditionField);
        const action = actions.includes(condition.action ?? "")
          ? condition.action
          : actions[0];

        return {
          action,
          field_uuid: condition.field_uuid,
          operation:
            index > 0 && condition.operation === "or" ? "or" : undefined,
          value: requiresConditionValue(conditionField, action)
            ? condition.value
            : undefined,
        };
      });

    void onSave({
      conditions: normalized.length ? normalized : undefined,
    }).then(() => onOpenChange(false));
  }

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent
        className="top-12 max-h-[calc(100svh-6rem)] max-w-xl -translate-y-0 gap-0 overflow-hidden border-[var(--auth-input-border)] bg-card p-0 text-[var(--auth-foreground)] shadow-2xl"
        overlayClassName="bg-black/35 backdrop-blur-none"
        showCloseButton={false}
      >
      <form
        className="flex min-h-0 flex-col overflow-hidden"
        onSubmit={(event) => {
          event.preventDefault();
          saveConditions();
        }}
      >
        <DialogHeader className="flex-row items-center justify-between border-b border-[var(--auth-input-border)] px-6 py-4">
          <DialogTitle className="text-base font-bold text-[var(--auth-primary)]">
            Condition - {title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Define when this field is shown or hidden based on another field.
          </DialogDescription>
          <DialogClose
            aria-label="Close conditions dialog"
            className="rounded-full px-2 text-xl leading-none text-[var(--auth-primary)] hover:bg-[var(--auth-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            ×
          </DialogClose>
        </DialogHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-6 py-4">
          {conditions.map((condition, index) => {
            const conditionField = availableFields.find(
              (item) => item.uuid === condition.field_uuid,
            );
            const actions = getConditionActions(conditionField);
            const action = actions.includes(condition.action ?? "")
              ? condition.action
              : actions[0];
            const options = conditionField
              ? getFieldOptions(conditionField)
              : [];

            return (
              <div
                className="rounded-xl border border-[var(--auth-input-border)] bg-background p-3"
                key={`${condition.field_uuid ?? "new"}-${index}`}
              >
                {index > 0 ? (
                  <button
                    className="mb-3 h-7 rounded-full bg-[var(--auth-primary)] px-4 text-xs font-bold text-[var(--auth-primary-foreground)]"
                    onClick={() =>
                      updateCondition(index, {
                        operation:
                          condition.operation === "or" ? undefined : "or",
                      })
                    }
                    type="button"
                  >
                    {condition.operation === "or" ? "OR" : "AND"}
                  </button>
                ) : null}
                <div className="flex flex-col gap-3">
                  <select
                    aria-label={`Condition ${index + 1} field`}
                    className="h-11 rounded-full border border-[var(--auth-input-border)] bg-card px-4 text-sm outline-none focus:border-[var(--auth-primary)] focus-visible:ring-2 focus-visible:ring-ring"
                    onChange={(event) => {
                      const nextField = availableFields.find(
                        (item) => item.uuid === event.target.value,
                      );
                      updateCondition(index, {
                        action: getConditionActions(nextField)[0],
                        field_uuid: event.target.value,
                        value: undefined,
                      });
                    }}
                    required
                    value={condition.field_uuid ?? ""}
                  >
                    <option disabled value="">
                      Select field...
                    </option>
                    {availableFields.map((item, itemIndex) => (
                      <option key={item.uuid} value={item.uuid}>
                        {item.name ||
                          buildDefaultFieldName(item.type, itemIndex)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Condition ${index + 1} comparison`}
                    className="h-11 rounded-full border border-[var(--auth-input-border)] bg-card px-4 text-sm outline-none focus:border-[var(--auth-primary)] focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={!conditionField}
                    onChange={(event) =>
                      updateCondition(index, {
                        action: event.target.value,
                        value: undefined,
                      })
                    }
                    value={action ?? ""}
                  >
                    {actions.map((item) => (
                      <option key={item} value={item}>
                        {humanizeConditionAction(item)}
                      </option>
                    ))}
                  </select>
                  {conditionField &&
                  requiresConditionValue(conditionField, action) ? (
                    isChoiceField(conditionField.type) ? (
                      <select
                        aria-label={`Condition ${index + 1} value`}
                        className="h-11 rounded-full border border-[var(--auth-input-border)] bg-card px-4 text-sm outline-none focus:border-[var(--auth-primary)] focus-visible:ring-2 focus-visible:ring-ring"
                        onChange={(event) =>
                          updateCondition(index, { value: event.target.value })
                        }
                        required
                        value={condition.value ?? ""}
                      >
                        <option disabled value="">
                          Select value...
                        </option>
                        {options.map((option, optionIndex) => (
                          <option key={option.uuid} value={option.uuid}>
                            {option.value || `Option ${optionIndex + 1}`}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        aria-label={`Condition ${index + 1} value`}
                        className="h-11 rounded-full bg-card"
                        onChange={(event) =>
                          updateCondition(index, { value: event.target.value })
                        }
                        required
                        type={
                          conditionField.type === "number" ? "number" : "text"
                        }
                        value={condition.value ?? ""}
                      />
                    )
                  ) : null}
                </div>
                {conditions.length > 1 ? (
                  <button
                    className="mt-3 text-sm font-medium text-red-600 underline-offset-4 hover:underline"
                    onClick={() =>
                      setConditions((current) =>
                        current.filter(
                          (_, conditionIndex) => conditionIndex !== index,
                        ),
                      )
                    }
                    type="button"
                  >
                    Remove condition
                  </button>
                ) : null}
              </div>
            );
          })}
          <button
            className="ml-auto text-sm font-medium text-[var(--auth-primary)] underline-offset-4 hover:underline"
            onClick={() =>
              setConditions((current) => [...current, { operation: "or" }])
            }
            type="button"
          >
            + Add condition
          </button>
        </div>
        <div className="flex flex-col gap-3 border-t border-[var(--auth-input-border)] p-4">
          <Button
            className="h-12 rounded-full bg-[var(--auth-primary)] font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
            type="submit"
          >
            SAVE
          </Button>
          {getFieldConditions(field).length > 0 ? (
            <button
              className="text-sm font-medium text-[var(--auth-primary)] underline-offset-4 hover:underline"
              onClick={() =>
                void onSave({ conditions: undefined }).then(() =>
                  onOpenChange(false),
                )
              }
              type="button"
            >
              Remove condition
            </button>
          ) : null}
        </div>
      </form>
      </DialogContent>
    </Dialog>
  );
}

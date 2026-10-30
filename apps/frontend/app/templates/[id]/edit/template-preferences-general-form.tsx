"use client";

import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useId } from "react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  EmailMarkdownEditor,
  type EmailTemplateVariable,
} from "./email-markdown-editor";
import {
  defaultExpirationOptions,
  linkFormFieldOptions,
  type PreferencesFormState,
} from "./template-preferences-types";

type GeneralPreferencesFormProps = {
  formState: PreferencesFormState;
  isSaving: boolean;
  onSave: () => Promise<void>;
  onStateChange: (state: PreferencesFormState) => void;
};

const signatureRequestEmailVariables = [
  { label: "Template name", value: "template.name" },
  { label: "Submitter link", value: "submitter.link" },
  { label: "Account name", value: "account.name" },
] satisfies EmailTemplateVariable[];

const documentsCopyEmailVariables = [
  { label: "Template name", value: "template.name" },
  { label: "Documents link", value: "documents.link" },
  { label: "Account name", value: "account.name" },
] satisfies EmailTemplateVariable[];

const completedNotificationEmailVariables = [
  { label: "Template name", value: "template.name" },
  { label: "Submission submitters", value: "submission.submitters" },
  { label: "Submission link", value: "submission.link" },
] satisfies EmailTemplateVariable[];

export function TemplatePreferencesGeneralForm({
  formState,
  isSaving,
  onSave,
  onStateChange,
}: GeneralPreferencesFormProps) {
  function patchState(patch: Partial<PreferencesFormState>) {
    onStateChange({ ...formState, ...patch });
  }

  return (
    <div className="space-y-5">
      <LabeledInput
        label="Completed documents notification BCC address"
        type="email"
        value={formState.bccCompleted}
        onChange={(bccCompleted) => patchState({ bccCompleted })}
      />
      <Button
        className="h-12 w-full rounded-full bg-[var(--auth-primary)] font-bold text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
        disabled={isSaving}
        onClick={() => void onSave()}
        type="button"
      >
        SAVE
      </Button>
      <DefaultExpirationField formState={formState} onPatch={patchState} />
      <FormPreferencesSection formState={formState} onPatch={patchState} />
      <EmailPreferencesAccordion formState={formState} onPatch={patchState} />
    </div>
  );
}

function DefaultExpirationField({
  formState,
  onPatch,
}: {
  formState: PreferencesFormState;
  onPatch: (patch: Partial<PreferencesFormState>) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <Label>Default expiration</Label>
        <Select
          value={formState.defaultExpireAtDuration || "none"}
          onValueChange={(defaultExpireAtDuration) =>
            onPatch({
              defaultExpireAtDuration,
              ...(defaultExpireAtDuration !== "specified_date"
                ? { defaultExpireAt: "" }
                : {}),
            })
          }
        >
          <SelectTrigger aria-label="Default expiration" className="!h-12 w-full rounded-full border-[var(--auth-input-border)] px-5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {defaultExpirationOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {formState.defaultExpireAtDuration === "specified_date" ? (
        <LabeledInput
          label="Expiration date"
          type="datetime-local"
          value={formState.defaultExpireAt}
          onChange={(defaultExpireAt) => onPatch({ defaultExpireAt })}
        />
      ) : null}
    </>
  );
}

function FormPreferencesSection({
  formState,
  onPatch,
}: SectionProps) {
  return (
    <PreferenceSection title="Form preferences">
      <LabeledInput
        label="Redirect on completion URL"
        type="url"
        value={formState.completedRedirectUrl}
        onChange={(completedRedirectUrl) => onPatch({ completedRedirectUrl })}
      />
      <LabeledTextarea
        label="Completion message"
        value={formState.completedMessageBody}
        onChange={(completedMessageBody) => onPatch({ completedMessageBody })}
      />
      <LinkFormFieldsPicker formState={formState} onPatch={onPatch} />
      <div className="rounded-2xl border border-[var(--auth-input-border)] bg-[var(--auth-muted)]/40 p-4">
        <div className="space-y-2">
          <Label>Account owner auto-sign</Label>
          <Select
            value={formState.ownerAutoSignMode}
            onValueChange={(ownerAutoSignMode) =>
              onPatch({
                ownerAutoSignMode:
                  ownerAutoSignMode as PreferencesFormState["ownerAutoSignMode"],
              })
            }
          >
            <SelectTrigger aria-label="Account owner auto-sign" className="h-12 rounded-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Inherit account setting</SelectItem>
              <SelectItem value="enabled">Auto-sign owner role</SelectItem>
              <SelectItem value="disabled">Do not auto-sign owner</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Completes the configured owner role with the account owner saved
          signature before sending to recipients.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <LabeledInput
            label="Owner role name"
            value={formState.ownerAutoSignRole}
            onChange={(ownerAutoSignRole) => onPatch({ ownerAutoSignRole })}
          />
          <div className="flex items-end pb-2">
            <PreferenceSwitch
              checked={formState.ownerAutoSignSendEmail}
              label="Email owner"
              onCheckedChange={(ownerAutoSignSendEmail) =>
                onPatch({ ownerAutoSignSendEmail })
              }
            />
          </div>
        </div>
      </div>
      <PreferenceSwitch
        checked={formState.requireEmailTwoFactor}
        label="Require email 2FA to open"
        onCheckedChange={(requireEmailTwoFactor) =>
          onPatch({ requireEmailTwoFactor })
        }
      />
      <PreferenceSwitch
        checked={formState.requirePhoneTwoFactor}
        label="Require phone 2FA to open"
        onCheckedChange={(requirePhoneTwoFactor) =>
          onPatch({ requirePhoneTwoFactor })
        }
      />
    </PreferenceSection>
  );
}

function LinkFormFieldsPicker({ formState, onPatch }: SectionProps) {
  return (
    <div className="space-y-3">
      <Label>Link form fields</Label>
      <div className="grid gap-3 sm:grid-cols-3">
        {linkFormFieldOptions.map((option) => (
          <label
            className="flex items-center gap-2 rounded-xl border border-[var(--auth-input-border)] px-3 py-2"
            key={option.value}
          >
            <Checkbox
              checked={formState.linkFormFields.includes(option.value)}
              onCheckedChange={(checked) =>
                onPatch({
                  linkFormFields: checked
                    ? [...formState.linkFormFields, option.value]
                    : formState.linkFormFields.filter(
                        (field) => field !== option.value,
                      ),
                })
              }
            />
            <span className="text-sm font-semibold">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SignatureRequestEmailSection({ formState, onPatch }: SectionProps) {
  return (
    <EmailSectionContent>
      <PreferenceSwitch
        checked={formState.requestEmailEnabled}
        label="Send request email"
        onCheckedChange={(requestEmailEnabled) => onPatch({ requestEmailEnabled })}
      />
      <LabeledInput
        label="Subject"
        value={formState.requestEmailSubject}
        onChange={(requestEmailSubject) => onPatch({ requestEmailSubject })}
      />
      <EmailMarkdownEditor
        label="Body"
        value={formState.requestEmailBody}
        onChange={(requestEmailBody) => onPatch({ requestEmailBody })}
        variables={signatureRequestEmailVariables}
      />
    </EmailSectionContent>
  );
}

function DocumentsCopyEmailSection({ formState, onPatch }: SectionProps) {
  return (
    <EmailSectionContent>
      <PreferenceSwitch
        checked={formState.documentsCopyEmailEnabled}
        label="Send documents copy email"
        onCheckedChange={(documentsCopyEmailEnabled) =>
          onPatch({ documentsCopyEmailEnabled })
        }
      />
      <LabeledInput
        label="Reply to"
        type="email"
        value={formState.documentsCopyEmailReplyTo}
        onChange={(documentsCopyEmailReplyTo) =>
          onPatch({ documentsCopyEmailReplyTo })
        }
      />
      <EmailTemplateFields
        body={formState.documentsCopyEmailBody}
        bodyVariables={documentsCopyEmailVariables}
        onBodyChange={(documentsCopyEmailBody) =>
          onPatch({ documentsCopyEmailBody })
        }
        onSubjectChange={(documentsCopyEmailSubject) =>
          onPatch({ documentsCopyEmailSubject })
        }
        subject={formState.documentsCopyEmailSubject}
      />
      <AttachmentSwitches
        attachAudit={formState.documentsCopyEmailAttachAudit}
        attachDocuments={formState.documentsCopyEmailAttachDocuments}
        onAttachAuditChange={(documentsCopyEmailAttachAudit) =>
          onPatch({ documentsCopyEmailAttachAudit })
        }
        onAttachDocumentsChange={(documentsCopyEmailAttachDocuments) =>
          onPatch({ documentsCopyEmailAttachDocuments })
        }
      />
    </EmailSectionContent>
  );
}

function CompletedNotificationEmailSection({ formState, onPatch }: SectionProps) {
  return (
    <EmailSectionContent>
      <PreferenceSwitch
        checked={formState.completedNotificationEmailEnabled}
        label="Send completed notification email"
        onCheckedChange={(completedNotificationEmailEnabled) =>
          onPatch({ completedNotificationEmailEnabled })
        }
      />
      <EmailTemplateFields
        body={formState.completedNotificationEmailBody}
        bodyVariables={completedNotificationEmailVariables}
        onBodyChange={(completedNotificationEmailBody) =>
          onPatch({ completedNotificationEmailBody })
        }
        onSubjectChange={(completedNotificationEmailSubject) =>
          onPatch({ completedNotificationEmailSubject })
        }
        subject={formState.completedNotificationEmailSubject}
      />
      <AttachmentSwitches
        attachAudit={formState.completedNotificationEmailAttachAudit}
        attachDocuments={formState.completedNotificationEmailAttachDocuments}
        onAttachAuditChange={(completedNotificationEmailAttachAudit) =>
          onPatch({ completedNotificationEmailAttachAudit })
        }
        onAttachDocumentsChange={(completedNotificationEmailAttachDocuments) =>
          onPatch({ completedNotificationEmailAttachDocuments })
        }
      />
    </EmailSectionContent>
  );
}

function EmailPreferencesAccordion({ formState, onPatch }: SectionProps) {
  return (
    <Accordion
      className="overflow-hidden rounded-2xl border border-[var(--auth-input-border)] bg-card"
      defaultValue="signature-request-email"
      type="single"
      collapsible
    >
      <EmailAccordionItem title="Signature request email" value="signature-request-email">
        <SignatureRequestEmailSection formState={formState} onPatch={onPatch} />
      </EmailAccordionItem>
      <EmailAccordionItem title="Documents copy email" value="documents-copy-email">
        <DocumentsCopyEmailSection formState={formState} onPatch={onPatch} />
      </EmailAccordionItem>
      <EmailAccordionItem
        title="Completed notification email"
        value="completed-notification-email"
      >
        <CompletedNotificationEmailSection
          formState={formState}
          onPatch={onPatch}
        />
      </EmailAccordionItem>
    </Accordion>
  );
}

function EmailAccordionItem({
  children,
  title,
  value,
}: {
  children: ReactNode;
  title: string;
  value: string;
}) {
  return (
    <AccordionItem
      className="border-[var(--auth-input-border)] data-[state=open]:bg-card"
      value={value}
    >
      <AccordionTrigger className="px-4 py-4 text-lg font-bold hover:no-underline">
        {title}
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4 pt-0">
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

function EmailSectionContent({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

function EmailTemplateFields({
  body,
  bodyVariables,
  onBodyChange,
  onSubjectChange,
  subject,
}: {
  body: string;
  bodyVariables: EmailTemplateVariable[];
  onBodyChange: (value: string) => void;
  onSubjectChange: (value: string) => void;
  subject: string;
}) {
  return (
    <>
      <LabeledInput label="Subject" value={subject} onChange={onSubjectChange} />
      <EmailMarkdownEditor
        label="Body"
        onChange={onBodyChange}
        value={body}
        variables={bodyVariables}
      />
    </>
  );
}

function AttachmentSwitches({
  attachAudit,
  attachDocuments,
  onAttachAuditChange,
  onAttachDocumentsChange,
}: {
  attachAudit: boolean;
  attachDocuments: boolean;
  onAttachAuditChange: (checked: boolean) => void;
  onAttachDocumentsChange: (checked: boolean) => void;
}) {
  return (
    <>
      <PreferenceSwitch
        checked={attachDocuments}
        label="Attach completed documents"
        onCheckedChange={onAttachDocumentsChange}
      />
      <PreferenceSwitch
        checked={attachAudit}
        label="Attach audit log"
        onCheckedChange={onAttachAuditChange}
      />
    </>
  );
}

function PreferenceSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <details className="group rounded-2xl border border-[var(--auth-input-border)] bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-4 text-lg font-bold">
        {title}
        <ChevronDownIcon className="size-5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 border-t border-[var(--auth-input-border)] px-4 py-4">
        {children}
      </div>
    </details>
  );
}

function LabeledInput({
  label,
  onChange,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  type?: string;
  value: string;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        autoComplete="off"
        className="h-12 rounded-full border-[var(--auth-input-border)] px-5 shadow-none focus-visible:ring-0"
        id={id}
        name={id}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </div>
  );
}

function LabeledTextarea({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        autoComplete="off"
        className="min-h-28 rounded-2xl border-[var(--auth-input-border)] px-5 py-3 shadow-none focus-visible:ring-0"
        id={id}
        name={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </div>
  );
}

function PreferenceSwitch({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl px-1 py-2">
      <span className="text-sm font-medium">{label}</span>
      <Switch aria-label={label} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

type SectionProps = {
  formState: PreferencesFormState;
  onPatch: (patch: Partial<PreferencesFormState>) => void;
};

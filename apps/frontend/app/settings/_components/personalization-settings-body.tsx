"use client"

import type React from "react"
import { useEffect, useId, useState } from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  type AccountPreferences,
  getAccountPreferences,
  updateAccountPreferences,
} from "@/lib/api/auth"
import {
  EmailMarkdownEditor,
  type EmailTemplateVariable,
} from "@/app/templates/[id]/edit/email-markdown-editor"
import { isEqual } from "@/lib/object-diff"
import { AccountBrandingSettings } from "./account-branding-settings"
import { SettingsSidebar } from "./settings-sidebar"

const invitationVariables = [
  { label: "Template name", value: "template.name" },
  { label: "Submitter link", value: "submitter.link" },
  { label: "Account name", value: "account.name" },
] satisfies EmailTemplateVariable[]

const completedVariables = [
  { label: "Template name", value: "template.name" },
  { label: "Submission submitters", value: "submission.submitters" },
  { label: "Submission link", value: "submission.link" },
] satisfies EmailTemplateVariable[]

const documentsCopyVariables = [
  { label: "Template name", value: "template.name" },
  { label: "Documents link", value: "documents.link" },
  { label: "Account name", value: "account.name" },
] satisfies EmailTemplateVariable[]

export function PersonalizationSettingsBody() {
  return (
    <div className="flex flex-wrap gap-8 md:flex-nowrap">
      <SettingsSidebar active="Personalization" />
      <PersonalizationPanel />
      <div className="hidden w-52 shrink-0 md:block" />
    </div>
  )
}

function PersonalizationPanel() {
  const [preferences, setPreferences] = useState<AccountPreferences | null>(null)

  useEffect(() => {
    getAccountPreferences()
      .then(setPreferences)
      .catch((error: unknown) =>
        toast.error("Personalization settings could not be loaded", {
          description: getErrorMessage(error),
        })
      )
  }, [])

  async function savePreferences(patch: Partial<AccountPreferences>) {
    const hasChanges = Object.entries(patch).some(([key, value]) => {
      return !isEqual(value, preferences?.[key as keyof AccountPreferences])
    })

    if (!hasChanges) {
      return
    }

    try {
      setPreferences(await updateAccountPreferences(patch))
      toast.success("Personalization settings saved")
    } catch (error) {
      toast.error("Personalization settings failed to save", {
        description: getErrorMessage(error),
      })
    }
  }

  if (!preferences) {
    return <section className="w-full max-w-xl">Loading personalization...</section>
  }

  return (
    <section className="w-full max-w-xl">
      <h1 className="text-4xl font-bold tracking-normal">Personalization</h1>
      <AccountBrandingSettings />
      <h2 className="mt-9 text-3xl font-bold">Email Templates</h2>
      <EmailTemplateAccordion
        preferences={preferences}
        onSave={savePreferences}
      />

<h2 className="mb-4 mt-9 text-4xl font-bold tracking-normal">
        Submission Form
      </h2>
      <SubmissionFormAccordion
        key={`submission-form-${stableValue({
          button: preferences.form_completed_button,
          message: preferences.form_completed_message,
        })}`}
        preferences={preferences}
        onSave={savePreferences}
      />
      <label className="mt-5 flex items-center justify-between gap-5 px-1">
        <span>Show confetti on successful completion</span>
        <Switch
          checked={preferences.form_with_confetti}
          onCheckedChange={(form_with_confetti) =>
            preferences.form_with_confetti === form_with_confetti
              ? undefined
              : void savePreferences({ form_with_confetti })
          }
        />
      </label>
    </section>
  )
}

function EmailTemplateAccordion({
  onSave,
  preferences,
}: {
  onSave: (patch: Partial<AccountPreferences>) => Promise<void>
  preferences: AccountPreferences
}) {
  return (
    <Accordion className="mt-4 space-y-4" collapsible type="single">
      <EmailTemplateItem
        key={`invitation-${stableValue(preferences.submitter_invitation_email)}`}
        label="Signature Request Email"
        onSave={(template) => onSave({ submitter_invitation_email: template })}
        template={preferences.submitter_invitation_email}
        value="signature-request"
        variables={invitationVariables}
      />
      <EmailTemplateItem
        key={`completed-${stableValue(preferences.submitter_completed_email)}`}
        label="Completed Notification Email"
        onSave={(template) =>
          onSave({
            submitter_completed_email:
              template as AccountPreferences["submitter_completed_email"],
          })
        }
        template={preferences.submitter_completed_email}
        value="completed-notification"
        variables={completedVariables}
      />
      <EmailTemplateItem
        key={`copy-${stableValue(preferences.submitter_documents_copy_email)}`}
        label="Documents copy Email"
        onSave={(template) =>
          onSave({
            submitter_documents_copy_email:
              template as AccountPreferences["submitter_documents_copy_email"],
          })
        }
        template={preferences.submitter_documents_copy_email}
        value="documents-copy"
        variables={documentsCopyVariables}
      />
    </Accordion>
  )
}

function EmailTemplateItem({
  label,
  onSave,
  template,
  value,
  variables,
}: {
  label: string
  onSave: (template: AccountPreferences["submitter_invitation_email"]) => Promise<void>
  template: AccountPreferences["submitter_invitation_email"]
  value: string
  variables: EmailTemplateVariable[]
}) {
  const [draft, setDraft] = useState(template)
  const hasChanges = !isEqual(draft, template)

  return (
    <AccordionItem
      className="overflow-hidden rounded-2xl border-0 bg-[var(--auth-muted)]"
      value={value}
    >
      <AccordionTrigger className="items-center px-4 py-4 text-xl font-bold hover:no-underline [&_[data-slot=accordion-trigger-icon]]:hidden">
        <span>{label}</span>
        <PlusIcon className="ml-auto transition-transform group-aria-expanded/accordion-trigger:rotate-45" />
      </AccordionTrigger>
      <AccordionContent className="flex flex-col gap-4 px-4 pb-4">
        <LabeledInput
          label="Subject"
          onChange={(subject) => setDraft((current) => ({ ...current, subject }))}
          value={draft.subject}
        />
        <EmailMarkdownEditor
          label="Body"
          onChange={(body) => setDraft((current) => ({ ...current, body }))}
          value={draft.body}
          variables={variables}
        />
        <Button
          className="h-12 w-full rounded-full"
          disabled={!hasChanges}
          onClick={() => void onSave(draft)}
          type="button"
        >
          SAVE
        </Button>
      </AccordionContent>
    </AccordionItem>
  )
}

function SubmissionFormAccordion({
  onSave,
  preferences,
}: {
  onSave: (patch: Partial<AccountPreferences>) => Promise<void>
  preferences: AccountPreferences
}) {
  const [message, setMessage] = useState(preferences.form_completed_message)
  const [button, setButton] = useState(preferences.form_completed_button)
  const hasMessageChanges = !isEqual(message, preferences.form_completed_message)
  const hasButtonChanges = !isEqual(button, preferences.form_completed_button)

  return (
    <Accordion className="space-y-4" collapsible type="single">
      <AccordionCard title="Completed Form Message" value="message">
        <LabeledInput
          label="Title"
          onChange={(title) => setMessage((current) => ({ ...current, title }))}
          value={message.title ?? ""}
        />
        <LabeledTextarea
          label="Body"
          onChange={(body) => setMessage((current) => ({ ...current, body }))}
          value={message.body ?? ""}
        />
        <Button
          className="h-12 w-full rounded-full"
          disabled={!hasMessageChanges}
          onClick={() => void onSave({ form_completed_message: message })}
          type="button"
        >
          SAVE
        </Button>
      </AccordionCard>
      <AccordionCard title="Completed Form Redirect Button" value="button">
        <LabeledInput
          label="Button title"
          onChange={(title) => setButton((current) => ({ ...current, title }))}
          value={button.title ?? ""}
        />
        <LabeledInput
          label="Button URL"
          onChange={(url) => setButton((current) => ({ ...current, url }))}
          value={button.url ?? ""}
        />
        <Button
          className="h-12 w-full rounded-full"
          disabled={!hasButtonChanges}
          onClick={() => void onSave({ form_completed_button: button })}
          type="button"
        >
          SAVE
        </Button>
      </AccordionCard>
    </Accordion>
  )
}

function AccordionCard({
  children,
  title,
  value,
}: {
  children: React.ReactNode
  title: string
  value: string
}) {
  return (
    <AccordionItem
      className="overflow-hidden rounded-2xl border-0 bg-[var(--auth-muted)]"
      value={value}
    >
      <AccordionTrigger className="items-center px-4 py-4 text-xl font-bold hover:no-underline [&_[data-slot=accordion-trigger-icon]]:hidden">
        <span>{title}</span>
        <PlusIcon className="ml-auto transition-transform group-aria-expanded/accordion-trigger:rotate-45" />
      </AccordionTrigger>
      <AccordionContent className="flex flex-col gap-4 px-4 pb-4">
        {children}
      </AccordionContent>
    </AccordionItem>
  )
}

function LabeledInput({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  const id = useId()

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        autoComplete="off"
        className="h-12 rounded-full"
        id={id}
        name={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </div>
  )
}

function LabeledTextarea({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string) => void
  value: string
}) {
  const id = useId()

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        autoComplete="off"
        className="min-h-28 rounded-2xl"
        id={id}
        name={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </div>
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed"
}

function stableValue(value: unknown): string {
  return JSON.stringify(value)
}

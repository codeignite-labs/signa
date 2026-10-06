import { BrandName } from "@/components/branding/brand-name";
import { BrandLogo } from "@/components/branding/brand-logo";
import Link from "next/link"
import {
  ArrowUpIcon,
  BarChart3Icon,
  Code2Icon,
  LightbulbIcon,
  MicIcon,
  PencilLineIcon,
  PlusIcon,
  SparklesIcon,
  SunMediumIcon,
} from "lucide-react"

import { AiAssistantHeaderActions } from "./ai-assistant-header-actions"
import { Button } from "@/components/ui/button"

const quickActions = [
  { label: "Weather", icon: SunMediumIcon },
  { label: "Code", icon: Code2Icon },
  { label: "Write", icon: PencilLineIcon },
  { label: "Analyze", icon: BarChart3Icon },
  { label: "Brainstorm", icon: LightbulbIcon },
]

export default function AiAssistantPage() {
  return (
    <main
      className="min-h-svh bg-[var(--auth-background)] text-[var(--auth-foreground)]"
      id="main-content"
      tabIndex={-1}
    >
      <header className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-6">
        <Link className="flex items-center gap-3" href="/">
          <BrandLogo />
        </Link>
        <nav
          aria-label="AI assistant"
          className="hidden items-center gap-10 text-sm font-semibold md:flex"
        >
          <Link href="/templates">Solutions</Link>
          <Link href="/settings/api">For Developers</Link>
          <Link href="/settings/plans">Pricing</Link>
        </nav>
        <AiAssistantHeaderActions />
      </header>

      <section className="mx-auto flex min-h-[calc(100svh-5rem)] w-full max-w-4xl flex-col items-center px-6 pt-8">
        <div className="w-full max-w-[720px] overflow-hidden rounded-2xl border border-[var(--auth-input-border)] bg-[var(--auth-card)] shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
          <div className="flex items-start gap-3 px-6 py-5">
            <SparklesIcon className="mt-1 size-5 text-[var(--auth-primary)]" />
            <div className="space-y-5">
              <h1 className="text-base font-bold">Ask <BrandName /> AI</h1>
              <p className="max-w-[520px] text-center text-sm leading-6 text-[var(--auth-label)]">
                <BrandName /> AI can help you learn about product features, pricing,
                guide you through different workflows, and generate integration
                code.
              </p>
            </div>
          </div>
          <div className="border-t border-[var(--auth-input-border)] px-5 py-4">
            <h2 className="mb-4 text-center text-xl font-semibold">
              How can I help you today?
            </h2>
            <div className="rounded-[24px] border border-[var(--auth-input-border)] bg-[var(--auth-background)] p-4 shadow-inner">
              <input
                aria-label="Ask AI"
                className="mb-6 h-7 w-full rounded bg-transparent text-base text-[var(--auth-foreground)] outline-none placeholder:text-[var(--auth-placeholder)] focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Send a message... (@ to mention, / for commands)"
                type="text"
              />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <Button
                    aria-label="Add attachment"
                    className="size-7 text-[var(--auth-label)] hover:bg-[var(--auth-muted)]"
                    size="icon"
                    variant="ghost"
                  >
                    <PlusIcon className="size-5" />
                  </Button>
                  <button className="flex items-center gap-2 text-sm font-medium text-[var(--auth-foreground)]">
                    <SparklesIcon className="size-4 text-[var(--auth-primary)]" />
                    <BrandName /> AI
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <MicIcon className="size-5 text-[var(--auth-label)]" />
                  <Button
                    aria-label="Send message"
                    className="size-8 rounded-full bg-[var(--auth-primary)] text-[var(--auth-primary-foreground)] hover:bg-[var(--auth-primary-hover)]"
                    size="icon"
                  >
                    <ArrowUpIcon className="size-5" />
                  </Button>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-3">
              {quickActions.map(({ icon: Icon, label }) => (
                <button
                  className="flex h-9 items-center gap-2 rounded-full border border-[var(--auth-input-border)] px-4 text-sm font-medium text-[var(--auth-foreground)] transition hover:bg-[var(--auth-muted)]"
                  key={label}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

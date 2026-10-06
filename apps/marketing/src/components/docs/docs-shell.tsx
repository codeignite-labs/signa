import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  Clock3Icon,
  InfoIcon,
  SparklesIcon,
  UserRoundIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/docs/docs-code-block";
import { DocsFooter } from "@/components/docs/docs-footer";
import { DocsImage } from "@/components/docs/docs-image";
import { DocsScreenshot } from "@/components/docs/docs-screenshot";
import { articleScreenshots, docsScreenshots } from "@/lib/docs/screenshots";
import { DocsMobileNav } from "@/components/docs/docs-mobile-nav";
import { docsNavGroups } from "@/components/docs/docs-nav-links";
import { DocsSearch } from "@/components/docs/docs-search";
import { DocsSidebarNav } from "@/components/docs/docs-sidebar-nav";
import { Wordmark } from "@/components/marketing/wordmark";
import { cn } from "@/lib/utils";
import { type DocsArticle, type DocsCard } from "@/lib/docs/content";

export { CodeBlock } from "@/components/docs/docs-code-block";
export { DocsFooter } from "@/components/docs/docs-footer";

type DocsShellProps = {
  children: ReactNode;
};

export function DocsShell({ children }: DocsShellProps) {
  return (
    <main
      className="min-h-svh bg-background text-foreground"
      id="main-content"
      tabIndex={-1}
    >
      <DocsSidebar />
      <div className="min-h-svh lg:pl-80">
        <DocsHeader />
        {children}
      </div>
    </main>
  );
}

export function DocsHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/92 backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between gap-4 px-5 sm:px-8">
        <DocsMobileNav groups={docsNavGroups} />
        <DocsSearch />
        <DocsHeaderNav />
      </div>
    </header>
  );
}

function DocsHeaderNav() {
  return (
    <nav
      aria-label="Documentation shortcuts"
      className="hidden items-center gap-7 text-sm font-medium text-muted-foreground min-[900px]:flex"
    >
      <Link className="transition hover:text-foreground" href="/docs/api">
        API
      </Link>
      <Link className="transition hover:text-foreground" href="/docs">
        Documentation
      </Link>
      <Link className="transition hover:text-foreground" href="/resources">
        Support
      </Link>
      <Link className="transition hover:text-foreground" href="/blog">
        Journal
      </Link>
      <span className="h-5 w-px bg-border" />
      <DocsSignInButton />
    </nav>
  );
}

function DocsSignInButton() {
  return (
    <Button
      className="h-9 rounded-full bg-foreground px-5 font-bold text-background hover:bg-foreground/85 dark:bg-primary dark:text-primary-foreground"
      nativeButton={false}
      render={<Link href="/sign-in" />}
    >
      Sign in
    </Button>
  );
}

export function DocsHero({
  badge,
  description,
  title,
}: {
  badge: string;
  description: string;
  title: string;
}) {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <DocsHeroBackground />
      <DocsContainer className="relative py-16 sm:py-20">
        <DocsHeroContent
          badge={badge}
          description={description}
          title={title}
        />
      </DocsContainer>
    </section>
  );
}

function DocsHeroBackground() {
  return (
    <>
      <div className="absolute inset-0 bg-[linear-gradient(#d9eaf5_1px,transparent_1px),linear-gradient(90deg,#d9eaf5_1px,transparent_1px)] bg-[size:40px_40px] opacity-60 dark:opacity-10" />
      <div className="absolute inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_35%_0%,rgba(155,227,200,0.55),transparent_42%),radial-gradient(circle_at_70%_0%,rgba(217,234,245,0.75),transparent_38%)] dark:bg-[radial-gradient(circle_at_35%_0%,rgba(39,99,157,0.5),transparent_42%),radial-gradient(circle_at_70%_0%,rgba(155,227,200,0.16),transparent_38%)]" />
    </>
  );
}

function DocsHeroContent({
  badge,
  description,
  title,
}: {
  badge: string;
  description: string;
  title: string;
}) {
  return (
    <>
      <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-input bg-background/80 px-4 py-2 text-sm font-bold text-muted-foreground shadow-sm">
        <SparklesIcon className="size-4 text-[#ef7a4d]" />
        {badge}
      </p>
      <h1 className="max-w-3xl text-4xl font-black tracking-normal sm:text-5xl">
        {title}
      </h1>
      <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">
        {description}
      </p>
      <DocsHeroActions />
    </>
  );
}

function DocsHeroActions() {
  return (
    <div className="mt-7 flex flex-wrap gap-3">
      <Button
        className="h-10 rounded-full bg-foreground px-5 font-bold text-background hover:bg-foreground/85"
        nativeButton={false}
        render={<Link href="/guides/quick-start" />}
      >
        Quickstart
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
      <Button
        className="h-10 rounded-full border-input bg-background/80 px-5 font-bold"
        nativeButton={false}
        render={<Link href="/docs/embedding" />}
        variant="outline"
      >
        Explore SDKs
      </Button>
    </div>
  );
}

export function CardGrid({ cards }: { cards: DocsCard[] }) {
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <Link
          className="group rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-input hover:shadow-lg"
          href={card.href}
          key={card.title}
        >
          <span className="inline-flex size-11 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground">
            <card.icon className="size-5" />
          </span>
          <h2 className="mt-5 text-lg font-black">{card.title}</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {card.description}
          </p>
          <span className="mt-5 inline-flex items-center gap-2 text-sm font-black text-emerald-500">
            Read more
            <ArrowRightIcon className="size-4 transition group-hover:translate-x-1" />
          </span>
        </Link>
      ))}
    </div>
  );
}

export function ArticleList({
  articles,
  basePath,
}: {
  articles: DocsArticle[];
  basePath: string;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {articles.map((article) => (
        <Link
          className="group flex gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:border-input hover:shadow-lg"
          href={`${basePath}/${article.slug}`}
          key={article.slug}
        >
          <DocsImage name={article.image} compact />
          <div className="min-w-0">
            <span className="text-xs font-black uppercase tracking-wide text-muted-foreground">
              {article.category}
            </span>
            <h2 className="mt-2 text-lg font-black">{article.title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {article.description}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function ArticlePage({ article }: { article: DocsArticle }) {
  return (
    <DocsShell>
      <DocsArticleBody article={article} />
    </DocsShell>
  );
}

export function DocsContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mx-auto max-w-5xl px-5 sm:px-8", className)}>
      {children}
    </section>
  );
}

function DocsSidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-50 hidden w-80 border-r border-border bg-background lg:block">
      <div className="flex h-full flex-col">
        <div className="flex h-16 items-center px-7">
          <DocsLogo />
        </div>
        <DocsSidebarNav groups={docsNavGroups} />
      </div>
    </aside>
  );
}

function DocsLogo() {
  return (
    <Link
      className="flex items-center gap-3 rounded-full text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      href="/"
    >
      <Wordmark className="h-10 w-24" />
    </Link>
  );
}

function DocsArticleBody({ article }: { article: DocsArticle }) {
  return (
    <DocsContainer className="py-14 sm:py-16">
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_220px] xl:gap-16">
        <article className="min-w-0 [overflow-wrap:anywhere]">
          <ArticleHeader article={article} />
          <ArticlePreparation article={article} />
          <ArticleSections sections={article.sections} screenshotMap={articleScreenshots[article.slug]} />
          <RelatedArticles links={article.related} />
        </article>
        <ArticleTableOfContents article={article} />
      </div>
      <DocsFooter />
    </DocsContainer>
  );
}

function ArticleHeader({ article }: { article: DocsArticle }) {
  return (
    <header>
      <p className="text-xs font-black uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
        {article.category}
      </p>
      <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-normal sm:text-5xl">
        {article.title}
      </h1>
      <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
        {article.description}
      </p>
      <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 border-y border-border py-4 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <UserRoundIcon className="size-4" />
          {article.audience}
        </span>
        <span className="inline-flex items-center gap-2">
          <Clock3Icon className="size-4" />
          {article.estimatedTime}
        </span>
      </div>
    </header>
  );
}

function ArticlePreparation({ article }: { article: DocsArticle }) {
  return (
    <div className="mt-10 grid gap-8 border-b border-border pb-10 md:grid-cols-2">
      <ArticleChecklist
        items={article.prerequisites}
        title="Before you begin"
      />
      <ArticleChecklist items={article.outcomes} title="What you will complete" />
    </div>
  );
}

function ArticleChecklist({
  items,
  title,
}: {
  items: string[];
  title: string;
}) {
  return (
    <section>
      <h2 className="text-base font-black">{title}</h2>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li
            className="flex gap-3 text-sm leading-6 text-muted-foreground"
            key={item}
          >
            <CheckCircle2Icon className="mt-1 size-4 shrink-0 text-emerald-500" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArticleSections({ sections, screenshotMap }: { sections: DocsArticle["sections"]; screenshotMap?: Record<string, keyof typeof docsScreenshots> }) {
  return (
    <div className="mt-12 space-y-14">
      {sections.map((section) => (
        <section className="scroll-mt-24" id={section.id} key={section.id}>
          <h2 className="text-2xl font-black">{section.title}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p
              className="mt-4 max-w-3xl leading-7 text-muted-foreground"
              key={paragraph}
            >
              {paragraph}
            </p>
          ))}
          {section.bullets ? <ArticleBullets items={section.bullets} /> : null}
          {section.steps ? <ArticleProcedure steps={section.steps} /> : null}
          {screenshotMap?.[section.id] && <DocsScreenshot image={docsScreenshots[screenshotMap[section.id]]} />}
          {section.code ? (
            <div className="mt-7">
              <CodeBlock
                language={section.code.language}
                title={section.code.title}
              >
                {section.code.value}
              </CodeBlock>
            </div>
          ) : null}
          {section.note ? (
            <ArticleCallout icon={InfoIcon} tone="note">
              {section.note}
            </ArticleCallout>
          ) : null}
          {section.warning ? (
            <ArticleCallout icon={AlertTriangleIcon} tone="warning">
              {section.warning}
            </ArticleCallout>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function ArticleBullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-5 max-w-3xl space-y-3">
      {items.map((item) => (
        <li
          className="flex gap-3 leading-7 text-muted-foreground"
          key={item}
        >
          <span className="mt-[0.7rem] size-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function ArticleProcedure({
  steps,
}: {
  steps: DocsArticle["sections"][number]["steps"];
}) {
  if (!steps) {
    return null;
  }

  return (
    <ol className="mt-7 max-w-3xl space-y-7">
      {steps.map((step, index) => (
        <li className="grid grid-cols-[32px_minmax(0,1fr)] gap-4" key={step.title}>
          <span className="flex size-8 items-center justify-center rounded-full border border-border bg-secondary text-sm font-black">
            {index + 1}
          </span>
          <span>
            <strong className="block font-black text-foreground">
              {step.title}
            </strong>
            <span className="mt-2 block leading-7 text-muted-foreground">
              {step.body}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function ArticleCallout({
  children,
  icon: Icon,
  tone,
}: {
  children: ReactNode;
  icon: typeof InfoIcon;
  tone: "note" | "warning";
}) {
  return (
    <div
      className={cn(
        "mt-7 flex max-w-3xl gap-3 border-l-2 px-4 py-3 text-sm leading-6",
        tone === "note"
          ? "border-emerald-500 bg-emerald-500/8 text-foreground"
          : "border-amber-500 bg-amber-500/10 text-foreground",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "note" ? "text-emerald-600" : "text-amber-600",
        )}
      />
      <p>{children}</p>
    </div>
  );
}

function RelatedArticles({ links }: { links: DocsArticle["related"] }) {
  if (links.length === 0) {
    return null;
  }

  return (
    <section className="mt-16 border-t border-border pt-10">
      <h2 className="text-2xl font-black">Continue with</h2>
      <div className="mt-6 grid gap-x-10 gap-y-4 sm:grid-cols-2">
        {links.map((link) => (
          <Link
            className="group flex items-center justify-between gap-4 border-b border-border py-3 font-bold transition hover:text-emerald-600"
            href={link.href}
            key={link.href}
          >
            {link.label}
            <ArrowRightIcon className="size-4 shrink-0 transition-transform group-hover:translate-x-1" />
          </Link>
        ))}
      </div>
    </section>
  );
}

function ArticleTableOfContents({ article }: { article: DocsArticle }) {
  return (
    <aside className="sticky top-24 hidden self-start xl:block">
      <p className="text-sm font-black">On this page</p>
      <nav className="mt-4 border-l border-border pl-4">
        {article.sections.map((section) => (
          <Link
            className="block py-1.5 text-sm leading-5 text-muted-foreground transition hover:text-foreground"
            href={`#${section.id}`}
            key={section.id}
          >
            {section.title}
          </Link>
        ))}
      </nav>
    </aside>
  );
}

export function DocsOverview({
  cards,
  description,
  guideCards,
  title,
}: {
  cards: DocsCard[];
  description: string;
  guideCards?: DocsCard[];
  title: string;
}) {
  return (
    <DocsContainer className="py-16">
      <DocsOverviewIntro description={description} title={title} />
      <DocsOverviewGettingStarted />
      {guideCards ? <DocsOverviewGuides cards={guideCards} /> : null}
      <DocsOverviewResources cards={cards} />
      <DocsFooter />
    </DocsContainer>
  );
}

function DocsOverviewIntro({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <>
      <h1 className="text-4xl font-black tracking-normal">{title}</h1>
      <p className="mt-4 max-w-3xl text-lg leading-8 text-muted-foreground">
        {description}
      </p>
      <DocsHeroActions />
    </>
  );
}

function DocsOverviewGettingStarted() {
  return (
    <section className="mt-16">
      <h2 className="text-2xl font-black">Getting started</h2>
      <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
        Start with a guided first request. You will create a workspace, prepare
        a reusable template, send a recipient, and retain the completed record.
      </p>
      <Link
        className="mt-6 inline-flex items-center gap-2 text-sm font-black text-emerald-500"
        href="/guides/quick-start"
      >
        Follow the quick start
        <ArrowRightIcon className="size-4" />
      </Link>
    </section>
  );
}

function DocsOverviewGuides({ cards }: { cards: DocsCard[] }) {
  return (
    <section className="mt-16 border-t border-border pt-10">
      <h2 className="text-2xl font-black">Guides</h2>
      <div className="mt-8 grid gap-8 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <DocsOverviewGuideLink card={card} key={card.title} />
        ))}
      </div>
    </section>
  );
}

function DocsOverviewGuideLink({ card }: { card: DocsCard }) {
  return (
    <Link href={card.href}>
      <h3 className="font-black">{card.title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {card.description}
      </p>
      <span className="mt-5 inline-flex items-center gap-2 text-sm font-black text-emerald-500">
        Read more
        <ArrowRightIcon className="size-4" />
      </span>
    </Link>
  );
}

function DocsOverviewResources({ cards }: { cards: DocsCard[] }) {
  return (
    <section className="mt-16 border-t border-border pt-10">
      <h2 className="text-2xl font-black">Resources</h2>
      <div className="mt-8">
        <CardGrid cards={cards} />
      </div>
    </section>
  );
}

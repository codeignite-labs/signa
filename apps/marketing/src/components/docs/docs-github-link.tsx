export function DocsGitHubLink() {
  return (
    <a
      aria-label="View Signa on GitHub (opens in a new tab)"
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      href="https://github.com/codeignite-labs/signa"
      rel="noopener noreferrer"
      target="_blank"
      title="View Signa on GitHub"
    >
      <svg
        aria-hidden="true"
        className="size-5"
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d="M12 .75a11.25 11.25 0 0 0-3.558 21.922c.563.104.768-.244.768-.542 0-.267-.01-.975-.015-1.913-3.13.68-3.79-1.508-3.79-1.508-.512-1.3-1.25-1.646-1.25-1.646-1.022-.7.078-.686.078-.686 1.13.08 1.724 1.16 1.724 1.16 1.005 1.723 2.637 1.225 3.279.937.102-.728.393-1.225.715-1.507-2.498-.284-5.124-1.25-5.124-5.566 0-1.23.44-2.233 1.16-3.02-.116-.285-.503-1.43.11-2.98 0 0 .945-.302 3.094 1.153A10.79 10.79 0 0 1 12 6.174c.956.004 1.918.13 2.817.38 2.148-1.455 3.09-1.153 3.09-1.153.616 1.55.229 2.695.113 2.98.722.787 1.158 1.79 1.158 3.02 0 4.327-2.63 5.28-5.136 5.558.404.35.766 1.04.766 2.096 0 1.514-.014 2.736-.014 3.108 0 .3.203.65.774.54A11.252 11.252 0 0 0 12 .75Z" />
      </svg>
      <span className="hidden sm:inline">GitHub</span>
    </a>
  );
}

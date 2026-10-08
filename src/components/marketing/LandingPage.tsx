import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { LEARNING_STEPS } from "@/components/ui/Steps";

const FEATURES = [
  {
    title: "Cards from your own material",
    body: "Type a topic or paste class notes, choose how many cards you want, and read them before they go into a deck.",
  },
  {
    title: "Three ways to practice",
    body: "Flip a card, pick the right choice, or type the answer. Each pass is practice, not a grade.",
  },
  {
    title: "Ready when you are",
    body: "Still learning stays in today’s study. Know it waits, then comes back later. Your streak stays on your account.",
  },
];

const MODES = [
  {
    name: "Flip",
    detail: "Read the question, reveal the answer, then mark Know it or Still learning.",
  },
  {
    name: "Choice",
    detail: "Pick the answer from a short list so you can check yourself without writing it out.",
  },
  {
    name: "Typing",
    detail: "Type what you remember. Useful when the wording itself is what you need to practice.",
  },
];

export function LandingPage({ signedIn = false, pending = false }: { signedIn?: boolean; pending?: boolean }) {
  const primary = signedIn
    ? { href: "/dashboard", label: "Go to your dashboard" }
    : { href: "/register", label: "Create a free account" };
  const secondary = signedIn
    ? { href: "/generate", label: "Generate cards" }
    : { href: "/login", label: "Sign in" };

  return (
    <div>
      <section className="relative overflow-hidden border-b border-border">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
        />
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16 lg:px-8 lg:py-24">
          <div className="max-w-xl space-y-6">
            <p className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-ink-secondary">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
              For students studying from their own notes
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl sm:leading-[1.08]">
              Flashcards made from the notes you already have.
            </h1>
            <p className="text-lg leading-relaxed text-ink-secondary">
              Paste a topic or your class material. AutoFlash writes the cards, keeps each deck private to
              your account, and brings them back when they are ready to study.
            </p>
            <HeroActions pending={pending} primary={primary} secondary={secondary} />
            <p className="type-helper">
              {signedIn
                ? "Your decks and progress are waiting on your dashboard."
                : "Your decks are private. Progress is for your own study, not a score or a teacher record."}
            </p>
          </div>

          <ProductPreview />
        </div>
      </section>

      <section aria-label="What you can count on" className="border-b border-border bg-surface">
        <ul className="page-shell grid gap-6 py-8 sm:grid-cols-3">
          {[
            ["Private decks", "Cards stay on your account."],
            ["Your own pace", "Study what is ready today."],
            ["Not a grade", "Know it and Still learning only."],
          ].map(([title, body]) => (
            <li key={title} className="space-y-1">
              <p className="text-sm font-semibold text-ink">{title}</p>
              <p className="type-helper">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="features" className="scroll-mt-20 border-b border-border">
        <div className="page-shell space-y-10 py-16 lg:py-20">
          <div className="max-w-2xl space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight text-ink">A study desk, not another feed.</h2>
            <p className="type-body">
              AutoFlash is built around one job: turn what you are learning into cards you can practice, then
              keep those cards where you can find them again.
            </p>
          </div>
          <ul className="grid gap-4 lg:grid-cols-3">
            {FEATURES.map((feature, index) => (
              <li key={feature.title} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 sm:p-6">
                <span
                  aria-hidden="true"
                  className="flex size-9 items-center justify-center rounded-md bg-primary-soft text-sm font-semibold text-primary"
                >
                  {index + 1}
                </span>
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-ink">{feature.title}</h3>
                  <p className="type-body">{feature.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how" className="scroll-mt-20 border-b border-border bg-surface">
        <div className="page-shell space-y-10 py-16 lg:py-20">
          <div className="max-w-2xl space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight text-ink">How a study session starts</h2>
            <p className="type-body">Four steps from the notes in front of you to a deck you can reopen tomorrow.</p>
          </div>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {LEARNING_STEPS.map((step, index) => (
              <li key={step.label} className="rounded-lg border border-border bg-background p-5">
                <p className="text-sm font-semibold text-primary">0{index + 1}</p>
                <h3 className="mt-3 text-lg font-semibold text-ink">{step.label}</h3>
                <p className="type-helper mt-2">{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-b border-border" aria-labelledby="modes-heading">
        <div className="page-shell grid gap-10 py-16 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:py-20">
          <div className="max-w-xl space-y-3">
            <h2 id="modes-heading" className="text-3xl font-semibold tracking-tight text-ink">
              Practice the card, not a score.
            </h2>
            <p className="type-body">
              Pick a mode when you open a deck. The mark you leave is only Know it or Still learning, so you
              can see what still needs another pass.
            </p>
          </div>
          <ul className="grid gap-4">
            {MODES.map((mode) => (
              <li key={mode.name} className="rounded-lg border border-border bg-surface p-5 sm:flex sm:items-start sm:gap-5">
                <h3 className="text-base font-semibold text-ink sm:w-24 sm:shrink-0">{mode.name}</h3>
                <p className="type-body mt-1 sm:mt-0">{mode.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8 lg:py-20">
          <div className="max-w-xl space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight text-ink">Open a deck and start with the notes you have.</h2>
            <p className="type-body">
              {signedIn
                ? "Your name, email, and study progress stay on your account under the Philippine Data Privacy Act of 2012."
                : "Create an account with your name and email. Your study progress stays on that account under the Philippine Data Privacy Act of 2012."}
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            {pending ? (
              <div aria-hidden="true" className="h-11 w-full rounded-md bg-background sm:w-52" />
            ) : (
              <>
                <ButtonLink href={primary.href} className="w-full sm:w-auto">
                  {signedIn ? "Open your dashboard" : "Create your account"}
                </ButtonLink>
                {!signedIn && (
                  <Link
                    href="/login"
                    className="inline-flex h-11 items-center justify-center px-2 text-base font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    I already have one
                  </Link>
                )}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function HeroActions({
  pending,
  primary,
  secondary,
}: {
  pending: boolean;
  primary: { href: string; label: string };
  secondary: { href: string; label: string };
}) {
  if (pending) {
    return (
      <div aria-hidden="true" className="flex flex-col gap-3 sm:flex-row">
        <div className="h-11 w-full rounded-md bg-surface sm:w-52" />
        <div className="h-11 w-full rounded-md bg-surface sm:w-28" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <ButtonLink href={primary.href} className="w-full sm:w-auto">
        {primary.label}
      </ButtonLink>
      <ButtonLink href={secondary.href} variant="secondary" className="w-full sm:w-auto">
        {secondary.label}
      </ButtonLink>
    </div>
  );
}

function ProductPreview() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div className="rounded-lg border border-border-strong bg-surface p-3 sm:p-4">
        <div className="mb-3 flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-error/80" />
            <span className="size-2.5 rounded-full bg-warning/80" />
            <span className="size-2.5 rounded-full bg-success/80" />
          </div>
          <p className="text-xs font-medium text-ink-muted">Biology · Cell structure</p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 sm:p-8">
          <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">Question</p>
          <p className="mt-6 text-center text-xl font-semibold leading-snug text-ink sm:text-2xl">
            What does the mitochondria do?
          </p>
          <p className="mt-6 text-center text-sm text-ink-muted">Tap the card to reveal the answer</p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="flex h-11 items-center justify-center rounded-md border-2 border-warning bg-warning-soft text-sm font-semibold text-warning">
            Still learning
          </div>
          <div className="flex h-11 items-center justify-center rounded-md bg-success-strong text-sm font-semibold text-white">
            Know it
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3">
          <p className="text-xs font-medium text-ink-muted">Ready today</p>
          <p className="text-sm font-semibold text-ink">6 cards in this deck</p>
        </div>
      </div>
    </div>
  );
}

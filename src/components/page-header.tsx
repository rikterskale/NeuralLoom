export function PageHeader({
  kicker,
  title,
  description,
}: {
  kicker?: string;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-8 max-w-2xl stagger-in">
      {kicker ? (
        <p className="mb-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          {kicker}
        </p>
      ) : null}
      <h1 className="font-display text-4xl leading-tight tracking-tight md:text-5xl">
        {title}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">{description}</p>
    </header>
  );
}

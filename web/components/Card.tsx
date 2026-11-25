import type { ReactNode } from 'react';

export function Card({ title, aside, children, className, testId }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={`card ${className ?? ''}`} data-testid={testId}>
      {(title || aside) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {aside && <span className="aside">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

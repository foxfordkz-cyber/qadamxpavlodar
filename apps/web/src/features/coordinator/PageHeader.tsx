import type { ReactNode } from 'react';

/** Единая шапка экрана: надзаголовок, заголовок, пояснение «что здесь делать» и действия. */
export function PageHeader({ eyebrow, title, lead, actions }: { eyebrow?: string; title: string; lead?: string; actions?: ReactNode }) {
  return (
    <header className="gp-pagehead">
      <div className="gp-pagehead__text">
        {eyebrow && <p className="gp-eyebrow">{eyebrow}</p>}
        <h1 className="gp-h1 gp-pagehead__title">{title}</h1>
        {lead && <p className="gp-pagehead__lead">{lead}</p>}
      </div>
      {actions && <div className="gp-pagehead__actions">{actions}</div>}
    </header>
  );
}

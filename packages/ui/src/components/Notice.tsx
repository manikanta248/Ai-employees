import type { ReactNode } from 'react';

export type NoticeProps = {
  tone: 'neutral' | 'error' | 'warning';
  title?: string;
  children: ReactNode;
  action?: ReactNode;
};

/** Empty, error and offline states all use this one component so they always look deliberate. */
export function Notice({ tone, title, children, action }: NoticeProps) {
  return (
    <div className={`hz-notice hz-notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {title ? <p className="hz-notice__title">{title}</p> : null}
      <p className="hz-notice__body">{children}</p>
      {action ? <div className="hz-notice__action">{action}</div> : null}
    </div>
  );
}

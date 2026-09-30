import { useId, type InputHTMLAttributes } from 'react';

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string;
  help?: string;
  error?: string;
};

export function TextField({ label, help, error, ...rest }: TextFieldProps) {
  const id = useId();
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="hz-field">
      <label htmlFor={id} className="hz-field__label">
        {label}
      </label>
      <input
        id={id}
        className="hz-field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {help ? (
        <p id={helpId} className="hz-field__help">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="hz-field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

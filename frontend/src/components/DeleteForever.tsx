import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api/client';
import { Button, ErrorText, Field, Input, Modal, PasswordInput } from './ui';

/**
 * Admin only: delete something for good. The admin types the name of the thing (no accidental
 * click) and their own password again (an unattended session is not enough); the server checks both.
 */
export function DeleteForever({
  title,
  endpoint,
  confirmWord,
  children,
  blocked,
  onClose,
  onDone,
}: {
  title: string;
  /** POST here with { confirm, password }. */
  endpoint: string;
  /** What the admin must type: the username or the activity title. */
  confirmWord: string;
  /** What will be removed. */
  children: ReactNode;
  /** A reason it cannot be deleted at all. */
  blocked?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const del = useMutation({
    mutationFn: () => api(endpoint, { method: 'POST', json: { confirm: typed.trim(), password } }),
    onSuccess: onDone,
  });
  const matches = typed.trim().toLowerCase() === confirmWord.trim().toLowerCase();
  return (
    <Modal open onClose={del.isPending ? () => undefined : onClose} title={title}>
      <form
        className="space-y-3"
        autoComplete="off"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (matches && password && !blocked) del.mutate();
        }}
      >
        <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">
          <p className="font-bold">This cannot be undone.</p>
          {children}
        </div>
        {blocked ? (
          <p role="alert" className="text-sm font-semibold">
            {blocked}
          </p>
        ) : (
          <>
            <Field label={`Type "${confirmWord}" to confirm`}>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label="Your password" hint="Your own admin password, to make sure it is you.">
              <PasswordInput label="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          </>
        )}
        <ErrorText error={del.error} />
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" disabled={del.isPending} onClick={onClose}>
            Cancel
          </Button>
          {!blocked && (
            <Button type="submit" variant="danger" loading={del.isPending} disabled={!matches || !password}>
              Delete for good
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}

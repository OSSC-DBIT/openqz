import { useCallback, useState, type ReactNode } from 'react';
import { Button, Modal } from './ui';

interface Ask {
  title: string;
  /** What happens, in a sentence. */
  body?: ReactNode;
  /** The word on the button that goes ahead. */
  action: string;
  danger?: boolean;
}

/**
 * A question in our own dialog instead of the browser's `confirm()` (which looks foreign,
 * cannot be styled and is blocked in some embedded browsers).
 *
 *   const [ask, dialog] = useConfirm();
 *   <Button onClick={() => void ask({ title: 'End the game?', action: 'End game' }).then((ok) => ok && end())} />
 *   {dialog}
 *
 * Deletes use `ConfirmDelete`, which asks twice.
 */
export function useConfirm(): [(q: Ask) => Promise<boolean>, ReactNode] {
  const [open, setOpen] = useState<(Ask & { done: (ok: boolean) => void }) | null>(null);
  const ask = useCallback((q: Ask) => new Promise<boolean>((done) => setOpen({ ...q, done })), []);
  const answer = (ok: boolean) => {
    open?.done(ok);
    setOpen(null);
  };
  const dialog = open ? (
    <Modal open onClose={() => answer(false)} title={open.title}>
      <div className="space-y-4">
        {open.body && <div className="text-sm text-muted">{open.body}</div>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => answer(false)}>
            Cancel
          </Button>
          <Button type="button" variant={open.danger ? 'danger' : 'primary'} onClick={() => answer(true)}>
            {open.action}
          </Button>
        </div>
      </div>
    </Modal>
  ) : null;
  return [ask, dialog];
}

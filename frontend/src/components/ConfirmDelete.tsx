import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { Button, ErrorText, Modal, Spinner } from './ui';

/** What the server says a delete takes with it (departments, sections, subjects). */
interface Impact {
  name: string;
  counts: Record<string, number>;
  blocked: string | null;
}

const COUNT_LABEL: Record<string, [string, string]> = {
  students: ['student leaves this section', 'students leave this section'],
  teacher_mappings: ['teacher mapping is removed', 'teacher mappings are removed'],
  activities: ['activity loses this label', 'activities lose this label'],
  assignments: ['assignment loses this class', 'assignments lose this class'],
  attempts: ['student attempt', 'student attempts'],
  sections: ['section', 'sections'],
  people: ['person', 'people'],
  subjects: ['subject is left without a department', 'subjects are left without a department'],
};

/**
 * Every delete asks twice. Step 1 says what will go (and, for departments, sections and
 * subjects, asks the server what hangs on it); step 2 asks "are you sure" with the buttons
 * the other way round, so a double click on Continue lands on "No, keep it".
 */
export function ConfirmDelete({
  title,
  what,
  children,
  impactUrl,
  action = 'Delete',
  run,
  onClose,
  onDone,
}: {
  title: string;
  /** The thing being deleted, as shown in the second question. */
  what: string;
  /** What happens, in a sentence or two. */
  children?: ReactNode;
  /** GET here for what the delete takes with it and whether it is allowed at all. */
  impactUrl?: string;
  /** The word on the final button. */
  action?: string;
  run: () => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const impact = useQuery({ queryKey: ['delete-impact', impactUrl], queryFn: () => api<Impact>(impactUrl!), enabled: !!impactUrl, gcTime: 0 });
  const del = useMutation({ mutationFn: run, onSuccess: onDone });
  const blocked = impact.data?.blocked ?? null;
  const lines = Object.entries(impact.data?.counts ?? {}).filter(([k, n]) => n > 0 && COUNT_LABEL[k]);
  const waiting = !!impactUrl && impact.isLoading;

  return (
    // While the request is on its way the dialog stays: closing it would look like a cancel.
    <Modal open onClose={del.isPending ? () => undefined : onClose} title={title}>
      <div className="space-y-3">
        {step === 1 ? (
          <>
            <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200">
              <p className="font-bold">
                {action} {what}?
              </p>
              {children}
              {lines.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {lines.map(([k, n]) => (
                    <li key={k}>
                      {n} {COUNT_LABEL[k][n === 1 ? 0 : 1]}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {waiting && <Spinner />}
            <ErrorText error={impact.error} />
            {blocked && (
              <p role="alert" className="text-sm font-semibold">
                {blocked}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={onClose}>
                {blocked ? 'Close' : 'Cancel'}
              </Button>
              {!blocked && (
                <Button type="button" variant="danger" disabled={waiting || !!impact.error} onClick={() => setStep(2)}>
                  Continue
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="font-bold">Are you sure?</p>
            <p className="text-sm">
              <b>{what}</b> will be gone and this cannot be undone.
            </p>
            <ErrorText error={del.error} />
            <div className="flex justify-between gap-2 pt-1">
              <Button type="button" variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
                Yes, {action.toLowerCase()}
              </Button>
              <Button type="button" disabled={del.isPending} onClick={onClose}>
                No, keep it
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

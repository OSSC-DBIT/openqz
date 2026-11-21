import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/* shadcn/ui Input, Textarea and native Select, on the OpenQZ tokens. */
const fieldClass =
  'w-full min-w-0 rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm text-foreground shadow-pop-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground hover:border-brand-200 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-brand-500/15 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive';

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn(fieldClass, className)} {...props} />;
}
function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea data-slot="textarea" className={cn(fieldClass, className)} {...props} />;
}
function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select data-slot="select" className={cn(fieldClass, 'px-3', className)} {...props} />;
}

export { Input, NativeSelect, Textarea, fieldClass };

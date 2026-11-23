import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/* shadcn/ui Badge, with the tones OpenQZ uses for states. */
const badgeVariants = cva('inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      neutral: 'border-border bg-secondary text-foreground',
      brand: 'border-brand-200/60 bg-brand-100 text-brand-700 dark:border-brand-500/30 dark:text-brand-200',
      green: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-900/30 dark:text-emerald-300',
      red: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-900/30 dark:text-red-300',
      amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/30 dark:text-amber-300',
      outline: 'border-border text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

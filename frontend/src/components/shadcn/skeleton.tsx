import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/* shadcn/ui Skeleton: a shimmering block that stands in for content while it loads. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="skeleton" aria-hidden className={cn('skeleton', className)} {...props} />;
}

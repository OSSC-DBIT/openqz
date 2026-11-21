import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/* shadcn/ui Button, on the OpenQZ tokens. */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-bold outline-none transition-[transform,box-shadow,background-color,border-color,color] duration-150 select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-brand-700',
        secondary: 'border border-border bg-card text-foreground hover:border-brand-600 hover:bg-secondary',
        outline: 'border border-border bg-transparent text-foreground hover:bg-secondary',
        ghost: 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        destructive: 'bg-red-600 text-white shadow-pop-sm hover:bg-red-700',
        link: 'text-brand-ink underline-offset-4 hover:underline',
      },
      size: {
        default: 'min-h-10 px-4 py-2',
        sm: 'min-h-8 rounded-md px-3 py-1.5 text-xs',
        lg: 'min-h-12 rounded-md px-6 py-3 text-lg',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants, type ButtonProps };

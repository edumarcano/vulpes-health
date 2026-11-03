import type { ComponentProps } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:brightness-95',
        outline: 'border border-border bg-card text-foreground hover:bg-muted',
        ghost: 'hover:bg-muted hover:text-foreground',
      },
      size: {
        default: 'min-h-11 px-4 py-2 text-sm',
        sm: 'min-h-9 rounded-md px-3 py-1.5 text-xs',
        lg: 'min-h-12 rounded-lg px-8 py-3 text-base',
        icon: 'min-h-11 min-w-11 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

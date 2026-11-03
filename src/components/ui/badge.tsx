import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-muted text-muted-foreground',
        outline: 'border-border text-foreground',
        success:
          'border-transparent bg-emerald-600/15 text-emerald-700 dark:text-emerald-400',
        destructive:
          'border-transparent bg-red-600/15 text-red-700 dark:text-red-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof badgeVariants>) {
  return (
    <div
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

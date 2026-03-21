import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
    'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
    {
        variants: {
            variant: {
                default:   'border-transparent bg-primary/20 text-primary',
                secondary: 'border-border bg-secondary text-muted-foreground',
                outline:   'border-border text-muted-foreground',
            },
        },
        defaultVariants: { variant: 'default' },
    }
);

export interface BadgeProps
    extends React.HTMLAttributes<HTMLDivElement>,
        VariantProps<typeof badgeVariants> {}

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
);

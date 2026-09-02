import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils.js';

const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  success: 'btn-success',
};

export default function Button({
  variant = 'primary',
  size,
  loading = false,
  icon: Icon,
  className,
  children,
  disabled,
  ...rest
}) {
  return (
    <button
      className={cn('btn', VARIANTS[variant] || VARIANTS.primary, size === 'sm' && 'btn-sm', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

import { type ReactNode } from 'react';
import { cn } from '../lib/utils';

interface SplashBackgroundProps {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'main';
}

export function SplashBackground({
  children,
  className,
  as: Component = 'div',
}: SplashBackgroundProps) {
  return (
    <Component
      className={cn(
        'relative min-h-screen bg-fixed bg-center bg-cover bg-no-repeat flex flex-col overflow-y-auto',
        className
      )}
      style={{ backgroundImage: 'url(/images/splash.png)' }}
    >
      {/* Dark overlay with blur */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-0" />
      {/* Content */}
      <div className="relative z-10">{children}</div>
    </Component>
  );
}


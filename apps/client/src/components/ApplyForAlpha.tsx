'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { Button } from './ui/Button';
import { cn } from '../lib/utils';

export interface ApplyForAlphaProps {
  url?: string;
  className?: string;
  ctaLabel?: string;
}

export function ApplyForAlpha({
  url,
  className,
  ctaLabel = 'Apply for Closed Alpha',
}: ApplyForAlphaProps) {
  const router = useRouter();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      const targetUrl =
        url ||
        (process.env.NEXT_PUBLIC_CLOSED_ALPHA_URL as string | undefined) ||
        'https://aavegotchi.typeform.com/defidungeons';

      if (targetUrl.startsWith('/')) {
        router.push(targetUrl);
        return;
      }
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    },
    [router, url]
  );

  return (
    <div className="w-full">
      <div className="mb-1 text-xl font-semibold text-red-300">Woops!</div>
      <p className="mb-2 text-xs text-gray-300">
        You are not authorized to play and earn rewards yet.
      </p>

      <p className="mb-2 mt-4 text-xs text-gray-300">
        Please apply via the link below. It takes less than a minute!
      </p>

      <Button
        type="button"
        className={cn(
          'mt-3 w-full rounded-lg h-[300px] overflow-hidden border border-white/10 flex flex-col items-stretch bg-gradient-to-r from-purple-500 via-indigo-500 to-blue-500 p-0 text-sm md:text-base font-semibold text-white shadow-[0_12px_35px_rgba(99,102,241,0.35)]',
          className
        )}
        onClick={handleClick}
        aria-label="Apply for Closed Alpha"
      >
        <div
          className="relative w-full overflow-hidden"
          style={{ aspectRatio: '16 / 9' }}
        >
          <Image
            src="/images/dd_closedalpha.jpeg"
            alt="Closed Alpha preview"
            fill
            sizes="(max-width: 640px) 100vw, 600px"
            className="object-cover"
            priority={false}
          />
        </div>
        <div className="px-4 pt-3 text-center">{ctaLabel}</div>

        <div className="text-xs text-gray-300 flex items-center justify-center gap-1">
          <ExternalLink className="w-3 h-3" />
          <span>via Typeform</span>
        </div>
      </Button>
    </div>
  );
}

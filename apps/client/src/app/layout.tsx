import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
import './globals.css';
import { Web3Provider } from '../components/providers/Web3Provider';
import { hudFont, sixtyfourFont } from '../lib/fonts';
import { BottomTabs } from '../components/navigation/BottomTabs';
import { SessionProvider } from '../components/providers/SessionProvider';
import { PlayerProvider } from '../components/providers/PlayerProvider';
import { BaseMiniAppReady } from '../components/base-miniapp/ready';

export const metadata: Metadata = {
  title: 'DeFi Dungeons Verse',
  description:
    'A real-time Aavegotchi dungeon world with multiplayer movement, combat, loot, progression, and DeFi rewards.',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-192x192.png',
    apple: '/icon-192x192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'DeFi Dungeons Verse',
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'fc:miniapp': JSON.stringify({
      version: 'next',
      imageUrl: `${process.env.NEXT_PUBLIC_URL ?? ''}/icon-512x512.png`,
      button: {
        title: 'Play Now',
        action: {
          type: 'launch_miniapp',
          name: 'DeFi Dungeons Verse',
          url: process.env.NEXT_PUBLIC_URL ?? '',
          splashImageUrl: `${process.env.NEXT_PUBLIC_URL ?? ''}/images/splash.png`,
          splashBackgroundColor: '#000000',
        },
      },
    }),
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#2c3e50',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${hudFont.variable} ${sixtyfourFont.variable} h-full`}
    >
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="h-full font-sans">
        <BaseMiniAppReady />
        <Web3Provider>
          <SessionProvider>
            <PlayerProvider>
              <Suspense fallback={<div className="h-full" />}>
                <div className="h-full">
                  {children}
                  <BottomTabs />
                </div>
              </Suspense>
            </PlayerProvider>
          </SessionProvider>
        </Web3Provider>
      </body>
    </html>
  );
}

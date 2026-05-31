import type { Metadata } from 'next';
import LootView from './view';
import { SplashBackground } from '../../components/SplashBackground';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Loot | DeFi Dungeon',
};

export default function LootPage() {
  return (
    <SplashBackground as="main" className="text-white">
      <div className="backdrop-blur">
        <LootView />
      </div>
    </SplashBackground>
  );
}

import type { ServerRegion } from '../components/RegionSelector';

// Define full set of regions
const ALL_REGIONS: ServerRegion[] = [
  {
    id: 'eu-helsinki',
    name: 'Europe',
    location: 'Helsinki, Finland',
    flag: '🇫🇮',
    serverUrl: process.env.NEXT_PUBLIC_EU_SERVER_URL || 'http://localhost:1999',
    status: 'online',
  },
  {
    id: 'us-ashburn',
    name: 'United States',
    location: 'Ashburn, USA',
    flag: '🇺🇸',
    serverUrl: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:1999',
    status: 'online',
  },
  {
    id: 'asia-singapore',
    name: 'Asia',
    location: 'Singapore',
    flag: '🇸🇬',
    serverUrl:
      process.env.NEXT_PUBLIC_ASIA_SERVER_URL || 'http://localhost:1999',
    status: 'online',
  },
];

export const SERVER_REGIONS: ServerRegion[] = ALL_REGIONS;

export function getServerRegion(regionId: string): ServerRegion | undefined {
  return SERVER_REGIONS.find((region) => region.id === regionId);
}

export function getDefaultRegion(): ServerRegion {
  // Try to detect user's region based on timezone
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Asia-Pacific regions
  if (
    timezone.includes('Asia/') ||
    timezone.includes('Pacific/') ||
    timezone.includes('Australia/')
  ) {
    return (
      SERVER_REGIONS.find((r) => r.id === 'asia-singapore') || SERVER_REGIONS[0]
    );
  }

  // Americas
  if (timezone.includes('America/')) {
    return (
      SERVER_REGIONS.find((r) => r.id === 'us-ashburn') || SERVER_REGIONS[0]
    );
  }

  // Default to Europe
  return (
    SERVER_REGIONS.find((r) => r.id === 'eu-helsinki') || SERVER_REGIONS[0]
  );
}

export function getServerUrlForRegion(regionId: string): string {
  const region = getServerRegion(regionId);

  if (!region) {
    console.warn(`Unknown region: ${regionId}, falling back to default`);
    return getDefaultRegion().serverUrl;
  }

  // Handle localhost development
  if (
    process.env.NODE_ENV === 'development' &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' ||
      window.location.hostname.match(/^192\.168\.\d+\.\d+$/) ||
      window.location.hostname.match(/^10\.\d+\.\d+\.\d+$/) ||
      window.location.hostname.match(/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/))
  ) {
    // Use the same hostname as the client for mobile development
    const serverHost =
      window.location.hostname === 'localhost'
        ? 'localhost'
        : window.location.hostname;
    return `http://${serverHost}:1999`;
  }

  return region.serverUrl;
}

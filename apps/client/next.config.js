const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  runtimeCaching: [
    // Supabase spritesheets PNGs
    {
      urlPattern:
        /^https?:\/\/(?:[a-z0-9-]+\.)?supabase\.co\/storage\/v1\/object\/[^/]+\/spritesheets\/.*\.png(?:\?.*)?$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'gotchi-sprites',
        matchOptions: { ignoreSearch: true },
        expiration: {
          maxEntries: 200,
          maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
    // Local sprites path (dev or fallback)
    {
      urlPattern: /^https?:\/\/[^/]+\/spritesheets\/.*\.png(?:\?.*)?$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'gotchi-sprites-local',
        expiration: {
          maxEntries: 200,
          maxAgeSeconds: 60 * 60 * 24 * 365,
        },
        cacheableResponse: {
          statuses: [0, 200],
        },
      },
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,

  experimental: {
    optimizePackageImports: ['phaser', 'colyseus.js'],
    // Increase memory limit for build process
    largePageDataBytes: 128 * 1000, // 128KB
    // Ensure serverless functions for app/api/maps include raw map files
    // from both the monorepo root data/maps and the generated client copy
    // at apps/client/data/maps so fs reads work on Vercel.
    outputFileTracingIncludes: {
      // App Router route keys use the /app path (not /src/app)
      'app/api/maps/(.*)': ['../../data/maps/**', './data/maps/**'],
    },
  },
  webpack: (config, { isServer }) => {
    // Reduce file watching intensity to mitigate EMFILE during dev
    if (!isServer) {
      const pollingInterval = (() => {
        if (
          process.env.WEBPACK_POLL &&
          !Number.isNaN(Number(process.env.WEBPACK_POLL))
        ) {
          return Number(process.env.WEBPACK_POLL);
        }
        if (process.env.NEXT_DISABLE_POLLING === '1') {
          return undefined;
        }
        return 1000;
      })();

      config.watchOptions = {
        ...(config.watchOptions || {}),
        ignored: [
          '**/node_modules/**',
          '**/.pnpm/**',
          '**/.git/**',
          '**/apps/server/public/spritesheets/**',
        ],
        aggregateTimeout: 300,
        poll: pollingInterval,
      };
    }
    // Phaser webpack configuration
    if (!isServer) {
      config.resolve.fallback = {
        fs: false,
        net: false,
        tls: false,
      };
    }

    // Optimize memory usage during build
    config.optimization = {
      ...config.optimization,
      splitChunks: {
        ...config.optimization.splitChunks,
        cacheGroups: {
          ...config.optimization.splitChunks?.cacheGroups,
          // Split large data files into separate chunks
          wearables: {
            test: /[\\/]wearables\.ts$/,
            name: 'wearables',
            chunks: 'all',
            priority: 30,
            enforce: true,
          },
          assets: {
            test: /[\\/]map-editor-assets\.ts$/,
            name: 'map-assets',
            chunks: 'all',
            priority: 25,
            enforce: true,
          },
          sprites: {
            test: /[\\/](sprite-manager|character-sprite).*\.ts$/,
            name: 'sprite-managers',
            chunks: 'all',
            priority: 20,
            enforce: true,
          },
        },
      },
    };

    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          // Allow embedding in Farcaster/Base clients. Use CSP frame-ancestors instead of X-Frame-Options.
          {
            key: 'Content-Security-Policy',
            value:
              'frame-ancestors https://* http://localhost:* http://127.0.0.1:* http://0.0.0.0:*',
          },
        ],
      },
    ];
  },
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  async redirects() {
    return [
      {
        source: '/itemTypes',
        destination: '/item-types',
        permanent: false,
      },
    ];
  },
};

module.exports = withPWA(nextConfig);

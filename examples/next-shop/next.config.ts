import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The example runs on the Node.js runtime: Prisma's SQLite client is not edge-compatible.
  serverExternalPackages: ['@prisma/client', 'prisma'],
};

export default nextConfig;

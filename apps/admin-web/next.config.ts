import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@arscio/shared'],
  poweredByHeader: false,
  // A self-contained build for servers: copy one folder, run `node server.js`.
  output: 'standalone',
  images: { unoptimized: true }, // no image-resizing service needed on the server
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
};

export default config;

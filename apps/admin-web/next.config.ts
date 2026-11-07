import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@aiedu/shared'],
  poweredByHeader: false,
};

export default config;

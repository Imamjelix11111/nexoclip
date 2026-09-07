/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['studio', 'workflow-builder'],
};

export default nextConfig;

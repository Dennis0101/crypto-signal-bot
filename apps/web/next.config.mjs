/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const api = process.env.API_BASE_URL || 'http://localhost:8080';
    return [
      {
        source: '/v1/:path*',
        destination: `${api}/v1/:path*`,
      },
      {
        source: '/health',
        destination: `${api}/health`,
      },
    ];
  },
};

export default nextConfig;


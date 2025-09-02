/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    const securityHeaders = [
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self';",
          "img-src 'self' https://i.ytimg.com data: blob:;",
          "media-src 'self' blob:;",
          "frame-src https://www.youtube.com https://www.youtube-nocookie.com;",
          "connect-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://i.ytimg.com https://s.ytimg.com https://www.google.com;",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://s.ytimg.com;",
          "style-src 'self' 'unsafe-inline';",
        ].join(' ')
      },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }
    ];
    return [{ source: '/(.*)', headers: securityHeaders }];
  }
};

module.exports = nextConfig;

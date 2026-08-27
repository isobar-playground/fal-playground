/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prototype: nothing fancy. All logic is client-side; no server env needed.
  webpack: (config, { isServer }) => {
    // @techstark/opencv-js (Grid Split tool) probes for Node built-ins in its
    // UMD wrapper even though it only runs client-side here.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;

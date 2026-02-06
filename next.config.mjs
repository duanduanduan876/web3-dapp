/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // 强制 Webpack 生成最完整的 .map 文件，不许偷懒
    config.devtool = 'source-map';
    return config;
  },
};

export default nextConfig;
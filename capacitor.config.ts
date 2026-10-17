import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.xelloss1012.yomisuba',
  appName: 'Yomisuba',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    backgroundColor: '#18181b',
  },
  plugins: {
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
    },
  },
};

export default config;

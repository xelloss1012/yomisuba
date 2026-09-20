import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ereader.japanesevertical',
  appName: 'EReader Japanese Vertical',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    backgroundColor: '#18181b',
  },
};

export default config;

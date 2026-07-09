import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.raichfx.carmagneweb',
  appName: 'CARMAGNE INSTAL',
  webDir: 'dist',
  android: {
    backgroundColor: '#050505',
    allowMixedContent: false
  }
};

export default config;

import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'tw.nori.destnutrition',
  appName: '飲食記錄',
  webDir: 'www',
  android: {
    allowMixedContent: true
  },
  server: {
    androidScheme: 'http'
  }
}

export default config

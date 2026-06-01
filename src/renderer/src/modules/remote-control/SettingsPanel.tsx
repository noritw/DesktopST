import type { AppSettings } from '../../types'

interface SettingsPanelProps {
  draft: AppSettings
}

export default function SettingsPanel({ draft }: SettingsPanelProps) {
  void draft
  return null
}

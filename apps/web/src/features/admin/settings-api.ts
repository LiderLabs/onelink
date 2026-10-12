import { request, requestList } from '../../lib/api'

export interface AdminSetting {
  key: string
  value: unknown
  type: 'boolean' | 'number' | 'json' | 'string'
  label: string | null
  group: string | null
  description: string | null
  isPublic: boolean
  updatedAt: number
}

export interface SettingPatch { key: string; value: unknown }

// This endpoint returns every setting in its data array, even when its metadata
// advertises multiple pages. Following that metadata would repeat the records.
export async function readAdminSettings(): Promise<AdminSetting[]> {
  return (await requestList<AdminSetting>('/admin/settings')).items
}

export function patchAdminSettings(settings: SettingPatch[]) {
  return request<{ settings: AdminSetting[]; changed: string[] }>('/admin/settings', {
    method: 'PATCH', body: JSON.stringify({ settings }),
  })
}

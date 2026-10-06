import { ApiError, apiErrorFromResponse, request } from '../../lib/api'
import type { MediaAsset } from './types'

export const getCurrentAvatar = async (): Promise<MediaAsset | null> =>
  (await request<{ media: MediaAsset | null }>('/media/avatar')).media

export const deleteAvatar = (id: string): Promise<void> =>
  request(`/media/${encodeURIComponent(id)}`, { method: 'DELETE' })

export function uploadAvatar(blob: Blob, options: {
  signal?: AbortSignal; onProgress?: (fraction: number) => void
}): Promise<MediaAsset> {
  return new Promise((resolve, reject) => {
    if (blob.type !== 'image/webp') { reject(new ApiError(422, 'VALIDATION_ERROR', 'Choose a WebP photo.')); return }
    const xhr = new XMLHttpRequest()
    let settled = false
    const abort = () => xhr.abort()
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abort)
      callback()
    }
    xhr.open('POST', '/api/v1/media?kind=avatar')
    xhr.withCredentials = true
    xhr.timeout = 20_000
    xhr.setRequestHeader('Content-Type', blob.type)
    xhr.setRequestHeader('Accept', 'application/json')
    xhr.upload.onprogress = event => {
      if (!settled && event.lengthComputable && event.total > 0) options.onProgress?.(Math.max(0, Math.min(1, event.loaded / event.total)))
    }
    xhr.onerror = () => finish(() => reject(new ApiError(0, 'NETWORK', 'OneLink could not be reached.')))
    xhr.ontimeout = () => finish(() => reject(new ApiError(0, 'NETWORK', 'The photo upload timed out. Please try again.')))
    xhr.onabort = () => finish(() => reject(new ApiError(0, 'NETWORK', 'The photo upload was cancelled.')))
    xhr.onload = () => finish(() => {
      let payload: unknown
      try { payload = JSON.parse(xhr.responseText) } catch { payload = null }
      const headers = new Headers()
      for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
        const colon = line.indexOf(':')
        if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim())
      }
      if (xhr.status < 200 || xhr.status >= 300) { reject(apiErrorFromResponse(xhr.status, headers, payload)); return }
      const media = (payload as { data?: MediaAsset } | null)?.data
      if (!media?.id || !media.key || !media.url) { reject(new ApiError(xhr.status, 'UNKNOWN', 'The server returned an unreadable photo.')); return }
      resolve(media)
    })
    if (options.signal?.aborted) { finish(() => reject(new ApiError(0, 'NETWORK', 'The photo upload was cancelled.'))); return }
    options.signal?.addEventListener('abort', abort, { once: true })
    xhr.send(blob)
  })
}

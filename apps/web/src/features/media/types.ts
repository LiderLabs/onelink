export interface MediaAsset {
  id: string
  key: string
  url: string
  width: number
  height: number
  bytes: number
}

export interface Crop { x: number; y: number; size: number }
export interface DecodedPhoto {
  source: ImageBitmap
  width: number
  height: number
  release: () => void
}

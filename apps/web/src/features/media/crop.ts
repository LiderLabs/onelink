import type { Crop } from './types'

export function initialCrop(width: number, height: number): Crop {
  const size = Math.min(width, height)
  return clampCrop({ x: (width - size) / 2, y: (height - size) / 2, size }, width, height)
}

export function clampCrop(crop: Crop, width: number, height: number): Crop {
  if (![width, height, crop.x, crop.y, crop.size].every(Number.isFinite) || width < 1 || height < 1) {
    throw new Error('Invalid photo crop.')
  }
  const size = Math.max(1, Math.min(crop.size, width, height))
  return { size, x: Math.max(0, Math.min(crop.x, width - size)), y: Math.max(0, Math.min(crop.y, height - size)) }
}

export function zoomCrop(crop: Crop, zoom: number, width: number, height: number): Crop {
  const size = Math.min(width, height) / Math.max(1, Math.min(4, zoom))
  return clampCrop({ x: crop.x + (crop.size - size) / 2, y: crop.y + (crop.size - size) / 2, size }, width, height)
}

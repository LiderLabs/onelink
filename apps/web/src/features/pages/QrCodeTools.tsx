import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Button } from '../../components/Button'

async function logoDataUrl(file: File): Promise<string> {
  if (file.size > 2 * 1024 * 1024) throw new Error('Choose a logo smaller than 2 MB.')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type.toLowerCase())) {
    throw new Error('Choose a JPEG, PNG, or WebP logo.')
  }
  let image: ImageBitmap
  try { image = await createImageBitmap(file) }
  catch { throw new Error('We could not read that logo image.') }
  try {
    if (!image.width || !image.height || image.width * image.height > 16_000_000) {
      throw new Error('Choose a logo with fewer than 16 million pixels.')
    }
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser could not prepare the logo.')
    const scale = Math.min(208 / image.width, 208 / image.height)
    const width = image.width * scale
    const height = image.height * scale
    context.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height)
    return canvas.toDataURL('image/png')
  } finally {
    image.close()
  }
}

function download(data: Blob, filename: string) {
  const url = URL.createObjectURL(data)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function QrCodeTools({ url, name }: { url: string; name: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState(256)
  const [margin, setMargin] = useState(4)
  const [dark, setDark] = useState('#171715')
  const [light, setLight] = useState('#ffffff')
  const [logo, setLogo] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let current = true
    setReady(false)
    setError(null)
    void QRCode.toCanvas(canvas, url, {
      width: size,
      margin,
      errorCorrectionLevel: logo ? 'H' : 'M',
      color: { dark, light },
    }).then(() => {
      if (!current) return
      if (!logo) {
        setReady(true)
        return
      }
      const image = new Image()
      image.onload = () => {
        if (!current) return
        const context = canvas.getContext('2d')
        if (!context) {
          setError('Your browser could not finish drawing the logo.')
          return
        }
        const edge = Math.round(size * 0.2)
        const inset = Math.round(edge * 0.12)
        const left = Math.round((size - edge) / 2)
        const top = Math.round((size - edge) / 2)
        context.fillStyle = light
        context.fillRect(left - inset, top - inset, edge + inset * 2, edge + inset * 2)
        context.drawImage(image, left, top, edge, edge)
        setReady(true)
      }
      image.onerror = () => {
        if (current) {
          setReady(false)
          setError('The selected logo could not be drawn.')
        }
      }
      image.src = logo
    }).catch(() => {
      if (current) {
        setReady(false)
        setError('The address could not be encoded as a QR code.')
      }
    })
    return () => { current = false }
  }, [url, size, margin, dark, light, logo])

  const savePng = () => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    canvas.toBlob((blob) => {
      if (!blob) {
        setError('Your browser could not export a PNG.')
        return
      }
      download(blob, `${name}-qr.png`)
    }, 'image/png')
  }

  const saveSvg = async () => {
    try {
      let svg = await QRCode.toString(url, {
        type: 'svg',
        width: size,
        margin,
        errorCorrectionLevel: logo ? 'H' : 'M',
        color: { dark, light },
      })
      if (logo) {
        const edge = Math.round(size * 0.2)
        const inset = Math.round(edge * 0.12)
        const logoSize = edge + inset * 2
        const offset = Math.round((size - logoSize) / 2)
        svg = svg.replace(
          '</svg>',
          `<rect x="${offset}" y="${offset}" width="${logoSize}" height="${logoSize}" fill="${light}"/><image href="${logo}" x="${offset + inset}" y="${offset + inset}" width="${edge}" height="${edge}" preserveAspectRatio="xMidYMid meet"/></svg>`,
        )
      }
      download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${name}-qr.svg`)
      setError(null)
    } catch {
      setError('Your browser could not export an SVG.')
    }
  }

  const selectLogo = async (file: File | undefined) => {
    if (!file) return
    try {
      setLogo(await logoDataUrl(file))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The logo could not be loaded.')
    }
  }

  return (
    <section className="mt-4 grid gap-5 border border-rule p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-5" aria-label="QR code options">
      <div className="justify-self-center border border-rule bg-white p-3">
        <canvas ref={canvasRef} width={size} height={size} aria-label={`QR code for ${url}`} />
      </div>
      <div className="space-y-4">
        <p className="eyebrow">A quiet signature</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs">
            Output size · {size}px
            <input aria-label="QR code output size" type="range" min={128} max={512} step={32} value={size} onChange={(event) => setSize(Number(event.currentTarget.value))} className="mt-2 block w-full accent-black" />
          </label>
          <label className="text-xs">
            Quiet margin · {margin} modules
            <input aria-label="QR code margin" type="range" min={0} max={8} step={1} value={margin} onChange={(event) => setMargin(Number(event.currentTarget.value))} className="mt-2 block w-full accent-black" />
          </label>
          <label className="text-xs">
            Code colour
            <input aria-label="QR code colour" type="color" value={dark} onChange={(event) => setDark(event.currentTarget.value)} className="mt-2 block h-10 w-full border border-rule bg-transparent p-1" />
          </label>
          <label className="text-xs">
            Paper colour
            <input aria-label="QR background colour" type="color" value={light} onChange={(event) => setLight(event.currentTarget.value)} className="mt-2 block h-10 w-full border border-rule bg-transparent p-1" />
          </label>
        </div>
        <label className="block text-xs">
          Center mark · optional
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void selectLogo(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} className="mt-2 block w-full text-sm" />
        </label>
        {logo ? <button type="button" onClick={() => setLogo(null)} className="text-xs underline underline-offset-4">Remove center mark</button> : null}
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={!ready} onClick={savePng}>Download PNG</Button>
          <Button type="button" variant="outline" onClick={() => void saveSvg()}>Download SVG</Button>
        </div>
      </div>
    </section>
  )
}

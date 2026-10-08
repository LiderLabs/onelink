import { useEffect, useRef } from 'react'

/** Native animations keep the landing page light and leave its content usable without motion. */
export function useLandingMotion() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const page = root.current
    if (!page || typeof page.animate !== 'function') return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const animations = new Set<Animation>()
    let reveals: IntersectionObserver | undefined
    let artworkVisibility: IntersectionObserver | undefined

    const stop = () => {
      reveals?.disconnect()
      artworkVisibility?.disconnect()
      animations.forEach(animation => animation.cancel())
      animations.clear()
    }
    const animate = (element: Element, frames: Keyframe[], options: KeyframeAnimationOptions) => {
      const animation = element.animate(frames, options)
      animations.add(animation)
      animation.onfinish = () => {
        // Remove animation styles so hover/focus effects remain in control.
        animation.cancel()
        animations.delete(animation)
      }
      return animation
    }
    const enter = (element: Element, delay = 0) => {
      const transform = getComputedStyle(element).transform
      const base = transform === 'none' ? '' : transform
      animate(element, [
        { opacity: 0, transform: `${base} translateY(22px)` },
        { opacity: 1, transform: `${base} translateY(0px)` },
      ], { duration: 720, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' })
    }
    const start = () => {
      stop()
      if (reducedMotion.matches) return

      page.querySelectorAll('.landing-hero-copy > *').forEach((element, index) => enter(element, index * 75))
      page.querySelectorAll('.landing-example-page, .landing-everywhere, .landing-music, .landing-social-orbit').forEach((element, index) => enter(element, 150 + index * 100))

      if (typeof IntersectionObserver === 'undefined') return
      reveals = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return
          const siblings = Array.from(entry.target.parentElement?.children ?? [])
          const stagger = entry.target.matches('.landing-destination, .landing-feature-card')
            ? Math.max(0, siblings.indexOf(entry.target)) * 55 : 0
          enter(entry.target, stagger)
          reveals?.unobserve(entry.target)
        })
      }, { threshold: .12, rootMargin: '0px 0px -32px 0px' })
      page.querySelectorAll('.landing-content .landing-section-heading, .landing-feature-card, .landing-destination, .landing-possibilities, .landing-ready, .landing-footer-card, .landing-wordmark').forEach(element => reveals?.observe(element))

      const floating = Array.from(page.querySelectorAll('.landing-orbit, .landing-art-flower')).map((element, index) => {
        const transform = getComputedStyle(element).transform
        const base = transform === 'none' ? '' : transform
        const animation = animate(element, [
          { transform: `${base} translateY(0px)` },
          { transform: `${base} translateY(-9px)` },
        ], { duration: 3200 + index * 450, iterations: Infinity, direction: 'alternate', easing: 'cubic-bezier(.45,0,.55,1)' })
        animation.pause()
        return animation
      })
      artworkVisibility = new IntersectionObserver(entries => {
        const visible = entries.some(entry => entry.isIntersecting)
        floating.forEach(animation => visible ? animation.play() : animation.pause())
      }, { threshold: .1 })
      const artwork = page.querySelector('.landing-artwork')
      if (artwork) artworkVisibility.observe(artwork)
    }

    start()
    reducedMotion.addEventListener('change', start)
    return () => {
      reducedMotion.removeEventListener('change', start)
      stop()
    }
  }, [])

  return root
}

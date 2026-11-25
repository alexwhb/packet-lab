import { useEffect, useRef } from 'react'

/**
 * Calls `callback` every `ms` while `active` is true. The interval is cleared as soon as
 * `active` turns false and on unmount; the latest callback is always the one called.
 */
export function useInterval(active: boolean, callback: () => void, ms: number) {
  const latest = useRef(callback)
  useEffect(() => {
    latest.current = callback
  })

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => latest.current(), ms)
    return () => clearInterval(id)
  }, [active, ms])
}

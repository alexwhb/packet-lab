import { useCallback, useEffect, useState } from 'react'

export const PANEL_OPEN_STORAGE_KEY = 'packet-lab.chat-open.v1'

function read(): boolean {
  try {
    return localStorage.getItem(PANEL_OPEN_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Whether the chat panel is open, remembered in this browser. */
export function usePanelOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(read)
  useEffect(() => {
    try {
      if (open) localStorage.setItem(PANEL_OPEN_STORAGE_KEY, '1')
      else localStorage.removeItem(PANEL_OPEN_STORAGE_KEY)
    } catch {
      // Blocked storage: the panel just doesn't stay open across reloads.
    }
  }, [open])
  return [open, useCallback((next: boolean) => setOpen(next), [])]
}

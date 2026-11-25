// Inline 16 px stroke icons for the chat panel. They inherit the text colour.
import type { ReactNode } from 'react'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** A speech bubble: asking a question. */
export function ChatIcon() {
  return (
    <Icon>
      <path d="M4.25 2.75h7.5a1.75 1.75 0 0 1 1.75 1.75v4.75a1.75 1.75 0 0 1-1.75 1.75H7.5l-3 2.5V11h-.25A1.75 1.75 0 0 1 2.5 9.25V4.5a1.75 1.75 0 0 1 1.75-1.75Z" />
    </Icon>
  )
}

export function PlusIcon() {
  return (
    <Icon>
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </Icon>
  )
}

export function GearIcon() {
  return (
    <Icon>
      <path d="M6.97 1.48h2.06l.26 1.69 1.21.5 1.38-1.01 1.46 1.46-1.01 1.38.5 1.21 1.69.26v2.06l-1.69.26-.5 1.21 1.01 1.38-1.46 1.46-1.38-1.01-1.21.5-.26 1.69H6.97l-.26-1.69-1.21-.5-1.38 1.01-1.46-1.46 1.01-1.38-.5-1.21-1.69-.26V6.97l1.69-.26.5-1.21-1.01-1.38 1.46-1.46 1.38 1.01 1.21-.5Z" />
      <circle cx="8" cy="8" r="2" />
    </Icon>
  )
}

export function CloseIcon() {
  return (
    <Icon>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  )
}

export function BackIcon() {
  return (
    <Icon>
      <path d="M12.5 8h-9M7 4.5 3.5 8 7 11.5" />
    </Icon>
  )
}

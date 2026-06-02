import React, { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import AgentChat from './AgentChat'

/**
 * Floating action button that opens the AI agent chat panel.
 * Bottom-right of the screen, persistent across all routes.
 */
export default function AgentBadge() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full shadow-lg
                    transition-all duration-300 flex items-center justify-center
                    group hover:scale-105 active:scale-95
                    ${open
                      ? 'bg-navy text-white'
                      : 'bg-gradient-to-br from-gold to-gold-dark text-white hover:shadow-xl'}`}
        title={open ? 'Close assistant' : 'Open AI assistant'}
      >
        {open ? (
          <X size={22} />
        ) : (
          <>
            <Sparkles size={22} className="group-hover:rotate-12 transition-transform" />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white animate-pulse" />
          </>
        )}
      </button>

      <AgentChat open={open} onClose={() => setOpen(false)} />
    </>
  )
}

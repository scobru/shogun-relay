import { useState } from 'react'

interface CopyButtonProps {
  textToCopy: string
  label?: string
  className?: string
  children?: React.ReactNode
  successContent?: React.ReactNode
}

export function CopyButton({
  textToCopy,
  label = 'Copy',
  className = '',
  children = '📋',
  successContent = '✅'
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <button
      className={className}
      onClick={handleCopy}
      title={label}
      aria-label={label}
      type="button"
    >
      {copied ? successContent : children}
    </button>
  )
}

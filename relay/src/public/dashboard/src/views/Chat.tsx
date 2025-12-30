
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'

interface ChatMessage {
  id: string
  from: string
  to: string
  text: string
  timestamp: number
  read: boolean
  incoming: boolean
}

interface ChatThread {
  pub: string
  alias?: string
  lastMessage?: ChatMessage
  unreadCount: number
}

function Chat() {
  const { isAuthenticated, getAuthHeaders } = useAuth()
  const [threads, setThreads] = useState<ChatThread[]>([])
  const [activePub, setActivePub] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [peers, setPeers] = useState<{pub: string, alias: string, lastSeen: number}[]>([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Polling for threads
  useEffect(() => {
    fetchThreads()
    fetchPeers()
    const interval = setInterval(() => {
        fetchThreads()
        fetchPeers()
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Polling for active chat
  useEffect(() => {
    if (activePub) {
      fetchMessages(activePub)
      const interval = setInterval(() => fetchMessages(activePub), 2000)
      return () => clearInterval(interval)
    }
  }, [activePub])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchThreads = async () => {
    try {
      const res = await fetch('/api/v1/chat/conversations', { 
        headers: getAuthHeaders() 
      })
      const data = await res.json()
      if (data.success) {
        setThreads(data.data)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const fetchPeers = async () => {
      try {
          const res = await fetch('/api/v1/chat/peers', { headers: getAuthHeaders() })
          const data = await res.json()
          if (data.success) setPeers(data.data)
      } catch (e) { console.error(e) }
  }

  const fetchMessages = async (pub: string) => {
    try {
      const res = await fetch(`/api/v1/chat/messages/${pub}`, { 
        headers: getAuthHeaders() 
      })
      const data = await res.json()
      if (data.success) {
        setMessages(data.data)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputText.trim() || !activePub || sending) return

    setSending(true)
    try {
      await fetch(`/api/v1/chat/messages/${activePub}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders()
        },
        body: JSON.stringify({ text: inputText })
      })
      setInputText('')
      fetchMessages(activePub) // Immediate refresh
    } catch (e) {
      alert('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const handleNewChat = () => {
      // Open modal
      const modal = document.getElementById('new_chat_modal') as HTMLDialogElement
      if (modal) modal.showModal()
  }

  const startChat = (pub: string) => {
      setActivePub(pub)
      fetchMessages(pub)
      const modal = document.getElementById('new_chat_modal') as HTMLDialogElement
      if (modal) modal.close()
  }

  const handleManualEntry = () => {
      const pub = prompt("Enter Relay Public Key:")
      if (pub && pub.length > 10) {
          startChat(pub)
      }
  }

  if (!isAuthenticated) return <div className="p-8">Please login to use Chat.</div>

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* New Chat Modal */}
      <dialog id="new_chat_modal" className="modal">
        <div className="modal-box">
            <h3 className="font-bold text-lg mb-4">Start New Chat</h3>
            <div className="max-h-60 overflow-y-auto space-y-2 mb-4">
                {peers.length === 0 && <p className="opacity-50 text-center text-sm">No peers discovered yet.</p>}
                {peers.map((peer: {pub: string, alias: string}) => (
                    <div key={peer.pub} onClick={() => startChat(peer.pub)} 
                         className="p-3 bg-base-200 rounded-lg cursor-pointer hover:bg-base-300 flex justify-between items-center group">
                        <div className="overflow-hidden">
                            <div className="font-bold text-sm truncate">{peer.alias}</div>
                            <div className="text-xs font-mono opacity-60 truncate">{peer.pub}</div>
                        </div>
                        <button className="btn btn-xs btn-primary opacity-0 group-hover:opacity-100 transition-opacity">Chat</button>
                    </div>
                ))}
            </div>
            <div className="divider">OR</div>
            <button className="btn btn-outline btn-block btn-sm" onClick={handleManualEntry}>
                Enter Public Key Manually
            </button>
        </div>
        <form method="dialog" className="modal-backdrop">
            <button>close</button>
        </form>
      </dialog>

      {/* Sidebar - Threads */}
      <div className="w-1/3 min-w-[250px] card bg-base-100 shadow-sm flex flex-col">
        <div className="p-4 border-b border-base-200 flex justify-between items-center">
            <h2 className="font-bold text-lg">💬 Chats</h2>
            <button className="btn btn-sm btn-ghost" onClick={handleNewChat}>➕ New</button>
        </div>
        <div className="overflow-y-auto flex-1 p-2">
            {threads.length === 0 && <div className="text-center opacity-50 p-4">No conversations yet</div>}
            {threads.map((thread: ChatThread) => (
                <div 
                    key={thread.pub}
                    className={`p-3 rounded-lg cursor-pointer hover:bg-base-200 transition-colors mb-2 ${activePub === thread.pub ? 'bg-primary/10 border-l-4 border-primary' : ''}`}
                    onClick={() => setActivePub(thread.pub)}
                >
                    <div className="flex justify-between items-start">
                        <span className="font-mono font-bold text-xs truncate w-2/3" title={thread.pub}>{thread.pub}</span>
                        {thread.unreadCount > 0 && <span className="badge badge-error badge-xs"></span>}
                    </div>
                    {thread.lastMessage && (
                        <p className="text-xs opacity-60 truncate mt-1">
                            {thread.lastMessage.incoming ? '📥' : '📤'} {thread.lastMessage.text}
                        </p>
                    )}
                </div>
            ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 card bg-base-100 shadow-sm flex flex-col">
        {activePub ? (
            <>
                <div className="p-4 border-b border-base-200 bg-base-200/30">
                    <span className="text-xs uppercase tracking-wider opacity-60">Chat with Relay</span>
                    <div className="font-mono text-sm truncate select-all">{activePub}</div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map((msg: ChatMessage) => (
                        <div key={msg.id} className={`chat ${msg.incoming ? 'chat-start' : 'chat-end'}`}>
                            <div className="chat-header opacity-50 text-xs mb-1">
                                {new Date(msg.timestamp).toLocaleTimeString()}
                            </div>
                            <div className={`chat-bubble ${msg.incoming ? 'chat-bubble-secondary' : 'chat-bubble-primary'}`}>
                                {msg.text}
                            </div>
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>

                <form onSubmit={handleSend} className="p-4 border-t border-base-200 flex gap-2">
                    <input 
                        type="text" 
                        className="input input-bordered w-full" 
                        placeholder="Type a message..." 
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        disabled={sending}
                    />
                    <button type="submit" className="btn btn-primary" disabled={sending}>
                        {sending ? 'Sending...' : 'Send'}
                    </button>
                </form>
            </>
        ) : (
            <div className="flex items-center justify-center flex-1 opacity-20">
                <div className="text-center">
                    <div className="text-6xl mb-4">💬</div>
                    <p>Select a conversation to start chatting</p>
                </div>
            </div>
        )}
      </div>
    </div>
  )
}

export default Chat

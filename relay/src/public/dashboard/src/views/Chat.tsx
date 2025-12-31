
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

interface LobbyMessage {
  id: string
  from: string
  alias: string
  text: string
  timestamp: number
}

interface ConsoleEntry {
  id: string
  type: 'command' | 'response'
  text: string
  timestamp: number
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
  
  // Tab state
  const [activeTab, setActiveTab] = useState<'console' | 'lobby' | 'private'>('console')
  
  // Lobby state
  const [lobbyMessages, setLobbyMessages] = useState<LobbyMessage[]>([])
  const [lobbyInput, setLobbyInput] = useState('')
  
  // Console state
  const [consoleHistory, setConsoleHistory] = useState<ConsoleEntry[]>([])
  const [consoleInput, setConsoleInput] = useState('')
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const lobbyEndRef = useRef<HTMLDivElement>(null)
  const consoleEndRef = useRef<HTMLDivElement>(null)

  // Polling for threads and lobby
  useEffect(() => {
    fetchThreads()
    fetchPeers()
    fetchLobby()
    const interval = setInterval(() => {
        fetchThreads()
        fetchPeers()
        if (activeTab === 'lobby') fetchLobby()
    }, 3000)
    return () => clearInterval(interval)
  }, [activeTab])

  // Polling for active chat
  useEffect(() => {
    if (activePub && activeTab === 'private') {
      fetchMessages(activePub)
      const interval = setInterval(() => fetchMessages(activePub), 2000)
      return () => clearInterval(interval)
    }
  }, [activePub, activeTab])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    lobbyEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lobbyMessages])

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [consoleHistory])

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

  const fetchLobby = async () => {
    try {
      const res = await fetch('/api/v1/chat/lobby', { headers: getAuthHeaders() })
      const data = await res.json()
      if (data.success) {
        setLobbyMessages(data.data)
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

  const handleSendLobby = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!lobbyInput.trim() || sending) return

    setSending(true)
    try {
      await fetch('/api/v1/chat/lobby', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders()
        },
        body: JSON.stringify({ text: lobbyInput })
      })
      setLobbyInput('')
      fetchLobby() // Immediate refresh
    } catch (e) {
      alert('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const handleConsoleCommand = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!consoleInput.trim() || sending) return

    const command = consoleInput.startsWith('/') ? consoleInput : `/${consoleInput}`
    
    // Add command to history
    const cmdEntry: ConsoleEntry = {
      id: Date.now().toString(),
      type: 'command',
      text: command,
      timestamp: Date.now()
    }
    setConsoleHistory(prev => [...prev, cmdEntry])
    setConsoleInput('')

    setSending(true)
    try {
      const res = await fetch('/api/v1/chat/console', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders()
        },
        body: JSON.stringify({ command })
      })
      const data = await res.json()
      
      // Add response to history
      const respEntry: ConsoleEntry = {
        id: (Date.now() + 1).toString(),
        type: 'response',
        text: data.success ? data.response : `❌ Error: ${data.error}`,
        timestamp: Date.now()
      }
      setConsoleHistory(prev => [...prev, respEntry])
    } catch (e) {
      const errEntry: ConsoleEntry = {
        id: (Date.now() + 1).toString(),
        type: 'response',
        text: '❌ Network error',
        timestamp: Date.now()
      }
      setConsoleHistory(prev => [...prev, errEntry])
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
      setActiveTab('private')
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

      {/* Sidebar */}
      <div className="w-1/3 min-w-[250px] card bg-base-100 shadow-sm flex flex-col">
        {/* Tabs */}
        <div className="tabs tabs-boxed bg-transparent p-2">
            <a className={`tab ${activeTab === 'console' ? 'tab-active' : ''}`} onClick={() => setActiveTab('console')}>🤖 Console</a>
            <a className={`tab ${activeTab === 'lobby' ? 'tab-active' : ''}`} onClick={() => setActiveTab('lobby')}>📢 Lobby</a>
            <a className={`tab ${activeTab === 'private' ? 'tab-active' : ''}`} onClick={() => setActiveTab('private')}>🔒 Private</a>
        </div>

        {activeTab === 'console' && (
          <div className="flex-1 flex flex-col p-4">
            <h2 className="font-bold text-lg mb-2">🤖 Bot Console</h2>
            <p className="text-xs opacity-60 mb-4">Execute relay commands directly.</p>
            <div className="bg-base-200 rounded-lg p-3 space-y-2">
              <div className="text-xs font-mono">
                <div className="opacity-70">Available commands:</div>
                <div className="mt-1 space-y-1">
                  <div><span className="text-primary">/help</span> - List commands</div>
                  <div><span className="text-primary">/status</span> - Relay status</div>
                  <div><span className="text-primary">/search</span> &lt;query&gt;</div>
                  <div><span className="text-primary">/add</span> &lt;magnet&gt;</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'private' && (
          <>
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
          </>
        )}

        {activeTab === 'lobby' && (
          <div className="flex-1 flex flex-col p-4">
            <h2 className="font-bold text-lg mb-2">📢 Public Lobby</h2>
            <p className="text-xs opacity-60 mb-4">Global chat room for all relays. Not encrypted.</p>
            <div className="stats stats-vertical bg-base-200 shadow-sm">
              <div className="stat">
                <div className="stat-title">Online Relays</div>
                <div className="stat-value text-2xl">{peers.length}</div>
              </div>
              <div className="stat">
                <div className="stat-title">Messages (24h)</div>
                <div className="stat-value text-2xl">{lobbyMessages.length}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 card bg-base-100 shadow-sm flex flex-col">
        {activeTab === 'console' ? (
          <>
            <div className="p-4 border-b border-base-200 bg-gradient-to-r from-success/10 to-info/10">
                <span className="text-lg font-bold">🤖 Relay Console</span>
                <div className="text-xs opacity-60">Execute commands • Type /help to get started</div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-base-200/30 font-mono text-sm">
                {consoleHistory.length === 0 && (
                    <div className="text-center opacity-50 py-8">
                        <div className="text-4xl mb-2">🤖</div>
                        <p className="font-sans">Type a command to get started</p>
                        <p className="text-xs mt-2 font-sans">Try: /help, /status, /search linux</p>
                    </div>
                )}
                {consoleHistory.map((entry: ConsoleEntry) => (
                    <div key={entry.id} className={`overflow-hidden max-w-full ${entry.type === 'command' ? 'text-primary' : 'text-base-content'}`}>
                        {entry.type === 'command' ? (
                            <div className="flex items-start gap-2 overflow-hidden">
                                <span className="text-success flex-shrink-0">$</span>
                                <span className="break-all">{entry.text}</span>
                            </div>
                        ) : (
                            <div className="pl-4 whitespace-pre-wrap break-all opacity-90">{entry.text}</div>
                        )}
                    </div>
                ))}
                <div ref={consoleEndRef} />
            </div>

            <form onSubmit={handleConsoleCommand} className="p-4 border-t border-base-200 flex gap-2">
                <span className="flex items-center text-success font-mono">$</span>
                <input 
                    type="text" 
                    className="input input-bordered w-full font-mono" 
                    placeholder="/help" 
                    value={consoleInput}
                    onChange={e => setConsoleInput(e.target.value)}
                    disabled={sending}
                />
                <button type="submit" className="btn btn-primary" disabled={sending}>
                    {sending ? '...' : 'Run'}
                </button>
            </form>
          </>
        ) : activeTab === 'lobby' ? (
          <>
            <div className="p-4 border-b border-base-200 bg-gradient-to-r from-primary/10 to-secondary/10">
                <span className="text-lg font-bold">📢 Shogun Lobby</span>
                <div className="text-xs opacity-60">Global public chat • All messages visible to everyone</div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {lobbyMessages.length === 0 && (
                    <div className="text-center opacity-50 py-8">
                        <div className="text-4xl mb-2">🌐</div>
                        <p>No messages yet. Be the first!</p>
                    </div>
                )}
                {lobbyMessages.map((msg: LobbyMessage) => (
                    <div key={msg.id} className="chat chat-start max-w-full overflow-hidden">
                        <div className="chat-header opacity-70 text-xs mb-1">
                            <span className="font-bold">{msg.alias}</span>
                            <span className="ml-2">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div className="chat-bubble chat-bubble-accent break-all overflow-hidden max-w-full">
                            {msg.text}
                        </div>
                    </div>
                ))}
                <div ref={lobbyEndRef} />
            </div>

            <form onSubmit={handleSendLobby} className="p-4 border-t border-base-200 flex gap-2">
                <input 
                    type="text" 
                    className="input input-bordered w-full" 
                    placeholder="Say something to everyone..." 
                    value={lobbyInput}
                    onChange={e => setLobbyInput(e.target.value)}
                    disabled={sending}
                />
                <button type="submit" className="btn btn-primary" disabled={sending}>
                    {sending ? 'Sending...' : 'Send'}
                </button>
            </form>
          </>
        ) : activePub ? (
            <>
                <div className="p-4 border-b border-base-200 bg-base-200/30 flex justify-between items-start">
                    <div>
                        <span className="text-xs uppercase tracking-wider opacity-60">Chat with Relay</span>
                        <div className="font-mono text-sm truncate select-all">{activePub}</div>
                    </div>
                    <button 
                        className="btn btn-xs btn-ghost text-error" 
                        onClick={async () => {
                            if (!confirm('Clear all messages in this conversation?')) return
                            try {
                                await fetch(`/api/v1/chat/conversations/${activePub}`, {
                                    method: 'DELETE',
                                    headers: getAuthHeaders()
                                })
                                setMessages([])
                                fetchThreads()
                            } catch (e) {
                                alert('Failed to clear conversation')
                            }
                        }}
                    >
                        🗑️ Clear
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map((msg: ChatMessage) => (
                        <div key={msg.id} className={`chat max-w-full overflow-hidden ${msg.incoming ? 'chat-start' : 'chat-end'}`}>
                            <div className="chat-header opacity-50 text-xs mb-1">
                                {new Date(msg.timestamp).toLocaleTimeString()}
                            </div>
                            <div className={`chat-bubble break-all overflow-hidden max-w-full ${msg.incoming ? 'chat-bubble-secondary' : 'chat-bubble-primary'}`}>
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

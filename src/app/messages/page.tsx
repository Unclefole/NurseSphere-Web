'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { DashboardLayout } from '@/components/layout'
import { supabase } from '@/lib/supabase'
import {
  ArrowLeft,
  Search,
  MessageCircle,
  ChevronRight,
  Loader2,
  Circle,
} from 'lucide-react'
import { format, isToday, isYesterday } from 'date-fns'

interface MessageWithSender {
  id: string
  sender_id: string
  recipient_id: string
  subject: string | null
  content: string
  read: boolean
  created_at: string
  sender: {
    full_name: string | null
    email: string
    avatar_url: string | null
  }
}

export default function MessagesPage() {
  const { user, loading: authLoading, isHospital } = useAuth()
  const router = useRouter()
  const [messages, setMessages] = useState<MessageWithSender[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/signin')
      return
    }

    if (!authLoading && user && !isHospital) {
      router.push('/nurse')
      return
    }
  }, [user, authLoading, isHospital, router])

  useEffect(() => {
    if (!user) return

    const fetchMessages = async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase
          .from('messages')
          .select(`
            id,
            sender_id,
            recipient_id,
            subject,
            content,
            read,
            created_at,
            sender:profiles!sender_id (
              full_name,
              email,
              avatar_url
            )
          `)
          .eq('recipient_id', user.id)
          .order('created_at', { ascending: false })

        if (error) {
          console.error('Error fetching messages:', error)
          return
        }

        setMessages(data as unknown as MessageWithSender[] || [])
      } catch (error) {
        console.error('Error:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchMessages()
  }, [user])

  const filteredMessages = messages.filter((msg) => {
    if (!searchQuery) return true
    const searchLower = searchQuery.toLowerCase()
    return (
      msg.sender.full_name?.toLowerCase().includes(searchLower) ||
      msg.sender.email.toLowerCase().includes(searchLower) ||
      msg.subject?.toLowerCase().includes(searchLower) ||
      msg.content.toLowerCase().includes(searchLower)
    )
  })

  const formatMessageDate = (dateStr: string) => {
    const date = new Date(dateStr)
    if (isToday(date)) return format(date, 'h:mm a')
    if (isYesterday(date)) return 'Yesterday'
    return format(date, 'MMM d')
  }

  const markAsRead = async (messageId: string) => {
    try {
      await supabase
        .from('messages')
        .update({ read: true, read_at: new Date().toISOString() })
        .eq('id', messageId)

      setMessages(messages.map(m => 
        m.id === messageId ? { ...m, read: true } : m
      ))
    } catch (error) {
      console.error('Error marking message as read:', error)
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ns-dark-950">
        <div className="animate-pulse text-ns-teal">Loading...</div>
      </div>
    )
  }

  if (!user || !isHospital) {
    return null
  }

  const unreadCount = messages.filter(m => !m.read).length

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/dashboard"
            className="p-2 rounded-lg bg-ns-dark-800 border border-ns-dark-600 hover:border-ns-teal/50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              Messages
              {unreadCount > 0 && (
                <span className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-ns-teal px-2 text-xs font-medium text-white">
                  {unreadCount}
                </span>
              )}
            </h1>
            <p className="text-gray-400 text-sm">View conversations</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search messages..."
            className="ns-input pl-10 w-full"
          />
        </div>

        {/* Messages list */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-ns-teal" />
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="ns-card p-12 text-center">
            <MessageCircle className="h-12 w-12 mx-auto mb-4 text-gray-600" />
            <h3 className="text-lg font-medium text-white mb-2">No messages found</h3>
            <p className="text-gray-400">
              {searchQuery
                ? 'Try adjusting your search'
                : 'Messages from nurses will appear here'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredMessages.map((message) => (
              <Link
                key={message.id}
                href={`/messages/${message.id}`}
                onClick={() => !message.read && markAsRead(message.id)}
                className={`ns-card p-4 flex items-center gap-4 group transition-colors ${
                  !message.read ? 'bg-ns-dark-700/50 border-ns-teal/30' : ''
                }`}
              >
                {/* Avatar */}
                <div className="relative">
                  <div className="w-12 h-12 rounded-full bg-ns-dark-700 flex items-center justify-center flex-shrink-0">
                    {message.sender.avatar_url ? (
                      <img
                        src={message.sender.avatar_url}
                        alt=""
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <span className="text-lg font-medium text-ns-teal">
                        {message.sender.full_name?.[0] || 'U'}
                      </span>
                    )}
                  </div>
                  {!message.read && (
                    <Circle className="absolute -top-1 -right-1 h-3 w-3 fill-ns-teal text-ns-teal" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <h3 className={`font-medium truncate ${!message.read ? 'text-white' : 'text-gray-300'}`}>
                      {message.sender.full_name || message.sender.email}
                    </h3>
                    <span className="text-xs text-gray-500 flex-shrink-0">
                      {formatMessageDate(message.created_at)}
                    </span>
                  </div>
                  {message.subject && (
                    <p className={`text-sm truncate ${!message.read ? 'text-white' : 'text-gray-400'}`}>
                      {message.subject}
                    </p>
                  )}
                  <p className="text-sm text-gray-500 truncate">
                    {message.content}
                  </p>
                </div>

                {/* Arrow */}
                <ChevronRight className="h-5 w-5 text-gray-600 group-hover:text-ns-teal transition-colors flex-shrink-0" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}


"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MessageSquare, Download, Trash2, User, Bot } from "lucide-react"

export interface TranscriptMessage {
  id: string
  speaker: "user" | "agent"
  message: string
  timestamp: Date
}

interface ConversationTranscriptProps {
  isRecording?: boolean
  messages?: TranscriptMessage[]
  onClearTranscript?: () => void
}

export default function ConversationTranscript({ 
  isRecording = false, 
  messages: externalMessages,
  onClearTranscript 
}: ConversationTranscriptProps) {
  const [internalMessages, setInternalMessages] = useState<TranscriptMessage[]>([])
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  // Use external messages if provided, otherwise use internal state
  const messages = externalMessages || internalMessages

  // Update internal messages when external messages change
  useEffect(() => {
    if (externalMessages) {
      setInternalMessages(externalMessages)
    }
  }, [externalMessages])

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [messages])

  const clearTranscript = () => {
    if (onClearTranscript) {
      onClearTranscript()
    } else {
      setInternalMessages([])
    }
  }

  const downloadTranscript = () => {
    const transcript = messages
      .map(
        (msg) => `[${msg.timestamp.toLocaleTimeString()}] ${msg.speaker === "user" ? "You" : "Agent"}: ${msg.message}`,
      )
      .join("\n")

    const blob = new Blob([transcript], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `conversation-${new Date().toISOString().split("T")[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="w-5 h-5" />
            Conversation Transcript
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={downloadTranscript}
              disabled={messages.length === 0}
            >
              <Download className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={clearTranscript}
              disabled={messages.length === 0}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-64 w-full" ref={scrollAreaRef}>
          <div className="space-y-3">
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-8">
                {isRecording ? "Waiting for conversation..." : "Start a conversation to see transcript"}
              </div>
            ) : (
              messages.map((message) => (
                <div key={message.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    {message.speaker === "user" ? (
                      <User className="w-4 h-4" />
                    ) : (
                      <Bot className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">
                        {message.speaker === "user" ? "You" : "Agent"}
                      </span>
                      <span className="text-xs text-muted-foreground">{message.timestamp.toLocaleTimeString()}</span>
                    </div>
                    <p className="text-sm">{message.message}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

import { useState, useEffect, useCallback } from "react"
import { useRoomContext } from "@livekit/components-react"
import { TranscriptMessage } from "@/components/conversation-transcript"

export function useTranscription() {
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const room = useRoomContext()
  
  // Subscribe to data messages for transcription
  useEffect(() => {
    if (!room) return

    const handleDataReceived = (payload: Uint8Array, participant?: any) => {
      try {
        const decoder = new TextDecoder()
        const message = JSON.parse(decoder.decode(payload))
        
        // Handle transcription messages
        if (message.type === 'transcription') {
          const newMessage: TranscriptMessage = {
            id: `${Date.now()}-${Math.random()}`,
            speaker: message.speaker || (participant?.identity?.includes('agent') ? 'agent' : 'user'),
            message: message.text,
            timestamp: new Date(message.timestamp || Date.now())
          }
          
          setMessages(prev => [...prev, newMessage])
        }
      } catch (error) {
        console.error('Error parsing transcription data:', error)
      }
    }

    room.on('dataReceived', handleDataReceived)

    return () => {
      room.off('dataReceived', handleDataReceived)
    }
  }, [room])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  return {
    messages,
    clearMessages
  }
}

import { useState, useEffect } from "react"
import VoiceChatRoom from "@/components/voice-chat-room"
import VoiceOnboarding from "@/components/voice-onboarding"

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

export default function App() {
  const [isConnected, setIsConnected] = useState(false)
  const [roomName, setRoomName] = useState("voice-agent-room")
  const [token, setToken] = useState("")
  const [participantName, setParticipantName] = useState("")
  const [showOnboarding, setShowOnboarding] = useState(true)
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false)

  // Check if user has completed onboarding before
  useEffect(() => {
    const completedOnboarding = localStorage.getItem('voice-chat-onboarding-completed')
    const savedName = localStorage.getItem('voice-chat-participant-name')

    if (completedOnboarding === 'true' && savedName) {
      setHasCompletedOnboarding(true)
      setParticipantName(savedName)
      // Still show onboarding but with skip option for returning users
    }
  }, [])

  const handleDisconnect = () => {
    setIsConnected(false)
    setToken("")
    setShowOnboarding(true) // Return to onboarding when disconnecting
  }

  const handleOnboardingComplete = async (data: {
    participantName: string
    roomName: string
    inputDevice: string
    outputDevice: string
  }) => {
    setParticipantName(data.participantName)
    setRoomName(data.roomName)
    setShowOnboarding(false)

    // Save onboarding completion and user preferences
    localStorage.setItem('voice-chat-onboarding-completed', 'true')
    localStorage.setItem('voice-chat-participant-name', data.participantName)
    localStorage.setItem('voice-chat-room-name', data.roomName)

    // Auto-connect after onboarding
    try {
      const response = await fetch(`${API_BASE_URL}/livekit/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName: data.roomName, participantName: data.participantName }),
      })

      const responseData = await response.json()

      if (!response.ok) {
        throw new Error(responseData.error || "Failed to generate token")
      }

      setToken(responseData.token)
      setIsConnected(true)
    } catch (err) {
      console.error("Connection failed:", err)
      // If connection fails, return to onboarding with error
      setShowOnboarding(true)
    }
  }

  const handleSkipOnboarding = async () => {
    const savedName = localStorage.getItem('voice-chat-participant-name') || "user-" + Math.random().toString(36).substring(2, 8)
    const savedRoom = localStorage.getItem('voice-chat-room-name') || "voice-agent-room"

    setParticipantName(savedName)
    setRoomName(savedRoom)
    setShowOnboarding(false)

    // Auto-connect with saved preferences
    try {
      const response = await fetch(`${API_BASE_URL}/livekit/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName: savedRoom, participantName: savedName }),
      })

      const responseData = await response.json()

      if (!response.ok) {
        throw new Error(responseData.error || "Failed to generate token")
      }

      setToken(responseData.token)
      setIsConnected(true)
    } catch (err) {
      console.error("Connection failed:", err)
      // If connection fails, return to onboarding
      setShowOnboarding(true)
    }
  }

  // Show onboarding first
  if (showOnboarding) {
    return (
      <VoiceOnboarding
        onComplete={handleOnboardingComplete}
        showSkipOption={hasCompletedOnboarding}
        onSkip={handleSkipOnboarding}
      />
    )
  }

  // Show voice chat room when connected
  if (isConnected) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-6xl mx-auto">
          <VoiceChatRoom token={token} roomName={roomName} onDisconnect={handleDisconnect} />
        </div>
      </div>
    )
  }

  // This shouldn't normally be reached, but just in case
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="text-center">
        <p>Loading...</p>
      </div>
    </div>
  )
}
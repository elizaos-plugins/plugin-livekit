import { useState, useEffect } from "react"
import VoiceChatRoom from "@/components/voice-chat-room"
import VoiceOnboarding from "@/components/voice-onboarding"

const port = import.meta.env.VITE_SERVER_PORT
const API_BASE_URL = `http://localhost:${port || 3000}`

interface AgentInfo {
  id: string
  name: string
  avatar: string | null
}

export default function App() {
  const [roomName, setRoomName] = useState("voice-agent-room")
  const [token, setToken] = useState("")
  const [participantName, setParticipantName] = useState("")
  const [showOnboarding, setShowOnboarding] = useState(true)
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false)
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null)

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
    setToken("")
    setAgentInfo(null)
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
      console.log("Jsonnnnn",JSON.stringify({
        roomName: data.roomName,
        participantName: data.participantName,
      }))
      const response = await fetch(`${API_BASE_URL}/livekit/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomName: data.roomName,
          participantName: data.participantName,
        }),
      })

      console.log("repsonseeeee", response);

      const result = await response.json()

      console.log("resulttttt", result);

      if ('error' in result) {
        throw new Error(result.error)
      }

      if (!result.token || !result.url) {
        throw new Error('Failed to get room token')
      }

      setToken(result.token)
      if (result.agent) {
        setAgentInfo(result.agent)
      }
    } catch (error) {
      console.error("Failed to connect after onboarding:", error)
      // Don't show onboarding again on error
    }
  }

  const handleSkipOnboarding = async () => {
    const savedRoomName = localStorage.getItem('voice-chat-room-name') || roomName
    setRoomName(savedRoomName)
    setShowOnboarding(false)

    // Auto-connect with saved preferences
    try {
      const response = await fetch(`${API_BASE_URL}/livekit/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomName: savedRoomName,
          participantName: participantName,
        }),
      })

      const result = await response.json()

      if ('error' in result) {
        throw new Error(result.error)
      }

      if (!result.token || !result.url) {
        throw new Error('Failed to get room token')
      }

      setToken(result.token)
      if (result.agent) {
        setAgentInfo(result.agent)
      }
    } catch (error) {
      console.error("Failed to connect:", error)
    }
  }

  return (
    <div
      className="dark antialiased font-sans min-h-screen bg-background p-4"
      style={{
        colorScheme: 'dark',
      }}
    >
      {showOnboarding ? (
        <VoiceOnboarding
          onComplete={handleOnboardingComplete}
          showSkipOption={hasCompletedOnboarding}
          onSkip={handleSkipOnboarding}
        />
      ) : (
        <VoiceChatRoom
          token={token}
          roomName={roomName}
          agentInfo={agentInfo}
          onDisconnect={handleDisconnect}
        />
      )}
    </div>
  )
}
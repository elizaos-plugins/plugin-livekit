"use client"

import { useState, useEffect } from "react"
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useVoiceAssistant,
  useLocalParticipant,
  useTracks,
  useParticipants,
} from "@livekit/components-react"
import { Track } from "livekit-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Mic, MicOff, PhoneOff, Volume2, VolumeX, User, Loader2, Settings, Bot } from "lucide-react"
import AgentStatusIndicator from "@/components/agent-status-indicator"
import ConversationTranscript from "@/components/conversation-transcript"
import AudioVisualizer from "@/components/audio-visualizer"
import { useTranscription } from "@/hooks/use-transcription"

interface AgentInfo {
  id: string
  name: string
  avatar: string | null
}

interface VoiceChatRoomProps {
  token: string
  roomName: string
  agentInfo: AgentInfo | null
  onDisconnect: () => void
}

function VoiceAssistantControls({ onDisconnect }: { onDisconnect: () => void }) {
  useVoiceAssistant()
  const { localParticipant } = useLocalParticipant()
  const [isMuted, setIsMuted] = useState(false)
  const [isAudioEnabled, setIsAudioEnabled] = useState(true)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedInputDevice, setSelectedInputDevice] = useState<string>("default")
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string>("default")
  const [showDeviceSettings, setShowDeviceSettings] = useState(false)
  const [isSwitchingDevice, setIsSwitchingDevice] = useState(false)

  // Load available devices
  useEffect(() => {
    const getDevices = async () => {
      try {
        const deviceList = await navigator.mediaDevices.enumerateDevices()
        setDevices(deviceList)
      } catch (error) {
        console.error("Error getting devices:", error)
      }
    }

    getDevices()

    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', getDevices)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', getDevices)
    }
  }, [])

  // Sync mute state with actual microphone state
  useEffect(() => {
    if (localParticipant) {
      const updateMuteState = () => {
        const micTrack = localParticipant.getTrackPublication(Track.Source.Microphone)
        if (micTrack) {
          setIsMuted(micTrack.isMuted)
        }
      }

      // Initial sync
      updateMuteState()

      // Listen for track mute/unmute events
      localParticipant.on('trackMuted', updateMuteState)
      localParticipant.on('trackUnmuted', updateMuteState)

      return () => {
        localParticipant.off('trackMuted', updateMuteState)
        localParticipant.off('trackUnmuted', updateMuteState)
      }
    }
  }, [localParticipant])

  const toggleMute = async () => {
    try {
      // When muted, enable microphone (unmute)
      // When not muted, disable microphone (mute)
      const shouldEnable = isMuted
      await localParticipant.setMicrophoneEnabled(shouldEnable)
      // Don't manually set state here - let the event listener handle it
      // setIsMuted(!shouldEnable)
    } catch (error) {
      console.error("Failed to toggle microphone:", error)
      // On error, revert the state
      setIsMuted(isMuted)
    }
  }

  const toggleAudio = async () => {
    try {
      // Toggle audio output (speakers)
      const shouldEnable = !isAudioEnabled
      // This would typically control the audio output/speakers
      // For now, we'll just update the state
      setIsAudioEnabled(shouldEnable)
    } catch (error) {
      console.error("Failed to toggle audio:", error)
    }
  }

  const switchDevice = async (deviceId: string, kind: MediaDeviceKind) => {
    if (isSwitchingDevice) return // Prevent multiple simultaneous switches

    try {
      setIsSwitchingDevice(true)
      if (kind === 'audioinput') {
        setSelectedInputDevice(deviceId)
      } else {
        setSelectedOutputDevice(deviceId)
      }

      // Get current mute state
      const currentlyMuted = isMuted

      // Switch the microphone device by first disabling then re-enabling with new device
      if (kind === 'audioinput') {
        await localParticipant.setMicrophoneEnabled(false)

        // Small delay to ensure cleanup
        await new Promise(resolve => setTimeout(resolve, 100))

        // Re-enable with new device constraints
        const constraints = deviceId !== "default" ? { deviceId: { exact: deviceId } } : undefined
        await localParticipant.setMicrophoneEnabled(!currentlyMuted, constraints)
      }
    } catch (error) {
      console.error("Failed to switch device:", error)
      // Revert selection on error
      if (kind === 'audioinput') {
        setSelectedInputDevice(selectedInputDevice)
      } else {
        setSelectedOutputDevice(selectedOutputDevice)
      }
    } finally {
      setIsSwitchingDevice(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Controls</CardTitle>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowDeviceSettings(!showDeviceSettings)}
            className="h-8 w-8"
          >
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {showDeviceSettings && (
          <div className="mb-4 space-y-3 pb-4 border-b">
            <div>
              <Label className="text-xs">Microphone</Label>
              <Select
                value={selectedInputDevice}
                onValueChange={(value) => switchDevice(value, 'audioinput')}
                disabled={isSwitchingDevice}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {devices
                    .filter(device => device.kind === 'audioinput')
                    .map(device => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || 'Microphone'}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Speaker</Label>
              <Select
                value={selectedOutputDevice}
                onValueChange={(value) => switchDevice(value, 'audiooutput')}
                disabled={isSwitchingDevice}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {devices
                    .filter(device => device.kind === 'audiooutput')
                    .map(device => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>
                        {device.label || 'Speaker'}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            variant={isMuted ? "destructive" : "outline"}
            size="lg"
            onClick={toggleMute}
            className="flex flex-col gap-1 h-auto py-3"
          >
            {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            <span className="text-xs">{isMuted ? "Unmute" : "Mute"}</span>
          </Button>
          <Button
            variant={isAudioEnabled ? "outline" : "destructive"}
            size="lg"
            onClick={toggleAudio}
            className="flex flex-col gap-1 h-auto py-3"
          >
            {isAudioEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            <span className="text-xs">{isAudioEnabled ? "Disable" : "Enable"}</span>
          </Button>
          <Button
            variant="destructive"
            size="lg"
            onClick={onDisconnect}
            className="flex flex-col gap-1 h-auto py-3"
          >
            <PhoneOff className="w-5 h-5" />
            <span className="text-xs">Disconnect</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ParticipantsList({ agentInfo }: { agentInfo: AgentInfo | null }) {
  const participants = useParticipants()

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Participants</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {participants.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-4">No participants connected yet</div>
          ) : (
            participants.map((participant) => {
              const micTrack = participant.getTrackPublication(Track.Source.Microphone)
              const isAgent = agentInfo && participant.identity === agentInfo.id

              return (
                <div key={participant.identity} className="flex items-center gap-3 p-2 bg-muted rounded-lg">
                  <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center overflow-hidden">
                    {isAgent && agentInfo?.avatar ? (
                      <img
                        src={agentInfo.avatar}
                        alt={agentInfo?.name || 'Agent'}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // Fallback to Bot icon if image fails to load
                          e.currentTarget.style.display = 'none';
                          e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    {isAgent ? (
                      <Bot className={`w-4 h-4 ${isAgent && agentInfo?.avatar ? 'hidden' : ''}`} />
                    ) : (
                      <User className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">
                      {isAgent ? agentInfo.name : "You"}
                    </div>
                    <div className="text-xs text-muted-foreground">{participant.identity}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {micTrack?.isMuted ? (
                      <MicOff className="w-4 h-4 text-destructive" />
                    ) : micTrack ? (
                      <Mic className="w-4 h-4 text-primary" />
                    ) : (
                      <div className="w-4 h-4" />
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function VoiceChatContent({ agentInfo, onDisconnect }: { agentInfo: AgentInfo | null; onDisconnect: () => void }) {
  const { state } = useVoiceAssistant()
  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: true })
  const { messages, clearMessages } = useTranscription()

  // Get the first available audio track for visualization
  const activeAudioTrack = tracks.find(track => track.publication?.track)?.publication?.track

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="space-y-6">
        <AgentStatusIndicator isConnected={true} agentState={state} />
        <VoiceAssistantControls onDisconnect={onDisconnect} />
        {/* Audio Visualizer */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Audio Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <AudioVisualizer
              audioStream={activeAudioTrack?.mediaStream}
              isActive={tracks.length > 0}
              className="rounded-lg"
            />
          </CardContent>
        </Card>
      </div>
      <div>
        <ParticipantsList agentInfo={agentInfo} />
      </div>
      <div>
        <ConversationTranscript
          isRecording={true}
          messages={messages}
          onClearTranscript={clearMessages}
        />
      </div>
    </div>
  )
}

export default function VoiceChatRoom({ token, roomName, agentInfo, onDisconnect }: VoiceChatRoomProps) {
  const [wsURL] = useState(import.meta.env.VITE_LIVEKIT_URL || "wss://lvie-fd0we5n9.livekit.cloud")
  const [connectionState, setConnectionState] = useState<"connecting" | "connected" | "disconnected">("connecting")
  const [error, setError] = useState<string>("")

  if (!wsURL) {
    return (
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="text-destructive text-sm">
            LiveKit server URL not configured. Please check your environment variables.
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">

      {connectionState === "connecting" && (
        <Card className="mb-6">
          <CardContent className="flex items-center gap-3 p-4">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Connecting to voice chat...</span>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="text-destructive text-sm">{error}</div>
          </CardContent>
        </Card>
      )}

      <LiveKitRoom
        video={false}
        audio={true}
        token={token}
        serverUrl={wsURL}
        data-lk-theme="default"
        style={{ height: "0px" }}
        onDisconnected={onDisconnect}
        onConnected={() => {
          setConnectionState("connected")
          setError("")
        }}
        onError={(error) => {
          setError(`Connection error: ${error.message}`)
        }}
      >
        <VoiceChatContent agentInfo={agentInfo} onDisconnect={onDisconnect} />
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  )
}

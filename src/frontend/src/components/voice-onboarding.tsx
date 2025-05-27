"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  CheckCircle, 
  ArrowRight, 
  ArrowLeft,
  Loader2,
  User,
  Settings,
  TestTube,
  Phone
} from "lucide-react"
import AudioVisualizer from "@/components/audio-visualizer"

interface VoiceOnboardingProps {
  onComplete: (data: {
    participantName: string
    roomName: string
    inputDevice: string
    outputDevice: string
  }) => void
  showSkipOption?: boolean
  onSkip?: () => void
}

type OnboardingStep = 'name' | 'audio'

export default function VoiceOnboarding({ onComplete, showSkipOption = false, onSkip }: VoiceOnboardingProps) {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('name')
  const [participantName, setParticipantName] = useState("")
  const [roomName, setRoomName] = useState("voice-agent-room")
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedInputDevice, setSelectedInputDevice] = useState<string>("default")
  const [selectedOutputDevice, setSelectedOutputDevice] = useState<string>("default")
  const [isTestingMic, setIsTestingMic] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [testResults, setTestResults] = useState({
    microphone: false,
    speakers: false,
    voice: false
  })
  const [isLoading, setIsLoading] = useState(false)
  
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  // Load devices on mount
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
  }, [])

  // Generate random participant name
  useEffect(() => {
    if (!participantName) {
      setParticipantName("user-" + Math.random().toString(36).substring(2, 8))
    }
  }, [participantName])

  // Cleanup streams on unmount
  useEffect(() => {
    return () => {
      cleanupStreams()
    }
  }, [])

  const cleanupStreams = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
  }

  const startMicTest = async () => {
    try {
      setIsTestingMic(true)
      setIsMuted(false)
      
      const constraints = {
        audio: selectedInputDevice !== "default" 
          ? { deviceId: { exact: selectedInputDevice } } 
          : true
      }
      
      streamRef.current = await navigator.mediaDevices.getUserMedia(constraints)
      audioContextRef.current = new AudioContext()
      
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume()
      }
      
      setTestResults(prev => ({ ...prev, microphone: true }))
      
      // Auto-detect voice activity
      const analyser = audioContextRef.current.createAnalyser()
      const source = audioContextRef.current.createMediaStreamSource(streamRef.current)
      analyser.fftSize = 256
      source.connect(analyser)
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      let voiceDetected = false
      
      const checkVoice = () => {
        if (!streamRef.current?.active) return
        
        analyser.getByteFrequencyData(dataArray)
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length
        
        if (average > 8 && !voiceDetected) {
          voiceDetected = true
          setTestResults(prev => ({ ...prev, voice: true }))
        }
        
        if (streamRef.current?.active) {
          requestAnimationFrame(checkVoice)
        }
      }
      
      checkVoice()
      
    } catch (error) {
      console.error("Microphone test failed:", error)
      setTestResults(prev => ({ ...prev, microphone: false }))
    }
  }

  const toggleMute = () => {
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(track => {
        track.enabled = isMuted
      })
      setIsMuted(!isMuted)
    }
  }

  const testSpeakers = async () => {
    try {
      const audioContext = new AudioContext()
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      
      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)
      
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime)
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime)
      
      oscillator.start()
      oscillator.stop(audioContext.currentTime + 0.5)
      
      setTestResults(prev => ({ ...prev, speakers: true }))
      
      setTimeout(() => audioContext.close(), 1000)
    } catch (error) {
      console.error("Speaker test failed:", error)
    }
  }

  const nextStep = () => {
    if (currentStep === 'name') {
      setCurrentStep('audio')
      // Auto-start mic test when reaching audio step
      setTimeout(startMicTest, 500)
    }
  }

  const prevStep = () => {
    if (currentStep === 'audio') {
      setCurrentStep('name')
      cleanupStreams()
      setIsTestingMic(false)
    }
  }

  const handleComplete = () => {
    setIsLoading(true)
    cleanupStreams()
    onComplete({
      participantName,
      roomName,
      inputDevice: selectedInputDevice,
      outputDevice: selectedOutputDevice
    })
  }

  const canProceed = () => {
    switch (currentStep) {
      case 'name':
        return participantName.trim().length > 0
      case 'audio':
        return testResults.microphone
      default:
        return false
    }
  }

  const inputDevices = devices.filter(device => device.kind === 'audioinput' && device.deviceId)
  const outputDevices = devices.filter(device => device.kind === 'audiooutput' && device.deviceId)

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl border-2 border-gray-200">
        <CardHeader className="text-center">
          <div className="flex justify-between items-start mb-4">
            <div className="flex-1" />
            <div className="mx-auto w-20 h-20 bg-primary rounded-full flex items-center justify-center">
              <Mic className="w-10 h-10 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-3xl mb-2">
            {currentStep === 'name' && "Ready to chat with an AI agent?"}
            {currentStep === 'audio' && "Test your audio setup"}
          </CardTitle>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Name Step */}
          {currentStep === 'name' && (
            <div className="space-y-6">
              <div className="text-center">
                <p className="text-foreground text-lg mb-4">
                  Have natural voice conversations with an AI agent
                </p>
                <p className="text-muted-foreground mb-6">
                  Just tell us your name to get started
                </p>
              </div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="participant-name">
                    Your Name
                  </Label>
                  <Input
                    id="participant-name"
                    value={participantName}
                    onChange={(e) => setParticipantName(e.target.value)}
                    placeholder="Enter your name"
                    className="text-lg py-3"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="room-name">
                    Room Name (Optional)
                  </Label>
                  <Input
                    id="room-name"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder="voice-agent-room"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Audio Step - Combined devices + test */}
          {currentStep === 'audio' && (
            <div className="space-y-6">
              <div className="text-center">
                <p className="text-foreground mb-2">
                  {!testResults.voice ? "Let's test your microphone and speakers" : "Perfect! Your audio is working great"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {!testResults.voice ? "Speak normally and we'll detect your voice" : "You're ready to start your conversation"}
                </p>
              </div>

              {/* Device Selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Mic className="w-4 h-4" />
                    Microphone
                  </Label>
                  <Select value={selectedInputDevice} onValueChange={setSelectedInputDevice}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select microphone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">
                        Default Microphone
                      </SelectItem>
                      {inputDevices.map((device) => (
                        <SelectItem
                          key={device.deviceId}
                          value={device.deviceId}
                        >
                          {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4" />
                    Speakers
                  </Label>
                  <Select value={selectedOutputDevice} onValueChange={setSelectedOutputDevice}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select speakers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">
                        Default Speakers
                      </SelectItem>
                      {outputDevices.map((device) => (
                        <SelectItem
                          key={device.deviceId}
                          value={device.deviceId}
                        >
                          {device.label || `Speaker ${device.deviceId.slice(0, 8)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Live Audio Visualizer */}
              <div className="relative">
                <div className="h-24 bg-muted rounded-lg p-4 flex items-center justify-center">
                  <AudioVisualizer 
                    audioStream={streamRef.current || undefined}
                    isActive={isTestingMic && !isMuted}
                    className="rounded"
                  />
                </div>
                
                {/* Microphone Control */}
                <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2">
                  <Button
                    onClick={toggleMute}
                    size="sm"
                    variant={isMuted ? "destructive" : "default"}
                    className="rounded-full w-10 h-10 p-0"
                  >
                    {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </Button>
                </div>
              </div>

              {/* Test Results and Speaker Test */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                  {testResults.microphone ? (
                    <CheckCircle className="w-5 h-5 text-primary" />
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-border" />
                  )}
                  <span className="text-sm">Mic Connected</span>
                </div>
                
                <Button
                  onClick={testSpeakers}
                  variant="outline"
                  size="sm"
                >
                  <TestTube className="w-4 h-4 mr-2" />
                  Test Speakers
                </Button>
              </div>

              {testResults.voice && (
                <div className="text-center p-3 bg-muted rounded-lg">
                  <CheckCircle className="w-6 h-6 text-primary mx-auto mb-2" />
                  <p className="font-medium">Voice detected! You're all set.</p>
                </div>
              )}
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between items-center pt-6">
            {currentStep === 'name' ? (
              <div /> // Empty div to maintain spacing
            ) : (
              <Button
                onClick={prevStep}
                variant="outline"
                disabled={isLoading}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Previous
              </Button>
            )}

            <div className="flex items-center gap-2">
              {['name', 'audio'].map((step, index) => (
                <div
                  key={step}
                  className={`w-3 h-3 rounded-full ${
                    step === currentStep ? 'bg-primary' : 
                    ['name', 'audio'].indexOf(currentStep) > index ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              ))}
            </div>

            {currentStep === 'audio' ? (
              <Button
                onClick={handleComplete}
                disabled={!canProceed() || isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Phone className="w-4 h-4 mr-2" />
                    Start Conversation
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={nextStep}
                disabled={!canProceed() || isLoading}
              >
                Next
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
"use client"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useConnectionState, useRoomInfo } from "@livekit/components-react"
import { AlertCircle, Bot, Wifi, WifiOff } from "lucide-react"

interface AgentStatusIndicatorProps {
  isConnected: boolean
  agentState?: string
}

export default function AgentStatusIndicator({ isConnected, agentState }: AgentStatusIndicatorProps) {
  const connectionState = useConnectionState()
  const roomInfo = useRoomInfo()

  const getQualityText = () => {
    if (!isConnected) return "unknown"

    // Use connection state to determine quality
    switch (connectionState) {
      case "connected":
        return "excellent"
      case "connecting":
        return "good"
      case "reconnecting":
        return "poor"
      case "disconnected":
        return "lost"
      default:
        return "unknown"
    }
  }

  const qualityText = getQualityText()

  const getConnectionIcon = () => {
    if (!isConnected) return <WifiOff className="w-4 h-4 text-destructive" />

    switch (qualityText) {
      case "excellent":
        return <Wifi className="w-4 h-4 text-primary" />
      case "good":
        return <Wifi className="w-4 h-4 text-primary" />
      case "poor":
        return <AlertCircle className="w-4 h-4 text-destructive" />
      case "lost":
        return <WifiOff className="w-4 h-4 text-destructive" />
      default:
        return <Wifi className="w-4 h-4 text-muted-foreground" />
    }
  }

  const getConnectionText = () => {
    if (!isConnected) return "Disconnected"
    return `${qualityText.charAt(0).toUpperCase() + qualityText.slice(1)} Connection`
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Bot className="w-5 h-5" />
          Connection Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Network</span>
          <div className="flex items-center gap-2">
            {getConnectionIcon()}
            <span className="text-sm">{getConnectionText()}</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Agent</span>
          <Badge variant={isConnected ? "default" : "secondary"}>
            {isConnected ? "Online" : "Offline"}
          </Badge>
        </div>

        {agentState && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">State</span>
            <Badge variant="outline">
              {agentState}
            </Badge>
          </div>
        )}

        {isConnected && roomInfo && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Room</span>
            <Badge variant="outline" className="font-mono text-xs">
              {roomInfo.name}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

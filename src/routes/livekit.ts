import { AccessToken, AccessTokenOptions } from 'livekit-server-sdk';
import { logger } from '@elizaos/core';

interface TokenRequest {
  roomName: string;
  participantName: string;
}

interface AgentJoinRequest {
  roomName: string;
  agentIdentity: string;
}

/**
 * Generates a LiveKit token for a participant to join a room.
 */
export const livekitTokenRoute = {
  type: 'POST' as const,
  name: 'LiveKit Token',
  path: '/livekit/token',
  handler: async (req: any, res: any, runtime: any) => {
    try {
      let body: TokenRequest;

      if (typeof req.body === 'string') {
        body = JSON.parse(req.body);
      } else {
        body = req.body;
      }

      const { roomName, participantName } = body;

      if (!roomName || !participantName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: "Room name and participant name are required"
        }));
        return;
      }

      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;

      if (!apiKey || !apiSecret) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: "LiveKit credentials not configured"
        }));
        return;
      }

      const token = new AccessToken(apiKey, apiSecret, {
        identity: participantName,
        ttl: "1h",
      });

      token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      const jwt = await token.toJwt();

      // Trigger agent auto-join when user requests token
      logger.debug(`[LiveKit] User ${participantName} requesting token for room ${roomName}`);

      // Get the LiveKit service and trigger agent auto-join
      const liveKitService = runtime.getService('livekit');
      if (liveKitService && typeof liveKitService.autoJoinRoom === 'function') {
        // Delay agent join slightly to allow user to connect first
        setTimeout(async () => {
          try {
            await liveKitService.autoJoinRoom(roomName, `agent-${runtime.agentId}`);
            logger.debug(`[LiveKit] Agent auto-joined room ${roomName}`);
          } catch (error) {
            console.error(`[LiveKit] Failed to auto-join room ${roomName}:`, error);
          }
        }, 2000); // 2 second delay
      } else {
        console.warn('[LiveKit] LiveKit service not found or autoJoinRoom method not available');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        token: jwt,
        url: process.env.LIVEKIT_URL || 'ws://localhost:7880'
      }));
    } catch (error) {
      console.error("Error generating token:", error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: "Failed to generate token" }));
    }
  },
};

/**
 * Manual agent join endpoint for testing purposes
 */
export const livekitJoinAgentRoute = {
  type: 'POST' as const,
  name: 'LiveKit Join Agent',
  path: '/livekit/join-agent',
  handler: async (req: any, res: any, runtime: any) => {
    try {
      let body: AgentJoinRequest;

      if (typeof req.body === 'string') {
        body = JSON.parse(req.body);
      } else {
        body = req.body;
      }

      const { roomName, agentIdentity } = body;

      if (!roomName || !agentIdentity) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: "Room name and agent identity are required"
        }));
        return;
      }

      logger.debug(`[LiveKit] Manual agent join request for room ${roomName} with identity ${agentIdentity}`);

      // Get the LiveKit service and trigger agent join
      const liveKitService = runtime.getService('livekit');
      if (liveKitService && typeof liveKitService.autoJoinRoom === 'function') {
        try {
          await liveKitService.autoJoinRoom(roomName, agentIdentity);
          logger.debug(`[LiveKit] Agent manually joined room ${roomName}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            message: `Agent ${agentIdentity} joined room ${roomName}`
          }));
        } catch (error) {
          console.error(`[LiveKit] Failed to manually join room ${roomName}:`, error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: `Failed to join agent: ${error instanceof Error ? error.message : String(error)}`
          }));
        }
      } else {
        console.warn('[LiveKit] LiveKit service not found or autoJoinRoom method not available');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: "LiveKit service not available"
        }));
      }
    } catch (error) {
      console.error("Error in manual agent join:", error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: "Failed to process agent join request" }));
    }
  },
};
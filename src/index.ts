import type { Plugin } from '@elizaos/core';
import { LiveKitService } from './services/livekit-service';
import { participantProvider } from './providers/participants';
import { joinRoomAction } from './actions/join-room';
import { leaveRoomAction } from './actions/leave-room';
import { publishAudioAction } from './actions/publish-audio';
import { muteAudioAction } from './actions/mute-audio';
import { livekitTokenRoute, livekitJoinAgentRoute } from './routes/livekit';
import { livekitFrontendRoutes } from './routes/frontend';

// Export all types and interfaces
export * from './types/interfaces';

// Export services, managers, and utilities
export { LiveKitService } from './services/livekit-service';
export { AudioManager } from './managers/audio-manager';
export { TokenManager } from './managers/token-manager';
export { AudioConverter } from './utils/audio-converter';
export { VoiceDetection } from './utils/voice-detection';

// Export providers and actions
export { participantProvider } from './providers/participants';
export { joinRoomAction } from './actions/join-room';
export { leaveRoomAction } from './actions/leave-room';
export { publishAudioAction } from './actions/publish-audio';
export { muteAudioAction } from './actions/mute-audio';

// Export routes
export { livekitTokenRoute, livekitJoinAgentRoute } from './routes/livekit';
export { livekitFrontendRoutes } from './routes/frontend';

export const liveKitPlugin: Plugin = {
  name: 'livekit',
  description: 'LiveKit real-time voice communication plugin for ElizaOS',

  services: [LiveKitService],

  providers: [participantProvider],


  routes: [
    livekitTokenRoute,
    livekitJoinAgentRoute,
    ...livekitFrontendRoutes,
  ],

  actions: [
    joinRoomAction,
    leaveRoomAction,
    publishAudioAction,
    muteAudioAction,
  ],

  async init(config: Record<string, string | undefined>) {
    console.info('[LiveKit Plugin] Initializing LiveKit plugin');

    // Validate required environment variables
    const requiredEnvVars = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
    const missingVars = requiredEnvVars.filter(
      (varName) => !process.env[varName] && !config[varName],
    );

    if (missingVars.length > 0) {
      console.warn(
        `[LiveKit Plugin] Missing environment variables: ${missingVars.join(', ')}`,
      );
      console.warn(
        '[LiveKit Plugin] Some features may not work without proper configuration',
      );
    }

    // Set default configuration
    if (!process.env.LIVEKIT_URL && !config.LIVEKIT_URL) {
      console.info(
        '[LiveKit Plugin] Using default WebSocket URL: ws://localhost:7880',
      );
    }

    console.info('[LiveKit Plugin] Plugin initialized successfully');
  },
};

export default liveKitPlugin;

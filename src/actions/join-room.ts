import {
  type Action,
  type ActionExample,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  logger,
} from '@elizaos/core';
import type { LiveKitService } from '../services/livekit-service';
import type { LiveKitConnectionConfig } from '../types/interfaces';

export const joinRoomAction: Action = {
  name: 'LIVEKIT_JOIN_ROOM',
  similes: ['JOIN_VOICE_ROOM', 'CONNECT_TO_LIVEKIT', 'ENTER_VOICE_CHAT'],
  description: 'Join a LiveKit voice communication room',

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const service = runtime.getService<LiveKitService>('livekit');
    return !!service;
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    options: { [key: string]: unknown } | undefined,
    callback?: HandlerCallback,
  ) => {
    try {
      const service = runtime.getService<LiveKitService>('livekit');

      if (!service) {
        await callback?.({
          text: 'LiveKit service not available',
          error: 'LiveKit service not found',
        });
        return;
      }

      if (service.isConnected()) {
        await callback?.({
          text: 'Already connected to a LiveKit room',
          actions: ['LIVEKIT_JOIN_ROOM'],
        });
        return;
      }

      // Extract and validate options
      const wsUrl = options?.wsUrl as string | undefined;
      const token = options?.token as string | undefined;
      const roomName = options?.roomName as string | undefined;
      const participantName = options?.participantName as string | undefined;

      // Build connection config from options and environment
      const config: LiveKitConnectionConfig = {
        wsUrl:
          wsUrl || process.env.LIVEKIT_URL || 'ws://localhost:7880',
        token: token || '', // Token should be provided or generated
        roomName: roomName || 'default-room',
        participantName:
          participantName || runtime.character.name || 'agent',
        audioSettings: {
          sampleRate: 48000,
          channels: 1,
          frameDurationMs: 100,
          volumeThreshold: 1000,
        },
      };

      if (!config.token) {
        await callback?.({
          text: 'No LiveKit token provided. Cannot join room.',
          error: 'Missing token',
        });
        return;
      }

      logger.info(
        `[JoinRoomAction] Attempting to join room: ${config.roomName}`,
      );

      await service.connect(config);

      await callback?.({
        text: `Successfully joined voice room: ${config.roomName}`,
        metadata: {
          roomName: config.roomName,
          participantName: config.participantName,
          wsUrl: config.wsUrl,
        },
      });
    } catch (error) {
      logger.error('[JoinRoomAction] Failed to join room:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await callback?.({
        text: `Failed to join voice room: ${errorMessage}`,
        error: errorMessage,
      });
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: { text: 'Join the voice chat' },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Successfully joined voice room: default-room',
          actions: ['LIVEKIT_JOIN_ROOM'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: { text: 'Connect to voice room "meeting-room"' },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Successfully joined voice room: meeting-room',
          actions: ['LIVEKIT_JOIN_ROOM'],
        },
      },
    ],
  ] as ActionExample[][],
};

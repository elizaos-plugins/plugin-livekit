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

export const leaveRoomAction: Action = {
  name: 'LIVEKIT_LEAVE_ROOM',
  similes: ['LEAVE_VOICE_ROOM', 'DISCONNECT_FROM_LIVEKIT', 'EXIT_VOICE_CHAT'],
  description: 'Leave the current LiveKit voice communication room',

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const service = runtime.getService<LiveKitService>('livekit');
    return !!service && service.isConnected();
  },

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: any,
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

      if (!service.isConnected()) {
        await callback?.({
          text: 'Not currently connected to any LiveKit room',
          error: 'Not connected',
        });
        return;
      }

      const roomName = service.getRoomState()?.roomName || 'unknown';

      logger.info(`[LeaveRoomAction] Leaving room: ${roomName}`);

      await service.disconnect();

      await callback?.({
        text: `Successfully left voice room: ${roomName}`,
        metadata: {
          roomName,
          disconnected: true,
        },
      });
    } catch (error) {
      logger.error('[LeaveRoomAction] Failed to leave room:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await callback?.({
        text: `Failed to leave voice room: ${errorMessage}`,
        error: errorMessage,
      });
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: { text: 'Leave the voice chat' },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Left voice room: default-room',
          actions: ['LIVEKIT_LEAVE_ROOM'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: { text: 'Disconnect from voice' },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Left voice room: meeting-room',
          actions: ['LIVEKIT_LEAVE_ROOM'],
        },
      },
    ],
  ] as ActionExample[][],
};

import type {
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
} from '@elizaos/core';
import { logger } from '@elizaos/core';
import type { LiveKitService } from '../services/livekit-service';
import type { ParticipantProvider } from '../types/interfaces';

export const participantProvider: ParticipantProvider = {
  name: 'LIVEKIT_PARTICIPANTS',
  description: 'Provides current LiveKit room participants and their states',

  get: async (
    runtime: IAgentRuntime,
    _message: Memory,
  ): Promise<
    ProviderResult & {
      participants: any[];
      roomState: any;
    }
  > => {
    try {
      const service = runtime.getService<LiveKitService>('livekit');

      if (!service || !service.isConnected()) {
        return {
          text: '# LiveKit Room State\nStatus: Not connected to any room',
          participants: [],
          roomState: {
            connected: false,
            roomName: '',
            participantCount: 0,
          },
        };
      }

      const participants = service.getParticipants();
      const roomState = service.getRoomState();

      // Format participants for display
      const participantLines = participants.map((participant) => {
        const statusIndicators: string[] = [];
        if (participant.speaking) statusIndicators.push('🎤 Speaking');
        if (participant.audioEnabled) statusIndicators.push('🔊 Audio');

        const status =
          statusIndicators.length > 0
            ? ` (${statusIndicators.join(', ')})`
            : '';
        const lastSeen = new Date(
          participant.lastActivity,
        ).toLocaleTimeString();

        return `- **${participant.name}** [${participant.id}]${status} - Last active: ${lastSeen}`;
      });

      const roomInfo = [
        `**Room**: ${roomState.roomName}`,
        `**Status**: ${roomState.connected ? '🟢 Connected' : '🔴 Disconnected'}`,
        `**Participants**: ${roomState.participantCount}`,
      ];

      if (roomState.localParticipant) {
        roomInfo.push(
          `**Local Participant**: ${roomState.localParticipant.name} [${roomState.localParticipant.id}]`,
        );
      }

      const text = [
        '# LiveKit Room State',
        '',
        '## Room Information',
        roomInfo.join('\n'),
        '',
        '## Participants',
        participantLines.length > 0
          ? participantLines.join('\n')
          : 'No other participants in the room',
      ].join('\n');

      return {
        text,
        participants,
        roomState,
      };
    } catch (error) {
      logger.error('[ParticipantProvider] Error getting room state:', error);
      return {
        text: '# LiveKit Room State\nStatus: Error retrieving room information',
        participants: [],
        roomState: {
          connected: false,
          roomName: '',
          participantCount: 0,
        },
      };
    }
  },
};

import {
  type Action,
  type ActionExample,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  type State,
  ModelType,
  logger,
} from '@elizaos/core';
import type { LiveKitService } from '../services/livekit-service';

export const publishAudioAction: Action = {
  name: 'LIVEKIT_PUBLISH_AUDIO',
  similes: ['SPEAK_IN_VOICE_CHAT', 'PUBLISH_AUDIO', 'SEND_VOICE_MESSAGE'],
  description: 'Publish audio/speech to the LiveKit room',

  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const service = runtime.getService<LiveKitService>('livekit');
    return !!service && service.isConnected();
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
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

      if (!service.isConnected()) {
        await callback?.({
          text: 'Not connected to any LiveKit room',
          error: 'Not connected',
        });
        return;
      }

      // Extract options
      const text = options?.text as string | undefined;
      const audioBuffer = options?.audioBuffer as Buffer | undefined;

      let finalAudioBuffer = audioBuffer;

      // If no audio buffer provided, try to generate from text
      if (!finalAudioBuffer && text) {
        try {
          // For now, we'll skip TTS generation as it requires specific TTS service implementation
          // This can be implemented later when TTS service is available
          throw new Error('TTS generation not implemented yet');
        } catch (ttsError) {
          logger.error('[PublishAudioAction] TTS generation failed:', ttsError);
          const ttsErrorMessage = ttsError instanceof Error ? ttsError.message : String(ttsError);
          await callback?.({
            text: `Failed to generate speech: ${ttsErrorMessage}`,
            error: ttsErrorMessage,
          });
          return;
        }
      }

      if (!finalAudioBuffer) {
        await callback?.({
          text: 'No audio content to publish',
          error: 'Missing audio data',
        });
        return;
      }

      await service.publishAudio(finalAudioBuffer);

      await callback?.({
        text: 'Audio published successfully to LiveKit room',
        metadata: {
          audioSize: finalAudioBuffer.length,
          roomName: service.getRoomState()?.roomName,
        },
      });
    } catch (error) {
      logger.error('[PublishAudioAction] Failed to publish audio:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await callback?.({
        text: `Failed to publish audio: ${errorMessage}`,
        error: errorMessage,
      });
    }
  },

  examples: [
    [
      {
        name: '{{name1}}',
        content: { text: 'Say hello to everyone' },
      },
      {
        name: '{{name2}}',
        content: {
          text: '', // Audio action - no text response
          actions: ['LIVEKIT_PUBLISH_AUDIO'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: { text: 'Speak in voice chat: "Welcome to our meeting"' },
      },
      {
        name: '{{name2}}',
        content: {
          text: '',
          actions: ['LIVEKIT_PUBLISH_AUDIO'],
        },
      },
    ],
  ] as ActionExample[][],
};

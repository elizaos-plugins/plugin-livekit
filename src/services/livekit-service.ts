import type { IAgentRuntime } from '@elizaos/core';
import { createUniqueUuid, logger, Memory, ModelType, Service, ChannelType, Content, HandlerCallback } from '@elizaos/core';
import { AudioStream, dispose, Room, RoomEvent, TrackKind } from '@livekit/rtc-node';
import { EventEmitter } from 'eventemitter3';
import { AccessToken } from 'livekit-server-sdk';
import { AudioManager } from '../managers/audio-manager';
import type {
  AudioData,
  AudioSettings,
  LiveKitConnectionConfig,
  ParticipantInfo,
  RoomState
} from '../types/interfaces';
import { AudioMonitor } from '../utils/audio-monitor';

export interface LiveKitServiceConfig {
  apiKey: string;
  apiSecret: string;
  wsUrl: string;
  enableTurnDetection: boolean;
  voiceDetectionConfig?: {
    silenceThreshold?: number;
    speechThreshold?: number;
    minSpeechDuration?: number;
    maxSpeechDuration?: number;
    debounceThreshold?: number;
    silenceFramesRequired?: number;
    speechFramesRequired?: number;
  };
  audioConfig?: {
    sampleRate?: number;
    channels?: number;
    frameSize?: number;
  };
}

export interface LiveKitEvents {
  'participantConnected': (participantId: string) => void;
  'participantDisconnected': (participantId: string) => void;
  'audioReceived': (participantId: string, audioBuffer: Buffer) => void;
  'speechStarted': (participantId: string) => void;
  'speechEnded': (participantId: string, audioBuffer: Buffer) => void;
  'speechTurn': (participantId: string, audioBuffer: Buffer, speechDuration: number) => void;
  'interruptionDetected': (participantId: string) => void;
  'agentStateChanged': (state: 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking') => void;
}

export class LiveKitService extends Service {
  static serviceType = 'livekit';

  declare public config: LiveKitServiceConfig;
  private rooms: Map<string, any> = new Map();
  private audioManagers: Map<string, AudioManager> = new Map();
  private audioMonitors: Map<string, AudioMonitor> = new Map();
  private activeAudioPlayers: Map<string, any> = new Map();
  private userStates: Map<string, {
    isProcessing: boolean;
    lastActivity: number;
    buffers: Buffer[];
  }> = new Map();
  private eventEmitter: EventEmitter = new EventEmitter();
  private audioCallbacks: Set<(audioData: AudioData) => void> = new Set();
  private debuggedAudioFormat: boolean = false;
  private agentState: 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' = 'idle';
  private connectedRooms: Set<string> = new Set();

  constructor(runtime: IAgentRuntime) {
    super(runtime);

    // Get configuration from environment variables
    this.config = {
      apiKey: process.env.LIVEKIT_API_KEY || '',
      apiSecret: process.env.LIVEKIT_API_SECRET || '',
      wsUrl: process.env.LIVEKIT_URL || '',
      enableTurnDetection: process.env.LIVEKIT_ENABLE_TURN_DETECTION !== 'false', // Default to true unless explicitly disabled
      voiceDetectionConfig: {
        silenceThreshold: parseFloat(process.env.LIVEKIT_SILENCE_THRESHOLD || '0.01'),
        speechThreshold: parseFloat(process.env.LIVEKIT_SPEECH_THRESHOLD || '0.1'),
        minSpeechDuration: parseInt(process.env.LIVEKIT_MIN_SPEECH_DURATION || '500'),
        maxSpeechDuration: parseInt(process.env.LIVEKIT_MAX_SPEECH_DURATION || '30000'), // Increased from 10s to 30s
        debounceThreshold: parseInt(process.env.LIVEKIT_DEBOUNCE_THRESHOLD || '1500'), // Increased from 20ms to 1500ms
        silenceFramesRequired: parseInt(process.env.LIVEKIT_SILENCE_FRAMES_REQUIRED || '150'), // ~1.5 seconds of silence at 48kHz/480 samples per frame
        speechFramesRequired: parseInt(process.env.LIVEKIT_SPEECH_FRAMES_REQUIRED || '3'),
      },
      audioConfig: {
        sampleRate: parseInt(process.env.LIVEKIT_SAMPLE_RATE || '48000'),
        channels: parseInt(process.env.LIVEKIT_CHANNELS || '1'),
        frameSize: parseInt(process.env.LIVEKIT_FRAME_SIZE || '480'), // 10ms at 48kHz (was 160 for 16kHz)
      },
    };

    if (!this.config.apiKey || !this.config.apiSecret || !this.config.wsUrl) {
      throw new Error('LiveKit configuration missing. Please set LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_URL environment variables.');
    }

    logger.info('[LiveKitService] Initialized with turn detection:', this.config.enableTurnDetection);
  }

  get capabilityDescription(): string {
    return 'Provides LiveKit real-time voice communication with enhanced turn detection capabilities';
  }

  /**
   * Start the LiveKit service
   */
  static async start(runtime: IAgentRuntime): Promise<LiveKitService> {
    logger.info('[LiveKitService] Starting service');
    const service = new LiveKitService(runtime);
    return service;
  }

  static async stop(runtime: IAgentRuntime): Promise<void> {
    const service = runtime.getService<LiveKitService>(
      LiveKitService.serviceType,
    );
    if (service) {
      await service.destroy();
    }
  }

  /**
   * Generate access token for LiveKit room
   */
  async generateToken(roomName: string, participantName: string): Promise<string> {
    const at = new AccessToken(this.config.apiKey, this.config.apiSecret, {
      identity: participantName,
    });

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    return at.toJwt();
  }

  /**
   * Connect to LiveKit room
   */
  async connect(config: LiveKitConnectionConfig): Promise<void> {
    if (this.rooms.has(config.roomName)) {
      logger.warn(`[LiveKitService] Already connected to room: ${config.roomName}`);
      return;
    }

    const token = await this.generateToken(config.roomName, config.participantName || 'agent');
    const room = new Room();

    // Setup room event handlers
    this.setupRoomEventHandlers(room, config.roomName);

    // Connect to room
    await room.connect(config.wsUrl, token);

    this.rooms.set(config.roomName, room);

    // Initialize audio manager for this room
    const audioManager = new AudioManager(room);
    await audioManager.initialize();
    this.audioManagers.set(config.roomName, audioManager);

    // Initialize audio monitor if turn detection is enabled
    if (this.config.enableTurnDetection) {
      this.initializeAudioMonitor(config.roomName);
    }

    logger.info(`[LiveKitService] Successfully joined room: ${config.roomName} as ${config.participantName || 'agent'}`);
  }

  /**
   * Initialize audio monitor for turn detection
   */
  private initializeAudioMonitor(roomName: string): void {
    const audioMonitor = new AudioMonitor({
      ...this.config.audioConfig,
      ...this.config.voiceDetectionConfig,
    });

    // Setup audio monitor event handlers
    this.setupAudioMonitorEvents(audioMonitor, roomName);

    this.audioMonitors.set(roomName, audioMonitor);

    logger.info(`[LiveKitService] Audio monitor initialized for room: ${roomName}`);
  }

  /**
   * Setup audio monitor event handlers
   */
  private setupAudioMonitorEvents(audioMonitor: AudioMonitor, roomName: string): void {
    audioMonitor.on('speakingStarted', (participantId) => {
      logger.debug(`[LiveKitService] Speaking started: ${participantId} in room ${roomName}`);
      this.eventEmitter.emit('speechStarted', participantId);

      // Initialize user state if not exists
      if (!this.userStates.has(participantId)) {
        this.userStates.set(participantId, {
          isProcessing: false,
          lastActivity: Date.now(),
          buffers: [],
        });
      }

      const userState = this.userStates.get(participantId)!;
      userState.lastActivity = Date.now();
      userState.buffers = []; // Reset buffers for new speech turn
    });

    audioMonitor.on('speakingStopped', async (participantId, audioBuffer) => {
      logger.debug(`[LiveKitService] Speaking stopped: ${participantId} in room ${roomName}`);
      this.eventEmitter.emit('speechEnded', participantId, audioBuffer);

      // Process the complete speech turn
      await this.processSpeechTurn(participantId, audioBuffer, roomName);
    });

    audioMonitor.on('interruptionDetected', (participantId) => {
      logger.debug(`[LiveKitService] Interruption detected: ${participantId} in room ${roomName}`);
      this.eventEmitter.emit('interruptionDetected', participantId);

      // Stop current audio playback
      this.handleInterruption(participantId, roomName);
    });

    audioMonitor.on('volumeDetected', (participantId, volume) => {
      // Log high volume events for debugging
      if (volume > 0.1) {
        logger.debug(`[LiveKitService] High volume detected: ${participantId}, volume: ${volume.toFixed(3)}`);
      }
    });
  }

  /**
   * Setup room event handlers
   */
  private setupRoomEventHandlers(room: any, roomName: string): void {
    room.on(RoomEvent.ParticipantConnected, (participant: any) => {
      logger.info(`[LiveKitService] Participant connected: ${participant.identity}`);
      this.eventEmitter.emit('participantConnected', participant.identity);
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant: any) => {
      logger.info(`[LiveKitService] Participant disconnected: ${participant.identity}`);
      this.eventEmitter.emit('participantDisconnected', participant.identity);

      // Clean up participant resources
      const audioMonitor = this.audioMonitors.get(roomName);
      if (audioMonitor) {
        audioMonitor.stopMonitoring(participant.identity);
      }
      this.userStates.delete(participant.identity);
    });

    room.on(RoomEvent.TrackSubscribed, (track: any, publication: any, participant: any) => {
      if (track.kind === TrackKind.KIND_AUDIO) {
        logger.info(`[LiveKitService] Subscribed to audio track from ${participant.identity}`);
        this.handleAudioTrack(track, participant, roomName);
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      logger.info(`[LiveKitService] Disconnected from room ${roomName}`);
      // Clean up room resources
      this.rooms.delete(roomName);
      const audioManager = this.audioManagers.get(roomName);
      if (audioManager) {
        this.audioManagers.delete(roomName);
      }
      const audioMonitor = this.audioMonitors.get(roomName);
      if (audioMonitor) {
        this.audioMonitors.delete(roomName);
      }
      this.connectedRooms.delete(roomName);
      this.setAgentState('idle');
    });
  }

  /**
   * Handle incoming audio track
   */
  private handleAudioTrack(track: any, participant: any, roomName: string): void {
    const audioStream = new AudioStream(track);

    // Ensure monitoring is started for this participant (fallback if ParticipantConnected was missed)
    if (this.config.enableTurnDetection) {
      const audioMonitor = this.audioMonitors.get(roomName);
      if (audioMonitor) {
        logger.debug(`[LiveKitService] Ensuring monitoring is started for ${participant.identity}`);
        audioMonitor.startMonitoring(participant.identity);
      }
    }

    // Process audio frames
    this.processAudioStream(audioStream, participant, roomName);

    logger.debug(`[LiveKitService] Audio stream handler setup for: ${participant.identity}`);
  }

  /**
   * Process audio stream frames
   */
  private async processAudioStream(audioStream: any, participant: any, roomName: string): Promise<void> {
    try {
      logger.debug(`[LiveKitService] Starting audio stream processing for ${participant.identity} in room ${roomName}`);

      for await (const audioFrame of audioStream) {
        // Convert Int16Array to Buffer properly
        let audioBuffer: Buffer;
        if (audioFrame.data instanceof Int16Array) {
          // Create a buffer from the Int16Array's underlying ArrayBuffer
          audioBuffer = Buffer.from(audioFrame.data.buffer, audioFrame.data.byteOffset, audioFrame.data.byteLength);
        } else {
          // Fallback for other data types
          audioBuffer = Buffer.from(audioFrame.data);
        }

        // Debug: Log audio frame properties to understand the format
        if (!this.debuggedAudioFormat) {
          this.debuggedAudioFormat = true;
          logger.info(`[LiveKitService] First audio frame format from ${participant.identity}:`, {
            dataLength: audioFrame.data?.length,
            dataType: typeof audioFrame.data,
            dataConstructor: audioFrame.data?.constructor?.name,
            sampleRate: audioFrame.sampleRate,
            channels: audioFrame.channels,
            samplesPerChannel: audioFrame.samplesPerChannel,
            frameProperties: Object.keys(audioFrame),
            // Log first few samples as int16 values
            firstSamples: audioFrame.data instanceof Int16Array ?
              Array.from(audioFrame.data.slice(0, 10)) : null,
            // Log first few bytes of the buffer
            firstBytes: audioBuffer ? Array.from(audioBuffer.slice(0, 20)) : null,
          });
        }

        logger.debug(`[LiveKitService] Received audio frame from ${participant.identity}, size: ${audioBuffer.length}`);

        // Create AudioData for callbacks
        const audioData: AudioData = {
          participant: participant.identity,
          buffer: audioBuffer,
          timestamp: Date.now(),
        };

        // Call registered callbacks
        this.audioCallbacks.forEach((callback) => {
          try {
            callback(audioData);
          } catch (error) {
            logger.error('[LiveKitService] Error in audio callback:', error);
          }
        });

        // Process through audio monitor if turn detection is enabled
        if (this.config.enableTurnDetection) {
          const audioMonitor = this.audioMonitors.get(roomName);
          if (audioMonitor) {
            logger.debug(`[LiveKitService] Forwarding audio frame to AudioMonitor for ${participant.identity}`);
            audioMonitor.processAudioFrame(participant.identity, audioBuffer);
          } else {
            logger.debug(`[LiveKitService] No AudioMonitor found for room ${roomName}`);
          }
        } else {
          logger.debug(`[LiveKitService] Turn detection disabled, using direct processing`);
          // Fallback to direct processing without turn detection
          this.processAudioDirectly(participant.identity, audioBuffer, roomName);
        }
      }
    } catch (error) {
      logger.error(`[LiveKitService] Error processing audio stream for ${participant.identity}:`, error);
    }
  }

  /**
   * Process a complete speech turn from a participant
   */
  private async processSpeechTurn(participantId: string, audioBuffer: Buffer, roomName: string): Promise<void> {
    const userState = this.userStates.get(participantId);
    if (!userState) {
      logger.warn(`[LiveKitService] No user state found for ${participantId}`);
      return;
    }
    
    if (userState.isProcessing) {
      logger.warn(`[LiveKitService] Already processing speech for ${participantId}, skipping`);
      return;
    }

    logger.info(`[LiveKitService] Starting speech processing for ${participantId}, buffer size: ${audioBuffer.length} bytes`);
    userState.isProcessing = true;

    try {
      // Update agent state
      this.setAgentState('transcribing');

      // Transcribe the audio
      const transcription = await this.transcribeAudio(audioBuffer);

      if (!transcription) {
        logger.warn(`[LiveKitService] No transcription result for ${participantId}`);
        this.setAgentState('listening');
        return;
      }

      logger.info(`[LiveKitService] Transcription from ${participantId}: "${transcription}"`);

      // Send actual transcription to frontend
      await this.sendTranscriptionData(roomName, {
        type: 'transcription',
        speaker: 'user',
        text: transcription,
        timestamp: Date.now()
      });

      // Process the message through the agent
      await this.handleMessage(transcription, participantId, roomName);

    } catch (error) {
      logger.error(`[LiveKitService] Error processing speech turn:`, error);
      this.setAgentState('listening');
    } finally {
      // Always reset processing flag
      if (userState) {
        userState.isProcessing = false;
        logger.debug(`[LiveKitService] Reset isProcessing flag for ${participantId}`);
      }
    }
  }

  /**
   * Handle a voice message similar to Discord voice plugin
   */
  private async handleMessage(message: string, participantId: string, roomName: string): Promise<void> {
    try {
      // Update agent state
      this.setAgentState('thinking');

      // Create entity ID for the participant
      const entityId = createUniqueUuid(this.runtime, `livekit-user-${participantId}`);
      const roomId = createUniqueUuid(this.runtime, `livekit-${roomName}`);

      // Ensure connection exists
      await this.runtime.ensureConnection({
        entityId: entityId,
        roomId: roomId,
        userName: `LiveKit User ${participantId}`,
        name: `LiveKit User ${participantId}`,
        source: 'livekit',
        channelId: roomName,
        serverId: 'livekit',
        type: ChannelType.VOICE_GROUP,
        worldId: createUniqueUuid(this.runtime, 'livekit-world'),
        worldName: 'LiveKit Voice Chat',
      });

      // Create memory for user message
      const userMemory: Memory = {
        id: createUniqueUuid(this.runtime, `${roomName}-${Date.now()}-user`),
        entityId: entityId,
        agentId: this.runtime.agentId,
        roomId: roomId,
        content: {
          text: message,
          source: 'livekit_chat',
          isVoiceMessage: true,
          participantId: participantId,
        },
        createdAt: Date.now(),
      };

      // Save user memory
      await this.runtime.createMemory(userMemory, 'messages');

      // Create callback to handle agent response
      const callback: HandlerCallback = async (content: Content, _files: any[] = []): Promise<Memory[]> => {
        if (content.text) {
          logger.info(`[LiveKitService] Agent response for ${participantId}: "${content.text}"`);

          // Send agent response to frontend
          await this.sendTranscriptionData(roomName, {
            type: 'transcription',
            speaker: 'agent',
            text: content.text,
            timestamp: Date.now()
          });

          // Create memory for agent response
          const agentMemory: Memory = {
            id: createUniqueUuid(this.runtime, `${roomName}-${Date.now()}-agent`),
            entityId: this.runtime.agentId,
            agentId: this.runtime.agentId,
            roomId: roomId,
            content: {
              text: content.text,
              source: 'livekit_chat',
              isVoiceMessage: true,
              inReplyTo: userMemory.id,
              name: this.runtime.character.name,
            },
            createdAt: Date.now(),
          };

          // Save agent memory
          await this.runtime.createMemory(agentMemory, 'messages');

          // Speak the response to the room
          await this.speakResponseToRoom(content.text, participantId);

          return [agentMemory];
        }
        return [];
      };

      // Emit event for message processing
      this.runtime.emitEvent(['LIVEKIT_VOICE_MESSAGE_RECEIVED', 'VOICE_MESSAGE_RECEIVED'], {
        runtime: this.runtime,
        message: userMemory,
        callback,
      });

    } catch (error) {
      logger.error(`[LiveKitService] Error handling message:`, error);
      this.setAgentState('listening');
    }
  }

  /**
   * Process audio directly without turn detection (fallback)
   */
  private async processAudioDirectly(participantId: string, audioBuffer: Buffer, roomName: string): Promise<void> {
    // Simple volume-based processing for fallback
    const audioManager = this.audioManagers.get(roomName);
    if (!audioManager) return;

    if (audioManager.isLoudEnough(audioBuffer)) {
      // Accumulate audio in user state
      let userState = this.userStates.get(participantId);
      if (!userState) {
        userState = {
          isProcessing: false,
          lastActivity: Date.now(),
          buffers: [],
        };
        this.userStates.set(participantId, userState);
      }

      userState.buffers.push(audioBuffer);
      userState.lastActivity = Date.now();

      // Process after accumulating enough audio (simple timeout-based)
      setTimeout(() => {
        if (userState && userState.buffers.length > 0 && !userState.isProcessing) {
          const combinedBuffer = Buffer.concat(userState.buffers);
          userState.buffers = [];
          this.processSpeechTurn(participantId, combinedBuffer, roomName);
        }
      }, 2000); // 2 second timeout
    }
  }

  /**
   * Handle interruption by stopping current audio playback
   */
  private handleInterruption(participantId: string, roomName: string): void {
    const activePlayer = this.activeAudioPlayers.get(roomName);
    if (activePlayer) {
      logger.info(`[LiveKitService] Interruption detected, stopping audio playback in room: ${roomName}`);

      // Stop the current audio playback
      try {
        activePlayer.stop?.();
      } catch (error) {
        logger.warn(`[LiveKitService] Error stopping audio player:`, error);
      }

      this.activeAudioPlayers.delete(roomName);
    }
  }

  /**
   * Convert raw PCM audio data to WAV format for transcription
   */
  private convertPCMToWAV(pcmBuffer: Buffer, sampleRate: number = 48000, channels: number = 1, bitsPerSample: number = 16, byteOrder: 'LE' | 'BE' = 'LE'): Buffer {
    // If byte order is BE, convert to LE first
    let processedBuffer = pcmBuffer;
    if (byteOrder === 'BE') {
      // Create a buffer from the Int16Array's underlying ArrayBuffer
      processedBuffer = Buffer.alloc(pcmBuffer.length);
      for (let i = 0; i < pcmBuffer.length; i += 2) {
        // Swap bytes to convert from BE to LE
        processedBuffer[i] = pcmBuffer[i + 1];
        processedBuffer[i + 1] = pcmBuffer[i];
      }
    }

    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);
    const dataSize = processedBuffer.length;
    const fileSize = 36 + dataSize;

    // Create WAV header
    const header = Buffer.alloc(44);
    let offset = 0;

    // RIFF chunk descriptor
    header.write('RIFF', offset); offset += 4;
    header.writeUInt32LE(fileSize, offset); offset += 4;
    header.write('WAVE', offset); offset += 4;

    // fmt sub-chunk
    header.write('fmt ', offset); offset += 4;
    header.writeUInt32LE(16, offset); offset += 4; // Sub-chunk size
    header.writeUInt16LE(1, offset); offset += 2; // Audio format (1 = PCM)
    header.writeUInt16LE(channels, offset); offset += 2;
    header.writeUInt32LE(sampleRate, offset); offset += 4;
    header.writeUInt32LE(byteRate, offset); offset += 4;
    header.writeUInt16LE(blockAlign, offset); offset += 2;
    header.writeUInt16LE(bitsPerSample, offset); offset += 2;

    // data sub-chunk
    header.write('data', offset); offset += 4;
    header.writeUInt32LE(dataSize, offset);

    // Combine header and PCM data
    return Buffer.concat([header, processedBuffer]);
  }

  /**
   * Transcribe audio using the runtime's transcription model
   */
  private async transcribeAudio(audioBuffer: Buffer): Promise<string | null> {
    try {
      // Whisper expects: 16kHz, mono, PCM signed 16-bit little-endian
      // According to Whisper docs: ffmpeg -i <input> -ar 16000 -ac 1 -c:a pcm_s16le <output>.wav
      const WHISPER_SAMPLE_RATE = 16000;

      // Use the actual sample rate from LiveKit configuration
      // LiveKit typically uses 48kHz for audio
      const originalSampleRate = this.config.audioConfig?.sampleRate || 48000;

      logger.info(`[LiveKitService] Audio buffer analysis:`, {
        bufferSize: audioBuffer.length,
        originalSampleRate: originalSampleRate,
        targetSampleRate: WHISPER_SAMPLE_RATE,
        willResample: originalSampleRate !== WHISPER_SAMPLE_RATE,
        durationMs: Math.round((audioBuffer.length / 2) / originalSampleRate * 1000)
      });

      // Check audio quality
      const hasVariation = this.checkAudioVariation(audioBuffer);
      const averageValue = this.getAverageAudioValue(audioBuffer);
      const maxValue = this.getMaxAudioValue(audioBuffer);

      logger.info(`[LiveKitService] Audio quality metrics:`, {
        hasVariation,
        averageValue: Math.round(averageValue),
        maxValue
      });

      // If no variation in audio, it's likely silence
      if (!hasVariation || maxValue < 100) {
        logger.info(`[LiveKitService] Audio appears to be silence, skipping transcription`);
        return null;
      }

      // Resample audio if needed
      let processedBuffer = audioBuffer;
      if (originalSampleRate !== WHISPER_SAMPLE_RATE) {
        logger.info(`[LiveKitService] Resampling audio from ${originalSampleRate}Hz to ${WHISPER_SAMPLE_RATE}Hz`);
        processedBuffer = this.resampleAudio(audioBuffer, originalSampleRate, WHISPER_SAMPLE_RATE);
      }

      // Convert to WAV format with 16kHz sample rate
      const wavBuffer = this.convertPCMToWAV(processedBuffer, WHISPER_SAMPLE_RATE, 1, 16, 'LE');

      logger.info(`[LiveKitService] Sending ${wavBuffer.length} bytes to Whisper API (16kHz mono PCM)`);

      // Use the runtime's transcription model
      const transcription = await this.runtime.useModel(ModelType.TRANSCRIPTION, wavBuffer);

      if (transcription && typeof transcription === 'string' && transcription.trim().length > 0) {
        logger.info(`[LiveKitService] Transcription successful: "${transcription}"`);
        return transcription;
      }

      logger.info(`[LiveKitService] No valid transcription received`);
      return null;
    } catch (error) {
      logger.error('[LiveKitService] Transcription failed:', error);
      return null;
    }
  }

  private checkAudioVariation(audioBuffer: Buffer): boolean {
    const tolerance = 10; // Adjust this value to change the sensitivity
    const firstValue = audioBuffer.readInt16LE(0);
    for (let i = 1; i < audioBuffer.length; i += 2) {
      const currentValue = audioBuffer.readInt16LE(i);
      if (Math.abs(currentValue - firstValue) > tolerance) {
        return true;
      }
    }
    return false;
  }

  private getAverageAudioValue(audioBuffer: Buffer): number {
    let sum = 0;
    for (let i = 0; i < audioBuffer.length; i += 2) {
      sum += Math.abs(audioBuffer.readInt16LE(i));
    }
    return sum / (audioBuffer.length / 2);
  }

  private getMaxAudioValue(audioBuffer: Buffer): number {
    let max = 0;
    for (let i = 0; i < audioBuffer.length; i += 2) {
      const value = Math.abs(audioBuffer.readInt16LE(i));
      if (value > max) {
        max = value;
      }
    }
    return max;
  }

  /**
   * Resample audio from one sample rate to another
   * This is a simple linear interpolation resampler
   */
  private resampleAudio(inputBuffer: Buffer, fromRate: number, toRate: number): Buffer {
    if (fromRate === toRate) {
      return inputBuffer;
    }

    const ratio = fromRate / toRate;
    const inputSamples = inputBuffer.length / 2; // 16-bit samples
    const outputSamples = Math.floor(inputSamples / ratio);
    const outputBuffer = Buffer.alloc(outputSamples * 2); // 16-bit output

    for (let i = 0; i < outputSamples; i++) {
      const srcIndex = i * ratio;
      const srcIndexInt = Math.floor(srcIndex);
      const srcIndexFrac = srcIndex - srcIndexInt;

      if (srcIndexInt < inputSamples - 1) {
        // Linear interpolation between two samples
        const sample1 = inputBuffer.readInt16LE(srcIndexInt * 2);
        const sample2 = inputBuffer.readInt16LE((srcIndexInt + 1) * 2);
        const interpolated = Math.round(sample1 * (1 - srcIndexFrac) + sample2 * srcIndexFrac);
        outputBuffer.writeInt16LE(interpolated, i * 2);
      } else {
        // Use last sample if we're at the end
        const lastSample = inputBuffer.readInt16LE((inputSamples - 1) * 2);
        outputBuffer.writeInt16LE(lastSample, i * 2);
      }
    }

    return outputBuffer;
  }

  /**
   * Generate response using the runtime's text generation model
   */
  private async generateResponse(text: string, participantId: string): Promise<string> {
    try {
      const response = await this.runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: text,
      });

      return response || '';
    } catch (error) {
      logger.error('[LiveKitService] Response generation failed:', error);
      return '';
    }
  }

  /**
   * Convert text to speech and publish to room
   */
  private async speakResponseToRoom(text: string, participantId: string): Promise<void> {
    try {
      // Update agent state
      this.setAgentState('speaking');

      logger.info(`[LiveKitService] Converting text to speech: "${text}"`);

      // Use the runtime's TTS model
      const audioStream = await this.runtime.useModel(ModelType.TEXT_TO_SPEECH, text);

      if (!audioStream) {
        logger.error(`[LiveKitService] No audio stream returned from TTS`);
        this.setAgentState('listening');
        return;
      }

      // Get the room
      const roomName = Array.from(this.rooms.keys())[0];
      const room = this.rooms.get(roomName);

      if (!room || !room.localParticipant) {
        logger.error(`[LiveKitService] No room or local participant found`);
        this.setAgentState('listening');
        return;
      }

      // Publish audio to the room
      logger.info(`[LiveKitService] Publishing audio response to room ${roomName}`);

      // Convert audio stream to Buffer if needed
      let audioBuffer: Buffer;
      if (audioStream instanceof Buffer) {
        audioBuffer = audioStream;
      } else if (audioStream && typeof audioStream === 'object') {
        // If it's a stream, collect the data
        const chunks: Buffer[] = [];
        for await (const chunk of audioStream as any) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        audioBuffer = Buffer.concat(chunks);
      } else {
        logger.error(`[LiveKitService] Invalid audio stream format`);
        this.setAgentState('listening');
        return;
      }

      // Use AudioManager to publish the audio
      const audioManager = this.audioManagers.get(roomName);
      if (!audioManager) {
        logger.error(`[LiveKitService] No audio manager found for room ${roomName}`);
        this.setAgentState('listening');
        return;
      }

      // Publish the audio
      await audioManager.publishAudio(audioBuffer);

      // Store the active player
      this.activeAudioPlayers.set(participantId, audioManager);

      // Wait for audio to finish playing (estimate based on text length)
      const estimatedDuration = text.length * 50; // Rough estimate: 50ms per character
      setTimeout(() => {
        // Clean up and return to listening state
        this.activeAudioPlayers.delete(participantId);
        this.setAgentState('listening');
        logger.info(`[LiveKitService] Finished speaking response`);
      }, estimatedDuration);

    } catch (error) {
      logger.error(`[LiveKitService] Error speaking response:`, error);
      this.setAgentState('listening');
    }
  }

  /**
   * Disconnect from all rooms
   */
  async disconnect(): Promise<void> {
    if (!this.rooms.size) {
      logger.debug('[LiveKitService] No active connections to disconnect');
      return;
    }

    logger.info('[LiveKitService] Disconnecting from all rooms');

    try {
      // Disconnect from all rooms
      const disconnectPromises = Array.from(this.rooms.keys()).map(roomName =>
        this.leaveRoom(roomName)
      );

      await Promise.all(disconnectPromises);

      // Dispose LiveKit resources
      dispose();

      logger.info('[LiveKitService] Disconnected successfully');
    } catch (error) {
      logger.error('[LiveKitService] Error during disconnect:', error);
      throw error;
    }
  }

  /**
   * Leave a specific room
   */
  private async leaveRoom(roomName: string): Promise<void> {
    logger.info(`[LiveKitService] Leaving room ${roomName}`);

    // Clean up room-specific resources
    const room = this.rooms.get(roomName);
    if (room) {
      room.disconnect();
      this.rooms.delete(roomName);
    }

    // Clean up audio manager
    const audioManager = this.audioManagers.get(roomName);
    if (audioManager) {
      this.audioManagers.delete(roomName);
    }

    // Clean up audio monitor
    const audioMonitor = this.audioMonitors.get(roomName);
    if (audioMonitor) {
      this.audioMonitors.delete(roomName);
    }

    // Remove from connected rooms
    this.connectedRooms.delete(roomName);

    // Reset agent state
    this.setAgentState('idle');

    logger.info(`[LiveKitService] Left room ${roomName}`);
  }

  isConnected(): boolean {
    return this.rooms.size > 0;
  }

  async publishAudio(audioBuffer: Buffer): Promise<void> {
    if (!this.isConnected()) {
      throw new Error('[LiveKitService] Not connected to any room');
    }

    try {
      const roomName = Array.from(this.rooms.keys())[0];
      const audioManager = this.audioManagers.get(roomName);
      if (!audioManager) {
        throw new Error(`No audio manager found for room: ${roomName}`);
      }

      // Publish audio to room
      await audioManager.publishAudio(audioBuffer);

      logger.debug('[LiveKitService] Audio published successfully');
    } catch (error) {
      logger.error('[LiveKitService] Failed to publish audio:', error);
      throw error;
    }
  }

  subscribeToAudio(callback: (audioData: AudioData) => void): void {
    this.audioCallbacks.add(callback);
    logger.debug(`[LiveKitService] Audio callback subscribed. Total: ${this.audioCallbacks.size}`);
  }

  unsubscribeFromAudio(callback: (audioData: AudioData) => void): void {
    this.audioCallbacks.delete(callback);
    logger.debug(`[LiveKitService] Audio callback unsubscribed. Total: ${this.audioCallbacks.size}`);
  }

  getRoomState(): RoomState {
    if (!this.rooms.size) {
      return {
        connected: false,
        roomName: '',
        participantCount: 0,
        localParticipant: undefined,
      };
    }

    const roomName = Array.from(this.rooms.keys())[0];
    return {
      connected: this.isConnected(),
      roomName,
      participantCount: this.userStates.size,
      localParticipant: this.getLocalParticipantInfo(),
    };
  }

  getParticipants(): ParticipantInfo[] {
    return Array.from(this.userStates.keys()).map(participantId => ({
      id: participantId,
      name: participantId,
      connected: true,
      speaking: false,
      audioEnabled: false,
      lastActivity: Date.now(),
    }));
  }

  private getLocalParticipantInfo(): ParticipantInfo | undefined {
    if (!this.rooms.size) return undefined;

    const roomName = Array.from(this.rooms.keys())[0];
    const audioManager = this.audioManagers.get(roomName);
    if (!audioManager) return undefined;

    return {
      id: 'agent',
      name: 'agent',
      connected: true,
      speaking: false,
      audioEnabled: true,
      lastActivity: Date.now(),
    };
  }

  updateAudioSettings(settings: Partial<AudioSettings>): void {
    this.audioManagers.forEach(audioManager => {
      audioManager.updateSettings(settings);
    });
  }

  getAudioSettings(): AudioSettings {
    const roomName = Array.from(this.rooms.keys())[0];
    const audioManager = this.audioManagers.get(roomName);
    if (!audioManager) {
      throw new Error(`No audio manager found for room: ${roomName}`);
    }

    return audioManager.getSettings();
  }

  async stop(): Promise<void> {
    await this.disconnect();
  }

  /**
   * Auto-join a room as an agent when a user connects
   */
  async autoJoinRoom(roomName: string, agentIdentity: string): Promise<void> {
    try {
      logger.info(`[LiveKitService] Agent ${agentIdentity} attempting to join room ${roomName}`);

      // Check if agent is already in this room
      if (this.connectedRooms.has(roomName)) {
        logger.warn(`[LiveKitService] Agent is already connected to room ${roomName}`);
        return;
      }

      // Disconnect from current room if connected to a different one
      if (this.rooms.size && Array.from(this.rooms.keys())[0] !== roomName) {
        logger.debug(`[LiveKitService] Disconnecting from current room to join ${roomName}`);
        await this.disconnect();
      }

      // Generate token for the agent
      const token = await this.generateAgentToken(roomName, agentIdentity);
      const wsUrl = process.env.LIVEKIT_URL;

      if (!wsUrl) {
        throw new Error('LIVEKIT_URL environment variable not set');
      }

      // Connect to the room
      await this.connect({
        wsUrl,
        token,
        roomName,
        participantName: agentIdentity,
        audioSettings: {
          sampleRate: 48000,
          channels: 1,
          frameDurationMs: 100,
          volumeThreshold: 1000,
        },
      });

      // Mark room as connected
      this.connectedRooms.add(roomName);

      // Set up agent-specific behavior
      this.setupAgentBehavior();

      // Set initial state
      this.setAgentState('listening');

      logger.info(`[LiveKitService] Agent ${agentIdentity} successfully joined room ${roomName}`);
    } catch (error) {
      logger.error(`[LiveKitService] Failed to auto-join room ${roomName}:`, error);
      throw error;
    }
  }

  /**
   * Generate a token for the agent to join a room
   */
  private async generateAgentToken(roomName: string, agentIdentity: string): Promise<string> {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      throw new Error('LiveKit API credentials not configured');
    }

    const token = new AccessToken(apiKey, apiSecret, {
      identity: agentIdentity,
    });

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });

    return token.toJwt();
  }

  /**
   * Set up agent-specific behavior for voice processing
   */
  private setupAgentBehavior(): void {
    logger.debug('[LiveKitService] Setting up agent behavior for voice processing');

    // Only subscribe to continuous audio processing if turn detection is disabled
    // When turn detection is enabled, audio processing happens via AudioMonitor events
    if (!this.config.enableTurnDetection) {
      logger.debug('[LiveKitService] Turn detection disabled, using continuous audio processing');
      this.subscribeToAudio(async (audioData: AudioData) => {
        await this.processAudioDirectly(audioData.participant, audioData.buffer, Array.from(this.rooms.keys())[0]);
      });
    } else {
      logger.debug('[LiveKitService] Turn detection enabled, using VAD-based processing');
    }

    // Set up event handlers for enhanced turn detection
    this.eventEmitter.on('speechStarted', (participantId: string) => {
      logger.debug(`[LiveKitService] Speech started from ${participantId}`);
    });

    this.eventEmitter.on('speechEnded', (participantId: string, audioBuffer: Buffer) => {
      logger.debug(`[LiveKitService] Speech ended from ${participantId}, processing audio buffer (${audioBuffer.length} bytes)`);
      
      // Get the room name for this participant
      const roomName = Array.from(this.rooms.keys())[0]; // Get the first room (assuming single room for now)
      if (roomName) {
        this.processSpeechTurn(participantId, audioBuffer, roomName);
      } else {
        logger.warn(`[LiveKitService] No room found for participant ${participantId}`);
      }
    });

    this.eventEmitter.on('speechTurn', (participantId: string, audioBuffer: Buffer, speechDuration: number) => {
      logger.info(`[LiveKitService] Speech turn detected from ${participantId}, duration: ${speechDuration}ms, processing audio buffer (${audioBuffer.length} bytes)`);
      
      // Get the room name for this participant
      const roomName = Array.from(this.rooms.keys())[0]; // Get the first room (assuming single room for now)
      if (roomName) {
        this.processSpeechTurn(participantId, audioBuffer, roomName);
      } else {
        logger.warn(`[LiveKitService] No room found for participant ${participantId}`);
      }
    });

    this.eventEmitter.on('interruptionDetected', (participantId: string) => {
      logger.debug(`[LiveKitService] Interruption detected: ${participantId}`);
      this.handleInterruption(participantId, Array.from(this.rooms.keys())[0]);
    });
  }

  /**
   * Set the agent state and emit event
   */
  private setAgentState(state: 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'): void {
    this.agentState = state;
    this.eventEmitter.emit('agentStateChanged', state);
    logger.debug(`[LiveKitService] Agent state changed to: ${state}`);
  }

  /**
   * Get current agent state
   */
  getAgentState(): string {
    return this.agentState;
  }

  /**
   * Subscribe to agent state changes
   */
  onAgentStateChange(callback: (state: string) => void): void {
    this.eventEmitter.on('agentStateChanged', callback);
  }

  /**
   * Send transcription data through LiveKit data channel
   */
  private async sendTranscriptionData(roomName: string, data: any): Promise<void> {
    try {
      const room = this.rooms.get(roomName);
      if (!room || !room.localParticipant) {
        logger.warn(`[LiveKitService] Cannot send data - room not found or no local participant`);
        return;
      }

      const encoder = new TextEncoder();
      const payload = encoder.encode(JSON.stringify(data));

      // Send data to all participants
      await room.localParticipant.publishData(payload, { reliable: true });

      logger.debug(`[LiveKitService] Sent transcription data:`, data);
    } catch (error) {
      logger.error(`[LiveKitService] Error sending transcription data:`, error);
    }
  }

  async destroy(): Promise<void> {
    // Disconnect from all rooms
    const disconnectPromises = Array.from(this.rooms.keys()).map(roomName =>
      this.leaveRoom(roomName)
    );

    await Promise.all(disconnectPromises);

    // Dispose LiveKit resources
    dispose();

    logger.info('[LiveKitService] Service destroyed');
  }
}

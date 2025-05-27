import type {
  Service,
  IAgentRuntime,
  Memory,
  Provider,
  ProviderResult,
} from '@elizaos/core';
// Note: @livekit/rtc-node types will be available at runtime
// but may not be available during build in workspace environments
interface Room {
  disconnect(): Promise<void>;
  // Add other Room interface methods as needed
}

interface AudioFrame {
  // Add AudioFrame interface as needed
}

interface LocalAudioTrack {
  // Add LocalAudioTrack interface as needed
}

interface AudioSource {
  // Add AudioSource interface as needed
}

export interface LiveKitConnectionConfig {
  wsUrl: string;
  token: string;
  roomName?: string;
  participantName?: string;
  audioSettings?: AudioSettings;
}

export interface AudioSettings {
  sampleRate: number;
  channels: number;
  frameDurationMs: number;
  volumeThreshold?: number;
}

export interface AudioData {
  participant: string;
  buffer: Buffer;
  timestamp: number;
}

export type AudioCallback = (data: AudioData) => void;

export enum LiveKitEvent {
  PARTICIPANT_CONNECTED = 'participant_connected',
  PARTICIPANT_DISCONNECTED = 'participant_disconnected',
  AUDIO_RECEIVED = 'audio_received',
  ROOM_DISCONNECTED = 'room_disconnected',
  CONNECTION_QUALITY_CHANGED = 'connection_quality_changed',
  TRACK_SUBSCRIBED = 'track_subscribed',
  TRACK_UNSUBSCRIBED = 'track_unsubscribed',
}

export interface ParticipantInfo {
  id: string;
  name: string;
  connected: boolean;
  speaking: boolean;
  audioEnabled: boolean;
  lastActivity: number;
}

export interface RoomState {
  connected: boolean;
  roomName: string;
  participantCount: number;
  localParticipant?: ParticipantInfo;
}

export interface ILiveKitService extends Service {
  // Connection management
  connect(config: LiveKitConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Audio streaming
  publishAudio(audioBuffer: Buffer): Promise<void>;
  subscribeToAudio(callback: AudioCallback): void;
  unsubscribeFromAudio(callback: AudioCallback): void;

  // Room management
  getRoomState(): RoomState;
  getParticipants(): ParticipantInfo[];

  // Events
  on(event: LiveKitEvent, handler: (...args: any[]) => void): void;
  off(event: LiveKitEvent, handler: (...args: any[]) => void): void;
  emit(event: LiveKitEvent, ...args: any[]): void;
}

export interface IAudioManager {
  initialize(settings?: AudioSettings): Promise<void>;
  publishAudio(audioBuffer: Buffer): Promise<void>;
  convertToPcm(buffer: Buffer, sampleRate?: number): Promise<Int16Array>;
  isLoudEnough(pcmBuffer: Buffer, threshold?: number): boolean;
  detectAudioFormat(buffer: Buffer): 'mp3' | 'wav' | 'pcm';
}

export interface ITokenManager {
  generateToken(roomName: string, participantName: string): Promise<string>;
  validateToken(token: string): boolean;
}

export interface ParticipantProvider extends Provider {
  name: 'LIVEKIT_PARTICIPANTS';
  get(
    runtime: IAgentRuntime,
    message: Memory,
  ): Promise<
    ProviderResult & {
      participants: ParticipantInfo[];
      roomState: RoomState;
    }
  >;
}


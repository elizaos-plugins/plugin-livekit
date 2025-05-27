import { AudioFrame, AudioSource, LocalAudioTrack, TrackPublishOptions, TrackSource, Room } from '@livekit/rtc-node';
import { logger } from '@elizaos/core';
import type { IAudioManager, AudioSettings } from '../types/interfaces';
import { AudioConverter } from '../utils/audio-converter';
import { VoiceDetection } from '../utils/voice-detection';

export class AudioManager implements IAudioManager {
  private audioSource: AudioSource | null = null;
  private localTrack: LocalAudioTrack | null = null;
  private settings: AudioSettings;
  private room: Room | null = null;

  constructor(room: Room | null = null) {
    this.room = room;
    this.settings = {
      sampleRate: 48000,
      channels: 1,
      frameDurationMs: 100,
      volumeThreshold: 1000,
    };
  }

  async initialize(settings: AudioSettings = this.settings): Promise<void> {
    this.settings = { ...this.settings, ...settings };
    logger.info(`[AudioManager] Initialized with settings:`, this.settings);
  }

  setRoom(room: Room): void {
    this.room = room;
  }

  /**
   * Publishes audio buffer to LiveKit room
   */
  async publishAudio(audioBuffer: Buffer): Promise<void> {
    if (!this.room) {
      throw new Error('AudioManager: Room not set. Call setRoom() first.');
    }

    const { sampleRate, channels, frameDurationMs } = this.settings;
    const samplesPerFrame = (sampleRate * frameDurationMs) / 1000;

    const int16 = await this.convertToPcm(audioBuffer, sampleRate);
    if (!int16 || int16.length === 0) {
      logger.warn('[AudioManager] No PCM data decoded');
      return;
    }

    // Initialize audio source and track if not already done
    if (!this.audioSource) {
      this.audioSource = new AudioSource(sampleRate, channels);
      this.localTrack = LocalAudioTrack.createAudioTrack(
        'agent-voice',
        this.audioSource,
      );

      const options = new TrackPublishOptions();
      options.source = TrackSource.SOURCE_MICROPHONE;
      if (!this.room?.localParticipant) {
        throw new Error('AudioManager: Room or local participant not available');
      }
      await this.room.localParticipant.publishTrack(this.localTrack, options);

      logger.info('[AudioManager] Audio track published');
    }

    // Add silence frame before audio to prevent audio artifacts
    const silence = new Int16Array(samplesPerFrame);
    await this.audioSource.captureFrame(
      new AudioFrame(silence, sampleRate, channels, silence.length),
    );

    // Publish audio in frames
    for (let i = 0; i < int16.length; i += samplesPerFrame) {
      const slice = int16.slice(i, i + samplesPerFrame);
      const frame = new AudioFrame(slice, sampleRate, channels, slice.length);
      await this.audioSource.captureFrame(frame);
    }

    logger.debug(`[AudioManager] Published ${int16.length} audio samples`);
  }

  /**
   * Converts audio buffer to PCM format
   */
  async convertToPcm(buffer: Buffer, sampleRate = 48000): Promise<Int16Array> {
    try {
      return await AudioConverter.toPcm(buffer, sampleRate);
    } catch (error) {
      logger.error('[AudioManager] Audio conversion failed:', error);
      throw error;
    }
  }

  /**
   * Checks if audio buffer has sufficient volume
   */
  isLoudEnough(pcmBuffer: Buffer, threshold?: number): boolean {
    return VoiceDetection.isLoudEnough(
      pcmBuffer,
      threshold ?? this.settings.volumeThreshold ?? 1000,
    );
  }

  /**
   * Detects audio format from buffer
   */
  detectAudioFormat(buffer: Buffer): 'mp3' | 'wav' | 'pcm' {
    return AudioConverter.detectAudioFormat(buffer);
  }

  /**
   * Cleanup audio resources
   */
  async cleanup(): Promise<void> {
    if (this.localTrack && this.room?.localParticipant) {
      try {
        if (this.localTrack.sid) {
          await this.room.localParticipant.unpublishTrack(this.localTrack.sid);
        }
        this.localTrack = null;
      } catch (error) {
        logger.warn('[AudioManager] Error unpublishing track:', error);
      }
    }

    this.audioSource = null;
    logger.info('[AudioManager] Cleanup completed');
  }

  /**
   * Get current audio settings
   */
  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  /**
   * Update audio settings
   */
  updateSettings(newSettings: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    logger.info('[AudioManager] Settings updated:', this.settings);
  }
}

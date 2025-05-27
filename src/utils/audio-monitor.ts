import { EventEmitter } from 'eventemitter3';
import { logger } from '@elizaos/core';
import { VoiceDetection } from './voice-detection';

export interface AudioMonitorConfig {
  frameSize: number;
  sampleRate: number;
  channels: number;
  silenceThreshold: number;
  speechThreshold: number;
  maxBufferDuration: number;
  volumeWindowSize: number;
  speakingThreshold: number;
  minSpeechDuration: number;
  maxSpeechDuration: number;
  debounceThreshold: number;
  silenceFramesRequired: number;
  speechFramesRequired: number;
}

export interface AudioMonitorEvents {
  'speakingStarted': (participantId: string) => void;
  'speakingStopped': (participantId: string, audioBuffer: Buffer) => void;
  'volumeDetected': (participantId: string, volume: number) => void;
  'interruptionDetected': (participantId: string) => void;
}

/**
 * Audio monitor for real-time voice activity detection and interruption handling
 * Inspired by Discord plugin's AudioMonitor class
 */
export class AudioMonitor extends EventEmitter<AudioMonitorEvents> {
  private config: AudioMonitorConfig;
  private voiceDetection: VoiceDetection;
  private volumeBuffers: Map<string, number[]> = new Map();
  private isMonitoring = false;
  private participantBuffers: Map<string, Buffer[]> = new Map();
  private participantStates: Map<string, {
    isSpeaking: boolean;
    startTime: number;
    lastActivity: number;
  }> = new Map();

  constructor(config: Partial<AudioMonitorConfig> = {}) {
    super();
    
    this.config = {
      frameSize: 160,           // 10ms at 16kHz
      sampleRate: 16000,
      channels: 1,
      silenceThreshold: 0.01,
      speechThreshold: 0.05,
      maxBufferDuration: 30000, // 30 seconds max
      volumeWindowSize: 10,     // Volume averaging window
      speakingThreshold: 0.1,   // Interruption threshold
      minSpeechDuration: 100,   // 100ms min speech duration
      maxSpeechDuration: 30000, // 30 seconds max speech duration
      debounceThreshold: 100,   // 100ms debounce threshold
      silenceFramesRequired: 3, // 3 frames of silence required
      speechFramesRequired: 3,  // 3 frames of speech required
      ...config
    };

    // Initialize voice detection with matching config
    this.voiceDetection = new VoiceDetection({
      silenceThreshold: this.config.silenceThreshold,
      speechThreshold: this.config.speechThreshold,
      frameSize: this.config.frameSize,
      sampleRate: this.config.sampleRate,
      minSpeechDuration: this.config.minSpeechDuration,
      maxSpeechDuration: this.config.maxSpeechDuration,
      debounceThreshold: this.config.debounceThreshold,
      silenceFramesRequired: this.config.silenceFramesRequired,
      speechFramesRequired: this.config.speechFramesRequired,
    });

    this.setupVoiceDetectionEvents();
    logger.info('[AudioMonitor] Initialized with config:', this.config);
  }

  /**
   * Setup voice detection event handlers
   */
  private setupVoiceDetectionEvents(): void {
    this.voiceDetection.on('speechStarted', (participantId) => {
      this.handleSpeechStarted(participantId);
    });

    this.voiceDetection.on('speechEnded', (participantId, audioBuffer) => {
      this.handleSpeechEnded(participantId, audioBuffer);
    });

    this.voiceDetection.on('speechTurn', (participantId, audioBuffer, duration) => {
      logger.debug(`[AudioMonitor] Speech turn completed for ${participantId}: ${duration}ms`);
      // Forward as speakingStopped event to trigger processing in LiveKitService
      this.emit('speakingStopped', participantId, audioBuffer);
    });
  }

  /**
   * Start monitoring audio for a participant
   */
  startMonitoring(participantId: string): void {
    if (!this.participantStates.has(participantId)) {
      this.participantStates.set(participantId, {
        isSpeaking: false,
        startTime: 0,
        lastActivity: Date.now(),
      });
      
      this.volumeBuffers.set(participantId, []);
      this.participantBuffers.set(participantId, []);
      
      logger.debug(`[AudioMonitor] Started monitoring participant: ${participantId}`);
    }
    
    this.isMonitoring = true;
  }

  /**
   * Stop monitoring audio for a participant
   */
  stopMonitoring(participantId: string): void {
    this.participantStates.delete(participantId);
    this.volumeBuffers.delete(participantId);
    this.participantBuffers.delete(participantId);
    this.voiceDetection.cleanup(participantId);
    
    logger.debug(`[AudioMonitor] Stopped monitoring participant: ${participantId}`);
    
    // Stop global monitoring if no participants
    if (this.participantStates.size === 0) {
      this.isMonitoring = false;
    }
  }

  /**
   * Process incoming audio frame
   */
  processAudioFrame(participantId: string, audioBuffer: Buffer): void {
    
    if (!this.isMonitoring || !this.participantStates.has(participantId)) {
      return;
    }

    // Update last activity
    const state = this.participantStates.get(participantId)!;
    state.lastActivity = Date.now();

    // Calculate volume for interruption detection
    const volume = this.calculateVolume(audioBuffer);
    this.updateVolumeBuffer(participantId, volume);
    
    // Check for interruption
    this.checkForInterruption(participantId, volume);

    // Process through voice detection
    this.voiceDetection.processAudioFrame(participantId, audioBuffer);

    // Emit volume event
    this.emit('volumeDetected', participantId, volume);
  }

  /**
   * Handle speech started event
   */
  private handleSpeechStarted(participantId: string): void {
    const state = this.participantStates.get(participantId);
    if (state && !state.isSpeaking) {
      state.isSpeaking = true;
      state.startTime = Date.now();
      
      // Reset buffers
      this.participantBuffers.set(participantId, []);
      
      this.emit('speakingStarted', participantId);
      logger.debug(`[AudioMonitor] Speaking started for ${participantId}`);
    }
  }

  /**
   * Handle speech ended event
   */
  private handleSpeechEnded(participantId: string, audioBuffer: Buffer): void {
    const state = this.participantStates.get(participantId);
    if (state && state.isSpeaking) {
      state.isSpeaking = false;
      
      this.emit('speakingStopped', participantId, audioBuffer);
      logger.debug(`[AudioMonitor] Speaking stopped for ${participantId}`);
    }
  }

  /**
   * Calculate volume (RMS) of audio buffer
   */
  private calculateVolume(buffer: Buffer): number {
    if (buffer.length < 2) return 0;

    let sumSquares = 0;
    const sampleCount = Math.floor(buffer.length / 2);

    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      const normalizedSample = sample / 32768.0;
      sumSquares += normalizedSample * normalizedSample;
    }

    return Math.sqrt(sumSquares / sampleCount);
  }

  /**
   * Update volume buffer for averaging
   */
  private updateVolumeBuffer(participantId: string, volume: number): void {
    let volumeBuffer = this.volumeBuffers.get(participantId);
    if (!volumeBuffer) {
      volumeBuffer = [];
      this.volumeBuffers.set(participantId, volumeBuffer);
    }

    volumeBuffer.push(volume);
    
    // Keep only recent volumes
    if (volumeBuffer.length > this.config.volumeWindowSize) {
      volumeBuffer.shift();
    }
  }

  /**
   * Check for interruption based on volume
   */
  private checkForInterruption(participantId: string, volume: number): void {
    const volumeBuffer = this.volumeBuffers.get(participantId);
    if (!volumeBuffer || volumeBuffer.length < this.config.volumeWindowSize) {
      return;
    }

    // Calculate average volume
    const avgVolume = volumeBuffer.reduce((sum, v) => sum + v, 0) / volumeBuffer.length;
    
    // Check if volume exceeds speaking threshold
    if (avgVolume > this.config.speakingThreshold) {
      this.emit('interruptionDetected', participantId);
      
      // Clear volume buffer to prevent repeated interruptions
      volumeBuffer.length = 0;
      
      logger.debug(`[AudioMonitor] Interruption detected for ${participantId}, avg volume: ${avgVolume.toFixed(3)}`);
    }
  }

  /**
   * Get current speaking state for participant
   */
  isSpeaking(participantId: string): boolean {
    const state = this.participantStates.get(participantId);
    return state?.isSpeaking ?? false;
  }

  /**
   * Get average volume for participant
   */
  getAverageVolume(participantId: string): number {
    const volumeBuffer = this.volumeBuffers.get(participantId);
    if (!volumeBuffer || volumeBuffer.length === 0) {
      return 0;
    }

    return volumeBuffer.reduce((sum, v) => sum + v, 0) / volumeBuffer.length;
  }

  /**
   * Get participant state
   */
  getParticipantState(participantId: string) {
    return this.participantStates.get(participantId);
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<AudioMonitorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Update voice detection config
    this.voiceDetection.updateConfig({
      silenceThreshold: this.config.silenceThreshold,
      speechThreshold: this.config.speechThreshold,
      frameSize: this.config.frameSize,
      sampleRate: this.config.sampleRate,
      minSpeechDuration: this.config.minSpeechDuration,
      maxSpeechDuration: this.config.maxSpeechDuration,
      debounceThreshold: this.config.debounceThreshold,
      silenceFramesRequired: this.config.silenceFramesRequired,
      speechFramesRequired: this.config.speechFramesRequired,
    });
    
    logger.info('[AudioMonitor] Configuration updated:', this.config);
  }

  /**
   * Reset state for participant
   */
  reset(participantId?: string): void {
    if (participantId) {
      const state = this.participantStates.get(participantId);
      if (state) {
        state.isSpeaking = false;
        state.startTime = 0;
        state.lastActivity = Date.now();
      }
      
      const volumeBuffer = this.volumeBuffers.get(participantId);
      if (volumeBuffer) {
        volumeBuffer.length = 0;
      }
      
      const buffers = this.participantBuffers.get(participantId);
      if (buffers) {
        buffers.length = 0;
      }
      
      this.voiceDetection.cleanup(participantId);
      
      logger.debug(`[AudioMonitor] Reset state for participant: ${participantId}`);
    } else {
      // Reset all
      this.participantStates.clear();
      this.volumeBuffers.clear();
      this.participantBuffers.clear();
      this.voiceDetection.cleanup();
      
      logger.info('[AudioMonitor] Reset all participant states');
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.isMonitoring = false;
    this.reset();
    this.voiceDetection.removeAllListeners();
    
    logger.info('[AudioMonitor] Cleanup completed');
  }

  /**
   * Get monitoring status
   */
  getMonitoringStatus(): {
    isMonitoring: boolean;
    participantCount: number;
    participants: string[];
  } {
    return {
      isMonitoring: this.isMonitoring,
      participantCount: this.participantStates.size,
      participants: Array.from(this.participantStates.keys()),
    };
  }
}

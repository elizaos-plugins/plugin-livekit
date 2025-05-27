import { EventEmitter } from 'eventemitter3';
import { logger } from '@elizaos/core';

export interface VoiceActivityState {
  isSpeaking: boolean;
  speechStartTime: number;
  speechEndTime: number;
  buffers: Buffer[];
  totalLength: number;
  lastActivity: number;
  speechFrameCount: number;    // Count of consecutive speech frames
  silenceFrameCount: number;   // Count of consecutive silence frames
}

export interface VoiceDetectionConfig {
  silenceThreshold: number;
  speechThreshold: number;
  minSpeechDuration: number;
  maxSpeechDuration: number;
  silenceFramesRequired: number;
  speechFramesRequired: number;
  debounceThreshold: number;
  frameSize: number;
  sampleRate: number;
}

export interface VoiceDetectionEvents {
  'speechStarted': (participantId: string) => void;
  'speechEnded': (participantId: string, audioBuffer: Buffer) => void;
  'speechTurn': (participantId: string, audioBuffer: Buffer, duration: number) => void;
  'silenceDetected': (participantId: string) => void;
}

/**
 * Enhanced voice detection system inspired by Discord plugin
 * Provides turn-based speech detection with proper VAD and debouncing
 */
export class VoiceDetection extends EventEmitter<VoiceDetectionEvents> {
  private config: VoiceDetectionConfig;
  private participantStates: Map<string, VoiceActivityState> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private processingFlags: Map<string, boolean> = new Map();

  constructor(config: Partial<VoiceDetectionConfig> = {}) {
    super();
    
    this.config = {
      silenceThreshold: 0.01,        // RMS threshold for silence
      speechThreshold: 0.05,         // RMS threshold for speech
      minSpeechDuration: 500,        // Minimum speech duration (ms)
      maxSpeechDuration: 10000,      // Maximum speech duration (ms)
      silenceFramesRequired: 20,     // Frames of silence to end speech
      speechFramesRequired: 3,       // Frames of speech to start speech
      debounceThreshold: 1500,       // Debounce timeout (ms)
      frameSize: 160,                // Frame size in samples (10ms at 16kHz)
      sampleRate: 16000,             // Sample rate
      ...config
    };

    logger.info('[VoiceDetection] Initialized with config:', this.config);
  }

  /**
   * Process audio frame for voice activity detection
   */
  processAudioFrame(participantId: string, audioBuffer: Buffer): void {
    if (!this.participantStates.has(participantId)) {
      this.initializeParticipantState(participantId);
    }

    const state = this.participantStates.get(participantId)!;
    const rms = this.calculateRMS(audioBuffer);
    const isSpeechFrame = rms > this.config.speechThreshold;
    const isSilenceFrame = rms < this.config.silenceThreshold;

    // Update buffers
    state.buffers.push(audioBuffer);
    state.totalLength += audioBuffer.length;
    state.lastActivity = Date.now();

    // Manage buffer size to prevent memory issues
    this.manageBufferSize(state);

    if (isSpeechFrame) {
      state.speechFrameCount++;
      state.silenceFrameCount = 0;
    } else if (isSilenceFrame) {
      state.silenceFrameCount++;
      state.speechFrameCount = 0;
    }

    // Only log at significant milestones to reduce noise
    const shouldLog = (state.speechFrameCount === 1 || state.speechFrameCount === this.config.speechFramesRequired) ||
                     (state.silenceFrameCount === 1 || state.silenceFrameCount === this.config.silenceFramesRequired) ||
                     (state.speechFrameCount > 0 && state.speechFrameCount % 100 === 0) ||
                     (state.silenceFrameCount > 0 && state.silenceFrameCount % 200 === 0);
    
    if (shouldLog) {
      logger.debug(`[VoiceDetection] ${participantId}: RMS=${rms.toFixed(4)}, speechFrames=${state.speechFrameCount}, silenceFrames=${state.silenceFrameCount}, isSpeaking=${state.isSpeaking}`);
    }

    if (!state.isSpeaking && state.speechFrameCount >= this.config.speechFramesRequired) {
      logger.info(`[VoiceDetection] Speech START detected for ${participantId} (${state.speechFrameCount} consecutive speech frames)`);
      this.handleSpeechStart(participantId, state);
    } else if (state.isSpeaking && state.silenceFrameCount >= this.config.silenceFramesRequired) {
      // Only log speech end once when transitioning from speaking to not speaking
      if (state.silenceFrameCount === this.config.silenceFramesRequired) {
        logger.info(`[VoiceDetection] Speech END detected for ${participantId} (${state.silenceFrameCount} consecutive silence frames)`);
      }
      this.handlePotentialSpeechEnd(participantId, state);
    } else if (state.isSpeaking) {
      // Continue speech - check for maximum duration
      const speechDuration = Date.now() - state.speechStartTime;
      if (speechDuration > this.config.maxSpeechDuration) {
        logger.debug(`[VoiceDetection] Max speech duration reached for ${participantId}`);
        this.processSpeechTurn(participantId, state);
      }
    }
  }

  /**
   * Initialize participant state
   */
  private initializeParticipantState(participantId: string): void {
    this.participantStates.set(participantId, {
      isSpeaking: false,
      speechStartTime: 0,
      speechEndTime: 0,
      buffers: [],
      totalLength: 0,
      lastActivity: Date.now(),
      speechFrameCount: 0,
      silenceFrameCount: 0,
    });

    this.processingFlags.set(participantId, false);
    logger.debug(`[VoiceDetection] Initialized state for participant: ${participantId}`);
  }

  /**
   * Handle speech start detection
   */
  private handleSpeechStart(participantId: string, state: VoiceActivityState): void {
    if (this.processingFlags.get(participantId)) {
      // Skip if already processing
      return;
    }

    state.isSpeaking = true;
    state.speechStartTime = Date.now();
    
    // Clear any existing debounce timer
    const existingTimer = this.debounceTimers.get(participantId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.debounceTimers.delete(participantId);
    }

    // Reset buffers and frame counters for new speech turn
    state.buffers = [];
    state.totalLength = 0;
    state.speechFrameCount = 0;
    state.silenceFrameCount = 0;

    this.emit('speechStarted', participantId);
    logger.debug(`[VoiceDetection] Speech started for ${participantId}`);
  }

  /**
   * Handle potential speech end (silence detected)
   */
  private handlePotentialSpeechEnd(participantId: string, state: VoiceActivityState): void {
    // Mark as not speaking to prevent continuous speech end detection
    state.isSpeaking = false;
    
    // Set up debounced processing
    this.setupDebouncedProcessing(participantId, state);
  }

  /**
   * Setup debounced processing similar to Discord plugin
   */
  private setupDebouncedProcessing(participantId: string, state: VoiceActivityState): void {
    // Clear existing timer
    const existingTimer = this.debounceTimers.get(participantId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Skip if already processing
    if (this.processingFlags.get(participantId)) {
      this.resetParticipantState(participantId);
      return;
    }

    // Set up new debounce timer
    const timer = setTimeout(() => {
      this.processingFlags.set(participantId, true);
      
      try {
        this.processSpeechTurn(participantId, state);
      } finally {
        this.processingFlags.set(participantId, false);
      }
      
      this.debounceTimers.delete(participantId);
    }, this.config.debounceThreshold);

    this.debounceTimers.set(participantId, timer);
  }

  /**
   * Process complete speech turn
   */
  private processSpeechTurn(participantId: string, state: VoiceActivityState): void {
    const speechDuration = Date.now() - state.speechStartTime;
    
    // Check minimum duration
    if (speechDuration < this.config.minSpeechDuration) {
      logger.debug(`[VoiceDetection] Speech too short for ${participantId}: ${speechDuration}ms`);
      this.resetParticipantState(participantId);
      return;
    }

    // Check if we have audio data
    if (state.buffers.length === 0 || state.totalLength === 0) {
      logger.debug(`[VoiceDetection] No audio data for ${participantId}`);
      this.resetParticipantState(participantId);
      return;
    }

    // Combine all buffers
    const completeAudioBuffer = Buffer.concat(state.buffers);
    
    // Validate audio buffer
    if (!this.isValidAudioBuffer(completeAudioBuffer)) {
      logger.debug(`[VoiceDetection] Invalid audio buffer for ${participantId}`);
      this.resetParticipantState(participantId);
      return;
    }

    state.speechEndTime = Date.now();
    
    logger.info(`[VoiceDetection] Processing speech turn for ${participantId}: ${speechDuration}ms, ${completeAudioBuffer.length} bytes`);

    // Emit events
    this.emit('speechEnded', participantId, completeAudioBuffer);
    this.emit('speechTurn', participantId, completeAudioBuffer, speechDuration);

    // Reset state
    this.resetParticipantState(participantId);
  }

  /**
   * Reset participant state after processing
   */
  private resetParticipantState(participantId: string): void {
    const state = this.participantStates.get(participantId);
    if (state) {
      state.isSpeaking = false;
      state.speechStartTime = 0;
      state.speechEndTime = 0;
      state.buffers = [];
      state.totalLength = 0;
      state.speechFrameCount = 0;
      state.silenceFrameCount = 0;
    }
  }

  /**
   * Manage buffer size to prevent memory issues
   */
  private manageBufferSize(state: VoiceActivityState): void {
    const maxBufferSize = 10 * 1024 * 1024; // 10MB max
    
    while (state.totalLength > maxBufferSize && state.buffers.length > 1) {
      const removedBuffer = state.buffers.shift();
      if (removedBuffer) {
        state.totalLength -= removedBuffer.length;
      }
    }
  }

  /**
   * Calculate RMS (Root Mean Square) amplitude
   */
  private calculateRMS(buffer: Buffer): number {
    if (buffer.length < 2) return 0;

    let sumSquares = 0;
    const sampleCount = Math.floor(buffer.length / 2);

    for (let i = 0; i < buffer.length; i += 2) {
      const sample = buffer.readInt16LE(i);
      const normalizedSample = sample / 32768.0; // Normalize to [-1, 1]
      sumSquares += normalizedSample * normalizedSample;
    }

    return Math.sqrt(sumSquares / sampleCount);
  }

  /**
   * Validate audio buffer
   */
  private isValidAudioBuffer(buffer: Buffer): boolean {
    // Check minimum size (1KB)
    if (buffer.length < 1024) {
      return false;
    }

    // Check for WAV header if it looks like WAV
    if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF') {
      const wavHeader = buffer.toString('ascii', 8, 12);
      return wavHeader === 'WAVE';
    }

    // For raw PCM, just check reasonable size
    return buffer.length >= 2048; // At least 2KB for meaningful audio
  }

  /**
   * Check if participant is currently speaking
   */
  isSpeaking(participantId: string): boolean {
    const state = this.participantStates.get(participantId);
    return state?.isSpeaking ?? false;
  }

  /**
   * Check if participant is being processed
   */
  isProcessing(participantId: string): boolean {
    return this.processingFlags.get(participantId) ?? false;
  }

  /**
   * Get participant state
   */
  getParticipantState(participantId: string): VoiceActivityState | undefined {
    return this.participantStates.get(participantId);
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<VoiceDetectionConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('[VoiceDetection] Configuration updated:', this.config);
  }

  /**
   * Cleanup resources for a participant
   */
  cleanup(participantId?: string): void {
    if (participantId) {
      // Cleanup specific participant
      const timer = this.debounceTimers.get(participantId);
      if (timer) {
        clearTimeout(timer);
        this.debounceTimers.delete(participantId);
      }
      
      this.participantStates.delete(participantId);
      this.processingFlags.delete(participantId);
      
      logger.debug(`[VoiceDetection] Cleaned up participant: ${participantId}`);
    } else {
      // Cleanup all
      this.debounceTimers.forEach(timer => clearTimeout(timer));
      this.debounceTimers.clear();
      this.participantStates.clear();
      this.processingFlags.clear();
      
      logger.info('[VoiceDetection] Cleaned up all participants');
    }
  }

  /**
   * Static utility methods (backward compatibility)
   */
  static isLoudEnough(pcmBuffer: Buffer, threshold = 1000): boolean {
    if (pcmBuffer.length < 2) return false;

    let sum = 0;
    const sampleCount = Math.floor(pcmBuffer.length / 2);

    for (let i = 0; i < pcmBuffer.length; i += 2) {
      const sample = pcmBuffer.readInt16LE(i);
      sum += Math.abs(sample);
    }

    const avgAmplitude = sum / sampleCount;
    return avgAmplitude > threshold;
  }

  static calculateRms(pcmBuffer: Buffer): number {
    if (pcmBuffer.length < 2) return 0;

    let sumSquares = 0;
    const sampleCount = Math.floor(pcmBuffer.length / 2);

    for (let i = 0; i < pcmBuffer.length; i += 2) {
      const sample = pcmBuffer.readInt16LE(i);
      sumSquares += sample * sample;
    }

    return Math.sqrt(sumSquares / sampleCount);
  }

  static containsSpeech(
    pcmBuffer: Buffer,
    options: {
      minAmplitude?: number;
      minDuration?: number;
    } = {},
  ): boolean {
    const { minAmplitude = 1000 } = options;
    return VoiceDetection.isLoudEnough(pcmBuffer, minAmplitude);
  }
}

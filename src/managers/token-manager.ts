import { AccessToken } from 'livekit-server-sdk';
import { logger } from '@elizaos/core';
import type { ITokenManager } from '../types/interfaces';

export class TokenManager implements ITokenManager {
  private apiKey: string;
  private apiSecret: string;

  constructor(apiKey?: string, apiSecret?: string) {
    this.apiKey = apiKey || process.env.LIVEKIT_API_KEY || '';
    this.apiSecret = apiSecret || process.env.LIVEKIT_API_SECRET || '';

    if (!this.apiKey || !this.apiSecret) {
      logger.warn(
        '[TokenManager] API key or secret not provided. Token generation will not work.',
      );
    }
  }

  /**
   * Generates a LiveKit access token for a participant
   */
  async generateToken(
    roomName: string,
    participantName: string,
  ): Promise<string> {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error(
        'LiveKit API key and secret are required for token generation',
      );
    }

    try {
      const token = new AccessToken(this.apiKey, this.apiSecret, {
        identity: participantName,
        name: participantName,
      });

      token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });

      const jwt = token.toJwt();
      logger.info(
        `[TokenManager] Generated token for ${participantName} in room ${roomName}`,
      );

      return jwt;
    } catch (error) {
      logger.error('[TokenManager] Token generation failed:', error);
      throw new Error(`Failed to generate token: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validates a LiveKit token (basic implementation)
   */
  validateToken(token: string): boolean {
    try {
      // Basic JWT structure validation
      const parts = token.split('.');
      if (parts.length !== 3) {
        return false;
      }

      // Decode and validate header
      const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
      if (header.typ !== 'JWT' || header.alg !== 'HS256') {
        return false;
      }

      // Decode payload to check basic structure
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      if (!payload.iss || !payload.sub || !payload.video) {
        return false;
      }

      logger.debug('[TokenManager] Token validation passed');
      return true;
    } catch (error) {
      logger.warn('[TokenManager] Token validation failed:', error);
      return false;
    }
  }

  /**
   * Updates API credentials
   */
  updateCredentials(apiKey: string, apiSecret: string): void {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    logger.info('[TokenManager] Credentials updated');
  }

  /**
   * Checks if credentials are configured
   */
  hasCredentials(): boolean {
    return !!(this.apiKey && this.apiSecret);
  }
}

import { spawn } from 'node:child_process';

export class AudioConverter {
  /**
   * Converts audio buffer to PCM format using FFmpeg
   */
  static async toPcm(buffer: Buffer, sampleRate = 48000): Promise<Int16Array> {
    const format = AudioConverter.detectAudioFormat(buffer);

    if (format === 'pcm') {
      return new Int16Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.length / 2,
      );
    }

    const ffmpegArgs: string[] = [
      '-f',
      format,
      '-i',
      'pipe:0',
      '-f',
      's16le',
      '-ar',
      sampleRate.toString(),
      '-ac',
      '1',
      'pipe:1',
    ];

    return new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', ffmpegArgs);
      let raw = Buffer.alloc(0);

      ff.stdout.on('data', (chunk) => {
        raw = Buffer.concat([raw, chunk]);
      });

      ff.stderr.on('data', () => {}); // ignore logs

      ff.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`ffmpeg failed (code ${code})`));
        }
        const samples = new Int16Array(
          raw.buffer,
          raw.byteOffset,
          raw.byteLength / 2,
        );
        resolve(samples);
      });

      ff.on('error', (error) => {
        reject(new Error(`FFmpeg process error: ${error.message}`));
      });

      ff.stdin.write(buffer);
      ff.stdin.end();
    });
  }

  /**
   * Detects audio format from buffer header
   */
  static detectAudioFormat(buffer: Buffer): 'mp3' | 'wav' | 'pcm' {
    if (buffer.length < 4) return 'pcm';

    const header = buffer.slice(0, 4).toString('ascii');
    if (header === 'RIFF') return 'wav';
    if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3';
    return 'pcm';
  }
}

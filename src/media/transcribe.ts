import { readFileSync } from 'node:fs';
import { logger } from '../logger.js';

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';

export async function transcribeAudio(filePath: string, apiKey: string): Promise<string | null> {
  try {
    const buffer = readFileSync(filePath);

    // 1. Upload the file
    const uploadRes = await fetch(`${ASSEMBLYAI_BASE}/upload`, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/octet-stream',
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      logger.warn({ status: uploadRes.status }, 'AssemblyAI upload failed');
      return null;
    }

    const { upload_url } = (await uploadRes.json()) as { upload_url: string };

    // 2. Create transcription job
    const transcriptRes = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: upload_url,
        language_detection: true,
      }),
    });

    if (!transcriptRes.ok) {
      logger.warn({ status: transcriptRes.status }, 'AssemblyAI transcript creation failed');
      return null;
    }

    const { id } = (await transcriptRes.json()) as { id: string };

    // 3. Poll for completion
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(2000);

      const pollRes = await fetch(`${ASSEMBLYAI_BASE}/transcript/${id}`, {
        headers: { authorization: apiKey },
      });

      if (!pollRes.ok) continue;

      const data = (await pollRes.json()) as { status: string; text?: string; error?: string };

      if (data.status === 'completed') {
        return data.text ?? null;
      }

      if (data.status === 'error') {
        logger.warn({ error: data.error }, 'AssemblyAI transcription error');
        return null;
      }
    }

    logger.warn({ transcriptId: id }, 'AssemblyAI transcription timed out');
    return null;
  } catch (err) {
    logger.error({ err, filePath }, 'Audio transcription failed');
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

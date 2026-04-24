import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { logger } from '../logger.js';

const ASSEMBLYAI_BASE = 'https://api.assemblyai.com/v2';
const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions';
const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';

export async function transcribeAudio(filePath: string, apiKey: string): Promise<string | null> {
  return transcribeAudioWithProvider(filePath, {
    provider: 'assemblyai',
    apiKey,
  });
}

export type SttProviderName = 'assemblyai' | 'openai' | 'elevenlabs';

export interface SttTranscriptionConfig {
  provider: SttProviderName;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export async function transcribeAudioWithProvider(
  filePath: string,
  config: SttTranscriptionConfig,
): Promise<string | null> {
  if (!config.apiKey) {
    logger.warn({ provider: config.provider }, 'STT provider is missing an API key');
    return null;
  }

  switch (config.provider) {
    case 'assemblyai':
      return transcribeWithAssemblyAI(filePath, config);
    case 'openai':
      return transcribeWithOpenAI(filePath, config);
    case 'elevenlabs':
      return transcribeWithElevenLabs(filePath, config);
  }
}

async function transcribeWithAssemblyAI(
  filePath: string,
  config: SttTranscriptionConfig,
): Promise<string | null> {
  try {
    const fetcher = config.fetchImpl ?? fetch;
    const buffer = readFileSync(filePath);

    // 1. Upload the file
    const uploadRes = await fetcher(`${ASSEMBLYAI_BASE}/upload`, {
      method: 'POST',
      headers: {
        authorization: config.apiKey!,
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
    const transcriptRes = await fetcher(`${ASSEMBLYAI_BASE}/transcript`, {
      method: 'POST',
      headers: {
        authorization: config.apiKey!,
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
    const maxAttempts = config.maxPollAttempts ?? 60;
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(config.pollIntervalMs ?? 2000);

      const pollRes = await fetcher(`${ASSEMBLYAI_BASE}/transcript/${id}`, {
        headers: { authorization: config.apiKey! },
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

async function transcribeWithOpenAI(
  filePath: string,
  config: SttTranscriptionConfig,
): Promise<string | null> {
  try {
    const form = audioForm(filePath);
    form.append('model', config.model ?? 'gpt-4o-mini-transcribe');
    form.append('response_format', 'json');

    const res = await (config.fetchImpl ?? fetch)(OPENAI_TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: form,
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, 'OpenAI transcription failed');
      return null;
    }

    return extractText(await res.json(), 'OpenAI');
  } catch (err) {
    logger.error({ err, filePath }, 'OpenAI audio transcription failed');
    return null;
  }
}

async function transcribeWithElevenLabs(
  filePath: string,
  config: SttTranscriptionConfig,
): Promise<string | null> {
  try {
    const form = audioForm(filePath);
    form.append('model_id', config.model ?? 'scribe_v2');

    const res = await (config.fetchImpl ?? fetch)(ELEVENLABS_STT_URL, {
      method: 'POST',
      headers: {
        'xi-api-key': config.apiKey!,
      },
      body: form,
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, 'ElevenLabs transcription failed');
      return null;
    }

    return extractText(await res.json(), 'ElevenLabs');
  } catch (err) {
    logger.error({ err, filePath }, 'ElevenLabs audio transcription failed');
    return null;
  }
}

function audioForm(filePath: string): FormData {
  const buffer = readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([buffer]), basename(filePath));
  return form;
}

function extractText(payload: unknown, provider: string): string | null {
  if (
    payload
    && typeof payload === 'object'
    && 'text' in payload
    && typeof payload.text === 'string'
    && payload.text.trim()
  ) {
    return payload.text;
  }
  logger.warn({ provider }, 'STT provider response did not include text');
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

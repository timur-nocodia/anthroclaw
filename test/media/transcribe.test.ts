import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSttTranscriptionConfig, transcribeAudioWithProvider } from '../../src/media/transcribe.js';

describe('STT transcription providers', () => {
  let tmpDir: string;
  let audioPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'stt-provider-'));
    audioPath = join(tmpDir, 'audio.wav');
    writeFileSync(audioPath, Buffer.from('fake-audio'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('posts completed audio to OpenAI transcriptions', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: 'hello from openai' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    const transcript = await transcribeAudioWithProvider(audioPath, {
      provider: 'openai',
      apiKey: 'openai-key',
      model: 'gpt-4o-mini-transcribe',
      fetchImpl,
    });

    expect(transcript).toBe('hello from openai');
    expect(fetchImpl).toHaveBeenCalledWith('https://api.openai.com/v1/audio/transcriptions', expect.objectContaining({
      method: 'POST',
      headers: {
        Authorization: 'Bearer openai-key',
      },
      body: expect.any(FormData),
    }));
  });

  it('posts completed audio to ElevenLabs speech-to-text', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: 'hello from elevenlabs' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;

    const transcript = await transcribeAudioWithProvider(audioPath, {
      provider: 'elevenlabs',
      apiKey: 'eleven-key',
      model: 'scribe_v2',
      fetchImpl,
    });

    expect(transcript).toBe('hello from elevenlabs');
    expect(fetchImpl).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/speech-to-text', expect.objectContaining({
      method: 'POST',
      headers: {
        'xi-api-key': 'eleven-key',
      },
      body: expect.any(FormData),
    }));
  });

  it('keeps AssemblyAI upload and polling behavior behind the provider interface', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const textUrl = String(url);
      if (textUrl.endsWith('/upload')) {
        return new Response(JSON.stringify({ upload_url: 'https://cdn.example/audio.wav' }), { status: 200 });
      }
      if (textUrl.endsWith('/transcript')) {
        return new Response(JSON.stringify({ id: 'transcript-1' }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'completed', text: 'hello from assemblyai' }), { status: 200 });
    }) as unknown as typeof fetch;

    const transcript = await transcribeAudioWithProvider(audioPath, {
      provider: 'assemblyai',
      apiKey: 'assembly-key',
      fetchImpl,
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });

    expect(transcript).toBe('hello from assemblyai');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('returns null when a provider is missing credentials', async () => {
    const transcript = await transcribeAudioWithProvider(audioPath, {
      provider: 'openai',
    });

    expect(transcript).toBeNull();
  });

  it('resolves STT provider auto mode by configured provider priority', () => {
    expect(resolveSttTranscriptionConfig({
      stt: {
        provider: 'auto',
        openai: { api_key: 'openai-key', model: 'gpt-4o-mini-transcribe' },
        elevenlabs: { api_key: 'eleven-key' },
      },
    }, {})).toEqual({
      provider: 'openai',
      apiKey: 'openai-key',
      model: 'gpt-4o-mini-transcribe',
    });

    expect(resolveSttTranscriptionConfig({
      assemblyai: { api_key: 'legacy-assembly-key' },
      stt: { provider: 'auto' },
    }, {
      OPENAI_API_KEY: 'openai-key',
    })).toEqual({
      provider: 'assemblyai',
      apiKey: 'legacy-assembly-key',
      model: undefined,
    });
  });

  it('respects explicit STT provider selection', () => {
    expect(resolveSttTranscriptionConfig({
      assemblyai: { api_key: 'assembly-key' },
      stt: {
        provider: 'elevenlabs',
        elevenlabs: { api_key: 'eleven-key', model: 'scribe_v2' },
      },
    }, {})).toEqual({
      provider: 'elevenlabs',
      apiKey: 'eleven-key',
      model: 'scribe_v2',
    });

    expect(resolveSttTranscriptionConfig({
      assemblyai: { api_key: 'assembly-key' },
      stt: { provider: 'openai' },
    }, {})).toBeNull();
  });
});

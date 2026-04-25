import { timingSafeEqual } from 'node:crypto';
import type { GlobalConfig } from '../config/schema.js';

export type DirectWebhookConfig = NonNullable<GlobalConfig['webhooks']>[string];

export interface DirectWebhookRenderResult {
  text: string;
  payload: Record<string, unknown>;
}

export interface DirectWebhookHeaders {
  get(name: string): string | null;
}

export function parseDirectWebhookPayload(rawBody: string, maxBytes: number): Record<string, unknown> {
  if (Buffer.byteLength(rawBody, 'utf8') > maxBytes) {
    throw new Error(`Webhook payload exceeds ${maxBytes} bytes`);
  }

  const parsed = JSON.parse(rawBody) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Webhook payload must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

export function verifyDirectWebhookSecret(headers: DirectWebhookHeaders, expectedSecret: string): boolean {
  const provided = headers.get('x-anthroclaw-webhook-secret')
    ?? headers.get('x-webhook-secret')
    ?? readBearer(headers.get('authorization'));
  if (!provided) return false;

  const expected = Buffer.from(expectedSecret);
  const actual = Buffer.from(provided);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function renderDirectWebhook(config: DirectWebhookConfig, payload: Record<string, unknown>): DirectWebhookRenderResult {
  const allowedFields = new Set(config.fields ?? extractTemplateFields(config.template));
  const text = config.template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, field: string) => {
    if (!allowedFields.has(field)) return '';
    const value = getPayloadValue(payload, field);
    return formatTemplateValue(value);
  });

  return { text, payload: pickAllowedPayload(payload, allowedFields) };
}

function readBearer(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function extractTemplateFields(template: string): string[] {
  return [...template.matchAll(/\{([a-zA-Z0-9_.-]+)\}/g)].map((match) => match[1]);
}

function getPayloadValue(payload: Record<string, unknown>, field: string): unknown {
  return field.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, payload);
}

function formatTemplateValue(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 500);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '';
  return JSON.stringify(value).slice(0, 500);
}

function pickAllowedPayload(payload: Record<string, unknown>, allowedFields: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of allowedFields) {
    const value = getPayloadValue(payload, field);
    if (value !== undefined) out[field] = value;
  }
  return out;
}

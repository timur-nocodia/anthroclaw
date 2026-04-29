import type { ProfileName } from '../types.js';
import type { SafetyProfile } from './types.js';
import { publicProfile } from './public.js';
import { trustedProfile } from './trusted.js';
import { privateProfile } from './private.js';
import { chatLikeOpenclawProfile } from './chat-like-openclaw.js';

export const ALL_PROFILES: SafetyProfile[] = [
  publicProfile,
  trustedProfile,
  privateProfile,
  chatLikeOpenclawProfile,
];

export function getProfile(name: ProfileName): SafetyProfile {
  switch (name) {
    case 'public':
      return publicProfile;
    case 'trusted':
      return trustedProfile;
    case 'private':
      return privateProfile;
    case 'chat_like_openclaw':
      return chatLikeOpenclawProfile;
    default:
      throw new Error(`unknown safety_profile: ${name as string}`);
  }
}

/**
 * Returns the default profile name to use when scaffolding a new agent.
 * Single source-of-truth for the UI scaffold, CLI scaffold, and test fixtures.
 */
export function getDefaultProfile(): ProfileName {
  return 'chat_like_openclaw';
}

export { publicProfile, trustedProfile, privateProfile, chatLikeOpenclawProfile };
export type { SafetyProfile, SystemPromptSpec, PermissionFlow } from './types.js';

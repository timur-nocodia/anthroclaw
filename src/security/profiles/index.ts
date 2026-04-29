import type { ProfileName } from '../types.js';
import type { SafetyProfile } from './types.js';
import { publicProfile } from './public.js';
import { trustedProfile } from './trusted.js';
import { privateProfile } from './private.js';

export const ALL_PROFILES: SafetyProfile[] = [publicProfile, trustedProfile, privateProfile];

export function getProfile(name: ProfileName): SafetyProfile {
  switch (name) {
    case 'public':
      return publicProfile;
    case 'trusted':
      return trustedProfile;
    case 'private':
      return privateProfile;
    default:
      throw new Error(`unknown safety_profile: ${name}`);
  }
}

export { publicProfile, trustedProfile, privateProfile };
export type { SafetyProfile, SystemPromptSpec, PermissionFlow } from './types.js';

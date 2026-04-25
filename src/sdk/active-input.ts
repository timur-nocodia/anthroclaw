export interface SdkActiveInputStatus {
  streamInputAvailable: boolean;
  unstableSessionApiAvailable: boolean;
  featureFlagEnabled: boolean;
  nativeSteerEnabled: boolean;
  fallbackMode: 'interrupt_and_restart';
  reason: string;
}

export function getSdkActiveInputStatus(featureFlagEnabled = false): SdkActiveInputStatus {
  return {
    streamInputAvailable: true,
    unstableSessionApiAvailable: true,
    featureFlagEnabled,
    nativeSteerEnabled: false,
    fallbackMode: 'interrupt_and_restart',
    reason: featureFlagEnabled
      ? 'features.sdk_active_input is enabled, but AnthroClaw has not promoted a tested writable active-input handle. queue_mode=steer still falls back to interrupt-and-restart.'
      : 'SDK streamInput and unstable session APIs exist, but features.sdk_active_input is disabled and AnthroClaw does not yet keep a tested writable active-input handle. queue_mode=steer falls back to interrupt-and-restart.',
  };
}

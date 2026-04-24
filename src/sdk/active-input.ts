export interface SdkActiveInputStatus {
  streamInputAvailable: boolean;
  unstableSessionApiAvailable: boolean;
  nativeSteerEnabled: boolean;
  fallbackMode: 'interrupt_and_restart';
  reason: string;
}

export function getSdkActiveInputStatus(): SdkActiveInputStatus {
  return {
    streamInputAvailable: true,
    unstableSessionApiAvailable: true,
    nativeSteerEnabled: false,
    fallbackMode: 'interrupt_and_restart',
    reason: 'SDK streamInput and unstable session APIs exist, but AnthroClaw does not yet keep a tested writable active-input handle for production steer. queue_mode=steer falls back to interrupt-and-restart.',
  };
}

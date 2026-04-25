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

export type ActiveInputDeliveryState =
  | 'accepted_native'
  | 'fallback_interrupt_restart'
  | 'closed';

export interface ActiveInputDeliveryResult {
  state: ActiveInputDeliveryState;
  shouldStartReplacementRun: boolean;
  reason: string;
}

export interface ActiveInputMessageOptions {
  synthetic?: boolean;
  shouldQuery?: boolean;
}

export interface ActiveInputController {
  sendUserMessage(
    message: string,
    options?: ActiveInputMessageOptions,
  ): Promise<ActiveInputDeliveryResult>;
  close(): void;
  getStatus(): SdkActiveInputStatus;
}

export class FallbackActiveInputController implements ActiveInputController {
  private closed = false;

  constructor(private readonly featureFlagEnabled = false) {}

  async sendUserMessage(
    _message: string,
    _options: ActiveInputMessageOptions = {},
  ): Promise<ActiveInputDeliveryResult> {
    if (this.closed) {
      return {
        state: 'closed',
        shouldStartReplacementRun: false,
        reason: 'Active input controller is closed.',
      };
    }

    return {
      state: 'fallback_interrupt_restart',
      shouldStartReplacementRun: true,
      reason: this.getStatus().reason,
    };
  }

  close(): void {
    this.closed = true;
  }

  getStatus(): SdkActiveInputStatus {
    return getSdkActiveInputStatus(this.featureFlagEnabled);
  }
}

export function createFallbackActiveInputController(
  featureFlagEnabled = false,
): ActiveInputController {
  return new FallbackActiveInputController(featureFlagEnabled);
}

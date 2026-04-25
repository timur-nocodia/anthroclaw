export type ActiveInputSteerDeliveryState =
  | 'accepted_native'
  | 'queued_for_tool_boundary'
  | 'fallback_interrupt_restart'
  | 'unsupported';

export interface SdkActiveInputStatus {
  streamInputAvailable: boolean;
  unstableSessionApiAvailable: boolean;
  featureFlagEnabled: boolean;
  nativeSteerEnabled: boolean;
  fallbackMode: 'interrupt_and_restart';
  steerDeliveryState: ActiveInputSteerDeliveryState;
  uiDeliveryStates: ActiveInputSteerDeliveryState[];
  reason: string;
}

export function getSdkActiveInputStatus(featureFlagEnabled = false): SdkActiveInputStatus {
  const reason = featureFlagEnabled
    ? 'features.sdk_active_input is enabled, but native active-run steer remains disabled: AnthroClaw does not keep a tested writable SDK Query handle for active runs. Supported delivery is interrupt-and-restart.'
    : 'SDK streamInput is present, but native active-run steer is disabled until a dedicated SDK proof keeps a tested writable Query handle. Supported delivery is interrupt-and-restart.';

  return {
    streamInputAvailable: true,
    unstableSessionApiAvailable: true,
    featureFlagEnabled,
    nativeSteerEnabled: false,
    fallbackMode: 'interrupt_and_restart',
    steerDeliveryState: 'fallback_interrupt_restart',
    uiDeliveryStates: ['fallback_interrupt_restart', 'unsupported'],
    reason,
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

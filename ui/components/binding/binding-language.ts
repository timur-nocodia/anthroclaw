export type BindingChannel = "telegram" | "whatsapp" | string;

export type BindingScope = "dm" | "group" | "any" | string;

export type BindingPairingMode = "open" | "code" | "approve" | "off" | string;

export interface BindingRouteInput {
  channel: BindingChannel;
  account: string;
  scope: BindingScope;
  peers?: string[] | null;
  topics?: string[] | null;
  mention_only?: boolean;
  mentionOnly?: boolean;
  reply_to_mode?: "always" | "incoming_reply_only" | "never" | string;
  replyToMode?: "always" | "incoming_reply_only" | "never" | string;
}

export interface BindingDescribeContext {
  telegramAccounts?: Record<string, { username?: string }>;
  whatsappAccounts?: Record<string, { username?: string }>;
  pairingMode?: BindingPairingMode;
  allowlist?: string[];
}

export interface BindingDescription {
  icon: "telegram" | "whatsapp" | "other";
  title: string;
  lines: string[];
}

function getMentionOnly(route: BindingRouteInput): boolean | undefined {
  if (typeof route.mention_only === "boolean") return route.mention_only;
  if (typeof route.mentionOnly === "boolean") return route.mentionOnly;
  return undefined;
}

function getReplyToMode(route: BindingRouteInput): string | undefined {
  return route.reply_to_mode ?? route.replyToMode;
}

function channelTitle(
  channel: BindingChannel,
  account: string,
  ctx: BindingDescribeContext,
): string {
  if (channel === "telegram") {
    const known = ctx.telegramAccounts?.[account];
    if (known?.username) {
      return `Telegram (${known.username} · ${account})`;
    }
    return `Telegram (${account})`;
  }
  if (channel === "whatsapp") {
    const known = ctx.whatsappAccounts?.[account];
    if (known?.username) {
      return `WhatsApp (${known.username} · ${account})`;
    }
    return `WhatsApp (${account})`;
  }
  return `${channel} (${account})`;
}

function channelIcon(
  channel: BindingChannel,
): "telegram" | "whatsapp" | "other" {
  if (channel === "telegram") return "telegram";
  if (channel === "whatsapp") return "whatsapp";
  return "other";
}

function describeScope(route: BindingRouteInput): string[] {
  const lines: string[] = [];
  const peers = route.peers ?? null;
  const topics = route.topics ?? null;

  if (route.scope === "dm") {
    if (peers && peers.length > 0) {
      lines.push(`In direct messages from: ${peers.join(", ")}`);
    } else {
      lines.push("In: All direct messages");
    }
    return lines;
  }

  if (route.scope === "group") {
    if (peers && peers.length > 0) {
      lines.push(`In group: ${peers.join(", ")}`);
    } else {
      lines.push("In: All groups");
    }
    if (topics && topics.length > 0) {
      lines.push(`In topic: ${topics.join(", ")}`);
    }
    return lines;
  }

  if (route.scope === "any") {
    if (peers && peers.length > 0) {
      lines.push(`In: ${peers.join(", ")}`);
    } else {
      lines.push("In: Any chat (DMs and groups)");
    }
    if (topics && topics.length > 0) {
      lines.push(`In topic: ${topics.join(", ")}`);
    }
    return lines;
  }

  // Unknown scope — keep raw label.
  if (peers && peers.length > 0) {
    lines.push(`In: ${peers.join(", ")}`);
  } else {
    lines.push(`Scope: ${route.scope}`);
  }
  if (topics && topics.length > 0) {
    lines.push(`In topic: ${topics.join(", ")}`);
  }
  return lines;
}

function describeBehavior(
  route: BindingRouteInput,
  ctx: BindingDescribeContext,
): string {
  const replyMode = getReplyToMode(route);
  if (replyMode === "incoming_reply_only") {
    return "Behavior: Responds only when someone replies to its messages";
  }

  if (route.scope === "dm") {
    if (ctx.pairingMode === "open") {
      return "Behavior: Open pairing (anyone can DM)";
    }
    if (ctx.pairingMode === "code") {
      return "Behavior: Pair via code";
    }
    if (ctx.pairingMode === "approve") {
      return "Behavior: Pair on approval";
    }
    if (ctx.pairingMode === "off") {
      return "Behavior: Pairing disabled";
    }
    if (ctx.allowlist && ctx.allowlist.length > 0) {
      return `Behavior: Allowlisted users only (${ctx.allowlist.length})`;
    }
    return "Behavior: Responds to all DMs";
  }

  const mentionOnly = getMentionOnly(route);
  if (mentionOnly === true) {
    return "Behavior: Responds only when @-mentioned";
  }
  if (mentionOnly === false) {
    return "Behavior: Responds to every message in this scope";
  }
  return "Behavior: Responds to every message in this scope";
}

export function describeBinding(
  route: BindingRouteInput,
  ctx: BindingDescribeContext = {},
): BindingDescription {
  const title = channelTitle(route.channel, route.account, ctx);
  const icon = channelIcon(route.channel);
  const lines = [...describeScope(route), describeBehavior(route, ctx)];
  return { icon, title, lines };
}

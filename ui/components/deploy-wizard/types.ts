/* ------------------------------------------------------------------ */
/*  Deploy wizard shared types                                         */
/* ------------------------------------------------------------------ */

export interface DeployConfig {
  /* Step 1: Identity */
  name: string;
  environment: "production" | "staging" | "development";
  region: string;
  city: string;

  /* Step 2: Target */
  mode: "ssh" | "docker" | "k8s";
  host: string;
  port: number;
  user: string;
  auth: "key" | "password";
  sshKey: string;
  password: string;

  /* Step 3: Networking */
  domain: string;
  httpPort: number;
  tls: "letsencrypt" | "custom" | "none";
  inboundPorts: number[];
  webhookMode: "longpoll" | "webhook";

  /* Step 4: Release */
  channel: "stable" | "rc" | "dev" | "pin";
  version: string;
  gitRepo: string;
  upgradePolicy: "manual" | "auto-minor" | "auto-patch" | "auto-latest";

  /* Step 5: Agents */
  agentSource: "blank" | "template" | "git";
  sourceServer: string;
  agents: string[];
  agentGitUrl: string;
  agentGitRef: string;

  /* Step 6: Policies */
  backupSchedule: "disabled" | "daily" | "weekly" | "custom";
  backupDestination: string;
  monitoring: boolean;
  logRetention: "7d" | "30d" | "90d" | "unlimited";
  maxMediaGB: number;
}

export const DEFAULT_CONFIG: DeployConfig = {
  name: "",
  environment: "production",
  region: "",
  city: "",

  mode: "ssh",
  host: "",
  port: 22,
  user: "root",
  auth: "key",
  sshKey: "",
  password: "",

  domain: "",
  httpPort: 3000,
  tls: "letsencrypt",
  inboundPorts: [443, 8443, 9090],
  webhookMode: "longpoll",

  channel: "stable",
  version: "1.8.2",
  gitRepo: "",
  upgradePolicy: "manual",

  agentSource: "blank",
  sourceServer: "",
  agents: [],
  agentGitUrl: "",
  agentGitRef: "main",

  backupSchedule: "daily",
  backupDestination: "local",
  monitoring: true,
  logRetention: "30d",
  maxMediaGB: 5,
};

export interface StepProps {
  config: DeployConfig;
  updateConfig: <K extends keyof DeployConfig>(
    key: K,
    value: DeployConfig[K],
  ) => void;
}

export interface WizardStep {
  id: string;
  hint: string;
}

export const WIZARD_STEPS: WizardStep[] = [
  { id: "Identity", hint: "Name, environment, and region" },
  { id: "Target host", hint: "Where the gateway will run" },
  { id: "Networking", hint: "Public domain, TLS, inbound ports" },
  { id: "Release", hint: "Version and upgrade policy" },
  { id: "Agents", hint: "Which agents to deploy here" },
  { id: "Policies", hint: "Backups, monitoring, clustering" },
  { id: "Review", hint: "Dry-run and confirm" },
];

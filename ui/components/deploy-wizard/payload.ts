import type { DeployConfig } from "./types";

export function toDeployPayload(config: DeployConfig) {
  return {
    identity: {
      name: config.name,
      environment: config.environment,
      region: config.region,
      city: config.city || undefined,
      tags: [],
    },
    target: {
      type: "ssh",
      host: config.host,
      port: config.port,
      user: config.user,
      authMethod: config.auth,
      sshKey: config.auth === "key" ? config.sshKey : undefined,
      password: config.auth === "password" ? config.password : undefined,
    },
    networking: {
      domain: config.domain || undefined,
      httpPort: config.httpPort,
      webhookMode: config.webhookMode,
    },
    release: {
      version: config.version,
      repo: config.gitRepo,
      upgradePolicy: config.upgradePolicy,
    },
    agents: {
      source: config.agentSource,
      sourceServerId: config.sourceServer || undefined,
      agentIds: config.agents,
      gitUrl: config.agentGitUrl || undefined,
      gitRef: config.agentGitRef || undefined,
    },
    policies: {
      backup:
        config.backupSchedule === "disabled"
          ? null
          : {
              schedule: config.backupSchedule,
              destination: config.backupDestination,
            },
      monitoring: config.monitoring,
      logRetention: config.logRetention,
      maxMediaGB: config.maxMediaGB,
    },
  };
}

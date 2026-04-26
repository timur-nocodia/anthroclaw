# Changelog

All notable changes to AnthroClaw are documented here.

## [Unreleased]

## [0.2.0] - 2026-04-25

### Added

- Operator diagnostics bundle with redacted metadata export, run scoping, debug-rail download links, and run sidecars for interrupts, integration audit, and memory influence.
- Memory quality workflow: provenance, review queue/API/UI, review notes, memory doctor, influence tracing, post-run memory candidates, and review-gated local note proposals.
- Runtime reliability surfaces for activity timeouts, SDK task notifications, active run/debug visibility, durable interrupt records, direct webhook delivery, and webhook delivery logs.
- Agentic control UX for session mailbox filters, labels, rename, summary rows, reconnect-safe active run controls, subagent policy controls, subagent tool summaries, and file ownership visibility.
- Integration capability matrix, MCP preflight/status/audit UI, integration audit filters/run links, copyable permission snippets, Google/Gmail external MCP presets, and local notes MCP quick enable.
- Speech-to-text provider interface with automatic provider selection for AssemblyAI, OpenAI, and ElevenLabs.

### Changed

- Kept harness additions outside Claude Agent SDK transcript internals: no transcript surgery, synthetic SDK tool results, custom provider router, or SDK history rewriting.
- Made native in-flight steer behavior explicit: production active-run steering remains disabled and the supported fallback is interrupt-and-restart.
- Improved sandbox-aware test coverage so `fs.watch` and local HTTP webhook specs skip only when the current environment cannot provide those system capabilities.

### Verified

- Full test suite: 92 files passed, 876 tests passed, 8 environment-dependent tests skipped in the current sandbox.
- Root TypeScript check, UI TypeScript check, and production build passed.

## [0.1.0] - 2026-04-24

### Added

- Initial public AnthroClaw release.
- Claude Agent SDK-native gateway runtime.
- Telegram and WhatsApp channels.
- Agent workspaces with prompts, skills, MCP tools, memory, sessions, and cron jobs.
- Next.js Web UI for agents, chat, channels, logs, settings, and fleet control.
- Fleet deployment, telemetry, command execution, and public guide documentation.

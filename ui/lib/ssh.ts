import { Client } from 'ssh2';
import type { FleetServer } from '@/lib/fleet';

/* ------------------------------------------------------------------ */
/*  SSH command execution                                              */
/* ------------------------------------------------------------------ */

export function sshExec(
  server: FleetServer,
  command: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    if (!server.ssh) {
      reject(new Error('No SSH config for server ' + server.id));
      return;
    }

    const conn = new Client();

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          reject(err);
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (d: Buffer) => {
          stdout += d.toString();
        });

        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString();
        });

        stream.on('close', (code: number) => {
          conn.end();
          resolve({ stdout, stderr, code });
        });
      });
    });

    conn.on('error', reject);

    conn.connect({
      host: server.ssh.host,
      port: server.ssh.port,
      username: server.ssh.user,
      privateKey: server.ssh.keyEncrypted, // In production, decrypt this
    });
  });
}

/* ------------------------------------------------------------------ */
/*  SSH connection test                                                */
/* ------------------------------------------------------------------ */

export interface SshTestConfig {
  host: string;
  port: number;
  user: string;
  key?: string;
  password?: string;
}

export function sshTestConnection(
  config: SshTestConfig,
): Promise<{ success: boolean; info?: string; error?: string }> {
  return new Promise((resolve) => {
    const conn = new Client();

    const timeout = setTimeout(() => {
      conn.end();
      resolve({ success: false, error: 'Connection timed out after 15s' });
    }, 15_000);

    conn.on('ready', () => {
      // Run diagnostics: uname, nproc, free, df
      conn.exec(
        'uname -a && nproc && free -m | head -2 && df -h /',
        (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            resolve({ success: false, error: err.message });
            return;
          }

          let output = '';
          stream.on('data', (d: Buffer) => {
            output += d.toString();
          });

          stream.on('close', () => {
            clearTimeout(timeout);
            conn.end();
            resolve({ success: true, info: output.trim() });
          });
        },
      );
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: err.message });
    });

    conn.connect({
      host: config.host,
      port: config.port,
      username: config.user,
      ...(config.key ? { privateKey: config.key } : {}),
      ...(config.password ? { password: config.password } : {}),
    });
  });
}

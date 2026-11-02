import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, it } from 'vitest';

it('stops the full stack on an occupied API port instead of selecting another port', async () => {
  const occupied = createServer();
  occupied.listen(3001, '127.0.0.1');
  await once(occupied, 'listening');
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Run the tests through npm test.');
  const child = spawn(process.execPath, [npm, 'run', 'dev:full'], {
    env: { ...process.env, VULPES_LIVE_AI_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });
  child.stderr.on('data', (data: Buffer) => {
    output += data.toString();
  });
  try {
    const [code] = await once(child, 'exit');
    expect(code).toBe(1);
    expect(output).toContain('Local API failed to listen on 127.0.0.1:3001.');
    expect(output).not.toContain('Local API: http');
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
}, 15_000);

import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createMcpServer } from '../../dist/mcp/server.js';

const execFile = promisify(execFileCallback);
const workspace = await mkdtemp(join(tmpdir(), 'losslesscut-mcp-inspection-'));
const authorized = join(workspace, 'authorized');
const outside = join(workspace, 'outside');
await Promise.all([mkdir(authorized), mkdir(outside)]);
const mediaPath = join(authorized, 'fixture.mp4');
const v1Path = join(authorized, 'legacy.llc');
const v2Path = join(authorized, 'project.llc');
const malformedPath = join(authorized, 'malformed.llc');
const invalidRangePath = join(authorized, 'invalid-range.llc');
const traversalPath = join(authorized, 'traversal.llc');
const outsideMediaPath = join(outside, 'secret.mp4');
let client;
let clientTransport;
let serverTransport;
let server;

try {
  await execFile(
    process.env.FFMPEG_PATH || 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x90:rate=15:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=32000:duration=2',
      '-shortest',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      mediaPath,
    ],
    { timeout: 30_000 },
  );
  await writeFile(outsideMediaPath, 'outside file');
  await writeFile(
    v1Path,
    JSON.stringify({
      version: 1,
      mediaFileName: 'fixture.mp4',
      cutSegments: [
        { end: 1, name: 'legacy' },
        { start: 1.2, name: 'marker' },
      ],
    }),
  );
  await writeFile(
    v2Path,
    JSON.stringify({
      version: 2,
      mediaFileName: 'fixture.mp4',
      cutSegments: [
        { start: 0.2, end: 0.8, name: 'keep-a', selected: true, tags: { purpose: 'test' } },
        { start: 1.1, end: 1.7, name: 'keep-b', selected: false },
      ],
    }),
  );
  await writeFile(malformedPath, '{not valid json');
  await writeFile(invalidRangePath, JSON.stringify({ version: 2, cutSegments: [{ start: 2, end: 1, name: 'bad' }] }));
  await writeFile(traversalPath, JSON.stringify({ version: 2, mediaFileName: '../outside/secret.mp4', cutSegments: [] }));

  const hashesBefore = await Promise.all(
    [mediaPath, v1Path, v2Path, malformedPath, invalidRangePath, traversalPath].map(async path => [
      path,
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    ]),
  );
  const namesBefore = (await readdir(authorized)).sort();
  server = createMcpServer({
    apiPort: 8080,
    apiTimeoutMs: 5_000,
    exportTimeoutMs: 30_000,
    allowedRoots: [authorized],
    ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  });
  [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'losslesscut-mcp-inspection-test', version: '0.1.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const toolList = await client.listTools();
  assert.ok(toolList.tools.some(tool => tool.name === 'losslesscut_inspect_media'));
  assert.ok(toolList.tools.some(tool => tool.name === 'losslesscut_inspect_project'));

  const media = await client.callTool({ name: 'losslesscut_inspect_media', arguments: { path: mediaPath } });
  assert.equal(media.structuredContent.status, 'verified', JSON.stringify(media.structuredContent));
  assert.match(media.structuredContent.formatName, /mp4/);
  assert.ok(media.structuredContent.duration > 1.8 && media.structuredContent.duration < 2.2);
  assert.ok(media.structuredContent.streams.some(stream => stream.codecType === 'video' && stream.codecName === 'h264'));
  assert.ok(media.structuredContent.streams.some(stream => stream.codecType === 'audio' && stream.codecName === 'aac'));

  const v1 = await client.callTool({ name: 'losslesscut_inspect_project', arguments: { projectPath: v1Path } });
  assert.equal(v1.structuredContent.status, 'verified', JSON.stringify(v1.structuredContent));
  assert.equal(v1.structuredContent.version, 1);
  assert.equal(v1.structuredContent.segments[0].start, 0);
  assert.equal(v1.structuredContent.segments[1].kind, 'marker');
  assert.ok(!Object.hasOwn(v1.structuredContent.segments[0], 'selected'));

  const v2 = await client.callTool({ name: 'losslesscut_inspect_project', arguments: { projectPath: v2Path } });
  assert.equal(v2.structuredContent.status, 'verified', JSON.stringify(v2.structuredContent));
  assert.equal(v2.structuredContent.segmentCount, 2);
  assert.equal(v2.structuredContent.segments[0].selected, true);
  assert.deepEqual(v2.structuredContent.segments[0].tags, { purpose: 'test' });

  for (const [name, args, code] of [
    ['losslesscut_inspect_media', { path: outsideMediaPath }, 'path_not_authorized'],
    ['losslesscut_inspect_media', { path: join(authorized, 'missing.mp4') }, 'path_not_found'],
    ['losslesscut_inspect_media', { path: malformedPath }, 'media_probe_failed'],
    ['losslesscut_inspect_project', { projectPath: malformedPath }, 'invalid_project'],
    ['losslesscut_inspect_project', { projectPath: invalidRangePath }, 'invalid_project'],
    ['losslesscut_inspect_project', { projectPath: traversalPath }, 'path_not_authorized'],
    ['losslesscut_inspect_project', { projectPath: outsideMediaPath }, 'path_not_authorized'],
  ]) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, true, `${name} should reject ${JSON.stringify(args)}`);
    assert.equal(result.structuredContent.code, code, JSON.stringify(result.structuredContent));
  }

  const hashesAfter = await Promise.all(
    hashesBefore.map(async ([path]) => [
      path,
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    ]),
  );
  assert.deepEqual(hashesAfter, hashesBefore, 'Inspection must not modify project or media inputs.');
  assert.deepEqual((await readdir(authorized)).sort(), namesBefore, 'Inspection must not create files beside its inputs.');
  console.log(
    JSON.stringify(
      { status: 'passed', tools: ['losslesscut_inspect_media', 'losslesscut_inspect_project'], checks: 10, media: media.structuredContent, v1: v1.structuredContent, v2: v2.structuredContent },
      null,
      2,
    ),
  );
} finally {
  await client?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
  await rm(workspace, { recursive: true, force: true });
}

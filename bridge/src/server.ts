import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ExtensionHub } from './hub.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createMcpServer(hub: ExtensionHub): McpServer {
  const server = new McpServer(
    {
      name: 'diorama',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Guide content
  const guidePath = path.resolve(__dirname, '../GUIDE.md');
  let guideContent = '';
  try {
    guideContent = fs.readFileSync(guidePath, 'utf-8');
  } catch {
    guideContent = '# Diorama Guide\nGuide file not found at ' + guidePath;
  }

  // Register MCP Resource: diorama://guide
  server.resource(
    'diorama-guide',
    'diorama://guide',
    {
      mimeType: 'text/markdown',
      description: 'Complete user and agent guide for the Diorama 3D Web video capture tool',
    },
    async () => ({
      contents: [
        {
          uri: 'diorama://guide',
          mimeType: 'text/markdown',
          text: guideContent,
        },
      ],
    })
  );

  /* ------------------------------------------------------------------ */
  /* Bridge-local Tools (not routed)                                    */
  /* ------------------------------------------------------------------ */

  server.tool(
    'diorama_status',
    'Get connection status of the Diorama Chrome extension (background and studio roles), versions, and available methods.',
    {},
    async () => {
      try {
        const roles = hub.getConnectedRoles();
        const methods = hub.getAvailableMethods();
        const background = hub.getClientInfo('background');
        const studio = hub.getClientInfo('studio');

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  connected: roles.length > 0,
                  roles,
                  methods,
                  background,
                  studio,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: 'text', text: message }],
        };
      }
    }
  );

  server.tool(
    'diorama_guide',
    'Read the complete Diorama agent workflow guide: from inspect to timeline composition and MP4 export.',
    {},
    async () => {
      return {
        content: [
          {
            type: 'text',
            text: guideContent,
          },
        ],
      };
    }
  );

  /* ------------------------------------------------------------------ */
  /* Background Tools                                                  */
  /* ------------------------------------------------------------------ */

  server.tool(
    'diorama_list_tabs',
    'List all open Chrome browser tabs to choose which page to inspect or capture.',
    {},
    async (params) => {
      try {
        const res = await hub.call('list_tabs', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_inspect_page',
    'Inspect a Chrome web page to extract DOM candidates ([data-dio-id="N"]), cluster groupings, user selections, and a screenshot.',
    {
      tabId: z.number().optional().describe('Tab ID to inspect (defaults to the active tab).'),
      limit: z.number().optional().describe('Max candidates returned (default 60).'),
      screenshot: z.boolean().optional().describe('Include a viewport screenshot (default true).'),
    },
    async (params) => {
      try {
        const res = (await hub.call('inspect_page', params)) as Record<string, unknown>;
        const content: Array<
          | { type: 'text'; text: string }
          | { type: 'image'; data: string; mimeType: string }
        > = [];

        if (typeof res.screenshotPng === 'string' && res.screenshotPng.length > 0) {
          content.push({
            type: 'image',
            data: res.screenshotPng,
            mimeType: 'image/png',
          });
        }

        const { screenshotPng: _unused, ...metadata } = res;
        content.push({
          type: 'text',
          text: JSON.stringify(metadata, null, 2),
        });

        return { content };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_capture',
    'Detach selected elements into 3D floating layers, generate textures, create a bundle, and open the Studio tab.',
    {
      tabId: z.number().optional().describe('Target tab ID (defaults to active tab).'),
      selectors: z
        .array(z.string())
        .describe('CSS selectors ([data-dio-id="N"] preferred) to detach into 3D layers.'),
      brief: z.string().optional().describe('Creative intention or animation brief.'),
      frameFormat: z
        .enum([
          'landscape-16-9',
          'portrait-9-16',
          'square-1-1',
          'portrait-4-5',
          'landscape-4-3',
          'cinema-21-9',
          'custom',
        ])
        .optional()
        .describe('Target video format.'),
      expandClusters: z
        .boolean()
        .optional()
        .describe('Expand each selector to its Zap cluster of similar siblings (default false).'),
    },
    async (params) => {
      try {
        const res = await hub.call('capture', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_wait_for_capture',
    'Wait for the user to finish an interactive capture via the on-page overlay in Chrome.',
    {
      timeoutMs: z.number().optional().describe('Timeout in milliseconds (default 120000).'),
    },
    async (params) => {
      try {
        const res = await hub.call('wait_for_capture', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_open_studio',
    'Open or focus the Diorama Studio rendering tab in Chrome.',
    {},
    async (params) => {
      try {
        const res = await hub.call('open_studio', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  /* ------------------------------------------------------------------ */
  /* Studio Tools                                                       */
  /* ------------------------------------------------------------------ */

  server.tool(
    'diorama_get_scene',
    'Get full scene details: layers, camera parameters, channels, keyframes, presets, and available easings.',
    {
      keyframes: z.boolean().optional().describe('Include full keyframe list (default true).'),
    },
    async (params) => {
      try {
        const res = await hub.call('get_scene', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_set_frame',
    'Change the aspect ratio or resolution of the 3D animation canvas.',
    {
      format: z
        .enum([
          'landscape-16-9',
          'portrait-9-16',
          'square-1-1',
          'portrait-4-5',
          'landscape-4-3',
          'cinema-21-9',
          'custom',
        ])
        .optional()
        .describe('Preset frame format.'),
      width: z.number().optional().describe('Custom width in px.'),
      height: z.number().optional().describe('Custom height in px.'),
    },
    async (params) => {
      try {
        const res = await hub.call('set_frame', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_set_duration',
    'Set the total duration of the animation timeline in seconds.',
    {
      duration: z.number().describe('Duration in seconds (e.g. 5 to 8s).'),
    },
    async (params) => {
      try {
        const res = await hub.call('set_duration', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_set_camera',
    'Update camera parameters (orbitX, orbitY, distance, targetX, targetY, roll, fov, focus, aperture) at base or keyframe.',
    {
      values: z
        .record(z.string(), z.number())
        .describe('Camera parameter map (distance, orbitX, orbitY, roll, targetX, targetY, fov, focus, aperture, maxBlur).'),
      at: z.number().optional().describe('Timeline time in seconds to create a keyframe instead of setting base values.'),
      easing: z
        .enum(['linear', 'expo.out', 'quart.out', 'quint.inOut', 'cubic.inOut', 'back.out'])
        .optional()
        .describe('Curve into this keyframe.'),
    },
    async (params) => {
      try {
        const res = await hub.call('set_camera', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_set_layer',
    'Update layer transformation values (x, y, z offsets, scale, opacity) or visibility flags.',
    {
      layerId: z.string().describe('Target layer ID.'),
      values: z
        .record(z.string(), z.number())
        .optional()
        .describe('Layer channel values (x, y, z, rotX, rotY, rotZ, scale, opacity, etc.).'),
      flags: z
        .object({
          visible: z.boolean().optional(),
          locked: z.boolean().optional(),
          castShadow: z.boolean().optional(),
        })
        .optional()
        .describe('Layer UI and rendering flags.'),
      at: z.number().optional().describe('Timeline time in seconds to create keyframes.'),
      easing: z
        .enum(['linear', 'expo.out', 'quart.out', 'quint.inOut', 'cubic.inOut', 'back.out'])
        .optional()
        .describe('Curve into this keyframe.'),
    },
    async (params) => {
      try {
        const res = await hub.call('set_layer', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_set_scene',
    'Update global scene environment values and settings (lighting, depth of field).',
    {
      values: z.record(z.string(), z.number()).optional().describe('Scene channel values.'),
      settings: z
        .object({
          lightEnabled: z.boolean().optional(),
          dofEnabled: z.boolean().optional(),
        })
        .optional()
        .describe('Scene settings toggles.'),
    },
    async (params) => {
      try {
        const res = await hub.call('set_scene', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_fit',
    'Fit the 3D camera to frame visible layers or viewport without manual math.',
    {
      target: z
        .union([z.enum(['all', 'viewport']), z.string(), z.array(z.string())])
        .describe('"all", "viewport", or specific layer id / list of layer ids to frame.'),
      padding: z.number().optional().describe('Relative padding margin (default 0.08).'),
      orbitX: z.number().optional().describe('Target orbitX angle in degrees.'),
      orbitY: z.number().optional().describe('Target orbitY angle in degrees.'),
      roll: z.number().optional().describe('Target camera roll angle in degrees.'),
      apply: z.boolean().optional().describe('Apply directly to the camera (default true).'),
      at: z.number().optional().describe('Write as a keyframe at time seconds.'),
      easing: z
        .enum(['linear', 'expo.out', 'quart.out', 'quint.inOut', 'cubic.inOut', 'back.out'])
        .optional()
        .describe('Curve into this keyframe.'),
    },
    async (params) => {
      try {
        const res = await hub.call('fit', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  const KeyframeSchema = z.object({
    id: z.string().optional(),
    layerId: z.string().optional().describe('Target layer ID, or omit for camera and scene channels.'),
    channel: z.string().describe('Animatable channel name (e.g. "z", "orbitX", "opacity").'),
    time: z.number().describe('Time in seconds.'),
    value: z.number().describe('Channel value.'),
    easing: z
      .enum(['linear', 'expo.out', 'quart.out', 'quint.inOut', 'cubic.inOut', 'back.out'])
      .optional()
      .describe('Curve into this keyframe (default "quart.out").'),
  });

  server.tool(
    'diorama_set_keyframes',
    'Batch insert or replace animation keyframes across layers and camera channels.',
    {
      keyframes: z.array(KeyframeSchema).describe('Array of keyframes to set.'),
      mode: z
        .enum(['merge', 'replace'])
        .optional()
        .describe('"merge" upserts; "replace" drops existing keyframes first (default "merge").'),
    },
    async (params) => {
      try {
        const normalized = {
          ...params,
          keyframes: params.keyframes.map((k) => ({
            ...k,
            layerId: k.layerId ?? null,
          })),
        };
        const res = await hub.call('set_keyframes', normalized);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_clear_timeline',
    'Clear all keyframes, or selectively clear keyframes for a specific layer or channel.',
    {
      layerId: z.string().optional().describe('Layer ID to clear, omit for all, or "_camera" / "_scene".'),
      channel: z.string().optional().describe('Channel name to clear, omit for all channels.'),
    },
    async (params) => {
      try {
        const normalized = {
          ...params,
          layerId:
            params.layerId === 'camera' ||
            params.layerId === '_camera' ||
            params.layerId === 'scene' ||
            params.layerId === '_scene'
              ? null
              : params.layerId,
        };
        const res = await hub.call('clear_timeline', normalized);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_apply_preset',
    'Apply a cinematic camera or layer motion preset (dolly-in, stagger-cascade, hero-lift, orbit-reveal, etc.).',
    {
      preset: z
        .enum([
          'dolly-in',
          'dolly-out',
          'orbit-reveal',
          'push-tilt',
          'rack-focus',
          'stagger-cascade',
          'parallax-drift',
          'hero-lift',
          'whip-pan',
          'settle',
        ])
        .describe('Preset identifier.'),
      at: z.number().optional().describe('Start time in seconds (default 0).'),
      params: z.record(z.string(), z.union([z.number(), z.string()])).optional().describe('Preset parameters.'),
      layerIds: z.array(z.string()).optional().describe('Target layer IDs in stagger order (default: all zap layers).'),
    },
    async (params) => {
      try {
        const res = await hub.call('apply_preset', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_seek',
    'Move the Studio playhead to a specific time in the animation.',
    {
      time: z.number().describe('Target time in seconds.'),
    },
    async (params) => {
      try {
        const res = await hub.call('seek', params);
        return {
          content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_screenshot',
    'Render a high-resolution PNG screenshot of the 3D scene at a specific time.',
    {
      time: z.number().optional().describe('Timeline time in seconds (default: current playhead).'),
      width: z.number().optional().describe('Image width in px (default 1280).'),
    },
    async (params) => {
      try {
        const res = (await hub.call('screenshot', params)) as {
          png: string;
          width: number;
          height: number;
          time: number;
        };

        return {
          content: [
            {
              type: 'image',
              data: res.png,
              mimeType: 'image/png',
            },
            {
              type: 'text',
              text: JSON.stringify(
                {
                  width: res.width,
                  height: res.height,
                  time: res.time,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_contact_sheet',
    'Render a contact sheet grid showing multiple frame snapshots across the timeline to evaluate motion.',
    {
      times: z.array(z.number()).optional().describe('Explicit times in seconds to render.'),
      count: z.number().optional().describe('Number of evenly spaced snapshots (default 6).'),
      columns: z.number().optional().describe('Columns in the contact sheet grid (default 3).'),
      cellWidth: z.number().optional().describe('Width of each cell in px (default 480).'),
    },
    async (params) => {
      try {
        const res = (await hub.call('contact_sheet', params)) as {
          png: string;
          width: number;
          height: number;
          times: number[];
        };

        return {
          content: [
            {
              type: 'image',
              data: res.png,
              mimeType: 'image/png',
            },
            {
              type: 'text',
              text: JSON.stringify(
                {
                  width: res.width,
                  height: res.height,
                  times: res.times,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  server.tool(
    'diorama_export',
    'Render the animation to an MP4 video, save it to disk, and return file metadata.',
    {
      quality: z
        .enum(['draft', 'standard', 'smooth', 'high'])
        .optional()
        .describe('Rendering quality preset (default: "standard").'),
      motionBlurSamples: z
        .number()
        .optional()
        .describe('Sub-frame motion blur samples: 1, 2, 4, or 8 (default 1).'),
    },
    async (params) => {
      try {
        const res = (await hub.call('export', params)) as {
          mp4: string;
          width: number;
          height: number;
          fps: number;
          duration: number;
          bytes: number;
        };

        // Determine output path
        const configuredOutputDir = process.env.DIORAMA_OUTPUT_DIR;
        const defaultOutputDir = path.join(os.homedir(), 'Diorama', 'exports');
        const outputDir = configuredOutputDir || defaultOutputDir;

        fs.mkdirSync(outputDir, { recursive: true });

        const filename = `diorama-${Date.now()}.mp4`;
        const filePath = path.join(outputDir, filename);

        const videoBuffer = Buffer.from(res.mp4, 'base64');
        fs.writeFileSync(filePath, videoBuffer);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  path: filePath,
                  width: res.width,
                  height: res.height,
                  fps: res.fps,
                  duration: res.duration,
                  bytes: res.bytes || videoBuffer.length,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: unknown) {
        return {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
  );

  return server;
}

export async function runStdioServer(hub: ExtensionHub): Promise<void> {
  const server = createMcpServer(hub);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[diorama-bridge] MCP server connected on stdio.');
}

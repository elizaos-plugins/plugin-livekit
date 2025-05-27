import type { IAgentRuntime, Route } from '@elizaos/core';
import { logger } from '@elizaos/core';
import fs from 'node:fs';
import path from 'node:path';

// Helper to send success response
function sendSuccess(res: any, data: any, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true, data }));
}

// Helper to send error response
function sendError(res: any, status: number, code: string, message: string, details?: string) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: { code, message, details } }));
}

// Handler for the LiveKit frontend panel - serves the actual HTML frontend
async function livekitPanelHandler(req: any, res: any, runtime: IAgentRuntime) {
  try {
    logger.info('[LIVEKIT PANEL] Serving LiveKit frontend panel');

    // Get the current directory (where this routes file is located)
    const currentDir = path.dirname(new URL(import.meta.url).pathname);

    // Path to the built frontend HTML file
    const frontendPath = path.join(currentDir, '../src/frontend/dist/index.html');

    if (fs.existsSync(frontendPath)) {
      const html = await fs.promises.readFile(frontendPath, 'utf8');

      // Transform asset paths to be served from our assets route
      const transformedHtml = html
        .replace(/href="\/assets\//g, 'href="./assets/')
        .replace(/src="\/assets\//g, 'src="./assets/')
        .replace(/from "\/assets\//g, 'from "./assets/')
        .replace(/import "\/assets\//g, 'import "./assets/')
        .replace(/url\(\/assets\//g, 'url(./assets/');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(transformedHtml);
      return;
    } else {
      // Fallback: serve a basic HTML page that loads the JS bundle from the assets folder
      logger.warn('[LIVEKIT PANEL] Frontend HTML not found, serving fallback');

      // Check if there are any JS/CSS files in the assets directory
      const assetsDir = path.join(currentDir, '../src/frontend/dist/assets');
      let jsFile = '';
      let cssFile = '';

      if (fs.existsSync(assetsDir)) {
        const files = await fs.promises.readdir(assetsDir);
        jsFile = files.find(f => f.endsWith('.js')) || '';
        cssFile = files.find(f => f.endsWith('.css')) || '';
      }

      const fallbackHtml = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LiveKit Voice Chat - ElizaOS</title>
    ${cssFile ? `<link rel="stylesheet" href="./assets/${cssFile}">` : ''}
    <style>
      body {
        margin: 0;
        padding: 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
        background: #0f0f0f;
        color: #ffffff;
      }
      .container {
        max-width: 1200px;
        margin: 0 auto;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div id="root">
        <h1>LiveKit Voice Chat</h1>
        <p>Loading LiveKit interface...</p>
      </div>
    </div>
    ${jsFile ? `<script type="module" src="./assets/${jsFile}"></script>` : ''}
  </body>
</html>`;

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fallbackHtml);
    }
  } catch (error) {
    logger.error('[LIVEKIT PANEL] Error serving frontend:', error);
    sendError(res, 500, 'FRONTEND_ERROR', 'Failed to serve LiveKit frontend');
  }
}

// Generic handler to serve static assets from the frontend/dist/assets directory
async function frontendAssetHandler(req: any, res: any, runtime: IAgentRuntime) {
  try {
    logger.info(`[LIVEKIT ASSETS] Serving asset: ${req.path}`);

    // Extract the asset name from the request path
    let assetName = '';
    const assetRequestPath = req.path; // This is the full path, e.g., /api/agents/X/plugins/livekit/assets/file.js
    const assetsMarker = '/assets/';
    const assetsStartIndex = assetRequestPath.indexOf(assetsMarker);

    if (assetsStartIndex !== -1) {
      assetName = assetRequestPath.substring(assetsStartIndex + assetsMarker.length);
    }

    if (!assetName) {
      logger.warn('[LIVEKIT ASSETS] No asset name found in path:', assetRequestPath);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Asset not found');
      return;
    }

    // Get the current directory (where this routes file is located)
    const currentDir = path.dirname(new URL(import.meta.url).pathname);

    // Construct the path to the asset
    const assetPath = path.join(currentDir, '../src/frontend/dist/assets', assetName);

    // Check if the asset exists
    if (!fs.existsSync(assetPath)) {
      logger.warn('[LIVEKIT ASSETS] Asset not found:', assetPath);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Asset not found');
      return;
    }

    // Determine content type based on file extension
    const ext = path.extname(assetName).toLowerCase();
    let contentType = 'application/octet-stream';

    switch (ext) {
      case '.js':
        contentType = 'application/javascript';
        break;
      case '.css':
        contentType = 'text/css';
        break;
      case '.png':
        contentType = 'image/png';
        break;
      case '.jpg':
      case '.jpeg':
        contentType = 'image/jpeg';
        break;
      case '.svg':
        contentType = 'image/svg+xml';
        break;
      case '.woff':
        contentType = 'font/woff';
        break;
      case '.woff2':
        contentType = 'font/woff2';
        break;
    }

    // Read and serve the asset
    const assetContent = await fs.promises.readFile(assetPath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
    });
    res.end(assetContent);

    logger.info(`[LIVEKIT ASSETS] Successfully served: ${assetName}`);
  } catch (error) {
    logger.error('[LIVEKIT ASSETS] Error serving asset:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  }
}

export const livekitFrontendRoutes: Route[] = [
  {
    type: 'GET',
    name: 'LiveKit',
    path: 'livekit/display',
    handler: livekitPanelHandler,
    public: true,
  },
  {
    type: 'GET',
    name: 'LiveKit Assets',
    path: 'livekit/assets/*',
    handler: frontendAssetHandler,
  },
];

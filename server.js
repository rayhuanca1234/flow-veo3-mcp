// flow-veo3-mcp/server.js
// Servidor Puente Local HTTP + WebSocket (RFC 6455 nativo sin dependencias externas)
// Puerto: 127.0.0.1:3847

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateMasterPromptLocally } from './masterPromptLocal.js';
import { listChromeProfiles, findChromeProfile, launchChromeForProfile } from './chromeProfileResolver.js';

const WORKSPACE_ROOT = process.cwd();
const ASSETS_ROOT = path.join(WORKSPACE_ROOT, 'workspace-assets');

const PORT = Number(process.env.FLOW_MCP_PORT || 3847);
const HOST = '127.0.0.1';

const clients = new Set();
const pendingRequests = new Map();
const recentEvents = [];

function pushEvent(evt) {
    recentEvents.push({
        ...evt,
        receivedAt: new Date().toISOString()
    });
    if (recentEvents.length > 100) recentEvents.shift();
}

function encodeWsFrame(text) {
    const payload = Buffer.from(text, 'utf8');
    const len = payload.length;
    let header;
    if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81;
        header[1] = len;
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
}

function attachWebSocketClient(socket, role = 'unknown') {
    const client = {
        socket,
        role,
        connectedAt: new Date().toISOString(),
        buffer: Buffer.alloc(0),
        fragments: [],
        send(obj) {
            if (socket.destroyed) return false;
            const raw = typeof obj === 'string' ? obj : JSON.stringify(obj);
            socket.write(encodeWsFrame(raw));
            return true;
        }
    };

    clients.add(client);
    pushEvent({ type: 'client_connected', role });

    socket.on('data', (chunk) => {
        client.buffer = Buffer.concat([client.buffer, chunk]);
        while (client.buffer.length >= 2) {
            const firstByte = client.buffer[0];
            const secondByte = client.buffer[1];
            const fin = (firstByte & 0x80) !== 0;
            const opcode = firstByte & 0x0f;
            const masked = (secondByte & 0x80) !== 0;
            let payloadLen = secondByte & 0x7f;
            let offset = 2;

            if (payloadLen === 126) {
                if (client.buffer.length < 4) return;
                payloadLen = client.buffer.readUInt16BE(2);
                offset = 4;
            } else if (payloadLen === 127) {
                if (client.buffer.length < 10) return;
                payloadLen = Number(client.buffer.readBigUInt64BE(2));
                offset = 10;
            }

            const maskLen = masked ? 4 : 0;
            if (client.buffer.length < offset + maskLen + payloadLen) return;

            let maskKey = null;
            if (masked) {
                maskKey = client.buffer.subarray(offset, offset + 4);
                offset += 4;
            }

            const framePayload = Buffer.from(client.buffer.subarray(offset, offset + payloadLen));
            client.buffer = client.buffer.subarray(offset + payloadLen);

            if (masked && maskKey) {
                for (let i = 0; i < framePayload.length; i++) {
                    framePayload[i] ^= maskKey[i & 3];
                }
            }

            if (opcode === 0x08) {
                socket.end();
                return;
            } else if (opcode === 0x09) {
                const pong = Buffer.alloc(2 + framePayload.length);
                pong[0] = 0x8a;
                pong[1] = framePayload.length;
                framePayload.copy(pong, 2);
                socket.write(pong);
                continue;
            } else if (opcode === 0x01 || opcode === 0x00) {
                client.fragments.push(framePayload);
                if (fin) {
                    const fullBuf = Buffer.concat(client.fragments);
                    client.fragments = [];
                    handleIncomingWsMessage(client, fullBuf.toString('utf8'));
                }
            }
        }
    });

    socket.on('close', () => {
        clients.delete(client);
        pushEvent({ type: 'client_disconnected', role: client.role });
    });

    socket.on('error', () => {
        clients.delete(client);
    });
}

function handleIncomingWsMessage(client, rawText) {
    try {
        const msg = JSON.parse(rawText);
        if (msg.type === 'hello' && msg.role) {
            client.role = msg.role;
            return;
        }
        if (msg.type === 'event') {
            pushEvent(msg);
            return;
        }
        if (msg.type === 'response' && msg.id && pendingRequests.has(msg.id)) {
            const pending = pendingRequests.get(msg.id);
            pendingRequests.delete(msg.id);
            clearTimeout(pending.timer);
            if (msg.ok) {
                pending.resolve(msg.result);
            } else {
                pending.reject(new Error(msg.error || 'Error reportado por la extensión'));
            }
        }
    } catch (e) { }
}

function pickActiveClient() {
    for (const c of clients) {
        if (c.role === 'orchestrator' && !c.socket.destroyed) return c;
    }
    for (const c of clients) {
        if (c.role === 'background' && !c.socket.destroyed) return c;
    }
    for (const c of clients) {
        if (!c.socket.destroyed) return c;
    }
    return null;
}

export function resolveFileToDataUrl(val) {
    if (!val || typeof val !== 'string') return val;
    const trimmed = val.trim();
    if (trimmed.startsWith('data:') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
    }
    const resolvedPath = path.isAbsolute(trimmed) ? trimmed : path.resolve(WORKSPACE_ROOT, trimmed);
    if (fs.existsSync(resolvedPath)) {
        const ext = path.extname(resolvedPath).toLowerCase().replace('.', '');
        const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
            : (ext === 'webp' ? 'image/webp'
            : (ext === 'gif' ? 'image/gif'
            : (ext === 'mp4' ? 'video/mp4' : 'image/png')));
        const buf = fs.readFileSync(resolvedPath);
        return `data:${mime};base64,${buf.toString('base64')}`;
    }
    return trimmed;
}

export async function ensureExtensionConnected(account = null, waitMs = 12000, targetUrl = 'https://labs.google.com/flow') {
    if (pickActiveClient()) return true;

    const acc = account || process.env.account || process.env.ACCOUNT || null;
    const resolvedProfile = findChromeProfile(acc);
    console.log(`[flow-veo3-mcp] Auto-abriendo Google Chrome para el perfil: "${resolvedProfile?.name || resolvedProfile?.directory || 'Default'}" en ${targetUrl}...`);
    launchChromeForProfile({
        account: acc,
        targetUrl
    });

    const start = Date.now();
    while ((Date.now() - start) < waitMs) {
        await new Promise(r => setTimeout(r, 600));
        if (pickActiveClient()) return true;
    }
    return Boolean(pickActiveClient());
}

export async function sendCommandToExtension(command, params = {}, timeoutMs = 900000) {
    if (!pickActiveClient()) {
        let targetUrl = 'https://labs.google.com/flow';
        const engine = String(params.engine || '').toLowerCase();
        if (engine.includes('gemini')) targetUrl = 'https://gemini.google.com/app';
        else if (engine.includes('vids') || engine.includes('lyria')) targetUrl = 'https://docs.google.com/videos/';
        else if (engine.includes('music') || engine.includes('flowmusic')) targetUrl = 'https://www.flowmusic.app/';
        await ensureExtensionConnected(params.account, 12000, targetUrl);
    }

    const client = pickActiveClient();
    if (!client) {
        throw new Error(
            'La extensión de Chrome "AI Auto-Prompt" no está conectada al puente MCP (ws://127.0.0.1:3847). ' +
            'Asegúrate de tener Google Chrome abierto en la cuenta correcta con la extensión activa/recargada.'
        );
    }

    // Normalizar imágenes locales a DataURL para que el navegador las reciba sin bloqueos de seguridad de disco
    const normalizedParams = { ...params };
    if (normalizedParams.image) {
        normalizedParams.image = resolveFileToDataUrl(normalizedParams.image);
    }
    if (normalizedParams.baseImage) {
        normalizedParams.baseImage = resolveFileToDataUrl(normalizedParams.baseImage);
    }
    if (Array.isArray(normalizedParams.ingredients)) {
        normalizedParams.ingredients = normalizedParams.ingredients.map(ing => {
            if (typeof ing === 'object' && ing) {
                return {
                    ...ing,
                    image: resolveFileToDataUrl(ing.image || ing.src || null)
                };
            }
            return ing;
        });
    }

    return new Promise((resolve, reject) => {
        const id = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const timer = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error(`Timeout (${Math.round(timeoutMs / 1000)}s) esperando respuesta de la extensión para el comando "${command}".`));
        }, timeoutMs);

        pendingRequests.set(id, { resolve, reject, timer });
        client.send({
            type: 'command',
            id,
            command,
            params: normalizedParams
        });
    });
}

async function exportAndSaveAssetsToDisk({
    projectSlug = 'proyecto-actual',
    editorMode = 'native',
    overwriteOriginals = false
} = {}) {
    const exported = await sendCommandToExtension('export_assets', {}, 600000);
    const titleSlug = exported.storyboard?.titulo_proyecto
        ? String(exported.storyboard.titulo_proyecto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
        : null;
    const safeSlug = String(projectSlug && projectSlug !== 'proyecto-actual' ? projectSlug : (titleSlug || 'proyecto-actual'))
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-');

    const outDir = path.join(ASSETS_ROOT, safeSlug);
    const origDir = path.join(outDir, 'original');
    const charsDir = path.join(outDir, 'personajes');
    const actualDir = path.join(ASSETS_ROOT, 'proyecto-actual');

    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(origDir, { recursive: true });
    fs.mkdirSync(charsDir, { recursive: true });
    fs.mkdirSync(actualDir, { recursive: true });

    const sbPath = path.join(outDir, 'storyboard.json');
    fs.writeFileSync(sbPath, JSON.stringify(exported.storyboard || {}, null, 2), 'utf8');
    fs.writeFileSync(path.join(actualDir, 'storyboard.json'), JSON.stringify(exported.storyboard || {}, null, 2), 'utf8');

    const savedCharacters = [];
    const savedImages = [];
    const savedVideos = [];

    for (const ch of (exported.characters || [])) {
        if (ch.src && ch.src.startsWith('data:image/')) {
            const cleanTag = String(ch.tag || 'personaje').replace(/[^a-zA-Z0-9_-]+/g, '_');
            const base64Clean = ch.src.replace(/^data:image\/[^;]+;(?:flowuuid=[^;]+;)?base64,/, '');
            const filePath = path.join(charsDir, `${cleanTag}.png`);
            fs.writeFileSync(filePath, Buffer.from(base64Clean, 'base64'));
            savedCharacters.push({ tag: ch.tag, path: filePath });
        }
    }

    for (const img of (exported.images || [])) {
        const num = String(img.sceneNumber || (Number(img.index) + 1)).padStart(2, '0');
        if (img.src && img.src.startsWith('data:image/')) {
            const base64Clean = img.src.replace(/^data:image\/[^;]+;(?:flowuuid=[^;]+;)?base64,/, '');
            const buf = Buffer.from(base64Clean, 'base64');
            const filePath = path.join(outDir, `escena_${num}.png`);
            const origPath = path.join(origDir, `escena_${num}.png`);
            fs.writeFileSync(filePath, buf);
            if (overwriteOriginals || !fs.existsSync(origPath)) {
                fs.writeFileSync(origPath, buf);
            }
            fs.writeFileSync(path.join(actualDir, `escena_${num}.png`), buf);
            savedImages.push({ sceneNumber: Number(num), path: filePath, originalPath: origPath });
        }
    }

    for (const vid of (exported.videos || [])) {
        const num = String(vid.sceneNumber || (Number(vid.index) + 1)).padStart(2, '0');
        const destPath = path.join(outDir, `escena_${num}.mp4`);
        const origPath = path.join(origDir, `escena_${num}.mp4`);
        let savedSource = null;

        if (vid.downloadedFilename && fs.existsSync(vid.downloadedFilename)) {
            fs.copyFileSync(vid.downloadedFilename, destPath);
            savedSource = 'chrome_download';
        } else if (vid.base64Data && vid.base64Data.startsWith('data:')) {
            const base64Clean = vid.base64Data.replace(/^data:[^;]+;base64,/, '');
            fs.writeFileSync(destPath, Buffer.from(base64Clean, 'base64'));
            savedSource = 'blob_base64';
        }

        if (savedSource && fs.existsSync(destPath)) {
            if (overwriteOriginals || !fs.existsSync(origPath)) {
                fs.copyFileSync(destPath, origPath);
            }
            fs.copyFileSync(destPath, path.join(actualDir, `escena_${num}.mp4`));
            savedVideos.push({
                sceneNumber: Number(num),
                path: destPath,
                originalPath: origPath,
                source: savedSource
            });
        }
    }

    savedVideos.sort((a, b) => a.sceneNumber - b.sceneNumber);

    let syncedEditorDir = null;
    if (editorMode === 'hyperframes') {
        syncedEditorDir = path.join(WORKSPACE_ROOT, 'hyperframes-renderer', 'assets', safeSlug);
        fs.mkdirSync(syncedEditorDir, { recursive: true });
        for (const v of savedVideos) {
            const srcToCopy = fs.existsSync(v.originalPath) ? v.originalPath : v.path;
            fs.copyFileSync(srcToCopy, path.join(syncedEditorDir, path.basename(v.path)));
        }
        for (const im of savedImages) {
            const srcToCopy = fs.existsSync(im.originalPath) ? im.originalPath : im.path;
            fs.copyFileSync(srcToCopy, path.join(syncedEditorDir, path.basename(im.path)));
        }
    } else if (editorMode === 'remotion') {
        syncedEditorDir = path.join(WORKSPACE_ROOT, 'remotion-renderer', 'public', safeSlug);
        fs.mkdirSync(syncedEditorDir, { recursive: true });
        for (const v of savedVideos) {
            const srcToCopy = fs.existsSync(v.originalPath) ? v.originalPath : v.path;
            fs.copyFileSync(srcToCopy, path.join(syncedEditorDir, path.basename(v.path)));
        }
        for (const im of savedImages) {
            const srcToCopy = fs.existsSync(im.originalPath) ? im.originalPath : im.path;
            fs.copyFileSync(srcToCopy, path.join(syncedEditorDir, path.basename(im.path)));
        }
    }

    return {
        ok: true,
        projectSlug: safeSlug,
        outputDirectory: outDir,
        originalsDirectory: origDir,
        storyboardPath: sbPath,
        savedCharacters,
        savedImages,
        savedVideos,
        editorMode,
        syncedEditorDir
    };
}

async function resolveFinalRenderedVideoOnDisk({ outDir, savedVideos = [], nativeRenderResult = null }) {
    const actualDir = path.join(ASSETS_ROOT, 'proyecto-actual');
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(actualDir, { recursive: true });
    const finalOutPath = path.join(outDir, 'video_final_renderizado.mp4');
    const actualOutPath = path.join(actualDir, 'video_final_renderizado.mp4');

    if (nativeRenderResult?.videoUrl && /^https?:\/\//i.test(nativeRenderResult.videoUrl)) {
        const resp = await fetch(nativeRenderResult.videoUrl);
        if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            if (buf.length > 1000) {
                fs.writeFileSync(finalOutPath, buf);
                fs.writeFileSync(actualOutPath, buf);
                return {
                    renderSource: 'cloud_run_facereels',
                    cloudVideoUrl: nativeRenderResult.videoUrl,
                    finalVideoPath: finalOutPath,
                    sizeBytes: buf.length
                };
            }
        }
    }

    if (nativeRenderResult?.fallbackToLocalFfmpeg && savedVideos.length > 0) {
        const concatListPath = path.join(outDir, 'ffmpeg_concat_list.txt');
        const sorted = [...savedVideos].sort((a, b) => a.sceneNumber - b.sceneNumber);
        const listContent = sorted
            .map(v => `file '${v.path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
            .join('\n');
        fs.writeFileSync(concatListPath, listContent, 'utf8');

        try {
            execFileSync('ffmpeg', [
                '-y', '-f', 'concat', '-safe', '0',
                '-i', concatListPath,
                '-c', 'copy',
                finalOutPath
            ], { stdio: 'ignore' });
        } catch (_) {
            const inputs = [];
            const filterParts = [];
            sorted.forEach((v, idx) => {
                inputs.push('-i', v.path);
                filterParts.push(`[${idx}:v][${idx}:a]`);
            });
            execFileSync('ffmpeg', [
                '-y',
                ...inputs,
                '-filter_complex', `${filterParts.join('')}concat=n=${sorted.length}:v=1:a=1[v][a]`,
                '-map', '[v]', '-map', '[a]',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-ar', '44100',
                finalOutPath
            ], { stdio: 'ignore' });
        }

        if (fs.existsSync(finalOutPath)) {
            fs.copyFileSync(finalOutPath, actualOutPath);
            const stat = fs.statSync(finalOutPath);
            return {
                renderSource: 'local_ffmpeg_fallback',
                cloudVideoUrl: null,
                finalVideoPath: finalOutPath,
                sizeBytes: stat.size
            };
        }
    }

    return null;
}

async function saveStandaloneMediaToDisk({ base64Data = null, src = null, downloadedFilename = null, outputPath = null, defaultExt = 'mp4', prefix = 'media' }) {
    const destPath = outputPath
        ? (path.isAbsolute(outputPath) ? outputPath : path.resolve(WORKSPACE_ROOT, outputPath))
        : path.join(ASSETS_ROOT, 'standalone', `${prefix}_${Date.now()}.${defaultExt}`);

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    let saved = false;

    if (downloadedFilename && fs.existsSync(downloadedFilename)) {
        fs.copyFileSync(downloadedFilename, destPath);
        saved = true;
    } else if (base64Data && typeof base64Data === 'string' && base64Data.startsWith('data:')) {
        const cleanB64 = base64Data.replace(/^data:[^;]+;(?:flowuuid=[^;]+;)?base64,/, '');
        fs.writeFileSync(destPath, Buffer.from(cleanB64, 'base64'));
        saved = true;
    } else if (src && typeof src === 'string' && src.startsWith('data:')) {
        const cleanB64 = src.replace(/^data:[^;]+;(?:flowuuid=[^;]+;)?base64,/, '');
        fs.writeFileSync(destPath, Buffer.from(cleanB64, 'base64'));
        saved = true;
    } else if (src && typeof src === 'string' && /^https?:\/\//i.test(src)) {
        try {
            const resp = await fetch(src);
            if (resp.ok) {
                const buf = Buffer.from(await resp.arrayBuffer());
                if (buf.length > 500) {
                    fs.writeFileSync(destPath, buf);
                    saved = true;
                }
            }
        } catch (_) {}
    }

    if (saved && fs.existsSync(destPath)) {
        const stat = fs.statSync(destPath);
        return {
            savedFilePath: destPath,
            sizeBytes: stat.size
        };
    }
    return null;
}

async function generateStandaloneVoiceover({ text, lang = 'es', voice = 'es-MX-DaliaNeural', outputPath = null }) {
    if (!text || typeof text !== 'string') {
        throw new Error('Falta el texto ("text") para generar la voz en off.');
    }

    const destPath = outputPath
        ? (path.isAbsolute(outputPath) ? outputPath : path.resolve(WORKSPACE_ROOT, outputPath))
        : path.join(ASSETS_ROOT, 'standalone', `voiceover_${Date.now()}.mp3`);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    // 1. Intentar con edge-tts si está disponible en el sistema
    try {
        execFileSync('edge-tts', ['--voice', voice, '--text', text, '--write-media', destPath], { stdio: 'ignore' });
        if (fs.existsSync(destPath) && fs.statSync(destPath).size > 200) {
            return {
                ok: true,
                engine: 'edge-tts',
                voice,
                savedFilePath: destPath,
                sizeBytes: fs.statSync(destPath).size
            };
        }
    } catch (_) {}

    // 2. Fallback directo a Google TTS MP3 por fragmentos (alta calidad, 0 dependencias externas)
    const cleanLang = String(lang || 'es').split('-')[0].toLowerCase();
    const chunks = [];
    const words = text.trim().split(/\s+/);
    let current = '';
    for (const w of words) {
        if ((current + ' ' + w).trim().length > 180) {
            if (current) chunks.push(current.trim());
            current = w;
        } else {
            current = (current + ' ' + w).trim();
        }
    }
    if (current) chunks.push(current.trim());

    const buffers = [];
    for (const chunk of chunks) {
        const ttsUrl = `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${encodeURIComponent(cleanLang)}&q=${encodeURIComponent(chunk)}`;
        const resp = await fetch(ttsUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        if (resp.ok) {
            buffers.push(Buffer.from(await resp.arrayBuffer()));
        }
    }

    if (buffers.length === 0) {
        throw new Error('No se pudo sintetizar el audio de voz en off.');
    }

    const finalBuf = Buffer.concat(buffers);
    fs.writeFileSync(destPath, finalBuf);
    return {
        ok: true,
        engine: 'google-tts',
        lang: cleanLang,
        savedFilePath: destPath,
        sizeBytes: finalBuf.length
    };
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                resolve(raw ? JSON.parse(raw) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const urlObj = new URL(req.url, `http://${HOST}:${PORT}`);

    try {
        if (req.method === 'GET' && urlObj.pathname === '/status') {
            const connectedRoles = Array.from(clients).map(c => ({ role: c.role, connectedAt: c.connectedAt }));
            const profiles = listChromeProfiles();
            const configuredAccount = process.env.account || process.env.ACCOUNT || null;
            const matchedProfile = findChromeProfile(configuredAccount);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                server: 'flow-veo3-mcp',
                port: PORT,
                extensionConnected: clients.size > 0,
                orchestratorConnected: connectedRoles.some(c => c.role === 'orchestrator'),
                backgroundConnected: connectedRoles.some(c => c.role === 'background'),
                configuredAccount,
                matchedProfile,
                detectedChromeProfiles: profiles.length,
                clients: connectedRoles,
                recentEvents: recentEvents.slice(-20)
            }));
            return;
        }

        if (req.method === 'GET' && urlObj.pathname === '/list-accounts') {
            const profiles = listChromeProfiles();
            const configuredAccount = process.env.account || process.env.ACCOUNT || null;
            const matchedProfile = findChromeProfile(configuredAccount);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                configuredAccount,
                matchedProfile,
                profiles: profiles.map(p => ({
                    ...p,
                    isActive: matchedProfile ? matchedProfile.directory === p.directory : p.isDefault
                }))
            }));
            return;
        }

        if (req.method === 'GET' && urlObj.pathname === '/list-models') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                imageGenerators: [
                    {
                        id: 'flow',
                        name: '🌊 Google Flow (Imagen 3)',
                        aspectRatios: ['9:16', '16:9', '1:1', '4:3', '3:4'],
                        supportsIngredients: true,
                        description: 'Generador de imágenes de alta fidelidad cinematográfica en Google Flow con soporte de etiquetas @Tag para personajes consistentes.'
                    },
                    {
                        id: 'gemini',
                        name: '✨ Google Gemini (Imagen 3)',
                        aspectRatios: ['9:16', '16:9', '1:1', '4:3', '3:4'],
                        supportsIngredients: true,
                        description: 'Generador de imágenes en el chat multimodal de Google Gemini con adjuntos de referencia visual.'
                    },
                    {
                        id: 'google_images',
                        name: '🍌 Google Nano Banana / Search Images',
                        aspectRatios: ['9:16', '16:9', '1:1'],
                        supportsIngredients: false,
                        description: 'Búsqueda e inyección de imágenes de referencia rápida.'
                    },
                    {
                        id: 'vids',
                        name: '🎞️ Google Vids (Diapositivas e Imágenes)',
                        aspectRatios: ['9:16', '16:9'],
                        supportsIngredients: true,
                        description: 'Generación de fondos y fotogramas dentro de Google Vids.'
                    }
                ],
                videoGenerators: [
                    {
                        id: 'flow',
                        name: '🌊 Google Flow (Veo 3)',
                        modelFamilies: [
                            { id: 'Omni 1.1 Flash', name: '✨ Omni 1.1 Flash', desc: 'Recomendado oficial Google Flow' },
                            { id: 'Veo 3.1 Fast', name: '⚡ Veo 3.1 Fast', desc: 'Generación rápida 720p' },
                            { id: 'Veo 3 Quality', name: '💎 Veo 3 Quality', desc: 'Máxima fidelidad cinematográfica' }
                        ],
                        modes: [
                            { id: 'ingredients', name: 'Ingredientes (@personaje, @locacion)', desc: 'Genera vídeo directamente usando texto e ingredientes/personajes sin requerir imagen base previa.' },
                            { id: 'frames', name: 'Fotogramas (Image-to-Video)', desc: 'Anima una imagen o fotograma base previo.' }
                        ],
                        aspectRatios: ['9:16', '16:9', '1:1'],
                        durations: ['4s', '8s'],
                        resolutions: ['360p', '720p'],
                        outputsCount: ['x1', 'x2', 'x4'],
                        supportsIngredients: true
                    },
                    {
                        id: 'gemini_omni',
                        name: '✨ Google Gemini (Omni Video / Veo)',
                        modes: [
                            { id: 'ingredients', name: 'Multimodal con ingredientes adjuntos' },
                            { id: 'direct', name: 'Prompt directo' }
                        ],
                        aspectRatios: ['9:16', '16:9', '1:1'],
                        durations: ['4s', '8s'],
                        supportsIngredients: true
                    },
                    {
                        id: 'vids',
                        name: '🎞️ Google Vids (Veo 3)',
                        modes: [
                            { id: 'ingredients', name: 'Ingredientes de personajes en línea de tiempo' },
                            { id: 'voiceover_sync', name: 'Sincronización con narrador' }
                        ],
                        aspectRatios: ['9:16', '16:9'],
                        durations: ['4s', '8s'],
                        supportsIngredients: true
                    }
                ]
            }));
            return;
        }

        if (req.method === 'POST' && urlObj.pathname === '/launch-chrome') {
            const body = await readJsonBody(req);
            const { account = null, targetApp = 'flow' } = body;
            const urlMap = {
                flow: 'https://labs.google.com/flow',
                gemini: 'https://gemini.google.com',
                vids: 'https://vids.google.com'
            };
            const targetUrl = urlMap[targetApp] || 'https://labs.google.com/flow';
            const extDir = path.resolve(WORKSPACE_ROOT, 'extension para flow-veo3');
            const result = launchChromeForProfile({
                account: account || process.env.account || process.env.ACCOUNT,
                targetUrl,
                extensionPath: fs.existsSync(extDir) ? extDir : null
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, ...result }));
            return;
        }

        if (req.method === 'POST' && urlObj.pathname === '/master-prompt') {
            const body = await readJsonBody(req);
            const result = await generateMasterPromptLocally(body, sendCommandToExtension);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
        }

        
        if (req.method === 'POST' && urlObj.pathname === '/generate-music') {
            const body = await readJsonBody(req);
            const result = await sendCommandToExtension('generate_music', body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result }));
            return;
        }

        if (req.method === 'POST' && urlObj.pathname === '/launch-app') {
            const body = await readJsonBody(req);
            const result = await sendCommandToExtension('launch_app', body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result }));
            return;
        }

        if (req.method === 'POST' && urlObj.pathname === '/generate-image') {
            const body = await readJsonBody(req);
            const result = await sendCommandToExtension('generate_image', body);
            const savedInfo = await saveStandaloneMediaToDisk({
                base64Data: result?.base64Data,
                src: result?.src,
                outputPath: body.outputPath,
                defaultExt: 'png',
                prefix: 'img'
            });
            if (result && typeof result === 'object') {
                delete result.base64Data;
                if (savedInfo) {
                    result.savedFilePath = savedInfo.savedFilePath;
                    result.sizeBytes = savedInfo.sizeBytes;
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: Boolean(result?.ok !== false), result }));
            return;
        }

        if (req.method === 'POST' && urlObj.pathname === '/generate-video') {
            const body = await readJsonBody(req);
            const result = await sendCommandToExtension('generate_video', body);
            const savedInfo = await saveStandaloneMediaToDisk({
                base64Data: result?.base64Data,
                src: result?.src,
                downloadedFilename: result?.downloadedFilename,
                outputPath: body.outputPath,
                defaultExt: 'mp4',
                prefix: 'video'
            });
            if (result && typeof result === 'object') {
                delete result.base64Data;
                if (savedInfo) {
                    result.savedFilePath = savedInfo.savedFilePath;
                    result.sizeBytes = savedInfo.sizeBytes;
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: Boolean(result?.ok !== false), result }));
            return;
        }

        if (req.method === 'POST' && urlObj.pathname === '/add-ingredient') {
            const body = await readJsonBody(req);
            const result = await sendCommandToExtension('add_ingredient', body);
            const savedInfo = await saveStandaloneMediaToDisk({
                base64Data: result?.base64Data,
                src: result?.src,
                outputPath: body.outputPath,
                defaultExt: 'png',
                prefix: `ingredient_${String(body.tag || body.name || 'item').replace(/[^a-zA-Z0-9_-]/g, '')}`
            });
            if (result && typeof result === 'object') {
                delete result.base64Data;
                if (savedInfo) {
                    result.savedFilePath = savedInfo.savedFilePath;
                    result.sizeBytes = savedInfo.sizeBytes;
                }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result }));
            return;
        }

        if (req.method === 'POST' && urlObj.pathname === '/generate-voiceover') {
            const body = await readJsonBody(req);
            const result = await generateStandaloneVoiceover(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result }));
            return;
        }

        if (req.method === 'POST' && urlObj.pathname === '/command') {
            const body = await readJsonBody(req);
            const { command, params = {}, timeoutMs = 1200000 } = body;
            if (!command) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Falta el campo "command".' }));
                return;
            }
            const result = await sendCommandToExtension(command, params, timeoutMs);

            if (command === 'run_full_pipeline' && result && result.ok) {
                try {
                    const exportedDisk = await exportAndSaveAssetsToDisk({
                        projectSlug: params.projectSlug || 'proyecto-actual',
                        editorMode: 'native',
                        overwriteOriginals: true
                    });
                    const finalVideoInfo = await resolveFinalRenderedVideoOnDisk({
                        outDir: exportedDisk.outputDirectory,
                        savedVideos: exportedDisk.savedVideos,
                        nativeRenderResult: result.nativeRenderResult
                    });
                    result.savedAssets = exportedDisk;
                    result.finalRenderedVideo = finalVideoInfo;
                } catch (autoSaveErr) {
                    result.autoSaveWarning = autoSaveErr?.message || String(autoSaveErr);
                }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result }));
            return;
        }

        if (req.method === 'POST' && urlObj.pathname === '/export-to-disk') {
            const body = await readJsonBody(req);
            const result = await exportAndSaveAssetsToDisk(body);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
        }

        if (req.method === 'POST' && urlObj.pathname === '/render-edited-in-cloud') {
            const body = await readJsonBody(req);
            const {
                projectSlug = 'proyecto-actual',
                editedScenes = [],
                editorMode = 'hyperframes',
                title = null
            } = body;

            const preparedScenes = [];
            for (const item of editedScenes) {
                const idx = Number(item.sceneIndex ?? item.index ?? 0);
                const filePath = path.resolve(WORKSPACE_ROOT, item.filePath || '');
                if (!fs.existsSync(filePath)) {
                    throw new Error(`No existe el vídeo editado en disco: ${filePath}`);
                }
                const buf = fs.readFileSync(filePath);
                const b64 = `data:video/mp4;base64,${buf.toString('base64')}`;
                preparedScenes.push({
                    index: idx,
                    base64Data: b64,
                    editorMode
                });
            }

            const extRes = await sendCommandToExtension('upload_edited_videos_and_render', {
                editedScenes: preparedScenes,
                title
            }, 900000);

            const outDir = path.join(ASSETS_ROOT, String(projectSlug).toLowerCase().replace(/[^a-z0-9-_]+/g, '-'));
            const finalVideoInfo = await resolveFinalRenderedVideoOnDisk({
                outDir,
                savedVideos: editedScenes.map((s, i) => ({
                    sceneNumber: Number(s.sceneIndex ?? s.index ?? i) + 1,
                    path: path.resolve(WORKSPACE_ROOT, s.filePath)
                })),
                nativeRenderResult: extRes?.cloudRenderResult
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                ok: true,
                cloudRenderResult: extRes?.cloudRenderResult || null,
                finalRenderedVideo: finalVideoInfo
            }));
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Ruta no encontrada' }));
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    }
});

server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
        socket.destroy();
        return;
    }
    const acceptKey = crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
    );

    const urlObj = new URL(req.url, `http://${HOST}:${PORT}`);
    const role = urlObj.searchParams.get('role') || 'extension';
    attachWebSocketClient(socket, role);
});

server.listen(PORT, HOST, () => {
    console.log(`🚀 [flow-veo3-mcp] Servidor activo en http://${HOST}:${PORT} y ws://${HOST}:${PORT}/ws`);
});

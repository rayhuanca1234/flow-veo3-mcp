#!/usr/bin/env node
// flow-lite-mcp/mcp-stdio.js
// MCP Ultraligero y Directo para Google Flow, Gemini y Google Vids (Imágenes, Vídeos con Ingredientes/Frames, UUIDs, Música y Voz)

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REGISTRY_PATH = path.join(__dirname, 'registry.json');
const BRIDGE_URL = process.env.FLOW_MCP_URL || 'http://127.0.0.1:3847';

// ── GESTOR DE MEMORIA PERSISTENTE DE UUIDs Y ASSETS (registry.json) ──────────
export function loadRegistry() {
    try {
        if (fs.existsSync(REGISTRY_PATH)) {
            return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
        }
    } catch (_) {}
    return { lastImageUuid: null, lastVideoUuid: null, assets: [] };
}

export function saveRegistry(reg) {
    try {
        fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2), 'utf8');
    } catch (_) {}
}

export function recordAssetInRegistry(entry) {
    if (!entry) return null;
    const reg = loadRegistry();
    if (!Array.isArray(reg.assets)) reg.assets = [];

    const uuid = entry.uuid || null;
    const tag = entry.tag ? (String(entry.tag).startsWith('@') ? String(entry.tag) : `@${entry.tag}`) : null;

    if (uuid && entry.type === 'image') reg.lastImageUuid = uuid;
    if (uuid && entry.type === 'video') reg.lastVideoUuid = uuid;

    const existingIdx = reg.assets.findIndex(a =>
        (uuid && a.uuid === uuid) ||
        (tag && a.tag && a.tag.toLowerCase() === tag.toLowerCase()) ||
        (entry.savedFilePath && a.savedFilePath === entry.savedFilePath)
    );

    const prev = existingIdx >= 0 ? reg.assets[existingIdx] : {};
    const record = {
        uuid: uuid || prev.uuid || null,
        tag: tag || prev.tag || `@asset_${reg.assets.length + 1}`,
        name: entry.name || prev.name || (tag ? tag.slice(1) : `asset_${reg.assets.length + 1}`),
        type: entry.type || prev.type || 'image',
        engine: entry.engine || prev.engine || 'flow',
        aspectRatio: entry.aspectRatio || prev.aspectRatio || '16:9',
        duration: entry.duration || prev.duration || null,
        videoMode: entry.videoMode || prev.videoMode || null,
        startFrameUuid: entry.startFrameUuid || prev.startFrameUuid || null,
        endFrameUuid: entry.endFrameUuid || prev.endFrameUuid || null,
        prompt: entry.prompt || prev.prompt || '',
        src: entry.src || prev.src || null,
        savedFilePath: entry.savedFilePath || prev.savedFilePath || null,
        createdAt: prev.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
        reg.assets[existingIdx] = { ...reg.assets[existingIdx], ...record };
    } else {
        reg.assets.unshift(record);
    }
    saveRegistry(reg);
    return record;
}

export function resolveAssetReference(ref) {
    if (!ref) return null;
    if (typeof ref === 'object' && (ref.uuid || ref.image || ref.src)) return ref;
    const str = String(ref).trim();
    const uuidMatch = str.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) return uuidMatch[0];

    const reg = loadRegistry();
    const lower = str.toLowerCase();
    if (lower === 'last' || lower === 'last_image' || lower === 'ultima_imagen') {
        if (reg.lastImageUuid) return reg.lastImageUuid;
        const firstImg = (reg.assets || []).find(a => a.type === 'image' && a.uuid);
        return firstImg?.uuid || str;
    }
    if (lower === 'last_video' || lower === 'ultimo_video') {
        if (reg.lastVideoUuid) return reg.lastVideoUuid;
        const firstVid = (reg.assets || []).find(a => a.type === 'video' && a.uuid);
        return firstVid?.uuid || str;
    }

    const cleanTag = lower.startsWith('@') ? lower : `@${lower}`;
    const found = (reg.assets || []).find(a =>
        (a.tag && a.tag.toLowerCase() === cleanTag) ||
        (a.name && a.name.toLowerCase() === lower.replace(/^@/, ''))
    );
    if (found?.uuid) return found.uuid;
    if (found?.savedFilePath) return found.savedFilePath;
    return str;
}

// ── CLIENTE HTTP ULTRARRÁPIDO Y SIN TIMEOUT DE 300s AL PUENTE CHROME (127.0.0.1:3847) ──
async function callBridge(endpoint, method = 'GET', body = null, timeoutMs = 1800000) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${BRIDGE_URL}${endpoint}`);
        const payload = body !== null ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: url.hostname,
            port: url.port || 3847,
            path: url.pathname + url.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
            },
            timeout: timeoutMs
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                try {
                    const data = JSON.parse(raw);
                    if (res.statusCode >= 400 || data.ok === false) {
                        reject(new Error(data.error || `Error HTTP ${res.statusCode} en ${endpoint}`));
                    } else {
                        resolve(data);
                    }
                } catch (err) {
                    reject(new Error(`Respuesta JSON inválida en ${endpoint}: ${raw.slice(0, 200)}`));
                }
            });
        });
        req.on('timeout', () => {
            req.destroy(new Error(`Timeout tras ${Math.round(timeoutMs / 1000)}s en ${endpoint}`));
        });
        req.on('error', (err) => reject(err));
        if (payload) req.write(payload);
        req.end();
    });
}

// ── CATÁLOGO COMPACTO DE HERRAMIENTAS DE FLOW-LITE-MCP ───────────────────────
export const LITE_TOOLS = [
    {
        name: 'lite_status',
        description: 'Verifica la conexión directa con Chrome (Flow/Gemini/Vids) y devuelve el último UUID de imagen/vídeo almacenado en memoria.',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'lite_list_assets',
        description: 'Lista todos los UUIDs de Google Flow, etiquetas @tag y archivos locales guardados en registry.json. Si scanFlow=true, escanea en vivo todos los UUIDs presentes en la pestaña abierta de Google Flow.',
        inputSchema: {
            type: 'object',
            properties: {
                scanFlow: { type: 'boolean', default: false, description: 'Si es true, escanea en vivo el DOM de Google Flow y sincroniza todos los UUIDs del proyecto abierto' },
                type: { type: 'string', enum: ['all', 'image', 'video', 'ingredient'], default: 'all' }
            }
        }
    },
    {
        name: 'lite_configure',
        description: 'Autoconfigura directamente los controles de la app web abierta (Google Flow, Gemini o Vids): tipo (image/video), modo (ingredients/frames), aspectRatio (16:9 o 9:16), duración (4s, 6s, 8s), resolución (720p/360p) y cantidad (x1, x2, x4). Si la app web ya está abierta, la usa al instante sin recargar.',
        inputSchema: {
            type: 'object',
            properties: {
                app: { type: 'string', enum: ['flow', 'gemini', 'vids'], default: 'flow' },
                type: { type: 'string', enum: ['image', 'video'], default: 'video' },
                videoMode: { type: 'string', enum: ['ingredients', 'frames'], default: 'ingredients' },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], default: '16:9' },
                duration: { type: 'string', enum: ['4s', '6s', '8s'], default: '8s' },
                resolution: { type: 'string', enum: ['720p', '360p'], default: '720p' },
                outputsCount: { type: 'string', enum: ['x1', 'x2', 'x4'], default: 'x1' }
            }
        }
    },
    {
        name: 'lite_register_ingredient',
        description: 'Registra o sube un ingrediente (@tag) en Google Flow (desde archivo local, URL, generación en Flow o UUID existente) y guarda su UUID en registry.json para usarlo en imágenes o vídeos.',
        inputSchema: {
            type: 'object',
            required: ['tag'],
            properties: {
                tag: { type: 'string', description: 'Etiqueta del ingrediente (ej. "@perro_gato", "@heroe")' },
                name: { type: 'string', description: 'Nombre descriptivo' },
                uuid: { type: 'string', description: 'UUID existente en Google Flow (ej. "45f9e51d-bc1c-4e99-b428-38a66b955d06") si ya existe en el proyecto' },
                image: { type: 'string', description: 'Ruta local en disco o URL si deseas subir una imagen nueva' },
                description: { type: 'string', description: 'Prompt/descripción si generateInFlow=true' },
                generateInFlow: { type: 'boolean', default: false },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], default: '16:9' }
            }
        }
    },
    {
        name: 'lite_generate_image',
        description: 'Genera 1 imagen directamente en la app web (flow, gemini o vids) con o sin ingredientes (UUIDs de Flow o @tags), la descarga en disco (savedFilePath) y guarda automáticamente su UUID de Flow en registry.json.',
        inputSchema: {
            type: 'object',
            required: ['prompt'],
            properties: {
                prompt: { type: 'string', description: 'Prompt visual de la imagen' },
                engine: { type: 'string', enum: ['flow', 'gemini', 'vids'], default: 'flow' },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], default: '16:9' },
                ingredients: {
                    type: 'array',
                    description: 'Lista de UUIDs de Flow (ej. ["45f9e51d-bc1c-4e99-b428-38a66b955d06"]), @tags o "last_image" para usar como referencia visual'
                },
                tag: { type: 'string', description: 'Etiqueta @tag opcional con la que se guardará esta imagen y su UUID en registry.json (ej. "@escena_playa")' },
                style: { type: 'string', description: 'Estilo opcional' },
                outputPath: { type: 'string', description: 'Ruta en disco donde guardar el .png (ej. "workspace-assets/standalone/mi_img.png")' }
            }
        }
    },
    {
        name: 'lite_generate_video',
        description: 'Genera 1 vídeo (.mp4) directamente en la app web (flow, gemini o vids). Soporta modo "ingredients" (con UUIDs/@tags) y modo "frames" (con startFrame y endFrame usando UUIDs de Flow como "45f9e51d-bc1c-4e99-b428-38a66b955d06", @tag o "last_image"). Autoconfigura aspectRatio (16:9 o 9:16) y duration (4s, 6s, 8s), descarga el .mp4 a disco y guarda su UUID.',
        inputSchema: {
            type: 'object',
            required: ['prompt'],
            properties: {
                prompt: { type: 'string', description: 'Prompt de movimiento, acción y cámara para el vídeo' },
                engine: { type: 'string', enum: ['flow', 'gemini', 'vids'], default: 'flow' },
                videoMode: { type: 'string', enum: ['ingredients', 'frames'], default: 'ingredients', description: '"ingredients" (texto + ingredientes UUID) o "frames" (Image-to-Video con startFrame y/o endFrame)' },
                startFrame: { type: 'string', description: 'UUID en Flow (ej. "45f9e51d-bc1c-4e99-b428-38a66b955d06"), @tag (ej. "@perro_gato") o "last_image" para el fotograma inicial (Start Frame)' },
                endFrame: { type: 'string', description: 'UUID en Flow o @tag opcional para el fotograma final (End Frame)' },
                ingredients: {
                    type: 'array',
                    description: 'Lista de UUIDs de Flow o @tags para adjuntar como ingredientes del vídeo'
                },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], default: '16:9' },
                duration: { type: 'string', enum: ['4s', '6s', '8s'], default: '8s' },
                modelFamily: { type: 'string', enum: ['Omni 1.1 Flash', 'Veo 3.1 Fast', 'Veo 3 Quality'], default: 'Omni 1.1 Flash' },
                resolution: { type: 'string', enum: ['720p', '360p'], default: '720p' },
                tag: { type: 'string', description: 'Etiqueta @tag opcional para registrar el vídeo resultante' },
                outputPath: { type: 'string', description: 'Ruta en disco donde guardar el .mp4 (ej. "workspace-assets/standalone/mi_video.mp4")' }
            }
        }
    },
    {
        name: 'lite_generate_video_batch',
        description: 'Lanza la generación de múltiples escenas de vídeo en BLOQUE SECUENCIAL NO BLOQUEANTE en Google Flow (igual que la extensión: envía la Escena 1 y apenas Flow acepta el envío lanza de inmediato la Escena 2 sin esperar a que termine de generarse la 1, A MENOS que esté activo videoChain=true en una escena o globalmente, en cuyo caso espera a que termine la escena N-1 para usar ese vídeo como ingrediente de continuidad de escenario en la escena N). PROHIBIDO EL RENDERIZADO FINAL: jamás renderiza un vídeo unido; solo descarga los clips .mp4 individuales de la app web al disco.',
        inputSchema: {
            type: 'object',
            required: ['scenes'],
            properties: {
                scenes: {
                    type: 'array',
                    description: 'Lista de escenas: [{ prompt, ingredients: ["@personaje1"], startFrame, endFrame, videoChain: false, duration: "8s", tag: "@clip1", outputPath: "ruta/clip1.mp4" }]'
                },
                engine: { type: 'string', enum: ['flow', 'gemini', 'vids'], default: 'flow' },
                videoMode: { type: 'string', enum: ['ingredients', 'frames'], default: 'ingredients' },
                aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'], default: '9:16' },
                duration: { type: 'string', enum: ['4s', '6s', '8s'], default: '8s' },
                modelFamily: { type: 'string', enum: ['Omni 1.1 Flash', 'Veo 3.1 Fast', 'Veo 3 Quality'], default: 'Omni 1.1 Flash' },
                resolution: { type: 'string', enum: ['720p', '360p'], default: '720p' },
                videoChain: { type: 'boolean', default: false, description: 'Si es true, la escena N espera a que termine la escena N-1 para usar su vídeo como ingrediente de continuidad de escenario' },
                frameChain: { type: 'boolean', default: false, description: 'Si es true, extrae el último fotograma de la escena N-1 y lo usa como Start Frame de la escena N' },
                outputDir: { type: 'string', description: 'Carpeta opcional donde guardar scene_1.mp4, scene_2.mp4...' }
            }
        }
    },
    {
        name: 'lite_generate_music',
        description: 'Genera música de fondo instrumental directamente en Google Vids (Lyria 3), Google Gemini o Flow Music.',
        inputSchema: {
            type: 'object',
            required: ['prompt'],
            properties: {
                prompt: { type: 'string', description: 'Descripción musical' },
                engine: { type: 'string', enum: ['lyria', 'gemini', 'flow_music'], default: 'lyria' },
                duration: { type: 'string', enum: ['15s', '30s', '60s', 'full'], default: 'full' },
                style: { type: 'string' },
                mood: { type: 'string' }
            }
        }
    },
    {
        name: 'lite_generate_voiceover',
        description: 'Genera una pista de voz en off (.mp3) en disco lista para mezclar con FFmpeg o HyperFrames.',
        inputSchema: {
            type: 'object',
            required: ['text'],
            properties: {
                text: { type: 'string', description: 'Texto a narrar' },
                lang: { type: 'string', default: 'es' },
                voice: { type: 'string', default: 'es-MX-DaliaNeural' },
                outputPath: { type: 'string', description: 'Ruta del archivo .mp3 a guardar' }
            }
        }
    }
];

// ── EJECUTOR PRINCIPAL DE HERRAMIENTAS ───────────────────────────────────────
export async function invokeLiteTool(name, args = {}) {
    switch (name) {
        case 'lite_status': {
            const status = await callBridge('/status', 'GET');
            const reg = loadRegistry();
            return {
                ok: true,
                mcp: 'flow-lite-mcp',
                extensionConnected: status.extensionConnected,
                activeProfile: status.matchedProfile?.name || status.matchedProfile?.email || null,
                lastImageUuid: reg.lastImageUuid,
                lastVideoUuid: reg.lastVideoUuid,
                storedAssetsCount: (reg.assets || []).length
            };
        }

        case 'lite_list_assets': {
            if (args.scanFlow) {
                try {
                    const scanRes = await callBridge('/command', 'POST', {
                        command: 'direct_scan_flow_uuids',
                        params: {}
                    });
                    const liveAssets = scanRes?.result?.assets || [];
                    for (const item of liveAssets) {
                        if (item.uuid) {
                            recordAssetInRegistry({
                                uuid: item.uuid,
                                type: item.type || 'image',
                                engine: 'flow',
                                src: item.src || null,
                                prompt: item.label || ''
                            });
                        }
                    }
                } catch (_) {}
            }
            const reg = loadRegistry();
            const filterType = args.type && args.type !== 'all' ? args.type : null;
            const list = filterType
                ? (reg.assets || []).filter(a => a.type === filterType)
                : (reg.assets || []);
            return {
                ok: true,
                lastImageUuid: reg.lastImageUuid,
                lastVideoUuid: reg.lastVideoUuid,
                count: list.length,
                assets: list
            };
        }

        case 'lite_configure': {
            const res = await callBridge('/command', 'POST', {
                command: 'direct_configure_web',
                params: args
            });
            return { ok: true, result: res.result };
        }

        case 'lite_register_ingredient': {
            if (args.uuid && !args.image && !args.generateInFlow) {
                const saved = recordAssetInRegistry({
                    uuid: args.uuid,
                    tag: args.tag,
                    name: args.name || args.tag,
                    type: 'ingredient',
                    engine: 'flow',
                    aspectRatio: args.aspectRatio || '16:9',
                    prompt: args.description || ''
                });
                return { ok: true, registeredInMemory: true, asset: saved };
            }
            const payload = { ...args };
            let localFileResolved = null;
            if (payload.image && typeof payload.image === 'string' && !payload.image.startsWith('data:') && !/^https?:\/\//i.test(payload.image)) {
                const candidate = path.isAbsolute(payload.image) ? payload.image : path.resolve(process.cwd(), payload.image);
                if (fs.existsSync(candidate)) {
                    localFileResolved = candidate;
                    const ext = path.extname(candidate).toLowerCase().replace('.', '') || 'png';
                    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
                    const buf = fs.readFileSync(candidate);
                    payload.image = `data:${mime};base64,${buf.toString('base64')}`;
                }
            }
            const res = await callBridge('/add-ingredient', 'POST', payload);
            const result = res.result || {};
            const saved = recordAssetInRegistry({
                uuid: result.uuid || args.uuid || null,
                tag: args.tag,
                name: args.name || args.tag,
                type: 'ingredient',
                engine: 'flow',
                aspectRatio: args.aspectRatio || '9:16',
                prompt: args.description || '',
                src: result.src || null,
                savedFilePath: result.savedFilePath || localFileResolved || null
            });
            return { ok: true, uuid: saved.uuid, tag: saved.tag, result, asset: saved };
        }

        case 'lite_generate_image': {
            const resolvedIngredients = Array.isArray(args.ingredients)
                ? args.ingredients.map(resolveAssetReference).filter(Boolean)
                : [];
            const payload = {
                ...args,
                ingredients: resolvedIngredients
            };
            const res = await callBridge('/generate-image', 'POST', payload);
            const result = res.result || {};
            const saved = recordAssetInRegistry({
                uuid: result.uuid || null,
                tag: args.tag || null,
                name: args.tag ? String(args.tag).replace(/^@/, '') : (args.outputPath ? path.basename(args.outputPath, path.extname(args.outputPath)) : null),
                type: 'image',
                engine: args.engine || 'flow',
                aspectRatio: args.aspectRatio || '16:9',
                prompt: result.finalPrompt || args.prompt,
                src: result.src || null,
                savedFilePath: result.savedFilePath || null
            });
            return {
                ok: true,
                uuid: result.uuid || saved?.uuid || null,
                tag: saved?.tag || null,
                savedFilePath: result.savedFilePath || null,
                sizeBytes: result.sizeBytes || null,
                aspectRatio: args.aspectRatio || '16:9',
                engine: args.engine || 'flow',
                src: result.src || null
            };
        }

        case 'lite_generate_video': {
            const resolvedStart = args.startFrame ? resolveAssetReference(args.startFrame) : null;
            const resolvedEnd = args.endFrame ? resolveAssetReference(args.endFrame) : null;
            const resolvedIngredients = Array.isArray(args.ingredients)
                ? args.ingredients.map(resolveAssetReference).filter(Boolean)
                : [];

            const effectiveMode = (args.videoMode === 'frames' || resolvedStart || resolvedEnd)
                ? 'frames'
                : 'ingredients';

            const payload = {
                ...args,
                videoMode: effectiveMode,
                baseImage: resolvedStart || args.baseImage || null,
                startFrameUuid: resolvedStart || null,
                endFrameUuid: resolvedEnd || null,
                ingredients: resolvedIngredients
            };

            const res = await callBridge('/generate-video', 'POST', payload);
            const result = res.result || {};
            const saved = recordAssetInRegistry({
                uuid: result.uuid || null,
                tag: args.tag || null,
                name: args.tag ? String(args.tag).replace(/^@/, '') : (args.outputPath ? path.basename(args.outputPath, path.extname(args.outputPath)) : null),
                type: 'video',
                engine: args.engine || 'flow',
                videoMode: effectiveMode,
                startFrameUuid: resolvedStart || null,
                endFrameUuid: resolvedEnd || null,
                aspectRatio: args.aspectRatio || '16:9',
                duration: args.duration || '8s',
                prompt: result.finalPrompt || args.prompt,
                src: result.src || null,
                savedFilePath: result.savedFilePath || null
            });
            return {
                ok: true,
                uuid: result.uuid || null,
                tag: saved?.tag || null,
                videoMode: effectiveMode,
                startFrameUsed: resolvedStart || null,
                endFrameUsed: resolvedEnd || null,
                savedFilePath: result.savedFilePath || null,
                sizeBytes: result.sizeBytes || null,
                aspectRatio: args.aspectRatio || '16:9',
                duration: args.duration || '8s',
                engine: args.engine || 'flow',
                src: result.src || null
            };
        }

        case 'lite_generate_video_batch': {
            const rawScenes = Array.isArray(args.scenes) ? args.scenes : [];
            if (rawScenes.length === 0) {
                throw new Error('Se requiere al menos 1 escena en "scenes" para lite_generate_video_batch.');
            }
            const resolvedScenes = rawScenes.map((sc, idx) => {
                const resolvedStart = sc.startFrame ? resolveAssetReference(sc.startFrame) : null;
                const resolvedEnd = sc.endFrame ? resolveAssetReference(sc.endFrame) : null;
                const resolvedIngredients = Array.isArray(sc.ingredients)
                    ? sc.ingredients.map(resolveAssetReference).filter(Boolean)
                    : [];
                return {
                    ...sc,
                    index: idx,
                    startFrameUuid: resolvedStart || sc.startFrameUuid || null,
                    endFrameUuid: resolvedEnd || sc.endFrameUuid || null,
                    ingredients: resolvedIngredients
                };
            });

            const payload = {
                ...args,
                scenes: resolvedScenes
            };

            const res = await callBridge('/generate-video-batch', 'POST', payload, 2400000);
            const result = res.result || {};
            const videosOut = Array.isArray(result.videos) ? result.videos : [];

            for (const vid of videosOut) {
                const idx = Number(vid.index ?? 0);
                const scInput = resolvedScenes[idx] || {};
                recordAssetInRegistry({
                    uuid: vid.uuid || null,
                    tag: scInput.tag || `@scene_video_${idx + 1}`,
                    name: scInput.tag ? String(scInput.tag).replace(/^@/, '') : `scene_video_${idx + 1}`,
                    type: 'video',
                    engine: args.engine || 'flow',
                    videoMode: args.videoMode || 'ingredients',
                    aspectRatio: scInput.aspectRatio || args.aspectRatio || '9:16',
                    duration: scInput.duration || args.duration || '8s',
                    prompt: scInput.prompt || '',
                    src: vid.src || null,
                    savedFilePath: vid.savedFilePath || null
                });
            }

            return {
                ok: true,
                totalScenes: result.totalScenes || resolvedScenes.length,
                videosReady: result.videosReady || videosOut.length,
                videoChainUsed: Boolean(result.videoChainUsed),
                finalRenderExecuted: false,
                videos: videosOut
            };
        }

        case 'lite_generate_music': {
            const res = await callBridge('/generate-music', 'POST', args);
            return { ok: true, result: res.result };
        }

        case 'lite_generate_voiceover': {
            const res = await callBridge('/generate-voiceover', 'POST', args);
            return { ok: true, result: res.result };
        }

        default:
            throw new Error(`Herramienta desconocida en flow-lite-mcp: ${name}`);
    }
}

// ── SERVIDOR JSON-RPC 2.0 STDIO (PARA REGISTRO MCP DIRECTO) ──────────────────
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMainModule) {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let msg;
        try {
            msg = JSON.parse(trimmed);
        } catch (_) {
            return;
        }

        const { id, method, params } = msg;
        const send = (payload) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...payload }) + '\n');

        try {
            if (method === 'initialize') {
                send({
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: { tools: {} },
                        serverInfo: { name: 'flow-lite-mcp', version: '1.0.0' }
                    }
                });
            } else if (method === 'tools/list') {
                send({ result: { tools: LITE_TOOLS } });
            } else if (method === 'tools/call') {
                const toolRes = await invokeLiteTool(params?.name, params?.arguments || {});
                send({
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(toolRes, null, 2) }]
                    }
                });
            } else if (id !== undefined) {
                send({ result: {} });
            }
        } catch (err) {
            if (id !== undefined) {
                send({
                    error: { code: -32000, message: err?.message || String(err) }
                });
            }
        }
    });
}

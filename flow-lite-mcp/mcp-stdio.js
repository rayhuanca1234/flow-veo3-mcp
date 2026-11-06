#!/usr/bin/env node
// flow-lite-mcp/mcp-stdio.js
// MCP Ultraligero y Directo para Google Flow, Gemini y Google Vids (Imágenes, Vídeos con Ingredientes/Frames, UUIDs, Música y Voz)

import fs from 'node:fs';
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

// ── CLIENTE HTTP ULTRARRÁPIDO AL PUENTE CHROME (127.0.0.1:3847) ──────────────
async function callBridge(endpoint, method = 'GET', body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (body !== null) opts.body = JSON.stringify(body);
    const res = await fetch(`${BRIDGE_URL}${endpoint}`, opts);
    const data = await res.json();
    if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Error HTTP ${res.status} en ${endpoint}`);
    }
    return data;
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
            const res = await callBridge('/add-ingredient', 'POST', args);
            const result = res.result || {};
            const saved = recordAssetInRegistry({
                uuid: result.uuid || args.uuid || null,
                tag: args.tag,
                name: args.name || args.tag,
                type: 'ingredient',
                engine: 'flow',
                aspectRatio: args.aspectRatio || '16:9',
                prompt: args.description || '',
                src: result.src || null,
                savedFilePath: result.savedFilePath || null
            });
            return { ok: true, result, asset: saved };
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

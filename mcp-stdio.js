#!/usr/bin/env node
// flow-veo3-mcp/mcp-stdio.js
// Servidor MCP estándar (JSON-RPC 2.0 sobre stdio) para Antigravity.

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRIDGE_URL = 'http://127.0.0.1:3847';

export async function ensureBridgeRunning() {
    try {
        const res = await fetch(`${BRIDGE_URL}/status`);
        if (res.ok) return true;
    } catch (e) { }

    const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();

    for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 250));
        try {
            const res = await fetch(`${BRIDGE_URL}/status`);
            if (res.ok) return true;
        } catch (e) { }
    }
    return false;
}

export async function callBridge(endpoint, method = 'GET', body = null, timeoutMs = 2400000) {
    await ensureBridgeRunning();
    return new Promise((resolve, reject) => {
        const urlObj = new URL(`${BRIDGE_URL}${endpoint}`);
        const payload = body !== null ? Buffer.from(JSON.stringify(body), 'utf8') : null;
        const req = http.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(payload ? { 'Content-Length': payload.length } : {})
            },
            timeout: timeoutMs
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                try {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    resolve(raw ? JSON.parse(raw) : {});
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('timeout', () => {
            req.destroy(new Error(`Request timeout (${Math.round(timeoutMs / 1000)}s) calling ${endpoint}`));
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

export const MCP_TOOLS = [
    {
        name: 'flow_status',
        description: 'Verifica la conexión en tiempo real con la extensión Chrome AI Auto-Prompt (Flow / Veo 3 / Gemini / Vids), eventos recientes y la cuenta de Chrome activa configurada.',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'flow_list_accounts',
        description: 'Inspecciona automáticamente el archivo Local State de Chrome en Windows y lista todos los perfiles y correos de usuario disponibles (para configurar env.account), indicando cuál está activo.',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'flow_launch_chrome',
        description: 'Abre directamente Google Chrome en la cuenta o perfil especificado (evitando el modal "¿Qué perfil de Chrome quieres usar?") y navega a la app deseada (Flow, Gemini o Vids) con la extensión conectada.',
        inputSchema: {
            type: 'object',
            properties: {
                account: { type: 'string', description: 'Correo de Google (ej. "cutecathardsennin@gmail.com", "hardynhuanca@gmail.com") o nombre de perfil ("black", "cutecat2047", "Big dady")' },
                targetApp: { type: 'string', enum: ['flow', 'gemini', 'vids'], default: 'flow', description: 'Aplicación a abrir' }
            }
        }
    },
    {
        name: 'flow_list_models',
        description: 'Devuelve el catálogo de todos los modelos y motores disponibles en la extensión: Generadores de imagen (Flow Imagen 3, Gemini Imagen 3, Google Images, Google Vids) y Vídeo (Flow Veo 3: Omni 1.1 Flash, Veo 3.1 Fast, Veo 3 Quality; Gemini Omni Video / Veo; Google Vids Veo 3) con sus aspectos ratios y modos de ingredientes.',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'flow_add_ingredient',
        description: 'Registra un ingrediente (personaje, objeto, locación o estilo visual) con su @Tag y su imagen de referencia (ruta local en disco, URL o Base64) para que Flow, Gemini y Vids lo reconozcan y mantengan consistencia.',
        inputSchema: {
            type: 'object',
            required: ['tag'],
            properties: {
                tag: { type: 'string', description: 'Etiqueta única del ingrediente (ej. "@carlos", "@castillo_misterioso", "@reloj_dorado")' },
                name: { type: 'string', description: 'Nombre descriptivo del personaje u objeto' },
                type: { type: 'string', enum: ['character', 'location', 'prop', 'style'], default: 'character', description: 'Tipo de entidad' },
                image: { type: 'string', description: 'Ruta de archivo local en disco (ej. "C:\\fotos\\carlos.png" o "workspace-assets\\carlos.png"), URL HTTP o base64 DataURL' },
                description: { type: 'string', description: 'Descripción física o ancla visual del ingrediente' }
            }
        }
    },
    {
        name: 'flow_generate_image',
        description: 'Genera una imagen ultra realista o estilizada con Google Flow (Imagen 3), Google Gemini o Google Vids, controlando la relación de aspecto (9:16, 16:9, 1:1, 4:3, 3:4) y adjuntando ingredientes/personajes (@Tag).',
        inputSchema: {
            type: 'object',
            required: ['prompt'],
            properties: {
                prompt: { type: 'string', description: 'Prompt descriptivo para generar la imagen' },
                engine: { type: 'string', enum: ['flow', 'gemini', 'vids', 'google_images'], default: 'flow', description: 'Motor generador de imagen: flow (Google Flow Imagen 3), gemini (Google Gemini Imagen 3), vids (Google Vids), google_images (Búsqueda/Nano)' },
                aspectRatio: { type: 'string', enum: ['9:16', '16:9', '1:1', '4:3', '3:4'], default: '9:16', description: 'Relación de aspecto de la imagen' },
                ingredients: {
                    type: 'array',
                    description: 'Ingredientes o personajes de referencia: array de objetos [{ tag: "@carlos", name: "Carlos", image: "ruta/o/base64" }] o strings con tags ya registrados'
                },
                style: { type: 'string', description: 'Estilo visual opcional (ej. "cinemático 35mm", "anime 3d", "hiperrealista")' },
                negativePrompt: { type: 'string', description: 'Prompt negativo opcional' },
                account: { type: 'string', description: 'Cuenta/correo o perfil de Chrome a usar' },
                sceneIndex: { type: 'number', default: 0, description: 'Índice de escena opcional' }
            }
        }
    },
    {
        name: 'flow_generate_video',
        description: 'Genera un vídeo con Google Flow (Veo 3), Google Gemini (Omni Video / Veo) o Google Vids (Veo 3). Soporta modo ingredientes (genera directo desde texto + personajes @Tag sin imagen base) o modo fotogramas (anima una imagen base), aspectos 9:16, 16:9, 1:1, duraciones 4s/8s y calidades 360p/720p con máx. 3 intentos inteligentes.',
        inputSchema: {
            type: 'object',
            required: ['prompt'],
            properties: {
                prompt: { type: 'string', description: 'Prompt descriptivo de animación, movimiento de cámara y acción' },
                engine: { type: 'string', enum: ['flow', 'gemini_omni', 'vids'], default: 'flow', description: 'Motor de vídeo: flow (Flow Veo 3), gemini_omni (Gemini Omni Video / Veo), vids (Google Vids Veo 3)' },
                videoMode: { type: 'string', enum: ['ingredients', 'frames'], default: 'ingredients', description: '"ingredients" (crea vídeo directo a partir de texto y personajes @Tag sin requerir imagen previa) o "frames" (anima una imagen previa)' },
                modelFamily: { type: 'string', enum: ['Omni 1.1 Flash', 'Veo 3.1 Fast', 'Veo 3 Quality'], default: 'Omni 1.1 Flash', description: 'Familia de modelo de Flow/Veo 3' },
                aspectRatio: { type: 'string', enum: ['9:16', '16:9', '1:1'], default: '9:16', description: 'Relación de aspecto: 9:16 (vertical para TikTok/Reels/Shorts), 16:9 (horizontal), 1:1' },
                duration: { type: 'string', enum: ['4s', '8s'], default: '8s', description: 'Duración del clip (4s u 8s)' },
                resolution: { type: 'string', enum: ['360p', '720p'], default: '720p', description: 'Resolución: 360p (más rápido) o 720p (alta calidad)' },
                outputsCount: { type: 'string', enum: ['x1', 'x2', 'x4'], default: 'x1', description: 'Número de salidas generadas' },
                baseImage: { type: 'string', description: 'Ruta local en disco, URL o base64 de la imagen inicial a animar (usado en modo "frames")' },
                ingredients: { type: 'array', description: 'Ingredientes o personajes @Tag a asociar en la escena' },
                account: { type: 'string', description: 'Cuenta/correo o perfil de Chrome a usar' },
                sceneIndex: { type: 'number', default: 0, description: 'Índice de escena opcional' }
            }
        }
    },
    {
        name: 'flow_get_master_prompt',
        description: 'Obtiene el Master Prompt EXACTO de scriptGenerator.js (incluyendo TEMPLATE_CONFIGS, VIRAL_NICHES, NARRATIVE_PARADIGMS_CONFIG, Biblia Vocal y Biblia de Serie) para que Antigravity redacte el guion JSON.',
        inputSchema: {
            type: 'object',
            properties: {
                theme: { type: 'string', description: 'Tema o idea central del video' },
                template: { type: 'string', description: 'Plantilla visual' },
                sceneCount: { type: 'number', description: 'Número de escenas de ~8s' },
                duration: { type: 'number', description: 'Duración total en segundos' },
                aspectRatio: { type: 'string', enum: ['9:16', '16:9', '1:1'] },
                viralNiche: { type: 'string' },
                narrativeParadigm: { type: 'string' },
                isSerieMode: { type: 'boolean' }
            }
        }
    },
    {
        name: 'flow_autoconfig_project',
        description: 'Autoconfigura todos los selectores, toggles, relación de aspecto (9:16 o 16:9), plantilla y límites de reintentos (máx. 3 intentos por escena) en la extensión.',
        inputSchema: {
            type: 'object',
            properties: {
                theme: { type: 'string' },
                template: { type: 'string' },
                aspectRatio: { type: 'string', enum: ['9:16', '16:9', '1:1'] },
                sceneCount: { type: 'number' },
                duration: { type: 'number' },
                consistenciaPersonajes: { type: 'boolean' },
                directVideoChars: { type: 'boolean' },
                chainSceneFrames: { type: 'boolean' },
                chainSceneVideos: { type: 'boolean' }
            }
        }
    },
    {
        name: 'flow_inject_storyboard',
        description: 'Inyecta el guion JSON (currentStoryboard) redactado por Antigravity con el Master Prompt dentro de la extensión, aplicando Biblia Vocal, Biblia de Serie, tarjetas @Tag y renderizado del tablero.',
        inputSchema: {
            type: 'object',
            required: ['storyboard'],
            properties: {
                storyboard: { type: 'object', description: 'Objeto JSON completo del storyboard (personajes, hero_assets, escenas, socialMetadata)' },
                settings: { type: 'object', description: 'Opciones de autoconfiguración (template, aspectRatio, etc.)' }
            }
        }
    },
    {
        name: 'flow_edit_storyboard',
        description: 'Edita quirúrgicamente escenas, diálogos, cámara, prompts o personajes en la extensión cuando al usuario no le gusta algo, y opcionalmente regenera solo las imágenes o vídeos modificados en la misma sesión.',
        inputSchema: {
            type: 'object',
            properties: {
                sceneEdits: { type: 'array', description: 'Lista de ediciones por escena ({ index, prompt, animPrompt, dialogos, camara, accion })' },
                characterEdits: { type: 'array', description: 'Lista de ediciones de personajes ({ tag, prompt, descripcion, ancla_visual })' },
                regenerateImages: { type: 'boolean' },
                regenerateVideos: { type: 'boolean' },
                regenerateCharacters: { type: 'boolean' }
            }
        }
    },
    {
        name: 'flow_regenerate_scene_image',
        description: 'Regenera la imagen de una escena específica en la MISMA sesión con un máximo estricto de 3 intentos y ajuste automático de prompt si hay bloqueo.',
        inputSchema: {
            type: 'object',
            required: ['sceneIndex'],
            properties: {
                sceneIndex: { type: 'number', description: 'Índice base 0 de la escena (0 para Escena 1)' },
                customPrompt: { type: 'string', description: 'Nuevo prompt ajustado opcional' }
            }
        }
    },
    {
        name: 'flow_regenerate_scene_video',
        description: 'Regenera el vídeo de una escena específica en la MISMA sesión con un máximo estricto de 3 intentos y ajuste automático de prompt si hay fallo.',
        inputSchema: {
            type: 'object',
            required: ['sceneIndex'],
            properties: {
                sceneIndex: { type: 'number', description: 'Índice base 0 de la escena (0 para Escena 1)' },
                customAnimPrompt: { type: 'string', description: 'Nuevo animPrompt ajustado opcional' }
            }
        }
    },
    {
        name: 'flow_run_full_pipeline',
        description: 'Orquesta la producción completa de principio a fin en la extensión (Inyección JSON -> Personajes @Tag -> Imágenes -> Vídeos con máx. 3 intentos -> Render Nativo). NUNCA usa HyperFrames ni Remotion salvo que el usuario lo pida explícitamente.',
        inputSchema: {
            type: 'object',
            properties: {
                storyboard: { type: 'object' },
                settings: { type: 'object' },
                skipCharacters: { type: 'boolean' },
                skipSceneImages: { type: 'boolean' },
                skipSceneVideos: { type: 'boolean' },
                skipNativeRender: { type: 'boolean' }
            }
        }
    },
    {
        name: 'flow_get_project_state',
        description: 'Obtiene el estado en vivo del proyecto en la extensión (escenas listas, vídeos generados, errores de escenas fallidas, rutas de archivos MP4 descargados).',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'flow_export_assets_to_disk',
        description: 'Exporta y guarda en disco todos los vídeos MP4, imágenes PNG, personajes y storyboard.json generados en la extensión. Solo sincroniza con hyperframes o remotion si editorMode lo indica explícitamente.',
        inputSchema: {
            type: 'object',
            properties: {
                projectSlug: { type: 'string' },
                editorMode: { type: 'string', enum: ['native', 'hyperframes', 'remotion'], default: 'native' },
                overwriteOriginals: { type: 'boolean' }
            }
        }
    },
    {
        name: 'flow_render_edited_in_cloud',
        description: 'Sube los clips editados con Remotion o HyperFrames de vuelta a la extensión y lanza el renderizado final en la nube conservando los clips originales intactos.',
        inputSchema: {
            type: 'object',
            required: ['editedScenes'],
            properties: {
                projectSlug: { type: 'string' },
                editorMode: { type: 'string', enum: ['hyperframes', 'remotion'] },
                title: { type: 'string' },
                editedScenes: {
                    type: 'array',
                    description: 'Lista de escenas editadas [{ sceneIndex: 0, filePath: "ruta/al/video_editado.mp4" }]'
                }
            }
        }
    },
    {
        name: 'flow_cancel_all',
        description: 'Detiene y cancela inmediatamente cualquier generación o render activo en la extensión.',
        inputSchema: { type: 'object', properties: {} }
    }
];

export async function invokeMcpTool(name, args = {}) {
    switch (name) {
        case 'flow_status':
            return await callBridge('/status', 'GET');
        case 'flow_list_accounts':
            return await callBridge('/list-accounts', 'GET');
        case 'flow_launch_chrome':
            return await callBridge('/launch-chrome', 'POST', args);
        case 'flow_list_models':
            return await callBridge('/list-models', 'GET');
        case 'flow_add_ingredient':
            return await callBridge('/add-ingredient', 'POST', args);
        case 'flow_generate_image':
            return await callBridge('/generate-image', 'POST', args);
        case 'flow_generate_video':
            return await callBridge('/generate-video', 'POST', args);
        case 'flow_get_master_prompt':
            return await callBridge('/master-prompt', 'POST', args);
        case 'flow_autoconfig_project':
            return await callBridge('/command', 'POST', { command: 'autoconfig_project', params: args });
        case 'flow_inject_storyboard':
            return await callBridge('/command', 'POST', { command: 'inject_storyboard', params: args });
        case 'flow_edit_storyboard':
            return await callBridge('/command', 'POST', { command: 'edit_storyboard', params: args });
        case 'flow_regenerate_scene_image':
            return await callBridge('/command', 'POST', { command: 'regenerate_scene_image', params: args });
        case 'flow_regenerate_scene_video':
            return await callBridge('/command', 'POST', { command: 'regenerate_scene_video', params: args });
        case 'flow_run_full_pipeline':
            return await callBridge('/command', 'POST', { command: 'run_full_pipeline', params: args });
        case 'flow_get_project_state':
            return await callBridge('/command', 'POST', { command: 'get_project_state', params: args });
        case 'flow_export_assets_to_disk':
            return await callBridge('/export-to-disk', 'POST', args);
        case 'flow_render_edited_in_cloud':
            return await callBridge('/render-edited-in-cloud', 'POST', args);
        case 'flow_cancel_all':
            return await callBridge('/command', 'POST', { command: 'cancel_all', params: {} });
        default:
            throw new Error(`Herramienta MCP desconocida: ${name}`);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    ensureBridgeRunning();
    const rl = readline.createInterface({ input: process.stdin, terminal: false });

    const sendRpc = (obj) => {
        process.stdout.write(JSON.stringify(obj) + '\n');
    };

    rl.on('line', async (line) => {
        if (!line.trim()) return;
        let req;
        try {
            req = JSON.parse(line);
        } catch (e) {
            return;
        }

        const { id, method, params } = req;
        try {
            if (method === 'initialize') {
                sendRpc({
                    jsonrpc: '2.0',
                    id,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: { tools: {} },
                        serverInfo: { name: 'flow-veo3-mcp', version: '1.1.0' }
                    }
                });
            } else if (method === 'notifications/initialized') {
                // Sin respuesta
            } else if (method === 'tools/list') {
                sendRpc({
                    jsonrpc: '2.0',
                    id,
                    result: { tools: MCP_TOOLS }
                });
            } else if (method === 'tools/call') {
                const toolRes = await invokeMcpTool(params.name, params.arguments || {});
                sendRpc({
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [{ type: 'text', text: JSON.stringify(toolRes, null, 2) }]
                    }
                });
            } else if (id !== undefined) {
                sendRpc({
                    jsonrpc: '2.0',
                    id,
                    result: {}
                });
            }
        } catch (err) {
            if (id !== undefined) {
                sendRpc({
                    jsonrpc: '2.0',
                    id,
                    error: { code: -32000, message: err?.message || String(err) }
                });
            }
        }
    });
}

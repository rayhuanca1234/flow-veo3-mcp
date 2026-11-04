// flow-veo3-mcp/masterPromptLocal.js
// Obtiene el Master Prompt de la extensión AI Auto-Prompt:
//   1. Si existe localmente "extension para flow-veo3/modules/scriptGenerator.js", lo ejecuta en <50ms.
//   2. En la PC de cualquier otro usuario, se lo pide en vivo por WebSocket a la extensión de Chrome conectada.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const memoryStorage = new Map();

if (typeof globalThis.localStorage === 'undefined') {
    globalThis.localStorage = {
        getItem: (k) => (memoryStorage.has(k) ? memoryStorage.get(k) : null),
        setItem: (k, v) => memoryStorage.set(k, String(v)),
        removeItem: (k) => memoryStorage.delete(k)
    };
}

if (typeof globalThis.chrome === 'undefined') {
    globalThis.chrome = {
        storage: {
            local: {
                get: (keys, cb) => {
                    const res = {};
                    if (cb) cb(res);
                    return Promise.resolve(res);
                },
                set: (obj, cb) => {
                    if (cb) cb();
                    return Promise.resolve();
                },
                remove: (keys, cb) => {
                    if (cb) cb();
                    return Promise.resolve();
                }
            }
        },
        runtime: {
            sendMessage: () => Promise.resolve(),
            onMessage: { addListener: () => {} },
            getURL: (p) => p
        },
        tabs: {
            query: (_, cb) => cb && cb([])
        }
    };
}

if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        getElementById: (id) => {
            if (id === 'flowRatio' || id === 'modalFlowRatio') {
                return { value: memoryStorage.get('flowRatio') || '9:16' };
            }
            return null;
        },
        querySelector: (sel) => {
            if (sel && sel.includes('.tmpl-card')) {
                const tmpl = memoryStorage.get('selectedTmpl') || 'Anime 3D Cinemático';
                return {
                    getAttribute: () => tmpl,
                    dataset: { tmpl },
                    textContent: tmpl
                };
            }
            return null;
        },
        querySelectorAll: () => [],
        createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false } }),
        addEventListener: () => {}
    };
}

if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
    globalThis.window.addEventListener = () => {};
    globalThis.window.dispatchEvent = () => {};
}

if (typeof globalThis.navigator === 'undefined') {
    globalThis.navigator = { language: 'es-ES' };
}

let _scriptGenModule = null;

async function loadScriptGenerator() {
    if (_scriptGenModule) return _scriptGenModule;

    const candidates = [
        path.resolve(process.cwd(), 'extension para flow-veo3', 'modules', 'scriptGenerator.js'),
        path.resolve(__dirname, '..', 'extension para flow-veo3', 'modules', 'scriptGenerator.js'),
        path.resolve(__dirname, '..', '..', 'extension para flow-veo3', 'modules', 'scriptGenerator.js')
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            _scriptGenModule = await import(pathToFileURL(candidate).href);
            return _scriptGenModule;
        }
    }
    return null;
}

export async function generateMasterPromptLocally(params = {}, sendCommandToExtensionFn = null) {
    const mod = await loadScriptGenerator();
    if (!mod) {
        if (typeof sendCommandToExtensionFn === 'function') {
            return await sendCommandToExtensionFn('get_master_prompt', params, 30000);
        }
        throw new Error('Abre Google Chrome con la extensión AI Auto-Prompt activa para consultar el Master Prompt en vivo.');
    }

    const { buildSystemPrompt, TEMPLATE_CONFIGS, VIRAL_NICHES, NARRATIVE_PARADIGMS_CONFIG } = mod;

    const templateName = params.template || 'Anime 3D Cinemático';
    const aspectRatio = params.aspectRatio || params.ratio || '9:16';
    memoryStorage.set('selectedTmpl', templateName);
    memoryStorage.set('flowRatio', aspectRatio);

    const count = Number(params.sceneCount || params.count) || (params.duration ? Math.max(1, Math.round(Number(params.duration) / 8)) : 5);
    const duration = Number(params.duration) || (count * 8);
    const style = params.style || TEMPLATE_CONFIGS[templateName]?.styleBlock || '';

    const systemPrompt = buildSystemPrompt({
        theme: params.theme || 'Historia original',
        count,
        totalEscenasSerie: Number(params.totalEscenasSerie) || (count * 5),
        totalCapitulosSerie: Number(params.totalCapitulosSerie) || 5,
        isSerieMode: Boolean(params.isSerieMode),
        style,
        character: params.character || '',
        languageName: params.languageName || 'español',
        consistenciaActiva: params.consistenciaActiva !== false,
        animarVideosChk: { checked: true },
        animarModoVal: params.animarModo || 'mixto',
        useNotebookPrompt: false,
        attachedFiles: [],
        continuidadTimestamp: params.continuidadTimestamp !== false,
        minWordsPerScene: Number(params.minWordsPerScene) || 15,
        maxWordsPerScene: Number(params.maxWordsPerScene) || 25,
        directVideoChars: Boolean(params.directVideoChars),
        aspectRatio,
        nativeSubtitles: Boolean(params.nativeSubtitles),
        nativeSubTheme: params.nativeSubTheme || 'hormozi',
        viralNiche: params.viralNiche || 'none',
        narrativeParadigm: params.narrativeParadigm || 'omni_mixto',
        isRandomTopic: Boolean(params.isRandomTopic),
        targetDuration: duration,
        seriesChapterNum: Number(params.seriesChapterNum) || 1
    });

    return {
        ok: true,
        source: 'local_scriptGenerator_module',
        template: templateName,
        sceneCount: count,
        durationSeconds: duration,
        aspectRatio,
        styleBlock: style,
        systemPrompt,
        availableTemplates: Object.keys(TEMPLATE_CONFIGS),
        availableViralNiches: Object.keys(VIRAL_NICHES || {}),
        availableNarrativeParadigms: Object.keys(NARRATIVE_PARADIGMS_CONFIG || {})
    };
}

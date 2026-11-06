// =====================================================================================
// modules/mcpOrchestrator.js — Puente MCP + Orquestador + Editor Autónomo para Antigravity
// -------------------------------------------------------------------------------------
// Conecta la extensión AI Auto-Prompt (Flow / Veo 3 / Gemini / ChatGPT / Vids / Facereels)
// con el servidor MCP local (ws://127.0.0.1:3847) para que Antigravity actúe como:
//   1. Motor Generador de Guion JSON (usando el 100% del Master Prompt de scriptGenerator.js)
//   2. Orquestador de Producción (Personajes @Tag -> Imágenes -> Vídeos Veo 3 -> Render Nativo)
//   3. Gestor Inteligente de Reintentos (Máx. 3 intentos en la MISMA sesión con ajuste de prompt)
//   4. Editor en Vivo (edición quirúrgica de escenas, diálogos, cámaras o personajes)
//   5. Exportador de Assets (solo envía clips a HyperFrames/Remotion cuando el usuario lo pide)
// =====================================================================================

import {
    generateStory,
    uploadAndGenerateCharactersWithFlowReference,
    buildSystemPrompt,
    TEMPLATE_CONFIGS,
    VIRAL_NICHES,
    NARRATIVE_PARADIGMS_CONFIG
} from './scriptGenerator.js';
import {
    startProduction,
    startProductionFrameChain,
    animateAllScenes,
    retryFailedVideos,
    generateAllCharacters,
    showToastNotification,
    cancelRunAll,
    cancelAnimateAll,
    cancelFrameChain,
    cancelGenerateCharacters
} from './productionController.js';
import {
    ensureFlowTabIsActive,
    ensureGeminiTabIsOpen,
    applySettingsToPage,
    generateSceneImageAsync,
    runAnimationSequence,
    generateCharacterAsync
} from './flowController.js';
import {
    generateSingleSceneWithGeminiVideo
} from './geminiVideoController.js';
import {
    ensureVidsTabIsActive,
    exportSingleSceneToVids,
    saveAndTriggerVids
} from './googleVidsExporter.js';
import {
    renderStoryboard,
    buildStandardAnimPrompt,
    buildDirectVideoPrompt
} from './domUtils.js';
import {
    renderBackend,
    generarVozOffBackend,
    cancelarRenderActivo,
    getBackendServerUrl
} from './backendManager.js';
import {
    getGenerationTimeouts,
    saveGenerationTimeouts
} from './generationTimeouts.js';
import {
    requestPipelineKeepAwake,
    releasePipelineKeepAwake
} from './powerManager.js';

const MCP_WS_URL = 'ws://127.0.0.1:3847/ws?role=orchestrator';
const MAX_TOTAL_ATTEMPTS = 3; // Regla dura: Intento 1 (original) + máx. 2 reintentos con ajuste de prompt = 3 intentos máx.

let _domElements = null;
let _ws = null;
let _wsReconnectTimer = null;

// Mapa de palabras sensibles -> alternativas cinemáticas seguras para suavizado automático en la misma sesión
const SAFE_PROMPT_REPLACEMENTS = [
    [/\b(sangre|blood|bloody|bleeding|gore|hemorragia)\b/gi, 'contraste dramático carmesí e iluminación intensa'],
    [/\b(matar|asesinar|kill|murder|dead|cadáver|corpse|muerte|죽|suicidio|suicide)\b/gi, 'confrontación dramática de alta tensión emocional'],
    [/\b(arma|pistola|cuchillo|gun|rifle|knife|weapon|shoot|disparar|balazo|puñalada)\b/gi, 'objeto metálico brillante en plano detalle tenso'],
    [/\b(golpear|pegar|puñetazo|bofetada|punch|slap|hit|beat|fight|pelea violenta)\b/gi, 'encararse con gesto enérgico e impacto dramático de cámara'],
    [/\b(desnudo|desnuda|nude|naked|sexy|erótico|sensual|lingerie|bikini)\b/gi, 'vestuario elegante de gala de alta costura'],
    [/\b(explosión|bomba|explosion|bomb|terrorismo|ataque)\b/gi, 'destello lumínico volumétrico con partículas cinemáticas'],
    [/\b(droga|drogas|cocaína|heroína|veneno|poison|drugs|overdose)\b/gi, 'sustancia misteriosa en frasco de cristal bajo luz cenital'],
    [/\b(niño llorando|abuso|tortura|secuestro|kidnap|abuse|torture)\b/gi, 'escena dramática de suspenso psicológico con sombras profundas']
];

/**
 * Ajusta un prompt (imagen o video) según el nivel de reintento (Intento 2 o Intento 3)
 * conservando los @personajes, @entornos y la esencia narrativa en la MISMA sesión.
 */
export function adjustPromptForRetry(originalPrompt, attemptNumber = 2, errorReason = '') {
    let adjusted = String(originalPrompt || '').trim();
    if (!adjusted) return adjusted;

    // Nivel 1 (Intento 2): Suavizado semántico de términos sensibles/políticas + limpieza de ruido
    SAFE_PROMPT_REPLACEMENTS.forEach(([regex, replacement]) => {
        adjusted = adjusted.replace(regex, replacement);
    });

    if (attemptNumber === 2) {
        // Asegurar directiva de seguridad visual manteniendo @Tags y estructura
        if (!adjusted.includes('cinematic PG-13 dramatic lighting')) {
            adjusted = `${adjusted} — Safe cinematic PG-13 dramatic staging, high production quality, expressive acting.`;
        }
    } else if (attemptNumber >= 3) {
        // Nivel 2 (Intento 3 - Último intento permitido): Simplificación estructural conservando @Tags y diálogo esencial
        const tags = adjusted.match(/@[a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]+/g) || [];
        const uniqueTags = Array.from(new Set(tags));
        const scenePrefixMatch = adjusted.match(/^(escena-\d+:)/i);
        const prefix = scenePrefixMatch ? `${scenePrefixMatch[1]} ` : '';

        // Extraer bloque de diálogo si existe para no perder el lip-sync
        const dialogMatch = adjusted.match(/(🗣️\s*DIÁLOGO:[\s\S]*?)(?=🎭\s*GUION|$)/i);
        const dialogPart = dialogMatch ? dialogMatch[1].trim() : '';

        // Simplificar descripción visual a plano limpio y seguro
        let coreVisual = adjusted
            .replace(/(🗣️\s*DIÁLOGO:[\s\S]*)/i, '')
            .replace(/\[ESTILO:[^\]]*\]/gi, '')
            .trim();
        if (coreVisual.length > 320) {
            coreVisual = coreVisual.substring(0, 320) + '...';
        }

        const tagsStr = uniqueTags.length > 0 ? `${uniqueTags.join(' ')} ` : '';
        adjusted = `${prefix}${tagsStr}${coreVisual}. Medium cinematic shot, clean lighting, expressive natural movement, family-safe dramatic television look.${dialogPart ? `\n\n${dialogPart}` : ''}`.trim();
    }

    console.log(`🛡️ [MCP Retry Adjuster] Prompt ajustado para Intento ${attemptNumber}/${MAX_TOTAL_ATTEMPTS} (motivo: ${errorReason || 'fallo/timeout'}):`, adjusted.substring(0, 160));
    return adjusted;
}

/**
 * Envía telemetría de progreso al servidor MCP en tiempo real
 */
function emitMcpEvent(event, data = {}) {
    try {
        if (_ws && _ws.readyState === WebSocket.OPEN) {
            _ws.send(JSON.stringify({
                type: 'event',
                event,
                timestamp: new Date().toISOString(),
                data
            }));
        }
    } catch (e) { }
}

/**
 * 1. OBTENER EL MASTER PROMPT EXACTO DE LA EXTENSIÓN
 */
export async function handleGetMasterPrompt(params = {}) {
    const templateName = params.template || localStorage.getItem('selectedTmpl') || 'Anime 3D Cinemático';
    // Sincronizar temporalmente la plantilla si se pidió una específica
    const prevTmpl = localStorage.getItem('selectedTmpl');
    if (params.template) {
        try { localStorage.setItem('selectedTmpl', params.template); } catch (e) { }
    }

    const count = Number(params.sceneCount || params.count) || (params.duration ? Math.max(1, Math.round(Number(params.duration) / 8)) : 6);
    const duration = Number(params.duration) || (count * 8);
    const aspectRatio = params.aspectRatio || params.ratio || document.getElementById('flowRatio')?.value || '9:16';

    const sysPrompt = buildSystemPrompt({
        theme: params.theme || 'Historia original',
        count,
        totalEscenasSerie: Number(params.totalEscenasSerie) || (count * 5),
        totalCapitulosSerie: Number(params.totalCapitulosSerie) || 5,
        isSerieMode: Boolean(params.isSerieMode),
        style: params.style || TEMPLATE_CONFIGS[templateName]?.styleBlock || '',
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

    if (params.template && prevTmpl) {
        try { localStorage.setItem('selectedTmpl', prevTmpl); } catch (e) { }
    }

    return {
        ok: true,
        template: templateName,
        sceneCount: count,
        durationSeconds: duration,
        aspectRatio,
        systemPrompt: sysPrompt,
        availableTemplates: Object.keys(TEMPLATE_CONFIGS),
        availableViralNiches: Object.keys(VIRAL_NICHES || {}),
        availableNarrativeParadigms: Object.keys(NARRATIVE_PARADIGMS_CONFIG || {})
    };
}

/**
 * 2. AUTOCONFIGURAR TODOS LOS CONTROLES DE LA EXTENSIÓN
 */
export async function handleAutoconfigProject(settings = {}) {
    const {
        theme,
        template,
        style,
        character,
        aspectRatio = '9:16',
        sceneCount,
        duration,
        viralNiche,
        narrativeParadigm,
        animarModo = 'mixto',
        consistenciaPersonajes = true,
        directVideoChars = document.getElementById('boardDirectVideoCharsChk')?.checked ?? document.getElementById('directVideoCharsChk')?.checked ?? (localStorage.getItem('directVideoChars') !== 'false'),
        chainSceneFrames = document.getElementById('boardChainFramesChk')?.checked ?? document.getElementById('chainSceneFramesChk')?.checked ?? false,
        chainSceneVideos = document.getElementById('boardChainVideosChk')?.checked ?? document.getElementById('chainSceneVideosChk')?.checked ?? false,
        videoGeneratorSource = 'flow',
        imageGeneratorSource = 'flow',
        maxRetryRounds = 2, // 1 intento inicial + 2 rondas de reintento = 3 intentos totales máx.
        imageWaitSec = 120,
        videoRenderMin = 5,
        videoQueueMin = 8
    } = settings;

    // 1. Guardar límites estrictos de reintentos y timeouts (jamás bucle infinito)
    const boundedRetries = Math.min(2, Math.max(1, Number(maxRetryRounds) || 2));
    saveGenerationTimeouts({
        videoRetryRounds: boundedRetries,
        imageWaitSec: Number(imageWaitSec) || 120,
        videoRenderMin: Number(videoRenderMin) || 5,
        videoQueueMin: Number(videoQueueMin) || 8
    });

    // 2. Plantilla de estilo (TEMPLATE_CONFIGS)
    if (template) {
        try { localStorage.setItem('selectedTmpl', template); } catch (e) { }
        await chrome.storage.local.set({ selectedTmpl: template });
        const tmplCards = document.querySelectorAll('.tmpl-card');
        tmplCards.forEach(c => {
            const name = c.getAttribute('data-tmpl') || c.dataset.tmpl || c.textContent?.trim();
            if (name === template) {
                c.classList.add('selected', 'active');
            } else {
                c.classList.remove('selected', 'active');
            }
        });
    }

    const effectiveStyle = style || (template && TEMPLATE_CONFIGS[template]?.styleBlock) || '';
    const computedCount = sceneCount
        ? Number(sceneCount)
        : (duration ? Math.max(1, Math.round(Number(duration) / 8)) : 5);
    const computedDuration = duration ? Number(duration) : (computedCount * 8);

    // 3. Actualizar inputs del DOM en popup.html
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && val !== undefined && val !== null) {
            el.value = String(val);
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };
    const setChk = (id, val) => {
        const el = document.getElementById(id);
        if (el && val !== undefined && val !== null) {
            el.checked = Boolean(val);
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    };

    if (theme !== undefined) {
        setVal('masterScript', theme);
        setVal('storyTheme', theme);
    }
    if (effectiveStyle) setVal('storyStyle', effectiveStyle);
    if (character !== undefined) setVal('storyCharacter', character);
    setVal('flowRatio', aspectRatio);
    setVal('modalFlowRatio', aspectRatio);
    setVal('sceneCount', computedCount);
    setVal('quickStoryDuration', computedDuration);
    setVal('storyDuration', computedDuration);
    if (viralNiche) setVal('geminiNicheSelect', viralNiche);
    if (narrativeParadigm) {
        setVal('composerNarrativeParadigm', narrativeParadigm);
        setVal('narrativeParadigm', narrativeParadigm);
    }
    if (animarModo) setVal('animarModo', animarModo);
    if (videoGeneratorSource) {
        setVal('videoGeneratorSource', videoGeneratorSource);
        setVal('modalVideoGeneratorSource', videoGeneratorSource);
        setVal('composerVideoGeneratorSource', videoGeneratorSource);
    }
    if (imageGeneratorSource) {
        setVal('imageGeneratorSource', imageGeneratorSource);
        setVal('modalImageGeneratorSource', imageGeneratorSource);
        setVal('composerImageGeneratorSource', imageGeneratorSource);
    }

    setChk('consistenciaPersonajes', consistenciaPersonajes);
    setChk('configConsistenciaPersonajes', consistenciaPersonajes);
    setChk('animarVideos', true);
    setChk('directVideoCharsChk', directVideoChars);
    setChk('boardDirectVideoCharsChk', directVideoChars);
    setChk('chainSceneFramesChk', chainSceneFrames);
    setChk('boardChainFramesChk', chainSceneFrames);
    setChk('chainSceneVideosChk', chainSceneVideos);
    setChk('boardChainVideosChk', chainSceneVideos);

    // 4. Persistir en chrome.storage.local y localStorage
    const storagePatch = {
        ...(theme !== undefined ? { storyTheme: theme } : {}),
        ...(effectiveStyle ? { storyStyle: effectiveStyle } : {}),
        ...(character !== undefined ? { storyCharacter: character } : {}),
        flowRatio: aspectRatio,
        geminiImageAspectRatio: aspectRatio,
        geminiVideoAspectRatio: aspectRatio === '9:16' ? '9:16' : '16:9',
        sceneCount: computedCount,
        storyDuration: computedDuration,
        wfOutputRenderSceneOrder: Array.from({ length: computedCount }, (_, idx) => idx),
        consistenciaPersonajes: Boolean(consistenciaPersonajes),
        directVideoChars: Boolean(directVideoChars),
        chainSceneFrames: Boolean(chainSceneFrames),
        chainSceneVideos: Boolean(chainSceneVideos),
        animarVideos: true,
        animarModo: animarModo || 'mixto',
        ...(videoGeneratorSource ? { videoGeneratorSource } : {}),
        ...(imageGeneratorSource ? { imageGeneratorSource } : {}),
        ...(viralNiche ? { selectedViralNiche: viralNiche } : {}),
        ...(narrativeParadigm ? { selectedNarrativeParadigm: narrativeParadigm } : {})
    };
    await chrome.storage.local.set(storagePatch);
    Object.entries(storagePatch).forEach(([k, v]) => {
        try { localStorage.setItem(k, typeof v === 'object' ? JSON.stringify(v) : String(v)); } catch (e) { }
    });

    emitMcpEvent('project_autoconfigured', {
        template,
        aspectRatio,
        sceneCount: computedCount,
        duration: computedDuration,
        maxTotalAttempts: MAX_TOTAL_ATTEMPTS
    });

    return {
        ok: true,
        configured: {
            template: template || localStorage.getItem('selectedTmpl') || 'default',
            aspectRatio,
            sceneCount: computedCount,
            duration: computedDuration,
            consistenciaPersonajes: Boolean(consistenciaPersonajes),
            directVideoChars: Boolean(directVideoChars),
            maxTotalAttemptsPerScene: MAX_TOTAL_ATTEMPTS
        }
    };
}

/**
 * 3. INYECTAR GUION JSON (CREADO CON EL MASTER PROMPT) Y PROCESARLO EN LA EXTENSIÓN
 */
export async function handleInjectStoryboard({ storyboard, settings = {} }) {
    if (!storyboard || !Array.isArray(storyboard.escenas) || storyboard.escenas.length === 0) {
        throw new Error('El objeto storyboard debe incluir un array "escenas" con al menos 1 escena.');
    }

    // Autoconfigurar primero los controles con base en settings + metadata del storyboard
    await handleAutoconfigProject({
        theme: settings.theme || storyboard.titulo_proyecto || storyboard.socialMetadata?.titulo || 'Proyecto Antigravity',
        template: settings.template || storyboard.plantilla || localStorage.getItem('selectedTmpl'),
        style: settings.style || storyboard.estilo_visual || '',
        aspectRatio: settings.aspectRatio || storyboard.formato || '9:16',
        sceneCount: storyboard.escenas.length,
        duration: storyboard.escenas.length * 8,
        ...settings
    });

    const dom = _domElements || {
        storySettingsForm: document.getElementById('storySettingsForm'),
        sceneBoard: document.getElementById('sceneBoard'),
        scenesContainer: document.getElementById('scenesContainer'),
        masterScriptInput: document.getElementById('masterScript'),
        animarVideosChk: document.getElementById('animarVideos'),
        animarTodasBtn: document.getElementById('animarTodasBtn'),
        createCharsProductionBtn: document.getElementById('createCharsProductionBtn'),
        productionButtons: document.getElementById('productionButtons'),
        generateStoryBtn: document.getElementById('generateStoryBtn') || document.createElement('button')
    };

    const inputs = {
        apiKey: '',
        modelId: 'gemini_extension',
        modelLabel: 'Antigravity Master Prompt Engine',
        theme: settings.theme || storyboard.titulo_proyecto || 'Proyecto Antigravity',
        count: storyboard.escenas.length,
        duration: storyboard.escenas.length * 8,
        style: document.getElementById('storyStyle')?.value || settings.style || '',
        character: document.getElementById('storyCharacter')?.value || settings.character || '',
        viralNiche: settings.viralNiche || document.getElementById('geminiNicheSelect')?.value || 'none',
        narrativeParadigm: settings.narrativeParadigm || document.getElementById('composerNarrativeParadigm')?.value || 'omni_mixto',
        languageSelection: settings.language || 'es',
        consistenciaActiva: settings.consistenciaPersonajes !== false,
        animarModoVal: settings.animarModo || document.getElementById('animarModo')?.value || 'mixto',
        attachedImage: null,
        attachedFiles: [],
        useNotebookPrompt: false,
        uploadReferenceImages: false,
        continuidadTimestamp: true,
        minWordsPerScene: 15,
        maxWordsPerScene: 25,
        directVideoChars: Boolean(settings.directVideoChars ?? document.getElementById('boardDirectVideoCharsChk')?.checked ?? document.getElementById('directVideoCharsChk')?.checked ?? (localStorage.getItem('directVideoChars') !== 'false')),
        nativeSubtitles: Boolean(settings.nativeSubtitles),
        chainSceneFrames: Boolean(settings.chainSceneFrames ?? document.getElementById('boardChainFramesChk')?.checked ?? document.getElementById('chainSceneFramesChk')?.checked),
        chainSceneVideos: Boolean(settings.chainSceneVideos ?? document.getElementById('boardChainVideosChk')?.checked ?? document.getElementById('chainSceneVideosChk')?.checked),
        isSerieMode: Boolean(settings.isSerieMode),
        manualStoryboard: storyboard
    };

    // Limpiar vídeos capturados/fallidos previos de ejecuciones anteriores a menos que se pida conservarlos
    if (!settings.preserveExistingVideos) {
        await chrome.storage.local.set({
            capturedVideos: [],
            failedVideos: [],
            failedVideosErrors: {},
            runningVideos: [],
            runningVideosTimestamps: {}
        });
    }

    // Ejecuta generateStory con manualStoryboard para aplicar Biblia Vocal, Biblia de Serie,
    // calibración de duración/palabras, tarjetas de @Entidades y renderStoryboard en el DOM.
    await generateStory(dom, inputs);

    const stored = await chrome.storage.local.get(['currentStoryboard']);
    const processedSb = stored.currentStoryboard || storyboard;

    emitMcpEvent('storyboard_injected', {
        title: processedSb.titulo_proyecto || processedSb.socialMetadata?.titulo,
        scenesCount: processedSb.escenas?.length || 0,
        charactersCount: processedSb.personajes?.length || 0,
        heroAssetsCount: (processedSb.hero_assets || processedSb.assets_clave || []).length
    });

    return {
        ok: true,
        scenesCount: processedSb.escenas?.length || 0,
        characters: (processedSb.personajes || []).map(p => ({ tag: p.tag || p.id, nombre: p.nombre, rol: p.rol })),
        heroAssets: (processedSb.hero_assets || processedSb.assets_clave || []).map(a => ({ tag: a.tag || a.id, nombre: a.nombre, categoria: a.categoria })),
        storyboard: processedSb
    };
}

/**
 * 4. MODO EDITOR EN VIVO: Editar escenas, diálogos, prompts o personajes y regenerar selectivamente
 */
export async function handleEditStoryboard({
    sceneEdits = [],
    characterEdits = [],
    regenerateImages = false,
    regenerateVideos = false,
    regenerateCharacters = false
}) {
    const store = await chrome.storage.local.get(['currentStoryboard', 'capturedMedia', 'capturedVideos', 'charImages']);
    const sb = store.currentStoryboard;
    if (!sb || !Array.isArray(sb.escenas)) {
        throw new Error('No hay un storyboard activo en la extensión para editar.');
    }

    const editedSceneIndices = [];
    const editedCharTags = [];

    // 1. Aplicar ediciones a personajes / hero_assets
    if (Array.isArray(characterEdits) && characterEdits.length > 0) {
        characterEdits.forEach(edit => {
            const targetTag = String(edit.tag || edit.nombre || '').replace(/^@/, '').toLowerCase();
            const allEntities = [...(sb.personajes || []), ...(sb.hero_assets || sb.assets_clave || [])];
            const found = allEntities.find(p => {
                const pTag = String(p.tag || p.id || p.nombre || '').replace(/^@/, '').toLowerCase();
                return pTag === targetTag;
            });
            if (found) {
                if (edit.prompt) found.prompt = edit.prompt;
                if (edit.descripcion) found.descripcion = edit.descripcion;
                if (edit.ancla_visual) found.ancla_visual = edit.ancla_visual;
                if (edit.vestuario) found.vestuario = edit.vestuario;
                if (edit.perfil_vocal) found.perfil_vocal = edit.perfil_vocal;
                editedCharTags.push(found.tag || found.nombre);
            }
        });
    }

    // 2. Aplicar ediciones a escenas
    if (Array.isArray(sceneEdits) && sceneEdits.length > 0) {
        sceneEdits.forEach(edit => {
            const idx = (edit.index !== undefined) ? Number(edit.index) : (edit.sceneNumber ? Number(edit.sceneNumber) - 1 : -1);
            if (idx < 0 || idx >= sb.escenas.length) return;
            const sc = sb.escenas[idx];

            if (edit.prompt !== undefined) sc.prompt = edit.prompt;
            if (edit.visual !== undefined) sc.visual = edit.visual;
            if (edit.accion !== undefined) sc.accion = edit.accion;
            if (edit.contexto !== undefined) sc.contexto = edit.contexto;
            if (edit.narracion !== undefined) sc.narracion = edit.narracion;
            if (edit.dialogos !== undefined) sc.dialogos = edit.dialogos;
            if (edit.camara !== undefined) sc.camara = edit.camara;
            if (edit.tipo_corte !== undefined) sc.tipo_corte = edit.tipo_corte;
            if (edit.tipo_transicion !== undefined) sc.tipo_transicion = edit.tipo_transicion;
            if (edit.personajes_escena !== undefined) sc.personajes_escena = edit.personajes_escena;

            // Reconstruir animPrompt o usar el provisto explícitamente
            if (edit.animPrompt !== undefined) {
                sc.animPrompt = edit.animPrompt;
                sc.anim_prompt = edit.animPrompt;
            } else if (edit.dialogos !== undefined || edit.accion !== undefined || edit.camara !== undefined) {
                try {
                    const rebuilt = buildStandardAnimPrompt(sc, sb);
                    if (rebuilt) {
                        sc.animPrompt = rebuilt;
                        sc.anim_prompt = rebuilt;
                    }
                } catch (e) { }
            }

            // Actualizar textareas del DOM en vivo si existen
            const promptEl = document.getElementById(`prompt-${idx}`);
            if (promptEl && sc.prompt) promptEl.value = sc.prompt;
            const animEl = document.getElementById(`anim-${idx}`);
            if (animEl && sc.animPrompt) animEl.value = sc.animPrompt;
            const ctxEl = document.getElementById(`contexto-${idx}`);
            if (ctxEl && (sc.contexto || sc.narracion)) ctxEl.value = sc.contexto || sc.narracion;

            editedSceneIndices.push(idx);
        });
    }

    // Guardar storyboard actualizado
    await chrome.storage.local.set({ currentStoryboard: sb });
    try { localStorage.setItem('currentStoryboard', JSON.stringify(sb)); } catch (e) { }

    const regenResults = {
        charactersRegenerated: 0,
        imagesRegenerated: [],
        videosRegenerated: []
    };

    const flowTypeSelect = document.getElementById('flowType');
    const flowRatioSelect = document.getElementById('flowRatio');
    const storyStyleInput = document.getElementById('storyStyle');

    // 3. Regenerar personajes editados si se solicitó
    if (regenerateCharacters && editedCharTags.length > 0) {
        const allEntities = [...(sb.personajes || []), ...(sb.hero_assets || sb.assets_clave || [])];
        const targetEntities = allEntities.filter(p => editedCharTags.includes(p.tag || p.nombre));
        for (const entity of targetEntities) {
            await generateCharacterAsync(entity, flowTypeSelect, flowRatioSelect, storyStyleInput, MAX_TOTAL_ATTEMPTS);
            regenResults.charactersRegenerated++;
        }
    }

    // 4. Regenerar imágenes de las escenas editadas (con regla de máx. 3 intentos en la misma sesión)
    if (regenerateImages && editedSceneIndices.length > 0) {
        for (const idx of editedSceneIndices) {
            const resImg = await regenerateSingleSceneImageWithSmartRetry(idx);
            regenResults.imagesRegenerated.push({ sceneIndex: idx, ...resImg });
        }
    }

    // 5. Regenerar vídeos de las escenas editadas (con regla de máx. 3 intentos en la misma sesión)
    if (regenerateVideos && editedSceneIndices.length > 0) {
        for (const idx of editedSceneIndices) {
            const resVid = await regenerateSingleSceneVideoWithSmartRetry(idx);
            regenResults.videosRegenerated.push({ sceneIndex: idx, ...resVid });
        }
    }

    emitMcpEvent('storyboard_edited', {
        editedSceneIndices,
        editedCharTags,
        regenResults
    });

    return {
        ok: true,
        editedSceneIndices,
        editedCharTags,
        regenResults,
        storyboard: sb
    };
}

/**
 * 5. REINTENTO INTELIGENTE DE IMAGEN DE UNA ESCENA EN LA MISMA SESIÓN (MÁX. 3 INTENTOS)
 */
export async function regenerateSingleSceneImageWithSmartRetry(sceneIndex, customPrompt = null) {
    const idx = Number(sceneIndex);
    const store = await chrome.storage.local.get(['currentStoryboard', 'charImages', 'consistenciaPersonajes']);
    const sb = store.currentStoryboard || {};
    const scene = sb.escenas?.[idx];
    if (!scene) {
        return { ok: false, error: `No existe la escena con índice ${idx}` };
    }

    const promptTextarea = document.getElementById(`prompt-${idx}`);
    let basePrompt = customPrompt || promptTextarea?.value?.trim() || scene.prompt || scene.visual || '';
    const flowTypeSelect = document.getElementById('flowType');
    const flowRatioSelect = document.getElementById('flowRatio');
    const consistenciaActiva = store.consistenciaPersonajes !== false;

    // Resolver UUIDs de @personajes / @entornos asignados a esta escena
    const charUuids = [];
    const pills = document.querySelectorAll(`#sceneCard-${idx} .char-pill.active, #sceneCard-${idx} .ingredient-pill.active`);
    pills.forEach(p => {
        if (p.dataset.uuid) charUuids.push(p.dataset.uuid);
    });

    let lastError = null;
    for (let attempt = 1; attempt <= MAX_TOTAL_ATTEMPTS; attempt++) {
        const promptForAttempt = attempt === 1
            ? basePrompt
            : adjustPromptForRetry(basePrompt, attempt, lastError);

        if (promptTextarea && promptForAttempt !== promptTextarea.value) {
            promptTextarea.value = promptForAttempt;
        }
        scene.prompt = promptForAttempt;

        emitMcpEvent('scene_image_attempt', {
            sceneIndex: idx,
            sceneNumber: idx + 1,
            attempt,
            maxAttempts: MAX_TOTAL_ATTEMPTS,
            promptPreview: promptForAttempt.substring(0, 140)
        });

        try {
            // 1 intento por llamada para que nosotros controlemos el ajuste del prompt en cada intento (1..3)
            const result = await generateSceneImageAsync(
                idx,
                promptForAttempt,
                charUuids,
                consistenciaActiva,
                flowTypeSelect,
                flowRatioSelect,
                1
            );

            const checkStore = await chrome.storage.local.get(['capturedMedia']);
            const captured = (checkStore.capturedMedia || []).find(m => Number(m.index) === idx && m.src);
            if (result || captured) {
                return {
                    ok: true,
                    sceneIndex: idx,
                    attemptsUsed: attempt,
                    src: captured?.src || null,
                    uuid: captured?.uuid || null,
                    finalPrompt: promptForAttempt
                };
            }
            lastError = 'La imagen no se generó en este intento.';
        } catch (err) {
            lastError = err?.message || String(err);
            console.warn(`⚠️ [MCP SmartRetry Imagen] Escena ${idx + 1} falló en intento ${attempt}/${MAX_TOTAL_ATTEMPTS}:`, lastError);
        }

        if (attempt < MAX_TOTAL_ATTEMPTS) {
            await new Promise(r => setTimeout(r, 2500));
        }
    }

    return {
        ok: false,
        sceneIndex: idx,
        attemptsUsed: MAX_TOTAL_ATTEMPTS,
        error: `Agotados los ${MAX_TOTAL_ATTEMPTS} intentos máximos para la imagen de la Escena ${idx + 1}: ${lastError}`
    };
}

/**
 * 6. REINTENTO INTELIGENTE DE VÍDEO DE UNA ESCENA EN LA MISMA SESIÓN (MÁX. 3 INTENTOS)
 */
export async function regenerateSingleSceneVideoWithSmartRetry(sceneIndex, customAnimPrompt = null, startAttempt = 1) {
    const idx = Number(sceneIndex);
    const store = await chrome.storage.local.get(['currentStoryboard', 'capturedMedia', 'capturedVideos', 'failedVideosErrors', 'videoGeneratorSource']);
    const sb = store.currentStoryboard || {};
    const scene = sb.escenas?.[idx];
    if (!scene) {
        return { ok: false, error: `No existe la escena con índice ${idx}` };
    }

    const activeVidSource = document.getElementById('videoGeneratorSource')?.value || store.videoGeneratorSource || 'flow';
    const isGeminiOmni = activeVidSource === 'gemini_omni';
    const isVids = activeVidSource === 'vids';

    const animTextarea = document.getElementById(`anim-${idx}`);
    const baseAnimPrompt = customAnimPrompt || animTextarea?.value?.trim() || scene.animPrompt || scene.anim_prompt || '';
    const btn = document.getElementById(`animBtn-${idx}`) || document.createElement('button');
    const flowTypeSelect = document.getElementById('flowType');
    const flowRatioSelect = document.getElementById('flowRatio');
    let tab = null;
    if (isGeminiOmni) {
        tab = await ensureGeminiTabIsOpen(true);
    } else if (isVids) {
        tab = await ensureVidsTabIsActive(true);
    } else {
        tab = await ensureFlowTabIsActive(true);
    }

    const media = (store.capturedMedia || []).find(m => Number(m.index) === idx) || null;
    const charUuids = [];
    const pills = document.querySelectorAll(`#sceneCard-${idx} .char-pill.active, #sceneCard-${idx} .ingredient-pill.active`);
    pills.forEach(p => {
        if (p.dataset.uuid) charUuids.push(p.dataset.uuid);
    });

    let lastError = store.failedVideosErrors?.[idx] || '';
    const firstAttempt = Math.max(1, Math.min(MAX_TOTAL_ATTEMPTS, Number(startAttempt) || 1));

    for (let attempt = firstAttempt; attempt <= MAX_TOTAL_ATTEMPTS; attempt++) {
        const promptForAttempt = attempt === 1
            ? baseAnimPrompt
            : adjustPromptForRetry(baseAnimPrompt, attempt, lastError);

        if (animTextarea && promptForAttempt !== animTextarea.value) {
            animTextarea.value = promptForAttempt;
        }
        scene.animPrompt = promptForAttempt;
        scene.anim_prompt = promptForAttempt;

        emitMcpEvent('scene_video_attempt', {
            sceneIndex: idx,
            sceneNumber: idx + 1,
            attempt,
            maxAttempts: MAX_TOTAL_ATTEMPTS,
            source: activeVidSource,
            promptPreview: promptForAttempt.substring(0, 140)
        });

        try {
            if (isGeminiOmni) {
                await generateSingleSceneWithGeminiVideo(
                    idx,
                    promptForAttempt,
                    media?.src || null,
                    btn,
                    scene,
                    { skipAutoConfig: true }
                );
            } else if (isVids) {
                await exportSingleSceneToVids(
                    idx,
                    promptForAttempt,
                    media?.src || null,
                    btn,
                    scene
                );
            } else {
                await runAnimationSequence(
                    idx,
                    btn,
                    promptForAttempt,
                    media,
                    tab,
                    flowTypeSelect,
                    flowRatioSelect,
                    charUuids
                );
            }

            const checkStore = await chrome.storage.local.get(['capturedVideos', 'failedVideosErrors']);
            const vidObj = (checkStore.capturedVideos || []).find(v => Number(v.index) === idx && (v.src || v.dataUrl || v.downloadedFilename));
            if (vidObj) {
                return {
                    ok: true,
                    sceneIndex: idx,
                    attemptsUsed: attempt,
                    src: vidObj.src || vidObj.dataUrl || null,
                    downloadedFilename: vidObj.downloadedFilename || null,
                    uuid: vidObj.uuid || null,
                    finalPrompt: promptForAttempt
                };
            }
            lastError = checkStore.failedVideosErrors?.[idx] || 'El vídeo no se completó en este intento.';
        } catch (err) {
            lastError = err?.message || String(err);
            console.warn(`⚠️ [MCP SmartRetry Vídeo] Escena ${idx + 1} falló en intento ${attempt}/${MAX_TOTAL_ATTEMPTS}:`, lastError);
        }

        if (attempt < MAX_TOTAL_ATTEMPTS) {
            await new Promise(r => setTimeout(r, 3500));
        }
    }

    return {
        ok: false,
        sceneIndex: idx,
        attemptsUsed: MAX_TOTAL_ATTEMPTS,
        error: `Agotados los ${MAX_TOTAL_ATTEMPTS} intentos máximos para el vídeo de la Escena ${idx + 1}: ${lastError}`
    };
}

/**
 * Espera a que un trabajo de renderizado en Cloud Run (Facereels) llegue al 100% ('completed')
 * y devuelve la URL pública final del vídeo MP4.
 */
async function waitForCloudRenderCompletion(jobId, renderMode = 'python', maxWaitMs = 600000) {
    if (!jobId) return null;
    const targetHost = await getBackendServerUrl(renderMode);
    const startMs = Date.now();

    while (Date.now() - startMs < maxWaitMs) {
        try {
            const res = await fetch(`${targetHost}/api/status/${jobId}`);
            if (res.ok) {
                const statusData = await res.json();
                emitMcpEvent('cloud_render_progress', {
                    jobId,
                    status: statusData.status,
                    progress: statusData.progress || 0,
                    message: statusData.message || ''
                });
                if (statusData.status === 'completed' && statusData.video_url) {
                    let rawUrl = statusData.video_url;
                    if (targetHost.includes('app-facereels') || !targetHost.includes('localhost')) {
                        rawUrl = rawUrl.replace(/^https?:\/\/(localhost|127\.0\.0\.1):5000/i, '');
                    }
                    const finalVideoUrl = rawUrl.startsWith('http')
                        ? rawUrl
                        : targetHost.replace(/\/+$/, '') + '/' + rawUrl.replace(/^\/+/, '');
                    return {
                        success: true,
                        jobId,
                        renderMode,
                        status: 'completed',
                        progress: 100,
                        videoUrl: finalVideoUrl
                    };
                }
                if (statusData.status === 'error' || statusData.status === 'cancelled' || statusData.status === 'cancelado') {
                    throw new Error(`El renderizado en la nube falló (${statusData.status}): ${statusData.message || statusData.error || 'Error desconocido'}`);
                }
            }
        } catch (err) {
            if (String(err?.message || '').includes('El renderizado en la nube falló')) {
                throw err;
            }
        }
        await new Promise(r => setTimeout(r, 3000));
    }

    throw new Error(`Timeout esperando a que finalice el render en la nube (Job ID: ${jobId}).`);
}

/**
 * Ejecuta el renderizado final en Cloud Run (Facereels) UNA SOLA VEZ evitando duplicados,
 * o devuelve fallbackToLocalFfmpeg=true únicamente si no hay API Key de Facereels vinculada.
 */
async function executeCloudOrFallbackRender() {
    const store = await chrome.storage.local.get([
        'extFacereelsApiKey',
        'fr_render_mode',
        'renderedVideos',
        'currentStoryboard',
        'videoGeneratorSource'
    ]);

    const authToken = (store.extFacereelsApiKey || '').trim();
    if (!authToken || !authToken.startsWith('fr_')) {
        console.log('ℹ️ [MCP Render] Sin Facereels API Key vinculada. Se activará el fallback local con FFmpeg en el servidor MCP.');
        return {
            success: false,
            fallbackToLocalFfmpeg: true,
            reason: 'no_facereels_api_key'
        };
    }

    // Asegurar que wfOutputRenderSceneOrder incluya el 100% de las escenas del storyboard actual
    const totalScenes = store.currentStoryboard?.escenas?.length || 0;
    if (totalScenes > 0) {
        await chrome.storage.local.set({
            wfOutputRenderSceneOrder: Array.from({ length: totalScenes }, (_, idx) => idx)
        });
    }

    // Verificar si ya se disparó un job en los últimos 30 segundos para no duplicar tarjetas en la galería
    const nowMs = Date.now();
    const recentActiveJob = (store.renderedVideos || []).find(v => {
        const isPending = v && (v.status === 'en_cola' || v.status === 'processing' || v.status === 'rendering');
        const createdMs = v?.timestamp ? new Date(v.timestamp).getTime() : 0;
        return isPending && (nowMs - createdMs) < 30000;
    });

    if (recentActiveJob && recentActiveJob.id) {
        console.log(`♻️ [MCP Render] Reutilizando Job activo en Cloud Run (${recentActiveJob.id}) para evitar doble renderizado.`);
        return await waitForCloudRenderCompletion(recentActiveJob.id, recentActiveJob.renderMode || store.fr_render_mode || 'python');
    }

    const renderBackendBtn = document.getElementById('renderBackendBtn');
    const backendMusica = document.getElementById('backendMusica');
    const genSource = document.getElementById('videoGeneratorSource')?.value || store.videoGeneratorSource || 'flow';
    let targetTab = null;
    if (genSource === 'vids') {
        const { ensureVidsTabIsActive } = await import('./googleVidsExporter.js');
        targetTab = await ensureVidsTabIsActive(true);
    } else if (genSource === 'flow') {
        targetTab = await ensureFlowTabIsActive(true);
    } else if (genSource === 'gemini_omni') {
        targetTab = await ensureGeminiTabIsOpen(true);
    }

    const launchRes = await renderBackend(renderBackendBtn, backendMusica, targetTab);
    if (launchRes && launchRes.success && launchRes.jobId) {
        return await waitForCloudRenderCompletion(launchRes.jobId, launchRes.renderMode || 'python');
    }
    return launchRes;
}

/**
 * Inyecta clips editados con Remotion o HyperFrames en el proyecto activo de la extensión
 * y lanza el renderizado final en la nube (Cloud Run Facereels) conservando los clips originales aparte.
 */
export async function handleUploadEditedVideosAndRender({ editedScenes = [], title = null } = {}) {
    window.__autoPipelineActive = true;
    try {
        const store = await chrome.storage.local.get(['currentStoryboard', 'capturedVideos']);
        const sb = store.currentStoryboard || { escenas: [] };
        let capVids = Array.isArray(store.capturedVideos) ? [...store.capturedVideos] : [];

        if (title && sb.socialMetadata) {
            sb.socialMetadata.titulo = title;
            sb.titulo_proyecto = title;
        }

        if (Array.isArray(editedScenes) && editedScenes.length > 0) {
            for (const item of editedScenes) {
                const idx = Number(item.index ?? item.sceneIndex ?? 0);
                const dataUrl = item.base64Data || item.dataUrl || item.src;
                if (!dataUrl) continue;

                capVids = capVids.filter(v => Number(v.index) !== idx);
                capVids.push({
                    index: idx,
                    src: dataUrl,
                    dataUrl: dataUrl,
                    editedWith: item.editorMode || 'external_editor'
                });

                if (sb.escenas && sb.escenas[idx]) {
                    sb.escenas[idx].video = dataUrl;
                    sb.escenas[idx].video_url = dataUrl;
                }
            }
            capVids.sort((a, b) => Number(a.index) - Number(b.index));

            await chrome.storage.local.set({
                currentStoryboard: sb,
                capturedVideos: capVids,
                wfOutputRenderSceneOrder: Array.from({ length: Math.max(sb.escenas?.length || 0, capVids.length) }, (_, idx) => idx)
            });
        }

        emitMcpEvent('pipeline_stage', {
            stage: 'cloud_render_edited',
            message: 'Subiendo y renderizando en Cloud Run el vídeo editado (Remotion / HyperFrames)...'
        });

        const cloudRenderResult = await executeCloudOrFallbackRender();
        return {
            ok: true,
            cloudRenderResult
        };
    } finally {
        window.__autoPipelineActive = false;
    }
}

/**
 * 7. EJECUTAR EL PIPELINE COMPLETO DE PRODUCCIÓN EN LA EXTENSIÓN
 *    (Personajes -> Imágenes con máx. 3 intentos -> Vídeos con máx. 3 intentos -> Render Nativo en Cloud Run)
 */
export async function handleRunFullPipeline(options = {}) {
    const {
        storyboard = null,
        settings = {},
        skipCharacters = false,
        skipSceneImages = false,
        skipSceneVideos = false,
        skipNativeRender = false // Si el usuario pidió HyperFrames o Remotion, ponemos skipNativeRender=true primero y luego subimos el editado a Cloud Run
    } = options;

    // Candado global para impedir que el monitor reactivo de popup.js dispare un segundo render duplicado
    window.__autoPipelineActive = true;
    await requestPipelineKeepAwake('🤖 Antigravity MCP: Ejecutando Pipeline Completo');

    try {
        // Paso 0: Inyectar guion si viene incluido
        if (storyboard) {
            emitMcpEvent('pipeline_stage', { stage: 'inject_storyboard', message: 'Cargando Guion Maestro JSON en la extensión...' });
            await handleInjectStoryboard({ storyboard, settings });
            await new Promise(r => setTimeout(r, 1000));
        } else if (Object.keys(settings).length > 0) {
            await handleAutoconfigProject(settings);
        }

        const store = await chrome.storage.local.get(['currentStoryboard', 'directVideoChars', 'chainSceneFrames']);
        const sb = store.currentStoryboard;
        if (!sb || !Array.isArray(sb.escenas) || sb.escenas.length === 0) {
            throw new Error('No hay escenas cargadas en currentStoryboard para iniciar la producción.');
        }

        // Sincronizar wfOutputRenderSceneOrder con el total real de escenas del guion actual (evita que se rendericen 2/3 escenas)
        await chrome.storage.local.set({
            wfOutputRenderSceneOrder: Array.from({ length: sb.escenas.length }, (_, idx) => idx),
            ...(options.clearExistingVideos ? {
                capturedVideos: [],
                failedVideos: [],
                failedVideosErrors: {},
                runningVideos: [],
                runningVideosTimestamps: {}
            } : {})
        });

        const flowTypeSelect = document.getElementById('flowType');
        const flowRatioSelect = document.getElementById('flowRatio');
        const storyStyleInput = document.getElementById('storyStyle');

        // Paso 1: Generar Personajes (@Tag) y Hero Assets
        const allEntities = [...(sb.personajes || []), ...(sb.hero_assets || sb.assets_clave || [])];
        if (!skipCharacters && allEntities.length > 0) {
            emitMcpEvent('pipeline_stage', { stage: 'characters', total: allEntities.length, message: `Generando ${allEntities.length} Personajes/Ingredientes @Tag en Flow...` });
            const genAllCharsBtn = document.getElementById('genAllCharsBtn');
            await generateAllCharacters(genAllCharsBtn, allEntities, flowTypeSelect, flowRatioSelect, storyStyleInput, {
                forceRegenAll: Boolean(options.forceRegenCharacters),
                onlyMissing: !options.forceRegenCharacters
            });
            await new Promise(r => setTimeout(r, 1200));
        }

        const isDirectVideoChars = Boolean(settings.directVideoChars ?? store.directVideoChars);
        const isFrameChain = Boolean(settings.chainSceneFrames ?? store.chainSceneFrames);

        // Paso 2: Generar Imágenes de Escenas (con rescate automático de máx. 3 intentos con prompt ajustado)
        if (!skipSceneImages && !isDirectVideoChars) {
            if (isFrameChain) {
                emitMcpEvent('pipeline_stage', { stage: 'frame_chain', message: 'Ejecutando Frame Chain (Imagen + Vídeo secuencial)...' });
                await startProductionFrameChain();
            } else {
                emitMcpEvent('pipeline_stage', { stage: 'scene_images', total: sb.escenas.length, message: 'Generando imágenes de todas las escenas en Flow...' });
                await startProduction();

                // Verificar si alguna imagen falló y aplicar reintento inteligente con prompt ajustado (hasta completar máx. 3 intentos)
                const postImgStore = await chrome.storage.local.get(['capturedMedia']);
                const capMedia = postImgStore.capturedMedia || [];
                const missingImgIndices = sb.escenas
                    .map((_, i) => i)
                    .filter(i => !capMedia.some(m => Number(m.index) === i && m.src));

                if (missingImgIndices.length > 0) {
                    emitMcpEvent('pipeline_stage', {
                        stage: 'scene_images_smart_retry',
                        missingIndices: missingImgIndices,
                        message: `Ajustando prompts y reintentando ${missingImgIndices.length} imagen(es) faltante(s) en la misma sesión (máx. 3 intentos)...`
                    });
                    for (const idx of missingImgIndices) {
                        await regenerateSingleSceneImageWithSmartRetry(idx);
                    }
                }
            }
            await new Promise(r => setTimeout(r, 1200));
        }

        // Paso 3: Animar Vídeos de Escenas en Flow / Veo 3 / Vids (con máx. 3 intentos y ajuste inteligente de prompt)
        if (!skipSceneVideos && !isFrameChain) {
            const activeVidSource = settings.videoGeneratorSource || document.getElementById('videoGeneratorSource')?.value || 'flow';
            emitMcpEvent('pipeline_stage', { stage: 'scene_videos', total: sb.escenas.length, message: `Animando vídeos de todas las escenas (${activeVidSource})...` });
            const animarTodasBtn = document.getElementById('animarTodasBtn');
            await animateAllScenes(animarTodasBtn);

            // Verificar si después de las rondas nativas en Flow o Gemini Omni quedó alguna escena sin vídeo
            // (En modo 'vids', exportToGoogleVids ya ejecuta hasta 3 intentos con ajuste inteligente en su propia sesión)
            if (activeVidSource === 'flow' || activeVidSource === 'gemini_omni') {
                const postVidStore = await chrome.storage.local.get(['capturedVideos']);
                const capVids = postVidStore.capturedVideos || [];
                const missingVidIndices = sb.escenas
                    .map((_, i) => i)
                    .filter(i => !capVids.some(v => Number(v.index) === i && (v.src || v.dataUrl || v.downloadedFilename)));

                if (missingVidIndices.length > 0 && options.smartRescueFailedVideos !== false) {
                    emitMcpEvent('pipeline_stage', {
                        stage: 'scene_videos_smart_retry',
                        missingIndices: missingVidIndices,
                        message: `Reajustando prompts para ${missingVidIndices.length} escena(s) pendiente(s) en la misma sesión (máx. 3 intentos)...`
                    });
                    const nextAttemptStart = activeVidSource === 'gemini_omni' ? 2 : 1;
                    for (const idx of missingVidIndices) {
                        await regenerateSingleSceneVideoWithSmartRetry(idx, null, nextAttemptStart);
                    }
                }
            }
            await new Promise(r => setTimeout(r, 1200));
        }

        // Paso 4: Renderizado Final en Cloud Run (Facereels Studio) esperando hasta el 100%
        // Si no hay API Key de Facereels vinculada, devuelve fallbackToLocalFfmpeg=true para que el servidor MCP lo una localmente
        let nativeRenderResult = null;
        if (!skipNativeRender) {
            emitMcpEvent('pipeline_stage', { stage: 'native_render', message: 'Renderizando vídeo final en Cloud Run (Facereels Studio) y esperando al 100%...' });
            nativeRenderResult = await executeCloudOrFallbackRender();
        }

        const finalState = await handleGetProjectState();
        emitMcpEvent('pipeline_completed', {
            scenesTotal: finalState.scenesTotal,
            imagesReady: finalState.imagesReady,
            videosReady: finalState.videosReady,
            failedVideoIndices: finalState.failedVideoIndices,
            nativeRenderResult
        });

        return {
            ok: true,
            nativeRenderResult,
            summary: finalState
        };
    } finally {
        window.__autoPipelineActive = false;
        await releasePipelineKeepAwake();
    }
}

/**
 * 8. OBTENER ESTADO COMPLETO DEL PROYECTO Y ASSETS GENERADOS
 */
export async function handleGetProjectState() {
    const store = await chrome.storage.local.get([
        'currentStoryboard',
        'charImages',
        'capturedMedia',
        'capturedVideos',
        'failedVideos',
        'failedVideosErrors',
        'runningVideos',
        'capturedVoiceoverUrl',
        'capturedMusicUrl',
        'selectedMusicUrl',
        'flowRatio',
        'selectedTmpl'
    ]);

    const sb = store.currentStoryboard || null;
    const totalScenes = sb?.escenas?.length || 0;
    const capturedMedia = store.capturedMedia || [];
    const capturedVideos = store.capturedVideos || [];

    const scenesDetail = (sb?.escenas || []).map((sc, idx) => {
        const imgObj = capturedMedia.find(m => Number(m.index) === idx);
        const vidObj = capturedVideos.find(v => Number(v.index) === idx);
        const failErr = store.failedVideosErrors?.[idx] || null;
        return {
            index: idx,
            sceneNumber: idx + 1,
            prompt: sc.prompt || sc.visual || '',
            animPrompt: sc.animPrompt || sc.anim_prompt || '',
            contexto: sc.contexto || sc.narracion || '',
            dialogos: sc.dialogos || [],
            camara: sc.camara || '',
            duracion_seg: sc.duracion_seg || 8,
            hasImage: Boolean(imgObj?.src),
            imageSrc: imgObj?.src ? (imgObj.src.startsWith('data:') ? '[DATA_URL_READY]' : imgObj.src) : null,
            imageUuid: imgObj?.uuid || null,
            hasVideo: Boolean(vidObj?.src || vidObj?.dataUrl || vidObj?.downloadedFilename),
            videoSrc: vidObj?.src || null,
            downloadedFilename: vidObj?.downloadedFilename || sc.downloadedFilename || null,
            videoUuid: vidObj?.uuid || null,
            failedError: failErr
        };
    });

    return {
        ok: true,
        hasStoryboard: Boolean(sb),
        title: sb?.titulo_proyecto || sb?.socialMetadata?.titulo || null,
        template: store.selectedTmpl || localStorage.getItem('selectedTmpl') || null,
        aspectRatio: store.flowRatio || localStorage.getItem('flowRatio') || '9:16',
        scenesTotal: totalScenes,
        imagesReady: scenesDetail.filter(s => s.hasImage).length,
        videosReady: scenesDetail.filter(s => s.hasVideo).length,
        runningVideos: store.runningVideos || [],
        failedVideoIndices: store.failedVideos || [],
        failedVideosErrors: store.failedVideosErrors || {},
        voiceoverUrl: store.capturedVoiceoverUrl || null,
        musicUrl: store.capturedMusicUrl || store.selectedMusicUrl || null,
        charactersCount: sb?.personajes?.length || 0,
        scenes: scenesDetail
    };
}

/**
 * 9. EXPORTAR ASSETS COMPLETOS (INCLUYENDO DATA URLS / BLOBS / ARCHIVOS DESCARGADOS) AL MCP SERVER
 */
export async function handleExportAssets() {
    const store = await chrome.storage.local.get([
        'currentStoryboard',
        'charImages',
        'charDataUrls',
        'capturedMedia',
        'capturedVideos',
        'capturedVoiceoverUrl',
        'capturedMusicUrl'
    ]);

    const sb = store.currentStoryboard || {};
    const capturedMedia = store.capturedMedia || [];
    const capturedVideos = store.capturedVideos || [];
    const charDataUrls = store.charDataUrls || {};
    const charImages = store.charImages || {};

    // Resolver blobs o URLs de vídeo a base64 si aún no tienen downloadedFilename en disco
    const resolvedVideos = [];
    for (const v of capturedVideos) {
        let base64Data = null;
        if (!v.downloadedFilename && (v.dataUrl?.startsWith('data:') || v.src?.startsWith('data:'))) {
            base64Data = v.dataUrl || v.src;
        } else if (!v.downloadedFilename && v.src && /^https?:\/\//i.test(v.src)) {
            try {
                const resp = await fetch(v.src, { credentials: 'include' });
                if (resp.ok) {
                    const blob = await resp.blob();
                    if (blob && blob.size > 500 && !blob.type.includes('html') && !blob.type.includes('xml')) {
                        base64Data = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = () => resolve(null);
                            reader.readAsDataURL(blob);
                        });
                    }
                }
            } catch (e) { }

            if (!base64Data) {
                try {
                    const { fetchFlowVideoBlob } = await import('./flowMediaFetcher.js');
                    const resolved = await fetchFlowVideoBlob(v.src, v.index, v.uuid || v.tileId || '', { force: true });
                    if (resolved?.blob) {
                        base64Data = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = () => resolve(null);
                            reader.readAsDataURL(resolved.blob);
                        });
                    }
                } catch (eFlow) { }
            }
        }
        resolvedVideos.push({
            index: v.index,
            sceneNumber: Number(v.index) + 1,
            src: v.src || null,
            downloadedFilename: v.downloadedFilename || null,
            uuid: v.uuid || null,
            base64Data
        });
    }

    const charactersExport = [];
    const allEntities = [...(sb.personajes || []), ...(sb.hero_assets || sb.assets_clave || [])];
    for (const ent of allEntities) {
        const key = ent.tag || ent.id || ent.nombre;
        const rawSrc = charDataUrls[key] || charDataUrls[ent.id] || charImages[key] || charImages[ent.id] || null;
        if (rawSrc && typeof rawSrc === 'string' && rawSrc.startsWith('data:image/')) {
            charactersExport.push({
                tag: String(key || 'entidad').replace(/^@+/, ''),
                src: rawSrc
            });
        }
    }

    return {
        ok: true,
        storyboard: sb,
        characters: charactersExport,
        images: capturedMedia.map(m => ({
            index: m.index,
            sceneNumber: Number(m.index) + 1,
            src: m.src || null,
            uuid: m.uuid || null
        })),
        videos: resolvedVideos,
        voiceoverUrl: store.capturedVoiceoverUrl || null,
        musicUrl: store.capturedMusicUrl || null
    };
}

/**
 * 9. GESTIÓN DE INGREDIENTES / PERSONAJES / OBJETOS / LOCACIONES
 */
export async function handleAddIngredient({
    tag,
    name,
    type = 'character',
    image = null,
    description = ''
}) {
    if (!tag && !name) {
        throw new Error('Se requiere al menos un tag (@nombre) o un nombre para el ingrediente.');
    }
    const cleanTag = tag ? (String(tag).startsWith('@') ? String(tag) : `@${tag}`) : `@${String(name).replace(/\s+/g, '_')}`;
    const cleanId = cleanTag.replace(/^@/, '');
    const cleanName = name || cleanId;

    const store = await chrome.storage.local.get(['charImages', 'charDataUrls', 'charOriginalDataUrls', 'currentStoryboard']);
    const charImages = store.charImages || {};
    const charDataUrls = store.charDataUrls || {};
    const currentStoryboard = store.currentStoryboard || { escenas: [] };
    if (!Array.isArray(currentStoryboard.personajes)) currentStoryboard.personajes = [];
    if (!Array.isArray(currentStoryboard.hero_assets)) currentStoryboard.hero_assets = [];

    if (image) {
        charImages[cleanTag] = image;
        charImages[cleanId] = image;
        charImages[cleanName] = image;
        charDataUrls[cleanTag] = image;
        charDataUrls[cleanId] = image;
    }

    const entityObj = {
        id: cleanId,
        tag: cleanTag,
        nombre: cleanName,
        type,
        rol: type === 'character' ? 'protagonista' : type,
        descripcion: description,
        ancla_visual: description,
        prompt: description || `Fotografía cinemática ultra detallada de ${cleanName}, ${description}`,
        src: image || charImages[cleanTag] || null
    };

    if (type === 'character') {
        const existIdx = currentStoryboard.personajes.findIndex(p => p.tag === cleanTag || p.id === cleanId || p.nombre === cleanName);
        if (existIdx >= 0) {
            currentStoryboard.personajes[existIdx] = { ...currentStoryboard.personajes[existIdx], ...entityObj };
        } else {
            currentStoryboard.personajes.push(entityObj);
        }
    } else {
        const existIdx = currentStoryboard.hero_assets.findIndex(a => a.tag === cleanTag || a.id === cleanId || a.nombre === cleanName);
        if (existIdx >= 0) {
            currentStoryboard.hero_assets[existIdx] = { ...currentStoryboard.hero_assets[existIdx], ...entityObj };
        } else {
            currentStoryboard.hero_assets.push(entityObj);
        }
    }

    await chrome.storage.local.set({ charImages, charDataUrls, currentStoryboard });
    try {
        localStorage.setItem('charImages', JSON.stringify(charImages));
        localStorage.setItem('charDataUrls', JSON.stringify(charDataUrls));
        localStorage.setItem('currentStoryboard', JSON.stringify(currentStoryboard));
    } catch (_) {}

    emitMcpEvent('ingredient_added', { tag: cleanTag, name: cleanName, type });

    return {
        ok: true,
        tag: cleanTag,
        id: cleanId,
        name: cleanName,
        type,
        hasImage: Boolean(image || charImages[cleanTag])
    };
}

/**
 * 10. GENERACIÓN STANDALONE DE IMAGEN (FLOW / GEMINI / VIDS / GOOGLE IMAGES)
 */

/**
 * INYECCIÓN DIRECTA Y ROBUSTA EN GOOGLE FLOW (Imagen y Video)
 * Localiza el editor de Flow (.ProseMirror), ajusta modelo y ratio, inyecta el prompt y pulsa Generar.
 */
export async function directInjectAndSubmitToFlow({ prompt, type = 'video', ratio = '16:9', duration = '8s' }) {
    const activeFlowTab = await ensureFlowTabIsActive(true);
    if (!activeFlowTab) {
        throw new Error('No se detectó pestaña de Google Flow abierta');
    }

    try {
        await chrome.tabs.update(activeFlowTab.id, { active: true });
        if (activeFlowTab.windowId) {
            await focusWindowRespectingWorkflowEditor(activeFlowTab.windowId);
        }
    } catch (_) {}

    const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: activeFlowTab.id },
        world: 'MAIN',
        args: [{ prompt, type, ratio, duration }],
        func: async ({ prompt, type, ratio, duration }) => {
            const sleep = ms => new Promise(r => setTimeout(r, ms));

            // 1. Cerrar modales o backdrops que puedan bloquear
            const backdrop = document.querySelector('.cdk-overlay-backdrop');
            if (backdrop) {
                try { backdrop.click(); } catch (_) {}
            }
            document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
            await sleep(150);

            // 2. Localizar el editor de texto de Flow
            const editor = document.querySelector('flow-rich-text-editor .ProseMirror') ||
                           document.querySelector('.ProseMirror') ||
                           document.querySelector('[contenteditable="true"]');
            if (!editor) {
                return { success: false, error: 'No se encontró el editor de texto en Google Flow.' };
            }

            // 3. Configurar modelo (Vídeo vs Imagen) en la interfaz de Flow
            const wantsVideo = String(type).toLowerCase().includes('vid');
            const allBtns = Array.from(document.querySelectorAll('button, [role="button"], mat-button-toggle, .mat-mdc-button-base'));
            
            // Buscar la píldora actual del modelo (ej. "Nano Banana", "Veo", "Imagen")
            const modelBtn = allBtns.find(b => {
                const t = (b.textContent || '').toLowerCase();
                return t.includes('banana') || t.includes('veo') || t.includes('imagen') || t.includes('omni') || t.includes('flash') || t.includes('quality') || t.includes('fast');
            });

            if (modelBtn) {
                const currentText = (modelBtn.textContent || '').toLowerCase();
                const isCurrentlyVideo = currentText.includes('veo') || currentText.includes('video') || currentText.includes('vídeo');
                if (wantsVideo !== isCurrentlyVideo) {
                    modelBtn.click();
                    await sleep(350);
                    const menuItems = Array.from(document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="menuitem"], .cdk-overlay-pane mat-option, .cdk-overlay-pane mat-button-toggle, [role="option"], .mat-mdc-menu-item'));
                    const targetOption = menuItems.find(opt => {
                        const t = (opt.textContent || '').toLowerCase();
                        if (wantsVideo) return t.includes('veo') || t.includes('omni') || t.includes('video') || t.includes('vídeo') || t.includes('flash') || t.includes('fast');
                        return t.includes('banana') || t.includes('imagen') || t.includes('image');
                    });
                    if (targetOption) {
                        targetOption.click();
                        await sleep(250);
                    }
                    const bd = document.querySelector('.cdk-overlay-backdrop');
                    if (bd) bd.click();
                    await sleep(150);
                }
            }

            // 4. Configurar ratio (16:9, 9:16, 1:1) si hay botón de ratio
            if (ratio) {
                const cleanRatio = String(ratio).trim();
                const ratioBtn = allBtns.find(b => {
                    const t = (b.textContent || '').trim();
                    return t === '16:9' || t === '9:16' || t === '1:1' || t === '4:3' || t === '3:4';
                });
                if (ratioBtn && !ratioBtn.textContent.includes(cleanRatio)) {
                    ratioBtn.click();
                    await sleep(300);
                    const ratioOptions = Array.from(document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="menuitem"], .cdk-overlay-pane [role="radio"]'));
                    const targetRatioOpt = ratioOptions.find(o => (o.textContent || '').includes(cleanRatio));
                    if (targetRatioOpt) {
                        targetRatioOpt.click();
                        await sleep(200);
                    }
                    const bd = document.querySelector('.cdk-overlay-backdrop');
                    if (bd) bd.click();
                    await sleep(150);
                }
            }

            // 5. Limpiar el editor completamente
            editor.focus();
            try {
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(editor);
                sel.removeAllRanges();
                sel.addRange(range);
                document.execCommand('delete', false, null);
            } catch (_) {}
            await sleep(100);

            // 6. Inyectar el prompt en el editor
            editor.focus();
            let inserted = false;
            try {
                inserted = document.execCommand('insertText', false, prompt);
            } catch (_) {}

            if (!inserted || !editor.textContent.trim()) {
                if (typeof globalThis.insertText === 'function') {
                    await globalThis.insertText(editor, prompt, { segmentMode: false });
                } else {
                    const p = editor.querySelector('p') || editor;
                    p.textContent = prompt;
                }
            }
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            await sleep(250);

            // 7. Localizar y disparar el botón de envío
            const submitBtn = document.querySelector('flow-generate-icon-button button') ||
                              document.querySelector('button.generate-icon-button') ||
                              document.querySelector('button[aria-label*="Crear" i]') ||
                              document.querySelector('button[aria-label*="Generate" i]') ||
                              document.querySelector('button[aria-label*="Enviar" i]') ||
                              Array.from(document.querySelectorAll('button')).find(b => {
                                  const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                                  const ic = (b.querySelector('mat-icon, i, svg')?.textContent || '').toLowerCase();
                                  return aria.includes('generar') || aria.includes('crear') || ic.includes('arrow_forward') || ic.includes('send');
                              });

            if (submitBtn) {
                submitBtn.removeAttribute('disabled');
                submitBtn.click();
                return { success: true, method: 'button_click', prompt, type, ratio };
            }

            const enterEvt = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
            editor.dispatchEvent(enterEvt);
            return { success: true, method: 'enter_key', prompt, type, ratio };
        }
    });

    const executionResult = injectionResults?.[0]?.result;
    emitMcpEvent('flow_injected_and_submitted', {
        type,
        ratio,
        prompt: prompt.substring(0, 140),
        result: executionResult
    });

    return {
        ok: executionResult?.success !== false,
        engine: 'flow',
        type,
        ratio,
        prompt,
        submitted: true,
        details: executionResult
    };
}

export async function handleGenerateImage({
    prompt,
    engine = 'flow',
    aspectRatio = '9:16',
    ingredients = [],
    style = '',
    negativePrompt = '',
    sceneIndex = 0
}) {
    if (!prompt || typeof prompt !== 'string') {
        throw new Error('Falta el prompt de la imagen.');
    }

    // 1. Registrar ingredientes si fueron provistos
    const resolvedCharUuids = [];
    if (Array.isArray(ingredients) && ingredients.length > 0) {
        for (const ing of ingredients) {
            if (typeof ing === 'string') {
                resolvedCharUuids.push(ing);
            } else if (typeof ing === 'object' && ing) {
                await handleAddIngredient(ing);
                resolvedCharUuids.push(ing.tag || ing.id || ing.name);
            }
        }
    }

    // 2. Mapear motor
    let mappedEngine = 'flow';
    const lowerEngine = String(engine).toLowerCase();
    if (lowerEngine.includes('gemini')) mappedEngine = 'gemini_images';
    else if (lowerEngine.includes('google_images') || lowerEngine.includes('nano')) mappedEngine = 'google_images';
    else if (lowerEngine.includes('vids')) mappedEngine = 'vids';
    else mappedEngine = 'flow';

    // 3. Aplicar configuración de relación de aspecto y motor
    const storagePatch = {
        flowRatio: aspectRatio,
        geminiImageAspectRatio: aspectRatio,
        imageGeneratorSource: mappedEngine
    };
    await chrome.storage.local.set(storagePatch);
    try {
        localStorage.setItem('flowRatio', aspectRatio);
        localStorage.setItem('geminiImageAspectRatio', aspectRatio);
        localStorage.setItem('imageGeneratorSource', mappedEngine);
    } catch (_) {}

    ['imageGeneratorSource', 'modalImageGeneratorSource', 'composerImageGeneratorSource'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = mappedEngine;
    });
    const fRatioSel = document.getElementById('flowRatio');
    if (fRatioSel) fRatioSel.value = aspectRatio;

    // 4. Asegurar que existe una escena en currentStoryboard
    const idx = Number(sceneIndex) || 0;
    const store = await chrome.storage.local.get(['currentStoryboard']);
    let sb = store.currentStoryboard || { escenas: [] };
    if (!Array.isArray(sb.escenas)) sb.escenas = [];
    while (sb.escenas.length <= idx) {
        sb.escenas.push({
            numero: sb.escenas.length + 1,
            prompt: '',
            aspectRatio,
            visual: ''
        });
    }

    let finalPrompt = prompt.trim();
    if (style && !finalPrompt.includes(style)) {
        finalPrompt = `${finalPrompt}, estilo ${style}`;
    }
    sb.escenas[idx].prompt = finalPrompt;
    sb.escenas[idx].aspectRatio = aspectRatio;
    await chrome.storage.local.set({ currentStoryboard: sb });

    const promptTextarea = document.getElementById(`prompt-${idx}`);
    if (promptTextarea) promptTextarea.value = finalPrompt;

    emitMcpEvent('generate_image_started', {
        engine: mappedEngine,
        aspectRatio,
        prompt: finalPrompt.substring(0, 140),
        ingredientsCount: resolvedCharUuids.length
    });

    // 5. Ejecutar generación con Smart Retry
    if (mappedEngine === 'flow') {
        return await directInjectAndSubmitToFlow({ prompt: finalPrompt, type: 'image', ratio: aspectRatio });
    }
    const result = await regenerateSingleSceneImageWithSmartRetry(idx, finalPrompt);
    return {
        ...result,
        engine: mappedEngine,
        aspectRatio,
        prompt: finalPrompt
    };
}

/**
 * 11. GENERACIÓN STANDALONE DE VÍDEO (FLOW / GEMINI OMNI / VIDS)
 */
export async function handleGenerateVideo({
    prompt,
    engine = 'flow',
    videoMode = 'ingredients',
    modelFamily = 'Omni 1.1 Flash',
    aspectRatio = '9:16',
    duration = '8s',
    resolution = '720p',
    outputsCount = 'x1',
    baseImage = null,
    ingredients = [],
    sceneIndex = 0
}) {
    if (!prompt || typeof prompt !== 'string') {
        throw new Error('Falta el prompt de animación para el vídeo.');
    }

    // 1. Registrar ingredientes si fueron provistos
    const resolvedCharUuids = [];
    if (Array.isArray(ingredients) && ingredients.length > 0) {
        for (const ing of ingredients) {
            if (typeof ing === 'string') {
                resolvedCharUuids.push(ing);
            } else if (typeof ing === 'object' && ing) {
                await handleAddIngredient(ing);
                resolvedCharUuids.push(ing.tag || ing.id || ing.name);
            }
        }
    }

    // 2. Mapear motor
    let mappedEngine = 'flow';
    const lowerEngine = String(engine).toLowerCase();
    if (lowerEngine.includes('gemini')) mappedEngine = 'gemini_omni';
    else if (lowerEngine.includes('vids')) mappedEngine = 'vids';
    else mappedEngine = 'flow';

    // 3. Normalizar modo de video (Ingredientes vs Fotogramas)
    const normalizedMode = (videoMode === 'frames' || videoMode === 'Fotogramas') ? 'Fotogramas' : 'Ingredientes';
    const cleanDuration = String(duration).includes('4') ? '4s' : '8s';
    const cleanRes = String(resolution).includes('360') ? '360p' : '720p';
    const cleanOutputs = String(outputsCount).includes('4') ? 'x4' : (String(outputsCount).includes('2') ? 'x2' : 'x1');

    // 4. Aplicar configuración en storage y UI
    const storagePatch = {
        videoGeneratorSource: mappedEngine,
        flowVideoMode: normalizedMode,
        flowModelFamily: modelFamily,
        flowRatio: aspectRatio,
        geminiVideoAspectRatio: aspectRatio,
        flowVideoDuration: cleanDuration,
        flowVideoResolution: cleanRes,
        flowOutputsCount: cleanOutputs,
        directVideoChars: normalizedMode === 'Ingredientes'
    };
    await chrome.storage.local.set(storagePatch);
    try {
        localStorage.setItem('videoGeneratorSource', mappedEngine);
        localStorage.setItem('flowVideoMode', normalizedMode);
        localStorage.setItem('flowModelFamily', modelFamily);
        localStorage.setItem('flowRatio', aspectRatio);
        localStorage.setItem('flowVideoDuration', cleanDuration);
        localStorage.setItem('flowVideoResolution', cleanRes);
        localStorage.setItem('flowOutputsCount', cleanOutputs);
    } catch (_) {}

    ['videoGeneratorSource', 'modalVideoGeneratorSource', 'composerVideoGeneratorSource'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = mappedEngine;
    });
    const vModeSel = document.getElementById('flowVideoMode');
    if (vModeSel) vModeSel.value = normalizedMode;
    const famSel = document.getElementById('flowModelFamily');
    if (famSel) famSel.value = modelFamily;

    // 5. Preparar escena en currentStoryboard
    const idx = Number(sceneIndex) || 0;
    const store = await chrome.storage.local.get(['currentStoryboard', 'capturedMedia']);
    let sb = store.currentStoryboard || { escenas: [] };
    if (!Array.isArray(sb.escenas)) sb.escenas = [];
    while (sb.escenas.length <= idx) {
        sb.escenas.push({
            numero: sb.escenas.length + 1,
            prompt: '',
            animPrompt: '',
            aspectRatio,
            visual: ''
        });
    }

    const finalAnimPrompt = prompt.trim();
    sb.escenas[idx].animPrompt = finalAnimPrompt;
    sb.escenas[idx].anim_prompt = finalAnimPrompt;
    sb.escenas[idx].aspectRatio = aspectRatio;
    sb.escenas[idx].duration = cleanDuration;

    // 6. Si se dio baseImage (para modo frames/fotogramas), registrarla en capturedMedia
    if (baseImage) {
        let capturedMedia = store.capturedMedia || [];
        const existCapIdx = capturedMedia.findIndex(m => Number(m.index) === idx);
        const capObj = {
            index: idx,
            src: baseImage,
            aspectRatio,
            timestamp: Date.now()
        };
        if (existCapIdx >= 0) {
            capturedMedia[existCapIdx] = capObj;
        } else {
            capturedMedia.push(capObj);
        }
        await chrome.storage.local.set({ capturedMedia });
    }

    await chrome.storage.local.set({ currentStoryboard: sb });

    const animTextarea = document.getElementById(`anim-${idx}`);
    if (animTextarea) animTextarea.value = finalAnimPrompt;

    emitMcpEvent('generate_video_started', {
        engine: mappedEngine,
        videoMode: normalizedMode,
        modelFamily,
        aspectRatio,
        duration: cleanDuration,
        resolution: cleanRes,
        prompt: finalAnimPrompt.substring(0, 140)
    });

    // 7. Ejecutar generación con Smart Retry
    if (mappedEngine === 'flow') {
        return await directInjectAndSubmitToFlow({ prompt: finalAnimPrompt, type: 'video', ratio: aspectRatio, duration: cleanDuration });
    }
    const result = await regenerateSingleSceneVideoWithSmartRetry(idx, finalAnimPrompt);
    return {
        ...result,
        engine: mappedEngine,
        videoMode: normalizedMode,
        modelFamily,
        aspectRatio,
        duration: cleanDuration,
        resolution: cleanRes,
        prompt: finalAnimPrompt
    };
}

/**
 * 12. CATÁLOGO DE MODELOS, MOTORES Y CAPACIDADES EXPUESTAS
 */

/**
 * 13. GENERACIÓN DE MÚSICA DE FONDO (GOOGLE VIDS LYRIA / GEMINI / FLOW MUSIC)
 */
export async function handleGenerateMusic({
    prompt,
    engine = 'lyria',
    duration = 'full',
    style = '',
    mood = ''
}) {
    if (!prompt || typeof prompt !== 'string') {
        throw new Error('Falta el prompt descriptivo para la música de fondo.');
    }

    let finalPrompt = prompt.trim();
    if (style && !finalPrompt.toLowerCase().includes(style.toLowerCase())) {
        finalPrompt += `, estilo ${style}`;
    }
    if (mood && !finalPrompt.toLowerCase().includes(mood.toLowerCase())) {
        finalPrompt += `, ambiente ${mood}`;
    }

    const lowerEngine = String(engine || '').toLowerCase();

    // 1. Google Vids con Lyria 3
    if (lowerEngine.includes('lyria') || lowerEngine.includes('vids')) {
        emitMcpEvent('generate_music_started', {
            engine: 'vids_lyria',
            prompt: finalPrompt,
            duration
        });

        const targetTab = await ensureVidsTabIsActive(true);
        if (!targetTab) {
            throw new Error('No se pudo acceder a la pestaña de Google Vids para la generación con Lyria.');
        }

        await saveAndTriggerVids({
            status: 'start',
            mode: 'flow',
            generateLyriaMusic: true,
            musicDuration: duration,
            musicPrompt: finalPrompt,
            videoDataUrls: []
        });

        return {
            ok: true,
            engine: 'vids_lyria',
            status: 'generating',
            prompt: finalPrompt,
            duration,
            message: 'Generación de música de fondo con Lyria 3 iniciada en Google Vids.'
        };
    }

    // 2. Google Gemini Modo Música
    if (lowerEngine.includes('gemini')) {
        emitMcpEvent('generate_music_started', {
            engine: 'gemini_music',
            prompt: finalPrompt,
            duration
        });

        await ensureGeminiTabIsOpen(true);
        const res = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'generateWithGeminiMusic',
                prompt: finalPrompt,
                duration
            }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ ok: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve(response || { ok: false, error: 'Sin respuesta de Gemini Music' });
                }
            });
        });

        return {
            ok: true,
            engine: 'gemini_music',
            result: res,
            prompt: finalPrompt
        };
    }

    // 3. Flow Music (flowmusic.app)
    if (lowerEngine.includes('flow') || lowerEngine.includes('flowmusic')) {
        emitMcpEvent('generate_music_started', {
            engine: 'flow_music',
            prompt: finalPrompt
        });

        const res = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: 'generateWithFlowMusic',
                prompt: finalPrompt
            }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ ok: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve(response || { ok: false, error: 'Sin respuesta de Flow Music' });
                }
            });
        });

        return {
            ok: true,
            engine: 'flow_music',
            result: res,
            prompt: finalPrompt
        };
    }

    throw new Error(`Motor de música no reconocido: "${engine}". Opciones válidas: "lyria", "gemini", "flow_music".`);
}

/**
 * 14. ACTIVADOR / NAVEGADOR DE APPS WEB
 */
export async function handleLaunchApp({ app = 'flow', activate = true }) {
    const lower = String(app || '').toLowerCase();
    if (lower.includes('gemini')) {
        const tab = await ensureGeminiTabIsOpen(activate);
        return { ok: true, app: 'gemini', tabId: tab?.id, url: tab?.url };
    }
    if (lower.includes('vids')) {
        const tab = await ensureVidsTabIsActive(activate);
        return { ok: true, app: 'vids', tabId: tab?.id, url: tab?.url };
    }
    if (lower.includes('music') || lower.includes('flowmusic')) {
        const tabs = await chrome.tabs.query({ url: ["*://*.flowmusic.app/*", "*://flowmusic.app/*"] });
        if (tabs && tabs.length > 0) {
            if (activate) await chrome.tabs.update(tabs[0].id, { active: true });
            return { ok: true, app: 'flow_music', tabId: tabs[0].id, url: tabs[0].url };
        }
        const newTab = await chrome.tabs.create({ url: 'https://www.flowmusic.app/', active: activate });
        return { ok: true, app: 'flow_music', tabId: newTab?.id, url: newTab?.url };
    }
    const tab = await ensureFlowTabIsActive(activate);
    return { ok: true, app: 'flow', tabId: tab?.id, url: tab?.url };
}

export function handleListModels() {
    return {
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
                musicGenerators: [
            {
                id: 'lyria',
                name: '🎵 Google Vids (Lyria 3)',
                durations: ['15s', '30s', '60s', 'full'],
                description: 'Generación de bandas sonoras y temas musicales en Google Vids utilizando el modelo musical Lyria 3.'
            },
            {
                id: 'gemini',
                name: '✨ Google Gemini (Modo Música / Audio)',
                durations: ['full'],
                description: 'Generación interactiva de pistas musicales y atmósfera acústica con Gemini.'
            },
            {
                id: 'flow_music',
                name: '🎧 Flow Music (flowmusic.app)',
                durations: ['full'],
                description: 'Composición musical autónoma en Flow Music con prompts de estilo e instrumentación.'
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
    };
}

/**
 * DESPACHADOR CENTRAL DE COMANDOS MCP
 */
export async function executeMcpCommand(command, params = {}) {
    switch (command) {
        case 'eval_flow': {
            const tabs = await chrome.tabs.query({});
            const flowTab = tabs.find(t => t.url && (t.url.includes('flow.google') || t.url.includes('labs.google')));
            if (!flowTab) return { ok: false, error: 'No Flow tab found' };
            const res = await chrome.scripting.executeScript({
                target: { tabId: flowTab.id },
                world: 'MAIN',
                func: (codeStr) => {
                    try {
                        return { ok: true, result: eval(codeStr) };
                    } catch (e) {
                        return { ok: false, error: e.message };
                    }
                },
                args: [params.code]
            });
            return { ok: true, tabId: flowTab.id, url: flowTab.url, data: res[0]?.result };
        }
        case 'reload_extension': { setTimeout(() => { try { window.location.reload(); } catch(_) {} }, 100); return { ok: true, reloaded: true }; }
        case 'ping':
            return { ok: true, role: 'orchestrator', timestamp: Date.now() };
        case 'add_ingredient':
            return await handleAddIngredient(params);
        case 'generate_image':
            return await handleGenerateImage(params);
        case 'generate_video':
            return await handleGenerateVideo(params);
        case 'generate_music':
            return await handleGenerateMusic(params);
        case 'launch_app':
            return await handleLaunchApp(params);
        case 'list_models':
            return handleListModels();
        case 'get_master_prompt':
            return await handleGetMasterPrompt(params);
        case 'get_project_state':
            return await handleGetProjectState();
        case 'autoconfig_project':
            return await handleAutoconfigProject(params);
        case 'inject_storyboard':
            return await handleInjectStoryboard(params);
        case 'edit_storyboard':
            return await handleEditStoryboard(params);
        case 'regenerate_scene_image':
            return await regenerateSingleSceneImageWithSmartRetry(params.sceneIndex, params.customPrompt);
        case 'regenerate_scene_video':
            return await regenerateSingleSceneVideoWithSmartRetry(params.sceneIndex, params.customAnimPrompt);
        case 'generate_characters': {
            const store = await chrome.storage.local.get(['currentStoryboard']);
            const sb = store.currentStoryboard || {};
            const allEntities = [...(sb.personajes || []), ...(sb.hero_assets || sb.assets_clave || [])];
            const res = await generateAllCharacters(
                document.getElementById('genAllCharsBtn'),
                allEntities,
                document.getElementById('flowType'),
                document.getElementById('flowRatio'),
                document.getElementById('storyStyle'),
                { forceRegenAll: Boolean(params.forceRegenAll), onlyMissing: !params.forceRegenAll }
            );
            return { ok: true, result: res };
        }
        case 'generate_scene_images': {
            const res = await startProduction();
            return { ok: true, result: res, state: await handleGetProjectState() };
        }
        case 'animate_scenes': {
            const res = await animateAllScenes(document.getElementById('animarTodasBtn'), { onlyFailed: Boolean(params.onlyFailed) });
            return { ok: true, result: res, state: await handleGetProjectState() };
        }
        case 'render_native_backend': {
            const res = await executeCloudOrFallbackRender();
            return { ok: true, result: res };
        }
        case 'upload_edited_videos_and_render':
            return await handleUploadEditedVideosAndRender(params);
        case 'run_full_pipeline':
            return await handleRunFullPipeline(params);
        case 'export_assets':
            return await handleExportAssets();
        case 'cancel_all':
            await cancelRunAll();
            await cancelAnimateAll();
            cancelFrameChain();
            cancelGenerateCharacters();
            await cancelarRenderActivo();
            return { ok: true, cancelled: true };
        default:
            throw new Error(`Comando MCP desconocido: ${command}`);
    }
}

function isMcpBridgeEnabled() {
    try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('mcpBridgeDisabled') === 'true') {
            return false;
        }
    } catch (e) { }
    return true; // Siempre activo para comunicación autónoma en tiempo real
}

/**
 * CONEXIÓN WEBSOCKET DIRECTA DESDE EL ORQUESTADOR (POPUP.HTML) AL SERVIDOR MCP LOCAL
 * Solo se activa bajo demanda cuando el modo MCP está explícitamente habilitado,
 * evitando errores ERR_CONNECTION_REFUSED en consola al usar la extensión desde la web.
 */
function connectOrchestratorWebSocket(force = false) {
    try {
        clearTimeout(_wsReconnectTimer);
        if (!force && !isMcpBridgeEnabled()) {
            return;
        }
        if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) {
            return;
        }
        let wasEverOpen = false;
        _ws = new WebSocket(MCP_WS_URL);

        _ws.onopen = () => {
            wasEverOpen = true;
            try { localStorage.setItem('mcpBridgeEnabled', 'true'); } catch (e) { }
            console.log('🔌 [MCP Orchestrator] Conectado en tiempo real con Antigravity MCP Server (ws://127.0.0.1:3847)');
            _ws.send(JSON.stringify({
                type: 'hello',
                role: 'orchestrator',
                url: window.location.href
            }));
        };

        _ws.onmessage = async (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'command' && msg.id && msg.command) {
                    try {
                        const result = await executeMcpCommand(msg.command, msg.params || {});
                        _ws.send(JSON.stringify({
                            type: 'response',
                            id: msg.id,
                            ok: true,
                            result
                        }));
                    } catch (cmdErr) {
                        _ws.send(JSON.stringify({
                            type: 'response',
                            id: msg.id,
                            ok: false,
                            error: cmdErr?.message || String(cmdErr)
                        }));
                    }
                }
            } catch (parseErr) {
                console.warn('[MCP Orchestrator] Error procesando mensaje WS:', parseErr);
            }
        };

        _ws.onclose = () => {
            _ws = null;
            clearTimeout(_wsReconnectTimer);
            // Si nunca llegó a abrirse (servidor MCP apagado), desactivar auto-reconexión para no ensuciar la consola
            if (!wasEverOpen) {
                if (!window.location.search.includes('mcp=1')) {
                    try { localStorage.removeItem('mcpBridgeEnabled'); } catch (e) { }
                }
                return;
            }
            if (isMcpBridgeEnabled()) {
                _wsReconnectTimer = setTimeout(() => connectOrchestratorWebSocket(false), 6000);
            }
        };

        _ws.onerror = () => {
            try { _ws?.close(); } catch (e) { }
        };
    } catch (e) {
        clearTimeout(_wsReconnectTimer);
    }
}

/**
 * INICIALIZAR EL ORQUESTADOR MCP EN POPUP.JS
 */
export function initMcpOrchestrator(domElements = null) {
    _domElements = domElements;
    window.__mcpOrchestrator = {
        executeMcpCommand,
        adjustPromptForRetry,
        MAX_TOTAL_ATTEMPTS,
        enableMcpBridge: (enable = true) => {
            try {
                if (enable) {
                    localStorage.setItem('mcpBridgeEnabled', 'true');
                    chrome.storage.local.set({ mcpBridgeEnabled: true });
                    connectOrchestratorWebSocket(true);
                } else {
                    localStorage.removeItem('mcpBridgeEnabled');
                    chrome.storage.local.set({ mcpBridgeEnabled: false });
                    clearTimeout(_wsReconnectTimer);
                    try { _ws?.close(); } catch (e) { }
                }
            } catch (e) { }
        }
    };

    // Escuchar comandos reenviados desde background.js
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request && request.action === 'enableMcpBridge') {
            window.__mcpOrchestrator.enableMcpBridge(Boolean(request.enabled ?? true));
            sendResponse({ ok: true });
            return false;
        }
        if (request && request.action === 'mcpOrchestratorCommand') {
            executeMcpCommand(request.command, request.params || {})
                .then((result) => sendResponse({ ok: true, result }))
                .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));
            return true; // respuesta asíncrona
        }
    });

    // Solo conectar automáticamente si el puente MCP fue habilitado explícitamente (?mcp=1 o mcpBridgeEnabled)
    if (isMcpBridgeEnabled()) {
        connectOrchestratorWebSocket(true);
    }
}

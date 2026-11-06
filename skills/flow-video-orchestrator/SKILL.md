---
name: flow-video-orchestrator
description: Motor Generador de Guion JSON (basado 100% en el Master Prompt de la extensión), Orquestador Autónomo de Producción de Video (Flow / Veo 3 / Gemini / Vids / Facereels) y Editor en Vivo. Úsalo siempre que el usuario pida crear un video de un tema, generar un guion JSON, orquestar la extensión para Flow/Veo3, reintentar escenas fallidas o editar escenas/videos existentes.
---

# Flow / Veo 3 Video Orchestrator, Master Prompt Script Engine & Live Editor

Eres el **Motor Generador de Guion JSON**, **Orquestador de Todo el Video** y **Editor en Vivo** conectado a la extensión de Chrome `AI Auto-Prompt` a través de `flow-veo3-mcp` (`http://127.0.0.1:3847` / `ws://127.0.0.1:3847/ws`).

---

## 🚨 REGLA DE ORO SOBRE HYPERFRAMES Y REMOTION (MANDATORIA)

1. **POR DEFECTO (cuando el usuario NO mencione explícitamente HyperFrames ni Remotion en su prompt)**:
   - **PROHIBIDO usar HyperFrames o Remotion.**
   - Todo el flujo (Guion JSON -> Personajes `@Tag` -> Imágenes -> Vídeos en Flow/Veo3 -> Edición -> Renderizado final) se ejecuta **100% en el pipeline nativo de la extensión** (`render_native_backend` / Facereels Studio).
2. **SOLO CUANDO EL USUARIO LO PIDA EXPLÍCITAMENTE EN SU PROMPT** (ej. *"edítalo con hyperframes"*, *"ármalo usando remotion"*, *"agrégale efectos en hyperframes"*):
   - Exporta los clips/imágenes generados por la extensión con `node flow-veo3-mcp/cli.js flow_export_assets_to_disk @export_args.json` (`"editorMode": "hyperframes"` o `"remotion"`).
   - Edita y renderiza el `.mp4` final usando `hyperframes-renderer` o `remotion-renderer`.

---

## 🧠 FLUJO 1: MOTOR GENERADOR DE GUION JSON (100% MASTER PROMPT)

Cuando el usuario te pida hacer un video sobre cualquier tema:

1. **Obtener el Master Prompt oficial**:
   Usa la herramienta MCP `flow_get_master_prompt` (o vía CLI `node flow-veo3-mcp/cli.js flow_get_master_prompt @args.json`).
2. **Construir el Guion JSON (`currentStoryboard`) obedeciendo el 100% del Master Prompt**:
   - Incluye `titulo_proyecto`, `formato` (`"9:16"` o `"16:9"`), `personajes` (con `tag` `@Nombre`, `nombre`, `rol`, `prompt`, `ancla_visual`, `perfil_vocal`), `hero_assets` (`@entorno`, `@objeto`), `biblia_serie`, `socialMetadata` y `escenas`.
   - En cada escena de `escenas`:
     - `prompt` (imagen): Bloques `[ENTORNO: ...]` + `Frame Inicial (t=0.0s):` con `@Tags`, acción y `[CÁMARA: ...]`.
     - `animPrompt` (video Veo 3): Enumerado con `escena-X:`, con los bloques `🗣️ DIÁLOGO` y `🎭 COREOGRAFÍA DE CÁMARA & TENSIÓN DE PROXIMIDAD` (`GANCHO`, `ESCALAMIENTO`, `REMATE`), más `tipo_corte` (`corte_directo` / `j_cut`) y `tipo_transicion` (`MANTENER_AMBIENTE` / `CAMBIO_LOCACION`).

---

## 🎬 FLUJO 2: ORQUESTACIÓN COMPLETA DE LA EXTENSIÓN

1. **Verificar conexión con Chrome**: `flow_status`
2. **Inyectar el Guion**: `flow_inject_storyboard`
3. **Ejecutar el Pipeline Completo**: `flow_run_full_pipeline`
4. **Exportar los videos generados a disco**: `flow_export_assets_to_disk`

---

## 🎨 FLUJO 3: GENERACIÓN INDIVIDUAL STANDALONE (IMÁGENES, VÍDEOS Y MÚSICA)

El MCP detecta de forma inteligente si la app web de destino ya está abierta en Chrome: **NO recarga ni redirige**, reutiliza la pestaña abierta e inyecta al instante. Si no está abierta, la abre automáticamente.

1. **Generar una Imagen Individual**: `flow_generate_image` (`engine`: `"flow"` o `"gemini"`, `aspectRatio`: `"1:1"`, `"9:16"`, `"16:9"`, `"4:3"`, `"3:4"`).
2. **Generar un Vídeo Individual**: `flow_generate_video` (`engine`: `"flow"`, `"gemini_omni"`, `"vids"`).
3. **Generar Música de Fondo**: `flow_generate_music` (`engine`: `"lyria"`, `"gemini"`, `"flow_music"`).

---

## 🛡️ FLUJO 4: REGLA DE REINTENTOS INTELIGENTES (MÁXIMO 3 INTENTOS EN LA MISMA SESIÓN)

Cuando falle una imagen o un video en Flow / Veo 3:
- **Límite duro**: Máximo **3 intentos en total** por escena (`Intento 1` original + `Intento 2` reajuste semántico/políticas + `Intento 3` simplificación visual segura). **Jamás quedarse en un bucle infinito.**
- **En la MISMA sesión**: Se reutiliza la misma pestaña activa de Flow sin perder los `@personajes` ni abrir pestañas duplicadas (`flow_regenerate_scene_image`, `flow_regenerate_scene_video`).

---

## ✂️ FLUJO 5: MODO EDITOR ("SI HAY ALGO QUE NO ME GUSTA, TÚ EDITARÁS")

1. **Edición sobre el video/proyecto normal**: `flow_edit_storyboard`
2. **Edición con HyperFrames o Remotion (SOLO si el usuario lo pide en el prompt)**: `flow_export_assets_to_disk` con `"editorMode": "hyperframes"` o `"remotion"`.

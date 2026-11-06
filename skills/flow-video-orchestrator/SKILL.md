---
name: flow-video-orchestrator
description: Motor Generador de Medios Individuales (Imagen, Vídeo con Ingredientes, Voz en Off, Música en Flow / Veo 3 / Gemini / Vids), Motor de Guion JSON (Master Prompt) y Orquestador Híbrido con HyperFrames / Remotion / Nativo.
---

# Flow / Veo 3 / Gemini / Vids MCP — Generador Individual de Medios & Orquestador

Estás conectado a Google Chrome (`AI Auto-Prompt`) mediante **`flow-veo3-mcp`** (`http://127.0.0.1:3847` / `ws://127.0.0.1:3847/ws`).

---

## 🎯 MODO 1: GENERACIÓN INDIVIDUAL MODULAR (PARA COMBINAR CON HYPERFRAMES, REMOTION O EDICIÓN A MEDIDA)

Usa estas herramientas individuales cuando el usuario te pida:
- Generar **1 imagen** o **varias imágenes individuales** (en Flow, Gemini o Vids).
- Generar **1 video** o **clips individuales con ingredientes `@Tag`** (en Flow Veo 3, Gemini Omni/Veo o Google Vids).
- Hacer un video **combinando Flow/Gemini/Vids + HyperFrames o Remotion** (ej. *"hazme un video con Flow y agrégale subtítulos y efectos con HyperFrames"*, o *"hazme un video con imágenes, voz en off y efectos en HyperFrames"*).

### Herramientas Individuales (Guardan automáticamente el archivo en disco y devuelven `savedFilePath`):

1. **Registrar o Generar un Ingrediente (`@Tag`)**:
   ```powershell
   node flow-veo3-mcp/cli.js flow_add_ingredient @ingrediente.json
   ```
   - Ejemplo JSON:
     ```json
     {
       "tag": "@protagonista",
       "name": "Protagonista",
       "type": "character",
       "description": "Joven de 25 años con chaqueta de cuero roja y mirada intensa",
       "image": "ruta/opcional.png",
       "generateInFlow": true,
       "outputPath": "workspace-assets/mi-video/personaje.png"
     }
     ```

2. **Generar 1 Imagen Individual (`flow_generate_image`)**:
   - Soporta motores: `"flow"` (Google Flow Imagen 3), `"gemini"` (Google Gemini Imagen 3), `"vids"` (Google Vids), `"google_images"`.
   - Soporta aspectos: `"9:16"`, `"16:9"`, `"1:1"`, `"4:3"`, `"3:4"`.
   - Adjunta automáticamente cualquier `@tag` en `ingredients` o escrito en el `prompt`.
   - Descarga y guarda el `.png` en `outputPath` y devuelve `savedFilePath`.
   ```json
   {
     "prompt": "@protagonista en una calle lluviosa de Tokio con luces de neón, plano medio 85mm",
     "engine": "flow",
     "aspectRatio": "9:16",
     "ingredients": ["@protagonista"],
     "outputPath": "workspace-assets/mi-video/img_01.png"
   }
   ```

3. **Generar 1 Vídeo Individual con Ingredientes o Fotogramas (`flow_generate_video`)**:
   - Soporta motores: `"flow"` (Flow Veo 3), `"gemini_omni"` (Gemini Omni Video / Veo), `"vids"` (Google Vids Veo 3).
   - Soporta `videoMode`: `"ingredients"` (genera directo desde texto + `@tags`) o `"frames"` (anima `baseImage`).
   - Soporta `aspectRatio`: `"9:16"`, `"16:9"`, `"1:1"` y `duration`: `"4s"`, `"8s"`.
   - Espera al 100%, descarga el `.mp4` a `outputPath` y devuelve `savedFilePath`.
   ```json
   {
     "prompt": "@protagonista camina hacia la cámara bajo la lluvia de neón mientras dice: 'Nunca debiste subestimarme', cámara lenta cinematográfica",
     "engine": "flow",
     "videoMode": "ingredients",
     "aspectRatio": "9:16",
     "duration": "8s",
     "ingredients": ["@protagonista"],
     "outputPath": "workspace-assets/mi-video/clip_01.mp4"
   }
   ```

4. **Generar Voz en Off Individual (`flow_generate_voiceover`)**:
   - Sintetiza locución en `.mp3` y devuelve `savedFilePath` listo para sincronizar subtítulos y audio en HyperFrames/Remotion/FFmpeg.
   ```json
   {
     "text": "En el corazón de la ciudad, nadie imaginaba lo que estaba a punto de ocurrir.",
     "lang": "es",
     "outputPath": "workspace-assets/mi-video/voz_01.mp3"
   }
   ```

5. **Generar Música de Fondo Individual (`flow_generate_music`)**:
   - Motores: `"lyria"` (Google Vids Lyria 3), `"gemini"` (Modo Música), `"flow_music"` (Flow Music web).
   ```json
   {
     "prompt": "Dark cyberpunk synthwave with deep bass and cinematic tension",
     "engine": "lyria",
     "duration": "full"
   }
   ```

### Flujo de Trabajo cuando el usuario pide HyperFrames o Remotion:
1. Genera los clips `.mp4` con `flow_generate_video` o las imágenes `.png` con `flow_generate_image` (y si pide locución, usa `flow_generate_voiceover`).
2. Toma las rutas locales devueltas en `savedFilePath` y cópialas al proyecto de **HyperFrames** (`hyperframes-renderer/`) o **Remotion** (`remotion-renderer/`).
3. Añade los subtítulos animados, efectos visuales, transiciones y renderiza el `.mp4` final.

---

## 🧠 MODO 2: PIPELINE COMPLETO CON MASTER PROMPT (CUANDO NO SE PIDE HYPERFRAMES NI REMOTION)

Si el usuario pide un video completo por tema y **NO menciona HyperFrames ni Remotion**:
1. Obtén el Master Prompt con `flow_get_master_prompt`.
2. Inyecta el guion JSON con `flow_inject_storyboard`.
3. Ejecuta `flow_run_full_pipeline` y exporta con `flow_export_assets_to_disk`.

---

## 🛡️ REGLA ESTRICTA DE REINTENTOS (MÁX. 3 INTENTOS EN LA MISMA SESIÓN)

- Si una imagen o video falla en Flow/Veo3, se reintenta en la misma sesión ajustando el prompt hasta un máximo estricto de **3 intentos totales** (`1 original + 2 reintentos`). Jamás permitas bucles infinitos.

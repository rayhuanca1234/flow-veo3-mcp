---
name: flow-lite-mcp
description: MCP ultraligero y veloz para generar imágenes, vídeos (con consistencia obligatoria de personajes/entornos/objetos @name y UUID, envío en bloque secuencial no bloqueante o con videoChain, Start/End Frame), música y voz directamente en las apps web (Google Flow, Gemini, Google Vids) almacenando los UUIDs en registry.json y PROHIBIENDO el renderizado final automático en la web/extensión.
---

# ⚡ `flow-lite-mcp` — Generador Directo Ultraligero y Lote Secuencial (Flow / Gemini / Vids)

Usa esta skill para generar **personajes/entornos/objetos base (`@name`)**, **imágenes**, **vídeos en bloque secuencial (`lite_generate_video_batch`) o individuales (`lite_generate_video`)**, **música** y **voz** directamente en las aplicaciones web de Google Flow, Gemini y Google Vids.

---

## 🚨 REGLAS ARQUITECTÓNICAS OBLIGATORIAS (CONTRATO DE PRODUCCIÓN)

### 1. Primero Entidades Base con `@name` (`@personaje`, `@entorno`, `@objeto`) → Obtener UUIDs en Flow
Antes de crear las escenas o los vídeos, **SIEMPRE debes asegurar primero los ingredientes base** para mantener consistencia total:
- **Opción A (Generar con `@name` directamente en Flow)**: Llama a `lite_register_ingredient` pasando `tag: "@nombre"`, `type: "character" | "location" | "prop"`, `description: "..."` y `generateInFlow: true`. El MCP genera en Google Flow la hoja de diseño con su etiqueta `@nombre` en el prompt (9:16 para personajes 1x1, 16:9 para entornos y objetos), captura su **`uuid` oficial de Flow** y lo guarda en `flow-lite-mcp/registry.json`.
- **Opción B (Generar con tu motor de imagen y subir a Flow)**: Genera la imagen del personaje/entorno/objeto y súbela a Google Flow con `lite_register_ingredient` pasando `tag: "@nombre"` e `image: "ruta/local.png"`. El MCP la sube a Google Flow con el nombre `@nombre`, obtiene su **`uuid` de Flow** y lo guarda en `flow-lite-mcp/registry.json`.
- **Reutilización Posterior**: Usa siempre esos `@tags` o `UUIDs` en el array `ingredients: ["@heroe", "@mansion_oscura", "@reloj_dorado"]` tanto al generar imágenes base de escenas (`lite_generate_image`) como al enviar a generar los vídeos (`lite_generate_video_batch` / `lite_generate_video`).

### 2. Lanzamiento en Bloque Secuencial No Bloqueante vs. `videoChain` (`lite_generate_video_batch`)
Cuando generes múltiples escenas de vídeo, **usa `lite_generate_video_batch`**:
- **Modo por defecto (`videoChain: false`) — Envío en Bloque Secuencial Inmediato (Igual que en la Extensión de Flow)**:
  - Se envía a generar la **Escena 1** en Google Flow.
  - **Apenas la Escena 1 fue enviada al composer (`releaseSubmitLock`)**, el MCP lanza **de inmediato la Escena 2, luego la Escena 3, etc.**, **SIN esperar los ~60s a que termine de generarse el vídeo anterior**. Todos los vídeos se renderizan en paralelo en Google Flow y el MCP descarga cada `.mp4` al terminar.
- **Modo `videoChain: true` (Continuidad de Escenario / Ingrediente de Vídeo Previo)**:
  - Si `videoChain: true` está activo (a nivel global o en una escena específica `scenes[i].chainFromPrevious = true` que requiere continuidad estricta del escenario/acción anterior), el MCP **SÍ espera a que termine de generarse la escena `N-1`** antes de lanzar la escena `N`, y adjunta automáticamente el vídeo resultante de `N-1` (su UUID) como ingrediente base de continuidad en la escena `N`.

### 3. ⛔ PROHIBIDO EL RENDERIZADO EN EL MCP / EXTENSIÓN WEB
- **Está 100% PROHIBIDO que la extensión o el MCP rendericen una escena sola o el vídeo final (`mcpSuppressAutoRender = true`)**.
- El MCP **SOLO obtiene y descarga los videoclips `.mp4` individuales generados en las apps web** a tu disco local (`savedFilePath`).
- **Recién cuando TODOS los videoclips hayan finalizado de generarse**, tú (el agente) realizarás aquí el ensamblaje/renderizado final mediante comandos locales de **FFmpeg** (o editarás con **HyperFrames** / **Remotion** si el usuario lo solicita).

---

## 🛠️ Flujo Paso a Paso Recomendado

### Paso 1: Crear / Subir Personajes, Entornos y Objetos con `@name` y Obtener sus UUIDs
```powershell
node flow-lite-mcp/cli.js lite_register_ingredient @ingrediente.json
```
Ejemplo de `ingrediente.json` (generado en Flow con `@name` o subido desde disco):
```json
{
  "tag": "@rey_hades",
  "name": "Rey del Hades",
  "type": "character",
  "description": "Hombre imponente de ojos carmesí y gabardina negra bajo la lluvia, iluminación cinematográfica 8k",
  "generateInFlow": true,
  "aspectRatio": "9:16"
}
```
*(Para entornos usa `"type": "location", "aspectRatio": "16:9"`, y para objetos `"type": "prop", "aspectRatio": "16:9"`).*

### Paso 2: Lanzar las Escenas de Vídeo en Bloque Secuencial (`lite_generate_video_batch`)
```powershell
node flow-lite-mcp/cli.js lite_generate_video_batch @batch_scenes.json
```
Ejemplo de `batch_scenes.json`:
```json
{
  "engine": "flow",
  "videoMode": "ingredients",
  "aspectRatio": "9:16",
  "duration": "8s",
  "videoChain": false,
  "scenes": [
    {
      "tag": "@escena_1",
      "prompt": "@rey_hades camina dentro de @templo_oscuro empuñando @espada_runica, cámara dolly-in lento, 8k",
      "ingredients": ["@rey_hades", "@templo_oscuro", "@espada_runica"],
      "chainFromPrevious": false,
      "outputPath": "workspace-assets/mi-video/escena_01.mp4"
    },
    {
      "tag": "@escena_2",
      "prompt": "@rey_hades alza @espada_runica en @templo_oscuro desatando relámpagos dorados",
      "ingredients": ["@rey_hades", "@templo_oscuro", "@espada_runica"],
      "chainFromPrevious": false,
      "outputPath": "workspace-assets/mi-video/escena_02.mp4"
    }
  ]
}
```

### Paso 3: Ensamblar con FFmpeg (o HyperFrames) Solo Cuando Todos los Clips Estén Listos
Una vez descargados todos los `.mp4` de `lite_generate_video_batch`, únelos o edítalos localmente con `ffmpeg` o `hyperframes`.

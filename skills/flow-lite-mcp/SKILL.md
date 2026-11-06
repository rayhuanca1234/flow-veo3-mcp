---
name: flow-lite-mcp
description: MCP ultraligero y veloz para generar imágenes, vídeos (con UUIDs de ingredientes, Start Frame y End Frame), música y voz directamente en las apps web (Google Flow, Gemini, Google Vids) almacenando automáticamente los UUIDs en registry.json.
---

# ⚡ `flow-lite-mcp` — Generador Directo Ultraligero (Flow / Gemini / Vids)

Usa esta skill cuando el usuario pida generar **1 imagen**, **1 vídeo** (con ingredientes o animando fotogramas `startFrame` / `endFrame`), **música** o **voz** de forma individual y rápida, sin crear storyboards completos.

## Regla de Oro de Velocidad
1. **No leas archivos extensos**: ejecuta directamente `node flow-lite-mcp/cli.js <herramienta> '<json>'` (o `@ruta.json`).
2. **Memoria automática de UUIDs (`flow-lite-mcp/registry.json`)**:
   - Cada imagen o ingrediente generado en Google Flow guarda su `uuid` (ej. `45f9e51d-bc1c-4e99-b428-38a66b955d06`) y su `@tag` en `flow-lite-mcp/registry.json`.
   - Para usar una imagen previa como ingrediente o como fotograma inicial/final (`startFrame` / `endFrame`), puedes pasar su **UUID exacto**, su **`@tag`** o `"last_image"`.

## Comandos Rápidos (`node flow-lite-mcp/cli.js`)

1. **Ver estado y último UUID guardado**:
   ```powershell
   node flow-lite-mcp/cli.js lite_status
   ```
2. **Listar UUIDs guardados o escanear en vivo los UUIDs de la pestaña abierta de Google Flow**:
   ```powershell
   node flow-lite-mcp/cli.js lite_list_assets "{\"scanFlow\":true}"
   ```
3. **Autoconfigurar controles de la web app (Flow / Gemini / Vids)**:
   ```powershell
   node flow-lite-mcp/cli.js lite_configure "{\"app\":\"flow\",\"type\":\"video\",\"videoMode\":\"frames\",\"aspectRatio\":\"16:9\",\"duration\":\"8s\"}"
   ```
4. **Generar Imagen Individual (con o sin UUIDs de ingredientes)**:
   ```powershell
   node flow-lite-mcp/cli.js lite_generate_image "{\"prompt\":\"...\",\"engine\":\"flow\",\"aspectRatio\":\"16:9\",\"ingredients\":[\"45f9e51d-bc1c-4e99-b428-38a66b955d06\"],\"tag\":\"@mi_img\",\"outputPath\":\"workspace-assets/standalone/img.png\"}"
   ```
5. **Generar Vídeo Individual (Modo `frames` con `startFrame` / `endFrame` o Modo `ingredients`)**:
   ```powershell
   node flow-lite-mcp/cli.js lite_generate_video "{\"prompt\":\"...\",\"engine\":\"flow\",\"videoMode\":\"frames\",\"startFrame\":\"45f9e51d-bc1c-4e99-b428-38a66b955d06\",\"aspectRatio\":\"16:9\",\"duration\":\"8s\",\"outputPath\":\"workspace-assets/standalone/video.mp4\"}"
   ```
6. **Registrar Ingrediente (`@tag` + UUID o imagen local)**:
   ```powershell
   node flow-lite-mcp/cli.js lite_register_ingredient "{\"tag\":\"@perro_gato\",\"uuid\":\"45f9e51d-bc1c-4e99-b428-38a66b955d06\"}"
   ```
7. **Generar Música (`lyria`, `gemini`, `flow_music`) o Voz (`lite_generate_voiceover`)**:
   ```powershell
   node flow-lite-mcp/cli.js lite_generate_music "{\"prompt\":\"...\",\"engine\":\"lyria\"}"
   node flow-lite-mcp/cli.js lite_generate_voiceover "{\"text\":\"...\",\"outputPath\":\"workspace-assets/standalone/voz.mp3\"}"
   ```

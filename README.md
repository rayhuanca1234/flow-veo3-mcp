# flow-veo3-mcp 🚀

Servidor **MCP (Model Context Protocol)** estándar sobre `stdio` + **Agent Skill** + **Puente WebSocket Local** (`127.0.0.1:3847`) para controlar de forma autónoma, individual y completa la creación multimedia con Inteligencia Artificial en:
- 🌊 **Google Flow (Imagen 3 & Veo 3)**
- ✨ **Google Gemini (Imagen 3, Omni Video / Veo & Modo Música)**
- 🎞️ **Google Vids (Veo 3 & Música de Fondo con Lyria 3)**
- 🎧 **Flow Music (flowmusic.app)**

---

## 🎯 Capacidades Principales (Nivel Senior)

1. **Detección Inteligente de Pestañas (Zero-Reload / Sin Redirección Innecesaria)**:
   - Si la app web requerida (**Google Flow**, **Google Gemini**, **Google Vids** o **Flow Music**) ya está abierta en tu Chrome, el MCP **NO recarga ni navega de nuevo**. Se engancha de inmediato a la pestaña activa e inyecta la generación al instante.
   - Si la app web no está abierta, el orquestador la abre automáticamente en tu perfil de Chrome y procede a la inyección.

2. **Generación Individual de Imágenes (`flow_generate_image`)**:
   - Motores: `flow` (Google Flow Imagen 3/4) o `gemini` (Google Gemini Imagen 3).
   - Relaciones de aspecto configurables: `1:1` (cuadrado), `9:16` (vertical reels/tiktok), `16:9` (horizontal youtube), `4:3`, `3:4`.
   - Soporte de ingredientes `@Tag` para mantener consistencia de personajes y locaciones.

3. **Generación Individual de Vídeos (`flow_generate_video`)**:
   - Motores: `flow` (Veo 3), `gemini` (Omni Video / Veo) o `vids` (Google Vids).
   - Modos: `ingredients` (directo con `@personaje` sin requerir imagen base) o `frames` (animación de imagen previa).
   - Controles de cámara, duraciones (`4s`, `8s`) y resoluciones (`360p`, `720p`).

4. **Generación de Música de Fondo (`flow_generate_music`)**:
   - Motores: `lyria` (Google Vids con **Lyria 3**), `gemini` (Google Gemini en **Modo Música**) o `flow_music` (Flow Music web).
   - Estilos musicales, atmósferas/mood y duraciones (`15s`, `30s`, `60s`, `full`).

5. **Orquestador Autónomo Completo (`flow_run_full_pipeline`)**:
   - Generación de guion JSON bajo el 100% de las reglas del Master Prompt oficial.
   - Regla estricta de reintentos: Máximo 3 intentos por escena (`1 original + 2 reintentos`) en la misma sesión activa, sin bucles infinitos.
   - Ensamblado y renderizado final nativo en Facereels Studio.

---

## ⚡ Instalación y Uso Rápido (Zero-Config)

Agrega este bloque a tu archivo de configuración de MCP (ej. `mcp_config.json`, `claude_desktop_config.json` o la configuración de MCP de Antigravity):

```json
{
  "mcpServers": {
    "flow-veo3": {
      "command": "npx",
      "args": [
        "-y",
        "github:rayhuanca1234/flow-veo3-mcp"
      ]
    }
  }
}
```

> **Consejo**: Abre Google Chrome en tu cuenta habitual y ten activa la extensión **AI Auto-Prompt**. No requieres configurar nada más.

---

## 🛠️ Herramientas Expuestas (MCP Tools)

| Herramienta | Descripción |
|---|---|
| `flow_generate_image` | Genera una imagen en Google Flow o Gemini con `aspectRatio` (`1:1`, `9:16`, `16:9`, etc.) e ingredientes `@Tag`. Reutiliza la pestaña abierta si ya existe. |
| `flow_generate_video` | Genera un clip de video en Flow (Veo 3), Gemini (Omni) o Google Vids con modo `ingredients` o `frames`. |
| `flow_generate_music` | Crea música instrumental de fondo en Google Vids (**Lyria 3**), Google Gemini o Flow Music. |
| `flow_add_ingredient` | Registra ingredientes o personajes de referencia (`@personaje`, `@locacion`, `@objeto`) para usarlos en prompts. |
| `flow_list_models` | Consulta el catálogo completo de modelos disponibles en Flow, Gemini, Vids y Lyria. |
| `flow_launch_app` | Activa o abre la app web deseada (`flow`, `gemini`, `vids`, `flow_music`) en tu Chrome sin recargar. |
| `flow_run_full_pipeline` | Orquesta la producción completa de un video desde el guion hasta el renderizado final. |
| `flow_get_master_prompt` | Obtiene la plantilla del Master Prompt oficial para construir guiones de alta retención. |
| `flow_status` | Verifica el estado de conexión del puente WebSocket y la extensión de Chrome. |

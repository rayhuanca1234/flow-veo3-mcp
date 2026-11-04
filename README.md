# flow-veo3-mcp 🚀

Servidor **MCP (Model Context Protocol)** estándar sobre `stdio` + **Agent Skill** + **Puente WebSocket Local** (`127.0.0.1:3847`) para controlar de forma autónoma la generación de **Imágenes** y **Vídeos** en:
- 🌊 **Google Flow (Veo 3 & Imagen 3)**
- ✨ **Google Gemini (Omni Video / Veo & Imagen 3)**
- 🎞️ **Google Vids (Veo 3)**

Incluye **Modo Ingredientes (@Tag)** para consistencia de personajes, control total de **relaciones de aspecto (9:16, 16:9, 1:1, etc.)**, duraciones (4s/8s), calidades (360p/720p) y **detección automática del perfil/cuenta de Google Chrome** en Windows para saltar directamente la pantalla de "¿Qué perfil de Chrome quieres usar?".

---

## ⚡ Instalación y Uso Rápido para Cualquier Persona

Cualquier persona puede agregar este servidor MCP directamente en su cliente favorito (**Antigravity, Claude Desktop, Cursor, Continue**, etc.).

### Opción A: Ejecución directa con NPX desde GitHub (Sin descargar nada)

Agrega esto a tu archivo de configuración de MCP (ej. `mcp_config.json` o `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "flow-veo3": {
      "command": "npx",
      "args": [
        "-y",
        "github:rayhuanca1234/flow-veo3-mcp"
      ],
      "env": {
        "account": "tu_correo@gmail.com"
      }
    }
  }
}
```

### Opción B: Ejecución local con Node.js

1. Clona el repositorio:
   ```bash
   git clone https://github.com/rayhuanca1234/flow-veo3-mcp.git
   cd flow-veo3-mcp
   ```
2. Agrega la ruta a tu archivo de configuración MCP:
   ```json
   {
     "mcpServers": {
       "flow-veo3": {
         "command": "node",
         "args": [
           "C:/ruta/a/flow-veo3-mcp/mcp-stdio.js"
         ],
         "env": {
           "account": "tu_correo@gmail.com"
         }
       }
     }
   }
   ```

---

## 👤 Selección Automática de Cuenta en Google Chrome (`account`)

Si tienes múltiples perfiles en Google Chrome, Chrome suele abrir el modal **"¿Qué perfil de Chrome quieres usar?"**.

Con este MCP, al configurar la variable de entorno `"account"`:
- Puede ser tu correo: `"cutecathardsennin@gmail.com"`, `"hardynhuanca@gmail.com"`
- O tu nombre de perfil en Chrome: `"cutecat2047"`, `"black"`, `"Big dady"`
- O el directorio interno: `"Profile 7"`, `"Profile 13"`, `"Default"`

El servidor MCP inspecciona automáticamente `%LOCALAPPDATA%\Google\Chrome\User Data\Local State`, localiza la carpeta del perfil y arranca Chrome con `--profile-directory="Profile X"`, **abriendo tu cuenta de Google específica directamente sin interrupciones**.

---

## 🛠️ Herramientas Expuestas (MCP Tools)

### 1. `flow_generate_image`
Genera imágenes cinematográficas o fotográficas en Flow, Gemini o Vids:
* **`prompt`** *(string, requerido)*: Prompt descriptivo de la imagen.
* **`engine`** *(enum)*: `"flow"` (Imagen 3 en Flow), `"gemini"` (Imagen 3 en Gemini), `"vids"` (Google Vids), `"google_images"`.
* **`aspectRatio`** *(enum)*: `"9:16"` (TikTok/Reels/Shorts), `"16:9"` (YouTube), `"1:1"` (Instagram Feed), `"4:3"`, `"3:4"`.
* **`ingredients`** *(array)*: Lista de ingredientes a asociar (`[{ "tag": "@carlos", "image": "ruta/o/base64" }]` o tags ya registrados).
* **`style`** *(string)*: Estilo visual (*"cinemático 35mm", "anime 3d", "plastilina"*).

### 2. `flow_generate_video`
Genera vídeos en Google Flow (Veo 3), Google Gemini (Omni Video) o Google Vids (Veo 3):
* **`prompt`** *(string, requerido)*: Instrucciones de movimiento, cámara, iluminación y atmósfera.
* **`engine`** *(enum)*: `"flow"`, `"gemini_omni"`, `"vids"`.
* **`videoMode`** *(enum)*:
  * `"ingredients"`: **Generación directa a partir de texto e ingredientes `@Tag`** sin imagen base previa.
  * `"frames"`: **Image-to-Video**, anima una imagen previa indicada en `baseImage`.
* **`modelFamily`** *(en Flow)*:
  * `"Omni 1.1 Flash"` (Recomendado oficial Google Flow).
  * `"Veo 3.1 Fast"` (Generación rápida 720p).
  * `"Veo 3 Quality"` (Máxima fidelidad cinematográfica).
* **`aspectRatio`** *(enum)*: `"9:16"`, `"16:9"`, `"1:1"`.
* **`duration`** *(enum)*: `"4s"`, `"8s"`.
* **`resolution`** *(enum)*: `"360p"`, `"720p"`.
* **`outputsCount`** *(enum)*: `"x1"`, `"x2"`, `"x4"`.
* **`baseImage`** *(string)*: Ruta local en disco, URL o base64 (requerido para modo `"frames"`).
* **`ingredients`** *(array)*: Personajes u objetos `@Tag` a incorporar.

### 3. `flow_add_ingredient`
Registra un personaje, locación, objeto o estilo visual:
* **`tag`** *(string, requerido)*: Etiqueta `@Nombre` (ej. `"@carlos"`, `"@laboratorio"`).
* **`name`** *(string)*: Nombre descriptivo.
* **`type`** *(enum)*: `"character"`, `"location"`, `"prop"`, `"style"`.
* **`image`** *(string)*: Ruta de archivo local en disco, URL HTTP o base64 DataURL *(se convierte automáticamente a memoria para Chrome)*.
* **`description`** *(string)*: Rasgos físicos y ancla visual.

### 4. `flow_list_models`
Devuelve el catálogo de todos los modelos, relaciones de aspecto y capacidades de Flow, Gemini y Vids.

### 5. `flow_list_accounts`
Lista todos los perfiles de Chrome encontrados en el sistema, mostrando cuál coincide con la variable `account`.

### 6. `flow_launch_chrome`
Abre Google Chrome en la cuenta especificada navegando a Flow (`https://labs.google.com/flow`), Gemini o Vids.

### 7. Orquestación Completa de Guiones y Producción
* `flow_status`: Verifica conexión en vivo con la extensión Chrome.
* `flow_get_master_prompt`: Extrae el Master Prompt oficial con Biblia Vocal y plantillas.
* `flow_autoconfig_project`: Autoconfigura selectores, ratios y opciones.
* `flow_inject_storyboard`: Inyecta el guion JSON al tablero.
* `flow_edit_storyboard`: Edita quirúrgicamente escenas, diálogos o personajes.
* `flow_regenerate_scene_image`: Regenera la imagen de una escena con máx. 3 intentos inteligentes en la misma sesión.
* `flow_regenerate_scene_video`: Regenera el vídeo de una escena con máx. 3 intentos y suavizado semántico si hay bloqueo de políticas.
* `flow_run_full_pipeline`: Orquesta todo de principio a fin (Personajes -> Imágenes -> Vídeos -> Render Nativo).
* `flow_export_assets_to_disk`: Guarda los MP4s, PNGs y el JSON en disco.
* `flow_cancel_all`: Cancela cualquier generación activa.

---

## 📄 Licencia

MIT © Hardyn Huanca / Antigravity Team

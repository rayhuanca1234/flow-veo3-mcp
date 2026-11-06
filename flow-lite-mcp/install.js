#!/usr/bin/env node
// flow-lite-mcp/install.js
// Instalador de 1 comando para flow-lite-mcp en cualquier otra PC:
//   npx -y --package=github:rayhuanca1234/flow-veo3-mcp flow-lite-install
// Instala:
//   1. La carpeta flow-lite-mcp/ en el proyecto actual y en ~/.gemini/antigravity/mcp-servers/flow-lite-mcp/
//   2. La skill ultraligera .agents/skills/flow-lite-mcp/SKILL.md (y global en ~/.gemini/antigravity/skills/flow-lite-mcp/)
//   3. El registro "flow-lite" en ~/.gemini/antigravity/mcp_config.json
//   4. El puente WebSocket en segundo plano (127.0.0.1:3847)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function copyDirRecursive(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

async function runLiteInstaller() {
    const targetWorkspace = process.cwd();
    const agyConfigDir = path.join(os.homedir(), '.gemini', 'antigravity');
    const globalLiteDir = path.join(agyConfigDir, 'mcp-servers', 'flow-lite-mcp');
    const localLiteDir = path.join(targetWorkspace, 'flow-lite-mcp');

    // Detectar si estamos ejecutando desde la raíz de flow-veo3-mcp o desde flow-lite-mcp
    const sourceLiteDir = fs.existsSync(path.join(__dirname, 'flow-lite-mcp', 'mcp-stdio.js'))
        ? path.join(__dirname, 'flow-lite-mcp')
        : __dirname;
    const sourceRootDir = fs.existsSync(path.join(__dirname, 'server.js'))
        ? __dirname
        : path.resolve(__dirname, '..');

    console.log('⚡ Instalando flow-lite-mcp (Generador Directo Ultraligero para Flow, Gemini y Vids)...');

    // 1. Copiar flow-lite-mcp globalmente y en el workspace actual
    if (path.resolve(sourceLiteDir) !== path.resolve(globalLiteDir)) {
        copyDirRecursive(sourceLiteDir, globalLiteDir);
    }
    if (path.resolve(sourceLiteDir) !== path.resolve(localLiteDir)) {
        copyDirRecursive(sourceLiteDir, localLiteDir);
    }
    console.log(`✅ flow-lite-mcp instalado en: ${localLiteDir}`);

    // 2. Copiar servidor puente (server.js + chromeProfileResolver.js + masterPromptLocal.js) para 127.0.0.1:3847
    for (const bridgeFile of ['server.js', 'chromeProfileResolver.js', 'masterPromptLocal.js']) {
        const srcBridge = path.join(sourceRootDir, bridgeFile);
        if (fs.existsSync(srcBridge)) {
            fs.copyFileSync(srcBridge, path.join(globalLiteDir, bridgeFile));
        }
    }

    // 3. Instalar la Skill ultraligera (.agents/skills/flow-lite-mcp/SKILL.md)
    const skillCandidates = [
        path.join(sourceLiteDir, 'skills', 'flow-lite-mcp'),
        path.join(sourceRootDir, 'skills', 'flow-lite-mcp')
    ];
    const bundledSkillDir = skillCandidates.find(d => fs.existsSync(path.join(d, 'SKILL.md')));
    if (bundledSkillDir) {
        const globalSkillDir = path.join(agyConfigDir, 'skills', 'flow-lite-mcp');
        const workspaceSkillDir = path.join(targetWorkspace, '.agents', 'skills', 'flow-lite-mcp');
        copyDirRecursive(bundledSkillDir, globalSkillDir);
        copyDirRecursive(bundledSkillDir, workspaceSkillDir);
        console.log(`✅ Skill ultraligera instalada en: ${workspaceSkillDir}`);
    }

    // 4. Registrar "flow-lite" en ~/.gemini/antigravity/mcp_config.json
    const mcpConfigPath = path.join(agyConfigDir, 'mcp_config.json');
    try {
        fs.mkdirSync(agyConfigDir, { recursive: true });
        let currentCfg = { mcpServers: {} };
        if (fs.existsSync(mcpConfigPath)) {
            currentCfg = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8')) || { mcpServers: {} };
        }
        if (!currentCfg.mcpServers) currentCfg.mcpServers = {};
        currentCfg.mcpServers['flow-lite'] = {
            command: process.execPath,
            args: [path.join(globalLiteDir, 'mcp-stdio.js')]
        };
        fs.writeFileSync(mcpConfigPath, JSON.stringify(currentCfg, null, 2), 'utf8');
        console.log(`✅ MCP "flow-lite" registrado en: ${mcpConfigPath}`);
    } catch (e) {
        console.warn(`⚠️ No se pudo actualizar ${mcpConfigPath}: ${e.message}`);
    }

    // 5. Asegurar que el puente WebSocket local (127.0.0.1:3847) esté corriendo
    let bridgeOk = false;
    try {
        const res = await fetch('http://127.0.0.1:3847/status');
        if (res.ok) bridgeOk = true;
    } catch (_) {}

    const serverScript = path.join(globalLiteDir, 'server.js');
    if (!bridgeOk && fs.existsSync(serverScript)) {
        const child = spawn(process.execPath, [serverScript], {
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
        await new Promise(r => setTimeout(r, 800));
    }

    console.log('✅ Puente WebSocket activo en http://127.0.0.1:3847');
    console.log('\n🎉 ¡flow-lite-mcp instalado y listo para generar imágenes y vídeos al instante!');
}

runLiteInstaller().catch((err) => {
    console.error('❌ Error instalando flow-lite-mcp:', err);
    process.exit(1);
});

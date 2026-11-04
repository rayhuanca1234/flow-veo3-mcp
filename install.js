#!/usr/bin/env node
// flow-veo3-mcp/install.js
// Instalador NPX de 1 comando (npx flow-veo3-mcp).
// Funciona en cualquier PC del mundo sin requerir ningún código privado de Facereels.
// Copia permanentemente:
//   1. El servidor MCP en ~/.gemini/antigravity/mcp-servers/flow-veo3-mcp/ y .agents/flow-veo3-mcp/
//   2. La Skill en .agents/skills/flow-video-orchestrator/SKILL.md
//   3. El registro en ~/.gemini/antigravity/mcp_config.json
//   4. Inicia el puente WebSocket local en 127.0.0.1:3847

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function copyDirRecursive(src, dest) {
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

async function runInstaller() {
    const targetWorkspace = process.cwd();
    const agyConfigDir = path.join(os.homedir(), '.gemini', 'antigravity');
    const globalMcpDir = path.join(agyConfigDir, 'mcp-servers', 'flow-veo3-mcp');
    const localMcpDir = path.join(targetWorkspace, 'flow-veo3-mcp');

    console.log('🚀 Instalando flow-veo3-mcp (Servidor MCP + Skill para Antigravity)...');

    // 1. Instalar copia permanente global en ~/.gemini/antigravity/mcp-servers/flow-veo3-mcp
    if (path.resolve(__dirname) !== path.resolve(globalMcpDir)) {
        copyDirRecursive(__dirname, globalMcpDir);
    }
    console.log(`✅ Servidor MCP instalado globalmente en: ${globalMcpDir}`);

    // 2. Instalar copia en el workspace actual (flow-veo3-mcp/) si no es el mismo directorio
    if (path.resolve(__dirname) !== path.resolve(localMcpDir)) {
        copyDirRecursive(__dirname, localMcpDir);
    }

    // 3. Instalar la Skill en el workspace actual (.agents/skills/flow-video-orchestrator/SKILL.md)
    const bundledSkillDir = path.join(__dirname, 'skills', 'flow-video-orchestrator');
    const destSkillDir = path.join(targetWorkspace, '.agents', 'skills', 'flow-video-orchestrator');
    if (fs.existsSync(bundledSkillDir)) {
        copyDirRecursive(bundledSkillDir, destSkillDir);
        console.log(`✅ Skill instalada en: ${destSkillDir}`);
    }

    // 4. Registrar en ~/.gemini/antigravity/mcp_config.json apuntando a la ruta global permanente
    const mcpConfigPath = path.join(agyConfigDir, 'mcp_config.json');
    try {
        fs.mkdirSync(agyConfigDir, { recursive: true });
        let currentCfg = { mcpServers: {} };
        if (fs.existsSync(mcpConfigPath)) {
            currentCfg = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8')) || { mcpServers: {} };
        }
        if (!currentCfg.mcpServers) currentCfg.mcpServers = {};
        currentCfg.mcpServers['flow-veo3-mcp'] = {
            command: process.execPath,
            args: [path.join(globalMcpDir, 'mcp-stdio.js')]
        };
        fs.writeFileSync(mcpConfigPath, JSON.stringify(currentCfg, null, 2), 'utf8');
        console.log(`✅ MCP registrado en Antigravity: ${mcpConfigPath}`);
    } catch (e) {
        console.warn(`⚠️ No se pudo actualizar ${mcpConfigPath}: ${e.message}`);
    }

    // 5. Iniciar el puente WebSocket (127.0.0.1:3847) desde la ruta global permanente
    let bridgeOk = false;
    try {
        const res = await fetch('http://127.0.0.1:3847/status');
        if (res.ok) bridgeOk = true;
    } catch (e) { }

    if (!bridgeOk) {
        const child = spawn(process.execPath, [path.join(globalMcpDir, 'server.js')], {
            detached: true,
            stdio: 'ignore'
        });
        child.unref();
        await new Promise(r => setTimeout(r, 800));
    }

    console.log('✅ Puente WebSocket activo en http://127.0.0.1:3847 y ws://127.0.0.1:3847/ws');
    console.log('\n🎉 ¡Listo! Recarga tu extensión en chrome://extensions y pide tu video en el chat.');
}

runInstaller().catch((err) => {
    console.error('❌ Error instalando flow-veo3-mcp:', err);
    process.exit(1);
});

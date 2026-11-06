#!/usr/bin/env node
// flow-lite-mcp/cli.js
// CLI ultrarrápido de flow-lite-mcp: acepta @archivo.json, JSON directo o pares clave=valor (ej: aspectRatio=16:9 duration=8s)

import fs from 'node:fs';
import path from 'node:path';
import { invokeLiteTool, LITE_TOOLS } from './mcp-stdio.js';

function parseCliArgs(argv) {
    if (!argv || argv.length === 0) return {};
    const first = argv[0];

    // 1. @archivo.json
    if (first.startsWith('@')) {
        const filePath = path.resolve(process.cwd(), first.slice(1));
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }

    // 2. JSON string
    if (first.startsWith('{')) {
        try {
            return JSON.parse(first);
        } catch (_) {
            // Soportar JSON sin comillas de PowerShell: {scanFlow:true,aspectRatio:16:9}
            const normalized = first
                .replace(/([{,])\s*([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
                .replace(/:\s*([a-zA-Z0-9_@/\\:.-]+)\s*([,}])/g, (m, val, tail) => {
                    if (val === 'true' || val === 'false' || val === 'null' || /^-?\d+(\.\d+)?$/.test(val)) {
                        return `:${val}${tail}`;
                    }
                    return `:"${val}"${tail}`;
                });
            return JSON.parse(normalized);
        }
    }

    // 3. Pares clave=valor (ej: prompt="Un perro" aspectRatio=16:9 ingredients=uuid1,uuid2)
    const out = {};
    for (const token of argv) {
        const eqIdx = token.indexOf('=');
        if (eqIdx > 0) {
            const k = token.slice(0, eqIdx).trim();
            const rawV = token.slice(eqIdx + 1).trim();
            if (rawV === 'true') out[k] = true;
            else if (rawV === 'false') out[k] = false;
            else if (k === 'ingredients') out[k] = rawV.split(',').map(s => s.trim()).filter(Boolean);
            else out[k] = rawV;
        }
    }
    return out;
}

async function main() {
    const toolName = process.argv[2];
    const restArgs = process.argv.slice(3);

    if (!toolName || toolName === '--help' || toolName === '-h') {
        console.log('⚡ Herramientas disponibles en flow-lite-mcp:');
        for (const t of LITE_TOOLS) {
            console.log(`  - ${t.name}: ${t.description}`);
        }
        process.exit(0);
    }

    const args = parseCliArgs(restArgs);
    const result = await invokeLiteTool(toolName, args);
    console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
    process.exit(1);
});

// flow-veo3-mcp/cli.js
// Ejecutor CLI directo de las herramientas MCP de Flow / Veo 3 para Antigravity.

import fs from 'node:fs';
import path from 'node:path';
import { invokeMcpTool, MCP_TOOLS } from './mcp-stdio.js';

async function main() {
    const toolName = process.argv[2];
    const rawArg = process.argv[3];

    if (!toolName || toolName === '--help' || toolName === '-h') {
        console.log('Herramientas disponibles en flow-veo3-mcp:');
        MCP_TOOLS.forEach(t => console.log(`  - ${t.name}: ${t.description}`));
        process.exit(0);
    }

    let args = {};
    if (rawArg) {
        if (rawArg.startsWith('@')) {
            const filePath = path.resolve(process.cwd(), rawArg.slice(1));
            args = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } else {
            args = JSON.parse(rawArg);
        }
    }

    const result = await invokeMcpTool(toolName, args);
    console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }, null, 2));
    process.exit(1);
});

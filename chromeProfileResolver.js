// flow-veo3-mcp/chromeProfileResolver.js
// Detección automática y apertura de perfiles específicos de Google Chrome en Windows
// Soporta cuentas por correo (ej. "bigdadysector@gmail.com", "hardynhuanca@gmail.com"),
// por nombre de perfil ("Big dady", "black", "cutecat2047") o por directorio ("Profile 2", "Default").

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

export function getChromeUserDataDir() {
    return path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        'Google',
        'Chrome',
        'User Data'
    );
}

export function getChromeExecutablePath() {
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
    ];
    for (const c of candidates) {
        if (c && fs.existsSync(c)) return c;
    }
    return 'chrome.exe';
}

export function listChromeProfiles() {
    const localStatePath = path.join(getChromeUserDataDir(), 'Local State');
    if (!fs.existsSync(localStatePath)) {
        return [];
    }
    try {
        const raw = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
        const infoCache = raw.profile?.info_cache || {};
        const lastUsed = raw.profile?.last_used || null;
        const results = [];

        for (const [directory, info] of Object.entries(infoCache)) {
            const email = info.user_name || info.email || null;
            results.push({
                directory,
                name: info.name || directory,
                email,
                gaiaName: info.gaia_name || '',
                isDefault: directory === 'Default',
                isLastUsed: directory === lastUsed
            });
        }
        return results;
    } catch (e) {
        console.warn('[chromeProfileResolver] Error leyendo Local State:', e.message);
        return [];
    }
}

export function findChromeProfile(query = '') {
    const profiles = listChromeProfiles();
    const localStatePath = path.join(getChromeUserDataDir(), 'Local State');
    let lastUsed = null;
    if (fs.existsSync(localStatePath)) {
        try {
            const raw = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
            lastUsed = raw.profile?.last_used || null;
        } catch (_) {}
    }

    if (!query) {
        // 1. Si no hay query explícita, preferir el último perfil utilizado (ej. "Profile 2" / Big dady)
        if (lastUsed) {
            const matchLast = profiles.find(p => p.directory.toLowerCase() === String(lastUsed).toLowerCase());
            if (matchLast) return matchLast;
        }
        return profiles.find(p => p.isDefault) || profiles[0] || null;
    }

    const q = String(query).trim().toLowerCase();

    // 1. Coincidencia exacta por correo
    let match = profiles.find(p => p.email && p.email.toLowerCase() === q);
    if (match) return match;

    // 2. Coincidencia exacta por directorio (ej. "Profile 2" o "Default")
    match = profiles.find(p => p.directory.toLowerCase() === q);
    if (match) return match;

    // 3. Coincidencia exacta por nombre de perfil
    match = profiles.find(p => p.name.toLowerCase() === q);
    if (match) return match;

    // 4. Coincidencia parcial por correo o nombre
    match = profiles.find(p => (p.email && p.email.toLowerCase().includes(q)) || p.name.toLowerCase().includes(q));
    if (match) return match;

    // 5. Coincidencia por nombre gaia
    match = profiles.find(p => p.gaiaName && p.gaiaName.toLowerCase().includes(q));
    if (match) return match;

    return null;
}

export function launchChromeForProfile({
    account = process.env.account || process.env.ACCOUNT || '',
    targetUrl = 'https://labs.google.com/flow',
    extensionPath = null
} = {}) {
    const chromeExe = getChromeExecutablePath();
    const profile = findChromeProfile(account);
    const profileDir = profile ? profile.directory : (account || 'Default');

    const args = [
        `--profile-directory=${profileDir}`
    ];

    if (targetUrl) {
        args.push(targetUrl);
    }

    const child = spawn(chromeExe, args, {
        detached: true,
        stdio: 'ignore'
    });
    child.unref();

    return {
        launched: true,
        chromeExe,
        profileDirectory: profileDir,
        matchedProfile: profile,
        targetUrl
    };
}

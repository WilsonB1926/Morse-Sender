// share-link.js
// Versleutelde deel-links: de morse-tekst wordt AES-GCM versleuteld en in het URL-fragment (#c=...) geplaatst.
// Het wachtwoord zit NIET in de link; het wordt los meegestuurd (berichttekst of ander kanaal).
// Het fragment wordt nooit naar de server gestuurd, dus GitHub Pages ziet de inhoud niet.
// Vereist een beveiligde context (HTTPS) voor crypto.subtle - *.github.io is OK.

let generatedShareLink = null;
let generatedShareText = null;
let generatedPasswordText = null;
let generatedPassphrase = null;

const LINK_PBKDF2_ITERATIONS = 210000;
const LINK_SALT_BYTES = 16;
const LINK_IV_BYTES = 12;

function base64UrlEncode(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

// Wachtwoord zonder op het oog verwisselbare tekens (0/O, 1/l/I)
function generatePassphrase() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const rand = new Uint8Array(16);
    crypto.getRandomValues(rand);
    let s = '';
    for (let i = 0; i < 16; i++) s += alphabet[rand[i] % alphabet.length];
    return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16);
}

async function deriveLinkKey(passphrase, salt) {
    const baseKey = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt, iterations: LINK_PBKDF2_ITERATIONS, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

// Versleutelt de morse-string; return base64url(salt | iv | ciphertext)
async function encryptMorseForLink(morse, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(LINK_SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(LINK_IV_BYTES));
    const key = await deriveLinkKey(passphrase, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(morse));
    const payload = new Uint8Array(LINK_SALT_BYTES + LINK_IV_BYTES + ct.byteLength);
    payload.set(salt, 0);
    payload.set(iv, LINK_SALT_BYTES);
    payload.set(new Uint8Array(ct), LINK_SALT_BYTES + LINK_IV_BYTES);
    return base64UrlEncode(payload);
}

// Terugweg: gooit bij een onjuist wachtwoord of beschadigde data
async function decryptLinkPayload(b64url, passphrase) {
    const payload = base64UrlDecode(b64url);
    if (payload.length < LINK_SALT_BYTES + LINK_IV_BYTES + 16) throw new Error('Ongeldige link');
    const salt = payload.slice(0, LINK_SALT_BYTES);
    const iv = payload.slice(LINK_SALT_BYTES, LINK_SALT_BYTES + LINK_IV_BYTES);
    const ct = payload.slice(LINK_SALT_BYTES + LINK_IV_BYTES);
    const key = await deriveLinkKey(passphrase, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    const morse = new TextDecoder().decode(plain);
    if (!/^[.\- /]+$/.test(morse)) throw new Error('Ontsleutelde tekst is geen morse');
    return morse;
}

function buildShareLink(payloadB64url) {
    return location.href.split('#')[0] + '#c=' + payloadB64url;
}

function parseLinkPayload() {
    const h = location.hash || '';
    if (h.startsWith('#c=')) return h.slice(3);
    return null;
}

async function copyTextToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        // Fallback voor geweigerde permissie / oudere browsers
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
        document.body.removeChild(ta);
        return ok;
    }
}

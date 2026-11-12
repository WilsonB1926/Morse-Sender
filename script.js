// script.js
// Dit bestand regelt de knoppen, interface, timers en live audio

let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

// Het configuratie-object dat WPM omrekent naar milliseconden
const config = {
    get wpm() { return parseInt(document.getElementById('wpm-speed').value); },
    get isFarnsworth() { return document.getElementById('farnsworth-toggle').checked; },
    get farnsworthWpm() { return parseInt(document.getElementById('farnsworth-wpm').value); },
    get pitch() { return parseInt(document.getElementById('frequency').value); },

    get dotDuration() { return 1200 / this.wpm; },
    get dashDuration() { return this.dotDuration * 3; },
    get intraElementGap() { return this.dotDuration; },
    
    get letterGap() {
        const baseWpm = this.isFarnsworth ? this.farnsworthWpm : this.wpm;
        return (1200 / baseWpm) * 3;
    },
    get wordGap() {
        const baseWpm = this.isFarnsworth ? this.farnsworthWpm : this.wpm;
        return (1200 / baseWpm) * 7;
    }
};

const display = document.getElementById('display-container');

function playBeep(durationMs) {
    initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const durationSec = durationMs / 1000;
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = config.pitch;

    const now = audioCtx.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(1, now + 0.005); 
    gainNode.gain.setValueAtTime(1, now + durationSec - 0.005);
    gainNode.gain.linearRampToValueAtTime(0, now + durationSec);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start(now);
    oscillator.stop(now + durationSec);
}

// UI Event Handlers voor Typen
document.getElementById('dot-btn').addEventListener('click', () => {
    playBeep(config.dotDuration);
    display.textContent += '.';
    scrollToBottom();
});

document.getElementById('dash-btn').addEventListener('click', () => {
    playBeep(config.dashDuration);
    display.textContent += '-';
    scrollToBottom();
});

document.getElementById('space-btn').addEventListener('click', () => {
    if (display.textContent && !display.textContent.endsWith(' / ')) {
        display.textContent += ' / ';
        scrollToBottom();
    }
});

document.getElementById('backspace-btn').addEventListener('click', () => {
    let currentText = display.textContent;
    if (!currentText) return;

    if (currentText.endsWith(' / ')) {
        display.textContent = currentText.slice(0, -3);
    } else {
        display.textContent = currentText.slice(0, -1);
    }
    
    // Verberg de deelknop tot er opnieuw gegenereerd is
    document.getElementById('share-audio-btn').style.display = 'none';
    document.getElementById('copy-link-btn').style.display = 'none';
    document.getElementById('copy-pass-btn').style.display = 'none';
    generatedAudioBlob = null;
    generatedShareText = null;
    generatedPasswordText = null;
    scrollToBottom();
});

document.getElementById('clear-btn').addEventListener('click', () => {
    display.textContent = '';
    document.getElementById('share-audio-btn').style.display = 'none';
    document.getElementById('copy-link-btn').style.display = 'none';
    document.getElementById('copy-pass-btn').style.display = 'none';
    generatedAudioBlob = null;
    generatedShareText = null;
    generatedPasswordText = null;
});

document.getElementById('settings-toggle').addEventListener('click', () => {
    const panel = document.getElementById('settings-panel');
    const toggle = document.getElementById('settings-toggle');
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
        toggle.textContent = '⚙️ Show Settings';
    } else {
        panel.style.display = 'block';
        toggle.textContent = '⚙️ Hide Settings';
    }
});

document.getElementById('farnsworth-toggle').addEventListener('change', () => {
    const isChecked = document.getElementById('farnsworth-toggle').checked;
    const factorRow = document.getElementById('farnsworth-factor-row');
    const factorInput = document.getElementById('farnsworth-wpm');
    
    if (isChecked) {
        factorRow.style.opacity = "1";
        factorInput.disabled = false;
    } else {
        factorRow.style.opacity = "0.5";
        factorInput.disabled = true;
    }
});

// Koppel de knoppen aan de functies uit audio-generator.js
document.getElementById('play-string-btn').addEventListener('click', generateWavFile);
document.getElementById('share-audio-btn').addEventListener('click', shareWavFile);

// Decodeer een ontvangen audiobestand zodra de gebruiker een bestand kiest
document.getElementById('audio-file-input').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
        const result = await decodeAudioFile(file);
        document.getElementById('decode-morse').textContent = result.morse;
        document.getElementById('decode-text').textContent = result.text;
        document.getElementById('decode-output').style.display = 'block';
    } catch (error) {
        alert('Kon audiobestand niet decoderen: ' + error.message);
    }
    // Reset zodat hetzelfde bestand opnieuw gekozen kan worden
    event.target.value = '';
});

function scrollToBottom() {
    display.scrollTop = display.scrollHeight;
}

// ---- Pagina-navigatie: twee pagina's, swipe links-rechts of via knoppen/dots ----
const pagesEl = document.getElementById('pages');

function showPage(name) {
    const decoder = name === 'decoder';
    // scrollLeft resetten: bij overflow:hidden kan de browser de container verschuiven
    document.getElementById('viewport').scrollLeft = 0;
    pagesEl.classList.toggle('show-decoder', decoder);
    document.getElementById('nav-sender').classList.toggle('active', !decoder);
    document.getElementById('nav-decoder').classList.toggle('active', decoder);
    document.getElementById('dot-sender').classList.toggle('active', !decoder);
    document.getElementById('dot-decoder').classList.toggle('active', decoder);
}

document.getElementById('nav-sender').addEventListener('click', () => showPage('sender'));
document.getElementById('nav-decoder').addEventListener('click', () => showPage('decoder'));
document.getElementById('dot-sender').addEventListener('click', () => showPage('sender'));
document.getElementById('dot-decoder').addEventListener('click', () => showPage('decoder'));

function swipeBy(dx) {
    if (Math.abs(dx) < 30) return;
    const onDecoder = pagesEl.classList.contains('show-decoder');
    if (dx < 0 && !onDecoder) showPage('decoder');
    else if (dx > 0 && onDecoder) showPage('sender');
}

const viewport = document.getElementById('viewport');
let touchStartX = null;
viewport.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
function touchEnd(e) {
    if (touchStartX === null) return;
    swipeBy(e.changedTouches[0].clientX - touchStartX);
    touchStartX = null;
}
viewport.addEventListener('touchend', touchEnd, { passive: true });
viewport.addEventListener('touchcancel', touchEnd, { passive: true });

let mouseDownX = null;
viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, input, label, #display-container, #decode-output')) return;
    mouseDownX = e.clientX;
});
window.addEventListener('mouseup', (e) => {
    if (mouseDownX === null) return;
    swipeBy(e.clientX - mouseDownX);
    mouseDownX = null;
});

// ---- Versleutelde link (#c=...) afhandelen: opent direct de decoder-pagina ----
const linkPayload = parseLinkPayload();
if (linkPayload) {
    showPage('decoder');
    document.getElementById('link-passphrase-prompt').style.display = 'block';
    document.getElementById('link-pass-input').focus();
}

document.getElementById('link-decrypt-btn').addEventListener('click', async () => {
    const pass = document.getElementById('link-pass-input').value;
    if (!pass || !linkPayload) return;
    try {
        const morse = await decryptLinkPayload(linkPayload, pass);
        document.getElementById('decode-morse').textContent = morse;
        document.getElementById('decode-text').textContent = morseToText(morse);
        document.getElementById('decode-output').style.display = 'block';
        document.getElementById('link-passphrase-prompt').style.display = 'none';
    } catch (error) {
        alert('Ontgrendelen mislukt: onjuist wachtwoord of beschadigde link.');
    }
});

document.getElementById('link-pass-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') document.getElementById('link-decrypt-btn').click();
});

document.getElementById('copy-link-btn').addEventListener('click', async () => {
    if (!generatedShareText) return;
    const ok = await copyTextToClipboard(generatedShareText);
    const btn = document.getElementById('copy-link-btn');
    btn.textContent = ok ? 'Gekopieerd!' : 'Kopieer mislukt';
    setTimeout(() => { btn.textContent = 'Kopieer berichttekst'; }, 1500);
});

document.getElementById('copy-pass-btn').addEventListener('click', async () => {
    if (!generatedPasswordText) return;
    const ok = await copyTextToClipboard(generatedPasswordText);
    const btn = document.getElementById('copy-pass-btn');
    btn.textContent = ok ? 'Gekopieerd!' : 'Kopieer mislukt';
    setTimeout(() => { btn.textContent = 'Kopieer wachtwoord'; }, 1500);
});

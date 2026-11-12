// audio-generator.js
// Dit bestand regelt puur het genereren en delen van het .wav bestand

let generatedAudioBlob = null;

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

async function generateWavFile() {
    const text = display.textContent.trim();
    if (!text) {
        alert("Typ eerst wat morsecode op het scherm!");
        return;
    }

    const sampleRate = 44100;
    const hz = config.pitch;
    let timeline = [];
    
    // Splits tekst op in woorden en letters
    const words = text.split(' / ');
    
    words.forEach((word, wordIndex) => {
        const letters = word.split(' ');
        
        letters.forEach((letter, letterIndex) => {
            for (let i = 0; i < letter.length; i++) {
                const char = letter[i];
                if (char === '.') {
                    timeline.push({ tone: true, duration: config.dotDuration });
                } else if (char === '-') {
                    timeline.push({ tone: true, duration: config.dashDuration });
                }
                
                // Stilte binnenin de letter
                if (i < letter.length - 1) {
                    timeline.push({ tone: false, duration: config.intraElementGap });
                }
            }
            
            // Stilte tussen letters
            if (letterIndex < letters.length - 1) {
                timeline.push({ tone: false, duration: config.letterGap });
            }
        });
        
        // Stilte tussen woorden
        if (wordIndex < words.length - 1) {
            timeline.push({ tone: false, duration: config.wordGap });
        }
    });

    // Bereken samples en maak binaire data aan
    let totalMs = timeline.reduce((sum, item) => sum + item.duration, 0);
    let totalSamples = Math.ceil((totalMs / 1000) * sampleRate);
    
    let buffer = new ArrayBuffer(44 + totalSamples * 2);
    let view = new DataView(buffer);
    
    // WAV Header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + totalSamples * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, totalSamples * 2, true);
    
    // Vul de audio bits
    let currentSampleIndex = 0;
    timeline.forEach(item => {
        let itemSamples = Math.ceil((item.duration / 1000) * sampleRate);
        for (let i = 0; i < itemSamples; i++) {
            if (currentSampleIndex >= totalSamples) break;
            
            let sampleValue = 0;
            if (item.tone) {
                sampleValue = Math.sin(2 * Math.PI * hz * (currentSampleIndex / sampleRate));
                sampleValue = Math.max(-1, Math.min(1, sampleValue)) * 0.5 * 32767;
            }
            
            view.setInt16(44 + currentSampleIndex * 2, sampleValue, true);
            currentSampleIndex++;
        }
    });
    
    generatedAudioBlob = new Blob([buffer], { type: 'audio/wav' });
    document.getElementById('share-audio-btn').style.display = 'block';

    // Bouw de versleutelde deel-link (#c=...) en de accompanying tekst (link + wachtwoord)
    try {
        const passInput = document.getElementById('link-passphrase');
        generatedPassphrase = (passInput && passInput.value.trim()) || generatePassphrase();
        const payload = await encryptMorseForLink(text, generatedPassphrase);
        generatedShareLink = buildShareLink(payload);
        // Twee berichten: bericht 1 = tekst + link, bericht 2 = alleen het wachtwoord
        generatedShareText = 'Luister naar mijn morse bericht! Voor omzetting naar tekst: ' + generatedShareLink + '\nWachtwoord:';
        generatedPasswordText = generatedPassphrase;
        document.getElementById('copy-link-btn').style.display = 'block';
        document.getElementById('copy-pass-btn').style.display = 'block';
        // Wachtwoord meteen naar het klembord, zodat het direct meegestuurd kan worden
        copyTextToClipboard(generatedPassphrase);
    } catch (e) {
        console.log('Versleutelde link kon niet worden aangemaakt (vereist HTTPS):', e);
    }
    
    // Speel de zojuist gegenereerde track direct af
    const audioUrl = URL.createObjectURL(generatedAudioBlob);
    const audio = new Audio(audioUrl);
    audio.play();
}

async function shareWavFile() {
    if (!generatedAudioBlob) return;

    const filename = `morse-${Date.now()}.wav`;
    const file = new File([generatedAudioBlob], filename, { type: 'audio/wav' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({
                files: [file],
                title: 'Morse Code',
                text: generatedShareText || 'Luister naar mijn morse-bericht!'
            });
        } catch (error) {
            console.log('Delen mislukt of geannuleerd', error);
        }
    } else {
        if (generatedShareText) await copyTextToClipboard(generatedShareText);
        alert("Web Share niet ondersteund op dit apparaat. Download gestart. Berichttekst staat op het klembord; het wachtwoord kopieer je via 'Kopieer wachtwoord'.");
        const a = document.createElement('a');
        a.href = URL.createObjectURL(generatedAudioBlob);
        a.download = filename;
        a.click();
    }
}

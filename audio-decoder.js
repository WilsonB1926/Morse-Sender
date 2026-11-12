// audio-decoder.js
// Decodeert een ontvangen audiobestand (gegenereerd door deze app) terug naar morse en platte tekst.
// De DSP-kern is puur (alleen Float32Array + sampleRate) zodat deze los te testen is.

const MORSE_TABLE = {
    '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E',
    '..-.': 'F', '--.': 'G', '....': 'H', '..': 'I', '.---': 'J',
    '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N', '---': 'O',
    '.--.': 'P', '--.-': 'Q', '.-.': 'R', '...': 'S', '-': 'T',
    '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X', '-.--': 'Y',
    '--..': 'Z',
    '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4',
    '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
    '.-.-.-': '.', '--..--': ',', '..--..': '?', '-..-.': '/',
    '-.--.': '(', '-.--.-': ')', '.-...': '&', '---...': ':',
    '-.-.-.': ';', '-...-': '=', '.-.-.': '+', '-....-': '-',
    '..--.-': '_', '.-..-.': '"', '.----.': "'", '.--.-.': '@'
};

// Bepaalt de toonhoogte met een Goertzel-scan over het luidste 100 ms venster
function detectPitch(mono, sampleRate) {
    const winLen = Math.min(mono.length, Math.floor(sampleRate * 0.1));
    let bestStart = 0;
    let bestEnergy = -1;
    const hop = Math.max(1, Math.floor(winLen / 2));
    for (let s = 0; s + winLen <= mono.length; s += hop) {
        let e = 0;
        for (let i = s; i < s + winLen; i++) e += mono[i] * mono[i];
        if (e > bestEnergy) {
            bestEnergy = e;
            bestStart = s;
        }
    }
    let bestFreq = 600;
    let bestPower = -1;
    for (let f = 250; f <= 1300; f += 5) {
        const p = goertzelPower(mono, bestStart, winLen, f, sampleRate);
        if (p > bestPower) {
            bestPower = p;
            bestFreq = f;
        }
    }
    return bestFreq;
}

function goertzelPower(x, start, n, freq, sampleRate) {
    const coeff = 2 * Math.cos(2 * Math.PI * freq / sampleRate);
    let s0 = 0, s1 = 0, s2 = 0;
    for (let i = start; i < start + n; i++) {
        s0 = x[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

// Amplitude-envelop van de gedetecteerde toon: downmix naar DC + lopend gemiddelde (5 ms)
function computeEnvelope(mono, sampleRate, freq) {
    const win = Math.max(1, Math.round(sampleRate * 0.005));
    const env = new Float32Array(mono.length);
    const w = 2 * Math.PI * freq / sampleRate;
    const bufRe = new Float64Array(win);
    const bufIm = new Float64Array(win);
    let sumRe = 0, sumIm = 0;
    for (let i = 0; i < mono.length; i++) {
        const pRe = mono[i] * Math.cos(w * i);
        const pIm = mono[i] * -Math.sin(w * i);
        const idx = i % win;
        sumRe += pRe - bufRe[idx];
        sumIm += pIm - bufIm[idx];
        bufRe[idx] = pRe;
        bufIm[idx] = pIm;
        env[i] = Math.sqrt(sumRe * sumRe + sumIm * sumIm) / win;
    }
    return env;
}

// Zet de envelop om in runs van toon/stilte (ms) met hysterese
function extractRuns(env, sampleRate) {
    let max = 0;
    for (let i = 0; i < env.length; i++) if (env[i] > max) max = env[i];
    if (max <= 0) return [];
    const hi = max * 0.5;
    const lo = max * 0.25;
    const runs = [];
    let on = env[0] > lo;
    let start = 0;
    for (let i = 1; i < env.length; i++) {
        if (on && env[i] < lo) {
            runs.push({ tone: true, duration: (i - start) / sampleRate * 1000 });
            on = false;
            start = i;
        } else if (!on && env[i] > hi) {
            runs.push({ tone: false, duration: (i - start) / sampleRate * 1000 });
            on = true;
            start = i;
        }
    }
    runs.push({ tone: on, duration: (env.length - start) / sampleRate * 1000 });
    return runs;
}

// Verwijdert leading/trailing stilte en codec-glitches (bij <=35 WPM is het kortste element ~34 ms)
function cleanRuns(runs, minMs) {
    const out = [];
    for (const r of runs) {
        const last = out[out.length - 1];
        if (r.tone && r.duration < minMs) {
            if (last && !last.tone) last.duration += r.duration;
            else out.push({ tone: false, duration: r.duration });
        } else if (!r.tone && r.duration < minMs && last && last.tone) {
            last.duration += r.duration;
            last.absorbNext = true;
        } else if (r.tone && last && last.tone && last.absorbNext) {
            last.duration += r.duration;
            delete last.absorbNext;
        } else {
            out.push({ tone: r.tone, duration: r.duration });
        }
    }
    if (out.length && !out[0].tone) out.shift();
    if (out.length && !out[out.length - 1].tone) out.pop();
    return out;
}

// Schat de dot-duur (1 unit) uit alle runs: het minimum is ~1 unit, alles tot 1.6x daarvan hoort daarbij
function estimateUnit(runs) {
    const durations = runs.map(r => r.duration);
    const min = Math.min(...durations);
    const unitValues = durations.filter(d => d <= min * 1.6);
    return unitValues.reduce((a, b) => a + b, 0) / unitValues.length;
}

// Vertaalt runs naar een morse-string ('.', '-', spatie, ' / ')
function runsToMorse(runs) {
    const unit = estimateUnit(runs);
    // Bij Farnsworth zijn letter/woord-stiltes langer dan 3x/7x de dot: Bepaal daarom
    // de letter-stilte uit de kleinste cluster van de echte gaps (i.p.v. vaste 3x/7x grenzen)
    const gaps = runs.filter(r => !r.tone && r.duration >= unit * 2).map(r => r.duration);
    let letterRef = null;
    if (gaps.length) {
        const minGap = Math.min(...gaps);
        const cluster = gaps.filter(g => g <= minGap * 1.6);
        letterRef = cluster.reduce((a, b) => a + b, 0) / cluster.length;
    }
    let morse = '';
    for (const r of runs) {
        if (r.tone) {
            morse += r.duration < unit * 2 ? '.' : '-';
        } else if (r.duration < unit * 2) {
            // stilte binnen een letter: geen separator
        } else if (letterRef !== null && r.duration >= letterRef * 1.53) {
            // woord-stilte is ~7/3x de letter-stilte; grens op geometrisch gemiddelde
            morse += ' / ';
        } else {
            morse += ' ';
        }
    }
    return morse;
}

function morseToText(morse) {
    return morse.split(' / ').map(word =>
        word.split(' ').map(letter => MORSE_TABLE[letter] || '?').join('')
    ).join(' ');
}

// Kern: pure functie, ook los te testen zonder browser
function decodePcm(mono, sampleRate) {
    if (!mono || mono.length < sampleRate * 0.05) {
        throw new Error('Audiobestand is te kort');
    }
    const pitch = detectPitch(mono, sampleRate);
    const env = computeEnvelope(mono, sampleRate, pitch);
    let runs = extractRuns(env, sampleRate);
    runs = cleanRuns(runs, 20);
    if (!runs.length) throw new Error('Geen morse-signaal gevonden');
    const morse = runsToMorse(runs);
    return { morse, text: morseToText(morse), pitch };
}

// Browser-wrapper: bestand -> AudioBuffer -> mono -> decodePcm
async function decodeAudioFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let audioBuffer;
    try {
        audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    } finally {
        ctx.close();
    }
    const sampleRate = audioBuffer.sampleRate;
    const len = audioBuffer.length;
    const mono = new Float32Array(len);
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        const data = audioBuffer.getChannelData(ch);
        for (let i = 0; i < len; i++) mono[i] += data[i] / audioBuffer.numberOfChannels;
    }
    return decodePcm(mono, sampleRate);
}

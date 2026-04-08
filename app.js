// ==========================================
// 1. キャンバスの準備（スケーリング対応）
// ==========================================
const canvas = document.getElementById('waterSurface');
const ctx = canvas.getContext('2d');
const RENDER_SCALE = 0.5; 

function resizeCanvas() {
    canvas.width = window.innerWidth * RENDER_SCALE;
    canvas.height = window.innerHeight * RENDER_SCALE;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas(); 

// ==========================================
// 2. 音色設定（オーディオLOD：高低2種類のシンセ）
// ==========================================
const masterLimiter = new Tone.Limiter(-6).toDestination();
const FULL_SCALE = [36, 38, 40, 43, 45, 48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81];

const highSynth = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 8,
    oscillator: { type: "triangle" },
    envelope: { attack: 0.05, release: 1.5 }
}).connect(masterLimiter);

const lowSynth = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 16,
    oscillator: { type: "sine" },
    envelope: { attack: 0.04, release: 1.2 }
}).connect(masterLimiter);

highSynth.volume.value = -22;
lowSynth.volume.value = -6;

// ==========================================
// 3. 波紋クラス（オーディオLODロジック内蔵）
// ==========================================
class Ripple {
    constructor(x, y, speed, notes) {
        this.x = x; this.y = y; this.r = 0; this.speed = speed;
        this.hitFlags = [false, false, false, false];
        this.hitCount = 0;
        this.myNotes = notes;
    }

    update() {
        this.r += this.speed;
        const walls = [this.y, canvas.height - this.y, this.x, canvas.width - this.x];
        for (let i = 0; i < 4; i++) {
            if (this.r >= walls[i] && !this.hitFlags[i]) {
                if (this.hitCount < 4) {
                    const midi = this.myNotes[this.hitCount];
                    lowSynth.triggerAttackRelease(Tone.Frequency(midi, "midi"), "16n");
                    if (this.hitCount === 0) {
                        highSynth.triggerAttackRelease(Tone.Frequency(midi + 12, "midi"), "16n");
                    }
                    this.hitCount++;
                }
                this.hitFlags[i] = true;
            }
        }
    }

    draw(ctx) {
        const maxR = Math.sqrt(canvas.width**2 + canvas.height**2);
        let alpha = Math.max(0, 1 - (this.r / maxR));
        ctx.strokeStyle = `rgba(220, 240, 255, ${alpha})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.stroke();
    }

    isDead() { return this.hitFlags.every(f => f) && this.r > Math.max(canvas.width, canvas.height); }
}

// ==========================================
// 4. 操作系（速度検知 ＋ 軌道サンプリング）
// ==========================================
let ripples = [];
let isAudioStarted = false;
const activePointers = new Map();
const pointerTrails = new Map();

function spawnRipple(x, y, isHighRes = true) {
    if (ripples.length > 25) ripples.shift();
    const yRatio = 1 - (y / canvas.height);
    const startIdx = Math.floor(yRatio * (FULL_SCALE.length - 5));
    const currentNotes = FULL_SCALE.slice(startIdx, startIdx + 5);

    lowSynth.triggerAttackRelease(Tone.Frequency(currentNotes[0], "midi"), "16n");
    if (isHighRes) {
        highSynth.triggerAttackRelease(Tone.Frequency(currentNotes[0] + 12, "midi"), "16n");
    }

    ripples.push(new Ripple(x, y, (1.5 + (x / canvas.width)) * RENDER_SCALE, currentNotes.slice(1)));
}

canvas.addEventListener('pointerdown', async (e) => {
    if (activePointers.size >= 4) return;
    if (Tone.context.state !== 'running') await Tone.context.resume();
    if (!isAudioStarted) { await Tone.start(); isAudioStarted = true; }
    
    const pos = { x: e.clientX * RENDER_SCALE, y: e.clientY * RENDER_SCALE };
    activePointers.set(e.pointerId, pos);
    pointerTrails.set(e.pointerId, { lastPos: pos, lastTime: performance.now(), points: [pos] });
    spawnRipple(pos.x, pos.y, true);
});

canvas.addEventListener('pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    const pos = { x: e.clientX * RENDER_SCALE, y: e.clientY * RENDER_SCALE };
    const trail = pointerTrails.get(e.pointerId);
    trail.points.push(pos);
    const dist = Math.sqrt((pos.x - trail.lastPos.x)**2 + (pos.y - trail.lastPos.y)**2);

    if (dist > 100) {
        const duration = performance.now() - trail.lastTime;
        if (duration < 200) {
            const midPoint = trail.points[Math.floor(trail.points.length / 2)];
            const safeMid = midPoint ? { x: midPoint.x, y: midPoint.y } : null;
            const safeEnd = { x: pos.x, y: pos.y };

            if (safeMid) setTimeout(() => spawnRipple(safeMid.x, safeMid.y, false), 40);
            setTimeout(() => spawnRipple(safeEnd.x, safeEnd.y, false), 80);
        } else {
            spawnRipple(pos.x, pos.y, true);
        }
        trail.lastPos = pos; trail.lastTime = performance.now(); trail.points = [pos];
    }
});

function endPointer(e) { 
    activePointers.delete(e.pointerId); 
    pointerTrails.delete(e.pointerId); 
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

// ==========================================
// 5. アニメーションループ ＆ 呼吸するガイド演出
// ==========================================
function drawGuide(ctx, time) {
    if (isAudioStarted) return; 
    if (time < 3000) return;    

    const cycleTime = (time - 3000) % 16000;
    if (cycleTime > 6000) return; 

    let alpha = 0;
    let shrinkRatio = 0;

    if (cycleTime < 1500) {
        alpha = cycleTime / 1500;
    } else if (cycleTime < 4500) {
        alpha = 1.0;
        const pulseTime = cycleTime - 1500;
        // 0 〜 1 の間でサイン波の鼓動を作る
        shrinkRatio = (1 - Math.cos(pulseTime / 1500 * Math.PI * 2)) * 0.5; // 最大で1.0
    } else {
        alpha = 1.0 - ((cycleTime - 4500) / 1500);
    }

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    
    // ★バグ修正：画面が小さすぎても最低限のサイズ(30px)は確保する
    const baseR = Math.max(30, Math.min(canvas.width, canvas.height) * 0.1); 
    
    // ★バグ修正：固定値で引くのではなく、半径の割合(最大15%減)で縮ませる
    const r = baseR * (1 - shrinkRatio * 0.15);
    const innerR = r * 0.6; 

    // 外側のリング（念のため Math.max で 0.1 以上の半径を確約）
    ctx.strokeStyle = `rgba(220, 240, 255, ${alpha * 0.6})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.1, r), 0, Math.PI * 2);
    ctx.stroke();

    // 内側の淡い光
    ctx.fillStyle = `rgba(220, 240, 255, ${alpha * 0.2})`;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(0.1, innerR), 0, Math.PI * 2);
    ctx.fill();
}

function loop(time) {
    if (!time) time = performance.now();

    const g = ctx.createLinearGradient(0, canvas.height, canvas.width, 0);
    g.addColorStop(0, '#000c1a'); 
    g.addColorStop(0.15, '#003355'); 
    g.addColorStop(0.35, '#3388bb'); 
    g.addColorStop(1, '#77ccff');

    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = ripples.length - 1; i >= 0; i--) {
        ripples[i].update();
        ripples[i].draw(ctx);
        if (ripples[i].isDead()) {
            ripples.splice(i, 1);
        }
    }

    drawGuide(ctx, time);

    requestAnimationFrame(loop);
}

// ループ開始
requestAnimationFrame(loop);
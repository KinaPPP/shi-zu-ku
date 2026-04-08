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

// LOD 0：豪華な音（タップ時や最初の壁用）
const highSynth = new Tone.PolySynth(Tone.Synth, {
    maxPolyphony: 8,
    oscillator: { type: "triangle" },
    envelope: { attack: 0.05, release: 1.5 }
}).connect(masterLimiter);

// LOD 1：基本の音（全ての衝突用）
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
                    // ★LOD適用：どの衝突でも基本音は鳴らすが、キラキラ音は最初の壁だけ
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

    // タップ時（isHighRes=true）は豪華に、素早い移動での追加分は基本音のみ
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
            // 素早い時：軌道の中間地点に「LOD低」の波紋を時間差で置く
            const midIdx = Math.floor(trail.points.length / 2);
            setTimeout(() => spawnRipple(trail.points[midIdx].x, trail.points[midIdx].y, false), 40);
            setTimeout(() => spawnRipple(pos.x, pos.y, false), 80);
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
// 5. アニメーションループ（完全復活）
// ==========================================
function loop() {
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
    requestAnimationFrame(loop);
}

// 最後にしっかりループを開始！
loop();
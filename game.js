// Draft Punk — Game strip renderer v3
// Canvas background + particle system + sprite renderer
(function () {
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const FPS        = 60;
const ANIM_SPEED = 5;   // game ticks per sprite frame
const BOSS_ANIM_SPEED = 4;
const GROUND_PCT = 0.68; // ground line as fraction of bar height
const PLAYER_X_PCT  = 0.18;
const ENEMY_ENTER_X = 1.15; // starts off right edge (fraction of W)
const ENEMY_MID_X   = 0.62; // walks to here first
const ENEMY_CLOSE_X = 0.28; // then walks close to player (near touching)
const BOSS_MID_X    = 0.60;
const BOSS_CLOSE_X  = 0.30;
const PLAYER_HEIGHT = 58;   // px rendered height for player
const MONSTER_HEIGHT= 52;   // px rendered height for monsters
const BOSS_HEIGHT   = 78;   // px rendered height for bosses
const DEATH_HEIGHT  = 60;
const BOSS_WINDOW   = 3;    // % before boss threshold to start approach
const MINION_WINDOW = 3;    // % before minion threshold

// ── Level palettes ────────────────────────────────────────────────────────────
const LEVELS = [
    { sky0:'#02020e',sky1:'#07071e',gnd:'#08081a',ln:'#0ff',ptcl:'stars',pc:'#6af',
      L:[{sp:.10,st:98,mH:45,xH:90,ty:'rect',c:'#0a0a1e',ww:1},{sp:.26,st:58,mH:18,xH:48,ty:'rect',c:'#0d0d28',ww:1},{sp:.56,st:36,mH:7,xH:20,ty:'rect',c:'#111132'}]},
    { sky0:'#000d00',sky1:'#011601',gnd:'#020e02',ln:'#0e8',ptcl:'firefly',pc:'#afa',
      L:[{sp:.08,st:78,mH:55,xH:95,ty:'tri',c:'#030f03'},{sp:.22,st:46,mH:28,xH:58,ty:'tri',c:'#051305'},{sp:.54,st:26,mH:12,xH:32,ty:'tri',c:'#081808'}]},
    { sky0:'#090415',sky1:'#140622',gnd:'#110620',ln:'#c0f',ptcl:'stars',pc:'#d8f',
      L:[{sp:.10,st:88,mH:38,xH:70,ty:'rect',c:'#0f0520'},{sp:.28,st:52,mH:16,xH:40,ty:'tri',c:'#160828'},{sp:.56,st:32,mH:7,xH:22,ty:'rect',c:'#190a30'}]},
    { sky0:'#170400',sky1:'#2c0700',gnd:'#1e0500',ln:'#f60',ptcl:'spark',pc:'#f80',
      L:[{sp:.08,st:115,mH:18,xH:50,ty:'rect',c:'#1b0600'},{sp:.22,st:68,mH:9,xH:28,ty:'rect',c:'#250800'},{sp:.54,st:40,mH:4,xH:14,ty:'tri',c:'#2e0900'}]},
    { sky0:'#0b0900',sky1:'#191500',gnd:'#171100',ln:'#fc0',ptcl:'dust',pc:'#b80',
      L:[{sp:.07,st:145,mH:26,xH:52,ty:'mesa',c:'#150f00'},{sp:.20,st:85,mH:11,xH:30,ty:'mesa',c:'#1d1500'},{sp:.54,st:42,mH:4,xH:13,ty:'rect',c:'#251b00'}]},
    { sky0:'#00070d',sky1:'#000f1e',gnd:'#000d18',ln:'#0af',ptcl:'stars',pc:'#08f',
      L:[{sp:.06,st:195,mH:11,xH:26,ty:'wave',c:'#000d1c'},{sp:.18,st:110,mH:7,xH:20,ty:'wave',c:'#001420'},{sp:.46,st:55,mH:3,xH:12,ty:'wave',c:'#001a28'}]},
    { sky0:'#060012',sky1:'#0d0022',gnd:'#09001a',ln:'#f0f',ptcl:'rain',pc:'#a4f',
      L:[{sp:.10,st:76,mH:62,xH:115,ty:'rect',c:'#0b001c',ww:1},{sp:.24,st:46,mH:30,xH:68,ty:'rect',c:'#0f0026',ww:1},{sp:.54,st:27,mH:11,xH:30,ty:'rect',c:'#13002e'}]},
    { sky0:'#010c01',sky1:'#021502',gnd:'#020f02',ln:'#4f4',ptcl:'spore',pc:'#8f8',
      L:[{sp:.08,st:56,mH:56,xH:98,ty:'tri',c:'#020d02'},{sp:.18,st:34,mH:34,xH:76,ty:'tri',c:'#031204'},{sp:.40,st:21,mH:15,xH:46,ty:'tri',c:'#041706'}]},
    { sky0:'#020210',sky1:'#05051c',gnd:'#070712',ln:'#88f',ptcl:'snow',pc:'#ccf',
      L:[{sp:.05,st:175,mH:70,xH:130,ty:'tri',c:'#060610'},{sp:.14,st:95,mH:36,xH:78,ty:'tri',c:'#080818'},{sp:.38,st:48,mH:13,xH:36,ty:'tri',c:'#0a0a20'}]},
    { sky0:'#0b0300',sky1:'#160600',gnd:'#0f0400',ln:'#f44',ptcl:'smoke',pc:'#844',
      L:[{sp:.08,st:98,mH:50,xH:90,ty:'pipe',c:'#150600'},{sp:.20,st:56,mH:26,xH:58,ty:'pipe',c:'#1d0800'},{sp:.54,st:32,mH:7,xH:26,ty:'rect',c:'#240b00'}]},
    { sky0:'#010101',sky1:'#020204',gnd:'#030305',ln:'#224',ptcl:'stars',pc:'#224',
      L:[{sp:.05,st:195,mH:16,xH:55,ty:'rect',c:'#030306'},{sp:.15,st:115,mH:7,xH:30,ty:'rect',c:'#040408'},{sp:.40,st:56,mH:3,xH:15,ty:'rect',c:'#05050a'}]},
    { sky0:'#0b0001',sky1:'#1a0002',gnd:'#140002',ln:'#f02',ptcl:'ember',pc:'#f04',
      L:[{sp:.08,st:76,mH:25,xH:55,ty:'stlct',c:'#170003'},{sp:.20,st:46,mH:11,xH:36,ty:'stlct',c:'#1e0004'},{sp:.54,st:27,mH:4,xH:17,ty:'rect',c:'#260005'}]},
    { sky0:'#0d0600',sky1:'#1c0c00',gnd:'#150900',ln:'#f80',ptcl:'ember',pc:'#fa4',
      L:[{sp:.08,st:88,mH:26,xH:55,ty:'tri',c:'#170800'},{sp:.22,st:52,mH:11,xH:30,ty:'rect',c:'#1f0b00'},{sp:.56,st:31,mH:4,xH:17,ty:'tri',c:'#271100'}]},
    { sky0:'#140900',sky1:'#241400',gnd:'#1c0d00',ln:'#fda',ptcl:'spark',pc:'#fd0',
      L:[{sp:.08,st:96,mH:36,xH:75,ty:'rect',c:'#1c0d00'},{sp:.20,st:56,mH:17,xH:46,ty:'tri',c:'#241100'},{sp:.54,st:31,mH:5,xH:21,ty:'rect',c:'#2c1500'}]},
    { sky0:'#060606',sky1:'#101010',gnd:'#0d0d0d',ln:'#eee',ptcl:'stars',pc:'#eef',
      L:[{sp:.06,st:145,mH:26,xH:65,ty:'rect',c:'#0d0d0d'},{sp:.18,st:76,mH:11,xH:36,ty:'tri',c:'#111111'},{sp:.46,st:37,mH:3,xH:17,ty:'rect',c:'#151515'}]},
];

// ── Particle system ───────────────────────────────────────────────────────────
const MAX_PTCL = 55;
let ptcl = [], ptclType = 'stars', ptclCol = '#88f', ptclTimer = 0;

function spawnPtcl() {
    if (ptcl.length >= MAX_PTCL) return;
    const p = { t: ptclType, col: ptclCol, a: 1 };
    if (p.t==='stars')   { p.x=Math.random()*W; p.y=Math.random()*H*0.62; p.r=0.6+Math.random()*1.4; p.ph=Math.random()*6.28; }
    else if (p.t==='rain')    { p.x=Math.random()*(W+40); p.y=-8; p.vx=-1.8; p.vy=5+Math.random()*3; p.len=7+Math.random()*7; }
    else if (p.t==='ember'||p.t==='spark') { p.x=Math.random()*W; p.y=H*0.72+Math.random()*H*0.28; p.vx=(Math.random()-0.5)*1.2; p.vy=-(0.8+Math.random()*1.8); p.r=1+Math.random()*2; p.a=0.7+Math.random()*0.3; }
    else if (p.t==='snow')    { p.x=Math.random()*W; p.y=-4; p.vx=-0.3+Math.random()*0.6; p.vy=0.6+Math.random()*0.8; p.r=1+Math.random()*2; }
    else if (p.t==='firefly') { p.x=Math.random()*W; p.y=H*0.32+Math.random()*H*0.45; p.vx=(Math.random()-0.5)*0.4; p.vy=(Math.random()-0.5)*0.3; p.ph=Math.random()*6.28; p.r=1.8; }
    else if (p.t==='spore')   { p.x=Math.random()*W; p.y=H*0.5+Math.random()*H*0.35; p.vx=(Math.random()-0.5)*0.3; p.vy=-(0.2+Math.random()*0.5); p.r=1.2; p.a=0.6+Math.random()*0.4; }
    else if (p.t==='smoke')   { p.x=Math.random()*W; p.y=H*0.05+Math.random()*H*0.3; p.vx=(Math.random()-0.5)*0.4; p.vy=-(0.3+Math.random()*0.4); p.r=4+Math.random()*5; p.a=0.12+Math.random()*0.12; }
    else if (p.t==='dust')    { p.x=-10; p.y=H*0.58+Math.random()*H*0.3; p.vx=0.6+Math.random()*0.8; p.vy=(Math.random()-0.5)*0.25; p.r=1+Math.random()*2; p.a=0.3+Math.random()*0.3; }
    ptcl.push(p);
}

function tickPtcl(t) {
    ptcl = ptcl.filter(function(p) {
        if (p.t==='stars')   { p.ph+=0.025; p.a=0.4+0.4*Math.sin(p.ph); return true; }
        if (p.t==='rain')    { p.x+=p.vx; p.y+=p.vy; return p.y<H+10; }
        if (p.t==='ember'||p.t==='spark') { p.x+=p.vx+Math.sin(t*0.04+p.y)*0.3; p.y+=p.vy; p.a-=0.008; return p.a>0&&p.y>0; }
        if (p.t==='snow')    { p.x+=p.vx+Math.sin(t*0.02+p.y*0.05)*0.3; p.y+=p.vy; return p.y<H+6; }
        if (p.t==='firefly') { p.ph+=0.03; p.a=0.3+0.6*Math.abs(Math.sin(p.ph)); p.x+=p.vx; p.y+=p.vy; if(p.x<0||p.x>W)p.vx*=-1; if(p.y<H*0.1||p.y>H*GROUND_PCT)p.vy*=-1; return true; }
        if (p.t==='spore')   { p.x+=p.vx; p.y+=p.vy; p.a-=0.004; return p.a>0&&p.y>0; }
        if (p.t==='smoke')   { p.x+=p.vx; p.y+=p.vy; p.r+=0.1; p.a-=0.003; return p.a>0.01; }
        if (p.t==='dust')    { p.x+=p.vx; p.y+=p.vy; return p.x<W+10; }
        if (p.t==='burst')   { p.x+=p.vx; p.y+=p.vy; p.vy+=0.12; p.a-=0.025; return p.a>0; }
        return false;
    });
}

function drawPtcl() {
    ptcl.forEach(function(p) {
        ctx.save();
        ctx.globalAlpha = Math.max(0,Math.min(1,p.a));
        ctx.fillStyle = ctx.strokeStyle = p.col;
        if (p.t==='rain') { ctx.lineWidth=0.8; ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x+p.vx*1.4,p.y+p.len); ctx.stroke(); }
        else { ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.28); ctx.fill(); }
        ctx.restore();
    });
}

// ── Background shapes ─────────────────────────────────────────────────────────
function drawRect(x,gy,w,h){ ctx.fillRect(x,gy-h,w,h); }
function drawTri(x,gy,w,h){ ctx.beginPath(); ctx.moveTo(x,gy); ctx.lineTo(x+w*0.5,gy-h); ctx.lineTo(x+w,gy); ctx.closePath(); ctx.fill(); }
function drawMesa(x,gy,w,h){ const t=w*0.28; ctx.beginPath(); ctx.moveTo(x,gy); ctx.lineTo(x+w*0.18,gy-h); ctx.lineTo(x+w*0.18+t,gy-h); ctx.lineTo(x+w,gy); ctx.closePath(); ctx.fill(); }
function drawWave(x,gy,w,h){ ctx.beginPath(); ctx.moveTo(x,gy); ctx.bezierCurveTo(x+w*0.3,gy-h,x+w*0.7,gy-h,x+w,gy); ctx.closePath(); ctx.fill(); }
function drawPipe(x,gy,w,h){ const pw=Math.max(4,w*0.35); ctx.fillRect(x,gy-h,pw,h); ctx.beginPath(); ctx.arc(x+pw*0.5,gy-h,pw*0.75,Math.PI,0); ctx.fill(); }
function drawStlct(x,gy,w,h){ ctx.beginPath(); ctx.moveTo(x,gy); ctx.lineTo(x+w*0.15,gy-h*0.55); ctx.lineTo(x+w*0.35,gy-h*0.3); ctx.lineTo(x+w*0.5,gy-h); ctx.lineTo(x+w*0.65,gy-h*0.35); ctx.lineTo(x+w*0.85,gy-h*0.6); ctx.lineTo(x+w,gy); ctx.closePath(); ctx.fill(); }
function drawWindows(bx,by,bw,bh){ const cols=Math.max(1,Math.floor(bw/9)); const rows=Math.max(1,Math.floor(bh/13)); const seed=((bx|0)*137+currentLevel*53); ctx.fillStyle='rgba(255,240,160,0.28)'; for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) if(((seed+r*7+c*11)%5)===0) ctx.fillRect(bx+c*9+2,by+r*13+3,4,6); }

function drawLayer(lyr, groundY, scrollOff) {
    const step=lyr.st, off=(scrollOff*lyr.sp)%(step*18);
    const startI=Math.floor(off/step)-1, count=Math.ceil(W/step)+3;
    ctx.fillStyle=lyr.c;
    for(let i=startI;i<startI+count;i++){
        const x=i*step-off;
        const s1=((i*1231+currentLevel*311)>>>0&0xffff)/65535;
        const s2=((i*2377+currentLevel*537)>>>0&0xffff)/65535;
        const h=lyr.mH+(lyr.xH-lyr.mH)*s1, w=step*0.38+step*0.34*s2;
        switch(lyr.ty){
            case 'rect': drawRect(x,groundY,w,h); break;
            case 'tri':  drawTri(x,groundY,w,h);  break;
            case 'mesa': drawMesa(x,groundY,w,h); break;
            case 'wave': drawWave(x,groundY,w,h); break;
            case 'pipe': drawPipe(x,groundY,w,h); break;
            case 'stlct':drawStlct(x,groundY,w,h);break;
        }
        if(lyr.ww) drawWindows(x,groundY-h,w,h);
    }
}

function drawBackground() {
    const lv=LEVELS[Math.min(currentLevel,LEVELS.length-1)];
    const gy=Math.floor(H*GROUND_PCT);
    const sg=ctx.createLinearGradient(0,0,0,gy);
    sg.addColorStop(0,lv.sky0); sg.addColorStop(1,lv.sky1);
    ctx.fillStyle=sg; ctx.fillRect(0,0,W,gy);
    ctx.fillStyle=lv.gnd; ctx.fillRect(0,gy,W,H-gy);
    lv.L.forEach(function(lyr){ drawLayer(lyr,gy,scrollX); });
    ctx.strokeStyle=lv.ln; ctx.lineWidth=1; ctx.globalAlpha=0.4;
    ctx.beginPath(); ctx.moveTo(0,gy); ctx.lineTo(W,gy); ctx.stroke();
    ctx.globalAlpha=1;
    ctx.fillStyle=lv.ln; ctx.globalAlpha=0.1;
    const ds=50, doff=(scrollX*0.88)%(ds*2);
    for(let i=-1;i<Math.ceil(W/ds)+2;i++) ctx.fillRect(i*ds*2-doff,gy+3,24,2);
    ctx.globalAlpha=1;
}

// ── Image cache + loader ──────────────────────────────────────────────────────
const imgCache = {};
function loadImg(src) {
    if (imgCache[src]) return imgCache[src];
    const img = new Image();
    img.src = src;
    imgCache[src] = img;
    return img;
}
function preloadFrames(frames) {
    if (!frames) return;
    frames.forEach(function(src) { loadImg(src); });
}

// ── Manifest ──────────────────────────────────────────────────────────────────
let manifest = null;

function loadManifest(cb) {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'game-manifest.json');
    xhr.onload = function() {
        if (xhr.status === 200) {
            try { manifest = JSON.parse(xhr.responseText); } catch(e) { manifest = null; }
        }
        if (manifest) {
            window.gameManifest = manifest;
            if (window.onGameManifestReady) window.onGameManifestReady();
        }
        cb();
    };
    xhr.onerror = function() { cb(); };
    xhr.send();
}

function preloadAll() {
    if (!manifest) return;
    // Preload players eagerly
    const selectedKey = getSelectedPlayer();
    const pd = manifest.players[selectedKey];
    if (pd) Object.values(pd).forEach(function(v) { if(Array.isArray(v)) preloadFrames(v); });
    // Preload first death sprites
    Object.values(manifest.deaths).forEach(function(frames) { if(frames&&frames[0]) loadImg(frames[0]); });
    Object.values(manifest.bossDeaths).forEach(function(frames) { if(frames&&frames[0]) loadImg(frames[0]); });
}

// ── Player selection ──────────────────────────────────────────────────────────
const PLAYER_KEYS = ['PlayerA','PlayerB','PlayerC','PlayerD'];

function getSelectedPlayer() {
    return localStorage.getItem('selectedPlayer') || 'PlayerA';
}

window.setSelectedPlayer = function(key) {
    localStorage.setItem('selectedPlayer', key);
    playerKey = key;
    playerFrames = getPlayerFrames(key);
    playerAnim = 'Idle';
    playerFrame = 0;
    playerFrameTimer = 0;
};

function getPlayerFrames(key) {
    if (!manifest || !manifest.players[key]) return {};
    return manifest.players[key];
}

// ── Sprite drawing ────────────────────────────────────────────────────────────
// refH: height of the reference frame (e.g. Idle/Walk first frame).
// All frames of an entity scale by the same factor so characters stay consistent size.
// Larger attack canvases extend upward naturally rather than shrinking the character.
function drawSprite(frames, frameIdx, x, groundY, targetH, flipX, refH) {
    if (!frames || !frames.length) return;
    const idx = Math.min(Math.max(0, frameIdx), frames.length - 1);
    const img = loadImg(frames[idx]);
    if (!img.complete || !img.naturalWidth) return;

    const baseH = refH || img.naturalHeight;
    const scale = targetH / baseH;
    const dw    = img.naturalWidth  * scale;
    const dh    = img.naturalHeight * scale; // may exceed targetH for bigger canvases
    const dy    = groundY - dh;

    ctx.save();
    if (flipX) {
        ctx.translate(x + dw, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, dy, dw, dh);
    } else {
        ctx.drawImage(img, x, dy, dw, dh);
    }
    ctx.restore();
}

// Draw death effect centred on x position
function drawDeathSprite(frames, frameIdx, centreX, groundY) {
    if (!frames || !frames.length) return;
    const idx = Math.min(Math.max(0, frameIdx), frames.length - 1);
    const img = loadImg(frames[idx]);
    if (!img.complete || !img.naturalWidth) return;
    const scale = DEATH_HEIGHT / img.naturalHeight;
    const dw = img.naturalWidth * scale;
    const dh = DEATH_HEIGHT;
    ctx.drawImage(img, centreX - dw/2, groundY - dh, dw, dh);
}

// ── Sprite state ──────────────────────────────────────────────────────────────
// Player
let playerKey        = 'PlayerA';
let playerFrames     = {};
let playerAnim       = 'Idle';
let playerFrame      = 0;
let playerFrameTimer = 0;
let playerX          = 0; // actual x position (lerps toward enemy)

// Enemy (monster or boss on screen)
const ESTATE = { HIDDEN:0, WALK_IN:1, IDLE_1:2, WALK_CLOSE:3, IDLE_2:4, ATTACK:5, DEATH:6, BOSS_INCOMING:7 };
let enemyState       = ESTATE.HIDDEN;
let enemyX           = 0;   // current pixel x
let enemyTargetX     = 0;
let enemyFrames      = [];  // current anim frames
let enemyFrame       = 0;
let enemyFrameTimer  = 0;
let enemyType        = 'monster'; // 'monster' | 'boss'
let enemyData        = null;  // manifest entry
let enemyDeathFrames = [];
let enemyDeathFrame  = 0;
let enemyDeathTimer  = 0;
let enemyRefH        = 0; // natural height of the Idle/Walk frame — kept constant across all anims
let enemyAnimSpeed   = ANIM_SPEED;
let playerRefH       = 0; // same for player

// State tracking
let initialized   = false;
let trackedMinion = -1;
let trackedBoss   = -1;
let vignetteAlpha = 0;
let idleTimer     = 0; // ticks spent in IDLE_1 or IDLE_2
let inBattle      = false;

// Timing constants (at ~60fps)
const IDLE_1_TICKS     = 120; // ~2s before walking close
const IDLE_2_TICKS     =  60; // ~1s before attacking
const ATTACK_HIT_TICKS =  60; // ticks between each GetHit during ATTACK
const DEATH_TICKS      = 100; // total ticks for death sequence before HIDDEN

// Boss incoming flash
let bossIncomingTimer = 0;
const BOSS_INCOMING_FRAMES = 80; // ~1.3s

// ── State machine helpers ─────────────────────────────────────────────────────
function groundY() { return Math.floor(H * GROUND_PCT); }

function setEnemyAnim(animName) {
    if (!enemyData) return;
    const frames = enemyData[animName] || enemyData['Idle'] || [];
    if (frames !== enemyFrames) {
        enemyFrames = frames;
        enemyFrame  = 0;
        enemyFrameTimer = 0;
    }
}

function getRefH(frames) {
    // Get natural height of first loaded frame, or 0 if not yet loaded
    if (!frames || !frames.length) return 0;
    const img = loadImg(frames[0]);
    return (img.complete && img.naturalHeight) ? img.naturalHeight : 0;
}

function startMonster(minionIdx) {
    const key  = 'MonsterV' + (minionIdx + 1);
    enemyData  = manifest && manifest.monsters[key];
    if (!enemyData) return;
    enemyType        = 'monster';
    enemyAnimSpeed   = ANIM_SPEED;
    enemyX           = W * ENEMY_ENTER_X;
    enemyTargetX     = W * ENEMY_MID_X;
    enemyDeathFrames = manifest.deaths[enemyData.deathPool] || [];
    enemyDeathFrame  = 0;
    enemyDeathTimer  = 0;
    enemyRefH        = 0; // will be set once first frame loads
    enemyState       = ESTATE.WALK_IN;
    setEnemyAnim('Walk');
    ['Walk','Idle','Attack'].forEach(function(a) { preloadFrames(enemyData[a]); });
    preloadFrames(enemyDeathFrames);
}

function startBoss(bossIdx) {
    const key  = 'Boss' + String(bossIdx + 1).padStart(2, '0');
    enemyData  = manifest && manifest.bosses[key];
    if (!enemyData) return;
    enemyType        = 'boss';
    enemyAnimSpeed   = BOSS_ANIM_SPEED;
    enemyX           = W * ENEMY_ENTER_X;
    enemyTargetX     = W * BOSS_MID_X;
    enemyDeathFrames = manifest.bossDeaths[enemyData.deathPool] || [];
    enemyDeathFrame  = 0;
    enemyDeathTimer  = 0;
    enemyRefH        = 0;
    enemyState       = ESTATE.BOSS_INCOMING;
    bossIncomingTimer = 0;
    setEnemyAnim('Idle');
    ['Walk','Fly','Idle','Attack'].forEach(function(a) { preloadFrames(enemyData[a]); });
    preloadFrames(enemyDeathFrames);
}

function defeatEnemy() {
    enemyState      = ESTATE.DEATH;
    enemyDeathFrame = 0;
    enemyDeathTimer = 0;
    setEnemyAnim('Attack'); // play attack once before death
}

// Advance enemy animation, return true when loop completes
function tickEnemyAnim() {
    if (!enemyFrames || !enemyFrames.length) return true;
    enemyFrameTimer++;
    if (enemyFrameTimer >= enemyAnimSpeed) {
        enemyFrameTimer = 0;
        enemyFrame++;
        if (enemyFrame >= enemyFrames.length) {
            enemyFrame = 0;
            return true; // completed one loop
        }
    }
    return false;
}

function tickPlayerAnim() {
    const frames = playerFrames[playerAnim];
    if (!frames || !frames.length) return;
    // One-shot anims return to Idle when complete
    const oneShot = playerAnim === 'GetHit' || playerAnim === 'Celebrate' || playerAnim === 'Die';
    playerFrameTimer++;
    if (playerFrameTimer >= ANIM_SPEED) {
        playerFrameTimer = 0;
        playerFrame++;
        if (playerFrame >= frames.length) {
            if (oneShot) {
                setPlayerAnim('Idle');
            } else {
                playerFrame = 0;
            }
        }
    }
}

function setPlayerAnim(anim) {
    if (playerAnim === anim) return;
    playerAnim  = anim;
    playerFrame = 0;
    playerFrameTimer = 0;
}

// ── Enemy state machine tick ──────────────────────────────────────────────────
function tickEnemy() {

    switch (enemyState) {

        case ESTATE.BOSS_INCOMING:
            bossIncomingTimer++;
            if (bossIncomingTimer >= BOSS_INCOMING_FRAMES) {
                enemyState   = ESTATE.WALK_IN;
                enemyTargetX = enemyType === 'boss' ? W * BOSS_MID_X : W * ENEMY_MID_X;
                setEnemyAnim('Walk');
                setPlayerAnim('Walk');
                idleTimer = 0;
            }
            return;

        case ESTATE.WALK_IN:
            enemyX += (enemyTargetX - enemyX) * 0.03;
            tickEnemyAnim();
            if (Math.abs(enemyX - enemyTargetX) < 2) {
                enemyX     = enemyTargetX;
                enemyState = ESTATE.IDLE_1;
                idleTimer  = 0;
                setEnemyAnim('Idle');
                setPlayerAnim('Idle');
            }
            break;

        case ESTATE.IDLE_1:
            tickEnemyAnim();
            idleTimer++;
            if (idleTimer >= IDLE_1_TICKS) {
                idleTimer    = 0;
                enemyState   = ESTATE.WALK_CLOSE;
                enemyTargetX = enemyType === 'boss' ? W * BOSS_CLOSE_X : W * ENEMY_CLOSE_X;
                setEnemyAnim('Walk');
                setPlayerAnim('Attack');
            }
            break;

        case ESTATE.WALK_CLOSE:
            enemyX += (enemyTargetX - enemyX) * 0.025;
            tickEnemyAnim();
            if (Math.abs(enemyX - enemyTargetX) < 2) {
                enemyX     = enemyTargetX;
                enemyState = ESTATE.IDLE_2;
                idleTimer  = 0;
                setEnemyAnim('Idle');
                setPlayerAnim('Idle');
            }
            break;

        case ESTATE.IDLE_2:
            tickEnemyAnim();
            idleTimer++;
            if (idleTimer >= IDLE_2_TICKS) {
                enemyState = ESTATE.ATTACK;
                idleTimer  = 0;
                setEnemyAnim('Attack');
                setPlayerAnim('GetHit');
            }
            break;

        case ESTATE.ATTACK:
            tickEnemyAnim();
            // Re-trigger GetHit periodically so the player keeps reacting
            idleTimer++;
            if (idleTimer >= ATTACK_HIT_TICKS) {
                idleTimer = 0;
                setPlayerAnim('GetHit');
            }
            break;

        case ESTATE.DEATH: {
            tickEnemyAnim();
            enemyDeathTimer++;
            // Advance death fx frame every 5 ticks
            if (enemyDeathTimer % 5 === 0 && enemyDeathFrames.length) {
                enemyDeathFrame = Math.min(enemyDeathFrame + 1, enemyDeathFrames.length - 1);
            }
            if (enemyDeathTimer >= DEATH_TICKS) {
                enemyState    = ESTATE.HIDDEN;
                vignetteAlpha = 0;
                inBattle      = false;
                setPlayerAnim('Walk');
            }
            break;
        }
    }
}

// ── Draw sprites for current frame ────────────────────────────────────────────
function drawSprites() {
    const gy = groundY();

    // Player — capture reference height from Idle on first draw
    const pf = playerFrames[playerAnim];
    if (pf && pf.length) {
        if (!playerRefH) {
            const idleFrames = playerFrames['Idle'] || playerFrames['Walk'] || pf;
            playerRefH = getRefH(idleFrames);
        }
        // Player x: walks toward enemy when enemy is on screen
        let px = W * PLAYER_X_PCT;
        if (enemyState !== ESTATE.HIDDEN && enemyState !== ESTATE.BOSS_INCOMING) {
            // Lerp player slightly right toward enemy during WALK_CLOSE / IDLE_2 / ATTACK
            const targetPX = (enemyState === ESTATE.WALK_CLOSE || enemyState === ESTATE.IDLE_2 || enemyState === ESTATE.ATTACK)
                ? W * (PLAYER_X_PCT + 0.06)
                : W * PLAYER_X_PCT;
            playerX += (targetPX - playerX) * 0.04;
            px = playerX;
        } else {
            playerX = W * PLAYER_X_PCT;
            px = playerX;
        }
        drawSprite(pf, playerFrame, px, gy, PLAYER_HEIGHT, false, playerRefH || undefined);
    }

    // Enemy
    if (enemyState === ESTATE.BOSS_INCOMING) {
        return; // BOSS INCOMING text drawn separately
    }

    if (enemyState !== ESTATE.HIDDEN && enemyData) {
        // Capture reference height from Idle/Walk on first draw
        if (!enemyRefH) {
            const refFrames = enemyData['Idle'] || enemyData['Walk'] || enemyFrames;
            enemyRefH = getRefH(refFrames);
        }
        const ex = Math.round(enemyX);
        const targetH = enemyType === 'boss' ? BOSS_HEIGHT : MONSTER_HEIGHT;
        drawSprite(enemyFrames, enemyFrame, ex, gy, targetH, false, enemyRefH || undefined);

        // Overlay death fx during DEATH state
        if (enemyState === ESTATE.DEATH && enemyDeathFrames.length) {
            const df = enemyDeathFrames;
            const fi = Math.min(enemyDeathFrame, df.length - 1);
            drawDeathSprite(df, fi, ex + targetH * 0.3, gy);
        }
    }
}

// ── Vignette (boss battles) ───────────────────────────────────────────────────
function drawVignette() {
    if (vignetteAlpha <= 0) return;
    const grad = ctx.createRadialGradient(W/2, H/2, H*0.1, W/2, H/2, Math.max(W,H)*0.8);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(0,0,0,${vignetteAlpha.toFixed(2)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
}

// ── Boss incoming flash text ──────────────────────────────────────────────────
function drawBossIncoming() {
    if (enemyState !== ESTATE.BOSS_INCOMING) return;
    const progress = bossIncomingTimer / BOSS_INCOMING_FRAMES;
    const fade = progress < 0.3 ? progress / 0.3 : progress > 0.7 ? (1 - progress) / 0.3 : 1;
    const pulse = 1 + 0.06 * Math.sin(bossIncomingTimer * 0.18);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.font = `900 ${Math.round(H * 0.28 * pulse)}px 'Courier New', monospace`;
    ctx.fillStyle = '#ff4500';
    ctx.shadowColor = '#ff4500';
    ctx.shadowBlur = 18;
    ctx.textAlign = 'center';
    ctx.fillText('⚔ BOSS INCOMING', W / 2, H * 0.52);
    ctx.restore();
}

// ── Battle flash ──────────────────────────────────────────────────────────────
let battleFlashTimer = 0;

function drawBattleFlash() {
    if (!inBattle || enemyType !== 'boss') return;
    battleFlashTimer++;
    const a = 0.08 + 0.06 * Math.sin(battleFlashTimer * 0.08);
    ctx.fillStyle = `rgba(255,69,0,${a})`;
    ctx.fillRect(0, 0, W, H);
}

// ── Celebration bursts ────────────────────────────────────────────────────────
function burstAt(x, y, colour, count) {
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i + Math.random() * 0.4;
        const spd   = 2.5 + Math.random() * 3.5;
        ptcl.push({ t:'burst', col:colour, x:x, y:y, vx:Math.cos(angle)*spd, vy:Math.sin(angle)*spd-1.5, r:2+Math.random()*2.5, a:1 });
    }
}

window.gameLevelUp = function () {
    if (!canvas || !W) return;
    burstAt(W * 0.20, H * 0.55, '#ffd700', 28);
    burstAt(W * 0.20, H * 0.55, '#fff', 14);
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;inset:0;background:rgba(255,215,0,0.22);z-index:4;pointer-events:none;transition:opacity 0.4s;';
    container.appendChild(flash);
    setTimeout(function(){ flash.style.opacity='0'; setTimeout(function(){ flash.remove(); },420); }, 80);
    setPlayerAnim('Celebrate');
    setTimeout(function(){ setPlayerAnim('Walk'); }, 1800);
};

window.gameBuddyFound = function () {
    if (!canvas || !W) return;
    burstAt(W * 0.20, H * 0.50, '#0ff', 22);
    burstAt(W * 0.20, H * 0.50, '#f0f', 12);
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;inset:0;background:rgba(0,255,255,0.15);z-index:4;pointer-events:none;transition:opacity 0.4s;';
    container.appendChild(flash);
    setTimeout(function(){ flash.style.opacity='0'; setTimeout(function(){ flash.remove(); },420); }, 80);
};

// ── Canvas + DOM setup ────────────────────────────────────────────────────────
let canvas, ctx, W, H, container;
let scrollX      = 0;
let currentLevel = 0;
let tick         = 0;

function init() {
    container = document.getElementById('gameStrip');
    if (!container || container.dataset.gi) return;
    container.dataset.gi = '1';

    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:block;';
    container.appendChild(canvas);
    ctx = canvas.getContext('2d');

    resize();
    window.addEventListener('resize', resize);
    for (let i = 0; i < 30; i++) spawnPtcl();

    loadManifest(function() {
        if (!localStorage.getItem('selectedPlayer')) {
            showPlayerPicker(function() {
                playerKey    = getSelectedPlayer();
                playerFrames = getPlayerFrames(playerKey);
                preloadAll();
                requestAnimationFrame(loop);
            });
        } else {
            playerKey    = getSelectedPlayer();
            playerFrames = getPlayerFrames(playerKey);
            preloadAll();
            requestAnimationFrame(loop);
        }
    });
}

function showPlayerPicker(onPicked) {
    if (!manifest) { onPicked(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'gamePicker';
    overlay.style.cssText = [
        'position:absolute;inset:0;z-index:20',
        'display:flex;flex-direction:column;align-items:center;justify-content:center',
        'background:rgba(0,0,0,0.82)',
        'gap:6px',
    ].join(';');

    const label = document.createElement('div');
    label.textContent = 'CHOOSE YOUR FIGHTER';
    label.style.cssText = 'color:var(--neon,#0ff);font-size:0.55rem;letter-spacing:3px;margin-bottom:6px;';
    overlay.appendChild(label);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;gap:8px;';

    PLAYER_KEYS.forEach(function(key) {
        const card = document.createElement('div');
        card.style.cssText = [
            'cursor:pointer;padding:6px 8px',
            'border:2px solid rgba(255,255,255,0.2)',
            'text-align:center;font-size:0.5rem;letter-spacing:1px',
            'color:#fff;transition:border-color 0.15s',
            'background:rgba(255,255,255,0.04)',
        ].join(';');

        const idle = manifest.players[key] && manifest.players[key].Idle;
        if (idle && idle[0]) {
            const img = document.createElement('img');
            img.src = idle[0];
            img.style.cssText = 'height:52px;image-rendering:pixelated;display:block;margin:0 auto 4px;';
            card.appendChild(img);
        }

        const lbl = document.createElement('div');
        lbl.textContent = key.replace('Player', '');
        card.appendChild(lbl);

        card.addEventListener('mouseenter', function(){ card.style.borderColor = 'var(--neon,#0ff)'; });
        card.addEventListener('mouseleave', function(){ card.style.borderColor = 'rgba(255,255,255,0.2)'; });
        card.addEventListener('click', function() {
            localStorage.setItem('selectedPlayer', key);
            overlay.remove();
            onPicked();
        });

        grid.appendChild(card);
    });

    overlay.appendChild(grid);
    container.appendChild(overlay);
}

function resize() {
    if (!canvas) return;
    W = container.clientWidth;
    H = container.clientHeight;
    if (W > 0 && H > 0) { canvas.width = W; canvas.height = H; }
}

function loop() {
    tick++;
    scrollX += 1.1 + currentLevel * 0.07;

    if (W > 0 && H > 0) {
        ctx.clearRect(0, 0, W, H);
        drawBackground();

        ptclTimer++;
        const sr = ptclType==='rain'?2:ptclType==='stars'?8:4;
        if (ptclTimer % sr === 0) spawnPtcl();
        tickPtcl(tick);
        drawPtcl();

        drawVignette();

        if (manifest) {
            tickEnemy();
            tickPlayerAnim();
            drawSprites();
            drawBossIncoming();
            drawBattleFlash();
        }
    } else {
        resize();
    }

    requestAnimationFrame(loop);
}

// ── Public: updateGame — called from script.js on every word add ──────────────
window.updateGame = function () {
    if (!canvas || !manifest) return;
    if (typeof state === 'undefined' || typeof BOSS_BEATS === 'undefined' || typeof MINIONS === 'undefined') return;

    const progress  = state.goal > 0 ? (state.total / state.goal) * 100 : 0;
    const bossIdx   = BOSS_BEATS.findLastIndex(b => progress >= b.pct);
    const minionIdx = MINIONS.findLastIndex(m => progress >= m.pct);
    const newLevel  = Math.max(0, Math.min(bossIdx, 14));

    if (!initialized) {
        initialized   = true;
        currentLevel  = newLevel;
        trackedMinion = minionIdx;
        trackedBoss   = bossIdx;
        const lv = LEVELS[Math.min(currentLevel, LEVELS.length - 1)];
        ptclType = lv.ptcl; ptclCol = lv.pc; ptcl = [];
        for (let i = 0; i < 30; i++) spawnPtcl();
        return;
    }

    // Level transition
    if (newLevel !== currentLevel) {
        currentLevel = newLevel;
        const lv = LEVELS[Math.min(currentLevel, LEVELS.length - 1)];
        ptclType = lv.ptcl; ptclCol = lv.pc; ptcl = [];
        for (let i = 0; i < 20; i++) spawnPtcl();
    }

    // ── Boss spawn ──────────────────────────────────────────────────────────
    const nextBossIdx = bossIdx + 1;
    let bossWindowActive = false;
    if (nextBossIdx < BOSS_BEATS.length) {
        const gapToBoss = BOSS_BEATS[nextBossIdx].pct - progress;
        if (gapToBoss <= BOSS_WINDOW && gapToBoss > 0) {
            bossWindowActive = true;
            inBattle = true;
            vignetteAlpha = Math.min(0.55, vignetteAlpha + 0.02);
            if (trackedBoss < nextBossIdx && enemyState === ESTATE.HIDDEN) {
                trackedBoss = nextBossIdx;
                startBoss(nextBossIdx - 1);
            }
        } else {
            inBattle = false;
            vignetteAlpha = Math.max(0, vignetteAlpha - 0.02);
        }
    }

    // ── Boss defeated ───────────────────────────────────────────────────────
    if (bossIdx >= trackedBoss && trackedBoss > 0 && enemyType === 'boss' &&
        enemyState !== ESTATE.DEATH && enemyState !== ESTATE.HIDDEN) {
        defeatEnemy();
        setPlayerAnim('Celebrate');
        setTimeout(function(){ setPlayerAnim('Walk'); }, 2000);
    }

    // ── Minion spawn ────────────────────────────────────────────────────────
    // If boss window opens while a minion is on screen, clear it so boss can spawn
    if (bossWindowActive && enemyType === 'monster' &&
        enemyState !== ESTATE.HIDDEN && enemyState !== ESTATE.DEATH) {
        defeatEnemy();
    }

    const nextMinionIdx = trackedMinion + 1;
    if (nextMinionIdx < MINIONS.length) {
        const gapToMinion = MINIONS[nextMinionIdx].pct - progress;
        // Spawn minion if slot free and not about to hand off to boss
        if (gapToMinion <= MINION_WINDOW && gapToMinion > 0 && enemyState === ESTATE.HIDDEN && !bossWindowActive) {
            startMonster(nextMinionIdx);
        }
        // Skip past minions whose threshold passed while a boss was on screen
        if (gapToMinion <= 0 && nextMinionIdx > trackedMinion) {
            trackedMinion = nextMinionIdx;
        }
    }

    // ── Minion defeated ─────────────────────────────────────────────────────
    if (minionIdx > trackedMinion) {
        if (enemyType === 'monster' && enemyState !== ESTATE.DEATH && enemyState !== ESTATE.HIDDEN) {
            defeatEnemy();
        }
        trackedMinion = minionIdx;
    }

    // Player walks when nothing on screen
    if (enemyState === ESTATE.HIDDEN &&
        playerAnim !== 'Walk' && playerAnim !== 'Celebrate' &&
        playerAnim !== 'GetHit' && playerAnim !== 'Die') {
        setPlayerAnim('Walk');
    }
};

// ── Player selector UI ────────────────────────────────────────────────────────
window.buildPlayerSelector = function(containerId) {
    if (!manifest) { setTimeout(function(){ window.buildPlayerSelector(containerId); }, 300); return; }
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = PLAYER_KEYS.map(function(key) {
        const selected = key === getSelectedPlayer();
        const idle = manifest.players[key] && manifest.players[key].Idle;
        const preview = idle && idle[0] ? `<img src="${idle[0]}" style="height:60px;image-rendering:pixelated;display:block;margin:0 auto 4px;">` : '';
        return `<div onclick="setSelectedPlayer('${key}')" style="cursor:pointer;padding:8px;border:2px solid ${selected?'var(--neon)':'var(--border)'};text-align:center;font-size:0.6rem;letter-spacing:1px;">
            ${preview}${key.replace('Player','')}
        </div>`;
    }).join('');
};

// ── Toggle ────────────────────────────────────────────────────────────────────
window.toggleGameBar = function () {
    const bar = document.getElementById('gameBar');
    const btn = document.getElementById('gameBarToggle');
    if (!bar) return;
    const hidden = bar.classList.toggle('game-bar-hidden');
    if (btn) btn.textContent = hidden ? '▲' : '▼';
    document.body.classList.toggle('game-bar-off', hidden);
    localStorage.setItem('gameBarHidden', hidden ? '1' : '0');
};

// ── Boot ──────────────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

})();

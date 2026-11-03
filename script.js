const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
document.body.appendChild(canvas);

let cols, rows, fontWidth;
const fontSize = 16;
let fluid;

const palette = ['.', ',', '-', '~', '/', '+', '=', '?', 'X', '&', '#', '@'];

// Color themes configuration
const darkColors = [
    '#000B18', '#001A33', '#002B4E', '#003E6B',
    '#00528A', '#0069AC', '#0081D0', '#009BFA',
    '#33B1FF', '#66C8FF', '#99E0FF', '#FFFFFF' 
];

const lightColors = [
    '#D0E1FD', '#B8D3FC', '#9FC4FB', '#85B6FA',
    '#6CA8F9', '#5299F8', '#388BF8', '#1F7CF7',
    '#0969DA', '#0550AE', '#033D8B', '#0A3069'
];

let colors = darkColors;

// --- NAVIER-STOKES FLUID DYNAMICS ---
class Fluid {
    constructor(cols, rows) {
        this.cols = cols;
        this.rows = rows;
        this.size = cols * rows;
        this.dt = 0.1;
        this.diff = 0.0000;
        this.visc = 0.0000;
        
        this.s = new Float32Array(this.size);
        this.density = new Float32Array(this.size);
        this.Vx = new Float32Array(this.size);
        this.Vy = new Float32Array(this.size);
        this.Vx0 = new Float32Array(this.size);
        this.Vy0 = new Float32Array(this.size);
    }

    IX(x, y) {
        x = Math.max(0, Math.min(x, this.cols - 1));
        y = Math.max(0, Math.min(y, this.rows - 1));
        return x + y * this.cols;
    }

    addForce(x, y, dx, dy, colorAmount) {
        let radius = 2; 
        for(let j = -radius; j <= radius; j++) {
            for(let i = -radius; i <= radius; i++) {
                if(i * i + j * j <= radius * radius) {
                    let cx = x + i;
                    let cy = y + j;
                    if(cx > 0 && cx < this.cols - 1 && cy > 0 && cy < this.rows - 1) {
                        let idx = this.IX(cx, cy);
                        this.Vx[idx] += dx;
                        this.Vy[idx] += dy;
                        this.density[idx] += colorAmount;
                    }
                }
            }
        }
    }

    applyCircularForce(x, y, holdDurationSeconds) {
        let maxDuration = Math.min(holdDurationSeconds, 3.0); 
        let radius = Math.floor(3 + maxDuration * 10); 
        let force = 2 + maxDuration * 25; 
        let densityAmount = 2 + maxDuration * 15; 

        for (let j = -radius; j <= radius; j++) {
            for (let i = -radius; i <= radius; i++) {
                let distSq = i * i + j * j;
                if (distSq <= radius * radius) {
                    let cx = x + i;
                    let cy = y + j;
                    if (cx > 0 && cx < this.cols - 1 && cy > 0 && cy < this.rows - 1) {
                        let idx = this.IX(cx, cy);
                        if (distSq === 0) {
                            this.density[idx] += densityAmount;
                            continue;
                        }
                        let dist = Math.sqrt(distSq);
                        let nx = i / dist;
                        let ny = j / dist;
                        let falloff = 1 - (dist / radius);
                        this.Vx[idx] += nx * force * falloff;
                        this.Vy[idx] += ny * force * falloff;
                        this.density[idx] += densityAmount * falloff;
                    }
                }
            }
        }
    }

    step() {
        let visc = this.visc; let diff = this.diff; let dt = this.dt;
        let Vx = this.Vx; let Vy = this.Vy; let Vx0 = this.Vx0; let Vy0 = this.Vy0;
        let s = this.s; let density = this.density;

        this.diffuse(1, Vx0, Vx, visc, dt);
        this.diffuse(2, Vy0, Vy, visc, dt);
        this.project(Vx0, Vy0, Vx, Vy);
        this.advect(1, Vx, Vx0, Vx0, Vy0, dt);
        this.advect(2, Vy, Vy0, Vx0, Vy0, dt);
        this.project(Vx, Vy, Vx0, Vy0);
        this.diffuse(0, s, density, diff, dt);
        this.advect(0, density, s, Vx, Vy, dt);

        for(let i = 0; i < this.size; i++) {
            this.density[i] *= 0.95;
            this.Vx[i] *= 0.98;
            this.Vy[i] *= 0.98;
        }
    }

    set_bnd(b, x) {
        for (let i = 1; i < this.cols - 1; i++) {
            x[this.IX(i, 0)] = b === 2 ? -x[this.IX(i, 1)] : x[this.IX(i, 1)];
            x[this.IX(i, this.rows - 1)] = b === 2 ? -x[this.IX(i, this.rows - 2)] : x[this.IX(i, this.rows - 2)];
        }
        for (let j = 1; j < this.rows - 1; j++) {
            x[this.IX(0, j)] = b === 1 ? -x[this.IX(1, j)] : x[this.IX(1, j)];
            x[this.IX(this.cols - 1, j)] = b === 1 ? -x[this.IX(this.cols - 2, j)] : x[this.IX(this.cols - 2, j)];
        }
        x[this.IX(0, 0)] = 0.5 * (x[this.IX(1, 0)] + x[this.IX(0, 1)]);
        x[this.IX(0, this.rows - 1)] = 0.5 * (x[this.IX(1, this.rows - 1)] + x[this.IX(0, this.rows - 2)]);
        x[this.IX(this.cols - 1, 0)] = 0.5 * (x[this.IX(this.cols - 2, 0)] + x[this.IX(this.cols - 1, 1)]);
        x[this.IX(this.cols - 1, this.rows - 1)] = 0.5 * (x[this.IX(this.cols - 2, this.rows - 1)] + x[this.IX(this.cols - 1, this.rows - 2)]);
    }

    lin_solve(b, x, x0, a, c) {
        let invC = 1.0 / c;
        for (let k = 0; k < 4; k++) {
            for (let j = 1; j < this.rows - 1; j++) {
                for (let i = 1; i < this.cols - 1; i++) {
                    x[this.IX(i, j)] = (x0[this.IX(i, j)] + a * (x[this.IX(i - 1, j)] + x[this.IX(i + 1, j)] + x[this.IX(i, j - 1)] + x[this.IX(i, j + 1)])) * invC;
                }
            }
            this.set_bnd(b, x);
        }
    }

    diffuse(b, x, x0, diff, dt) {
        let a = dt * diff * (this.cols - 2) * (this.rows - 2);
        this.lin_solve(b, x, x0, a, 1 + 4 * a);
    }

    advect(b, d, d0, u, v, dt) {
        let dt0 = dt * 15.0;
        for (let j = 1; j < this.rows - 1; j++) {
            for (let i = 1; i < this.cols - 1; i++) {
                let x = i - dt0 * u[this.IX(i, j)];
                let y = j - dt0 * v[this.IX(i, j)];
                if (x < 0.5) x = 0.5; if (x > this.cols - 1.5) x = this.cols - 1.5;
                let i0 = Math.floor(x), i1 = i0 + 1;
                if (y < 0.5) y = 0.5; if (y > this.rows - 1.5) y = this.rows - 1.5;
                let j0 = Math.floor(y), j1 = j0 + 1;
                
                let s1 = x - i0, s0 = 1.0 - s1;
                let t1 = y - j0, t0 = 1.0 - t1;
                
                d[this.IX(i, j)] = s0 * (t0 * d0[this.IX(i0, j0)] + t1 * d0[this.IX(i0, j1)]) +
                                   s1 * (t0 * d0[this.IX(i1, j0)] + t1 * d0[this.IX(i1, j1)]);
            }
        }
        this.set_bnd(b, d);
    }

    project(u, v, p, div) {
        for (let j = 1; j < this.rows - 1; j++) {
            for (let i = 1; i < this.cols - 1; i++) {
                div[this.IX(i, j)] = -0.5 * (u[this.IX(i + 1, j)] - u[this.IX(i - 1, j)] + v[this.IX(i, j + 1)] - v[this.IX(i, j - 1)]);
                p[this.IX(i, j)] = 0;
            }
        }
        this.set_bnd(0, div);
        this.set_bnd(0, p);
        this.lin_solve(0, p, div, 1, 4);
        for (let j = 1; j < this.rows - 1; j++) {
            for (let i = 1; i < this.cols - 1; i++) {
                u[this.IX(i, j)] -= 0.5 * (p[this.IX(i + 1, j)] - p[this.IX(i - 1, j)]);
                v[this.IX(i, j)] -= 0.5 * (p[this.IX(i, j + 1)] - p[this.IX(i, j - 1)]);
            }
        }
        this.set_bnd(1, u);
        this.set_bnd(2, v);
    }
}

// --- PROCEDURAL KOI FISH CLASS ---
class Fish {
    constructor(x, y) {
        this.numSegments = 24; 
        this.spacing = 1.2; 
        this.segments = [];
        this.x = x;
        this.y = y;
        this.angle = Math.random() * Math.PI * 2;
        this.speed = 0.15 + Math.random() * 0.1;
        this.turnRate = 0;
        this.seed = Math.random() * 1000;
        
        const types = ['kohaku', 'sanke', 'ogon', 'shiro'];
        this.type = types[Math.floor(Math.random() * types.length)];
        
        for(let i = 0; i < this.numSegments; i++) {
            this.segments.push({
                x: x - Math.cos(this.angle) * i * this.spacing, 
                y: y - Math.sin(this.angle) * i * this.spacing
            });
        }
    }

    getRadii() {
        let r = [];
        for (let i = 0; i < this.numSegments; i++) {
            let t = i / (this.numSegments - 1);
            let width;
            if (t < 0.2) {
                width = 1.0 + (t / 0.2) * 3.0; 
            } else {
                let taper = 1.0 - (t - 0.2) / 0.8;
                width = 4.0 * Math.pow(taper, 0.8);
            }
            r.push(Math.max(width, 0.3));
        }
        return r;
    }

    getFinWidth(i) {
        let t = i / (this.numSegments - 1);
        if (t > 0.15 && t < 0.3) {
            let ft = (t - 0.15) / 0.15;
            return Math.sin(ft * Math.PI) * 3.5;
        }
        if (t > 0.85) {
            let ft = (t - 0.85) / 0.15;
            return ft * 3.5;
        }
        return 0;
    }

    getColor(i, w, isFin) {
        if (isFin) return document.body.classList.contains('light-mode') ? '#0069AC' : '#66C8FF'; 
        
        let stableW = Math.round(w);
        let noise = Math.sin(i * 0.3 + this.seed) + Math.cos(stableW * 0.8 + this.seed * 1.5);
        let c = document.body.classList.contains('light-mode') ? '#444444' : '#EEEEEE'; 
        
        if (this.type === 'kohaku') {
            if (noise > 0.2) c = '#FF4400';
        } else if (this.type === 'sanke') {
            if (noise > 0.8) c = '#111111';
            else if (noise > 0.0) c = '#FF4400';
        } else if (this.type === 'ogon') {
            c = (noise > 0) ? '#FFB300' : '#FFD700';
        } else if (this.type === 'shiro') {
            if (noise > 0.3) c = '#111111';
        }
        return c;
    }

    getChar(i, w, isFin, r) {
        if (isFin) return '~';
        let stableW = Math.round(w);
        
        if (i <= 2) { 
            if (Math.abs(w) >= r - 1.2 && Math.abs(w) <= r) return 'O'; 
            return '@';
        }
        
        const chars = ['@', '8', '&', '#', '%', 'x', '*'];
        let idx = Math.floor(Math.abs(Math.sin(i * 1.5 + stableW + this.seed)) * chars.length);
        return chars[idx % chars.length];
    }

    update(time, cols, rows) {
        this.turnRate = Math.sin(time * 0.5 + this.seed) * 0.04 + Math.cos(time * 0.3 + this.seed) * 0.02;
        
        let margin = 20;
        let targetAngle = null;
        
        if (this.x < margin) targetAngle = 0;
        else if (this.x > cols - margin) targetAngle = Math.PI;
        
        if (this.y < margin) {
            targetAngle = (targetAngle !== null) ? (targetAngle + Math.PI/2)/2 : Math.PI/2;
            if (this.x > cols - margin) targetAngle = Math.PI * 0.75; 
            if (this.x < margin) targetAngle = Math.PI * 0.25; 
        } else if (this.y > rows - margin) {
            targetAngle = (targetAngle !== null) ? (targetAngle - Math.PI/2)/2 : -Math.PI/2;
            if (this.x > cols - margin) targetAngle = -Math.PI * 0.75;
            if (this.x < margin) targetAngle = -Math.PI * 0.25;
        }

        if (targetAngle !== null) {
            let diff = targetAngle - this.angle;
            while(diff < -Math.PI) diff += Math.PI * 2;
            while(diff > Math.PI) diff -= Math.PI * 2;
            this.turnRate += diff * 0.03; 
        }
        
        this.angle += this.turnRate;
        
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
        
        this.segments[0].x = this.x;
        this.segments[0].y = this.y;
        
        for (let i = 1; i < this.numSegments; i++) {
            let dx = this.segments[i-1].x - this.segments[i].x;
            let dy = this.segments[i-1].y - this.segments[i].y;
            let dist = Math.sqrt(dx*dx + dy*dy);
            if (dist > this.spacing) {
                let moveDist = dist - this.spacing;
                this.segments[i].x += (dx / dist) * moveDist;
                this.segments[i].y += (dy / dist) * moveDist;
            }
        }
        
        fluid.addForce(Math.floor(this.x), Math.floor(this.y), Math.cos(this.angle) * this.speed * 2, Math.sin(this.angle) * this.speed * 2, 0.4);
        
        let tailSeg = this.segments[this.numSegments - 1];
        let tailPrev = this.segments[this.numSegments - 3];
        let tailDirX = tailSeg.x - tailPrev.x;
        let tailDirY = tailSeg.y - tailPrev.y;
        fluid.addForce(Math.floor(tailSeg.x), Math.floor(tailSeg.y), tailDirX * 1.5, tailDirY * 1.5, 0.3);
    }
}

let fishes = [];

// --- SETUP & EVENT LISTENERS ---
function init() {
    ctx.font = `${fontSize}px monospace`;
    fontWidth = ctx.measureText('M').width;
    resize();
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    cols = Math.ceil(canvas.width / fontWidth);
    rows = Math.ceil(canvas.height / fontSize);
    
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'top';
    
    fluid = new Fluid(cols, rows);
    
    fishes = [
        new Fish(cols * 0.2, rows * 0.2),
        new Fish(cols * 0.8, rows * 0.4),
        new Fish(cols * 0.3, rows * 0.7),
        new Fish(cols * 0.7, rows * 0.8)
    ];
}

window.addEventListener('resize', resize);
init();

let isDrawing = false;
let lastX = 0, lastY = 0;
let clickStartTime = 0;

function handleStart(e) {
    isDrawing = true;
    clickStartTime = Date.now();
    let point = e.touches ? e.touches[0] : e;
    lastX = point.clientX;
    lastY = point.clientY;
}

function handleEnd(e) { 
    if (isDrawing) {
        let durationSeconds = (Date.now() - clickStartTime) / 1000;
        let gridX = Math.floor(lastX / fontWidth);
        let gridY = Math.floor(lastY / fontSize);
        fluid.applyCircularForce(gridX, gridY, durationSeconds);
    }
    isDrawing = false; 
}

function handleMove(e) {
    if (!isDrawing) return;
    let point = e.touches ? e.touches[0] : e;
    let currX = point.clientX;
    let currY = point.clientY;
    let dx = currX - lastX;
    let dy = currY - lastY;
    
    let gridX0 = Math.floor(lastX / fontWidth);
    let gridY0 = Math.floor(lastY / fontSize);
    let gridX1 = Math.floor(currX / fontWidth);
    let gridY1 = Math.floor(currY / fontSize);
    
    let dist = Math.max(Math.abs(gridX1 - gridX0), Math.abs(gridY1 - gridY0));
    let steps = Math.max(1, dist);
    
    for (let i = 0; i <= steps; i++) {
        let t = steps === 0 ? 0 : i / steps;
        let cx = Math.floor(gridX0 + (gridX1 - gridX0) * t);
        let cy = Math.floor(gridY0 + (gridY1 - gridY0) * t);
        fluid.addForce(cx, cy, dx * 0.1, dy * 0.1, 4.0);
    }
    
    lastX = currX;
    lastY = currY;
}

window.addEventListener('mousedown', handleStart);
window.addEventListener('mouseup', handleEnd);
window.addEventListener('mousemove', handleMove);
window.addEventListener('touchstart', handleStart);
window.addEventListener('touchend', handleEnd);
window.addEventListener('touchmove', handleMove);

// --- Window & Theme Controls ---
const minimizeBtn = document.getElementById('minimize-btn');
const themeBtn = document.getElementById('theme-btn');
const modalWindow = document.getElementById('modal-window');

minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    modalWindow.classList.toggle('minimized');
    minimizeBtn.textContent = modalWindow.classList.contains('minimized') ? '□' : '_';
});

themeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    document.body.classList.toggle('light-mode');
    if (document.body.classList.contains('light-mode')) {
        themeBtn.textContent = '☽'; // Moon icon for switching to dark mode
        colors = lightColors;
    } else {
        themeBtn.textContent = '☀'; // Sun icon for switching to light mode
        colors = darkColors;
    }
});

// Prevent fluid interactions when clicking inside the window
['mousedown', 'touchstart', 'mousemove', 'touchmove', 'mouseup', 'touchend'].forEach(evt => {
    modalWindow.addEventListener(evt, e => e.stopPropagation());
});

// --- RENDER LOOP ---
let time = 0;

function render() {
    time += 0.015;
    fluid.step();
    
    let isLight = document.body.classList.contains('light-mode');
    ctx.fillStyle = isLight ? '#F0F4F8' : '#010409';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let fishMap = new Map();
    let aspect = fontWidth / fontSize; 
    
    for (let f of fishes) {
        f.update(time, cols, rows);
        let radii = f.getRadii();
        
        for (let i = 0; i < f.numSegments; i++) {
            let seg = f.segments[i];
            let nextSeg = i === 0 ? {x: f.x + Math.cos(f.angle), y: f.y + Math.sin(f.angle)} : f.segments[i-1];
            
            let dx = nextSeg.x - seg.x;
            let dy = nextSeg.y - seg.y;
            let len = Math.sqrt(dx*dx + dy*dy);
            if (len === 0) continue;
            
            let nx = -dy / len;
            let ny = dx / len;
            
            let r = radii[i];
            let finW = f.getFinWidth(i);
            let maxW = r + finW;
            
            for (let w = -maxW; w <= maxW; w += 0.3) {
                let isFin = Math.abs(w) > r;
                if (isFin && finW === 0) continue; 
                
                let px = Math.floor(seg.x + nx * w);
                let py = Math.floor(seg.y + ny * (w * aspect)); 
                
                if (px >= 0 && px < cols && py >= 0 && py < rows) {
                    let gridIdx = px + py * cols;
                    let c = f.getColor(i, w, isFin);
                    let char = f.getChar(i, w, isFin, r);
                    
                    if (!fishMap.has(gridIdx) || (!isFin && fishMap.get(gridIdx).isFin)) {
                        fishMap.set(gridIdx, {char: char, color: c, isFin: isFin});
                    }
                }
            }
        }
    }

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let gridIdx = x + y * cols;
            
            if (fishMap.has(gridIdx)) {
                let fData = fishMap.get(gridIdx);
                ctx.fillStyle = fData.color;
                ctx.fillText(fData.char, x * fontWidth, y * fontSize);
                continue; 
            }
            
            let idx = fluid.IX(x, y);
            let vx = fluid.Vx[idx];
            let vy = fluid.Vy[idx];
            let d = fluid.density[idx];
            
            let nx = (x - vx * 5) * 0.05;
            let ny = (y - vy * 5) * 0.08;

            let wave1 = Math.sin(nx + time) * Math.cos(ny + time * 0.8);
            let wave2 = Math.sin(nx * 1.5 - time * 1.2) * Math.sin(ny * 1.5 + time * 0.5);
            let wave3 = Math.sin(nx * 0.4 + ny * 0.6 - time * 0.4);
            
            let value = (wave1 + wave2 + wave3) / 3;
            value += d * 0.25; 
            
            if (value > 0.85 && Math.random() > 0.95) value += 0.2;

            let normalized = (value + 1) / 2;
            let cIndex = Math.floor(normalized * palette.length);
            cIndex = Math.max(0, Math.min(palette.length - 1, cIndex));

            ctx.fillStyle = colors[cIndex];
            ctx.fillText(palette[cIndex], x * fontWidth, y * fontSize);
        }
    }
    
    requestAnimationFrame(render);
}

render();

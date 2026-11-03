const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
document.body.appendChild(canvas);

let cols, rows, fontWidth;
const fontSize = 16;
let fluid;

// Characters ordered by visual density
const palette = ['.', ',', '-', '~', '/', '+', '=', '?', 'X', '&', '#', '@'];

// Colors for the sea, from deep troughs to bright wave crests/foam
const colors = [
    '#000B18', '#001A33', '#002B4E', '#003E6B',
    '#00528A', '#0069AC', '#0081D0', '#009BFA',
    '#33B1FF', '#66C8FF', '#99E0FF', '#FFFFFF' 
];

// --- BIG FISH ASCII ART ---
const bigFishRight = [
    "      _..----.._    ",
    "    .'  .--.    '-. ",
    "   /   /    \\      \\",
    "><(   (  O   )      )",
    "   \\   \\    /      /",
    "    '._ '--'    .-' ",
    "       `\"----\"`     "
];

const bigFishLeft = [
    "    _..----.._      ",
    " .-'    .--.  '.    ",
    "/      /    \\   \\   ",
    "(      (   O  )   )><",
    "\\      \\    /   /   ",
    " '-.    '--' _.'    ",
    "    `\"----\"`        "
];

// --- NAVIER-STOKES FLUID DYNAMICS (Stable Fluids) ---
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
        let radius = 2; // Brush size
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

// --- FISH CLASS ---
class Fish {
    constructor(x, y, vx) {
        this.x = x;
        this.startY = y;
        this.y = y;
        this.vx = vx;
        this.bobSpeed = 2 + Math.random() * 2;
        // Orange/Gold Koi colors
        const fishColors = ['#FFAA00', '#FF7700', '#FF4500', '#FFD700'];
        this.color = fishColors[Math.floor(Math.random() * fishColors.length)];
    }

    update(time) {
        this.x += this.vx;
        // Organic bobbing up and down
        this.y = this.startY + Math.sin(time * this.bobSpeed) * 1.5;

        // Fish generate a wake in the fluid
        let tailX = this.vx > 0 ? this.x - 2 : this.x + 22;
        let tailY = this.y + 3;
        if (tailX > 0 && tailX < cols && tailY > 0 && tailY < rows) {
            fluid.addForce(Math.floor(tailX), Math.floor(tailY), this.vx * 1.5, 0, 0.2);
        }

        // Wrap screen
        if (this.vx > 0 && this.x > cols + 5) this.x = -25;
        if (this.vx < 0 && this.x < -25) this.x = cols + 5;
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
    
    // Spawn some big fish!
    fishes = [
        new Fish(-10, rows * 0.2, 0.08),
        new Fish(cols * 0.8, rows * 0.4, -0.06),
        new Fish(cols * 0.3, rows * 0.7, 0.1),
        new Fish(cols + 10, rows * 0.85, -0.09)
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

// Window minimize logic
const minimizeBtn = document.getElementById('minimize-btn');
const modalWindow = document.getElementById('modal-window');

minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    modalWindow.classList.toggle('minimized');
    minimizeBtn.textContent = modalWindow.classList.contains('minimized') ? '□' : '_';
});

// Prevent fluid interactions inside window
['mousedown', 'touchstart', 'mousemove', 'touchmove', 'mouseup', 'touchend'].forEach(evt => {
    modalWindow.addEventListener(evt, e => e.stopPropagation());
});

// --- RENDER LOOP ---
let time = 0;

function render() {
    time += 0.015;
    fluid.step();
    
    ctx.fillStyle = '#010409';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Build the fish character map for this frame
    let fishMap = new Map();
    for (let f of fishes) {
        f.update(time);
        let art = f.vx > 0 ? bigFishRight : bigFishLeft;
        
        for (let r = 0; r < art.length; r++) {
            for (let c = 0; c < art[r].length; c++) {
                let char = art[r][c];
                if (char !== ' ') { // Only draw non-empty parts of the fish
                    let gx = Math.floor(f.x) + c;
                    let gy = Math.floor(f.y) + r;
                    if (gx >= 0 && gx < cols && gy >= 0 && gy < rows) {
                        fishMap.set(gx + gy * cols, { char: char, color: f.color });
                    }
                }
            }
        }
    }

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let gridIdx = x + y * cols;
            
            // Check if a fish character occupies this cell
            if (fishMap.has(gridIdx)) {
                let fData = fishMap.get(gridIdx);
                ctx.fillStyle = fData.color;
                ctx.fillText(fData.char, x * fontWidth, y * fontSize);
                continue; // Skip rendering the sea wave for this cell
            }
            
            // Render normal sea
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
            
            if (value > 0.85 && Math.random() > 0.95) {
                value += 0.2;
            }

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

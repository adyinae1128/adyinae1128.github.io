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

    // New method: Generates a radial outward burst of velocity and density
    applyCircularForce(x, y, holdDurationSeconds) {
        // Cap duration so the explosion doesn't exceed screen limits
        let maxDuration = Math.min(holdDurationSeconds, 3.0); 
        
        // Scale parameters based on how long the user held the click
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
                            // Center of the click just gets density (foam)
                            this.density[idx] += densityAmount;
                            continue;
                        }
                        
                        let dist = Math.sqrt(distSq);
                        let nx = i / dist;
                        let ny = j / dist;
                        
                        // Force falls off linearly towards the edges of the radius
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

        // Natural dampening (dissipation)
        for(let i = 0; i < this.size; i++) {
            this.density[i] *= 0.95; // Fade foam rapidly
            this.Vx[i] *= 0.98;      // Dampen water momentum
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
        let dt0 = dt * 15.0; // Advection multiplier
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
}

window.addEventListener('resize', resize);
init();

let isDrawing = false;
let lastX = 0, lastY = 0;
let clickStartTime = 0; // Tracks when the user first clicks

function handleStart(e) {
    isDrawing = true;
    clickStartTime = Date.now();
    let point = e.touches ? e.touches[0] : e;
    lastX = point.clientX;
    lastY = point.clientY;
}

function handleEnd(e) { 
    if (isDrawing) {
        // Calculate total hold time in seconds
        let durationSeconds = (Date.now() - clickStartTime) / 1000;
        
        let gridX = Math.floor(lastX / fontWidth);
        let gridY = Math.floor(lastY / fontSize);
        
        // Trigger the splash based on duration at the release coordinates
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
    
    // Interpolate steps so fast strokes don't skip cells
    let dist = Math.max(Math.abs(gridX1 - gridX0), Math.abs(gridY1 - gridY0));
    let steps = Math.max(1, dist);
    
    for (let i = 0; i <= steps; i++) {
        let t = steps === 0 ? 0 : i / steps;
        let cx = Math.floor(gridX0 + (gridX1 - gridX0) * t);
        let cy = Math.floor(gridY0 + (gridY1 - gridY0) * t);
        
        fluid.addForce(cx, cy, dx * 0.1, dy * 0.1, 4.0); // Add momentum & visual density/foam
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

// --- RENDER LOOP ---
let time = 0;

function render() {
    time += 0.015; // Animation speed for calm waves
    
    fluid.step(); // Compute Navier-Stokes physics
    
    // Clear background
    ctx.fillStyle = '#010409';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let idx = fluid.IX(x, y);
            let vx = fluid.Vx[idx];
            let vy = fluid.Vy[idx];
            let d = fluid.density[idx];
            
            // Coordinate scaling for wave size, physically displaced by fluid momentum
            let nx = (x - vx * 5) * 0.05;
            let ny = (y - vy * 5) * 0.08;

            // Combine multiple sine waves for organic fluid movement
            let wave1 = Math.sin(nx + time) * Math.cos(ny + time * 0.8);
            let wave2 = Math.sin(nx * 1.5 - time * 1.2) * Math.sin(ny * 1.5 + time * 0.5);
            let wave3 = Math.sin(nx * 0.4 + ny * 0.6 - time * 0.4);
            
            let value = (wave1 + wave2 + wave3) / 3;
            
            // Mouse stroke and splash logic adds density (foam and height) to the waves
            value += d * 0.25; 
            
            // Occasional "foam" spark on the peaks
            if (value > 0.85 && Math.random() > 0.95) {
                value += 0.2;
            }

            // Normalize to 0 - 1
            let normalized = (value + 1) / 2;
            
            // Map to palette indices
            let index = Math.floor(normalized * palette.length);
            index = Math.max(0, Math.min(palette.length - 1, index));

            // Draw character
            ctx.fillStyle = colors[index];
            ctx.fillText(palette[index], x * fontWidth, y * fontSize);
        }
    }
    
    requestAnimationFrame(render);
}

render();

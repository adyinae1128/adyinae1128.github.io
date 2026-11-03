const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
document.body.appendChild(canvas);

let cols, rows, fontWidth;
const fontSize = 16;
let fluid;
let isDarkMode = false;
let fishes = [];

// Characters ordered by visual density
const palette = ['.', ',', '-', '~', '/', '+', '=', '?', 'X', '&', '#', '@'];

// Colors for the sea, from deep troughs to bright wave crests/foam
let colors = [
    '#000B18', '#001A33', '#002B4E', '#003E6B',
    '#00528A', '#0069AC', '#0081D0', '#009BFA',
    '#33B1FF', '#66C8FF', '#99E0FF', '#FFFFFF' 
];

// --- AUTONOMOUS FISH AI ---
class Fish {
    constructor(cols, rows) {
        this.x = Math.random() * cols;
        this.y = Math.random() * rows;
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;
        this.baseSpeed = 0.04 + Math.random() * 0.04;
        
        // Distinct, bright colors to stand out from the blue sea
        this.color = ['#FF8C00', '#FFA500', '#FFD700', '#FF4500'][Math.floor(Math.random() * 4)];
        this.facingRight = true;
    }

    update(cols, rows, fluid) {
        // Aimless wandering AI: Periodically pick a new direction
        if (Math.random() < 0.02) {
            this.targetAngle = this.angle + (Math.random() - 0.5) * Math.PI;
        }
        
        // Smoothly steer towards the target angle
        this.angle += (this.targetAngle - this.angle) * 0.05;

        let vx = Math.cos(this.angle) * this.baseSpeed;
        let vy = Math.sin(this.angle) * this.baseSpeed;

        let fluidVx = 0;
        let fluidVy = 0;
        let gx = Math.floor(this.x);
        let gy = Math.floor(this.y);

        // Fluid physics interaction
        if (gx >= 0 && gx < cols && gy >= 0 && gy < rows) {
            let idx = fluid.IX(gx, gy);
            
            // Get swept by the fluid currents
            fluidVx = fluid.Vx[idx] * 3.0;
            fluidVy = fluid.Vy[idx] * 3.0;
            
            // Fish push back against the water, generating tiny wakes/foam
            if (Math.random() < 0.2) {
                fluid.addForce(gx, gy, -vx * 0.5, -vy * 0.5, 0.5);
            }
        }

        let totalVx = vx + fluidVx;
        let totalVy = vy + fluidVy;

        this.x += totalVx;
        this.y += totalVy;
        this.facingRight = totalVx >= 0;

        // Wrap around screen edges seamlessly
        if (this.x < -3) this.x = cols + 3;
        if (this.x > cols + 3) this.x = -3;
        if (this.y < -1) this.y = rows + 1;
        if (this.y > rows + 1) this.y = -1;
    }

    draw(ctx, fontWidth, fontSize) {
        ctx.fillStyle = this.color;
        let char = this.facingRight ? '><>' : '<><';
        ctx.fillText(char, this.x * fontWidth, this.y * fontSize);
    }
}

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

// --- SETUP & EVENT LISTENERS ---
function init() {
    ctx.font = `${fontSize}px monospace`;
    fontWidth = ctx.measureText('M').width;
    resize();
    
    // Spawn initial school of fish
    fishes = [];
    for (let i = 0; i < 20; i++) {
        fishes.push(new Fish(cols, rows));
    }
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
let clickStartTime = 0;

function handleStart(e) {
    if (e.target.closest('#modal-window')) return;
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

// --- RENDER LOOP ---
let time = 0;

function render() {
    time += 0.015; 
    
    fluid.step(); 
    
    // Draw background
    ctx.fillStyle = isDarkMode ? '#010409' : '#e2e8f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Render calm waves mapped by fluid momentum
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
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
            let index = Math.floor(normalized * palette.length);
            index = Math.max(0, Math.min(palette.length - 1, index));

            ctx.fillStyle = colors[index];
            ctx.fillText(palette[index], x * fontWidth, y * fontSize);
        }
    }
    
    // Render Fish
    for (let i = 0; i < fishes.length; i++) {
        fishes[i].update(cols, rows, fluid);
        fishes[i].draw(ctx, fontWidth, fontSize);
    }
    
    requestAnimationFrame(render);
}
render();

// --- WINDOW & TERMINAL LOGIC ---
const minimizeBtn = document.getElementById('minimize-btn');
const themeBtn = document.getElementById('theme-btn');
const modalWindow = document.getElementById('modal-window');

function toggleTheme() {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle('dark-mode', isDarkMode);
    themeBtn.textContent = isDarkMode ? '☀' : '☾';
}

themeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTheme();
    printLine(`Theme switched to ${isDarkMode ? 'Dark' : 'Light'} Mode.`);
});

minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    modalWindow.classList.toggle('minimized');
    minimizeBtn.textContent = modalWindow.classList.contains('minimized') ? '□' : '_';
});

// Prevent fluid canvas interactions when operating the window
modalWindow.addEventListener('mousedown', (e) => e.stopPropagation());
modalWindow.addEventListener('touchstart', (e) => e.stopPropagation());
modalWindow.addEventListener('mousemove', (e) => e.stopPropagation());
modalWindow.addEventListener('touchmove', (e) => e.stopPropagation());
modalWindow.addEventListener('mouseup', (e) => e.stopPropagation());
modalWindow.addEventListener('touchend', (e) => e.stopPropagation());

// Terminal Implementation
const termInput = document.getElementById('terminal-input');
const termOutput = document.getElementById('terminal-output');
const termContainer = document.getElementById('terminal');

const cmds = {
    'help': 'Available commands:\n  help   - Show this message\n  clear  - Clear terminal output\n  splash - Create a random fluid splash\n  color  - Change wave base color (usage: color R G B)\n  fish   - Add more fish to the sea (usage: fish [count])\n  theme  - Toggle Dark/Light Mode\n  echo   - Print given text\n  about  - ASCII Sea OS info',
    'about': 'ASCII Sea OS v1.0.0\nPowered by Navier-Stokes Stable Fluids algorithm.',
    'clear': () => { termOutput.innerHTML = ''; }
};

termInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        const val = this.value.trim();
        this.value = '';
        
        if (val) {
            printLine(`root@sea:~$ ${val}`);
            runCmd(val);
        }
    }
});

function printLine(text) {
    const div = document.createElement('div');
    div.textContent = text;
    termOutput.appendChild(div);
    termContainer.scrollTop = termContainer.scrollHeight;
}

function runCmd(inputStr) {
    const args = inputStr.split(' ');
    const cmd = args[0].toLowerCase();

    if (cmd === 'clear') {
        cmds['clear']();
    } else if (cmds[cmd] && typeof cmds[cmd] === 'string') {
        printLine(cmds[cmd]);
    } else if (cmd === 'echo') {
        printLine(args.slice(1).join(' '));
    } else if (cmd === 'splash') {
        let cx = Math.floor(cols / 2);
        let cy = Math.floor(rows / 2);
        fluid.applyCircularForce(cx, cy, 3.0);
        printLine('Splash deployed at coordinates (' + cx + ', ' + cy + ')');
    } else if (cmd === 'theme') {
        toggleTheme();
        printLine(`Theme switched to ${isDarkMode ? 'Dark' : 'Light'} Mode.`);
    } else if (cmd === 'fish') {
        let amount = parseInt(args[1]) || 1;
        if (amount > 0 && amount < 1000) {
            for (let i = 0; i < amount; i++) {
                fishes.push(new Fish(cols, rows));
            }
            printLine(`Spawned ${amount} new fish. Total population: ${fishes.length}`);
        } else {
            printLine(`bash: fish: invalid amount`);
        }
    } else if (cmd === 'color') {
        if (args.length === 4) {
            let r = parseInt(args[1]);
            let g = parseInt(args[2]);
            let b = parseInt(args[3]);
            
            if (!isNaN(r) && !isNaN(g) && !isNaN(b) && 
                r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
                
                for (let i = 0; i < 12; i++) {
                    let cr, cg, cb;
                    if (i <= 7) {
                        let t = (i + 1) / 8; 
                        cr = Math.floor(r * t);
                        cg = Math.floor(g * t);
                        cb = Math.floor(b * t);
                    } else {
                        let t = (i - 7) / 4; 
                        cr = Math.floor(r + (255 - r) * t);
                        cg = Math.floor(g + (255 - g) * t);
                        cb = Math.floor(b + (255 - b) * t);
                    }
                    colors[i] = `rgb(${cr}, ${cg}, ${cb})`;
                }
                printLine(`Sea color updated to base RGB(${r}, ${g}, ${b})`);
            } else {
                printLine(`bash: color: arguments must be integers between 0 and 255`);
            }
        } else {
            printLine(`Usage: color <R> <G> <B> (e.g., color 255 0 100)`);
        }
    } else {
        printLine(`bash: ${cmd}: command not found`);
    }
}

// Keep focus on input when clicking terminal area
termContainer.addEventListener('click', () => termInput.focus());

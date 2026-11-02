const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
document.body.appendChild(canvas);

let cols, rows, fontWidth;
const fontSize = 16;

// Characters ordered by visual density
const palette = ['.', ',', '-', '~', '/', '+', '=', '?', 'X', '&', '#', '@'];

// Colors for the sea, from deep troughs to bright wave crests/foam
const colors = [
    '#000B18', // Deep sea navy
    '#001A33', 
    '#002B4E', 
    '#003E6B',
    '#00528A', 
    '#0069AC', 
    '#0081D0', 
    '#009BFA',
    '#33B1FF', 
    '#66C8FF', 
    '#99E0FF', 
    '#FFFFFF'  // White foam on top
];

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
    
    // Re-apply font after canvas resize
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'top';
}

window.addEventListener('resize', resize);
init();

let time = 0;

function render() {
    time += 0.015; // Animation speed for calm waves
    
    // Clear background
    ctx.fillStyle = '#010409';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            // Coordinate scaling for wave size
            let nx = x * 0.05;
            let ny = y * 0.08;

            // Combine multiple sine waves for organic fluid movement
            let wave1 = Math.sin(nx + time) * Math.cos(ny + time * 0.8);
            let wave2 = Math.sin(nx * 1.5 - time * 1.2) * Math.sin(ny * 1.5 + time * 0.5);
            let wave3 = Math.sin(nx * 0.4 + ny * 0.6 - time * 0.4);
            
            // Average the waves to get a value between -1 and 1
            let value = (wave1 + wave2 + wave3) / 3;
            
            // Occasional "foam" spark on the peaks
            if (value > 0.85 && Math.random() > 0.95) {
                value += 0.2;
            }

            // Normalize to 0 - 1
            let normalized = (value + 1) / 2;
            
            // Map to palette indices
            let index = Math.floor(normalized * palette.length);
            
            // Clamp index to array bounds
            index = Math.max(0, Math.min(palette.length - 1, index));

            // Draw character
            ctx.fillStyle = colors[index];
            ctx.fillText(palette[index], x * fontWidth, y * fontSize);
        }
    }
    
    requestAnimationFrame(render);
}

// Start animation loop
render();

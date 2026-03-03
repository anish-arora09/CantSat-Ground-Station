// ==== Global State & Settings ====
const maxDataPoints = 60; // Keep last 60 points for performance
let isSimulating = false;
let serialPort = null;
let serialReader = null;

// Telemetry State
const state = {
    time: [],         // Simple counter for X-axis (could be real seconds if Pico sends timestamp)
    currentTime: 0,
    altitude: [],
    temperature: [],
    pressure: [],
    speed: [],
    lat: [],
    lon: [],
    sats: []
};

// Accumulator for parsing multi-line serial data
let currentDataBlock = {};

// ==== Chart.js Initialization ====
Chart.defaults.color = '#9aa4b5';
Chart.defaults.font.family = "'Inter', sans-serif";
const gridConfig = { color: 'rgba(255, 255, 255, 0.05)' };
const animConfig = { duration: 0 }; // Disable anims for real-time performance

// Chart 1: Altitude vs Time
const ctxAlt = document.getElementById('chart-altitude').getContext('2d');
const chartAlt = new Chart(ctxAlt, {
    type: 'line',
    data: {
        labels: state.time,
        datasets: [{
            label: 'Altitude (m)',
            data: state.altitude,
            borderColor: '#00e5ff',
            backgroundColor: 'rgba(0, 229, 255, 0.1)',
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointRadius: 0
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animConfig,
        scales: {
            x: { grid: gridConfig, title: { display: true, text: 'Time (s)' } },
            y: { grid: gridConfig }
        }
    }
});

// Chart 2: Temperature vs Altitude
const ctxTemp = document.getElementById('chart-temperature').getContext('2d');
const chartTemp = new Chart(ctxTemp, {
    type: 'line', // Hacky scatter that connects lines
    data: {
        datasets: [{
            label: 'Temperature Profile',
            data: [], // Array of {x, y} objects
            borderColor: '#ff3366',
            backgroundColor: 'rgba(255, 51, 102, 0.5)',
            borderWidth: 2,
            showLine: true,
            pointRadius: 3
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animConfig,
        scales: {
            x: { type: 'linear', position: 'bottom', grid: gridConfig, title: { display: true, text: 'Altitude (m)' } },
            y: { grid: gridConfig, title: { display: true, text: 'Temperature (°C)' } }
        }
    }
});

// Chart 3: Velocity vs Time
const ctxVel = document.getElementById('chart-velocity').getContext('2d');
const chartVel = new Chart(ctxVel, {
    type: 'line',
    data: {
        labels: state.time,
        datasets: [{
            label: 'Descent Speed (km/h)',
            data: state.speed,
            borderColor: '#ffea00',
            backgroundColor: 'rgba(255, 234, 0, 0.1)',
            borderWidth: 2,
            tension: 0.4,
            fill: true,
            pointRadius: 0
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animConfig,
        scales: {
            x: { grid: gridConfig, title: { display: true, text: 'Time (s)' } },
            y: { grid: gridConfig }
        }
    }
});

// Chart 4: Ground Track (Lat vs Lon)
const ctxTrack = document.getElementById('chart-groundtrack').getContext('2d');
const chartTrack = new Chart(ctxTrack, {
    type: 'scatter',
    data: {
        datasets: [{
            label: 'GPS Path',
            data: [], // Array of {x: lon, y: lat}
            borderColor: '#00e676',
            backgroundColor: '#00e676',
            borderWidth: 2,
            showLine: true, // Connect the dots to show path
            pointRadius: 4
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: animConfig,
        scales: {
            x: { type: 'linear', position: 'bottom', grid: gridConfig, title: { display: true, text: 'Longitude' } },
            y: { grid: gridConfig, title: { display: true, text: 'Latitude' } }
        }
    }
});

// ==== Data Processing ====

function updateDashboard(data) {
    // 1. Update text metrics in sidebar
    if (data.altitude !== undefined) document.getElementById('val-alt').innerText = data.altitude.toFixed(1);
    if (data.temperature !== undefined) document.getElementById('val-temp').innerText = data.temperature.toFixed(2);
    if (data.pressure !== undefined) document.getElementById('val-press').innerText = data.pressure.toFixed(1);
    if (data.speed !== undefined) document.getElementById('val-speed').innerText = data.speed.toFixed(1);
    if (data.sats !== undefined) document.getElementById('val-sats').innerText = data.sats;

    // 2. Update State Arrays (only if we got a full update or partial that progressed time)
    // For simplicity, we assume a new altitude reading means a new 'tick'
    if (data.altitude !== undefined) {
        state.currentTime++;
        state.time.push(state.currentTime);
        state.altitude.push(data.altitude);

        // Push latest values (use previous if missing this cycle)
        state.temperature.push(data.temperature !== undefined ? data.temperature : (state.temperature.length > 0 ? state.temperature[state.temperature.length - 1] : 0));
        state.speed.push(data.speed !== undefined ? data.speed : (state.speed.length > 0 ? state.speed[state.speed.length - 1] : 0));

        // Temp vs Alt specialized object array
        const latestTemp = state.temperature[state.temperature.length - 1];
        chartTemp.data.datasets[0].data.push({ x: data.altitude, y: latestTemp });

        // Push Lat/Lon specifically for scatter map
        if (data.lat !== undefined && data.lon !== undefined) {
            chartTrack.data.datasets[0].data.push({ x: data.lon, y: data.lat });
        }

        // 3. Trim arrays to prevent memory leak and keep chart readable
        if (state.time.length > maxDataPoints) {
            state.time.shift();
            state.altitude.shift();
            state.temperature.shift();
            state.speed.shift();
            chartTemp.data.datasets[0].data.shift();
            // Don't shift ground track, keep full history generally
        }

        // 4. Trigger Chart.js updates
        chartAlt.update();
        chartTemp.update();
        chartVel.update();
        chartTrack.update();
    }
}

// Custom parser based on user's specific sample data format
function parseSerialLine(line) {
    if (!line || line.includes("----------")) return; // Separator

    try {
        // Find Lat and Lon
        if (line.includes("Lat:") && line.includes("Lon:")) {
            const parts = line.split("Lon:");
            const latStr = parts[0].replace("Lat:", "").trim();
            const lonStr = parts[1].trim();
            currentDataBlock.lat = parseFloat(latStr);
            currentDataBlock.lon = parseFloat(lonStr);
        }
        // Find Altitude
        else if (line.includes("Altitude:")) {
            currentDataBlock.altitude = parseFloat(line.replace("Altitude:", "").replace("m", "").trim());
        }
        // Find Speed
        else if (line.includes("Speed:")) {
            currentDataBlock.speed = parseFloat(line.replace("Speed:", "").replace("km/h", "").trim());
        }
        // Find Sats
        else if (line.includes("Sats:")) {
            currentDataBlock.sats = parseInt(line.replace("Sats:", "").trim());
        }
        // Find Temp and Pressure
        else if (line.includes("Temp:") && line.includes("Pressure:")) {
            const parts = line.split("Pressure:");
            const tempStr = parts[0].replace("Temp:", "").replace("°C", "").trim();
            const pressStr = parts[1].replace("hPa", "").trim();
            currentDataBlock.temperature = parseFloat(tempStr);
            currentDataBlock.pressure = parseFloat(pressStr);

            // Assuming Temp/Pressure line is the LAST line in a complete block, 
            // trigger the dashboard update here
            updateDashboard(currentDataBlock);
            // Reset block for next cycle
            currentDataBlock = {};
        }
    } catch (e) {
        console.error("Parse error on line:", line, e);
    }
}

// ==== UI & Terminal Helpers ====

const terminalElement = document.getElementById('serial-terminal');
function logToTerminal(text) {
    const div = document.createElement('div');
    div.textContent = text;
    terminalElement.appendChild(div);
    // Auto-scroll to bottom
    terminalElement.scrollTop = terminalElement.scrollHeight;

    // Limits terminal history to prevent lag
    if (terminalElement.childElementCount > 100) {
        terminalElement.removeChild(terminalElement.firstChild);
    }
}

function updateConnectionStatus(isConnected) {
    const dot = document.querySelector('.status-dot');
    const text = document.getElementById('status-text');
    const btn = document.getElementById('btn-connect');

    if (isConnected) {
        dot.className = 'status-dot connected';
        text.innerText = 'Connected via Web Serial';
        btn.innerText = 'Disconnect';
        btn.classList.add('btn-secondary');
        btn.classList.remove('btn-primary');
    } else {
        dot.className = 'status-dot disconnected';
        text.innerText = 'Disconnected';
        btn.innerText = 'Connect to Pico (USB)';
        btn.classList.add('btn-primary');
        btn.classList.remove('btn-secondary');
    }
}

// ==== Web Serial API Flow ====

async function connectSerial() {
    if (serialPort) {
        // Disconnect logic
        await serialReader.cancel();
        await serialPort.close();
        serialPort = null;
        updateConnectionStatus(false);
        logToTerminal(">>> Disconnected from Pico <<<");
        return;
    }

    try {
        // Request a port and open a connection
        serialPort = await navigator.serial.requestPort();
        await serialPort.open({ baudRate: 115200 }); // Standard Pico MicoPython baud

        updateConnectionStatus(true);
        logToTerminal(">>> Connected to Pico at 115200 baud <<<");

        // Set up streaming text decoder
        const textDecoder = new TextDecoderStream();
        const readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable);
        serialReader = textDecoder.readable.getReader();

        let partialLine = "";

        // Read loop
        while (true) {
            const { value, done } = await serialReader.read();
            if (done) {
                serialReader.releaseLock();
                break;
            }

            // Value is a chunk of string. We need to split by newlines
            // to ensure we send complete lines to the parser
            partialLine += value;
            const lines = partialLine.split(/\r?\n/);

            // The last element is either an empty string (if value ended in newline)
            // or an incomplete line. Save it for the next chunk.
            partialLine = lines.pop();

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed) {
                    logToTerminal(trimmed);
                    parseSerialLine(trimmed);
                }
            }
        }
    } catch (error) {
        logToTerminal(">>> Connection Error: " + error + " <<<");
        updateConnectionStatus(false);
    }
}

document.getElementById('btn-connect').addEventListener('click', async () => {
    if (!("serial" in navigator)) {
        alert("Web Serial API is not supported in this browser. Please use Chrome or Edge.");
        return;
    }
    await connectSerial();
});

// ==== Simulation Mode ====

const sampleData = `
----------
Lat: 51.356168 Lon: 0.10259666
Altitude: 97.9 m
Speed: 0.0 km/h
Sats: 5
------------------------------
Temp: 19.947252 °C  Pressure: 1008.4271 hPa
----------
Lat: 51.356168 Lon: 0.10259666
Altitude: 96.5 m
Speed: 2.1 km/h
Sats: 5
------------------------------
Temp: 19.957158 °C  Pressure: 1008.4944 hPa
----------
Lat: 51.356169 Lon: 0.10259668
Altitude: 94.2 m
Speed: 2.5 km/h
Sats: 5
------------------------------
Temp: 19.947252 °C  Pressure: 1008.50352 hPa
----------
Lat: 51.356171 Lon: 0.10259670
Altitude: 91.0 m
Speed: 3.2 km/h
Sats: 5
------------------------------
Temp: 19.97201 °C  Pressure: 1008.51868 hPa
----------
Lat: 51.356175 Lon: 0.10259675
Altitude: 85.5 m
Speed: 4.8 km/h
Sats: 5
------------------------------
Temp: 19.981912 °C  Pressure: 1008.484 hPa
----------
Lat: 51.356180 Lon: 0.10259681
Altitude: 81.2 m
Speed: 4.5 km/h
Sats: 6
------------------------------
Temp: 19.9769632 °C  Pressure: 1008.4761 hPa
----------
Lat: 51.356185 Lon: 0.10259690
Altitude: 76.8 m
Speed: 4.2 km/h
Sats: 6
------------------------------
Temp: 19.986864 °C  Pressure: 1008.46684 hPa
----------
`;

let simInterval = null;

document.getElementById('btn-simulate').addEventListener('click', () => {
    isSimulating = !isSimulating;
    const btn = document.getElementById('btn-simulate');

    if (isSimulating) {
        btn.innerText = "Stop Simulation";
        btn.style.borderColor = "var(--accent-red)";
        btn.style.color = "var(--accent-red)";
        logToTerminal(">>> Generating Simulated Descent Data... <<<");

        let lines = sampleData.trim().split(/\r?\n/);
        let i = 0;

        // I've modified the simulation to generate synthetic data based on the sample start point 
        // to show a cool descent profile over 30 seconds rather than just repeating the 5 sample points

        let simAlt = 97.9;
        let simSpeed = 0;
        let simLat = 51.356168;
        let simLon = 0.10259666;
        let phase = 0; // 0 = start, 1 = drop, 2 = parachute

        simInterval = setInterval(() => {
            // Generate synthetic serial data line by line
            logToTerminal("----------"); parseSerialLine("----------");

            // Physics sim changes
            if (phase === 0 && state.currentTime > 2) phase = 1; // Drop!
            if (phase === 1 && state.currentTime > 8) phase = 2; // Chute deploy!
            if (phase === 1) simSpeed += 9.8; // Freefall
            if (phase === 2 && simSpeed > 5.0) simSpeed -= 15.0; // Rapid decel
            if (simSpeed < 0) simSpeed = 4.5; // Terminal velocity
            if (simAlt < 0) { simAlt = 0; simSpeed = 0; } // Landed

            simAlt -= (simSpeed * (1000 / 3600)); // convert kmh to m/s roughly
            simLat += (Math.random() * 0.000010 - 0.000002); // Drift NE
            simLon += (Math.random() * 0.000010);

            const line1 = `Lat: ${simLat.toFixed(6)} Lon: ${simLon.toFixed(8)}`;
            const line2 = `Altitude: ${Math.max(0, simAlt).toFixed(1)} m`;
            const line3 = `Speed: ${simSpeed.toFixed(1)} km/h`;
            const line4 = `Sats: 6`;

            logToTerminal(line1); parseSerialLine(line1);
            logToTerminal(line2); parseSerialLine(line2);
            logToTerminal(line3); parseSerialLine(line3);
            logToTerminal(line4); parseSerialLine(line4);
            logToTerminal("------------------------------"); parseSerialLine("------------------------------");

            const temp = 20.0 - (simAlt / 100); // gets cooler higher up
            const press = 1008.5 - (simAlt / 10);
            const line5 = `Temp: ${temp.toFixed(4)} °C  Pressure: ${press.toFixed(4)} hPa`;
            logToTerminal(line5); parseSerialLine(line5);

            if (simAlt <= 0) {
                clearInterval(simInterval);
                logToTerminal(">>> Simulation Complete: Touchdown <<<");
                btn.innerText = "Run Simulation";
                btn.style = "";
                isSimulating = false;
            }

        }, 1000); // 1Hz telemetry

    } else {
        clearInterval(simInterval);
        btn.innerText = "Run Simulation";
        btn.style = "";
        logToTerminal(">>> Simulation Stopped <<<");
    }
});

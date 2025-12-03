let metroData;
let lines = [];
let stations = [];
let transfers = [];
let stationMap = {};
let lineDirectionMap = {}; 

// --- CONFIGURATION ---
const GRID_SIZE = 70;      
const STATION_SIZE = 14;   
const LINE_WIDTH = 12;     
const SEED = 12345;        

// --- CONFIGURATION AUDIO ---
const CROSSFADE_DURATION = 2000; // 2 secondes de fondu enchaîné
const TRACK_START_TIME = 30;     // Commencer à 30s
const STATION_DURATION = 15000;  // 15s par station

// Variables internes
let takenCells = new Set();
let adjacencyList = {};
let selectedStart = null;
let selectedEnd = null;
let currentPath = [];

// Variables Voyage
let isJourneyActive = false;
let journeyTimer = 0;
let trainPos = null;
let currentStationIdx = 0;
let nextTimeout = null;

// Caméra
let mapScale = 1, mapOffsetX = 0, mapOffsetY = 0;
let isDragging = false;

// --- MOTEUR AUDIO DJ (Double Deck) ---
let playerA = new Audio();
let playerB = new Audio();
let activeDeck = 'A'; // Quel lecteur est le principal ? 'A' ou 'B'
let uiContainer = null;

const DIRS = [
  {x: 1, y: 0}, {x: -1, y: 0}, {x: 0, y: 1}, {x: 0, y: -1}, 
  {x: 1, y: 1}, {x: 1, y: -1}, {x: -1, y: 1}, {x: -1, y: -1} 
];

function preload() {
  metroData = loadJSON('metro_data_local.json');
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont('Arial, Helvetica, sans-serif');
  
  generateOptimizedLayout(SEED);
  applyParallelLineAdjustment();
  buildSpatialGraph(); 
  calculateInitialCameraFit();
  initAudioUI();
}

function draw() {
  background(252, 250, 245); 

  push(); 
  translate(mapOffsetX, mapOffsetY);
  scale(mapScale);

  let mouseWorldX = (mouseX - mapOffsetX) / mapScale;
  let mouseWorldY = (mouseY - mapOffsetY) / mapScale;
  let isPathActive = currentPath.length > 0;

  // 1. LIGNES
  noFill(); strokeJoin(ROUND); strokeCap(PROJECT);
  let groups = groupStationsByLine();
  for (let pass = 0; pass < 2; pass++) {
      for (let lineId in groups) {
        let lineStations = groups[lineId];
        let lineObj = lines.find(l => l.line_id == lineId);
        if (!lineObj || lineStations.length < 2) continue;
        let isDimmed = isPathActive; 
        beginShape();
        if (pass === 0) { 
             strokeWeight(LINE_WIDTH + 2); stroke(0, 0, 0, 15);
             for (let s of lineStations) vertex(s.x + 3, s.y + 3);
        } else { 
             strokeWeight(LINE_WIDTH); stroke(isDimmed ? color(220) : lineObj.color); 
             for (let s of lineStations) vertex(s.x, s.y);
        }
        endShape();
      }
  }

  // 2. CHEMIN GPS
  if (isPathActive) {
    noFill(); stroke(50); strokeWeight(LINE_WIDTH); strokeJoin(ROUND);
    beginShape();
    for (let s of currentPath) vertex(s.x, s.y);
    endShape();
  }

  // 3. STATIONS
  let hubs = detectHubs();
  for (let s of stations) {
     if (isStationInHub(s, hubs)) continue;
     let isStart = selectedStart === s; let isEnd = selectedEnd === s; let onPath = currentPath.includes(s);
     strokeWeight(2);
     if (isStart) { fill(0, 200, 0); stroke(0); circle(s.x, s.y, STATION_SIZE + 6); }
     else if (isEnd) { fill(200, 0, 0); stroke(0); circle(s.x, s.y, STATION_SIZE + 6); }
     else if (onPath) { fill(255); stroke(0); circle(s.x, s.y, STATION_SIZE); } 
     else { stroke(s.lineColor); fill(255); circle(s.x, s.y, STATION_SIZE); }
     
     if (!isPathActive || onPath || isStart || isEnd) {
         drawAngledLabel(s, false, calculateLabelAngle(s));
     }
  }
  for (let hub of hubs) {
      let isStartHub = hub.stations.includes(selectedStart);
      let isEndHub = hub.stations.includes(selectedEnd);
      let onPathHub = hub.stations.some(s => currentPath.includes(s));
      strokeWeight(2);
      if(isStartHub) { stroke(0); fill(0, 200, 0); }
      else if(isEndHub) { stroke(0); fill(200, 0, 0); }
      else if(onPathHub && isPathActive) { stroke(0); fill(255); } 
      else { stroke(0); fill(255); }
      rectMode(CENTER);
      let w = STATION_SIZE + (hub.stations.length * 4); let h = STATION_SIZE + 4;
      rect(hub.x, hub.y, w, h, 8);
      if (!isPathActive || onPathHub || isStartHub || isEndHub) drawAngledLabel(hub.stations[0], true, -PI/4);
  }

  // 4. ANIMATION TRAIN
  if (isJourneyActive && trainPos) {
      updateTrainPosition(); 
      fill(0); noStroke(); circle(trainPos.x, trainPos.y, 20);
      fill(255); textAlign(CENTER, CENTER); textSize(10); text("♫", trainPos.x, trainPos.y);
      noFill(); stroke(0, 100); strokeWeight(2);
      let pulse = (millis() % 1000) / 20;
      circle(trainPos.x, trainPos.y, 20 + pulse);
  }

  pop(); 
  drawLegend();
}

// --- LOGIQUE TRAIN ---
function updateTrainPosition() {
    if (currentStationIdx >= currentPath.length - 1) {
        let finalS = currentPath[currentPath.length - 1];
        trainPos = createVector(finalS.x, finalS.y);
        return;
    }
    let startS = currentPath[currentStationIdx];
    let nextS = currentPath[currentStationIdx + 1];
    let elapsed = millis() - journeyTimer;
    let progress = constrain(elapsed / STATION_DURATION, 0, 1);
    let curX = lerp(startS.x, nextS.x, progress);
    let curY = lerp(startS.y, nextS.y, progress);
    trainPos = createVector(curX, curY);
}

// --- SÉQUENCEUR DE VOYAGE ---
function startMusicalJourney() {
    if (currentPath.length === 0) return;
    console.log("Départ !");
    isJourneyActive = true;
    currentStationIdx = 0;
    uiContainer.style('display', 'flex');
    playCurrentStep();
}

function playCurrentStep() {
    if (nextTimeout) clearTimeout(nextTimeout);

    if (currentStationIdx >= currentPath.length) {
        stopJourney();
        return;
    }

    let station = currentPath[currentStationIdx];
    journeyTimer = millis(); 
    trainPos = createVector(station.x, station.y);

    // --- LANCEMENT AUDIO (CROSSFADE) ---
    if (station.playlist && station.playlist.length > 0) {
        let track = random(station.playlist);
        
        // UI
        select('#player-title').html(`<b>${station.name.toUpperCase()}</b>`);
        select('#player-desc').html(`${track.title}<br><span style="font-size:10px; color:#aaa">${track.artist}</span>`);
        
        // On appelle le DJ pour mixer le son
        crossfadeToTrack(track.url);
        
        // Programme la suite
        nextTimeout = setTimeout(() => {
            currentStationIdx++;
            playCurrentStep(); 
        }, STATION_DURATION);
        
    } else {
        console.log("Pas de son, on avance.");
        nextTimeout = setTimeout(() => {
            currentStationIdx++;
            playCurrentStep();
        }, 2000); 
    }
}

function stopJourney() {
    isJourneyActive = false;
    fadeOut(playerA);
    fadeOut(playerB);
    select('#player-title').html("Terminus");
    select('#player-desc').html("Voyage terminé");
    if (nextTimeout) clearTimeout(nextTimeout);
}

// --- MOTEUR AUDIO AVANCÉ (CROSSFADE) ---
function crossfadeToTrack(url) {
    // 1. Identifier qui joue et qui est libre
    let incoming = (activeDeck === 'A') ? playerB : playerA;
    let outgoing = (activeDeck === 'A') ? playerA : playerB;
    
    // 2. Préparer le nouveau lecteur (Incoming)
    incoming.src = url;
    incoming.currentTime = TRACK_START_TIME;
    incoming.volume = 0; // Commence silencieux
    
    // 3. Lancer la lecture
    let playPromise = incoming.play();
    if (playPromise !== undefined) {
        playPromise.catch(error => { console.error("Erreur lecture:", error); });
    }

    // 4. Faire le Crossfade (Volume Up pour Incoming, Down pour Outgoing)
    performFade(incoming, 0, 1); // Fade In
    performFade(outgoing, outgoing.volume, 0); // Fade Out
    
    // 5. Basculer l'état
    activeDeck = (activeDeck === 'A') ? 'B' : 'A';
}

function performFade(player, startVol, endVol) {
    let steps = 20; // Nombre d'étapes de volume
    let stepTime = CROSSFADE_DURATION / steps;
    let volStep = (endVol - startVol) / steps;
    let currentStep = 0;

    let fadeInterval = setInterval(() => {
        currentStep++;
        let newVol = startVol + (volStep * currentStep);
        
        // Sécurité bornes 0.0 - 1.0
        newVol = Math.max(0, Math.min(1, newVol));
        
        try {
            player.volume = newVol;
        } catch(e) {} // Ignorer erreurs si player déchargé

        if (currentStep >= steps) {
            clearInterval(fadeInterval);
            // Si c'est un fade out complet, on peut pauser pour économiser CPU
            if (endVol === 0) {
                player.pause();
                player.currentTime = 0; 
            }
        }
    }, stepTime);
}

// --- UI COMPACTE ---
function initAudioUI() {
    if (uiContainer) uiContainer.remove();
    uiContainer = createDiv('');
    uiContainer.position(20, windowHeight - 140);
    uiContainer.size(280, 100); 
    uiContainer.style('background', 'rgba(30, 30, 30, 0.95)');
    uiContainer.style('backdrop-filter', 'blur(10px)');
    uiContainer.style('color', '#fff');
    uiContainer.style('border-radius', '12px');
    uiContainer.style('padding', '15px');
    uiContainer.style('box-shadow', '0 8px 32px rgba(0,0,0,0.3)');
    uiContainer.style('font-family', 'Arial, sans-serif');
    uiContainer.style('display', 'none'); 
    uiContainer.style('flex-direction', 'column');
    uiContainer.style('justify-content', 'space-between');
    uiContainer.style('z-index', '1000');

    let infoDiv = createDiv('');
    infoDiv.parent(uiContainer);
    infoDiv.style('margin-bottom', '10px');
    
    let title = createDiv('Station');
    title.id('player-title');
    title.parent(infoDiv);
    title.style('font-size', '14px');
    title.style('font-weight', 'bold');
    title.style('color', '#4DB6AC'); 

    let desc = createDiv('En attente...');
    desc.id('player-desc');
    desc.parent(infoDiv);
    desc.style('font-size', '12px');
    desc.style('white-space', 'nowrap');
    desc.style('overflow', 'hidden');
    desc.style('text-overflow', 'ellipsis');

    let controlsDiv = createDiv('');
    controlsDiv.parent(uiContainer);
    controlsDiv.style('display', 'flex');
    controlsDiv.style('gap', '10px');
    
    let btnStop = createButton('✖ Arrêter');
    btnStop.parent(controlsDiv);
    btnStop.mousePressed(() => {
        stopJourney();
        uiContainer.hide();
        currentPath = [];
        selectedStart = null; selectedEnd = null;
    });
    btnStop.style('background', '#d32f2f');
    btnStop.style('border', 'none');
    btnStop.style('color', 'white');
    btnStop.style('padding', '5px 10px');
    btnStop.style('border-radius', '4px');
    btnStop.style('cursor', 'pointer');
}

function fadeOut(player) {
    performFade(player, player.volume, 0);
}

// --- UTILS (Reste inchangé) ---
function getConnectedStationID(stationID, validLineIDs) { for (let t of transfers) { let neighbor = null; if (t.source === stationID) neighbor = t.target; if (t.target === stationID) neighbor = t.source; if (neighbor) { let neighborLine = getLineOfStation(neighbor, Object.values(metroData.stations)); if (validLineIDs.has(neighborLine)) return neighbor; } } return null; }
function getLineOfStation(sid, allStations) { let s = allStations.find(st => st.station_id === sid); return s ? s.line_id : null; }
function getLineID(sid, allS) { let f = allS.find(s => s.station_id === sid); return f ? f.line_id : null; }
function findFreeSpot(cx, cy) { let r = 0; while(r < 200) { for(let angle=0; angle<TWO_PI; angle+=0.5) { let tx = cx + Math.round(Math.cos(angle)*r)*GRID_SIZE; let ty = cy + Math.round(Math.sin(angle)*r)*GRID_SIZE; if(!takenCells.has(makeKey(tx,ty))) return {x:tx, y:ty}; } r++; } return {x:cx, y:cy}; }
function markOccupied(x, y) { takenCells.add(makeKey(x,y)); }
function makeKey(x, y) { return x + "," + y; }
function isOccupiedByLine(x, y, lineId) { return takenCells.has(makeKey(x, y)); }
function randomSeed(s) { /* p5 randomSeed */ }
function myRandom() { return random(); } 
function detectHubs() { let map = {}; let hubs = []; for(let s of stations) { if(s.x === undefined) continue; let k = Math.round(s.x) + "," + Math.round(s.y); if(!map[k]) map[k] = []; map[k].push(s); } for(let k in map) { if(map[k].length > 1) hubs.push({x: map[k][0].x, y: map[k][0].y, stations: map[k]}); } return hubs; }
function isStationInHub(s, hubs) { for(let h of hubs) { if(dist(s.x, s.y, h.x, h.y) < 2) return true; } return false; }
function groupStationsByLine() { let g = {}; for(let s of stations) { if(s.x === undefined) continue; if(!g[s.line_id]) g[s.line_id] = []; g[s.line_id].push(s); } return g; }
function calculateInitialCameraFit() { if (stations.length === 0) return; let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; for (let s of stations) { if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x; if (s.y < minY) minY = s.y; if (s.y > maxY) maxY = s.y; } let margin = GRID_SIZE * 3; let w = maxX - minX + margin*2; let h = maxY - minY + margin*2; mapScale = Math.min(width/w, height/h); mapScale = Math.min(mapScale, 1.2); mapScale = max(mapScale, 0.2); let cx = (minX + maxX)/2; let cy = (minY + maxY)/2; mapOffsetX = width/2 - cx * mapScale; mapOffsetY = height/2 - cy * mapScale; }
function buildSpatialGraph() { adjacencyList = {}; for (let s of stations) adjacencyList[s.station_id] = []; let groups = groupStationsByLine(); for(let id in groups) { let arr = groups[id]; for(let i=0; i<arr.length-1; i++) { let u = arr[i]; let v = arr[i+1]; if(dist(u.x, u.y, v.x, v.y) < GRID_SIZE * 3) { adjacencyList[u.station_id].push(v.station_id); adjacencyList[v.station_id].push(u.station_id); } } } for (let i = 0; i < stations.length; i++) { for (let j = i + 1; j < stations.length; j++) { let s1 = stations[i]; let s2 = stations[j]; if (s1.line_id === s2.line_id) continue; if (dist(s1.x, s1.y, s2.x, s2.y) < 5) { adjacencyList[s1.station_id].push(s2.station_id); adjacencyList[s2.station_id].push(s1.station_id); } } } }
function drawLegend() { let padding = 15; let itemHeight = 22; let boxWidth = 220; let uniqueLines = []; let seenIds = new Set(); for(let l of lines) { if(!seenIds.has(l.line_id)) { uniqueLines.push(l); seenIds.add(l.line_id); } } let boxHeight = uniqueLines.length * itemHeight + padding * 2; let startX = width - boxWidth - 20; let startY = height - boxHeight - 20; if(mouseX > startX && mouseY > startY) isDragging = false; fill(255, 240); stroke(200); strokeWeight(1); rectMode(CORNER); rect(startX, startY, boxWidth, boxHeight, 8); textAlign(LEFT, CENTER); textSize(11); textStyle(BOLD); for (let i = 0; i < uniqueLines.length; i++) { let l = uniqueLines[i]; let y = startY + padding + i * itemHeight; fill(l.color); noStroke(); circle(startX + 20, y, 12); fill(50); text(l.name.toUpperCase(), startX + 35, y); } }
function mouseWheel(event) { let s = 1 - event.delta * 0.001; let newScale = constrain(mapScale * s, 0.1, 5.0); let wx = (mouseX - mapOffsetX) / mapScale; let wy = (mouseY - mapOffsetY) / mapScale; mapOffsetX = mouseX - wx * newScale; mapOffsetY = mouseY - wy * newScale; mapScale = newScale; return false; }
function mouseDragged() { if (mouseX > width - 250 && mouseY > height - 400) return; isDragging = true; mapOffsetX += movedX; mapOffsetY += movedY; }
function mousePressed() { isDragging = false; }
function mouseReleased() { if (isDragging) return; handleSelectionClick(); }
function handleSelectionClick() { let mx = (mouseX - mapOffsetX) / mapScale; let my = (mouseY - mapOffsetY) / mapScale; let clickedStation = null; for (let s of stations) { if (dist(mx, my, s.x, s.y) < STATION_SIZE + 5) { clickedStation = s; break; } } if (!clickedStation) { let hubs = detectHubs(); for (let h of hubs) { let w = STATION_SIZE + (h.stations.length * 4); if (dist(mx, my, h.x, h.y) < w/1.5) { clickedStation = h.stations[0]; break; } } } if (clickedStation) { if (!selectedStart) { selectedStart = clickedStation; selectedEnd = null; currentPath = []; } else if (!selectedEnd) { selectedEnd = clickedStation; findPath(selectedStart, selectedEnd); } else { selectedStart = clickedStation; selectedEnd = null; currentPath = []; stopJourney(); } } else { selectedStart = null; selectedEnd = null; currentPath = []; stopJourney(); } }
function findPath(start, end) { let queue = [[start.station_id]]; let visited = new Set(); visited.add(start.station_id); while(queue.length > 0) { let path = queue.shift(); let lastId = path[path.length-1]; if (lastId === end.station_id) { currentPath = path.map(id => stations.find(s => s.station_id === id)); startMusicalJourney(); return; } let neighbors = adjacencyList[lastId] || []; for (let n of neighbors) { if (!visited.has(n)) { visited.add(n); queue.push([...path, n]); } } } alert("Pas de connexion physique !"); currentPath = []; }
function generateOptimizedLayout(seed) { randomSeed(seed); takenCells.clear(); let rawLines = Object.values(metroData.lines); let rawStations = Object.values(metroData.stations); if (metroData.transfers) transfers = metroData.transfers; let connectivity = {}; rawLines.forEach(l => connectivity[l.line_id] = 0); transfers.forEach(t => { let l1 = getLineID(t.source, rawStations); let l2 = getLineID(t.target, rawStations); if(l1 && l2 && l1 !== l2) { connectivity[l1]++; connectivity[l2]++; } }); rawLines.sort((a, b) => connectivity[b.line_id] - connectivity[a.line_id]); let placedLines = new Set(); let angleStep = TWO_PI / Math.max(1, rawLines.length); for (let i = 0; i < rawLines.length; i++) { let lineData = rawLines[i]; let lineStations = rawStations.filter(s => s.line_id === lineData.line_id); if (lineStations.length === 0) continue; lineStations.sort((a,b) => a.station_id - b.station_id); let anchor = null; for (let s of lineStations) { let connectedStationID = getConnectedStationID(s.station_id, placedLines); if (connectedStationID !== null) { let targetS = stationMap[connectedStationID]; if (targetS) { anchor = { myStation: s, targetX: targetS.x, targetY: targetS.y }; break; } } } let sectorAngle = i * angleStep; let preferredDirIdx = getBestDirIndexFromAngle(sectorAngle); lineDirectionMap[lineData.line_id] = preferredDirIdx; if (anchor) { anchor.myStation.x = anchor.targetX; anchor.myStation.y = anchor.targetY; markOccupied(anchor.targetX, anchor.targetY); } else { let startRadius = GRID_SIZE * 4; let startX = Math.round((Math.cos(sectorAngle) * startRadius) / GRID_SIZE) * GRID_SIZE; let startY = Math.round((Math.sin(sectorAngle) * startRadius) / GRID_SIZE) * GRID_SIZE; let spot = findFreeSpot(startX, startY); let midIdx = Math.floor(lineStations.length / 2); if (lineStations[midIdx]) { lineStations[midIdx].x = spot.x; lineStations[midIdx].y = spot.y; markOccupied(spot.x, spot.y); } } let placedIndices = lineStations.map((s, idx) => (s.x !== undefined ? idx : -1)).filter(idx => idx !== -1); if (placedIndices.length === 0 && lineStations.length > 0) { let backupX = Math.round((Math.cos(sectorAngle) * GRID_SIZE * 5)/GRID_SIZE)*GRID_SIZE; let backupY = Math.round((Math.sin(sectorAngle) * GRID_SIZE * 5)/GRID_SIZE)*GRID_SIZE; lineStations[0].x = backupX; lineStations[0].y = backupY; markOccupied(backupX, backupY); placedIndices.push(0); } if (placedIndices.length > 0) { for (let j = placedIndices[0] - 1; j >= 0; j--) { placeNextStation(lineStations[j+1], lineStations[j], preferredDirIdx); } for (let j = placedIndices[placedIndices.length-1] + 1; j < lineStations.length; j++) { placeNextStation(lineStations[j-1], lineStations[j], preferredDirIdx); } } lines.push(lineData); lineStations.forEach(s => { s.lineColor = lineData.color; stationMap[s.station_id] = s; stations.push(s); }); placedLines.add(lineData.line_id); } }
function placeNextStation(prevS, currentS, preferredDirIdx) { if (prevS.x === undefined || prevS.y === undefined) return; let candidates = []; for (let dIndex = 0; dIndex < DIRS.length; dIndex++) { let dir = DIRS[dIndex]; let tx = prevS.x + dir.x * GRID_SIZE; let ty = prevS.y + dir.y * GRID_SIZE; if (!isOccupiedByLine(tx, ty, currentS.line_id)) { let score = random(); if (dIndex === preferredDirIdx) score += 2.0; candidates.push({ x: tx, y: ty, score: score }); } } if (candidates.length === 0) { let jumpDir = DIRS[preferredDirIdx]; let spot = findFreeSpot(prevS.x + jumpDir.x * GRID_SIZE * 2, prevS.y + jumpDir.y * GRID_SIZE * 2); currentS.x = spot.x; currentS.y = spot.y; } else { candidates.sort((a, b) => b.score - a.score); currentS.x = candidates[0].x; currentS.y = candidates[0].y; } markOccupied(currentS.x, currentS.y); }
function applyParallelLineAdjustment() { if (!transfers || transfers.length === 0) return; let pairCounts = {}; for (let t of transfers) { let s1 = stationMap[t.source]; let s2 = stationMap[t.target]; if (!s1 || !s2) continue; let l1 = String(s1.line_id); let l2 = String(s2.line_id); if (l1 === l2) continue; let key = l1 < l2 ? l1 + "-" + l2 : l2 + "-" + l1; pairCounts[key] = (pairCounts[key] || 0) + 1; } let keys = Object.keys(pairCounts).sort((a, b) => pairCounts[b] - pairCounts[a]); let alreadyAdjusted = new Set(); for (let key of keys) { if (pairCounts[key] < 3) break; let [lA, lB] = key.split("-"); if (alreadyAdjusted.has(lA) || alreadyAdjusted.has(lB)) continue; makeLinesParallel(lA, lB); alreadyAdjusted.add(lA); alreadyAdjusted.add(lB); } }
function makeLinesParallel(lineAId, lineBId) { lineAId = String(lineAId); lineBId = String(lineBId); let lineAStations = stations.filter(s => String(s.line_id) === lineAId && s.x !== undefined).sort((a, b) => a.station_id - b.station_id); let lineBStations = stations.filter(s => String(s.line_id) === lineBId && s.x !== undefined).sort((a, b) => a.station_id - b.station_id); if (lineAStations.length < 2 || lineBStations.length < 2) return; let anchorA = null, anchorB = null; for (let t of transfers) { let s1 = stationMap[t.source]; let s2 = stationMap[t.target]; if (!s1 || !s2) continue; let l1 = String(s1.line_id); let l2 = String(s2.line_id); if ((l1 === lineAId && l2 === lineBId) || (l1 === lineBId && l2 === lineAId)) { if (l1 === lineAId) { anchorA = s1; anchorB = s2; } else { anchorA = s2; anchorB = s1; } break; } } if (!anchorA || !anchorB) return; let idxA = lineAStations.findIndex(s => s.station_id === anchorA.station_id); if (idxA === -1) return; let dir = { x: 0, y: 0 }; if (idxA > 0) { dir.x += anchorA.x - lineAStations[idxA - 1].x; dir.y += anchorA.y - lineAStations[idxA - 1].y; } if (idxA < lineAStations.length - 1) { dir.x += lineAStations[idxA + 1].x - anchorA.x; dir.y += lineAStations[idxA + 1].y - anchorA.y; } let len = Math.sqrt(dir.x * dir.x + dir.y * dir.y); if (!len) { dir.x = 1; len=1; } dir.x /= len; dir.y /= len; let perp = { x: -dir.y, y: dir.x }; let offset = LINE_WIDTH * 1.5; let n = Math.min(lineAStations.length, lineBStations.length); for (let i = 0; i < n; i++) { let sA = lineAStations[i]; let sB = lineBStations[i]; if (sB.station_id === anchorB.station_id) { sB.x = sA.x; sB.y = sA.y; } else { sB.x = sA.x + perp.x * offset; sB.y = sA.y + perp.y * offset; } } }
function getBestDirIndexFromAngle(angle) { let maxDot = -Infinity; let bestIdx = 0; let cx = Math.cos(angle); let cy = Math.sin(angle); for(let i=0; i<DIRS.length; i++) { let d = DIRS[i]; let len = Math.sqrt(d.x*d.x + d.y*d.y); let dx = d.x / len; let dy = d.y / len; let dot = dx*cx + dy*cy; if(dot > maxDot) { maxDot = dot; bestIdx = i; } } return bestIdx; }
function calculateLabelAngle(s) { let defaultAngle = -PI / 4; let checkX = s.x + GRID_SIZE; let checkY = s.y - GRID_SIZE; if (takenCells.has(makeKey(checkX, checkY))) return PI / 4; return defaultAngle; }
function drawAngledLabel(s, isHub, angle) { push(); translate(s.x, s.y); let dist = isHub ? 28 : 18; rotate(angle); textAlign(LEFT, CENTER); textSize(13); textStyle(BOLD); stroke(255, 255, 255, 230); strokeWeight(4); noFill(); text(s.name, dist, 0); noStroke(); fill(0); text(s.name, dist, 0); pop(); }
function windowResized() { resizeCanvas(windowWidth, windowHeight); calculateInitialCameraFit(); initAudioUI(); }